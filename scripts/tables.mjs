/**
 * Loot from roll tables (GM). Every table result can carry a quantity formula (an item: how many, another table: how
 * many draws, a coin text: how many times). Text results like "3d6 gp" become coins. The GM rolls in a preview, draws
 * single lines or everything again, changes quantities and adds the rest to the loot in one request; the log notes the
 * table. The formula field sits in Foundry's own result editor and in the table sheet's edit mode.
 */

import {MODULE_ID, TEMPLATES, esc, parts, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {drawLines, lootPayload, parseCoinText, resolveQuantity, summarize} from "./loot-roll.mjs";
import {report, request} from "./transport.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** The flag which holds a result's quantity formula. */
const QUANTITY = `flags.${MODULE_ID}.quantity`;

/**
 * The functions drawLines needs, bound to Foundry and the system's coins.
 * @returns {import("./loot-roll.mjs").DrawDeps}
 */
function drawDeps() {
  const denominations = adapter().denominations();
  return {
    roll: async table => (await table.roll({recursive: false}))?.results ?? [],
    evaluate: async formula => (await new Roll(formula).evaluate({allowInteractive: false})).total,
    resolve: uuid => fromUuid(uuid),
    quantityOf: result => foundry.utils.getProperty(result, QUANTITY) ?? "",
    coinParts: text => parseCoinText(text, denominations),
    coinValue: key => denominations.find(d => d.key === key)?.value ?? null,
    newId: () => foundry.utils.randomID()
  };
}

/* -------------------------------------------- */

/**
 * GM: roll loot on a table in the preview window.
 * @param {RollTable} table
 * @returns {Promise<LootRoll|null>}
 */
export async function openLootRoll(table) {
  if ( typeof table === "string" ) table = await fromUuid(table);
  if ( !game.user.isGM || !(table instanceof RollTable) ) return null;
  const open = foundry.applications.instances.get(`sll-loot-roll-${table.id}`);
  if ( open?.rendered ) {
    open.bringToFront();
    return open;
  }
  const app = new LootRoll(table);
  await app.reroll();
  await app.render({force: true});
  return app;
}

/**
 * GM: pick a world table, then roll on it.
 * @returns {Promise<void>}
 */
export async function pickTable() {
  if ( !game.user.isGM ) return;
  const tables = game.tables.contents.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  if ( !tables.length ) {
    ui.notifications.info(t("SLL.Table.none"));
    return;
  }
  const options = tables.map(table => `<option value="${esc(table.id)}">${esc(table.name)}</option>`).join("");
  const id = await foundry.applications.api.DialogV2.prompt({
    window: {title: t("SLL.Table.pick"), icon: "fa-solid fa-dice"},
    content: `<div class="form-group"><label>${esc(t("SLL.Table.table"))}</label><select name="tableId">${options}</select></div>`
      + `<p class="hint">${esc(t("SLL.Table.pickHint"))}</p>`,
    rejectClose: false,
    ok: {label: t("SLL.Table.roll"), callback: (event, button) => button.form.elements.tableId.value}
  });
  const table = id ? game.tables.get(id) : null;
  if ( table ) await openLootRoll(table);
}

/* -------------------------------------------- */

export class LootRoll extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * @param {RollTable} table
   * @param {object} [options]
   */
  constructor(table, options={}) {
    super({...options, id: `sll-loot-roll-${table.id}`});
    this.table = table;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["sll-loot-roll"],
    window: {icon: "fa-solid fa-dice", resizable: true},
    position: {width: 500, height: "auto"},
    actions: {
      rerollAll: LootRoll.#onRerollAll,
      rerollLine: LootRoll.#onRerollLine,
      openItem: LootRoll.#onOpenItem,
      addToLoot: LootRoll.#onAddToLoot
    }
  };

  /** @override */
  static PARTS = {
    main: {template: `${TEMPLATES}/loot-roll.hbs`, scrollable: [".sll-roll-lines"]}
  };

  /** How many times the table is drawn, a formula. */
  draws = "1";

  /** @type {import("./loot-roll.mjs").LootLine[]} */
  lines = [];

  /** @override */
  get title() {
    return t("SLL.Table.title", {name: this.table.name});
  }

  /**
   * Draw everything again.
   * @returns {Promise<void>}
   */
  async reroll() {
    const deps = drawDeps();
    const times = await resolveQuantity(this.draws, deps.evaluate);
    if ( times === null ) ui.notifications.warn(t("SLL.Table.invalid"));
    this.lines = await drawLines(this.table, deps, {times: times ?? 1});
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const a = adapter();
    const coinsOn = (a.id !== "generic") || !!a.hasCoins;
    const {loot, fund} = parts();
    const icons = {coins: "fa-coins", text: "fa-scroll"};
    context.draws = this.draws;
    context.lines = this.lines.map(line => ({
      ...line,
      isItem: line.kind === "item",
      isCoins: line.kind === "coins",
      selectable: (line.kind === "item") || ((line.kind === "coins") && coinsOn),
      icon: icons[line.kind] ?? "fa-scroll",
      coinsText: (line.kind === "coins") ? a.formatCoins(line.coins) : "",
      canReroll: !!line.tableUuid
    }));
    const sum = summarize(this.lines.map(l => ((l.kind === "coins") && !coinsOn) ? {...l, include: false} : l));
    const coinsText = sum.coins ? a.formatCoins(sum.coins) : "";
    context.summary = coinsText ? t("SLL.Table.summaryCoins", {items: sum.items, coins: coinsText})
      : t("SLL.Table.summary", {items: sum.items});
    context.canAdd = (sum.items > 0) || (sum.coins > 0);
    context.addLabel = t(loot ? "SLL.Collect.take" : "SLL.Collect.takeStash");
    context.coinsNowhere = (sum.coins > 0) && !loot && !fund;
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const draws = this.element.querySelector("input[name=draws]");
    draws?.addEventListener("change", () => {
      this.draws = draws.value;
    });
    for ( const row of this.element.querySelectorAll("[data-line-id]") ) {
      const line = this.lines.find(l => l.id === row.dataset.lineId);
      if ( !line ) continue;
      row.querySelector("input[name=include]")?.addEventListener("change", event => {
        line.include = event.currentTarget.checked;
        this.render();
      });
      row.querySelector("input[name=quantity]")?.addEventListener("change", event => {
        line.quantity = Math.max(Math.floor(Number(event.currentTarget.value) || 0), 0);
        line.include = line.quantity > 0;
        this.render();
      });
    }
  }

  /* -------------------------------------------- */

  /** @this {LootRoll} */
  static async #onRerollAll() {
    const draws = this.element.querySelector("input[name=draws]");
    if ( draws ) this.draws = draws.value;
    await this.reroll();
    this.render();
  }

  /** Draw one line again, from the table it came from. @this {LootRoll} */
  static async #onRerollLine(event, target) {
    const index = this.lines.findIndex(l => l.id === target.closest("[data-line-id]")?.dataset.lineId);
    const line = this.lines[index];
    if ( !line ) return;
    const table = line.tableUuid ? await fromUuid(line.tableUuid) : this.table;
    if ( !table ) return;
    const fresh = await drawLines(table, drawDeps(), {times: 1, depth: line.depth});
    this.lines.splice(index, 1, ...fresh);
    this.render();
  }

  /** @this {LootRoll} */
  static async #onOpenItem(event, target) {
    const line = this.lines.find(l => l.id === target.closest("[data-line-id]")?.dataset.lineId);
    const item = line?.uuid ? await fromUuid(line.uuid) : null;
    item?.sheet?.render(true);
  }

  /** @this {LootRoll} */
  static async #onAddToLoot() {
    const payload = lootPayload(this.lines);
    if ( !payload.items.length && !payload.coins ) return;
    for ( const button of this.element.querySelectorAll("button") ) button.disabled = true;
    const done = report(await request("addRolled", {...payload, table: this.table.name}));
    if ( done ) await this.close();
    else for ( const button of this.element.querySelectorAll("button") ) button.disabled = false;
  }
}

