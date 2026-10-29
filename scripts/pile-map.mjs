/**
 * Pure helpers for the Item Piles bridge: which coins of a pile the module can take, what they are worth in base units
 * and which quantities of which items to take. Item Piles describes a pile's coins as a list of currencies, either an
 * attribute of the actor (D&D 5e: system.currency.gp) or a currency item. Nothing here touches Foundry globals.
 */

/**
 * A short key for a currency: the last part of its attribute path, otherwise its abbreviation without the number.
 * @param {object} currency   An Item Piles currency
 * @returns {string[]}        Candidates, most specific first
 */
export function currencyKeys(currency) {
  const keys = [];
  const path = currency?.path ?? currency?.data?.path;
  if ( path ) keys.push(String(path).split(".").at(-1).toLowerCase());
  const abbr = String(currency?.abbreviation ?? "").replace("{#}", "").replace(/[^\p{L}]/gu, "").toLowerCase();
  if ( abbr ) keys.push(abbr);
  return keys;
}

/**
 * The worth of one unit of a currency in the module's base units, or null when the module has no matching coin.
 * A currency matches a coin by key or abbreviation; otherwise a primary-style currency counts by its exchange rate
 * against the module's main coin, if that gives whole base units.
 * @param {object} currency
 * @param {{key: string, value: number, abbr?: string}[]} denominations
 * @param {string} mainKey
 * @returns {number|null}
 */
export function currencyValue(currency, denominations, mainKey) {
  const norm = s => String(s ?? "").toLowerCase().replace(/[^\p{L}]/gu, "");
  for ( const key of currencyKeys(currency) ) {
    const d = denominations.find(x => (norm(x.key) === key) || (x.abbr && (norm(x.abbr) === key)));
    if ( d ) return d.value;
  }
  const rate = Number(currency?.exchangeRate);
  if ( currency?.secondary || !(rate > 0) ) return null;
  const main = denominations.find(d => d.key === mainKey);
  const value = rate * (main?.value ?? 0);
  return (Number.isInteger(value) && (value >= 1)) ? value : null;
}

/**
 * What the module takes of a pile's coins.
 * @param {object[]} currencies   Item Piles currencies with their quantity
 * @param {{key: string, value: number, abbr?: string}[]} denominations
 * @param {string} mainKey
 * @returns {{base: number, attributeBase: number, itemBase: number, attributes: Record<string, number>,
 *   units: Record<string, number>, items: {_id: string, quantity: number}[], kept: string[]}}
 *   base: worth in base units, split into attribute coins and currency items; attributes and items: what to remove from
 *   the pile; units: worth of one coin of each attribute; kept: currencies left in the pile
 */
export function pileCoinPlan(currencies, denominations, mainKey) {
  const plan = {base: 0, attributeBase: 0, itemBase: 0, attributes: {}, units: {}, items: [], kept: []};
  for ( const currency of currencies ?? [] ) {
    const quantity = Math.max(Math.floor(Number(currency?.quantity) || 0), 0);
    if ( !quantity ) continue;
    const value = currencyValue(currency, denominations, mainKey);
    const path = currency.path ?? currency.data?.path;
    const itemId = (currency.type === "item") ? (currency.item?.id ?? currency.id) : null;
    if ( !value || (!path && !itemId) ) {
      plan.kept.push(String(currency.name ?? currency.abbreviation ?? "?"));
      continue;
    }
    plan.base += quantity * value;
    if ( itemId ) {
      plan.items.push({_id: itemId, quantity});
      plan.itemBase += quantity * value;
    }
    else {
      plan.attributes[path] = quantity;
      plan.units[path] = value;
      plan.attributeBase += quantity * value;
    }
  }
  return plan;
}

/**
 * The items to take: known ids only, each once, at least 1 and at most what the pile holds.
 * @param {{id: string, quantity?: number}[]} requests
 * @param {Map<string, number>} available   Quantity by item id
 * @returns {{id: string, quantity: number}[]}
 */
export function clampRequests(requests, available) {
  const picks = new Map();
  for ( const {id, quantity} of requests ?? [] ) {
    const max = available.get(id);
    if ( !max || picks.has(id) ) continue;
    const asked = Math.floor(Number(quantity) || max);
    picks.set(id, Math.min(Math.max(asked, 1), max));
  }
  return [...picks].map(([id, quantity]) => ({id, quantity}));
}
