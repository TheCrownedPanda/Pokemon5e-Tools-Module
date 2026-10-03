import {
	buildNameIndex, speciesIdFromName, emptyDex, statusOf, counts, seenLine, fullInfo,
} from "./pokedex-logic.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE_ID = "pokemon5e-encounters";
const DATA_PATH = `modules/${MODULE_ID}/data/pokedex.json`;
const BESTIARY_PACK = "pokemon5e.pokedex_bestiary";
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

let dataPromise = null;
export const loadPokedexData = () => (dataPromise ??= fetch(foundry.utils.getRoute(DATA_PATH)).then((r) => {
	if (!r.ok) throw new Error(`Could not load ${DATA_PATH} (HTTP ${r.status}).`);
	return r.json();
}).then((data) => {
	data.index = buildNameIndex(data.species);
	data.byId = new Map(data.species.map((s) => [s.id, s]));
	return data;
}).catch((err) => { dataPromise = null; throw err; }));

export const getDex = (user) => foundry.utils.deepClone(user.getFlag(MODULE_ID, "pokedex") ?? emptyDex());
const dexPath = `flags.${MODULE_ID}.pokedex`;

/** Marks species as seen (and optionally caught) on a user's Pokédex. entries = [{ id, shiny, caught }] */
export async function recordSightings(user, entries) {
	const dex = getDex(user);
	const update = {};
	const now = Date.now();
	for (const { id, shiny, caught } of entries) {
		const seen = dex.seen[id];
		if (!seen || (shiny && !seen.shiny)) update[`${dexPath}.seen.${id}`] = { shiny: !!(shiny || seen?.shiny), at: seen?.at ?? now };
		if (caught) {
			const had = dex.caught[id];
			if (!had || (shiny && !had.shiny)) update[`${dexPath}.caught.${id}`] = { shiny: !!(shiny || had?.shiny), at: had?.at ?? now };
		}
	}
	if (Object.keys(update).length) await user.update(update);
}

/** GM tool: force an entry to unseen, seen or caught. */
async function setStatus(user, id, status) {
	const dex = getDex(user);
	const now = Date.now();
	const update = {};
	if (status === "unseen") {
		update[`${dexPath}.seen.-=${id}`] = null;
		update[`${dexPath}.caught.-=${id}`] = null;
	} else {
		update[`${dexPath}.seen.${id}`] = dex.seen[id] ?? { shiny: false, at: now };
		if (status === "caught") update[`${dexPath}.caught.${id}`] = dex.caught[id] ?? { shiny: false, at: now };
		else update[`${dexPath}.caught.-=${id}`] = null;
	}
	await user.update(update);
}

function speciesIdOfActor(actor, data) {
	const flagged = actor.getFlag(MODULE_ID, "encounter")?.speciesId;
	if (flagged && data.byId.has(flagged)) return flagged;
	const source = actor._stats?.compendiumSource ?? "";
	if (source.startsWith(`Compendium.${BESTIARY_PACK}.Actor.`)) {
		const entry = game.packs.get(BESTIARY_PACK)?.index?.get(source.split(".").pop());
		const id = entry && speciesIdFromName(data.index, entry.name);
		if (id) return id;
	}
	return speciesIdFromName(data.index, actor.name);
}

/** Players automatically "catch" every Pokémon they own. */
export async function syncCaught(user = game.user, { verbose = false } = {}) {
	if (user.isGM) return { owned: 0, matched: 0, unmatched: [] };
	const data = await loadPokedexData();
	const entries = [];
	const unmatched = [];
	let owned = 0;
	for (const actor of game.actors) {
		if (!actor.testUserPermission(user, "OWNER")) continue;
		owned++;
		const id = speciesIdOfActor(actor, data);
		if (!id) { unmatched.push(actor.name); continue; }
		const shiny = !!actor.getFlag(MODULE_ID, "encounter")?.shiny || (actor.img ?? "").includes("shiny");
		entries.push({ id, shiny, caught: true });
	}
	if (verbose) console.log(`${MODULE_ID} | ${user.name}: owns ${owned} actors, ${entries.length} matched a species`, { matched: entries.map((e) => e.id), unmatched });
	try {
		await recordSightings(user, entries);
	} catch (err) {
		console.error(`${MODULE_ID} | Could not write ${user.name}'s Pokédex`, err);
		ui.notifications.error(`Could not update ${user.name}'s Pokédex: ${err.message}`, { permanent: true });
	}
	return { owned, matched: entries.length, unmatched };
}

