/**
 * Pure helpers for the ledger's integrity check. Every entry carries a fingerprint of its own content and of the entry
 * before it, so a later change to any entry breaks the chain from there on. This shows tampering, it does not prevent
 * it (the GM owns the world). The hash is not cryptographic on purpose: it has to work on servers without a secure
 * context, where the browser's crypto API is missing.
 */

/**
 * A stable JSON text: object keys sorted, undefined values left out.
 * @param {*} value
 * @returns {string}
 */
export function canonical(value) {
  if ( Array.isArray(value) ) return `[${value.map(v => canonical(v ?? null)).join(",")}]`;
  if ( value && (typeof value === "object") ) {
    const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * A 53 bit string hash (cyrb53) as 14 hex digits.
 * @param {string} text
 * @param {number} [seed=0]
 * @returns {string}
 */
export function hashString(text, seed=0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for ( let i = 0; i < text.length; i++ ) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = (4294967296 * (2097151 & h2)) + (h1 >>> 0);
  return value.toString(16).padStart(14, "0");
}

/**
 * The fingerprint of an entry: its content without the fingerprint fields, chained to the previous one.
 * @param {object} entry
 * @param {string} previous
 * @returns {string}
 */
export function entryHash(entry, previous) {
  const {hash, prev, ...content} = entry ?? {};
  return hashString(`${previous ?? ""}|${canonical(content)}`);
}

/**
 * Seal an entry: set its link to the previous entry and its own fingerprint.
 * @param {object} entry
 * @param {string} previous
 * @returns {object}
 */
export function seal(entry, previous) {
  const sealed = {...entry, prev: previous ?? ""};
  sealed.hash = entryHash(sealed, sealed.prev);
  return sealed;
}

/**
 * Check a list of entries in order.
 * @param {object[]} entries
 * @returns {{ok: boolean, brokenAt: number|null}}   brokenAt is the index of the first entry that does not match
 */
export function verifyChain(entries) {
  let previous = "";
  for ( let i = 0; i < entries.length; i++ ) {
    const entry = entries[i];
    if ( (entry.prev ?? "") !== previous ) return {ok: false, brokenAt: i};
    if ( entryHash(entry, previous) !== entry.hash ) return {ok: false, brokenAt: i};
    previous = entry.hash;
  }
  return {ok: true, brokenAt: null};
}
