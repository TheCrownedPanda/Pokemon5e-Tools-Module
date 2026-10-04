/**
 * Pure helpers for the Pokédex (no Foundry globals), so they can be tested outside Foundry.
 *
 * A player's Pokédex is stored on their User as { seen: { [speciesId]: { shiny, at } }, caught: { ... } }.
 */

/** Rarity is derived from a species' SR (Species Rating). Adjust the bands here if you want a different feel. */
export const RARITY_BANDS = [
	{ max: 0.25, label: "very common" },
	{ max: 1, label: "common" },
	{ max: 3, label: "uncommon" },
	{ max: 6, label: "rare" },
	{ max: 9, label: "very rare" },
	{ max: 12, label: "extremely rare" },
	{ max: Infinity, label: "mythically rare" },
];

export const rarityOf = (sr) => RARITY_BANDS.find((band) => sr <= band.max).label;

const joinList = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** "Seen in Forest and Industrial habitats and considered common." */
export function seenLine(entry, biomeNames = {}) {
	const biomes = (entry.biomes ?? []).map((id) => biomeNames[id] ?? id);
	if (!biomes.length) return `Its natural habitat is unknown, but it is considered ${rarityOf(entry.sr)}.`;
	return `Seen in ${joinList(biomes)} habitats and considered ${rarityOf(entry.sr)}.`;
}

const normalize = (text) => text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9♂♀]+/g, "");

export function buildNameIndex(species) {
	const index = new Map();
	for (const s of species) {
		for (const name of [s.name, ...(s.a ?? [])]) if (!index.has(normalize(name))) index.set(normalize(name), s.id);
	}
	return index;
}

/** Finds a species from a token/actor name, ignoring suffixes like "(Lv 3)", "(2)" or a ✨. */
export function speciesIdFromName(index, name) {
	if (!name) return null;
	let current = name.trim();
	for (let i = 0; i < 4; i++) {
		const hit = index.get(normalize(current));
		if (hit) return hit;
		const stripped = current.replace(/\s*(?:\((?:lv\.?\s*)?\d+\)|✨)\s*$/i, "").trim();
		if (stripped === current) return null;
		current = stripped;
	}
	return null;
}

export const emptyDex = () => ({ seen: {}, caught: {} });

export function statusOf(dex, id) {
	if (dex?.caught?.[id]) return "caught";
	if (dex?.seen?.[id]) return "seen";
	return "unseen";
}

export function counts(dex) {
	const caught = Object.keys(dex?.caught ?? {});
	const seen = new Set([...Object.keys(dex?.seen ?? {}), ...caught]);
	return { seen: seen.size, caught: caught.length };
}

const MOD = (score) => { const m = Math.floor((score - 10) / 2); return m >= 0 ? `+${m}` : String(m); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SR_LABEL = { 0.125: "⅛", 0.25: "¼", 0.5: "½" };

/** Everything the "caught" view shows. `lookup` = { abilities, moves, biomes } from pokedex.json. */
export function fullInfo(entry, lookup) {
	const moveGroups = Object.entries(entry.mv ?? {}).map(([key, ids]) => ({
		label: { start: "Starting", tm: "TMs", egg: "Egg moves" }[key] ?? key.replace("level", "Level "),
		names: ids.map((id) => lookup.moves[id] ?? id),
	}));
	return {
		size: cap(entry.size ?? "varies"),
		sr: SR_LABEL[entry.sr] ?? String(entry.sr),
		minLevel: entry.minLevel,
		ac: entry.ac,
		hp: `${entry.hp} (${entry.hd})`,
		speeds: (entry.spd ?? []).map((s) => `${cap(s.type)} ${s.value} ft.`).join(", ") || "None",
		scores: Object.entries(entry.attr ?? {}).map(([k, v]) => ({ key: k.toUpperCase(), value: v, mod: MOD(v) })),
		skills: (entry.skills ?? []).map(cap).join(", ") || "None",
		saves: (entry.saves ?? []).map((s) => s.toUpperCase()).join(", ") || "None",
		senses: (entry.senses ?? []).map((s) => `${cap(s.type)} ${s.value} ft.`).join(", ") || "None",
		abilities: (entry.ab ?? []).map((a) => ({
			name: lookup.abilities[a.id]?.n ?? a.id,
			description: lookup.abilities[a.id]?.d ?? "",
			hidden: a.h,
		})),
		moveGroups,
		eggGroups: (entry.egg ?? []).map(cap).join(", ") || "None",
		gender: entry.gender ? `${entry.gender} (female : male)` : "Unknown",
		native: entry.native ?? "Unknown",
		regions: (entry.regions ?? []).join(", ") || "Unknown",
		evolvesFrom: entry.evFrom ?? [],
		evolvesInto: entry.evTo ?? [],
	};
}
