/**
 * The merchant window (GM): pick items of the party inventory, set the offer, haggle if you like and sell. The window
 * only holds what the GM chose; the haggle roll and the sale are requests, like every change in this module.
 */

import {TEMPLATES, parts, setting, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {clampShare, offerOf} from "./merchant-logic.mjs";
import {areaItems} from "./storage.mjs";
import {report, request} from "./transport.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** The id of the window. */
const WINDOW_ID = "sll-merchant";

/**
 * Open the merchant window (GM).
 * @returns {Promise<MerchantWindow|null>}
 */
export async function openMerchant() {
  if ( !game.user.isGM ) return null;
  const existing = foundry.applications.instances.get(WINDOW_ID);
  const app = existing ?? new MerchantWindow();
  if ( existing?.rendered ) {
    app.render();
    app.bringToFront();
  }
  else await app.render({force: true});
  return app;
}

/* -------------------------------------------- */

export class MerchantWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: WINDOW_ID,
    classes: ["sll-ledger", "sll-merchant-app"],
    window: {title: "SLL.Merchant.title", icon: "fa-solid fa-store", resizable: true},
    position: {width: 560, height: 640},
    actions: {
      roll: MerchantWindow.#onRoll,
      sell: MerchantWindow.#onSell,
      cancel: MerchantWindow.#onCancel,
      all: MerchantWindow.#onAll
    }
  };

  /** @override */
  static PARTS = {
    main: {template: `${TEMPLATES}/merchant.hbs`, scrollable: [".sll-scroll"]}
  };

  /** The ids of the items picked. */
  picked = new Set();

  /** How many units of an item to sell, by id (kept while the item is not picked). */
  quantities = new Map();

  /** The offer as a share of the value, in percent. */
  share = null;

  /** The name of the merchant. */
  merchant = "";

  /** Where the proceeds go: "fund" or "split". */
  payout = null;

  /** The characters who share the proceeds. */
  split = null;

  /** The character who haggles. */
  haggler = null;

  /** The result of the haggle, once rolled. */
  haggle = null;

  /** Waiting for an answer, so a click cannot send twice. */
  busy = false;

  /* -------------------------------------------- */

  /**
   * The characters of the party.
   * @returns {Actor[]}
   */
  #members() {
    return adapter().partyMembers(setting("recipients"));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const a = adapter();
    const on = parts();
    this.share ??= clampShare(setting("merchantShare"));
    this.payout ??= on.fund ? "fund" : "split";
    if ( !on.fund ) this.payout = "split";
    const members = this.#members();
    this.split ??= new Set(members.map(m => m.id));
    this.haggler = members.find(m => m.id === this.haggler)?.id ?? members[0]?.id ?? null;

    // Items which are gone from the party inventory drop out of the choice
    const rows = areaItems("stash").map(item => {
      const max = Math.max(a.quantity(item), 1);
      const value = a.value(item, max);
      return {item, max, value};
    }).filter(r => r.value > 0);
    for ( const id of [...this.picked] ) if ( !rows.some(r => r.item.id === id) ) this.picked.delete(id);

    let base = 0;
    context.items = rows.map(({item, max}) => {
      const on = this.picked.has(item.id);
      const quantity = Math.min(Math.max(this.quantities.get(item.id) ?? max, 1), max);
      const value = a.value(item, quantity);
      if ( on ) base += value;
      return {id: item.id, img: a.displayImg(item), name: a.displayName(item), max, many: max > 1, quantity, on,
        value: a.formatCoins(value)};
    });

    const limit = Number(setting("merchantHaggleLimit")) || 0;
    context.canHaggle = a.canHaggle && (limit > 0) && (members.length > 0);
    context.limit = limit;
    const adjust = this.haggle?.adjust ?? 0;
    const offer = offerOf(base, this.share, adjust);
    context.share = this.share;
    context.merchant = this.merchant;
    context.hasItems = rows.length > 0;
    context.picked = this.picked.size;
    context.base = a.formatCoins(base);
    context.offer = a.formatCoins(offer);
    context.shareOffer = a.formatCoins(offerOf(base, this.share, 0));
    context.canSell = !!this.picked.size && (offer > 0) && !this.busy
      && ((this.payout === "fund") || this.split.size > 0);
    context.fundOn = on.fund;
    context.toFund = this.payout === "fund";
    context.members = members.map(m => ({id: m.id, name: m.name, img: m.img, on: this.split.has(m.id),
      haggler: m.id === this.haggler}));
    if ( this.haggle ) {
      context.haggle = {...this.haggle, signed: `${(adjust > 0) ? "+" : ""}${adjust}`,
        text: t("SLL.Merchant.haggled", {actor: this.haggle.actor, skill: this.haggle.skill, total: this.haggle.total,
          baseline: this.haggle.baseline, adjust: `${(adjust > 0) ? "+" : ""}${adjust}`, limit: this.haggle.limit})};
    }
    context.canRoll = !this.haggle && !this.busy && (this.picked.size > 0);
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    const read = (selector, fn) => {
      for ( const input of root.querySelectorAll(selector) ) input.addEventListener("change", () => fn(input));
    };
    read("input[data-pick]", input => {
      const id = input.closest("[data-item-id]").dataset.itemId;
      if ( input.checked ) this.picked.add(id);
      else this.picked.delete(id);
      this.render();
    });
    read("input[data-quantity]", input => {
      const id = input.closest("[data-item-id]").dataset.itemId;
      const max = Number(input.max) || 1;
      this.quantities.set(id, Math.min(Math.max(Math.floor(Number(input.value) || 1), 1), max));
      this.render();
    });
    read("input[name=share]", input => {
      this.share = clampShare(input.value, this.share);
      this.render();
    });
    root.querySelector("input[name=merchant]")?.addEventListener("input", event => {
      this.merchant = event.target.value;
    });
    read("input[name=payout]", input => {
      this.payout = input.value;
      this.render();
    });
    read("input[data-split]", input => {
      if ( input.checked ) this.split.add(input.dataset.split);
      else this.split.delete(input.dataset.split);
      this.render();
    });
    read("select[name=haggler]", select => {
      this.haggler = select.value;
    });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** Pick everything, or nothing when everything is picked. @this {MerchantWindow} */
  static #onAll() {
    const rows = [...this.element.querySelectorAll("[data-item-id]")];
    const every = rows.length && rows.every(r => this.picked.has(r.dataset.itemId));
    this.picked.clear();
    if ( !every ) for ( const row of rows ) this.picked.add(row.dataset.itemId);
    this.render();
  }

  /** One character rolls the haggle. @this {MerchantWindow} */
  static async #onRoll() {
    if ( this.busy || this.haggle || !this.haggler ) return;
    this.busy = true;
    this.render();
    const result = await request("merchantHaggle", {actorId: this.haggler});
    this.busy = false;
    if ( report(result) ) this.haggle = result.haggle;
    this.render();
  }

  /** Sell what is picked. @this {MerchantWindow} */
  static async #onSell() {
    if ( this.busy || !this.picked.size ) return;
    this.busy = true;
    this.render();
    const items = [...this.picked].map(itemId => ({itemId, quantity: this.quantities.get(itemId)}));
    const result = await request("merchantSale", {items, share: this.share, merchant: this.merchant, haggle: this.haggle,
      payout: this.payout, actorIds: [...this.split]});
    this.busy = false;
    if ( report(result) ) await this.close();
    else this.render();
  }

  /** @this {MerchantWindow} */
  static async #onCancel() {
    await this.close();
  }
}
