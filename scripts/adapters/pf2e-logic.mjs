/**
 * Pathfinder 2e, the pure part: coins that are items, prices, bulk and containers. Nothing in here touches Foundry, so
 * node tests run it directly (see pf2e.mjs for the Foundry side).
 *
 * In PF2e coins are treasure items of the category "coin", one stack per coin type, and every coin is an item. Giving
 * coins therefore means changing the quantity of a stack, creating it or deleting it.
 */

/** The coins in the order of their worth, with the worth in copper. */
export const COINS = Object.freeze([
  {key: "pp", value: 1000},
  {key: "gp", value: 100},
  {key: "sp", value: 10},
  {key: "cp", value: 1}
]);

/** The coins payouts are made in. */
export const PAYOUT_KEYS = Object.freeze(["gp", "sp", "cp"]);

/** The compendium items PF2e itself creates a new coin stack from. */
export const COIN_SOURCES = Object.freeze({
  pp: "Compendium.pf2e.equipment-srd.Item.JuNPeK5Qm1w6wpb4",
  gp: "Compendium.pf2e.equipment-srd.Item.B6B7tBWJSqOBz5zz",
  sp: "Compendium.pf2e.equipment-srd.Item.5Ew82vBF9YfaiY9f",
  cp: "Compendium.pf2e.equipment-srd.Item.lzJ8AVhRcbFul5fh"
});

/**
 * The worth of a PF2e price value in copper. Item data has a plain object, a prepared item has PF2e's Coins object
 * which knows its copper value itself.
 * @param {object} value   {pp, gp, sp, cp}
 * @returns {number}
 */
export function copperOf(value) {
  if ( !value ) return 0;
  const own = Number(value.copperValue);
  if ( Number.isFinite(own) ) return own;
  return COINS.reduce((sum, c) => sum + ((Number(value[c.key]) || 0) * c.value), 0);
}

/**
 * The worth of one unit of an item in copper. A price may be for several units ("per": 10 arrows for 1 sp), so the
 * worth of a unit can be a fraction of a copper.
 * @param {{value?: object, per?: number}} price
 * @returns {number}
 */
export function unitCopper(price) {
  const per = Math.max(Math.floor(Number(price?.per) || 1), 1);
  return copperOf(price?.value) / per;
}

/**
 * The worth of a number of units of an item in copper, rounded to a whole coin.
 * @param {{value?: object, per?: number}} price
 * @param {number} quantity
 * @returns {number}
 */
export function priceOf(price, quantity) {
  return Math.max(Math.round(unitCopper(price) * quantity), 0);
}

/**
 * The bulk of a number of units of an item. The stored bulk is a number where 0.1 is light bulk; "per" says how many
 * units make that bulk.
 * @param {{value?: number, per?: number}} bulk
 * @param {number} quantity
 * @returns {number}   In bulk
 */
export function bulkOf(bulk, quantity) {
  const per = Math.max(Math.floor(Number(bulk?.per) || 1), 1);
  return Math.max((Number(bulk?.value) || 0) * (Math.max(Number(quantity) || 0, 0) / per), 0);
}

/**
 * The coins to take for an amount. Coins of the right worth are taken first; what is left over is paid with the
 * smallest coin that is worth more, and the change comes back in the payout coins (the way PF2e's own purchases
 * break a coin).
 * @param {Record<string, number>} purse
 * @param {number} base   Copper
 * @returns {Record<string, number>|null}   The change of the purse per coin (negative = taken), or null if the purse is too poor
 */
