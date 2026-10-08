# Pokémon 5e Tools

A Foundry module with extra tools for people running Pokémon 5e: a random encounter generator and a per-player Pokédex. Press a button, get a random encounter. It works a lot like the encounter tool on [poke5e.app](https://poke5e.app/encounter-tool), except the Pokémon end up as real actors in your world.

I made it because building encounters by hand every session was eating my prep time. It also has a Pokédex for your players, which is the part my table likes most.

**Heads up on how it was made:** I came up with the feature list and tested everything at my own table, but the code was written with AI help (Claude). If that's a dealbreaker for you, no hard feelings. If you do read the code and find a bug, please open an issue.

## What you need
- Foundry v13 or newer (I run v14)
- dnd5e system 5.x
- The [Pokémon 5e module](https://github.com/MissingGlitch/pokemon5e-foundry-module), 0.13.0 or newer

## Installing
Paste this manifest URL into Foundry's Install Module screen:

`https://github.com/TheCrownedPanda/Pokemon5e-Tools-Module/releases/latest/download/module.json`

Or unzip the release into `Data/modules`, restart Foundry and turn it on in your world. Turn on Pokémon 5e too.

## Making encounters
You need to be GM. Click the paw icon in the token controls, or the Encounter button at the top of the Actors tab. There's also a macro hook: `game.modules.get("pokemon5e-encounters").api.open()`

Fill in your party (there's a button to pull in your player characters), biome, type, region, difficulty and an optional Pokémon limit, then hit Generate. Reroll as many times as you like.

Place on Scene creates a brand new actor for every Pokémon in an "Encounter Pokémon" folder, sets it to the level it rolled, and puts a linked token in the middle of your view. It never touches actors you already have.

If a player catches one, give them Owner on the actor. Level, HP, moves and ability stay exactly as they were in the fight. Clean Up deletes generated Pokémon that aren't on a scene and that nobody owns.

### Other options
- **Rarity:** limit the pool to an SR range. Results are sorted highest SR first.
- **Shinies:** 1 in 100 by default (change it in module settings, 0 turns them off). "Make one shiny" bumps one more, and there's a toggle to always guarantee at least one.
- **Guaranteed Pokémon:** type a name, pick level, amount and shiny, and it's always in the encounter. The rest gets rolled around it.
- **Folder only:** untick "place on scene" and the Pokémon are just created in a dated folder so you can place them yourself.

### How levels work
Each Pokémon is a fresh copy. The module raises its class level and HP, picks up to 4 moves it would know at that level, picks one of its possible abilities and fills HP. The Pokémon 5e module handles move damage and STAB on its own.

The budget math is the same as poke5e.app: party levels x 50, plus 10% per extra Pokémon per player, times 1 / 1.5 / 2 for difficulty. XP per Pokémon is either the 2024 formula or the 2018 table (module setting).

## Loot generator
GM only. Click the gem icon in the token controls, or the Loot button at the top of the Actors tab. Macro: `game.modules.get("pokemon5e-encounters").api.openLoot()`

It rolls items from the Pokémon 5e "Items & Consumables" compendium. The categories are the compendium's own folders, each with a checkbox. Medicine and Poké Balls are on by default and come up 3x as often as anything else you switch on. Evolutionary items, berries, held items, TMs, battle items and the rest are opt-in.

- **Environment:** pick a biome and items that suit it are 3x as likely (Water Stone by the ocean, Fire Stone near a volcano, berries in forests, shop items in cities).
- **Highest rarity:** caps what can roll. Rarer items are less likely in general.
- **Number of items**, with an option for cheap items to come in small stacks.
- **Lock** rows you like and reroll the rest, change quantities, or remove rows.
- **Give to Character:** adds the items to a player character's inventory. If they already have the item it adds to the stack (you can turn that off to always create a new item).
- **Create Items:** makes the items as world Items in a dated "Loot" folder so you can drag them out yourself.
- **Post to Chat** lists them for the table.

## Shop (GM only)
Click the shop icon in the token controls, or the Shop button at the top of the Actors tab. Macro: `game.modules.get("pokemon5e-encounters").api.openShop()`

Pick a shop and its inventory is generated: the Kanto Poké Marts (Viridian, Pewter, Cerulean, Vermilion, Lavender, Celadon, Fuchsia, Cinnabar), the Celadon Dept. Store floors, a Random Poké Mart, or an empty custom shop. Stock is unlimited.

- Prices start at the Items & Consumables compendium price. Edit any price by hand (edited prices are outlined), or use the price adjustment % to scale all of them.
- Set a quantity on each item and press **Sell to Character**. The items go straight into the character's inventory (adding to a stack if they already have it) and the total can be taken from their gp.
- Add any compendium item to a shop, remove items you don't want, and add extra random stock.
- Items the Kanto marts sell that aren't in the compendium (Repel, Super Repel, Max Repel, Poké Doll, Mail) are offered as simple custom items with their game prices.
- A receipt can be posted to chat.
- **Saved shops:** press **Save** to keep a shop (its items and any edited prices) in your world. It shows up under "Your saved shops" in every future session. To make your own version of a Kanto shop, pick it, add or remove items and change prices, then Save. The premade shop itself isn't changed. Use **Add Its Stock** to copy another shop's items into the one you're building.

## Pokédex
Everyone gets a Pokédex button. Every account has its own.

- **Seen:** a Pokémon only registers when a player opens their Pokédex while it's visible on the scene. It scans, plays a sound and pops up a "new entry" banner. Hit Scan to do it again.
- **Caught:** anything a player owns counts as caught and shows the full entry (stats, moves, abilities, breeding, evolutions).
- **Not seen yet:** players only see a "?" and the dex number.
- **GM tools:** look at any player's Pokédex, set entries to unseen/seen/caught, register what a player owns, scan the scene for a player, or clear one Pokédex (or all of them). Clearing keeps owned Pokémon as caught.

Only official species are in there, no fakemon.

## Fakemon (optional)
Off by default. Turn on **Include Fakemon** in the module settings (and reload Foundry) to add them to both the encounter generator and the Pokédex:
- poke5e's 12 older fakemon (Rookite, Belseraph, Droideon, Brawleon, Specteon, Toxeon, Minereon, Aereon, Pesteon, Terreon, Drakeon, Eeveon). They don't have actors in the Pokémon 5e bestiary, so the module builds one from poke5e's stat block when they're placed. Art is loaded from poke5e.app and credited to the original artists in the Pokédex.
- Any actor in your Pokémon 5e bestiary compendium that isn't an official species, read straight from the actor.

Fakemon count as living in every biome and region (they only get filtered by SR and type), have no shiny art, and show up in the Pokédex as F01, F02... (poke5e's) or C01, C02... (custom).

## Good to know
- Shiny art and the Pokédex pictures load from poke5e.app, so if their site goes down those images will too.
- Tokens from the generator are tagged with their species. Other tokens are matched by name.

## Credits and license
The generation algorithm and the species/biome/region data come from [Auroratide/poke5e](https://github.com/Auroratide/poke5e) (ISC license, see `LICENSE-poke5e.txt`). Actors come from the Pokémon 5e module. Thanks to both.
