/**
 * The adapter interface and its defaults. An adapter knows how one game system stores coins and items: what can be
 * handed over, how much it is worth, what has to be reset when it changes hands and who belongs to the party. The core
 * of the module only talks to the adapter. Systems without an own adapter use the generic one (generic.mjs), other
 * modules can register more adapters through the module API.
 */

import {canPay, changePurse, formatCoins, payout, sortDenominations, toBase} from "../coins.mjs";

/**
 * @typedef {import("../coins.mjs").Denomination} Denomination
 */

export class BaseAdapter {

  /** The system id the adapter is for. */
  id = "generic";

  /** Actor types of player characters. Subclasses override it with a field or a getter. */
  get characterTypes() {
    return ["character"];
  }

  /** Do actors of this system keep each coin type separately (true) or one amount (false)? */
  separateCoins = false;

  /** Where the quantity of an item is stored. */
  get quantityPath() {
    return "system.quantity";
  }

  /* -------------------------------------------- */
  /*  Actors                                      */
  /* -------------------------------------------- */

  /**
   * The actor type of the ledger actor which holds the loot and the stash.
   * @returns {string}
   */
  stashType() {
    const types = (game.documentTypes?.Actor ?? Object.keys(CONFIG.Actor.dataModels ?? {})).filter(t => t !== "base");
    return types.includes("group") ? "group" : (types[0] ?? "base");
  }

  /**
   * Is an actor a player character?
   * @param {Actor} actor
   * @returns {boolean}
   */
  isCharacter(actor) {
    return !!actor && this.characterTypes.includes(actor.type);
  }

  /**
   * The system's party, if the system has one.
   * @returns {Actor[]}
   */
  systemParty() {
    return [];
  }

  /**
   * The characters who share the loot: the system's party, or every player character with an owner.
   * @param {"party"|"players"} [mode="party"]
   * @returns {Actor[]}
   */
  partyMembers(mode="party") {
    const party = (mode === "party") ? this.systemParty().filter(a => this.isCharacter(a)) : [];
    const list = party.length ? party : game.actors.filter(a => this.isCharacter(a) && a.hasPlayerOwner);
    return [...new Set(list)].sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  }

  /**
   * Is a combatant defeated, so its belongings may become loot?
   * @param {Combatant} combatant
   * @returns {boolean}
   */
  isDefeated(combatant) {
    return !!combatant?.isDefeated;
  }

  /* -------------------------------------------- */
  /*  Items                                       */
  /* -------------------------------------------- */

  /**
   * Can an item change hands?
   * @param {Item} item
   * @returns {boolean}
   */
  isTransferable(item) {
    return !!item && foundry.utils.hasProperty(item, this.quantityPath);
  }

  /**
   * Why a player may not hand over an item right now (the GM may), as a localization key.
   * @param {Item} item
   * @returns {string|null}
   */
  blockReason(item) {
    return null;
  }

  /**
   * The quantity of an item or of item data.
   * @param {Item|object} doc
   * @returns {number}
   */
  quantity(doc) {
    return Math.max(Math.floor(Number(foundry.utils.getProperty(doc, this.quantityPath)) || 0), 0);
  }

  /**
   * Set the quantity of item data.
   * @param {object} data
   * @param {number} quantity
   */
  setQuantity(data, quantity) {
    foundry.utils.setProperty(data, this.quantityPath, quantity);
  }

  /**
   * The worth of one unit of an item in base units.
   * @param {Item} item
   * @returns {number}
   */
  unitValue(item) {
    return 0;
  }

  /**
   * The items directly inside a container of the same actor. They travel with the container.
   * @param {Item} item
   * @returns {Item[]}
   */
  contents(item) {
    if ( !item?.id || !item.parent?.items ) return [];
    return item.parent.items.filter(i => i.system?.container === item.id);
  }

  /**
   * The worth of a number of units of an item in base units, a container with its contents.
   * @param {Item} item
   * @param {number} quantity
   * @param {number} [depth]
   * @returns {number}
   */
  value(item, quantity, depth=0) {
    const own = this.unitValue(item) * quantity;
    if ( depth > 10 ) return own;
    return this.contents(item).reduce((sum, i) => sum + this.value(i, this.quantity(i) || 1, depth + 1), own);
  }

  /**
   * The weight of a number of units of an item.
   * @param {Item} item
   * @param {number} quantity
   * @returns {number}
   */
  weight(item, quantity) {
    return 0;
  }

  /**
   * How much an actor carries and may carry.
   * @param {Actor} actor
   * @returns {{value: number, max: number}|null}
   */
  capacity(actor) {
    return null;
  }

  /**
   * The name of an item as players may see it.
   * @param {Item} item
   * @returns {string}
   */
  displayName(item) {
    return item.name;
  }

  /**
   * Reset what must not travel with an item to another owner (equipped, attuned and similar).
   * @param {object} data   Item data, changed in place
   * @returns {object}
   */
  cleanData(data) {
    return data;
  }

