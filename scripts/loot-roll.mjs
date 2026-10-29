/**
 * Pure helpers for rolling loot from a roll table: quantity formulas, coin texts like "3d6 gp" and the drawing of lines
 * with nested tables. Foundry is passed in as functions (rolling a table, evaluating a formula, loading a document), so
 * nothing here touches Foundry globals and the tests can run in Node.
 */

/** How deep nested tables are followed. Foundry's own limit for nested draws is 5 as well. */
export const MAX_DEPTH = 5;

/** The most draws one formula may ask for, so a typo like "1d1000" does not hang the GM's client. */
export const MAX_DRAWS = 100;

/**
 * @typedef LootLine
 * @property {string} id
 * @property {"item"|"coins"|"text"} kind
 * @property {string} name
 * @property {string} [img]
 * @property {string} [uuid]          The item to copy (kind item)
 * @property {number} quantity        Units of the item, or 0 for coins and texts
 * @property {number} coins           Base units (kind coins)
 * @property {string} formula         The quantity formula of the result, "" for none
 * @property {boolean} invalid        The quantity formula could not be rolled
 * @property {string} tableUuid       The table the line was drawn from, to draw it again
 * @property {number} depth           How deep that table is nested
 * @property {boolean} include        Goes into the loot
 */

/**
 * A formula as typed by a GM, made rollable: "2d4 × 10" and "2d4x10" become "2d4*10".
 * @param {string} text
 * @returns {string}
 */
export function normalizeFormula(text) {
  return String(text ?? "").trim().replace(/(\d)\s*[x×]\s*(?=\d)/gi, "$1*").replace(/\s+/g, " ");
}

/**
 * Plain text of a result description (HTML).
 * @param {string} html
 * @returns {string}
 */
export function plainText(html) {
  return String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ")
    .trim();
}

/** One amount of a coin text: a dice or number expression, then the coin. */
const COIN_PART = /\s*((?:\d*d\d+|\d+)(?:\s*[-+*/]\s*(?:\d*d\d+|\d+))*)\s*([a-zäöüß.]+)\s*(?:,|\+|&|\band\b|\bund\b)?/iy;

/**
 * Read a coin text like "3d6 gp", "2d4 × 10 gp, 5 sp" or "50 GM". The whole text must be coins, otherwise it is an
 * ordinary text result.
 * @param {string} text
 * @param {{key: string, abbr?: string}[]} denominations
 * @returns {{formula: string, key: string}[]|null}
 */
export function parseCoinText(text, denominations) {
  const value = normalizeFormula(plainText(text)).replace(/[.!]+$/, "");
  if ( !value || !denominations?.length ) return null;
  const units = new Map();
  for ( const d of denominations ) {
    units.set(String(d.key).toLowerCase(), d.key);
    if ( d.abbr ) units.set(String(d.abbr).toLowerCase().replace(/\./g, ""), d.key);
  }
  const parts = [];
  COIN_PART.lastIndex = 0;
  while ( COIN_PART.lastIndex < value.length ) {
    const start = COIN_PART.lastIndex;
    const match = COIN_PART.exec(value);
    if ( !match || (COIN_PART.lastIndex === start) ) return null;
    const key = units.get(match[2].toLowerCase().replace(/\./g, ""));
    if ( !key ) return null;
    parts.push({formula: match[1].replace(/\s+/g, ""), key});
  }
  return parts.length ? parts : null;
}

/**
 * Roll a quantity formula: empty means 1, the result is a whole number of at least 0.
 * @param {string} formula
 * @param {(formula: string) => Promise<number>} evaluate
 * @returns {Promise<number|null>}   null when the formula cannot be rolled
 */
export async function resolveQuantity(formula, evaluate) {
  const text = normalizeFormula(formula);
  if ( !text ) return 1;
  try {
    const total = Number(await evaluate(text));
    if ( !Number.isFinite(total) ) return null;
    return Math.max(Math.floor(total), 0);
  } catch {
    return null;
  }
}

