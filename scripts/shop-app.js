import { getCatalog } from "./loot-app.js";
import { rollLoot, rarityLabel } from "./loot-logic.js";
import {
	SHOP_PRESETS, SPECIAL_PRESETS, buildItemLookup, resolvePreset, rowFromItem, rowFromCustom, CUSTOM_ITEMS,
	effectivePrice, cartTotal, serializeRow, rowFromSaved, mergeRows,
} from "./shop-logic.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE_ID = "pokemon5e-encounters";
const ITEMS_PACK = "pokemon5e.items_and_consumables";
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const fmt = (n) => Number(n).toLocaleString();
const RANDOM_EXTRA_GROUPS = ["medicine", "pokeballs", "battleitems"];

// Kept between window openings, so your shop and edited prices survive closing the window.
const shopState = {
	presetId: "viridian", shopName: SHOP_PRESETS[0].name, rows: [], missing: [], extras: 0, percent: 100,
	buyerId: "", charge: true, stackExisting: true, receipt: true, started: false, mergeId: "",
};
const SAVED = "saved:";
const savedShops = () => game.settings.get(MODULE_ID, "savedShops") ?? {};

export class PokemonShopApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "pk5e-shop-app",
		classes: ["pk5e-encounters", "pk5e-shop"],
		tag: "form",
		window: { title: "Poké Mart", icon: "fa-solid fa-store", resizable: true },
		position: { width: 660, height: 760 },
		form: { handler: PokemonShopApp.#onSubmit, submitOnChange: true, closeOnSubmit: false },
		actions: {
			generate: PokemonShopApp.#onGenerate,
			removeRow: PokemonShopApp.#onRemoveRow,
			addItem: PokemonShopApp.#onAddItem,
			resetPrices: PokemonShopApp.#onResetPrices,
			clearCart: PokemonShopApp.#onClearCart,
			saveShop: PokemonShopApp.#onSaveShop,
			saveShopNew: PokemonShopApp.#onSaveShopNew,
			deleteShop: PokemonShopApp.#onDeleteShop,
			mergeShop: PokemonShopApp.#onMergeShop,
			sell: PokemonShopApp.#onSell,
		},
	};

	static PARTS = { main: { template: `modules/${MODULE_ID}/templates/shop.hbs` } };

	#catalog = null;
	#lookup = null;
	#allItems = [];
	#busy = false;
	#addText = "";

	async #ensureCatalog() {
		if (this.#catalog) return;
		this.#catalog = await getCatalog();
		this.#allItems = [...this.#catalog.itemsByCategory.values()].flat();
		this.#lookup = buildItemLookup(this.#allItems);
		if (!shopState.started) { this.#generate(); shopState.started = true; }
	}

	#categoryOf(item) {
		const meta = this.#catalog?.categoryMeta.get(item.folder ?? "none");
		return meta ? (meta.label === meta.group ? meta.group : `${meta.group} › ${meta.label}`) : "";
	}

	/** Builds the shop's inventory from the chosen preset (plus any extra random items). */
	#generate() {
		const s = shopState;
		if (s.presetId.startsWith(SAVED)) return this.#loadSaved(s.presetId.slice(SAVED.length));
		const special = SPECIAL_PRESETS.find((p) => p.id === s.presetId);
		const preset = SHOP_PRESETS.find((p) => p.id === s.presetId);
		let rows = [];
		let missing = [];
		if (preset) {
			({ rows, missing } = resolvePreset(preset, this.#lookup));
			for (const row of rows) if (!row.custom) row.category = this.#categoryOf(this.#allItems.find((i) => i.id === row.id) ?? {});
		}
		const extras = special?.id === "random" ? Math.max(s.extras, 10) : s.extras;
		if (extras > 0) {
			const enabled = new Set([...this.#catalog.categoryMeta.values()].filter((m) => RANDOM_EXTRA_GROUPS.includes(normalizeName(m.group))).map((m) => m.key));
			const locked = rows.filter((r) => !r.custom).map((r) => ({ id: r.id }));
			const rolled = rollLoot({ categories: this.#catalog, enabled, count: extras + locked.length, maxRarity: "rare", stacks: false, locked });
			for (const item of rolled.slice(locked.length)) rows.push({ ...rowFromItem({ id: item.id, name: item.name, img: item.img, type: item.type, rarity: item.rarity, price: { value: item.price, denomination: item.denomination } }), category: item.category });
		}
		s.rows = rows;
		s.missing = missing;
	}

	/** Rows for a premade or saved shop (used for loading and for "add stock from another shop"). */
	#rowsFor(id) {
		if (id.startsWith(SAVED)) {
			const saved = savedShops()[id.slice(SAVED.length)];
			if (!saved) return { rows: [], missing: [] };
			const itemsById = new Map(this.#allItems.map((i) => [i.id, i]));
			const rows = [];
			const missing = [];
			for (const r of saved.rows ?? []) {
				const row = rowFromSaved(r, this.#lookup, itemsById);
				if (row) { if (!row.custom) row.category = this.#categoryOf(itemsById.get(row.id) ?? {}); rows.push(row); } else missing.push(r.name);
			}
			return { rows, missing };
		}
		const preset = SHOP_PRESETS.find((p) => p.id === id);
		if (!preset) return { rows: [], missing: [] };
		const result = resolvePreset(preset, this.#lookup);
		for (const row of result.rows) if (!row.custom) row.category = this.#categoryOf(this.#allItems.find((i) => i.id === row.id) ?? {});
		return result;
	}

	#loadSaved(id) {
		const s = shopState;
		const saved = savedShops()[id];
		if (!saved) { s.rows = []; s.missing = []; return; }
		const { rows, missing } = this.#rowsFor(`${SAVED}${id}`);
		s.rows = rows;
		s.missing = missing;
		s.percent = saved.percent ?? 100;
		s.shopName = saved.name;
	}

	async _prepareContext() {
		let error = null;
		try { await this.#ensureCatalog(); } catch (err) { error = err.message; }
		const s = shopState;
		const characters = game.actors.filter((a) => a.type === "character").sort((a, b) => a.name.localeCompare(b.name));
		if (s.buyerId && !characters.some((a) => a.id === s.buyerId)) s.buyerId = "";
		const buyer = game.actors.get(s.buyerId);
		const total = cartTotal(s.rows, s.percent);
		const gp = buyer ? Number(buyer.system.currency?.gp) || 0 : null;
		return {
			error,
			presetGroups: this.#presetGroups((id) => id === s.presetId),
			mergeGroups: this.#presetGroups((id) => id === s.mergeId, true),
			isSaved: s.presetId.startsWith(SAVED),
			shopName: s.shopName,
			percent: s.percent,
			extras: s.extras,
			rows: s.rows.map((r, i) => {
				const price = effectivePrice(r, s.percent);
				const defaultPrice = effectivePrice({ ...r, priceOverride: null }, s.percent);
				return {
					...r, index: i, price, edited: price !== defaultPrice, defaultPrice: fmt(defaultPrice), rarityLabel: rarityLabel(r.rarity),
					lineTotal: r.qty > 0 ? fmt(price * r.qty) : "",
				};
			}),
			hasRows: s.rows.length > 0,
			missing: s.missing.join(", "),
			addText: this.#addText,
			itemNames: this.#allItems.map((i) => i.name),
			buyerOptions: [{ value: "", label: "- Choose a character -", selected: s.buyerId === "" }, ...characters.map((a) => ({ value: a.id, label: a.name, selected: a.id === s.buyerId }))],
			noCharacters: !characters.length,
			buyerMoney: gp == null ? "" : `${fmt(gp)} gp`,
			charge: s.charge,
			stackExisting: s.stackExisting,
			receipt: s.receipt,
			total: fmt(Math.ceil(total)),
			cartCount: s.rows.filter((r) => r.qty > 0).length,
			cantAfford: !!(s.charge && buyer && total > gp),
			busy: this.#busy,
		};
	}

	/** Dropdown content: premade Kanto shops, your saved shops, and the special ones. */
	#presetGroups(isSelected, forMerge = false) {
		const saved = Object.values(savedShops()).sort((a, b) => a.name.localeCompare(b.name));
		const groups = [
			{ label: "Kanto shops", options: SHOP_PRESETS.map((p) => ({ value: p.id, label: p.name, selected: isSelected(p.id) })) },
		];
		if (saved.length) groups.push({ label: "Your saved shops", options: saved.map((p) => ({ value: `${SAVED}${p.id}`, label: p.name, selected: isSelected(`${SAVED}${p.id}`) })) });
		if (!forMerge) groups.push({ label: "Other", options: SPECIAL_PRESETS.map((p) => ({ value: p.id, label: p.name, selected: isSelected(p.id) })) });
		else groups.unshift({ label: "Copy from", options: [{ value: "", label: "- Choose a shop to copy from -", selected: !shopState.mergeId }] });
		return groups;
	}

	_onRender(context, options) {
		super._onRender?.(context, options);
		const input = this.element.querySelector("#pk5e-shop-add");
		if (!input) return;
		// Typing an item name must not submit the form; Enter adds it.
		input.addEventListener("change", (e) => e.stopPropagation());
		input.addEventListener("input", () => { this.#addText = input.value; });
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			this.#addItem(input.value);
		});
	}

	static async #onSubmit(event, form, formData) {
		const data = foundry.utils.expandObject(formData.object);
		const s = shopState;
		// A price that differs from what the shop showed is a hand-made override.
		s.rows.forEach((row, i) => {
			const f = data.rows?.[i];
			if (!f) return;
			row.qty = clamp(Math.round(Number(f.qty)) || 0, 0, 999);
			const entered = Math.round(Number(f.price));
			if (Number.isFinite(entered) && entered >= 0 && entered !== effectivePrice(row, s.percent)) row.priceOverride = entered;
		});
		if (data.percent !== undefined) s.percent = clamp(Math.round(Number(data.percent)) || 0, 0, 1000);
		if (data.extras !== undefined) s.extras = clamp(Math.round(Number(data.extras)) || 0, 0, 20);
		if (data.shopName !== undefined) s.shopName = data.shopName;
		if (data.buyerId !== undefined) s.buyerId = data.buyerId;
		if (data.mergeId !== undefined) s.mergeId = data.mergeId;
		s.charge = !!data.charge;
		s.stackExisting = !!data.stackExisting;
		s.receipt = !!data.receipt;
		if (data.presetId !== undefined && data.presetId !== s.presetId) {
			s.presetId = data.presetId;
			const preset = [...SHOP_PRESETS, ...SPECIAL_PRESETS].find((p) => p.id === s.presetId);
			s.shopName = preset?.name ?? savedShops()[s.presetId.slice(SAVED.length)]?.name ?? s.shopName;
			if (this.#catalog) this.#generate();
		}
		this.render();
	}

	static async #onGenerate() {
		if (!this.#catalog) return;
		this.#generate();
		this.render();
	}

	async #save(asNew) {
		const s = shopState;
		if (!s.rows.length) return ui.notifications.warn("Add some items to the shop before saving it.");
		const saved = foundry.utils.deepClone(savedShops());
		const overwrite = !asNew && s.presetId.startsWith(SAVED) && saved[s.presetId.slice(SAVED.length)];
		const id = overwrite ? s.presetId.slice(SAVED.length) : foundry.utils.randomID();
		let name = (s.shopName ?? "").trim() || "Custom shop";
		// Never reuse the name of a premade shop; make it clear it's your version.
		if (!overwrite && [...SHOP_PRESETS, ...SPECIAL_PRESETS].some((p) => p.name === name)) name += " (custom)";
		saved[id] = { id, name, percent: s.percent, rows: s.rows.map(serializeRow) };
		await game.settings.set(MODULE_ID, "savedShops", saved);
		s.presetId = `${SAVED}${id}`;
		s.shopName = name;
		ui.notifications.info(`Saved "${name}". It will be here next time, in "Your saved shops".`);
		this.render();
	}

	static async #onSaveShop() { await this.#save(false); }
	static async #onSaveShopNew() { await this.#save(true); }

	static async #onDeleteShop() {
		const s = shopState;
		if (!s.presetId.startsWith(SAVED)) return;
		const id = s.presetId.slice(SAVED.length);
		const saved = foundry.utils.deepClone(savedShops());
		const name = saved[id]?.name ?? "this shop";
		const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete saved shop" }, content: `<p>Delete the saved shop <strong>${foundry.utils.escapeHTML?.(name) ?? name}</strong>? The premade shops are not affected.</p>` });
		if (!ok) return;
		delete saved[id];
		await game.settings.set(MODULE_ID, "savedShops", saved);
		s.presetId = "custom";
		s.shopName = "Custom shop";
		s.rows = [];
		s.missing = [];
		this.render();
	}

	/** Copies another shop's stock into this one (items already here are left alone). */
	static #onMergeShop() {
		const s = shopState;
		if (!s.mergeId || !this.#catalog) return ui.notifications.warn("Choose a shop to copy stock from.");
		const { rows, missing } = this.#rowsFor(s.mergeId);
		const added = mergeRows(s.rows, rows);
		s.missing = [...new Set([...s.missing, ...missing])];
		ui.notifications.info(added ? `Added ${added} item(s).` : "Everything from that shop is already here.");
		this.render();
	}

	static #onRemoveRow(event, target) {
		shopState.rows.splice(Number(target.dataset.index), 1);
		this.render();
	}

	static #onResetPrices() {
		for (const row of shopState.rows) row.priceOverride = null;
		this.render();
	}

	static #onClearCart() {
		for (const row of shopState.rows) row.qty = 0;
		this.render();
	}

	static #onAddItem() {
		this.#addItem(this.element.querySelector("#pk5e-shop-add")?.value ?? "");
	}

	#addItem(text) {
		const wanted = text.trim().toLowerCase();
		if (!wanted || !this.#catalog) return;
		const custom = Object.keys(CUSTOM_ITEMS).find((n) => n.toLowerCase() === wanted);
		let row = null;
		if (custom) row = rowFromCustom(custom);
		else {
			let item = this.#allItems.find((i) => i.name.toLowerCase() === wanted);
			if (!item) {
				const partial = this.#allItems.filter((i) => i.name.toLowerCase().includes(wanted));
				if (partial.length === 1) item = partial[0];
				else if (partial.length > 1) return ui.notifications.warn(`${partial.length} items match "${text.trim()}". Pick one from the suggestions.`);
			}
			if (item) row = { ...rowFromItem(item), category: this.#categoryOf(item) };
		}
		if (!row) return ui.notifications.warn(`No item named "${text.trim()}" was found. Pick one from the suggestions.`);
		if (shopState.rows.some((r) => r.id === row.id)) return ui.notifications.info(`${row.name} is already in this shop.`);
		shopState.rows.push(row);
		this.#addText = "";
		this.render();
	}

	/** Fresh item data for a shop row: from the compendium, or a simple custom item. */
	async #itemData(row) {
		if (row.custom) {
			return {
				name: row.name, type: "consumable", img: row.img,
				system: { description: { value: `<p>${row.description}</p>` }, quantity: row.qty, price: { value: row.base, denomination: row.denomination }, rarity: "common" },
				flags: { [MODULE_ID]: { shop: true } },
			};
		}
		const doc = await game.packs.get(ITEMS_PACK)?.getDocument(row.id);
		if (!doc) throw new Error(`"${row.name}" was not found in the compendium.`);
		const data = doc.toObject();
		for (const key of ["_id", "_stats", "sort", "folder", "ownership"]) delete data[key];
		data.system.quantity = row.qty;
		if ("container" in data.system) data.system.container = null;
		foundry.utils.setProperty(data, `flags.${MODULE_ID}.shop`, true);
		return data;
	}

	/** Gives the cart to the character and (optionally) takes the money. Existing items are only touched to add to a stack. */
	static async #onSell() {
		if (this.#busy) return;
		const s = shopState;
		const buyer = game.actors.get(s.buyerId);
		if (!buyer) return ui.notifications.warn("Choose the character who is buying.");
		const cart = s.rows.filter((r) => r.qty > 0);
		if (!cart.length) return ui.notifications.warn("Set a quantity on at least one item.");
		const total = Math.ceil(cartTotal(s.rows, s.percent));
		const gp = Number(buyer.system.currency?.gp) || 0;
		if (s.charge && total > gp) return ui.notifications.error(`${buyer.name} has ${fmt(gp)} gp but this costs ${fmt(total)} gp. Untick "Charge money" to give it anyway.`);

		this.#busy = true;
		this.render();
		try {
			const toCreate = [];
			const stackUpdates = new Map();
			for (const row of cart) {
				const existing = s.stackExisting ? buyer.items.find((i) => i.name === row.name && i.type === row.type) : null;
				if (existing) stackUpdates.set(existing.id, (stackUpdates.get(existing.id) ?? (Number(existing.system.quantity) || 0)) + row.qty);
				else toCreate.push(await this.#itemData(row));
			}
			if (stackUpdates.size) await buyer.updateEmbeddedDocuments("Item", [...stackUpdates].map(([_id, quantity]) => ({ _id, "system.quantity": quantity })));
			if (toCreate.length) await buyer.createEmbeddedDocuments("Item", toCreate);
			if (s.charge && total > 0) await buyer.update({ "system.currency.gp": gp - total });

			if (s.receipt) {
				const lines = cart.map((r) => {
					const name = r.custom ? r.name : `@UUID[Compendium.${ITEMS_PACK}.Item.${r.id}]{${r.name}}`;
					return `<li>${name} ×${r.qty} <em>(${fmt(effectivePrice(r, s.percent))} each)</em></li>`;
				}).join("");
				await ChatMessage.create({
					content: `<h3>${foundry.utils.escapeHTML?.(s.shopName) ?? s.shopName}</h3><p><strong>${buyer.name}</strong> bought:</p><ul>${lines}</ul><p>${s.charge ? `Total: ${fmt(total)} gp` : "No charge."}</p>`,
					speaker: ChatMessage.getSpeaker(),
				});
			}
			ui.notifications.info(`${buyer.name} received ${cart.map((r) => `${r.name} ×${r.qty}`).join(", ")}${s.charge ? ` for ${fmt(total)} gp` : ""}.`);
			for (const row of cart) row.qty = 0;
		} catch (err) {
			console.error(`${MODULE_ID} |`, err);
			ui.notifications.error(`Shop: ${err.message}`);
		} finally {
			this.#busy = false;
			this.render();
		}
	}
}

const normalizeName = (text) => String(text ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
