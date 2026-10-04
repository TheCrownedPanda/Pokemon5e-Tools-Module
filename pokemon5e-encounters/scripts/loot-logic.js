/**
 * Pure helpers for the loot generator (no Foundry globals), so they can be tested outside Foundry.
 *
 * Categories come straight from the folders of the Pokémon 5e "Items & Consumables" compendium.
 * Folders at the top level are "groups" (Medicine, Pokéballs, Berries, ...); a group's sub-folders
 * (Medicine > Vitamins, Evolutionary Items > Mega Stones, ...) can be switched on and off one by one.
 */

/** Groups that come up more often than the others when several are switched on. */
export const PRIMARY_GROUPS = ["medicine", "pokeballs"];
export const PRIMARY_WEIGHT = 3;
/** How much more likely an item is when it suits the chosen environment. */
export const ENVIRONMENT_BOOST = 3;

export const RARITIES = [
	{ value: "common", label: "Common", rank: 0 },
	{ value: "uncommon", label: "Uncommon", rank: 1 },
	{ value: "rare", label: "Rare", rank: 2 },
	{ value: "veryRare", label: "Very rare", rank: 3 },
	{ value: "legendary", label: "Legendary", rank: 4 },
];
const RARITY_RANK = { "": 0, common: 0, uncommon: 1, rare: 2, veryRare: 3, legendary: 4, artifact: 5 };
const RARITY_WEIGHT = { "": 8, common: 10, uncommon: 5, rare: 2.5, veryRare: 1, legendary: 0.2, artifact: 0.05 };
export const rarityRank = (rarity) => RARITY_RANK[rarity ?? ""] ?? 0;
export const rarityLabel = (rarity) => RARITIES.find((r) => r.value === (rarity || "common"))?.label ?? String(rarity);

