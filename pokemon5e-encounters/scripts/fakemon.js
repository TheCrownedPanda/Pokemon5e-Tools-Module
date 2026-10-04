/**
 * Optional fakemon support (module setting "Include fakemon", off by default).
 *
 * Two kinds of fakemon can show up when the setting is on:
 *  1. poke5e's old "official" fakemon (Rookite, Eeveon, ...). They are listed in the data files with `fk: true`
 *     but have no actor in the Pokémon 5e bestiary, so their actors are built here from poke5e's stat blocks.
 *  2. Custom fakemon: any actor in the bestiary compendium that is not one of the official species. They are
 *     read straight from the actor (`custom: true`).
 */
import { parseMoves, parseAbilities, chooseMoves } from "./scaling.js";

const MODULE_ID = "pokemon5e-encounters";
const BESTIARY_PACK = "pokemon5e.pokedex_bestiary";
const MOVES_PACK = "pokemon5e.pokemon_moves";
const FEATURES_PACK = "pokemon5e.pokemon_features";
const PACK_UUID = (pack, id) => `Compendium.${pack}.Item.${id}`;
const TYPES = ["bug", "dark", "dragon", "electric", "fairy", "fighting", "fire", "flying", "ghost", "grass", "ground", "ice", "normal", "poison", "psychic", "rock", "steel", "water"];
const norm = (s) => String(s ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const SIZE_TO_DND = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };
const SIZE_TO_TOKEN = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
const SKILL_KEYS = {
	acrobatics: "acr", "animal-handling": "ani", arcana: "arc", athletics: "ath", deception: "dec", history: "his", insight: "ins",
	intimidation: "itm", investigation: "inv", medicine: "med", nature: "nat", perception: "prc", performance: "prf", persuasion: "per",
	religion: "rel", "sleight-of-hand": "slt", stealth: "ste", survival: "sur",
};
const MOVEMENT_KEYS = { walking: "walk", flying: "fly", swimming: "swim", climbing: "climb", burrowing: "burrow" };
const SENSE_KEYS = { darkvision: "darkvision", blindsight: "blindsight", tremorsense: "tremorsense", truesight: "truesight" };

export const fakemonEnabled = () => {
	try { return !!game.settings.get(MODULE_ID, "includeFakemon"); } catch { return false; }
};

/** Local paths ("modules/...") and full URLs are used as they are; paths starting with "/" live on poke5e.app. */
export const artUrl = (base, path) => (!path ? "" : /^(https?:)?\/\//.test(path) || !path.startsWith("/") ? path : `${base}${path}`);

/* ------------------------------------------------------------------ custom fakemon (read from bestiary actors) */

const stripHtml = (html = "") => html.replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "$1").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();

function bioFields(bio) {
	const fields = {};
	for (const m of bio.matchAll(/<li><strong[^>]*>([^<:]+):\s*<\/strong>\s*(.*?)<\/li>/gs)) fields[m[1].trim().toLowerCase()] = stripHtml(m[2]).replace(/\.$/, "").trim();
	return fields;
}

