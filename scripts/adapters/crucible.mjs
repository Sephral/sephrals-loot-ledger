/**
 * Crucible (0.11). Coins are one amount in copper on heroes and adversaries. Physical items are weapons, armor,
 * accessories, consumables, tools, loot and schematics; natural weapons and armor stay with their creature.
 * Things to reset when an item changes hands: equipped, invested and dropped, and the flag which makes adversary gear
 * scale with the owner's level (an adversary sword would otherwise change its quality when the hero levels up).
 * Equipping and unequipping is an action with AP costs in combat, so players cannot hand over equipped gear then.
 */

import {formatCoins} from "../coins.mjs";
import {BaseAdapter, sameData, stackCompare} from "./base.mjs";

export class CrucibleAdapter extends BaseAdapter {

  id = "crucible";

  characterTypes = ["hero"];

  separateCoins = false;

  /**
   * The party inventory is an adversary actor: Crucible's group actors have no equipment or abilities, and weapons and
   * armor need both to prepare their data. An adversary without taxonomy and archetype is a plain container.
   * @override
   */
  stashType() {
    return "adversary";
  }

  /** @override */
  systemParty() {
    const actors = globalThis.crucible?.party?.system?.actors;
    return actors ? [...actors] : [];
  }

  /** @override */
  isDefeated(combatant) {
    return !!combatant?.isDefeated || !!combatant?.actor?.statuses?.has("dead");
  }

  /* -------------------------------------------- */

  /** @override */
  isTransferable(item) {
    const Physical = globalThis.crucible?.api?.models?.CruciblePhysicalItem;
    if ( !item || !Physical || !(item.system instanceof Physical) ) return false;
    return !item.system.properties?.has?.("natural");
  }

  /** @override */
  blockReason(item) {
    const s = item?.system ?? {};
    if ( s.invested && s.isCursed ) return "SLL.Block.cursed";
    if ( s.equipped && item.parent?.inCombat ) return "SLL.Block.equippedInCombat";
    return null;
  }

  /** @override */
  unitValue(item) {
    return Math.max(Number(item?.system?.price) || 0, 0);
  }

  /** @override */
  weight(item, quantity) {
    return (Number(item?.system?.weight) || 0) * quantity;
  }

  /** @override */
  capacity(actor) {
    const c = actor?.system?.capacity;
    return (c && (c.max > 0)) ? {value: c.value, max: c.max} : null;
  }

  /** @override */
  cleanData(data) {
    // Only the fields the item type has, so the data still compares equal to an existing stack
    for ( const key of ["equipped", "invested", "dropped"] ) {
      if ( data.system && (key in data.system) ) data.system[key] = false;
    }
    if ( data.flags?.crucible ) delete data.flags.crucible.autoScale;
    return data;
  }

  /** @override */
  findStack(target, data, filter=() => true) {
    for ( const item of target.items ) {
      if ( !filter(item) || (item.type !== data.type) || (item.name !== data.name) ) continue;
      if ( item.system.equipped || !item.system.properties?.has?.("stackable") || item.effects.size ) continue;
      if ( data.effects?.length ) continue;
      if ( sameData(stackCompare(item.toObject(), this), stackCompare(data, this)) ) return item;
    }
    return null;
  }

  /* -------------------------------------------- */

  /** @override */
  denominations() {
    const config = globalThis.crucible?.CONFIG?.currency ?? {};
    return Object.entries(config).map(([key, d]) => ({key, value: Number(d.multiplier) || 1,
      abbr: game.i18n.localize(d.abbreviation ?? key)}));
  }

  /** @override */
  mainCoin() {
    return "gp";
  }

  /** @override */
  coinsBase(actor) {
    return Math.max(Number(actor?.system?.currency) || 0, 0);
  }

  /** @override */
  payUpdate(actor, coins) {
    const base = this.toBase(coins);
    const current = this.coinsBase(actor);
    if ( current < base ) throw new Error("SLL.Error.notEnoughCoins");
    return {"system.currency": current - base};
  }

  /** @override */
  receiveUpdate(actor, base) {
    return {"system.currency": this.coinsBase(actor) + Math.max(Math.floor(base), 0)};
  }

  /** @override */
  formatCoins(base) {
    const format = CONFIG.Item.documentClass?.formatCurrency;
    try {
      if ( typeof format === "function" ) return format.call(CONFIG.Item.documentClass, base);
    } catch {}
    return formatCoins(base, this.denominations());
  }

  /** @override */
  selfTest() {
    const problems = [];
    if ( !globalThis.crucible?.api?.models?.CruciblePhysicalItem ) problems.push("SLL.SELFTEST.CruciblePhysical");
    if ( !this.denominations().length ) problems.push("SLL.SELFTEST.Coins");
    if ( !Object.keys(CONFIG.Actor.dataModels ?? {}).includes("adversary") ) problems.push("SLL.SELFTEST.StashType");
    return problems;
  }
}
