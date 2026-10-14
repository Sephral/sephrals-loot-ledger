/**
 * Every other system. The GM tells the module in its settings where the system keeps the quantity and the price of an
 * item and the coins of an actor, and which actor type the player characters have. Items need a quantity to be
 * handed over. Coins are one amount; without a coin path the coin features stay off.
 */

import {MODULE_ID} from "../config.mjs";
import {BaseAdapter} from "./base.mjs";

/**
 * Read a generic setting, safely before the settings exist.
 * @param {string} key
 * @param {*} fallback
 * @param {object} [options]
 * @param {boolean} [options.allowEmpty]   An empty value means "none" instead of the fallback
 * @returns {*}
 */
function option(key, fallback, {allowEmpty=false}={}) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    if ( (value === "") && allowEmpty ) return "";
    return ((value === undefined) || (value === null) || (value === "")) ? fallback : value;
  } catch {
    return fallback;
  }
}

export class GenericAdapter extends BaseAdapter {

  id = "generic";

  /** @override */
  get characterTypes() {
    return String(option("genericCharacterType", "character")).split(",").map(s => s.trim()).filter(Boolean);
  }

  /** @override */
  get quantityPath() {
    return option("genericQuantity", "system.quantity");
  }

  /** Where an item's price is stored (a number in coins), or "" for none. */
  get pricePath() {
    return option("genericPrice", "system.price", {allowEmpty: true});
  }

  /** Where an actor's coins are stored (a number), or "" for none. */
  get currencyPath() {
    return option("genericCurrency", "", {allowEmpty: true});
  }

  /** Are coin features available? */
  get hasCoins() {
    return !!this.currencyPath;
  }

  /** @override */
  unitValue(item) {
    if ( !this.pricePath ) return 0;
    const value = foundry.utils.getProperty(item, this.pricePath);
    const number = Number((value && (typeof value === "object")) ? value.value : value);
    return Math.max(Math.round(number) || 0, 0);
  }

  /** @override */
  denominations() {
    const name = option("genericCoinName", "gp");
    return [{key: "coin", value: 1, abbr: name}];
  }

  /** @override */
  mainCoin() {
    return "coin";
  }

  /** @override */
  coinsBase(actor) {
    if ( !this.hasCoins ) return 0;
    return Math.max(Math.floor(Number(foundry.utils.getProperty(actor, this.currencyPath)) || 0), 0);
  }

  /** @override */
  payUpdate(actor, coins) {
    if ( !this.hasCoins ) throw new Error("SLL.Error.noCoins");
    const base = this.toBase(coins);
    const current = this.coinsBase(actor);
    if ( current < base ) throw new Error("SLL.Error.notEnoughCoins");
    return {[this.currencyPath]: current - base};
  }

  /** @override */
  receiveUpdate(actor, base) {
    if ( !this.hasCoins ) throw new Error("SLL.Error.noCoins");
    return {[this.currencyPath]: this.coinsBase(actor) + Math.max(Math.floor(base), 0)};
  }

  /** @override */
  selfTest() {
    const problems = [];
    const types = game.documentTypes?.Actor ?? [];
    if ( !this.characterTypes.some(t => types.includes(t)) ) problems.push("SLL.SELFTEST.CharacterType");
    const sample = game.items?.find(i => true) ?? game.actors.find(a => a.items.size)?.items.contents[0];
    if ( sample && !foundry.utils.hasProperty(sample, this.quantityPath) ) problems.push("SLL.SELFTEST.QuantityPath");
    return problems;
  }
}