/** Builds a Pokédex-style species entry from a bestiary actor. Returns null if the actor can't be read. */
export function speciesFromActor(actor) {
	const sys = actor.system ?? {};
	const bio = sys.details?.biography?.public ?? "";
	const f = bioFields(bio);
	const sizeText = (f.size ?? "medium").toLowerCase();
	const size = Object.keys(SIZE_TO_DND).find((k) => sizeText.startsWith(k)) ?? "medium";
	const types = (f.type ?? "").toLowerCase().split(/,|\band\b|\//).map((t) => t.replace(/\btype\b/g, "").replace(/[^a-z]/g, "")).filter((t) => TYPES.includes(t));
	const hpMatch = (f["initial hit points"] ?? "").match(/(\d+)\s*\((d\d+)\)/);
	const movement = sys.attributes?.movement ?? {};
	const spd = Object.entries(MOVEMENT_KEYS).filter(([, key]) => Number(movement[key]) > 0).map(([type, key]) => ({ type, value: Number(movement[key]) }));
	const attr = Object.fromEntries(ABILITY_KEYS.map((k) => [k, Number(sys.abilities?.[k]?.value) || 10]));
	const mv = {};
	for (const m of parseMoves(bio)) (mv[m.level === 0 ? "start" : `level${m.level}`] ??= []).push(m.name);
	const listOf = (text) => (text && !/^none$/i.test(text) ? text.split(/,|\band\b/).map((x) => x.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean) : []);
	const slug = norm(actor.name);
	const number = Number((f["pokédex number"] ?? f["pokedex number"] ?? "").replace(/\D/g, "")) || 0;
	const sr = Number(sys.details?.cr);
	return {
		id: `custom-${slug}`,
		n: 0,
		dexNumber: number,
		custom: true,
		name: actor.name,
		a: [actor.name],
		t: types,
		size,
		sr: Number.isFinite(sr) ? sr : 0.25,
		minLevel: parseInt(f["min level"], 10) || 1,
		egg: listOf(f["egg group"]),
		gender: (f["gender ratio"] ?? "").match(/\d+:\d+/)?.[0] ?? "",
		desc: stripHtml(bio.match(/<em>(.*?)<\/em>/s)?.[1] ?? ""),
		ac: Number(sys.attributes?.ac?.flat) || Number((f["natural armor class"] ?? "").match(/\d+/)?.[0]) || 10,
		hp: hpMatch ? Number(hpMatch[1]) : Number(sys.attributes?.hp?.value) || 1,
		hd: hpMatch?.[2] ?? sys.attributes?.hp?.formula ?? "d6",
		spd: spd.length ? spd : [{ type: "walking", value: 30 }],
		attr,
		skills: listOf(f["skills proficiencies"]),
		saves: listOf(f["saving throws proficiencies"]).map((s) => s.slice(0, 3)),
		senses: [],
		ab: parseAbilities(bio).map((a) => ({ id: a.name, h: a.hidden })),
		mv,
		evTo: [], evFrom: [],
		biomes: [], native: "", regions: [],
		img: { main: actor.img ?? "" },
	};
}

/** Species-list shape used by the encounter generator. */
export const toEncounterSpecies = (s) => ({
	id: s.id, name: s.name, actors: [s.name], type: s.t, sr: s.sr, minLevel: s.minLevel,
	biomes: [], native: "", regions: [], shiny: null, custom: true,
});

/** Bestiary actors that are not one of the known (official) species. `knownNames` = every official actor name. */
export async function scanCustomSpecies(knownNames) {
	const pack = game.packs.get(BESTIARY_PACK);
	if (!pack) return [];
	const index = await pack.getIndex();
	const unknown = index.filter((e) => !knownNames.has(e.name));
	const found = [];
	const usedIds = new Set();
	for (const entry of unknown) {
		try {
			const actor = await pack.getDocument(entry._id);
			const species = actor && speciesFromActor(actor);
			if (!species) continue;
			while (usedIds.has(species.id)) species.id += "-2";
			usedIds.add(species.id);
			found.push(species);
		} catch (err) {
			console.warn(`${MODULE_ID} | Could not read custom fakemon "${entry.name}"`, err);
		}
	}
	if (found.length) console.log(`${MODULE_ID} | Found ${found.length} custom fakemon in the bestiary:`, found.map((s) => s.name).join(", "));
	return found;
}

/* ------------------------------------------------------------------ poke5e fakemon (actors built from stat blocks) */

let sheetsPromise = null;
/** poke5e's fakemon stat blocks plus the move/ability name tables, from the Pokédex data file. */
export const loadFakemonSheets = () => (sheetsPromise ??= fetch(foundry.utils.getRoute(`modules/${MODULE_ID}/data/pokedex.json`))
	.then((r) => r.json())
	.then((d) => ({ baseUrl: d.baseUrl, moves: d.moves, abilities: d.abilities, byId: new Map(d.species.filter((s) => s.fk).map((s) => [s.id, s])) }))
	.catch((err) => { sheetsPromise = null; throw err; }));

const docCache = new Map();
async function packItem(pack, id) {
	const key = `${pack.collection}.${id}`;
	if (!docCache.has(key)) {
		const doc = await pack.getDocument(id);
		const data = doc.toObject();
		delete data._id;
		docCache.set(key, data);
	}
	return foundry.utils.deepClone(docCache.get(key));
}

function setHitPointLevels(cls, levels) {
	cls.system.levels = levels;
	const adv = cls.system.advancement;
	const entries = Array.isArray(adv) ? adv : Object.values(adv ?? {});
	const hp = entries.find((a) => a?.type === "HitPoints");
	if (!hp) return;
	const value = {};
	for (let i = 1; i <= levels; i++) value[i] = i === 1 ? "max" : "avg";
	hp.value = value;
}

export function biographyHtml(sheet, lookup, links) {
	const li = (label, text) => `<li><strong style="color:#a98701">${label}:</strong> ${text}.</li>`;
	const link = (l) => `@UUID[${l.uuid}]{${l.name}}`;
	const moveLine = (label, list) => (list.length ? `<li><p>${label}: ${list.map(link).join(", ")}.</p></li>` : "");
	const levels = Object.keys(sheet.mv).filter((k) => k.startsWith("level")).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
	const score = (k) => sheet.attr[k];
	const mod = (v) => { const m = Math.floor((v - 10) / 2); return m >= 0 ? `+${m}` : `${m}`; };
	return `<div><h1 style="color:#fed841;text-align:center">Pokémon Species Information</h1><ul>${li("Species", sheet.name)}${li("Pokédex Number", "None (fakemon)")}</ul>`
		+ `<p style="text-align:center"><em>${sheet.desc}</em></p><ul>${li("Size", cap(sheet.size))}${li("Egg Group", (sheet.egg ?? []).map(cap).join(", ") || "None")}`
		+ `${li("Gender Ratio", sheet.gender || "Unknown")}${li("Type", links.types.map(link).join(", "))}</ul><br /><h2 style="color:#fed841">Stats Data</h2>`
		+ `<ul><li><strong style="color:#a98701">Ability Scores:</strong></li></ul><table style="text-align:center"><tbody><tr>${ABILITY_KEYS.map((k) => `<th>${k.toUpperCase()}</th>`).join("")}</tr>`
		+ `<tr>${ABILITY_KEYS.map((k) => `<td>${mod(score(k))}</td>`).join("")}</tr><tr>${ABILITY_KEYS.map((k) => `<td>${score(k)}</td>`).join("")}</tr></tbody></table>`
		+ `<ul>${li("Min Level", sheet.minLevel)}${li("Species Rating (SR)", sheet.sr)}${li("Natural Armor Class", sheet.ac)}${li("Initial Hit Points", `${sheet.hp} (${sheet.hd})`)}`
		+ `${li("Speeds", sheet.spd.map((s) => `${s.value}ft ${cap(s.type)}`).join(", "))}${li("Saving Throws Proficiencies", sheet.saves.map((s) => s.toUpperCase()).join(", ") || "None")}`
		+ `${li("Skills Proficiencies", sheet.skills.map((s) => cap(s.replace(/-/g, " "))).join(", ") || "None")}`
		+ `${li("Possible Ability", links.abilities.map((a) => link({ ...a, name: a.hidden ? `${a.name} (hidden)` : a.name })).join(", "))}</ul><br />`
		+ `<h2 style="color:#fed841">Leveling Data</h2><p><strong style="color:#a98701">Moves:</strong></p><ul>`
		+ `${moveLine("Starting", links.moves.start ?? [])}${levels.map((k) => moveLine(`Level ${k.slice(5)}`, links.moves[k] ?? [])).join("")}</ul></div>`;
}

/**
 * Builds the actor data for one of poke5e's fakemon (never saved by itself; the caller creates the actor).
 * Uses a bestiary actor as a structural template and replaces its stats, type, moves and ability.
 */
export async function buildFakemonActorData(speciesId) {
	const sheets = await loadFakemonSheets();
	const sheet = sheets.byId.get(speciesId);
	if (!sheet) throw new Error(`No stat block for "${speciesId}".`);
	const bestiary = game.packs.get(BESTIARY_PACK);
	const movesPack = game.packs.get(MOVES_PACK);
	const featuresPack = game.packs.get(FEATURES_PACK);
	if (!bestiary || !movesPack || !featuresPack) throw new Error("The Pokémon 5e compendiums (bestiary, moves, features) are required.");
	const [bestiaryIndex, movesIndex, featuresIndex] = await Promise.all([bestiary.getIndex(), movesPack.getIndex(), featuresPack.getIndex()]);
	const moveByName = new Map(movesIndex.map((e) => [norm(e.name), e]));
	const featureByName = new Map(featuresIndex.map((e) => [norm(e.name), e]));

	const templateEntry = ["Shinx", "Eevee", "Rattata", "Pidgey"].map((n) => bestiaryIndex.find((e) => e.name === n)).find(Boolean) ?? bestiaryIndex.contents[0];
	const template = (await bestiary.getDocument(templateEntry._id)).toObject();
	for (const key of ["_id", "_stats", "sort"]) delete template[key];
	const struggle = template.items.find((i) => i.name === "Struggle");
	const classItem = template.items.find((i) => i.type === "class");
	if (!classItem) throw new Error("The template actor has no class item.");

	// Links used by the biography, and the items to give the actor.
	const moveName = (id) => sheets.moves[id] ?? id;
	const abilityName = (id) => sheets.abilities[id]?.n ?? id;
	const links = { types: [], abilities: [], moves: {} };
	const items = [];
	if (struggle) { const s = foundry.utils.deepClone(struggle); delete s._id; items.push(s); }

	for (const type of sheet.t) {
		const entry = featureByName.get(norm(`${cap(type)} Type`));
		if (!entry) { console.warn(`${MODULE_ID} | No "${cap(type)} Type" feature found for ${sheet.name}.`); continue; }
		links.types.push({ uuid: PACK_UUID(FEATURES_PACK, entry._id), name: cap(type) });
		items.push(await packItem(featuresPack, entry._id));
	}
	for (const ab of sheet.ab) {
		const name = abilityName(ab.id);
		const entry = featureByName.get(norm(name));
		if (!entry) { console.warn(`${MODULE_ID} | Ability "${name}" not found for ${sheet.name}.`); continue; }
		links.abilities.push({ uuid: PACK_UUID(FEATURES_PACK, entry._id), name, hidden: ab.h });
	}
	for (const [key, ids] of Object.entries(sheet.mv)) {
		if (key === "tm") continue;
		for (const id of ids) {
			const entry = moveByName.get(norm(moveName(id)));
			if (!entry) { console.warn(`${MODULE_ID} | Move "${moveName(id)}" not found for ${sheet.name}.`); continue; }
			(links.moves[key] ??= []).push({ uuid: PACK_UUID(MOVES_PACK, entry._id), name: entry.name });
		}
	}
	const bio = biographyHtml(sheet, sheets, links);

	// Starting moves for its minimum level and its first possible ability (level scaling reshuffles them later).
	for (const move of chooseMoves(bio, sheet.minLevel)) items.push(await packItem(movesPack, move.uuid.split(".").pop()));
	const firstAbility = links.abilities.find((a) => !a.hidden) ?? links.abilities[0];
	if (firstAbility) items.push(await packItem(featuresPack, firstAbility.uuid.split(".").pop()));

	const cls = foundry.utils.deepClone(classItem);
	delete cls._id;
	cls.name = `${sheet.name} Level`;
	cls.system.hd.denomination = sheet.hd;
	setHitPointLevels(cls, sheet.minLevel);
	items.push(cls);

	// Stats.
	const sys = template.system;
	for (const k of ABILITY_KEYS) {
		sys.abilities[k].value = sheet.attr[k];
		sys.abilities[k].proficient = sheet.saves.includes(k) ? 1 : 0;
	}
	for (const key of Object.keys(sys.skills)) sys.skills[key].value = 0;
	for (const skill of sheet.skills) if (SKILL_KEYS[skill]) sys.skills[SKILL_KEYS[skill]].value = 1;
	sys.attributes.ac = { ...sys.attributes.ac, flat: sheet.ac, calc: "natural" };
	sys.attributes.hp = { ...sys.attributes.hp, formula: sheet.hd, value: sheet.hp, max: null };
	for (const key of Object.values(MOVEMENT_KEYS)) sys.attributes.movement[key] = null;
	for (const s of sheet.spd) if (MOVEMENT_KEYS[s.type]) sys.attributes.movement[MOVEMENT_KEYS[s.type]] = s.value;
	for (const key of Object.values(SENSE_KEYS)) sys.attributes.senses[key] = null;
	for (const s of sheet.senses ?? []) if (SENSE_KEYS[s.type]) sys.attributes.senses[SENSE_KEYS[s.type]] = s.value;
	sys.details.cr = sheet.sr;
	sys.details.biography.public = bio;
	sys.traits.size = SIZE_TO_DND[sheet.size] ?? "med";

	const art = artUrl(sheets.baseUrl, sheet.img.main);
	template.name = sheet.name;
	template.img = art;
	template.items = items;
	template.flags = { [MODULE_ID]: { fakemon: true } };
	template.prototypeToken = foundry.utils.mergeObject(template.prototypeToken ?? {}, {
		name: sheet.name, width: SIZE_TO_TOKEN[sheet.size] ?? 1, height: SIZE_TO_TOKEN[sheet.size] ?? 1, texture: { src: art },
	});
	return template;
}