/* -------------------------------------------- */
/*  The quantity field in Foundry's sheets      */
/* -------------------------------------------- */

/**
 * Hook "renderTableResultConfig": the quantity formula below the weight of a result (GM).
 * @param {TableResultConfig} app
 * @param {HTMLElement} html
 */
export function onRenderTableResultConfig(app, html) {
  if ( !game.user.isGM ) return;
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  const weight = element?.querySelector("[name=weight]")?.closest(".form-group");
  if ( !weight || element.querySelector(".sll-quantity") ) return;
  const value = foundry.utils.getProperty(app.document, QUANTITY) ?? "";
  const id = `${app.id}-sll-quantity`;
  const group = document.createElement("div");
  group.className = "form-group slim sll-quantity";
  group.innerHTML = `<label for="${esc(id)}">${esc(t("SLL.Table.quantity"))}</label>`
    + `<div class="form-fields"><input type="text" id="${esc(id)}" name="${QUANTITY}" value="${esc(value)}" placeholder="1"></div>`
    + `<p class="hint">${esc(t("SLL.Table.quantityHint"))}</p>`;
  weight.after(group);
}

/**
 * Hook "renderRollTableSheet": in edit mode a quantity field on every result row, in view mode the formula as a small
 * note (GM).
 * @param {RollTableSheet} app
 * @param {HTMLElement} html
 */
