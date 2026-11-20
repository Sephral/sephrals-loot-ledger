/**
 * The wish list, the pure part: wishes, matching them against loot and the keys which make sure a player is told once.
 * Nothing in here touches Foundry, so node tests run it directly (wish.mjs is the Foundry side).
 *
 * A wish is a free text (a name or part of one) or an item link: the link keeps the UUID and the name of the item.
 */

/** How many wishes one user keeps, and how long a wish text may be. */
export const MAX_WISHES = 30;
export const MAX_TEXT = 60;

/**
 * Lower case, without accents and with single spaces, so "Heiltrank" matches "HEILTRANK" and "Café" matches "cafe".
 * @param {*} value
 * @returns {string}
 */
export function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Make a wish out of what the user typed or dropped.
 * @param {{text?: string, uuid?: string, img?: string}} input
 * @param {string} id
 * @param {number} [now]
 * @returns {{id: string, text: string, uuid?: string, img?: string, added: number}|null}   Null for an empty wish
 */
export function makeWish({text, uuid, img}, id, now=Date.now()) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if ( clean.length < 2 ) return null;
  const wish = {id, text: clean, added: now};
  if ( uuid ) wish.uuid = String(uuid);
  if ( img ) wish.img = String(img);
  return wish;
}

/**
 * The valid wishes of a stored list.
 * @param {*} list
 * @returns {object[]}
 */
export function cleanWishes(list) {
  if ( !Array.isArray(list) ) return [];
  const seen = new Set();
  const out = [];
  for ( const w of list ) {
    if ( !w || (typeof w.id !== "string") || (typeof w.text !== "string") || seen.has(w.id) ) continue;
    if ( normalize(w.text).length < 2 ) continue;
    seen.add(w.id);
    out.push(w);
  }
  return out.slice(0, MAX_WISHES);
}

/**
 * Is a wish already on a list (the same link, or the same text)?
 * @param {object[]} list
 * @param {{text: string, uuid?: string}} wish
 * @returns {boolean}
 */
export function hasWish(list, wish) {
  return list.some(w => (wish.uuid && (w.uuid === wish.uuid))
    || (!wish.uuid && !w.uuid && (normalize(w.text) === normalize(wish.text))));
}

/**
 * @typedef WishTarget
 * @property {string} name        The name players see
 * @property {boolean} [covered]  The item is unidentified: only its cover name counts, never its origin
 * @property {string[]} [sources] UUIDs the item was copied from
 */

/**
 * Does a wish match a piece of loot?
 * - A text matches when it is part of the name, in any case, or when every word of it is part of the name.
 * - A link matches an item copied from the linked item, or an item with exactly the same name. A covered item never
 *   matches by its origin, that would give it away.
 * @param {{text: string, uuid?: string}} wish
 * @param {WishTarget} target
 * @returns {boolean}
 */
export function matchesWish(wish, target) {
  const name = normalize(target?.name);
  const needle = normalize(wish?.text);
  if ( !name || (needle.length < 2) ) return false;
  if ( wish.uuid ) {
    if ( !target.covered && (target.sources ?? []).includes(wish.uuid) ) return true;
    return name === needle;
  }
  if ( name.includes(needle) ) return true;
  const words = needle.split(" ").filter(Boolean);
  return (words.length > 1) && words.every(word => name.includes(word));
}

/**
 * The key which marks one wish of one user as matched by one piece of loot.
 * @param {string} userId
 * @param {string} wishId
 * @returns {string}
 */
export function matchKey(userId, wishId) {
  return `${userId}:${wishId}`;
}

/**
 * Every wish of every user which matches a piece of loot.
 * @param {Record<string, object[]>} wishesByUser
 * @param {WishTarget} target
 * @returns {{userId: string, wish: object, key: string}[]}
 */
export function findMatches(wishesByUser, target) {
  const out = [];
  for ( const [userId, list] of Object.entries(wishesByUser ?? {}) ) {
    for ( const wish of list ?? [] ) {
      if ( matchesWish(wish, target) ) out.push({userId, wish, key: matchKey(userId, wish.id)});
    }
  }
  return out;
}

/**
 * The matches nobody was told about yet.
 * @param {{key: string}[]} matches
 * @param {string[]} notified   Keys stored on the loot entry
 * @returns {{key: string}[]}
 */
export function freshMatches(matches, notified) {
  const done = new Set(notified ?? []);
  return matches.filter(m => !done.has(m.key));
}

/**
 * The keys of a list which belong to one user.
 * @param {string[]} keys
 * @param {string} userId
 * @returns {string[]}
 */
export function keysOfUser(keys, userId) {
  return (keys ?? []).filter(k => String(k).startsWith(`${userId}:`));
}
