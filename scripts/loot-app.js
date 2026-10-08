import {
	buildCategories, defaultEnabled, rollLoot, RARITIES, rarityLabel, BIOME_THEMES, PRIMARY_WEIGHT, ENVIRONMENT_BOOST,
} from "./loot-logic.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE_ID = "pokemon5e-encounters";
const ITEMS_PACK = "pokemon5e.items_and_consumables";
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const titleCase = (id) => id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const BIOMES = Object.keys(BIOME_THEMES).map((id) => ({ value: id, label: titleCase(id) }));

let catalogPromise = null;
/** Reads the Items & Consumables compendium: its folders (the categories) and an index of every item. */
async function loadCatalog() {
	const pack = game.packs.get(ITEMS_PACK);
	if (!pack) throw new Error("The Pokémon 5e \"Items & Consumables\" compendium was not found. Make sure the Pokémon 5e module is active.");
	const index = await pack.getIndex({ fields: ["folder", "system.rarity", "system.price"] });
	const folders = pack.folders.map((f) => ({ id: f.id, name: f.name, parent: f._source?.folder ?? f.folder?.id ?? null }));
	const items = index.map((e) => ({ id: e._id, name: e.name, img: e.img, type: e.type, folder: e.folder ?? null, rarity: e.system?.rarity ?? "", price: e.system?.price }));
	return buildCategories(folders, items);
}
export const getCatalog = () => (catalogPromise ??= loadCatalog().catch((err) => { catalogPromise = null; throw err; }));