/**
 * @typedef DrawDeps
 * @property {(table: object) => Promise<object[]>} roll              Roll a table once, without nested tables
 * @property {(formula: string) => Promise<number>} evaluate          Roll a formula
 * @property {(uuid: string) => Promise<object|null>} resolve         Load a document
 * @property {(result: object) => string} quantityOf                  The quantity formula of a result
 * @property {(text: string) => {formula: string, key: string}[]|null} coinParts
 * @property {(key: string) => number|null} coinValue                 Worth of one coin in base units
 * @property {() => string} [newId]
 */

/**
 * The kind of document a result points to.
 * @param {object} result
 * @param {object|null} doc
 * @returns {string|null}
 */
function documentKind(result, doc) {
  return doc?.documentName ?? String(result?.documentUuid ?? "").split(".").at(-2) ?? null;
}

/**
 * Draw lines from a table: items with their quantity, coins and texts. A result that is another table is drawn as many
 * times as its quantity formula says.
 * @param {object} table
 * @param {DrawDeps} deps
 * @param {object} [options]
 * @param {number} [options.times=1]
 * @param {number} [options.depth=0]
 * @returns {Promise<LootLine[]>}
 */
export async function drawLines(table, deps, {times=1, depth=0}={}) {
  const lines = [];
  const newId = deps.newId ?? (() => Math.random().toString(36).slice(2, 10));
  const count = Math.min(Math.max(Math.floor(times) || 0, 0), MAX_DRAWS);
  for ( let i = 0; i < count; i++ ) {
    const results = await deps.roll(table);
    for ( const result of results ?? [] ) {
      const formula = String(deps.quantityOf(result) ?? "").trim();
      const quantity = await resolveQuantity(formula, deps.evaluate);
      const base = {id: newId(), formula, invalid: quantity === null, tableUuid: table?.uuid ?? "", depth, coins: 0,
        quantity: 0, include: true, img: result.img ?? ""};
      if ( result.type === "document" ) {
        const doc = result.documentUuid ? await deps.resolve(result.documentUuid) : null;
        const kind = documentKind(result, doc);
        if ( (kind === "RollTable") && doc ) {
          if ( depth + 1 <= MAX_DEPTH ) lines.push(...await drawLines(doc, deps, {times: quantity ?? 1, depth: depth + 1}));
          continue;
        }
        if ( (kind === "Item") && doc ) {
          lines.push({...base, kind: "item", uuid: doc.uuid ?? result.documentUuid, name: doc.name ?? result.name,
            img: doc.img ?? base.img, quantity: quantity ?? 1, include: (quantity ?? 1) > 0});
          continue;
        }
        lines.push({...base, kind: "text", name: result.name || doc?.name || "?", include: false});
        continue;
      }
      const text = result.name || plainText(result.description);
      const parts = deps.coinParts(result.name) ?? deps.coinParts(result.description);
      if ( parts ) {
        let coins = 0;
        for ( let n = 0; n < Math.min(quantity ?? 1, MAX_DRAWS); n++ ) {
          for ( const part of parts ) {
            const value = deps.coinValue(part.key) ?? 0;
            const amount = await resolveQuantity(part.formula, deps.evaluate);
            coins += (amount ?? 0) * value;
          }
        }
        lines.push({...base, kind: "coins", name: text, coins, include: coins > 0});
        continue;
      }
      lines.push({...base, kind: "text", name: text || "–", include: false});
    }
  }
  return lines;
}

/**
 * What the included lines add up to.
 * @param {LootLine[]} lines
 * @returns {{items: number, coins: number}}
 */
export function summarize(lines) {
  let items = 0;
  let coins = 0;
  for ( const line of lines ) {
    if ( !line.include ) continue;
    if ( (line.kind === "item") && (line.quantity > 0) ) items++;
    if ( line.kind === "coins" ) coins += Math.max(Math.floor(line.coins) || 0, 0);
  }
  return {items, coins};
}

/**
 * The request payload for the included lines: items by UUID with their quantity, and the coins.
 * @param {LootLine[]} lines
 * @returns {{items: {uuid: string, quantity: number}[], coins: number}}
 */
export function lootPayload(lines) {
  const items = lines.filter(l => l.include && (l.kind === "item") && l.uuid && (l.quantity > 0))
    .map(l => ({uuid: l.uuid, quantity: Math.floor(l.quantity)}));
  return {items, coins: summarize(lines).coins};
}
