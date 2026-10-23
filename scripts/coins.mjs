/**
 * Pure coin helpers. Every amount the module keeps is counted in base units: the smallest coin of the system (copper
 * in Crucible and D&D 5e). Denominations come from the system adapter as `{key, value, abbr}`, where `value` is the
 * worth of one coin in base units. Nothing here touches Foundry globals, so the tests can run in Node.
 */

/**
 * @typedef Denomination
 * @property {string} key      The system's key of the coin, for example "gp"
 * @property {number} value    Worth of one coin in base units
 * @property {string} [abbr]   Abbreviation shown after the number
 */

/**
 * Denominations sorted from the most valuable to the least valuable coin.
 * @param {Denomination[]} denominations
 * @returns {Denomination[]}
 */
export function sortDenominations(denominations) {
  return [...denominations].filter(d => d.value > 0).sort((a, b) => b.value - a.value);
}

/**
 * The coins with the worth the GM set for them. Coins without a valid value (a whole number of at least 1) keep the
 * worth the system gives them.
 * @param {Denomination[]} denominations
 * @param {Record<string, number>} [custom]
 * @returns {Denomination[]}
 */
export function applyCoinValues(denominations, custom={}) {
  return denominations.map(d => {
    const value = Number(custom?.[d.key]);
    return (Number.isInteger(value) && (value >= 1)) ? {...d, value} : d;
  });
}

/**
 * The coin values typed into the settings dialog, as far as they differ from the system. The smallest coin is the base
 * unit and always worth 1, so amounts the module keeps in base units stay the same.
 * @param {Record<string, *>} input           Values by coin key
 * @param {Denomination[]} denominations      The coins as the system defines them
 * @returns {Record<string, number>|null}     null when a value is not a whole number of at least 1
 */
export function coinValueChanges(input, denominations) {
  const smallest = sortDenominations(denominations).at(-1);
  const changes = {};
  for ( const d of denominations ) {
    if ( d.key === smallest?.key ) continue;
    const value = Number(input?.[d.key]);
    if ( !Number.isInteger(value) || (value < 1) ) return null;
    if ( value !== d.value ) changes[d.key] = value;
  }
  return changes;
}

/**
 * Split an amount evenly. Nobody gets a fraction, and the remainder is reported instead of being dropped.
 * @param {number} total
 * @param {number} count
 * @returns {{share: number, remainder: number}}
 */
export function splitCoins(total, count) {
  total = Math.max(Math.floor(Number(total) || 0), 0);
  count = Math.floor(Number(count) || 0);
  if ( count < 1 ) return {share: 0, remainder: total};
  const share = Math.floor(total / count);
  return {share, remainder: total - (share * count)};
}

/**
 * The worth of a set of coins in base units.
 * @param {Record<string, number>} coins
 * @param {Denomination[]} denominations
 * @returns {number}
 */
export function toBase(coins, denominations) {
  let total = 0;
  for ( const d of denominations ) total += Math.max(Math.floor(Number(coins?.[d.key]) || 0), 0) * d.value;
  return total;
}

/**
 * Pay an amount with as few coins as possible, from the most valuable coin down.
 * @param {number} base
 * @param {Denomination[]} denominations
 * @returns {Record<string, number>}
 */
export function payout(base, denominations) {
  let rest = Math.max(Math.floor(Number(base) || 0), 0);
  const coins = {};
  for ( const d of sortDenominations(denominations) ) {
    const count = Math.floor(rest / d.value);
    if ( count ) coins[d.key] = count;
    rest -= count * d.value;
  }
  return coins;
}

/**
 * Can a purse pay these coins, coin by coin?
 * @param {Record<string, number>} purse
 * @param {Record<string, number>} coins
 * @returns {boolean}
 */
export function canPay(purse, coins) {
  return Object.entries(coins ?? {}).every(([key, count]) => (Number(purse?.[key]) || 0) >= (Number(count) || 0));
}

/**
 * Add or remove coins from a purse, coin by coin.
 * @param {Record<string, number>} purse
 * @param {Record<string, number>} coins
 * @param {number} [sign=1]   1 adds the coins, -1 removes them
 * @returns {Record<string, number>}
 */
export function changePurse(purse, coins, sign=1) {
  const result = {...purse};
  for ( const [key, count] of Object.entries(coins ?? {}) ) {
    result[key] = Math.max((Number(result[key]) || 0) + (sign * (Number(count) || 0)), 0);
  }
  return result;
}

/**
 * An amount as text, for example "3 gp 4 sp".
 * @param {number} base
 * @param {Denomination[]} denominations
 * @returns {string}
 */
export function formatCoins(base, denominations) {
  const coins = payout(base, denominations);
  const parts = sortDenominations(denominations).filter(d => coins[d.key]).map(d => `${coins[d.key]} ${d.abbr ?? d.key}`);
  if ( parts.length ) return parts.join(" ");
  const smallest = sortDenominations(denominations).at(-1);
  return `0 ${smallest?.abbr ?? smallest?.key ?? ""}`.trim();
}

/**
 * Read an amount typed into a field. Accepts a plain number in the main coin or a list like "3gp 4sp".
 * @param {string|number} text
 * @param {Denomination[]} denominations
 * @param {string} mainKey    The coin a plain number counts in
 * @returns {number|null}     Base units, or null when the text cannot be read
 */
export function parseCoins(text, denominations, mainKey) {
  const value = String(text ?? "").trim().toLowerCase();
  if ( !value ) return null;
  const main = denominations.find(d => d.key === mainKey) ?? sortDenominations(denominations).at(-1);
  if ( /^\d+([.,]\d+)?$/.test(value) ) return Math.round(Number(value.replace(",", ".")) * (main?.value ?? 1));
  let total = 0;
  let matched = false;
  const keys = new Map();
  for ( const d of denominations ) {
    keys.set(d.key.toLowerCase(), d);
    if ( d.abbr ) keys.set(String(d.abbr).toLowerCase().replace(/\./g, ""), d);
  }
  const stripped = value.replace(/(\d+)\s*([a-zäöü.]+)/g, (all, count, unit) => {
    const d = keys.get(unit.replace(/\./g, ""));
    if ( !d ) return all;
    total += Number(count) * d.value;
    matched = true;
    return "";
  });
  if ( !matched || stripped.trim() ) return null;
  return total;
}