/** Normalizes names so "Pokéballs" and "pokeballs" compare equal. */
export const normalize = (text) => String(text ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");

/* ------------------------------------------------------------------ environment */

/** What each environment (poke5e.app biome id) is "about". Items with a matching theme are more likely there. */
export const BIOME_THEMES = {
	forest: ["grass"], jungle: ["grass"], woodland: ["grass"],
	field: ["grass", "plains"], grassland: ["grass", "plains"],
	city: ["shop", "urban"], industrial: ["shop", "urban", "electric"],
	volcano: ["fire"], cave: ["rock", "dark"], mountain: ["rock", "plains"],
	desert: ["desert", "fire"], badland: ["desert", "rock"],
	pond: ["water"], lake: ["water"], river: ["water"], riverside: ["water", "grass"],
	beach: ["water", "desert"], ocean: ["water"], reef: ["water"],
	"polar-sea": ["water", "ice"], abyss: ["water", "dark"], swamp: ["water", "grass", "poison"],
	glacier: ["ice"], tundra: ["ice"], ruin: ["dark", "rock", "urban"],
};

const NAME_THEMES = [
	["water", /water|aqua|splash|dive|net ball|lure|prism scale|deep sea|damp rock|kelpsy|shell bell|shell|memory.*water|douse/i],
	["fire", /fire|firium|flame|burn|heat|charcoal|magmar|lava|blaze/i],
	["grass", /leaf|seed|grass|berry|herb|root|sweet|flower|sachet|whipped|miracle|silk|honey|nectar|tomato|clover|mulch|moss/i],
	["ice", /\bice\b|frost|never.?melt|icy|chill|glalitite|snow/i],
	["rock", /rock|hard stone|everstone|eternal stone|moon stone|oval stone|metal|soft sand|razor|protector|dragon scale|dragon fang|up-grade|thick club|iron|plate|stone edge|augurite/i],
	["electric", /thunder|electri|magnet|shock|zap|energy cell|up-grade|dubious/i],
	["dark", /dusk|dark|dread|reaper|spooky|black|shadow|ghost|spell tag|smoke|cracked pot|chipped pot|teacup|malicious|auspicious/i],
	["desert", /sun stone|sand|desert|heat rock/i],
	["plains", /dawn stone|sun stone|lucky|leftovers|quick/i],
	["urban", /shiny stone|oval stone|king'?s rock|up-grade|dubious|exp share|escape|repel/i],
];
/** Groups / sub-folders that are generally found in shops and towns. */
const SHOP_FOLDERS = ["medicine", "pokeballs", "battleitems", "trainergear", "tms", "miscellaneous", "medicines", "vitamins", "candy", "food", "kits", "tools", "packs", "mundaneitems", "equipment"];
const GRASS_FOLDERS = ["berries", "herbs", "food"];

export function itemThemes(name, groupName = "", categoryLabel = "") {
	const themes = new Set();
	for (const [theme, pattern] of NAME_THEMES) if (pattern.test(name)) themes.add(theme);
	const g = normalize(groupName), c = normalize(categoryLabel);
	if (SHOP_FOLDERS.includes(g) || SHOP_FOLDERS.includes(c)) themes.add("shop");
	if (GRASS_FOLDERS.includes(g) || GRASS_FOLDERS.includes(c)) themes.add("grass");
	return themes;
}

export function environmentMatch(biome, themes) {
	const wanted = BIOME_THEMES[biome];
	return !!wanted && wanted.some((t) => themes.has(t));
}

/* ------------------------------------------------------------------ categories */

/**
 * folders: [{ id, name, parent }] (parent = folder id or null)
 * items:   [{ id, name, img, type, folder, rarity, price: { value, denomination } }]
 * Returns { groups: [{ key, name, primary, categories: [{ key, label, count }] }], itemsByCategory: Map, categoryMeta: Map }
 */
export function buildCategories(folders, items) {
	const byId = new Map(folders.map((f) => [f.id, f]));
	const topOf = (id) => { let f = byId.get(id); while (f?.parent && byId.has(f.parent)) f = byId.get(f.parent); return f; };
	const itemsByCategory = new Map();
	const categoryMeta = new Map();
	for (const item of items) {
		if (item.type === "container") continue; // packs with contents don't make sense as random loot
		const folder = byId.get(item.folder);
		const top = folder ? topOf(folder.id) : null;
		const key = folder ? folder.id : "none";
		if (!itemsByCategory.has(key)) {
			itemsByCategory.set(key, []);
			categoryMeta.set(key, { key, folder, group: top?.name ?? "Other", groupKey: top?.id ?? "none", label: folder && top && folder.id !== top.id ? folder.name : null });
		}
		itemsByCategory.get(key).push(item);
	}
	const groupMap = new Map();
	for (const meta of categoryMeta.values()) {
		if (!groupMap.has(meta.groupKey)) groupMap.set(meta.groupKey, { key: meta.groupKey, name: meta.group, primary: PRIMARY_GROUPS.includes(normalize(meta.group)), categories: [] });
		groupMap.get(meta.groupKey).categories.push(meta);
	}
	const groups = [...groupMap.values()].sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
	for (const group of groups) {
		const hasSubfolders = group.categories.some((c) => c.label);
		group.categories = group.categories
			.map((c) => ({ key: c.key, label: c.label ?? (hasSubfolders ? "General" : group.name), count: itemsByCategory.get(c.key).length }))
			.sort((a, b) => (a.label === "General" ? -1 : b.label === "General" ? 1 : a.label.localeCompare(b.label)));
		for (const c of group.categories) categoryMeta.get(c.key).label = c.label;
	}
	return { groups, itemsByCategory, categoryMeta };
}

/** Medicine and Pokéballs are on by default; everything else is opt-in. */
export function defaultEnabled(groups) {
	const enabled = new Set();
	for (const g of groups) if (g.primary) for (const c of g.categories) enabled.add(c.key);
	return enabled;
}

/* ------------------------------------------------------------------ rolling */

function pickWeighted(list, weightOf, random) {
	const weights = list.map(weightOf);
	let roll = random() * weights.reduce((a, b) => a + b, 0);
	for (let i = 0; i < list.length; i++) { roll -= weights[i]; if (roll < 0) return i; }
	return list.length - 1;
}

/** Cheap everyday items can come in small stacks. */
export function rollQuantity(item, random = Math.random) {
	const cheap = (item.rarity === "" || item.rarity === "common" || item.rarity == null) && (item.price?.value ?? 0) <= 1000;
	if (!cheap) return 1;
	const r = random();
	return r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
}

/**
 * Rolls `count` items. Locked rows are kept (and count toward `count`).
 * Options: { categories (buildCategories result), enabled (Set of category keys), count, maxRarity, biome, stacks, locked, random }
 */
export function rollLoot({ categories, enabled, count, maxRarity = "rare", biome = "", stacks = true, locked = [], random = Math.random }) {
	const cap = rarityRank(maxRarity);
	const taken = new Set(locked.map((r) => r.id));
	const pools = new Map(); // groupName -> [{ item, weight }]
	for (const key of enabled) {
		const meta = categories.categoryMeta.get(key);
		for (const item of categories.itemsByCategory.get(key) ?? []) {
			if (taken.has(item.id) || rarityRank(item.rarity) > cap) continue;
			let weight = RARITY_WEIGHT[item.rarity ?? ""] ?? 1;
			if (environmentMatch(biome, itemThemes(item.name, meta.group, meta.label))) weight *= ENVIRONMENT_BOOST;
			if (!pools.has(meta.group)) pools.set(meta.group, []);
			pools.get(meta.group).push({ item, weight, category: meta.label === meta.group ? meta.group : `${meta.group} › ${meta.label}`, group: meta.group });
		}
	}
	const rolled = [];
	const need = Math.max(0, count - locked.length);
	while (rolled.length < need) {
		const groupNames = [...pools.keys()].filter((g) => pools.get(g).length);
		if (!groupNames.length) break;
		const gi = pickWeighted(groupNames, (g) => (PRIMARY_GROUPS.includes(normalize(g)) ? PRIMARY_WEIGHT : 1), random);
		const pool = pools.get(groupNames[gi]);
		const ii = pickWeighted(pool, (p) => p.weight, random);
		const [{ item, category, group }] = pool.splice(ii, 1);
		rolled.push({
			id: item.id, name: item.name, img: item.img, type: item.type, rarity: item.rarity ?? "",
			price: item.price?.value ?? 0, denomination: item.price?.denomination ?? "gp",
			category, group, quantity: stacks ? rollQuantity(item, random) : 1, locked: false,
		});
	}
	return [...locked, ...rolled];
}