  /**
   * The create data for handing over a number of units of an item. Containers bring their contents.
   * @param {Item} item
   * @param {number} quantity
   * @returns {Promise<object[]>}
   */
  async transferData(item, quantity) {
    const data = item.toObject();
    delete data._id;
    this.setQuantity(data, quantity);
    this.cleanData(data);
    return [data];
  }

  /**
   * The ids to delete when an item leaves its actor: the item and everything inside it. Deleting the contents in the
   * same operation keeps them out of the log as changes made past the module.
   * @param {Item} item
   * @param {number} [depth]
   * @returns {string[]}
   */
  deleteIds(item, depth=0) {
    const ids = [item.id];
    if ( depth > 10 ) return ids;
    for ( const i of this.contents(item) ) ids.push(...this.deleteIds(i, depth + 1));
    return ids;
  }

  /**
   * An item of the target the data can be stacked onto.
   * @param {Actor} target
   * @param {object} data
   * @param {(item: Item) => boolean} [filter]   Only items which pass (for example one area of the ledger actor)
   * @returns {Item|null}
   */
  findStack(target, data, filter=() => true) {
    return target.items.find(i => filter(i) && (i.type === data.type) && (i.name === data.name)
      && sameData(stackCompare(i.toObject(), this), stackCompare(data, this))) ?? null;
  }

  /* -------------------------------------------- */
  /*  Coins                                       */
  /* -------------------------------------------- */

  /**
   * The coins of the system.
   * @returns {Denomination[]}
   */
  denominations() {
    return [{key: "gp", value: 1, abbr: "gp"}];
  }

  /**
   * The coins payouts are made in.
   * @returns {Denomination[]}
   */
  payoutDenominations() {
    return this.denominations();
  }

  /**
   * The coin a plain number counts in.
   * @returns {string}
   */
  mainCoin() {
    return sortDenominations(this.denominations()).at(-1)?.key ?? "gp";
  }

  /**
   * The coins an actor has, by coin.
   * @param {Actor} actor
   * @returns {Record<string, number>}
   */
  purse(actor) {
    return payout(this.coinsBase(actor), this.denominations());
  }

  /**
   * The worth of an actor's coins in base units.
   * @param {Actor} actor
   * @returns {number}
   */
  coinsBase(actor) {
    return 0;
  }

  /**
   * Can an actor pay these coins?
   * @param {Actor} actor
   * @param {Record<string, number>|number} coins   Coins by coin, or base units
   * @returns {boolean}
   */
  canPay(actor, coins) {
    if ( typeof coins === "number" ) return this.coinsBase(actor) >= coins;
    if ( this.separateCoins ) return canPay(this.purse(actor), coins);
    return this.coinsBase(actor) >= toBase(coins, this.denominations());
  }

  /**
   * The actor update which takes coins from an actor.
   * @param {Actor} actor
   * @param {Record<string, number>|number} coins
   * @returns {object}
   */
  payUpdate(actor, coins) {
    throw new Error("This system has no coins the module can change");
  }

  /**
   * The actor update which gives an actor coins worth a number of base units.
   * @param {Actor} actor
   * @param {number} base
   * @returns {object}
   */
  receiveUpdate(actor, base) {
    throw new Error("This system has no coins the module can change");
  }

  /**
   * An amount as text.
   * @param {number} base
   * @returns {string}
   */
  formatCoins(base) {
    return formatCoins(base, this.payoutDenominations());
  }

  /**
   * Base units of a set of coins.
   * @param {Record<string, number>|number} coins
   * @returns {number}
   */
  toBase(coins) {
    return (typeof coins === "number") ? coins : toBase(coins, this.denominations());
  }

  /**
   * Add coins to a purse map (separate coins only).
   * @param {Record<string, number>} purse
   * @param {Record<string, number>} coins
   * @param {number} sign
   * @returns {Record<string, number>}
   */
  changePurse(purse, coins, sign) {
    return changePurse(purse, coins, sign);
  }

  /**
   * Problems with the system integration, as localization keys or texts.
   * @returns {string[]}
   */
  selfTest() {
    return [];
  }
}

/**
 * Deep equality of two plain objects (Foundry 13 calls it objectsEqual, Foundry 14 equals).
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function sameData(a, b) {
  const equals = foundry.utils.equals ?? foundry.utils.objectsEqual;
  return equals(a, b);
}

/**
 * The parts of item data which must match for two items to be stacked.
 * @param {object} data
 * @param {BaseAdapter} adapter
 * @returns {object}
 */
export function stackCompare(data, adapter) {
  const copy = foundry.utils.deepClone(data);
  delete copy._id;
  delete copy._stats;
  delete copy.sort;
  delete copy.ownership;
  delete copy.folder;
  foundry.utils.setProperty(copy, adapter.quantityPath, 0);
  if ( copy.flags ) delete copy.flags["sephrals-loot-ledger"];
  return copy;
}