/** Wipes a player's Pokédex. Pokémon they currently own count as caught again straight away. */
export async function clearPokedex(user) {
	await user.update({ [`flags.${MODULE_ID}.-=pokedex`]: null });
	await syncCaught(user);
}

function playScanSound() {
	try {
		if (!game.settings.get(MODULE_ID, "pokedexSound")) return;
		foundry.audio.AudioHelper.play({ src: "sounds/notify.wav", volume: 0.6, autoplay: true, loop: false }, false);
	} catch (err) { console.debug(`${MODULE_ID} | Could not play the scan sound`, err); }
}

let current = null;
let refreshTimer = null;
export function refreshPokedex() {
	clearTimeout(refreshTimer);
	refreshTimer = setTimeout(() => { if (current?.rendered) current.render(); }, 300);
}

export class PokedexApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "pk5e-pokedex-app",
		classes: ["pk5e-pokedex-window"],
		tag: "div",
		window: { title: "Pokédex", icon: "fa-solid fa-book-open", resizable: true },
		position: { width: 920, height: 680 },
		actions: {
			select: PokedexApp.#onSelect,
			clear: PokedexApp.#onClear,
			clearAll: PokedexApp.#onClearAll,
			setStatus: PokedexApp.#onSetStatus,
			refresh: PokedexApp.#onRefresh,
			registerOwned: PokedexApp.#onRegisterOwned,
			scanFor: PokedexApp.#onScanFor,
		},
	};

	static PARTS = { main: { template: `modules/${MODULE_ID}/templates/pokedex.hbs` } };

	#selected = null;
	#search = "";
	#statusFilter = "all";
	#viewUserId = null;
	#scroll = 0;

	constructor(options) {
		super(options);
		current = this;
	}

	async _prepareContext() {
		const data = await loadPokedexData();
		const isGM = game.user.isGM;
		if (!isGM) await syncCaught(game.user); // owned Pokémon always count as caught

		// Opening the Pokédex scans the field: every Pokémon in view is registered as seen.
		const detected = isGM ? [] : this.#visibleSpecies(data);
		const before = isGM ? null : getDex(game.user);
		const fresh = detected.filter((d) => statusOf(before, d.id) === "unseen" || (d.shiny && !(before.seen[d.id]?.shiny || before.caught[d.id]?.shiny)));
		if (fresh.length) {
			await recordSightings(game.user, fresh.map(({ id, shiny }) => ({ id, shiny })));
			this.#selected = fresh[0].id;
			playScanSound();
			ui.notifications.info(`Pokédex: registered ${fresh.map((f) => data.byId.get(f.id).name).join(", ")}!`);
		}
		const freshIds = new Set(fresh.map((f) => f.id));

		const viewUser = isGM ? (game.users.get(this.#viewUserId) ?? game.user) : game.user;
		const dex = getDex(viewUser);
		const total = counts(dex);
		const base = data.baseUrl;
		// Unseen entries show only "?" and the dex number, for players and for a GM viewing a player's Pokédex.
		// Only the GM's own Pokédex is a full reference.
		const revealAll = isGM && viewUser.id === game.user.id;

		const tiles = data.species.map((s) => {
			const status = statusOf(dex, s.id);
			const known = status !== "unseen";
			const shiny = !!(dex.caught[s.id]?.shiny || dex.seen[s.id]?.shiny);
			const number = String(s.n).padStart(3, "0");
			const showName = known || revealAll;
			return {
				id: s.id, number, status, known, shiny, caughtMark: status === "caught",
				label: showName ? s.name : "",
				sprite: known && s.img.sprite ? `${base}${shiny && s.img.spriteShiny ? s.img.spriteShiny : s.img.sprite}` : "",
				selected: s.id === this.#selected,
				filterName: (showName ? `${s.name} #${number}` : `#${number}`).toLowerCase(),
			};
		});

		return {
			isGM,
			viewOptions: isGM ? game.users.filter((u) => !u.isGM || u.id === game.user.id).map((u) => ({ id: u.id, name: u.isGM ? `${u.name} (GM)` : u.name, selected: u.id === viewUser.id })) : [],
			viewingOther: viewUser.id !== game.user.id,
			canClear: isGM && viewUser.id !== game.user.id,
			seenCount: total.seen,
			caughtCount: total.caught,
			total: data.species.length,
			search: this.#search,
			statusOptions: [["all", "All"], ["seen", "Seen"], ["caught", "Caught"], ["unseen", "Not yet seen"]].map(([value, label]) => ({ value, label, selected: value === this.#statusFilter })),
			tiles,
			detail: this.#detail(data, dex, revealAll),
			showField: !isGM,
			field: detected.map((f) => ({ ...f, name: data.byId.get(f.id).name, isNew: freshIds.has(f.id) })),
			banner: fresh.map((f) => ({ name: data.byId.get(f.id).name, number: data.byId.get(f.id).n > 0 ? `#${String(data.byId.get(f.id).n).padStart(3, "0")}` : "", shiny: f.shiny })),
		};
	}

	#detail(data, dex, revealAll) {
		const s = data.byId.get(this.#selected);
		if (!s) return null;
		const status = statusOf(dex, s.id);
		const shiny = !!(dex.caught[s.id]?.shiny || dex.seen[s.id]?.shiny);
		const revealed = status !== "unseen" || revealAll;
		const art = s.img[shiny ? "mainShiny" : "main"] ?? s.img.main;
		return {
			id: s.id,
			locked: !revealed,
			number: s.n > 0 ? `#${String(s.n).padStart(3, "0")}` : "",
			name: revealed ? s.name : "",
			status, statusLabel: { unseen: "Not yet seen", seen: "Seen", caught: "Caught" }[status],
			isUnseen: status === "unseen", isSeen: status === "seen", isCaught: status === "caught",
			shiny,
			img: revealed && art ? `${data.baseUrl}${art}` : "",
			types: revealed ? s.t.map(cap) : [],
			desc: revealed ? s.desc : "",
			habitat: revealed ? seenLine(s, data.biomes) : "",
			full: status === "caught" || revealAll ? fullInfo(s, data) : null,
			fullIsPreview: revealAll && status !== "caught",
		};
	}

	/** Pokémon tokens this player can currently see on the scene, grouped by species. */
	#visibleSpecies(data, ignoreVision = false) {
		if (!canvas?.ready) return [];
		const found = new Map();
		for (const token of canvas.tokens.placeables) {
			if (token.document.hidden || (!ignoreVision && !token.visible)) continue;
			const doc = token.document;
			const id = doc.getFlag(MODULE_ID, "speciesId") ?? speciesIdFromName(data.index, doc.name) ?? (token.actor ? speciesIdFromName(data.index, token.actor.name) : null);
			if (!id || !data.byId.has(id)) continue;
			const shiny = !!doc.getFlag(MODULE_ID, "shiny") || (doc.texture?.src ?? "").includes("shiny");
			const key = `${id}|${shiny}`;
			if (!found.has(key)) found.set(key, { id, shiny, count: 0, img: doc.texture?.src ?? "icons/svg/mystery-man.svg" });
			found.get(key).count++;
		}
		return [...found.values()];
	}

	_onRender(context, options) {
		super._onRender?.(context, options);
		const search = this.element.querySelector("#pk5e-dex-search");
		search?.addEventListener("input", () => { this.#search = search.value; this.#applyFilters(); });
		const status = this.element.querySelector("#pk5e-dex-status");
		status?.addEventListener("change", () => { this.#statusFilter = status.value; this.#applyFilters(); });
		const view = this.element.querySelector("#pk5e-dex-view");
		view?.addEventListener("change", () => { this.#viewUserId = view.value; this.render(); });
		const grid = this.element.querySelector(".pk5e-dex-grid");
		if (grid) {
			grid.scrollTop = this.#scroll;
			grid.addEventListener("scroll", () => { this.#scroll = grid.scrollTop; });
		}
		this.#applyFilters();
	}

	#applyFilters() {
		const q = this.#search.trim().toLowerCase();
		for (const tile of this.element.querySelectorAll(".pk5e-tile")) {
			const textOk = !q || tile.dataset.name.includes(q);
			const s = tile.dataset.status;
			const f = this.#statusFilter;
			const statusOk = f === "all" || s === f || (f === "seen" && s === "caught");
			tile.hidden = !(textOk && statusOk);
		}
	}

	_onClose(options) {
		super._onClose?.(options);
		if (current === this) current = null;
	}

	static #onSelect(event, target) {
		this.#selected = target.dataset.species;
		this.render();
	}

	static async #onClear() {
		const user = game.users.get(this.#viewUserId);
		if (!user || user.isGM) return;
		const ok = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Clear Pokédex" },
			content: `<p>Clear <strong>${user.name}</strong>'s Pokédex? Everything they have seen is erased. Pokémon they currently own count as caught again straight away.</p>`,
		});
		if (!ok) return;
		await clearPokedex(user);
		this.#selected = null;
		ui.notifications.info(`Cleared ${user.name}'s Pokédex.`);
		this.render();
	}

	static async #onClearAll() {
		const players = game.users.filter((u) => !u.isGM);
		const ok = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Clear All Pokédexes" },
			content: `<p>Clear the Pokédex of <strong>all ${players.length} players</strong>? Pokémon they currently own count as caught again straight away.</p>`,
		});
		if (!ok) return;
		for (const user of players) await clearPokedex(user);
		this.#selected = null;
		ui.notifications.info("Cleared every player's Pokédex.");
		this.render();
	}

	static async #onSetStatus(event, target) {
		const viewUser = game.users.get(this.#viewUserId) ?? game.user;
		await setStatus(viewUser, target.dataset.species, target.dataset.status);
		this.render();
	}

	/** GM: count every Pokémon the player(s) own as caught, right now. */
	static async #onRegisterOwned(event, target) {
		const all = target.dataset.scope === "all";
		this.#viewUserId = this.element.querySelector("#pk5e-dex-view")?.value ?? this.#viewUserId;
		const one = game.users.get(this.#viewUserId);
		console.log(`${MODULE_ID} | Register owned clicked`, { scope: target.dataset.scope, viewing: one?.name });
		const users = all ? game.users.filter((u) => !u.isGM) : (one && !one.isGM ? [one] : []);
		if (!users.length) return ui.notifications.warn("Pick a player in the 'Viewing' list first.");
		const lines = [];
		for (const user of users) {
			const r = await syncCaught(user, { verbose: true });
			lines.push(`${user.name}: ${r.matched} caught${r.unmatched.length ? ` (not recognised: ${r.unmatched.join(", ")})` : ""}${r.owned === 0 ? " (owns no actors; check Owner permission, not just the All Players setting)" : ""}`);
		}
		playScanSound();
		ui.notifications.info(`Registered owned Pokémon. ${lines.join(" | ")}`);
		this.render();
	}

	/** GM: scan the current scene on a player's behalf (every visible, non-hidden Pokémon token). */
	static async #onScanFor(event, target) {
		const all = target.dataset.scope === "all";
		this.#viewUserId = this.element.querySelector("#pk5e-dex-view")?.value ?? this.#viewUserId;
		const one = game.users.get(this.#viewUserId);
		console.log(`${MODULE_ID} | Scan for player clicked`, { scope: target.dataset.scope, viewing: one?.name });
		const users = all ? game.users.filter((u) => !u.isGM) : (one && !one.isGM ? [one] : []);
		if (!users.length) return ui.notifications.warn("Pick a player in the 'Viewing' list first.");
		const data = await loadPokedexData();
		const found = this.#visibleSpecies(data, true);
		if (!found.length) return ui.notifications.warn("No unhidden Pokémon tokens on this scene to scan.");
		for (const user of users) await recordSightings(user, found.map(({ id, shiny }) => ({ id, shiny })));
		playScanSound();
		ui.notifications.info(`Scanned ${found.map((f) => data.byId.get(f.id).name).join(", ")} for ${all ? "all players" : users[0].name}.`);
		this.render();
	}

	static #onRefresh() {
		this.render();
	}
}
