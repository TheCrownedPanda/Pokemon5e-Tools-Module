/**
 * Pure helpers for the shop (no Foundry globals), so they can be tested outside Foundry.
 * Shop presets are modeled on the Poké Marts of Kanto. Prices are NOT stored here: they always come from the
 * Pokémon 5e "Items & Consumables" compendium (and can be edited per row in the shop).
 */
import { normalize } from "./loot-logic.js";

/**
 * Items that are in the Kanto marts but not in the Pokémon 5e compendium. They are offered as simple custom items
 * (no rules text) with the price they have in the games; change the price in the shop if you like.
 */
export const CUSTOM_ITEMS = {
	"Repel": { price: 350, description: "A spray that keeps weak wild Pokémon away for a while." },
	"Super Repel": { price: 500, description: "A stronger spray that keeps wild Pokémon away for longer." },
	"Max Repel": { price: 700, description: "The strongest repellent spray; it keeps wild Pokémon away for a long time." },
	"Poké Doll": { price: 1000, description: "A doll that can be used to distract a wild Pokémon so you can escape." },
	"Mail": { price: 50, description: "Stationery a Pokémon can hold so a message can be carried and read later." },
};

/** What each preset sells. A string is an item name; { tm: "Ice Beam" } is the TM that teaches that move. */
export const SHOP_PRESETS = [
	{ id: "viridian", name: "Viridian City Poké Mart", items: ["Pokéball", "Potion", "Antidote", "Paralyze Heal"] },
	{ id: "pewter", name: "Pewter City Poké Mart", items: ["Pokéball", "Potion", "Escape Rope", "Antidote", "Burn Heal", "Awakening"] },
	{ id: "cerulean", name: "Cerulean City Poké Mart", items: ["Pokéball", "Potion", "Repel", "Antidote", "Burn Heal", "Awakening", "Paralyze Heal"] },
	{ id: "vermilion", name: "Vermilion City Poké Mart", items: ["Pokéball", "Super Potion", "Potion", "Repel", "Awakening", "Paralyze Heal", "Revive"] },
	{ id: "lavender", name: "Lavender Town Poké Mart", items: ["Great Ball", "Super Potion", "Potion", "Revive", "Escape Rope", "Super Repel", "Antidote", "Paralyze Heal"] },
	{ id: "celadon-counter", name: "Celadon City Poké Mart (general counter)", items: ["Pokéball", "Great Ball", "Potion", "Super Potion", "Antidote", "Burn Heal", "Ice Heal", "Awakening", "Paralyze Heal", "Escape Rope", "Repel", "Revive"] },
	{ id: "fuchsia", name: "Fuchsia City Poké Mart", items: ["Ultra Ball", "Great Ball", "Super Potion", "Potion", "Revive", "Full Heal", "Max Repel"] },
	{ id: "cinnabar", name: "Cinnabar Island Poké Mart", items: ["Ultra Ball", "Great Ball", "Hyper Potion", "Max Potion", "Revive", "Full Heal", "Max Repel"] },
	{ id: "celadon-2f", name: "Celadon Dept. Store: 2F Trainers' Market", items: ["Great Ball", "Super Potion", "Revive", "Antidote", "Paralyze Heal", "Repel", "Super Repel", { tm: "Ice Beam" }, { tm: "Rock Slide" }] },
	{ id: "celadon-3f", name: "Celadon Dept. Store: 3F Battle Items", items: ["X Speed", "X Special Attack", "X Attack", "X Defense"] },
	{ id: "celadon-4f", name: "Celadon Dept. Store: 4F Wise Man Gifts", items: ["Fire Stone", "Water Stone", "Thunder Stone", "Leaf Stone", "Poké Doll", "Mail"] },
	{ id: "celadon-5f", name: "Celadon Dept. Store: 5F Drugstore", items: ["HP Up", "Protein", "Iron", "Carbos", "Calcium"] },
	{ id: "celadon-roof", name: "Celadon Dept. Store: Rooftop Vending Machines", items: ["Fresh Water", "Soda Pop", "Lemonade"] },
];

/** Not a Kanto shop: a random general store and an empty one to fill in yourself. */
export const SPECIAL_PRESETS = [
	{ id: "random", name: "Random Poké Mart" },
	{ id: "custom", name: "Custom shop (start empty)" },
];

const ALIASES = { "poke ball": "Pokéball", "pokeball": "Pokéball", "poké ball": "Pokéball", "psn heal": "Antidote", "paralyz heal": "Paralyze Heal", "parlyz heal": "Paralyze Heal", "x special": "X Special Attack", "x defend": "X Defense" };

