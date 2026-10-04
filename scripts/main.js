import { PokemonEncounterApp } from "./encounter-app.js";
import { PokedexApp, refreshPokedex, syncCaught } from "./pokedex-app.js";
import { PokemonLootApp } from "./loot-app.js";

export const MODULE_ID = "pokemon5e-encounters";

let app = null;
export async function openEncounterApp() {
	if (!game.user.isGM) return ui.notifications.warn("Only the GM can generate encounters.");
	try {
		console.log(`${MODULE_ID} | Opening the encounter generator`);
		if (!app || !app.rendered) app = new PokemonEncounterApp();
		await app.render({ force: true });
		return app;
	} catch (err) {
		console.error(`${MODULE_ID} | Could not open the encounter generator`, err);
		ui.notifications.error(`Pokémon Encounters could not open: ${err.message}`, { permanent: true });
	}
}

let pokedex = null;
export async function openPokedex() {
	try {
		if (!pokedex || !pokedex.rendered) pokedex = new PokedexApp();
		await pokedex.render({ force: true });
		return pokedex;
	} catch (err) {
		console.error(`${MODULE_ID} | Could not open the Pokédex`, err);
		ui.notifications.error(`The Pokédex could not open: ${err.message}`, { permanent: true });
	}
}

let lootApp = null;
export function openLootApp() {
	if (!game.user.isGM) return ui.notifications.warn("Only the GM can generate loot.");
	try {
		if (!lootApp || !lootApp.rendered) lootApp = new PokemonLootApp();
		lootApp.render({ force: true });
	} catch (err) {
		console.error(`${MODULE_ID} |`, err);
		ui.notifications.error(`Could not open the Loot Generator: ${err.message}`, { permanent: true });
	}
	return lootApp;
}

Hooks.once("init", () => {
	game.settings.register(MODULE_ID, "xpEdition", {
		name: "XP Rules",
		hint: "How XP is calculated for each Pokémon. \"Automatic\" follows the STAB Version setting of the Pokémon 5e module.",
		scope: "world",
		config: true,
		type: new foundry.data.fields.StringField({
			required: true,
			nullable: false,
			choices: { auto: "Automatic", "2024": "2024 (200 × level × SR)", "2018": "2018 (XP table)" },
		}),
		default: "auto",
	});
	game.settings.register(MODULE_ID, "shinyOdds", {
		name: "Shiny Odds (1 in N)",
		hint: "Every generated Pokémon has a 1 in N chance of being shiny. poke5e.app suggests 100, 1000 or 4096. Use 0 to turn shinies off.",
		scope: "world",
		config: true,
		type: new foundry.data.fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 100 }),
		default: 100,
	});
	game.settings.register(MODULE_ID, "includeFakemon", {
		name: "Include Fakemon",
		hint: "Adds fakemon to both the encounter generator and the Pokédex: poke5e's 12 older fakemon (Rookite, Eeveon, ...), plus any actor in the Pokémon 5e bestiary that is not an official species. They are treated as living in every biome and have no shiny art. Off by default. Reload Foundry after changing this.",
		scope: "world",
		config: true,
		requiresReload: true,
		type: new foundry.data.fields.BooleanField(),
		default: false,
	});
	game.settings.register(MODULE_ID, "pokedexSound", {
		name: "Pokédex Scan Sound",
		hint: "Play a sound on your own computer when your Pokédex registers a new Pokémon.",
		scope: "client",
		config: true,
		type: new foundry.data.fields.BooleanField(),
		default: true,
	});
	game.settings.register(MODULE_ID, "appendLevel", {
		name: "Show Level in Token Name",
		hint: "Adds \"(Lv N)\" to each generated token's name. The Pokémon itself always has its real level either way.",
		scope: "world",
		config: true,
		type: new foundry.data.fields.BooleanField(),
		default: false,
	});
});

Hooks.once("ready", () => {
	console.log(`${MODULE_ID} | loaded v${game.modules.get(MODULE_ID)?.version}`);
	const module = game.modules.get(MODULE_ID);
	if (module) module.api = { open: openEncounterApp, openPokedex, syncCaught, openLoot: openLootApp };
	if (!game.user.isGM) syncCaught().catch((err) => console.warn(`${MODULE_ID} | Could not sync caught Pokémon`, err));
});

// Button in the token controls (left toolbar).
Hooks.on("getSceneControlButtons", (controls) => {
	const group = Array.isArray(controls) ? controls.find((c) => c.name === "token" || c.name === "tokens") : controls.tokens;
	if (!group) return;
	const addTool = (tool) => {
		if (Array.isArray(group.tools)) group.tools.push(tool);
		else group.tools[tool.name] = tool;
	};
	// Everyone gets the Pokédex.
	addTool({ name: "pk5ePokedex", title: "Pokédex", icon: "fa-solid fa-book-open", order: 98, visible: true, button: true, onChange: () => openPokedex() });
	if (!game.user.isGM) return;
	const tool = {
		name: "pk5eEncounter",
		title: "Pokémon Encounter Generator",
		icon: "fa-solid fa-paw",
		order: 99,
		visible: true,
		button: true,
		onChange: () => openEncounterApp(),
	};
	addTool(tool);
	addTool({ name: "pk5eLoot", title: "Pokémon Loot Generator", icon: "fa-solid fa-gem", order: 100, visible: true, button: true, onChange: () => openLootApp() });
});

// Keep an open Pokédex current: tokens appearing, disappearing or being revealed, and ownership changes (catching).
Hooks.on("createToken", () => refreshPokedex());
Hooks.on("deleteToken", () => refreshPokedex());
Hooks.on("canvasReady", () => refreshPokedex());
Hooks.on("updateToken", (doc, changes) => {
	if ("hidden" in changes || "texture" in changes || "name" in changes || "flags" in changes) refreshPokedex();
});
const onOwnershipChange = (actor, changes) => {
	if (game.user.isGM || actor.type !== "npc" || (changes && !("ownership" in changes))) return;
	syncCaught().then(() => refreshPokedex()).catch((err) => console.warn(`${MODULE_ID} | Could not sync caught Pokémon`, err));
};
Hooks.on("updateActor", onOwnershipChange);
Hooks.on("createActor", (actor) => onOwnershipChange(actor, null));

// Second entry point: a button at the top of the Actors tab.
Hooks.on("renderActorDirectory", (directory, html) => {
	if (!game.user.isGM) return;
	const root = html instanceof HTMLElement ? html : html?.[0];
	const header = root?.querySelector(".header-actions");
	if (!header || root.querySelector(".pk5e-encounter-button")) return;
	const button = document.createElement("button");
	button.type = "button";
	button.classList.add("pk5e-encounter-button");
	button.innerHTML = '<i class="fa-solid fa-paw"></i> Encounter';
	button.addEventListener("click", () => openEncounterApp());
	header.append(button);
	const lootButton = document.createElement("button");
	lootButton.type = "button";
	lootButton.classList.add("pk5e-encounter-button", "pk5e-loot-button");
	lootButton.innerHTML = '<i class="fa-solid fa-gem"></i> Loot';
	lootButton.addEventListener("click", () => openLootApp());
	header.append(lootButton);
});
