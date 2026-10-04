import {
	experienceBudget, encounterDifficulty, filterPool, generateEncounter,
	totalExperience, totalCount, ENCOUNTER_SIZE_LIMIT,
	SR_VALUES, srLabel, sortEncounter, rollShinies, makeOneShiny, totalShinies,
} from "./generator.js";
import { scaleActorToLevel } from "./scaling.js";
import { fakemonEnabled, scanCustomSpecies, toEncounterSpecies, buildFakemonActorData, artUrl } from "./fakemon.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE_ID = "pokemon5e-encounters";
const BESTIARY_PACK = "pokemon5e.pokedex_bestiary";
const DATA_PATH = `modules/${MODULE_ID}/data/species.json`;
const REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Hisui", "Unova", "Kalos", "Alola", "Galar", "Paldea"];
const TYPES = ["bug", "dark", "dragon", "electric", "fairy", "fighting", "fire", "flying", "ghost", "grass", "ground", "ice", "normal", "poison", "psychic", "rock", "steel", "water"];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

let dataPromise = null;
const loadData = () => (dataPromise ??= fetch(foundry.utils.getRoute(DATA_PATH)).then((r) => {
	if (!r.ok) throw new Error(`Could not load ${DATA_PATH} (HTTP ${r.status}). Is the module folder named "${MODULE_ID}"?`);
	return r.json();
}).then(async (data) => {
	// Fakemon are only in the pool when the "Include Fakemon" setting is on.
	const official = data.species.filter((s) => !s.fk);
	if (fakemonEnabled()) {
		const known = new Set(official.flatMap((s) => s.actors));
		const custom = (await scanCustomSpecies(known)).map(toEncounterSpecies);
		data.species = [...official, ...data.species.filter((s) => s.fk), ...custom];
	} else {
		data.species = official;
	}
	return data;
}).catch((err) => { dataPromise = null; throw err; }));

function xpEdition() {
	const setting = game.settings.get(MODULE_ID, "xpEdition");
	if (setting !== "auto") return setting;
	try { return game.settings.get("pokemon5e", "stabVersion") ?? "2024"; } catch { return "2024"; }
}

