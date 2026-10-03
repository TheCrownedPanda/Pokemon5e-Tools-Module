# Pokémon 5e Tools

A Foundry module with extra tools for people running Pokémon 5e: a random encounter generator and a per-player Pokédex. Press a button, get a random encounter. It works a lot like the encounter tool on [poke5e.app](https://poke5e.app/encounter-tool), except the Pokémon end up as real actors in your world.

I made it because building encounters by hand every session was eating my prep time. It also has a Pokédex for your players, which is the part my table likes most.


## What you need
- Foundry v13 or newer (I run v14)
- dnd5e system 5.x
- The [Pokémon 5e module](https://github.com/MissingGlitch/pokemon5e-foundry-module), 0.13.0 or newer

## Installing
Paste this manifest URL into Foundry's Install Module screen:

`https://github.com/YOURNAME/Pokemon5e-Tools-Module/releases/latest/download/module.json`

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

## Pokédex
Everyone gets a Pokédex button. Every account has its own.

- **Seen:** a Pokémon only registers when a player opens their Pokédex while it's visible on the scene. It scans, plays a sound and pops up a "new entry" banner. Hit Scan to do it again.
- **Caught:** anything a player owns counts as caught and shows the full entry (stats, moves, abilities, breeding, evolutions).
- **Not seen yet:** players only see a "?" and the dex number.
- **GM tools:** look at any player's Pokédex, set entries to unseen/seen/caught, register what a player owns, scan the scene for a player, or clear one Pokédex (or all of them). Clearing keeps owned Pokémon as caught.

Only official species are in there, no fakemon.

## Good to know
- Shiny art and the Pokédex pictures load from poke5e.app, so if their site goes down those images will too.
- Tokens from the generator are tagged with their species. Other tokens are matched by name.

## Credits and license
The generation algorithm and the species/biome/region data come from [Auroratide/poke5e](https://github.com/Auroratide/poke5e) (ISC license, see `LICENSE-poke5e.txt`). Actors come from the Pokémon 5e module. Thanks to both.
