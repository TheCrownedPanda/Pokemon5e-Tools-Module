/**
 * Level scaling for Pokémon actors, mirroring what poke5e.app does when it turns an encounter
 * into trainers: HP grows with level, and the moveset is a random pick of up to 4 moves the
 * species can know at that level. Also picks a random ability.
 * (poke5e.app: DynamicLeveler.adjustStats, MovesetGenerator.chooseMoves, abilities.chooseRandom.)
 */

const MODULE_ID = "pokemon5e-encounters";
const MOVE_COUNT = 4;
const UUID_LINK = /@UUID\[([^\]]+)\]\{([^}]*)\}/g;

/** Moves listed in the biography as "Starting: ..." and "Level N: ...". TMs and Egg moves are ignored. */
export function parseMoves(bio = "") {
	const moves = [];
	const section = /(Starting|Level\s+(\d+)):\s*((?:@UUID\[[^\]]+\]\{[^}]*\}[\s,.]*)+)/g;
	for (const match of bio.matchAll(section)) {
		const level = match[1] === "Starting" ? 0 : Number(match[2]);
		for (const link of match[3].matchAll(UUID_LINK)) moves.push({ level, uuid: link[1], name: link[2] });
	}
	return moves;
}

/** Abilities listed after "Possible Ability:" in the biography. */
export function parseAbilities(bio = "") {
	const match = bio.match(/Possible Abilit(?:y|ies):(?:<\/[^>]+>)?\s*((?:@UUID\[[^\]]+\]\{[^}]*\}[\s,.]*)+)/);
	if (!match) return [];
	return [...match[1].matchAll(UUID_LINK)].map((m) => ({
		uuid: m[1],
		name: m[2].replace(/\s*\(hidden\)/i, "").trim(),
		hidden: /\(hidden\)/i.test(m[2]),
	}));
}

function shuffle(list, random = Math.random) {
	for (let i = list.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[list[i], list[j]] = [list[j], list[i]];
	}
	return list;
}

/** Picks the moves a Pokémon of `level` would have: all of them if 4 or fewer, otherwise a random 4. */
export function chooseMoves(bio, level, random = Math.random) {
	const seen = new Set();
	const available = parseMoves(bio).filter((m) => m.level <= level && !seen.has(m.name) && seen.add(m.name));
	return available.length <= MOVE_COUNT ? available : shuffle(available, random).slice(0, MOVE_COUNT);
}

const isMove = (item) => item.type === "weapon" && item.system?.type?.value === "pokemon" && item.name !== "Struggle";

async function itemDataFromUuid(uuid) {
	const doc = await fromUuid(uuid);
	if (!doc) return null;
	const data = doc.toObject();
	delete data._id;
	return data;
}

/**
 * Brings `actor` (normally an unlinked token's synthetic actor) up to `targetLevel`.
 * Never goes below the level the compendium actor already has.
 */
export async function scaleActorToLevel(actor, targetLevel) {
	const cls = actor.itemTypes?.class?.[0];
	if (!cls) { console.warn(`${MODULE_ID} | ${actor.name} has no class item; skipping level scaling.`); return null; }

	const level = Math.min(20, Math.max(targetLevel, cls.system.levels ?? 1));

	// 1. Level + hit points: every extra level uses the average hit die roll, as poke5e.app does.
	// Depending on the D&D 5e version, the class's advancement is stored as a list or as an object keyed by id.
	const rawAdvancement = cls.toObject().system.advancement;
	const isList = Array.isArray(rawAdvancement);
	const entries = isList ? rawAdvancement.map((a, i) => [i, a]) : Object.entries(rawAdvancement ?? {});
	const hpEntry = entries.find(([, a]) => a?.type === "HitPoints");
	const update = { "system.levels": level };
	if (hpEntry) {
		const [key, hp] = hpEntry;
		const value = { ...(hp.value ?? {}) };
		for (let i = 1; i <= level; i++) value[i] ??= (i === 1 ? "max" : "avg");
		if (isList) {
			const copy = foundry.utils.deepClone(rawAdvancement);
			copy[key].value = value;
			update["system.advancement"] = copy;
		} else {
			update[`system.advancement.${key}.value`] = value;
		}
	} else {
		console.warn(`${MODULE_ID} | ${actor.name} has no Hit Points advancement; HP will not grow with level.`);
	}
	await cls.update(update);

	// 2. Moves.
	const bio = actor.system.details?.biography?.public ?? "";
	const wanted = chooseMoves(bio, level);
	if (wanted.length) {
		const wantedNames = new Set(wanted.map((m) => m.name));
		const currentMoves = actor.items.filter(isMove);
		const toDelete = currentMoves.filter((i) => !wantedNames.has(i.name)).map((i) => i.id);
		const haveNames = new Set(currentMoves.map((i) => i.name));
		const toAdd = (await Promise.all(wanted.filter((m) => !haveNames.has(m.name)).map((m) => itemDataFromUuid(m.uuid)))).filter(Boolean);
		if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
		if (toAdd.length) await actor.createEmbeddedDocuments("Item", toAdd);
	}

	// 3. Ability: one random pick from the species' possible abilities (hidden ones only if nothing else).
	const abilities = parseAbilities(bio);
	if (abilities.length > 1) {
		const normal = abilities.filter((a) => !a.hidden);
		const pick = (normal.length ? normal : abilities)[Math.floor(Math.random() * (normal.length || abilities.length))];
		const otherNames = new Set(abilities.filter((a) => a.name !== pick.name).map((a) => a.name));
		const toDelete = actor.items.filter((i) => i.type === "feat" && otherNames.has(i.name)).map((i) => i.id);
		const alreadyHas = actor.items.some((i) => i.type === "feat" && i.name === pick.name);
		if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
		if (!alreadyHas) {
			const data = await itemDataFromUuid(pick.uuid);
			if (data) await actor.createEmbeddedDocuments("Item", [data]);
		}
	}

	// 4. Full health at the new maximum. (The Pokémon 5e module re-scales move damage and STAB by itself
	// whenever an actor or its items change, so nothing else is needed for that.)
	await actor.update({ "system.attributes.hp.value": actor.system.attributes.hp.max });

	const result = {
		name: actor.name,
		target: targetLevel,
		classLevel: actor.itemTypes.class[0]?.system.levels,
		level: actor.system.details?.level,
		hp: `${actor.system.attributes.hp.value}/${actor.system.attributes.hp.max}`,
		moves: actor.items.filter(isMove).map((i) => i.name).join(", "),
		ability: abilities.length ? actor.items.filter((i) => i.type === "feat" && abilities.some((a) => a.name === i.name)).map((i) => i.name).join(", ") : "",
	};
	console.log(`${MODULE_ID} | Scaled`, result);
	return result;
}
