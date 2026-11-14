/**
 * Unidentified items, the pure part: what a cover is and which changes put it on an item or take it off again.
 * Nothing in here touches Foundry, so node tests run it directly (see cover.mjs for the Foundry side).
 *
 * Two ways to cover an item:
 * - "system": the game system has its own identification (D&D 5e: system.identified). The module switches it off and
 *   fills the system's own cover fields. The item keeps its real name in its data, the system shows the cover.
 * - "swap": the item itself carries the cover (name, picture, description). The real values wait in a secret store
 *   until the item is revealed. The store is a journal only GMs can open (every window and sheet hides it, but Foundry
 *   still sends world documents to every browser), or, for the strict case, the GM's own browser (never sent anywhere).
 */

/** Where the secrets of covered items are kept. */
export const SECRET_STORES = Object.freeze(["journal", "device"]);

/** The flag (on the item, below the module's scope) which marks a covered item. */
export const COVER_FLAG = "cover";

/** The version of the flag layout. */
export const COVER_VERSION = 1;

/** The picture a cover gets when the GM picks none (a core icon). */
export const DEFAULT_COVER_IMG = "icons/svg/item-bag.svg";

/** Highest check difficulty the module accepts. */
export const MAX_DC = 99;

/**
 * The cover name when the GM gives none.
 * @param {string} template    "Unidentified {type}"
 * @param {string} typeLabel   The localized item type, may be empty
 * @returns {string}
 */
export function defaultCoverName(template, typeLabel) {
  const label = String(typeLabel ?? "").trim();
  return String(template).replace("{type}", label || "item").replace(/\s+/g, " ").trim();
}

/**
 * Clean the GM's input for a cover.
 * @param {object} input
 * @param {string} [input.name]
 * @param {string} [input.img]
 * @param {string} [input.description]   HTML
 * @param {number|string|null} [input.dc]   Difficulty of the identify check, empty for none
 * @param {{name?: string, img?: string, description?: string}} [defaults]
 * @returns {{name: string, img: string, description: string, dc: number|null}}
 */
export function normalizeCover(input = {}, defaults = {}) {
  const name = String(input.name ?? "").trim() || String(defaults.name ?? "").trim() || "?";
  const img = String(input.img ?? "").trim() || String(defaults.img ?? "").trim() || DEFAULT_COVER_IMG;
  const description = String(input.description ?? defaults.description ?? "").trim();
  const raw = (input.dc === "" || input.dc === null || input.dc === undefined) ? NaN : Number(input.dc);
  const dc = Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), MAX_DC) : null;
  return { name, img, description, dc };
}

/** The flag key for an update path, below a module scope. */
const flagPath = (scope, key) => `flags.${scope}.${key}`;

/**
 * The changes which cover an item.
 * @param {object} args
 * @param {"system"|"swap"} args.mode
 * @param {string} args.scope           The module id (flag scope)
 * @param {{name: string, img: string, description?: string|null}} args.real   What the item has now
 * @param {{name: string, img: string, description: string, dc: number|null}} args.cover   Normalized input
 * @param {string|null} args.descriptionPath   Where the item keeps its description (swap), or null
 * @param {string|null} args.secretId   The id of the secret in its store
 * @param {"journal"|"device"} [args.store]   Where the secret is kept
 * @returns {{update: object, flag: object, secret: object}}
 */
export function planCover({ mode, scope, real, cover, descriptionPath = null, secretId = null, store = "journal" }) {
  const flag = {
    v: COVER_VERSION, mode, name: cover.name, img: cover.img, description: cover.description,
    secret: secretId, store: SECRET_STORES.includes(store) ? store : "journal", check: cover.dc !== null, tries: {}
  };
  const update = { [flagPath(scope, COVER_FLAG)]: flag };
  const secret = { dc: cover.dc };
  if (mode === "system") {
    update["system.identified"] = false;
    update["system.unidentified.name"] = cover.name;
    update["system.unidentified.description"] = cover.description;
  } else {
    update.name = cover.name;
    update.img = cover.img;
    if (descriptionPath) update[descriptionPath] = cover.description;
    secret.name = real.name;
    secret.img = real.img;
    secret.description = descriptionPath ? (real.description ?? "") : null;
  }
  return { update, flag, secret };
}