export function planPay(purse, base) {
  base = Math.max(Math.floor(Number(base) || 0), 0);
  const have = Object.fromEntries(COINS.map(c => [c.key, Math.max(Math.floor(Number(purse?.[c.key]) || 0), 0)]));
  const total = COINS.reduce((sum, c) => sum + (have[c.key] * c.value), 0);
  if ( total < base ) return null;
  const delta = Object.fromEntries(COINS.map(c => [c.key, 0]));
  let rest = base;
  for ( const c of COINS ) {
    const count = Math.min(Math.floor(rest / c.value), have[c.key]);
    delta[c.key] -= count;
    have[c.key] -= count;
    rest -= count * c.value;
  }
  if ( rest > 0 ) {
    // Every coin left is worth more than the rest, so the smallest one breaks into change
    const coin = [...COINS].reverse().find(c => have[c.key] > 0);
    if ( !coin ) return null;
    delta[coin.key] -= 1;
    const change = planReceive(coin.value - rest);
    for ( const [key, count] of Object.entries(change) ) delta[key] += count;
  }
  return Object.fromEntries(Object.entries(delta).filter(([, n]) => n !== 0));
}

/**
 * The coins which pay out an amount.
 * @param {number} base   Copper
 * @returns {Record<string, number>}
 */
export function planReceive(base) {
  let rest = Math.max(Math.floor(Number(base) || 0), 0);
  const coins = {};
  for ( const c of COINS.filter(c => PAYOUT_KEYS.includes(c.key)) ) {
    const count = Math.floor(rest / c.value);
    if ( count ) coins[c.key] = count;
    rest -= count * c.value;
  }
  return coins;
}

/**
 * What to do with the coin stacks of one coin type to change their sum by a number of coins.
 * @param {{id: string, quantity: number}[]} stacks
 * @param {number} change   Positive adds, negative takes
 * @returns {{updates: {id: string, quantity: number}[], deletes: string[], create: number}}
 */
export function planStacks(stacks, change) {
  const plan = {updates: [], deletes: [], create: 0};
  if ( change > 0 ) {
    if ( stacks.length ) plan.updates.push({id: stacks[0].id, quantity: stacks[0].quantity + change});
    else plan.create = change;
    return plan;
  }
  let rest = -change;
  for ( const stack of stacks ) {
    if ( rest <= 0 ) break;
    if ( stack.quantity > rest ) {
      plan.updates.push({id: stack.id, quantity: stack.quantity - rest});
      rest = 0;
    }
    else {
      plan.deletes.push(stack.id);
      rest -= stack.quantity;
    }
  }
  if ( rest > 0 ) throw new Error("SLL.Error.notEnoughCoins");
  return plan;
}

/**
 * The create data of a container and everything inside it, with new ids so the contents point at the new container.
 * @param {object[]} sources   Item data (toObject) of the container first, then its contents in any depth
 * @param {() => string} newId
 * @returns {object[]}
 */
export function remapContainers(sources, newId) {
  const ids = new Map(sources.map(data => [data._id, newId()]));
  return sources.map((data, index) => {
    const copy = structuredClone(data);
    copy._id = ids.get(data._id);
    const inside = copy.system?.containerId;
    if ( index === 0 ) copy.system.containerId = null;
    else if ( inside ) copy.system.containerId = ids.get(inside) ?? null;
    return copy;
  });
}

/**
 * The equipment state of an item that changes hands: nothing is held, worn or invested any more. An item that sits in
 * a container keeps being stowed.
 * @param {object} equipped   system.equipped of the item data, changed in place
 * @param {boolean} inContainer
 * @returns {object}
 */
export function resetEquipped(equipped, inContainer) {
  equipped ??= {};
  equipped.carryType = inContainer ? "stowed" : "worn";
  equipped.handsHeld = 0;
  if ( "inSlot" in equipped ) equipped.inSlot = false;
  if ( (equipped.invested !== null) && (equipped.invested !== undefined) ) equipped.invested = false;
  return equipped;
}

/**
 * The fields which cover an item with PF2e's own identification.
 * @param {{name: string, img: string, description: string}} cover
 * @param {string} defaultImg   The module's default cover picture, which PF2e's own placeholder replaces
 * @returns {object}
 */
export function nativeCoverFields(cover, defaultImg) {
  const update = {
    "system.identification.status": "unidentified",
    "system.identification.unidentified.name": cover.name,
    "system.identification.unidentified.data.description.value": cover.description ?? ""
  };
  if ( cover.img && (cover.img !== defaultImg) ) update["system.identification.unidentified.img"] = cover.img;
  return update;
}
