/**
 * Selling to a merchant, the pure part: the offer, the haggle and how the proceeds are shared. Nothing in here touches
 * Foundry, so node tests run it directly (merchant.mjs is the window, service.mjs does the selling).
 */

/** The offer as a share of the value, in percent: lowest and highest the GM can set. */
export const SHARE_MIN = 1;
export const SHARE_MAX = 200;

/** What one point of the check above or below the baseline is worth, in percent of the offer. */
export const HAGGLE_STEP = 2;

/** The most a haggle moves the offer, in percent either way (the setting can lower it). */
export const HAGGLE_LIMIT = 20;

/**
 * A share as a whole percent within the limits.
 * @param {*} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function clampShare(value, fallback=50) {
  const n = Math.round(Number(value));
  if ( !Number.isFinite(n) ) return fallback;
  return Math.min(Math.max(n, SHARE_MIN), SHARE_MAX);
}

/**
 * How a check result moves the offer: two percent per point above or below the baseline, within the limit.
 * @param {number} total       The check result
 * @param {number} baseline    The result of an average haggle (the system's standard difficulty)
 * @param {number} [limit]     The most it may move, in percent
 * @param {number} [step]
 * @returns {number}   Percent, whole, negative for a worse offer
 */
export function haggleAdjust(total, baseline, limit=HAGGLE_LIMIT, step=HAGGLE_STEP) {
  const t = Number(total);
  const b = Number(baseline);
  const max = Math.max(Math.floor(Number(limit) || 0), 0);
  if ( !Number.isFinite(t) || !Number.isFinite(b) || !max ) return 0;
  const raw = Math.round((t - b) * step);
  return Math.min(Math.max(raw, -max), max) || 0;
}

/**
 * The offer for a value: a share of it, moved by the haggle, in whole base units.
 * @param {number} base       The worth of what is sold
 * @param {number} share      Percent of the value
 * @param {number} [adjust]   Percent the haggle moved the offer
 * @returns {number}
 */
export function offerOf(base, share, adjust=0) {
  const value = Math.max(Number(base) || 0, 0);
  return Math.max(Math.round(value * (clampShare(share) / 100) * (1 + ((Number(adjust) || 0) / 100))), 0);
}

/**
 * How the proceeds go to the characters of a split: everybody the same, the rest to the fund when there is one, else
 * to the first.
 * @param {number} offer
 * @param {number} count
 * @param {boolean} fund   Is there a party fund the rest can go to?
 * @returns {{shares: number[], toFund: number}}
 */
export function splitProceeds(offer, count, fund) {
  const n = Math.floor(Number(count) || 0);
  const total = Math.max(Math.floor(Number(offer) || 0), 0);
  if ( n < 1 ) return {shares: [], toFund: 0};
  const share = Math.floor(total / n);
  const rest = total - (share * n);
  const shares = Array.from({length: n}, () => share);
  if ( !fund ) shares[0] += rest;
  return {shares, toFund: fund ? rest : 0};
}

/** The PF2e difficulty classes by level, level 0 to 25. */
const DC_BY_LEVEL = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];

/**
 * The PF2e difficulty class for a level (the table of standard DCs by level).
 * @param {number} level
 * @returns {number}
 */
export function dcByLevel(level) {
  const n = Math.min(Math.max(Math.floor(Number(level) || 0), 0), DC_BY_LEVEL.length - 1);
  return DC_BY_LEVEL[n];
}