export class PokemonLootApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "pk5e-loot-app",
		classes: ["pk5e-encounters", "pk5e-loot"],
		tag: "form",
		window: { title: "Pokémon Loot Generator", icon: "fa-solid fa-gem", resizable: true },
		position: { width: 600, height: 760 },
		form: { handler: PokemonLootApp.#onSubmit, submitOnChange: true, closeOnSubmit: false },
		actions: {
			generate: PokemonLootApp.#onGenerate,
			clear: PokemonLootApp.#onClear,
			removeRow: PokemonLootApp.#onRemoveRow,
			give: PokemonLootApp.#onGive,
			createItems: PokemonLootApp.#onCreateItems,
			toChat: PokemonLootApp.#onToChat,
			selectDefaults: PokemonLootApp.#onSelectDefaults,
			selectAll: PokemonLootApp.#onSelectAll,
			selectNone: PokemonLootApp.#onSelectNone,
		},
	};

	static PARTS = { main: { template: `modules/${MODULE_ID}/templates/loot.hbs` } };

	#catalog = null;
	#busy = false;
	#state = {
		biome: "", count: 5, maxRarity: "rare", stacks: true, stackExisting: true,
		enabled: null, loot: [], actorId: "", noMatches: false,
	};

	async _prepareContext() {
		let error = null;
		try {
			this.#catalog ??= await getCatalog();
			this.#state.enabled ??= defaultEnabled(this.#catalog.groups);
		} catch (err) {
			error = err.message;
		}
		const s = this.#state;
		const groups = (this.#catalog?.groups ?? []).map((g) => {
			const categories = g.categories.map((c) => ({ ...c, checked: s.enabled.has(c.key) }));
			return {
				key: g.key, name: g.name, primary: g.primary, categories,
				allChecked: categories.every((c) => c.checked),
				single: categories.length === 1,
			};
		});
		const characters = game.actors.filter((a) => a.type === "character").sort((a, b) => a.name.localeCompare(b.name));
		if (s.actorId && !characters.some((a) => a.id === s.actorId)) s.actorId = "";
		return {
			error,
			biomeOptions: [{ value: "", label: "- Anywhere -", selected: s.biome === "" }, ...BIOMES.map((b) => ({ ...b, selected: b.value === s.biome }))],
			rarityOptions: RARITIES.map((r) => ({ ...r, selected: r.value === s.maxRarity })),
			count: s.count,
			stacks: s.stacks,
			stackExisting: s.stackExisting,
			groups,
			enabledCount: s.enabled?.size ?? 0,
			primaryWeight: PRIMARY_WEIGHT,
			environmentBoost: ENVIRONMENT_BOOST,
			rows: s.loot.map((r, i) => ({ ...r, index: i, rarityLabel: rarityLabel(r.rarity), priceLabel: r.price ? `${r.price.toLocaleString()} ${r.denomination}` : "-" })),
			hasLoot: s.loot.length > 0,
			noMatches: s.noMatches,
			actorOptions: [{ value: "", label: "- Choose a character -", selected: s.actorId === "" }, ...characters.map((a) => ({ value: a.id, label: a.name, selected: a.id === s.actorId }))],
			noCharacters: !characters.length,
			busy: this.#busy,
		};
	}

	_onRender(context, options) {
		super._onRender?.(context, options);
		// A group's header checkbox switches all of its categories on or off. (It has no name, so it isn't part of the form data;
		// the form then submits because a checkbox changed.)
		for (const toggle of this.element.querySelectorAll("[data-group-toggle]")) {
			toggle.addEventListener("change", () => {
				for (const box of this.element.querySelectorAll(`input[data-group="${toggle.dataset.groupToggle}"]`)) box.checked = toggle.checked;
			});
		}
	}

	static async #onSubmit(event, form, formData) {
		const data = foundry.utils.expandObject(formData.object);
		const s = this.#state;
		if (data.biome !== undefined) s.biome = data.biome;
		if (data.maxRarity !== undefined) s.maxRarity = data.maxRarity;
		if (data.count !== undefined) s.count = clamp(Math.round(Number(data.count)) || 1, 1, 30);
		s.stacks = !!data.stacks;
		s.stackExisting = !!data.stackExisting;
		if (data.actorId !== undefined) s.actorId = data.actorId;
		// Category checkboxes: only ticked ones are in the form data.
		if (this.#catalog) s.enabled = new Set(Object.entries(data.cat ?? {}).filter(([, on]) => on).map(([key]) => key));
		s.loot.forEach((row, i) => {
			const f = data.rows?.[i];
			if (!f) return;
			row.quantity = clamp(Math.round(Number(f.quantity)) || 1, 1, 99);
			row.locked = !!f.locked;
		});
		this.render();
	}

	static #onGenerate() {
		const s = this.#state;
		if (!this.#catalog) return;
		if (!s.enabled.size) { ui.notifications.warn("Switch on at least one category first."); return; }
		const locked = s.loot.filter((r) => r.locked);
		s.loot = rollLoot({
			categories: this.#catalog, enabled: s.enabled, count: s.count, maxRarity: s.maxRarity,
			biome: s.biome, stacks: s.stacks, locked,
		});
		s.noMatches = s.loot.length === 0;
		this.render();
	}

	static #onClear() {
		this.#state.loot = [];
		this.#state.noMatches = false;
		this.render();
	}

	static #onRemoveRow(event, target) {
		this.#state.loot.splice(Number(target.dataset.index), 1);
		this.render();
	}

	static #onSelectDefaults() {
		if (!this.#catalog) return;
		this.#state.enabled = defaultEnabled(this.#catalog.groups);
		this.render();
	}

	static #onSelectAll() {
		if (!this.#catalog) return;
		this.#state.enabled = new Set(this.#catalog.groups.flatMap((g) => g.categories.map((c) => c.key)));
		this.render();
	}

	static #onSelectNone() {
		this.#state.enabled = new Set();
		this.render();
	}

	/** Fresh item data from the compendium for a rolled row. */
	async #itemData(row) {
		const pack = game.packs.get(ITEMS_PACK);
		const doc = await pack?.getDocument(row.id);
		if (!doc) throw new Error(`"${row.name}" was not found in the compendium.`);
		const data = doc.toObject();
		for (const key of ["_id", "_stats", "sort", "folder", "ownership"]) delete data[key];
		data.system.quantity = row.quantity;
		if ("container" in data.system) data.system.container = null;
		foundry.utils.setProperty(data, `flags.${MODULE_ID}.loot`, true);
		return data;
	}

	async #run(task) {
		if (this.#busy) return;
		this.#busy = true;
		this.render();
		try { await task(); }
		catch (err) { console.error(`${MODULE_ID} |`, err); ui.notifications.error(`Loot: ${err.message}`); }
		finally { this.#busy = false; this.render(); }
	}

	/** Adds the rolled items to a character's inventory. Existing items are only touched to add to a stack (if that option is on). */
	static async #onGive() {
		const s = this.#state;
		const actor = game.actors.get(s.actorId);
		if (!actor) return ui.notifications.warn("Choose a character to give the loot to.");
		if (!s.loot.length) return;
		await this.#run(async () => {
			const toCreate = [];
			const stackUpdates = new Map(); // item id -> new quantity
			const given = [];
			for (const row of s.loot) {
				const existing = s.stackExisting ? actor.items.find((i) => i.name === row.name && i.type === row.type) : null;
				if (existing) {
					const base = stackUpdates.get(existing.id) ?? (Number(existing.system.quantity) || 0);
					stackUpdates.set(existing.id, base + row.quantity);
				} else {
					toCreate.push(await this.#itemData(row));
				}
				given.push(`${row.name} ×${row.quantity}`);
			}
			if (stackUpdates.size) await actor.updateEmbeddedDocuments("Item", [...stackUpdates].map(([_id, quantity]) => ({ _id, "system.quantity": quantity })));
			if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
			ui.notifications.info(`Gave ${actor.name}: ${given.join(", ")}.`);
		});
	}

	/** Creates the rolled items as world Items in a dated "Loot" subfolder, so you can drag them out yourself. */
	static async #onCreateItems() {
		const s = this.#state;
		if (!s.loot.length) return;
		await this.#run(async () => {
			let root = game.folders.find((f) => f.type === "Item" && f.getFlag(MODULE_ID, "lootFolder"));
			root ??= await Folder.create({ name: "Loot", type: "Item", flags: { [MODULE_ID]: { lootFolder: true } } });
			const folder = await Folder.create({ name: `Loot ${new Date().toLocaleString()}`, type: "Item", folder: root.id });
			const data = [];
			for (const row of s.loot) data.push({ ...(await this.#itemData(row)), folder: folder.id });
			await Item.implementation.createDocuments(data);
			game.sidebar?.changeTab?.("items", "primary");
			ui.notifications.info(`Created ${data.length} items in the Items tab, folder "${folder.name}".`);
		});
	}

	static async #onToChat() {
		const s = this.#state;
		if (!s.loot.length) return;
		const lines = s.loot.map((r) => `<li>@UUID[Compendium.${ITEMS_PACK}.Item.${r.id}]{${r.name}} ×${r.quantity} <em>(${rarityLabel(r.rarity)})</em></li>`).join("");
		await ChatMessage.create({ content: `<h3>Loot</h3><ul>${lines}</ul>`, speaker: ChatMessage.getSpeaker() });
	}
}
