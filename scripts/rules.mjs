/**
 * Pure rules for claims, distribution and fairness. Nothing here touches Foundry globals, so the tests can run in Node.
 */

/** Claims a character can make on an item of the loot, by weight. */
export const CLAIM_RANK = {need: 2, want: 1, pass: 0};

/** Distribution rules. */
export const RULES = ["fair", "roll", "gm"];

/* -------------------------------------------- */

/**
 * The characters with the strongest claim on an item. Passing is not a claim.
 * @param {Record<string, string>} claims   Claim by character id
 * @returns {{rank: number, ids: string[]}}
 */
export function contenders(claims) {
  let rank = 0;
  let ids = [];
  for ( const [id, claim] of Object.entries(claims ?? {}) ) {
    const r = CLAIM_RANK[claim] ?? 0;
    if ( r <= 0 ) continue;
    if ( r > rank ) {
      rank = r;
      ids = [id];
    }
    else if ( r === rank ) ids.push(id);
  }
  return {rank, ids};
}

/**
 * Pick who gets an item.
 * - "fair": among the strongest claims, the character who received the least value so far, a roll breaks ties
 * - "roll": among the strongest claims, the highest roll
 * - "gm": nobody automatically
 * @param {Record<string, string>} claims
 * @param {object} options
 * @param {string} options.rule
 * @param {Record<string, number>} [options.received]  Value received so far, by character id
 * @param {Record<string, number>} [options.rolls]     Roll results, by character id
 * @returns {{winner: string|null, contenders: string[], reason: string, needsRolls: string[]}}
 *   needsRolls lists characters who still need a roll before a winner can be named
 */
export function pickWinner(claims, {rule="fair", received={}, rolls={}}={}) {
  const {ids} = contenders(claims);
  if ( !ids.length ) return {winner: null, contenders: [], reason: "none", needsRolls: []};
  if ( rule === "gm" ) return {winner: null, contenders: ids, reason: "gm", needsRolls: []};
  if ( ids.length === 1 ) return {winner: ids[0], contenders: ids, reason: "single", needsRolls: []};
  let pool = ids;
  let reason = "roll";
  if ( rule === "fair" ) {
    const least = Math.min(...ids.map(id => received[id] ?? 0));
    pool = ids.filter(id => (received[id] ?? 0) === least);
    if ( pool.length === 1 ) return {winner: pool[0], contenders: ids, reason: "fair", needsRolls: []};
    reason = "fairRoll";
  }
  const missing = pool.filter(id => !Number.isFinite(rolls[id]));
  if ( missing.length ) return {winner: null, contenders: ids, reason, needsRolls: missing};
  const best = Math.max(...pool.map(id => rolls[id]));
  const top = pool.filter(id => rolls[id] === best);
  if ( top.length > 1 ) return {winner: null, contenders: ids, reason: "tie", needsRolls: top};
  return {winner: top[0], contenders: ids, reason, needsRolls: []};
}

/* -------------------------------------------- */

/** Places in the ledger that belong to the group. */
const GROUP = ["pool", "stash", "fund"];

/**
 * What each character took from the group (loot, stash, fund) minus what they gave to it, in base units. A gift between
 * two characters moves value from one to the other.
 * @param {object[]} entries   Ledger entries
 * @param {object} [options]
 * @param {number} [options.since]   Only entries from this time on (ms)
 * @returns {Record<string, number>}
 */
export function balance(entries, {since=0}={}) {
  const result = {};
  const add = (id, value) => {
    if ( !id || !value ) return;
    result[id] = (result[id] ?? 0) + value;
  };
  const undone = new Set(entries.filter(e => e.kind === "undo" && e.undoes).map(e => e.undoes));
  for ( const e of entries ) {
    if ( (e.time ?? 0) < since ) continue;
    if ( (e.kind === "undo") || undone.has(e.id) ) continue;
    const value = (e.item?.value ?? 0) + (e.coins ?? 0);
    if ( !value ) continue;
    const fromActor = e.from?.kind === "actor";
    const toActor = e.to?.kind === "actor";
    if ( toActor && (GROUP.includes(e.from?.kind) || fromActor) ) add(e.to.id, value);
    if ( fromActor && (GROUP.includes(e.to?.kind) || toActor) ) add(e.from.id, -value);
  }
  return result;
}
