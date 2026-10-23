/**
 * D&D 5e (5.x). Coins are kept separately (pp, gp, ep, sp, cp) on characters, NPCs, groups and containers. Physical
 * items have a quantity, a weight and a price; containers carry their contents along. Things to reset when an item
 * changes hands: equipped, attuned and prepared, also for everything inside a container (dnd5e's own drag and drop
 * forgets the contents), and the place in a container.
 */

import {MODULE_ID} from "../config.mjs";
import {applyCoinValues} from "../coins.mjs";
import {BaseAdapter, sameData, stackCompare} from "./base.mjs";

/** The coins payouts are made in; platinum and electrum stay with those who already have them. */
const PAYOUT = ["gp", "sp", "cp"];

export class Dnd5eAdapter extends BaseAdapter {

  id = "dnd5e";

  characterTypes = ["character"];

  separateCoins = true;

  /** Tables with their own exchange rates set the worth of each coin in the module settings. */
  coinValuesConfigurable = true;

  /** @override */
  stashType() {
    return "group";
  }

  /** @override */
  systemParty() {
    const party = game.actors.party;
    return party?.system?.playerCharacters ?? party?.system?.members?.map(m => m.actor).filter(Boolean) ?? [];
  }

  /** @override */
  isDefeated(combatant) {
    const hp = combatant?.actor?.system?.attributes?.hp?.value;
    return !!combatant?.isDefeated || (Number.isFinite(hp) && (hp <= 0));
  }

  /* -------------------------------------------- */

  /** @override */
  isTransferable(item) {
    const s = item?.system;
    if ( !s || !("quantity" in s) || !("weight" in s) ) return false;
    return !item.getFlag?.("dnd5e", "cachedFor");
  }

  /** @override */
  unitValue(item) {
    const price = item?.system?.price;
    const value = Number(price?.value) || 0;
    const denom = this.denominations().find(d => d.key === (price?.denomination ?? "gp"));
    return Math.max(Math.round(value * (denom?.value ?? 100)), 0);
  }

  /** @override */
  weight(item, quantity) {
    if ( item?.type === "container" ) return Number(item.system.totalWeight) || 0;
    return (Number(item?.system?.weight?.value) || 0) * quantity;
  }

  /** @override */
  capacity(actor) {
    const enc = actor?.system?.attributes?.encumbrance;
    const max = enc?.thresholds?.maximum ?? enc?.max;
    return (enc && (max > 0)) ? {value: enc.value, max} : null;
  }

  /** @override */
  cleanData(data) {
    const s = data.system ?? {};
    delete s.equipped;
    delete s.attuned;
    delete s.prepared;
    if ( s.crew ) delete s.crew.value;
    return data;
  }

  /** @override */
  async transferData(item, quantity) {
    if ( item.type !== "container" ) {
      const [data] = await super.transferData(item, quantity);
      data.system.container = null;
      return [data];
    }
    const transformAll = doc => {
      const data = doc.toObject();
      delete data._id;
      return this.cleanData(data);
    };
    const created = await CONFIG.Item.documentClass.createWithContents([item], {transformAll});
    for ( const data of created ) {
      if ( data.system?.container === undefined ) data.system.container = null;
    }
    return created;
  }

  /** @override */
  findStack(target, data, filter=() => true) {
    if ( data.type === "container" ) return null;
    for ( const item of target.items ) {
      if ( !filter(item) || (item.type !== data.type) || (item._source.name !== data.name) ) continue;
      if ( item.system.container || item.system.equipped || item.system.attuned ) continue;
      const a = stackCompare(item.toObject(), this);
      const b = stackCompare(data, this);
      for ( const d of [a, b] ) {
        delete d.system.container;
        delete d.system.equipped;
        delete d.system.attuned;
      }
      if ( sameData(a, b) ) return item;
    }
    return null;
  }

  /* -------------------------------------------- */

  /** @override */
  denominations() {
    return applyCoinValues(this.systemDenominations(), customCoinValues());
  }

  /**
   * The coins with the exchange rates of the system (CONFIG.DND5E.currencies), worth in the smallest coin.
   * @returns {import("../coins.mjs").Denomination[]}
   */
  systemDenominations() {
    const config = CONFIG.DND5E?.currencies ?? {};
    const max = Math.max(...Object.values(config).map(c => Number(c.conversion) || 0), 1);
    return Object.entries(config).map(([key, c]) => ({key, value: Math.round(max / (Number(c.conversion) || 1)),
      abbr: game.i18n.localize(c.abbreviation ?? key)}));
  }

  /** @override */
  payoutDenominations() {
    const all = this.denominations();
    const some = all.filter(d => PAYOUT.includes(d.key));
    return some.length ? some : all;
  }

  /** @override */
  mainCoin() {
    return CONFIG.DND5E?.defaultCurrency ?? "gp";
  }

  /** @override */
  purse(actor) {
    return {...(actor?.system?.currency ?? {})};
  }

  /** @override */
  coinsBase(actor) {
    return this.toBase(this.purse(actor));
  }

  /** @override */
  payUpdate(actor, coins) {
    const purse = this.purse(actor);
    let pay = coins;
    if ( typeof coins === "number" ) pay = pickCoins(purse, coins, this.denominations());
    if ( !pay || !this.canPay(actor, pay) ) throw new Error("SLL.Error.notEnoughCoins");
    return {"system.currency": this.changePurse(purse, pay, -1)};
  }

  /** @override */
  receiveUpdate(actor, base) {
    const coins = {};
    let rest = Math.max(Math.floor(base), 0);
    for ( const d of [...this.payoutDenominations()].sort((a, b) => b.value - a.value) ) {
      const count = Math.floor(rest / d.value);
      if ( count ) coins[d.key] = count;
      rest -= count * d.value;
    }
    return {"system.currency": this.changePurse(this.purse(actor), coins, 1)};
  }

  /** @override */
  selfTest() {
    const problems = [];
    if ( !CONFIG.DND5E?.currencies ) problems.push("SLL.SELFTEST.Coins");
    if ( typeof CONFIG.Item.documentClass?.createWithContents !== "function" ) problems.push("SLL.SELFTEST.Containers");
    if ( !(game.documentTypes?.Actor ?? []).includes("group") ) problems.push("SLL.SELFTEST.StashType");
    return problems;
  }
}

/**
 * The coin values the GM set, safely before the settings exist.
 * @returns {Record<string, number>}
 */
function customCoinValues() {
  try {
    return game.settings.get(MODULE_ID, "coinValues") ?? {};
  } catch {
    return {};
  }
}

/**
 * Pick exact coins from a purse for an amount, from the most valuable coin down, without making change.
 * @param {Record<string, number>} purse
 * @param {number} base
 * @param {import("../coins.mjs").Denomination[]} denominations
 * @returns {Record<string, number>|null}
 */
export function pickCoins(purse, base, denominations) {
  let rest = Math.max(Math.floor(base), 0);
  const coins = {};
  for ( const d of [...denominations].sort((a, b) => b.value - a.value) ) {
    const count = Math.min(Math.floor(rest / d.value), Number(purse?.[d.key]) || 0);
    if ( count ) coins[d.key] = count;
    rest -= count * d.value;
  }
  return rest === 0 ? coins : null;
}
