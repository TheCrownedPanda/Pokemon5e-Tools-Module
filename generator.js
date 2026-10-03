/**
 * Encounter generation logic.
 *
 * Ported from Auroratide/poke5e (https://github.com/Auroratide/poke5e), which is
 * licensed under the ISC License, Copyright (c) 2021 Timothy Foster.
 * Pure functions only: no Foundry globals are used here.
 */

// XP awarded per (level, SR) in the 2018 edition. Rows = level 1..20, columns = SR 1/8 .. 15.
export const EXPERIENCE_MATRIX_2018 = [
	[20, 40, 80, 160, 360, 560, 880, 1400, 1800, 2300, 3100, 3800, 4200, 5800, 6700, 8000, 9200, 10400],
	[40, 80, 160, 360, 560, 880, 1400, 1800, 2300, 3100, 3800, 4200, 5800, 6700, 8000, 9200, 10400, 10600],
	[80, 150, 340, 530, 840, 1400, 1700, 2200, 3000, 3800, 4200, 5800, 6700, 8000, 9200, 10400, 10600, 11000],
	[140, 320, 500, 790, 1300, 1700, 2100, 2800, 3600, 4200, 5800, 6700, 8000, 9200, 10400, 10600, 11000, 11300],
	[360, 560, 880, 1400, 1800, 2300, 3100, 4000, 4700, 5800, 6700, 8000, 9200, 10400, 10600, 11000, 11300, 12200],
	[530, 840, 1400, 1700, 2200, 3000, 3800, 4500, 5500, 6400, 7600, 8700, 9900, 10600, 11000, 11300, 12200, 13400],
	[820, 1300, 1700, 2200, 2900, 3700, 4400, 5400, 6200, 7400, 8600, 9700, 10400, 11000, 11300, 12200, 13400, 14200],
	[1300, 1700, 2100, 2800, 3600, 4300, 5200, 6100, 7300, 8400, 9500, 10200, 10700, 11300, 12200, 13400, 14200, 16800],
	[1600, 2000, 2700, 3500, 4200, 5100, 5900, 7000, 8100, 9200, 9900, 10400, 10900, 11600, 12600, 14200, 16800, 18400],
	[2300, 3100, 4000, 4700, 5800, 6700, 8000, 9200, 10400, 11200, 11800, 12400, 13200, 14400, 15600, 16800, 18400, 19200],
	[3000, 3800, 4500, 5500, 6500, 7700, 8800, 10000, 10800, 11300, 11900, 12700, 13800, 15000, 16100, 17700, 19200, 20300],
	[3800, 4400, 5400, 6300, 7500, 8600, 9800, 10500, 11100, 11700, 12400, 13500, 14700, 15800, 17300, 18800, 20300, 21700],
	[4300, 5300, 6200, 7400, 8500, 9600, 10300, 10900, 11400, 12100, 13200, 14400, 15500, 16900, 18400, 19900, 21700, 23000],
	[5200, 6000, 7200, 8300, 9400, 10100, 10600, 11200, 11900, 13000, 14000, 15100, 16600, 18000, 19400, 21200, 23000, 24600],
	[5900, 7000, 8100, 9200, 9900, 10400, 10900, 11600, 12700, 13700, 14800, 16200, 17600, 19000, 20800, 22500, 24600, 26800],
	[6900, 7900, 8900, 9600, 10100, 10700, 11400, 12400, 13400, 14400, 15800, 17200, 18600, 20300, 22000, 24100, 26100, 28200],
	[9200, 10400, 11200, 11800, 12400, 13200, 14400, 15600, 16800, 18400, 20000, 21600, 23600, 25600, 28000, 30400, 32800, 36000],
	[10000, 10800, 11300, 11900, 12700, 13800, 15000, 16100, 17700, 19200, 20700, 22700, 24600, 26900, 29200, 31500, 34600, 38400],
	[10500, 11100, 11700, 12400, 13500, 14700, 15800, 17300, 18800, 20300, 22200, 24100, 26300, 28600, 30800, 33800, 37600, 42300],
	[10900, 11400, 12100, 13200, 14400, 15500, 16900, 18400, 19900, 21700, 23600, 25800, 28000, 30200, 33100, 36800, 41400, 46000],
];

export const DIFFICULTY_MULTIPLIERS = { low: 1, moderate: 1.5, high: 2 };
export const ENCOUNTER_SIZE_LIMIT = 20;

const clampLevel = (level, minLevel = 1) => Math.min(20, Math.max(minLevel ?? 1, level));

export function experienceAwarded(level, sr, edition = "2024") {
	if (edition === "2018") {
		if (level == null || sr == null) return 0;
		const srIndex = sr < 1 ? Math.log2(sr) + 3 : sr + 2;
		return EXPERIENCE_MATRIX_2018[level - 1]?.[srIndex] ?? 0;
	}
	return 200 * level * sr;
}

/** XP budget for the party and chosen difficulty. `players` = [{ level, numberOfPokemon }] */
export function experienceBudget(players, difficulty) {
	const totalLevels = players.reduce((sum, p) => sum + p.level, 0);
	const extra = players.reduce((acc, p) => acc + (p.numberOfPokemon > 1 ? (p.numberOfPokemon - 1) * 0.1 : 0), 0);
	return Math.round(totalLevels * 50 * (1 + extra) * (DIFFICULTY_MULTIPLIERS[difficulty] ?? 1));
}