/** Builds lookups over the compendium index: by normalized name, and TMs by the move they teach. */
export function buildItemLookup(items) {
	const byName = new Map();
	const byTm = new Map();
	for (const item of items) {
		const key = normalize(item.name);
		if (!byName.has(key)) byName.set(key, item);
		const tm = item.name.match(/^\d+\s*-\s*(.+)$/);
		if (tm && !byTm.has(normalize(tm[1]))) byTm.set(normalize(tm[1]), item);
	}
	return { byName, byTm };
}

/** Turns a compendium item into a shop row. */
export function rowFromItem(item, category = "") {
	return {
		id: item.id, name: item.name, img: item.img, type: item.type, rarity: item.rarity ?? "",
		base: Number(item.price?.value) || 0, denomination: item.price?.denomination ?? "gp",
		priceOverride: null, qty: 0, category, custom: false,
	};
}

export function rowFromCustom(name) {
	const def = CUSTOM_ITEMS[name];
	return {
		id: `custom:${normalize(name)}`, name, img: "icons/svg/item-bag.svg", type: "consumable", rarity: "common",
		base: def.price, denomination: "gp", priceOverride: null, qty: 0, category: "Custom item", custom: true, description: def.description,
	};
}

/** Resolves a preset's item list. Returns { rows, missing }: names that exist neither in the compendium nor as custom items are listed in `missing`. */
export function resolvePreset(preset, lookup) {
	const rows = [];
	const missing = [];
	const seen = new Set();
	const push = (row) => { if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); } };
	for (const entry of preset.items) {
		if (typeof entry === "object") {
			const item = lookup.byTm.get(normalize(entry.tm));
			if (item) push(rowFromItem(item, "TMs")); else missing.push(`TM: ${entry.tm}`);
			continue;
		}
		const name = ALIASES[entry.toLowerCase()] ?? entry;
		const item = lookup.byName.get(normalize(name));
		if (item) push(rowFromItem(item));
		else if (CUSTOM_ITEMS[name]) push(rowFromCustom(name));
		else missing.push(entry);
	}
	return { rows, missing };
}

/* ------------------------------------------------------------------ prices and money */

export const DENOMINATION_IN_GP = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };

/** Price shown in the shop: the compendium price scaled by the shop's price adjustment (percent), unless edited by hand. */
export function effectivePrice(row, percent = 100) {
	if (row.priceOverride != null) return row.priceOverride;
	return Math.max(0, Math.round(row.base * percent / 100));
}

/** Total cost in gold of everything in the cart (rows with a quantity above 0). */
export function cartTotal(rows, percent = 100) {
	return rows.reduce((sum, r) => sum + (r.qty > 0 ? effectivePrice(r, percent) * r.qty * (DENOMINATION_IN_GP[r.denomination] ?? 1) : 0), 0);
}

/* ------------------------------------------------------------------ saved shops */

/** What is stored for a shop row: just enough to rebuild it (prices are re-read from the compendium unless you edited them). */
export function serializeRow(row) {
	const saved = { id: row.id, name: row.name, priceOverride: row.priceOverride ?? null };
	if (row.custom) Object.assign(saved, { custom: true, base: row.base, description: row.description, img: row.img, denomination: row.denomination });
	return saved;
}

/** Rebuilds a row from a saved one. Compendium items are looked up by id, then by name. Returns null if it can't be found. */
export function rowFromSaved(saved, lookup, itemsById) {
	let row = null;
	if (saved.custom) {
		const def = CUSTOM_ITEMS[saved.name];
		row = { ...rowFromCustom(def ? saved.name : "Mail"), id: saved.id, name: saved.name, base: saved.base ?? def?.price ?? 0, description: saved.description ?? def?.description ?? "", img: saved.img ?? "icons/svg/item-bag.svg", denomination: saved.denomination ?? "gp" };
	} else {
		const item = itemsById.get(saved.id) ?? lookup.byName.get(normalize(saved.name));
		if (item) row = rowFromItem(item);
	}
	if (row) row.priceOverride = saved.priceOverride ?? null;
	return row;
}

/** Adds rows from `incoming` that aren't already in `rows` (same id). Returns how many were added. */
export function mergeRows(rows, incoming) {
	const have = new Set(rows.map((r) => r.id));
	let added = 0;
	for (const row of incoming) if (!have.has(row.id)) { rows.push(row); have.add(row.id); added++; }
	return added;
}