export function onRenderRollTableSheet(app, html) {
  if ( !game.user.isGM ) return;
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  for ( const row of element?.querySelectorAll("tr[data-result-id]") ?? [] ) {
    const details = row.querySelector("td.details");
    if ( !details || details.querySelector(".sll-quantity") ) continue;
    const result = app.document.results.get(row.dataset.resultId);
    const value = foundry.utils.getProperty(result ?? {}, QUANTITY) ?? "";
    const idInput = row.querySelector("input[name$='._id']");
    if ( idInput ) {
      const prefix = idInput.name.slice(0, -"._id".length);
      const label = document.createElement("label");
      label.className = "sll-quantity";
      label.dataset.tooltip = t("SLL.Table.quantityHint");
      label.innerHTML = `<i class="fa-solid fa-scroll" inert></i><span>${esc(t("SLL.Table.quantityShort"))}</span>`
        + `<input type="text" name="${esc(prefix)}.${QUANTITY}" value="${esc(value)}" placeholder="1">`;
      details.append(label);
    }
    else if ( value ) {
      const note = document.createElement("small");
      note.className = "sll-quantity";
      note.dataset.tooltip = t("SLL.Table.quantity");
      note.innerHTML = `<i class="fa-solid fa-scroll" inert></i> × ${esc(value)}`;
      details.append(note);
    }
  }
}

/**
 * Hook "getHeaderControlsRollTableSheet": roll loot from the table's window (GM).
 * @param {RollTableSheet} app
 * @param {object[]} controls
 */
export function onGetHeaderControls(app, controls) {
  if ( !game.user.isGM || !Array.isArray(controls) ) return;
  controls.push({icon: "fa-solid fa-sack", label: "SLL.Table.roll", action: "sllRollLoot",
    onClick: () => openLootRoll(app.document)});
}

/**
 * Hook "getRollTableContextOptions": roll loot from the sidebar or a compendium (GM).
 * @param {Application} app
 * @param {object[]} entries
 */
export function onGetRollTableContextOptions(app, entries) {
  entries.push({
    name: "SLL.Table.roll",
    icon: `<i class="fa-solid fa-sack"></i>`,
    condition: () => game.user.isGM,
    callback: async li => {
      const element = (li instanceof HTMLElement) ? li : li?.[0];
      const id = element?.dataset.entryId ?? element?.dataset.documentId;
      const pack = (typeof app?.collection?.getDocument === "function") && app.collection.metadata ? app.collection : null;
      const table = pack ? await pack.getDocument(id) : game.tables.get(id);
      if ( table ) await openLootRoll(table);
    }
  });
}