/** Labels how hard an encounter with `currentExp` is, relative to the budget picked on the form. */
export function encounterDifficulty(currentExp, budget, difficulty) {
	const ratio = budget > 0 ? (currentExp / budget) * (DIFFICULTY_MULTIPLIERS[difficulty] ?? 1) : 0;
	if (ratio < 0.9) return { label: "Trivial", color: "#9e9e9e" };
	if (ratio <= 1.15) return { label: "Low", color: "#4caf50" };
	if (ratio <= 1.5) return { label: "Moderate", color: "#ff9800" };
	if (ratio <= 2) return { label: "High", color: "#f44336" };
	return { label: "Deadly", color: "#7b1fa2" };
}

/** Filters the species list the same way the poke5e.app encounter tool does. */
export function filterPool(species, { biome = "", type = "", regionType = "native", regionName = "", minSr = null, maxSr = null } = {}) {
	const region = regionName.trim().toLowerCase();
	return species.filter((s) => {
		if (minSr != null && s.sr < minSr) return false;
		if (maxSr != null && s.sr > maxSr) return false;
		if (biome && !s.biomes.includes(biome)) return false;
		if (type && !s.type.includes(type)) return false;
		if (region) {
			if (regionType === "native") { if ((s.native ?? "").toLowerCase() !== region) return false; }
			else if (!s.regions.some((r) => r.toLowerCase() === region)) return false;
		}
		return true;
	});
}

/**
 * Rolls an encounter. Returns [{ species, level, count, exp }] where `exp` is XP for one Pokémon.
 * Same algorithm as poke5e.app: keep picking random species at random levels until the XP budget
 * (or the Pokémon limit) is used up.
 */
export function generateEncounter({ pool, targetExp, pokemonLimit = Infinity, maxLevel = 20, edition = "2024", random = Math.random, pinned = [] }) {
	const result = [];
	let currentExp = 0, currentCount = 0, attempts = 0;

	// Guaranteed Pokémon come first and use up part of the XP budget; the rest is rolled around them.
	// pinned = [{ species, level (number or null for "roll one"), count, shiny }]
	for (const pin of pinned) {
		const level = clampLevel(pin.level ?? Math.floor(random() * maxLevel) + 1, pin.species.minLevel);
		const exp = experienceAwarded(level, pin.species.sr, edition);
		const count = Math.max(1, pin.count ?? 1);
		result.push({ species: pin.species, level, count, exp, pinned: true, shiny: pin.shiny ? count : 0 });
		currentExp += (Number.isNaN(exp) ? 0 : exp) * count;
		currentCount += count;
	}
	const MAX_ATTEMPTS = 500;

	while (attempts < MAX_ATTEMPTS) {
		attempts++;
		if (currentCount >= pokemonLimit) break;
		const remaining = targetExp - currentExp;
		if (remaining <= 0) break;

		const choices = pool.map((species) => {
			const level = Math.max(species.minLevel, Math.floor(random() * maxLevel) + 1);
			return { species, level, exp: experienceAwarded(level, species.sr, edition) };
		}).filter((c) => c.exp <= remaining);
		if (choices.length === 0) break;

		let chosen;
		if (pokemonLimit < Infinity) {
			const perPokemon = remaining / (pokemonLimit - currentCount);
			choices.sort((a, b) => Math.abs(a.exp - perPokemon) - Math.abs(b.exp - perPokemon));
			const top = choices.slice(0, 3);
			chosen = top[Math.floor(random() * top.length)];
		} else {
			chosen = choices[Math.floor(random() * choices.length)];
		}

		currentExp += chosen.exp;
		currentCount += 1;
		const existing = result.find((r) => !r.pinned && r.species.id === chosen.species.id);
		if (existing) existing.count += 1;
		else result.push({ species: chosen.species, level: chosen.level, count: 1, exp: chosen.exp });
	}
	return result;
}

/** Species Rating values, used for the rarity filter. */
export const SR_VALUES = [0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
export const srLabel = (sr) => ({ 0.125: "⅛", 0.25: "¼", 0.5: "½" })[sr] ?? String(sr);

/** Strongest species first, then alphabetical. */
export function sortEncounter(encounter) {
	return encounter.sort((a, b) => b.species.sr - a.species.sr || a.species.name.localeCompare(b.species.name));
}

/** Each Pokémon independently has a 1-in-`odds` chance to be shiny (odds <= 0 turns shinies off). Sets `shiny` on every group. */
export function rollShinies(encounter, odds, random = Math.random) {
	for (const group of encounter) {
		if (group.pinned) continue; // guaranteed Pokémon keep exactly the shiny setting you chose
		group.shiny = 0;
		if (odds > 0) for (let i = 0; i < group.count; i++) if (random() * odds < 1) group.shiny++;
	}
	return encounter;
}

/** Turns one more random non-shiny Pokémon into a shiny. Returns false if they all already are. */
export function makeOneShiny(encounter, random = Math.random) {
	const candidates = encounter.flatMap((group) => Array(group.count - (group.shiny ?? 0)).fill(group));
	if (!candidates.length) return false;
	const group = candidates[Math.floor(random() * candidates.length)];
	group.shiny = (group.shiny ?? 0) + 1;
	return true;
}

export const totalShinies = (encounter) => encounter.reduce((sum, e) => sum + (e.shiny ?? 0), 0);

export function totalExperience(encounter) {
	return encounter.reduce((sum, e) => sum + (Number.isNaN(e.exp) ? 0 : e.exp) * e.count, 0);
}

export function totalCount(encounter) {
	return encounter.reduce((sum, e) => sum + e.count, 0);
}