export class PokemonEncounterApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "pk5e-encounters-app",
		classes: ["pk5e-encounters"],
		tag: "form",
		window: { title: "Pokémon Encounter Generator", icon: "fa-solid fa-paw", resizable: true },
		position: { width: 540, height: "auto" },
		form: { handler: PokemonEncounterApp.#onSubmit, submitOnChange: true, closeOnSubmit: false },
		actions: {
			addPlayer: PokemonEncounterApp.#onAddPlayer,
			removePlayer: PokemonEncounterApp.#onRemovePlayer,
			loadParty: PokemonEncounterApp.#onLoadParty,
			generate: PokemonEncounterApp.#onGenerate,
			place: PokemonEncounterApp.#onPlace,
			clear: PokemonEncounterApp.#onClear,
			cleanup: PokemonEncounterApp.#onCleanup,
			makeShiny: PokemonEncounterApp.#onMakeShiny,
			addPin: PokemonEncounterApp.#onAddPin,
			removePin: PokemonEncounterApp.#onRemovePin,
		},
	};

	static PARTS = { main: { template: `modules/${MODULE_ID}/templates/encounter.hbs` } };

	#data = null;
	#placing = false;
	#pinText = "";
	#state = {
		players: [{ id: 1, level: 1, numberOfPokemon: 1 }],
		nextId: 2,
		biome: "", type: "", regionType: "native", regionName: "",
		minSr: "", maxSr: "", placeOnScene: true, forceShiny: false,
		pins: [], nextPinId: 1,
		difficulty: "low", limited: "no", limit: 1,
		encounter: [], noMatches: false,
	};

	async _prepareContext() {
		this.#data ??= await loadData();
		const s = this.#state;
		const budget = experienceBudget(this.#effectivePlayers(), s.difficulty);
		const exp = totalExperience(s.encounter);
		const count = totalCount(s.encounter);
		const pack = game.packs.get(BESTIARY_PACK);
		await pack?.getIndex({ fields: ["img"] }); // image paths for the result list
		const options = (list, current) => list.map((o) => ({ ...o, selected: o.value === current }));

		return {
			players: s.players.map((p, i) => ({ ...p, index: i, number: i + 1, canRemove: s.players.length > 1 })),
			biomeOptions: options([{ value: "", label: "- None -" }, ...this.#data.biomes.map((b) => ({ value: b.id, label: b.name }))], s.biome),
			typeOptions: options([{ value: "", label: "- None -" }, ...TYPES.map((t) => ({ value: t, label: cap(t) }))], s.type),
			regionTypeOptions: options([{ value: "native", label: "Native to" }, { value: "found in", label: "Found in" }], s.regionType),
			regionOptions: options([{ value: "", label: "Any" }, ...REGIONS.map((r) => ({ value: r, label: r }))], s.regionName),
			difficultyOptions: options([{ value: "low", label: "Low" }, { value: "moderate", label: "Moderate" }, { value: "high", label: "High" }], s.difficulty),
			limitedOptions: options([{ value: "no", label: "No" }, { value: "yes", label: "Yes" }], s.limited),
			minSrOptions: options([{ value: "", label: "Any" }, ...SR_VALUES.map((v) => ({ value: String(v), label: srLabel(v) }))], s.minSr),
			maxSrOptions: options([{ value: "", label: "Any" }, ...SR_VALUES.map((v) => ({ value: String(v), label: srLabel(v) }))], s.maxSr),
			placeOnScene: s.placeOnScene,
			forceShiny: s.forceShiny,
			pins: s.pins.map((p, i) => ({
				...p, index: i, name: this.#data.species.find((sp) => sp.id === p.speciesId)?.name ?? p.speciesId,
				levelOptions: [{ value: "", label: "Auto", selected: p.level === "" }, ...Array.from({ length: 20 }, (_, n) => ({ value: String(n + 1), label: String(n + 1), selected: p.level === String(n + 1) }))],
			})),
			pinText: this.#pinText,
			speciesNames: this.#data.species.map((sp) => sp.name),
			createLabel: s.placeOnScene ? "Place on Scene" : "Create in Folder",
			createIcon: s.placeOnScene ? "fa-location-dot" : "fa-folder-plus",
			shinyOdds: game.settings.get(MODULE_ID, "shinyOdds"),
			shinyCount: totalShinies(s.encounter),
			limited: s.limited === "yes",
			limit: s.limit,
			budget,
			hasEncounter: count > 0,
			rows: s.encounter.map((e) => ({
				name: e.species.name, level: e.level, count: e.count, shiny: e.shiny ?? 0, pinned: !!e.pinned, sr: srLabel(e.species.sr),
				exp: e.exp * e.count,
				img: e.species.art ? artUrl(this.#data.shinyBaseUrl ?? "https://poke5e.app", e.species.art) : (pack?.index?.find((i) => i.name === e.species.actors[0])?.img ?? "icons/svg/mystery-man.svg"),
			})),
			totalExp: exp,
			totalCount: count,
			overLimit: count > ENCOUNTER_SIZE_LIMIT,
			difficulty: encounterDifficulty(exp, budget, s.difficulty),
			noMatches: s.noMatches,
			placing: this.#placing,
			bestiaryMissing: !pack,
		};
	}

	_onRender(context, options) {
		super._onRender?.(context, options);
		const input = this.element.querySelector("#pk5e-pin-input");
		if (!input) return;
		// Typing a name must not submit/re-render the form; Enter adds the Pokémon.
		input.addEventListener("change", (e) => e.stopPropagation());
		input.addEventListener("input", () => { this.#pinText = input.value; });
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			this.#addPin(input.value);
		});
	}

	#addPin(text) {
		const wanted = text.trim().toLowerCase();
		if (!wanted) return;
		const species = this.#data.species.find((sp) => sp.name.toLowerCase() === wanted)
			?? this.#data.species.find((sp) => sp.actors.some((a) => a.toLowerCase() === wanted));
		if (!species) return ui.notifications.warn(`No Pokémon named "${text.trim()}" was found. Pick one from the suggestions.`);
		this.#state.pins.push({ id: this.#state.nextPinId++, speciesId: species.id, level: "", count: 1, shiny: false });
		this.#pinText = "";
		this.render();
	}

	static #onAddPin() {
		this.#addPin(this.element.querySelector("#pk5e-pin-input")?.value ?? "");
	}

	static #onRemovePin(event, target) {
		this.#state.pins.splice(Number(target.dataset.index), 1);
		this.render();
	}

	/** Players used for the budget; with an empty party the site assumes four level-1 players. */
	#effectivePlayers() {
		return this.#state.players.length ? this.#state.players : Array.from({ length: 4 }, () => ({ level: 1, numberOfPokemon: 1 }));
	}

	static async #onSubmit(event, form, formData) {
		const data = foundry.utils.expandObject(formData.object);
		const s = this.#state;
		s.players.forEach((p, i) => {
			const f = data.players?.[i];
			if (!f) return;
			p.level = clamp(Math.round(Number(f.level)) || 1, 1, 20);
			p.numberOfPokemon = Math.max(1, Math.round(Number(f.numberOfPokemon)) || 1);
		});
		s.pins.forEach((pin, i) => {
			const f = data.pins?.[i];
			if (!f) return;
			pin.level = f.level ?? "";
			pin.count = Math.max(1, Math.round(Number(f.count)) || 1);
			pin.shiny = !!f.shiny;
		});
		for (const key of ["biome", "type", "regionType", "regionName", "difficulty", "limited", "minSr", "maxSr"]) {
			if (data[key] !== undefined) s[key] = data[key];
		}
		s.placeOnScene = !!data.placeOnScene; // an unchecked checkbox is simply absent from the form
		const wasForcing = s.forceShiny;
		s.forceShiny = !!data.forceShiny;
		// Ticking the box on an encounter that is already on screen makes one of its Pokémon shiny right away.
		if (s.forceShiny && !wasForcing && s.encounter.length && !totalShinies(s.encounter)) makeOneShiny(s.encounter);
		if (data.limit !== undefined) s.limit = Math.max(1, Math.round(Number(data.limit)) || 1);
		this.render();
	}

	static #onAddPlayer() {
		this.#state.players.push({ id: this.#state.nextId++, level: 1, numberOfPokemon: 1 });
		this.render();
	}

	static #onRemovePlayer(event, target) {
		const index = Number(target.dataset.index);
		this.#state.players.splice(index, 1);
		if (!this.#state.players.length) this.#state.players.push({ id: this.#state.nextId++, level: 1, numberOfPokemon: 1 });
		this.render();
	}

	static #onLoadParty() {
		const characters = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
		if (!characters.length) return ui.notifications.warn("No player-owned characters found.");
		this.#state.players = characters.map((a) => ({
			id: this.#state.nextId++,
			level: clamp(Number(a.system.details?.level) || 1, 1, 20),
			numberOfPokemon: 1,
		}));
		this.render();
	}

	static async #onGenerate() {
		this.#data ??= await loadData();
		const s = this.#state;
		const players = this.#effectivePlayers();
		const pool = filterPool(this.#data.species, {
			...s,
			minSr: s.minSr === "" ? null : Number(s.minSr),
			maxSr: s.maxSr === "" ? null : Number(s.maxSr),
		});
		if (!pool.length && !s.pins.length) { s.encounter = []; s.noMatches = true; return this.render(); }
		const pinned = s.pins.map((pin) => ({
			species: this.#data.species.find((sp) => sp.id === pin.speciesId),
			level: pin.level === "" ? null : Number(pin.level),
			count: pin.count,
			shiny: pin.shiny,
		})).filter((pin) => pin.species);

		s.encounter = generateEncounter({
			pool,
			targetExp: experienceBudget(players, s.difficulty),
			pokemonLimit: s.limited === "yes" ? s.limit : Infinity,
			maxLevel: Math.max(...players.map((p) => p.level)),
			edition: xpEdition(),
			pinned,
		});
		rollShinies(s.encounter, game.settings.get(MODULE_ID, "shinyOdds"));
		if (s.forceShiny && s.encounter.length && !totalShinies(s.encounter)) makeOneShiny(s.encounter);
		sortEncounter(s.encounter);
		s.noMatches = s.encounter.length === 0;
		this.render();
	}

	static #onMakeShiny() {
		if (!makeOneShiny(this.#state.encounter)) ui.notifications.info("Every Pokémon in this encounter is already shiny.");
		this.render();
	}

	static #onClear() {
		this.#state.encounter = [];
		this.#state.noMatches = false;
		this.render();
	}

	static async #onPlace() {
		if (this.#placing) return;
		this.#placing = true;
		this.render();
		try { await this.#createPokemon(); }
		catch (err) { console.error(`${MODULE_ID} |`, err); ui.notifications.error(`Could not place the encounter: ${err.message}`); }
		finally { this.#placing = false; this.render(); }
	}

	/**
	 * Creates a separate world actor for every Pokémon and scales it to its rolled level. Then, if requested,
	 * drops linked tokens on the scene. Because each Pokémon is its own actor, giving a player ownership of it
	 * keeps its level, HP, moves, ability and shininess.
	 */
	async #createPokemon() {
		const placeOnScene = this.#state.placeOnScene;
		const scene = canvas?.scene;
		if (placeOnScene && !scene) return ui.notifications.warn("Open a scene first, or untick \"Place tokens on the scene\".");
		const pack = game.packs.get(BESTIARY_PACK);
		if (!pack) return ui.notifications.error("The Pokémon 5e bestiary compendium was not found.");
		const index = await pack.getIndex({ fields: ["img"] });
		const idByName = new Map(index.map((i) => [i.name, i._id]));

		let rootFolder = game.folders.find((f) => f.type === "Actor" && f.getFlag(MODULE_ID, "encounterFolder"));
		rootFolder ??= await Folder.create({ name: "Encounter Pokémon", type: "Actor", flags: { [MODULE_ID]: { encounterFolder: true } } });
		// Folder-only mode puts each batch in its own dated subfolder so it is easy to find.
		const folder = placeOnScene ? rootFolder : await Folder.create({
			name: `Encounter ${new Date().toLocaleString()}`,
			type: "Actor",
			folder: rootFolder.id,
			flags: { [MODULE_ID]: { encounterSubfolder: true } },
		});

		const individuals = [];
		for (const entry of this.#state.encounter) {
			for (let i = 0; i < entry.count; i++) individuals.push({ entry, level: entry.level, shiny: i < (entry.shiny ?? 0) });
		}

		const knownIds = new Set(game.actors.map((a) => a.id)); // everything that already exists in the world
		const shinyBase = this.#data?.shinyBaseUrl ?? "https://poke5e.app";
		const notice = ui.notifications.info(`Creating ${individuals.length} Pokémon...`, { progress: true });
		const created = [];
		const summary = [];
		let failed = 0;
		for (const [n, { entry, level, shiny }] of individuals.entries()) {
			const names = entry.species.actors;
			const isBuilt = !!entry.species.fk; // poke5e fakemon have no bestiary actor; theirs is built from the stat block
			const actorName = isBuilt ? entry.species.name : names[Math.floor(Math.random() * names.length)];
			const id = idByName.get(actorName);
			if (!id && !isBuilt) { console.warn(`${MODULE_ID} | "${actorName}" is not in the bestiary; skipping.`); failed++; continue; }

			const updateData = {
				folder: folder.id,
				flags: { [MODULE_ID]: { encounter: { speciesId: entry.species.id, level, shiny } } },
			};
			if (shiny && entry.species.shiny) {
				const art = `${shinyBase}${entry.species.shiny}`;
				updateData.img = art;
				updateData.prototypeToken = { texture: { src: art } };
			}
			// Build a brand-new actor from a clean copy of the compendium data. (Foundry's own import helper can
			// reuse an actor you already imported earlier, and this module must never touch existing actors.)
			let data;
			if (isBuilt) {
				try { data = await buildFakemonActorData(entry.species.id); }
				catch (err) { failed++; console.error(`${MODULE_ID} | Could not build ${actorName}`, err); continue; }
			} else {
				data = (await pack.getDocument(id)).toObject();
			}
			delete data._id;
			delete data._stats;
			delete data.sort;
			data.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
			foundry.utils.mergeObject(data, updateData);
			const actor = await Actor.implementation.create(data, { keepId: false });
			if (!actor || knownIds.has(actor.id)) {
				failed++;
				console.error(`${MODULE_ID} | Refusing to touch an existing actor (${actor?.name}, ${actor?.id}); skipping ${actorName}.`);
				continue;
			}
			knownIds.add(actor.id);
			if (actor.folder?.id !== folder.id) {
				console.warn(`${MODULE_ID} | ${actor.name} was created outside the target folder (in "${actor.folder?.name ?? "no folder"}"); moving it.`);
				await actor.update({ folder: folder.id });
			}
			console.log(`${MODULE_ID} | Created ${actor.name} (${actor.id}) in folder "${actor.folder?.name}", shiny: ${shiny}, img: ${actor.img}`);
			try {
				const result = await scaleActorToLevel(actor, level);
				if (!result || (result.classLevel ?? 0) < result.target) failed++;
				if (result) summary.push({ ...result, shiny });
			} catch (err) {
				failed++;
				console.error(`${MODULE_ID} | Level scaling failed for ${actor.name}`, err);
			}
			created.push({ actor, level, speciesId: entry.species.id, shiny });
			notice?.update?.({ pct: (n + 1) / individuals.length });
		}
		if (!created.length) return ui.notifications.warn("None of these Pokémon were found in the bestiary.");

		if (placeOnScene) {
			// Grid layout around the middle of the current view.
			const grid = canvas.grid.size;
			const cell = grid * Math.max(1, ...created.map((p) => Math.ceil(p.actor.prototypeToken.width ?? 1)));
			const cols = Math.ceil(Math.sqrt(created.length * 1.5));
			const rows = Math.ceil(created.length / cols);
			const center = canvas.stage.pivot;
			const appendLevel = game.settings.get(MODULE_ID, "appendLevel");

			const tokenData = [];
			for (const [i, { actor, level, speciesId, shiny }] of created.entries()) {
				const raw = { x: center.x - (cols * cell) / 2 + (i % cols) * cell, y: center.y - (rows * cell) / 2 + Math.floor(i / cols) * cell };
				const point = canvas.grid.getSnappedPoint(raw, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX });
				const data = { x: point.x, y: point.y, actorLink: true, flags: { [MODULE_ID]: { speciesId, shiny } } }; // lets the Pokédex identify the token
				if (appendLevel) data.name = `${actor.prototypeToken.name} (Lv ${level})`;
				tokenData.push((await actor.getTokenDocument(data)).toObject());
			}
			await scene.createEmbeddedDocuments("Token", tokenData);
		}

		const missing = created.filter(({ actor }) => !game.actors.get(actor.id) || game.actors.get(actor.id).folder?.id !== folder.id);
		if (missing.length) {
			console.error(`${MODULE_ID} | These Pokémon are not in the target folder:`, missing.map(({ actor }) => `${actor.name} (${actor.id})`));
			ui.notifications.warn(`${missing.length} Pokémon are not in the folder: ${missing.map(({ actor }) => actor.name).join(", ")}. Search the Actors tab for them.`);
		}

		if (!placeOnScene) {
			// Jump to the Actors tab and open the new folder so the Pokémon are easy to find.
			try {
				ui.sidebar?.changeTab?.("actors", "primary");
				for (const f of [rootFolder, folder]) if (game.folders._expanded) game.folders._expanded[f.uuid] = true;
				ui.actors?.render();
			} catch (err) { console.debug(`${MODULE_ID} | Could not reveal the new folder`, err); }
		}

		console.table(summary);
		const shinies = summary.filter((r) => r.shiny).length;
		const where = placeOnScene ? `in the "Encounter Pokémon" folder and on the scene` : `in the folder "${folder.name}" (Actors tab)`;
		if (failed) ui.notifications.warn(`${failed} Pokémon were not fully scaled to their level; see the console (F12) for details.`);
		else ui.notifications.info(`Created ${created.length} Pokémon${shinies ? `, ${shinies} shiny ✨` : ""} ${where}.`);
	}

	/** Deletes encounter Pokémon nobody ended up using: not on any scene and not owned by a player. */
	static async #onCleanup() {
		const unused = game.actors.filter((a) => {
			if (!a.getFlag(MODULE_ID, "encounter")) return false;
			if (game.users.some((u) => !u.isGM && a.testUserPermission(u, "OWNER"))) return false;
			return !game.scenes.some((sc) => sc.tokens.some((t) => t.actorId === a.id));
		});
		if (!unused.length) return ui.notifications.info("No unused encounter Pokémon to clean up.");
		const ok = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Clean Up Encounter Pokémon" },
			content: `<p>Delete ${unused.length} generated Pokémon that are not on any scene and not owned by a player?</p>`,
		});
		if (!ok) return;
		await Actor.deleteDocuments(unused.map((a) => a.id));
		const emptyFolders = game.folders.filter((f) => f.type === "Actor" && f.getFlag(MODULE_ID, "encounterSubfolder") && !f.contents.length && !f.children.length);
		if (emptyFolders.length) await Folder.deleteDocuments(emptyFolders.map((f) => f.id));
		ui.notifications.info(`Deleted ${unused.length} unused Pokémon.`);
	}
}
