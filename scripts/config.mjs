/**
 * Constants and small helpers shared by the scripts of the module. The module runs on Foundry 13 and 14, so it uses
 * game.i18n instead of the v14 global _loc.
 */

/** The id of this module. */
export const MODULE_ID = "sephrals-loot-ledger";

/** The folder of the module's templates. */
export const TEMPLATES = `modules/${MODULE_ID}/templates`;

/** The Foundry versions the module was verified against (see the self-test). */
export const TESTED_VERSIONS = {core: "14.369", crucible: "0.11.2", dnd5e: "6.0.6"};

/**
 * Read a setting of this module.
 * @param {string} key
 * @returns {*}
 */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

/**
 * The parts of the ledger the world uses (world settings). A part that is switched off stays visible while it still
 * holds something, so nothing gets lost.
 * @returns {{loot: boolean, fund: boolean, balance: boolean}}
 */
export function parts() {
  return {loot: !!setting("lootTable"), fund: !!setting("partyFund"), balance: !!setting("balanceTab")};
}

/**
 * Localize a key, with optional data.
 * @param {string} key
 * @param {object} [data]
 * @returns {string}
 */
export function t(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

/**
 * Escape a value for HTML.
 * @param {*} value
 * @returns {string}
 */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;",
    "'": "&#39;"})[ch]);
}

/**
 * The generation of the running Foundry version (13 or 14).
 * @returns {number}
 */
export function generation() {
  return Number(game.release?.generation) || 13;
}

/**
 * The module's flag scope on a document.
 * @param {foundry.abstract.Document} doc
 * @param {string} key
 * @returns {*}
 */
export function flag(doc, key) {
  return foundry.utils.getProperty(doc, `flags.${MODULE_ID}.${key}`);
}