/**
 * The changes which reveal an item.
 * @param {object} args
 * @param {"system"|"swap"} args.mode
 * @param {string} args.scope
 * @param {{name?: string, img?: string, description?: string|null}|null} args.secret   What the secret page holds
 * @param {string|null} args.descriptionPath
 * @returns {object}   The update
 */
export function planReveal({ mode, scope, secret, descriptionPath = null }) {
  const update = { [`flags.${scope}.-=${COVER_FLAG}`]: null };
  if (mode === "system") {
    update["system.identified"] = true;
    return update;
  }
  if (!secret?.name) throw new Error("SLL.Error.secretMissing");
  update.name = secret.name;
  if (secret.img) update.img = secret.img;
  if (descriptionPath && secret.description !== null && secret.description !== undefined) update[descriptionPath] = secret.description;
  return update;
}

/**
 * The cover of an item that the game system marked as unidentified by itself (no flag), as the module understands it.
 * @param {{name?: string, img?: string, unidentifiedName?: string, unidentifiedDescription?: string}} item
 * @returns {object}
 */
export function nativeCover(item) {
  return {
    v: COVER_VERSION, mode: "system", name: item.unidentifiedName || item.name || "?", img: item.img || DEFAULT_COVER_IMG,
    description: item.unidentifiedDescription ?? "", secret: null, check: false, tries: {}
  };
}

/**
 * The outcome of an identify check.
 * @param {number} total
 * @param {number} dc
 * @returns {boolean}
 */
export function checkPasses(total, dc) {
  return Number.isFinite(total) && Number.isFinite(dc) && total >= dc;
}

/**
 * Did a character already try?
 * @param {{tries?: Record<string, boolean>}|null} cover
 * @param {string} actorId
 * @returns {boolean}
 */
export function hasTried(cover, actorId) {
  return !!cover?.tries?.[actorId];
}

/**
 * The formula of an identify check with the character's bonus.
 * @param {string} formula   The world setting, "1d20" by default
 * @param {number} bonus
 * @returns {string}
 */
export function checkFormula(formula, bonus) {
  const base = String(formula ?? "").trim() || "1d20";
  const n = Math.round(Number(bonus) || 0);
  if (!n) return base;
  return `${base} ${n > 0 ? "+" : "-"} ${Math.abs(n)}`;
}

/**
 * The module's flags of item data that travel with the item when it changes hands: the cover and, where wanted, the area.
 * Claims and everything else stay behind.
 * @param {object|undefined} flags   The module's flag scope of the item data
 * @param {string|null} [area]
 * @returns {object}
 */
export function carriedFlags(flags, area = null) {
  const out = {};
  if (flags?.[COVER_FLAG]) out[COVER_FLAG] = flags[COVER_FLAG];
  if (area) out.area = area;
  return out;
}

/**
 * What two stacks must share to be one stack: the identity of the cover, not its tries.
 * @param {object|undefined} cover   The cover flag
 * @returns {object|null}
 */
export function stackIdentity(cover) {
  return cover ? { mode: cover.mode ?? null, secret: cover.secret ?? null, name: cover.name ?? null } : null;
}

/**
 * The secret of a cover as page content and back. The page is plain JSON so a GM can read it in the journal.
 * @param {object} payload
 * @returns {string}
 */
export function serializeSecret(payload) {
  return JSON.stringify({ v: COVER_VERSION, ...payload });
}

/**
 * @param {string} content
 * @returns {object|null}
 */
export function parseSecret(content) {
  const text = String(content ?? "").trim();
  // The raw text first: the description inside the JSON is HTML. Only if an editor wrapped the page in tags, strip them.
  for (const candidate of [text, text.replace(/^<[^>]+>|<\/[^>]+>$/g, "").trim()]) {
    try {
      const data = JSON.parse(candidate);
      if (data && typeof data === "object") return data;
    } catch {
      // try the next form
    }
  }
  return null;
}
