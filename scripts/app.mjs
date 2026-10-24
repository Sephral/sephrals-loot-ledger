/**
 * The Loot Ledger window. Four tabs: the loot (claims and distribution), the stash with the party fund and the acting
 * character's own things, the log and the balance. Players and the GM see the same window; buttons a user may not use
 * are left out. Every button sends a request, nothing changes directly in this window. The loot, the party fund and the
 * balance can be switched off in the settings; the loot and the fund stay visible until they are empty.
 */

import {MODULE_ID, TEMPLATES, flag, parts, setting, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {openCollect} from "./collect.mjs";
import {askCoins, askQuantity, askRecipient, askSplit, confirm} from "./dialogs.mjs";
import {describe, entries, verify} from "./ledger.mjs";
import {CLAIM_RANK, balance, pickWinner} from "./rules.mjs";
import {areaItems, isContained, ledgerActor, pendingRequests, storedCoins} from "./storage.mjs";
import {report, request} from "./transport.mjs";
import {markUsed} from "./usage.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** How many log entries the window lists. */
const LOG_LIMIT = 200;

/* -------------------------------------------- */

/**
 * Open the window, or bring it to the front.
 * @param {object} [options]
 * @param {string} [options.tab]
 * @returns {Promise<LootLedger>}
 */
export async function openLedger({tab}={}) {
  const existing = foundry.applications.instances.get(LootLedger.DEFAULT_OPTIONS.id);
  const app = existing ?? new LootLedger();
  if ( tab ) app.tab = tab;
  if ( existing?.rendered ) {
    app.render();
    app.bringToFront();
  }
  else await app.render({force: true});
  markUsed(MODULE_ID);
  return app;
}

/**
 * Redraw the window if it is open.
 */
export function refreshLedger() {
  const app = foundry.applications.instances.get(LootLedger.DEFAULT_OPTIONS.id);
  if ( app?.rendered ) app.render();
}

/** Redraw soon; the several updates of one transfer collapse into one redraw. */
export const scheduleRefresh = foundry.utils.debounce(refreshLedger, 120);

/* -------------------------------------------- */

export class LootLedger extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "sll-ledger",
    classes: ["sll-ledger"],
    window: {title: "SLL.Title", icon: "fa-solid fa-scroll", resizable: true},
    position: {width: 640, height: 720},
    actions: {
      showTab: LootLedger.#onTab,
      claim: LootLedger.#onClaim,
      award: LootLedger.#onAward,
      distribute: LootLedger.#onDistribute,
      unclaimed: LootLedger.#onUnclaimed,
      toStash: LootLedger.#onToStash,
      toPool: LootLedger.#onToPool,
      remove: LootLedger.#onRemove,
      split: LootLedger.#onSplit,
      addCoins: LootLedger.#onAddCoins,
      spend: LootLedger.#onSpend,
      collect: LootLedger.#onCollect,
      take: LootLedger.#onTake,
      deposit: LootLedger.#onDeposit,
      give: LootLedger.#onGive,
      handOut: LootLedger.#onHandOut,
      openSettings: LootLedger.#onOpenSettings,
      depositCoins: LootLedger.#onDepositCoins,
      withdrawCoins: LootLedger.#onWithdrawCoins,
      undo: LootLedger.#onUndo,
      answer: LootLedger.#onAnswer,
      cancel: LootLedger.#onCancel,
      openJournal: LootLedger.#onOpenJournal
    }
  };

  /** @override */
  static PARTS = {
    main: {template: `${TEMPLATES}/ledger.hbs`, scrollable: [".sll-scroll"]}
  };

  /** The open tab; by default the loot while there is loot, otherwise the party inventory. */
  tab = null;

  /** The character the user acts for. */
  actingId = null;

  /** Search terms of the lists, kept across redraws. */
  filters = {};

  /* -------------------------------------------- */

  /**
   * The characters this user may act for.
   * @returns {Actor[]}
   */
  #ownCharacters() {
    const a = adapter();
    const members = a.partyMembers(setting("recipients"));
    if ( game.user.isGM ) return members;
    const own = game.actors.filter(x => a.isCharacter(x) && x.isOwner);
    return [...new Set([...members.filter(m => m.isOwner), ...own])];
  }

  /**
   * The character the user acts for.
   * @returns {Actor|null}
   */
  #acting() {
    const own = this.#ownCharacters();
    return own.find(x => x.id === this.actingId) ?? own.find(x => x.id === game.user.character?.id) ?? own[0] ?? null;
  }

  /* -------------------------------------------- */

  /** @override */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    // A gear in the title bar opens the module's settings
    const close = frame.querySelector(".window-header [data-action=close]");
    if ( close ) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "header-control icon fa-solid fa-gear";
      button.dataset.action = "openSettings";
      button.dataset.tooltip = t("SLL.OpenSettings");
      button.setAttribute("aria-label", t("SLL.OpenSettings"));
      close.before(button);
    }
    return frame;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const a = adapter();
    const isGM = game.user.isGM;
    const ledger = ledgerActor();
    const on = parts();
    context.ready = !!ledger;
    context.isGM = isGM;
    const stored = storedCoins();
    const hasLoot = areaItems("pool").length || stored.pool;
    const visible = ["stash", (on.loot || hasLoot) && "pool", "log", on.balance && "balance"].filter(Boolean);
    if ( !visible.includes(this.tab) ) this.tab = null;
    this.tab ??= hasLoot ? "pool" : "stash";
    context.tab = this.tab;
    context.tabs = visible.map(id => ({id, label: t(`SLL.Tab.${id}`),
      active: id === this.tab, badge: (id === "pool") && hasLoot ? (areaItems("pool").length || "") : ""}));
    context.lootOn = on.loot;
    context.noGM = !game.users.activeGM;
    if ( !ledger ) return context;

    const members = a.partyMembers(setting("recipients"));
    const acting = this.#acting();
    this.actingId = acting?.id ?? null;
    context.acting = acting ? {id: acting.id, name: acting.name, img: acting.img} : null;
    context.showActing = !!acting && ["stash", "pool"].includes(this.tab);
    context.ownCharacters = this.#ownCharacters().map(x => ({id: x.id, name: x.name, selected: x.id === acting?.id}));
    context.members = members.map(x => ({id: x.id, name: x.name, img: x.img}));
    const all = entries();
    const received = balance(all);
    const rule = setting("distribution");
    const coins = stored;
    const capacity = acting ? a.capacity(acting) : null;

    const itemRow = (item, area) => {
      const qty = a.quantity(item);
      const value = a.value(item, Math.max(qty, 1));
      const contents = a.contents(item).map(i => {
        const n = a.quantity(i);
        return (n > 1) ? `${a.displayName(i)} × ${n}` : a.displayName(i);
      });
      const row = {
        id: item.id, area, name: a.displayName(item), img: item.img, quantity: qty, many: qty > 1,
        value: value ? a.formatCoins(value) : "", worth: value,
        contents: contents.length ? t("SLL.Stash.contains", {list: contents.join(", ")}) : ""
      };
      if ( capacity ) {
        const weight = a.weight(item, Math.max(qty, 1));
        row.heavy = (capacity.value + weight) > capacity.max;
      }
      return row;
    };

    // Loot
    context.pool = areaItems("pool").map(item => {
      const row = itemRow(item, "pool");
      const claims = flag(item, "claims") ?? {};
      row.claims = members.filter(m => claims[m.id])
        .sort((x, y) => CLAIM_RANK[claims[y.id]] - CLAIM_RANK[claims[x.id]])
        .map(m => ({name: m.name, img: m.img, claim: claims[m.id], label: t(`SLL.Claim.${claims[m.id]}`)}));
      row.wanted = row.claims.some(c => c.claim !== "pass");
      row.myClaim = acting ? (claims[acting.id] ?? null) : null;
      row.claimButtons = ["need", "want", "pass"].map(c => ({claim: c, label: t(`SLL.Claim.${c}`),
        active: row.myClaim === c}));
      if ( isGM ) {
        const pick = pickWinner(claims, {rule, received});
        const suggested = pick.winner ?? pick.contenders[0] ?? null;
        row.options = [{id: "", name: "–", selected: !suggested},
          ...members.map(m => ({id: m.id, name: m.name, selected: m.id === suggested}))];
      }
      return row;
    });
    context.poolCoins = coins.pool ? a.formatCoins(coins.pool) : "";
    context.hasPoolCoins = coins.pool > 0;

    // Party inventory, fund and the acting character's things. Who put an item in comes from the log.
    // Loot moved on from the loot keeps its id, so its origin is where the loot came from.
    const lastIn = {pool: new Map(), stash: new Map()};
    for ( const e of all ) {
      if ( (e.to?.kind in lastIn) && e.ref?.itemId ) lastIn[e.to.kind].set(e.ref.itemId, e);
    }
    let stashValue = 0;
    context.stash = areaItems("stash").map(item => {
      const row = itemRow(item, "stash");
      stashValue += row.worth;
      let e = lastIn.stash.get(item.id);
      if ( e?.from?.kind === "pool" ) e = lastIn.pool.get(item.id) ?? e;
      if ( e ) row.origin = t("SLL.Stash.origin", {name: (e.from?.kind === "actor") ? e.from.name : t(`SLL.Place.${e.from?.kind ?? "outside"}`),
        date: new Date(e.time).toLocaleDateString(game.i18n.lang)});
      return row;
    });
    context.stashValue = stashValue ? a.formatCoins(stashValue) : "";
    // Without the loot table the GM moves everything that is left, coins into the fund
    context.hasUnclaimed = on.loot ? context.pool.some(r => !r.wanted)
      : (context.pool.length > 0) || (on.fund && (coins.pool > 0));
    context.fund = a.formatCoins(coins.fund);
    context.coinsAvailable = (a.id !== "generic") || !!a.hasCoins;
    context.fundOn = on.fund;
    context.showFund = context.coinsAvailable && (on.fund || (coins.fund > 0));
    if ( acting ) {
      context.mine = acting.items.filter(i => a.isTransferable(i) && !isContained(i))
        .sort((x, y) => x.name.localeCompare(y.name, game.i18n.lang))
        .map(item => {
          const row = itemRow(item, "mine");
          const reason = isGM ? null : a.blockReason(item);
          row.blocked = reason ? t(reason) : "";
          return row;
        });
      context.purse = a.formatCoins(a.coinsBase(acting));
      context.capacity = capacity ? t("SLL.Stash.capacity", {value: Math.round(capacity.value * 10) / 10,
        max: Math.round(capacity.max * 10) / 10}) : "";
    }

    // Open requests
    context.pending = pendingRequests().filter(r => {
      if ( isGM ) return true;
      if ( r.user === game.user.id ) return true;
      return (r.type === "offer") && game.actors.get(r.payload?.toActorId)?.isOwner;
    }).map(r => ({
      id: r.id, label: r.label, mine: r.user === game.user.id,
      canApprove: isGM && (r.type !== "offer"),
      canAccept: (r.type === "offer") && (game.user.isGM || game.actors.get(r.payload?.toActorId)?.isOwner),
      waiting: t(r.type === "offer" ? "SLL.Pending.waitingOffer" : "SLL.Pending.waitingGM")
    }));

    // Log
    const byId = new Map(all.map(e => [e.id, e]));
    const undone = new Set(all.filter(e => e.kind === "undo").map(e => e.undoes));
    context.log = all.slice(-LOG_LIMIT).reverse().map(e => ({
      id: e.id, seq: e.seq, kind: e.kind,
      time: new Date(e.time).toLocaleString(game.i18n.lang, {dateStyle: "short", timeStyle: "short"}),
      user: e.userName, text: describe(e, byId), img: e.item?.img ?? null,
      value: ((e.item?.value ?? 0) + (e.coins ?? 0)) ? a.formatCoins((e.item?.value ?? 0) + (e.coins ?? 0)) : "",
      undone: undone.has(e.id),
      canUndo: isGM && !["undo", "edit", "remove"].includes(e.kind) && !undone.has(e.id)
    }));
    const check = verify();
    context.check = {ok: check.ok, count: check.count,
      text: check.ok ? t("SLL.Log.intact", {count: check.count})
        : t("SLL.Log.broken", {seq: all[check.brokenAt]?.seq ?? "?"})};

    // Balance
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const session = balance(all, {since: today.getTime()});
    context.balance = members.map(m => ({name: m.name, img: m.img,
      total: a.formatCoins(Math.abs(received[m.id] ?? 0)), totalNegative: (received[m.id] ?? 0) < 0,
      today: a.formatCoins(Math.abs(session[m.id] ?? 0)), todayNegative: (session[m.id] ?? 0) < 0}));
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Search in the lists, without a redraw
    for ( const input of this.element.querySelectorAll("input[data-filter]") ) {
      const key = input.dataset.filter;
      const list = this.element.querySelector(`[data-list="${key}"]`);
      input.value = this.filters[key] ?? "";
      const apply = () => {
        this.filters[key] = input.value;
        const term = input.value.trim().toLowerCase();
        for ( const row of list?.querySelectorAll("[data-item-id]") ?? [] ) {
          row.hidden = !!term && !row.dataset.name.toLowerCase().includes(term);
        }
      };
      input.addEventListener("input", apply);
      apply();
    }
    const select = this.element.querySelector("select[name=acting]");
    select?.addEventListener("change", () => {
      this.actingId = select.value;
      this.render();
    });
    for ( const zone of this.element.querySelectorAll("[data-drop]") ) {
      zone.addEventListener("dragover", event => {
        event.preventDefault();
        zone.classList.add("sll-drag-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("sll-drag-over"));
      zone.addEventListener("drop", event => {
        zone.classList.remove("sll-drag-over");
        this.#onDrop(event, zone.dataset.drop);
      });
    }
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /**
   * Drop an item on the loot or the stash.
   * @param {DragEvent} event
   * @param {"pool"|"stash"} area
   */
  async #onDrop(event, area) {
    event.preventDefault();
    const TE = foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    const data = TE.getDragEventData(event);
    if ( data?.type !== "Item" ) return;
    const item = await Item.implementation.fromDropData(data);
    if ( !item ) return;
    if ( game.user.isGM ) {
      const onActor = (item.parent instanceof Actor) && item.id && item.parent.items.get(item.id);
      const payload = onActor ? {area, uuids: [item.uuid]} : {area, data: [item.toObject()]};
      report(await request("addItems", payload));
      return;
    }
    if ( (area !== "stash") || !(item.parent instanceof Actor) || !item.parent.isOwner ) {
      ui.notifications.warn(t("SLL.Error.dropOwn"));
      return;
    }
    const quantity = await askQuantity(t("SLL.Stash.deposit"), adapter().quantity(item));
    if ( !quantity ) return;
    report(await request("deposit", {actorId: item.parent.id, itemId: item.id, quantity}));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * The item id of a clicked row.
   * @param {HTMLElement} target
   * @returns {string}
   */
  static #itemId(target) {
    return target.closest("[data-item-id]")?.dataset.itemId;
  }

  /**
   * The quantity of an item on the ledger actor or the acting character.
   * @param {string} itemId
   * @param {Actor} [actor]
   * @returns {number}
   */
  static #quantity(itemId, actor) {
    const item = (actor ?? ledgerActor())?.items.get(itemId);
    return item ? Math.max(adapter().quantity(item), 1) : 1;
  }

  /** @this {LootLedger} */
  static #onTab(event, target) {
    this.tab = target.dataset.tab;
    this.render();
  }

  /** @this {LootLedger} */
  static async #onClaim(event, target) {
    const acting = this.#acting();
    if ( !acting ) return ui.notifications.warn(t("SLL.Error.noCharacter"));
    const itemId = LootLedger.#itemId(target);
    const item = ledgerActor()?.items.get(itemId);
    const current = flag(item, `claims.${acting.id}`);
    const claim = (current === target.dataset.claim) ? null : target.dataset.claim;
    report(await request("claim", {itemId, actorId: acting.id, claim}));
  }

  /** @this {LootLedger} */
  static async #onAward(event, target) {
    const row = target.closest("[data-item-id]");
    const actorId = row.querySelector("select[name=winner]")?.value;
    if ( !actorId ) return ui.notifications.warn(t("SLL.Error.noCharacter"));
    const itemId = row.dataset.itemId;
    const quantity = await askQuantity(t("SLL.Pool.award"), LootLedger.#quantity(itemId));
    if ( !quantity ) return;
    report(await request("award", {itemId, actorId, quantity}));
  }

  /** @this {LootLedger} */
  static async #onDistribute() {
    if ( !await confirm(t("SLL.Pool.distribute"), t(`SLL.Pool.distributeConfirm.${setting("distribution")}`)) ) return;
    report(await request("distribute", {}));
  }

  /** @this {LootLedger} */
  static async #onUnclaimed() {
    report(await request("unclaimedToStash", {}));
  }

  /** @this {LootLedger} */
  static async #onToStash(event, target) {
    const itemId = LootLedger.#itemId(target);
    const quantity = await askQuantity(t("SLL.Pool.toStash"), LootLedger.#quantity(itemId));
    if ( !quantity ) return;
    report(await request("moveArea", {itemId, to: "stash", quantity}));
  }

  /** @this {LootLedger} */
  static async #onToPool(event, target) {
    const itemId = LootLedger.#itemId(target);
    const quantity = await askQuantity(t("SLL.Stash.toPool"), LootLedger.#quantity(itemId));
    if ( !quantity ) return;
    report(await request("moveArea", {itemId, to: "pool", quantity}));
  }

  /** @this {LootLedger} */
  static async #onRemove(event, target) {
    const row = target.closest("[data-item-id]");
    if ( !await confirm(t("SLL.Pool.remove"), t("SLL.Pool.removeConfirm", {name: row.dataset.name ?? ""})) ) return;
    report(await request("removeItem", {itemId: row.dataset.itemId, area: row.dataset.area}));
  }

  /** @this {LootLedger} */
  static async #onSplit() {
    const members = adapter().partyMembers(setting("recipients"));
    const ids = await askSplit(members);
    if ( !ids?.length ) return;
    report(await request("split", {actorIds: ids}));
  }

  /** @this {LootLedger} */
  static async #onAddCoins(event, target) {
    const area = target.dataset.area;
    const input = await askCoins(t(area === "fund" ? "SLL.Stash.addFund" : "SLL.Pool.addCoins"), {note: true});
    if ( !input ) return;
    report(await request("addCoins", {area, amount: adapter().toBase(input.coins), note: input.note}));
  }

  /** @this {LootLedger} */
  static async #onSpend() {
    const input = await askCoins(t("SLL.Stash.spend"), {note: true});
    if ( !input ) return;
    report(await request("spend", {amount: adapter().toBase(input.coins), note: input.note}));
  }

  /** @this {LootLedger} */
  static async #onCollect() {
    await openCollect();
  }

  /** @this {LootLedger} */
  static async #onTake(event, target) {
    const acting = this.#acting();
    if ( !acting ) return ui.notifications.warn(t("SLL.Error.noCharacter"));
    const itemId = LootLedger.#itemId(target);
    const quantity = await askQuantity(t("SLL.Stash.take"), LootLedger.#quantity(itemId));
    if ( !quantity ) return;
    report(await request("withdraw", {actorId: acting.id, itemId, quantity}));
  }

  /** @this {LootLedger} */
  static async #onDeposit(event, target) {
    const acting = this.#acting();
    if ( !acting ) return;
    const itemId = LootLedger.#itemId(target);
    const quantity = await askQuantity(t("SLL.Stash.deposit"), LootLedger.#quantity(itemId, acting));
    if ( !quantity ) return;
    report(await request("deposit", {actorId: acting.id, itemId, quantity}));
  }

  /** @this {LootLedger} */
  static async #onGive(event, target) {
    const acting = this.#acting();
    if ( !acting ) return;
    const itemId = LootLedger.#itemId(target);
    const a = adapter();
    const others = [...new Set([...a.partyMembers(setting("recipients")),
      ...game.actors.filter(x => a.isCharacter(x) && x.hasPlayerOwner)])].filter(x => x !== acting);
    const choice = await askRecipient(t("SLL.Stash.give"), others, LootLedger.#quantity(itemId, acting));
    if ( !choice ) return;
    report(await request("give", {fromActorId: acting.id, itemId, quantity: choice.quantity, toActorId: choice.actorId}));
  }

  /** GM: hand an item of the party inventory to a character. @this {LootLedger} */
  static async #onHandOut(event, target) {
    const itemId = LootLedger.#itemId(target);
    const a = adapter();
    const members = [...new Set([...a.partyMembers(setting("recipients")),
      ...game.actors.filter(x => a.isCharacter(x) && x.hasPlayerOwner)])];
    const choice = await askRecipient(t("SLL.Stash.handOut"), members, LootLedger.#quantity(itemId));
    if ( !choice ) return;
    report(await request("withdraw", {actorId: choice.actorId, itemId, quantity: choice.quantity}));
  }

  /** Open Foundry's settings on the tab of this module. @this {LootLedger} */
  static async #onOpenSettings() {
    const sheet = game.settings.sheet;
    await sheet.render({force: true});
    try {
      sheet.changeTab(MODULE_ID, "categories");
    } catch(err) {
      console.warn(`${MODULE_ID} | The settings have no tab for this module`, err);
    }
    sheet.bringToFront?.();
  }

  /** @this {LootLedger} */
  static async #onDepositCoins() {
    const acting = this.#acting();
    if ( !acting ) return;
    const input = await askCoins(t("SLL.Stash.depositCoins"), {byCoin: adapter().separateCoins});
    if ( !input ) return;
    report(await request("depositCoins", {actorId: acting.id, coins: input.coins}));
  }

  /** @this {LootLedger} */
  static async #onWithdrawCoins() {
    const acting = this.#acting();
    if ( !acting ) return;
    const input = await askCoins(t("SLL.Stash.withdrawCoins"), {note: true});
    if ( !input ) return;
    report(await request("withdrawCoins", {actorId: acting.id, amount: adapter().toBase(input.coins), note: input.note}));
  }

  /** @this {LootLedger} */
  static async #onUndo(event, target) {
    const id = target.closest("[data-entry-id]")?.dataset.entryId;
    if ( !await confirm(t("SLL.Log.undoTitle"), t("SLL.Log.undoConfirm")) ) return;
    report(await request("undo", {entryId: id}));
  }

  /** @this {LootLedger} */
  static async #onAnswer(event, target) {
    const row = target.closest("[data-request-id]");
    const yes = target.dataset.answer === "yes";
    const action = (row.dataset.type === "offer") ? "answerOffer" : "answerApproval";
    report(await request(action, {id: row.dataset.requestId, approve: yes, accept: yes}));
  }

  /** @this {LootLedger} */
  static async #onCancel(event, target) {
    report(await request("cancelRequest", {id: target.closest("[data-request-id]")?.dataset.requestId}));
  }

  /** @this {LootLedger} */
  static #onOpenJournal() {
    const journal = game.journal.find(j => flag(j, "ledger"));
    journal?.sheet?.render(true);
  }
}
