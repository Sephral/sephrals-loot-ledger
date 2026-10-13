/**
 * Where the module keeps things. Two documents, both created by the GM on the first start and readable by everyone:
 * - the ledger actor holds the items of the loot and of the stash (an item flag tells which) and, in a flag, the coins
 *   of the loot and of the party fund. Players only observe it, so they cannot take anything past the module.
 * - the ledger journal holds the transfer log, one page per day.
 * World settings remember both documents and the open requests (approvals and offers).
 */

import {MODULE_ID, flag, setting, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";

/** The two areas of the ledger actor. */
export const AREAS = ["pool", "stash"];

/* -------------------------------------------- */

/**
 * The ledger actor.
 * @returns {Actor|null}
 */
export function ledgerActor() {
  const id = setting("ledgerActor");
  return (id && game.actors.get(id)) || game.actors.find(a => flag(a, "ledger")) || null;
}

/**
 * The ledger journal.
 * @returns {JournalEntry|null}
 */
export function ledgerJournal() {
  const id = setting("ledgerJournal");
  return (id && game.journal.get(id)) || game.journal.find(j => flag(j, "ledger")) || null;
}

/**
 * Is a document the ledger actor?
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isLedgerActor(actor) {
  return !!actor && (actor === ledgerActor() || !!flag(actor, "ledger"));
}

/**
 * Create the ledger actor and journal if they are missing (active GM only).
 * @returns {Promise<void>}
 */
export async function ensureStorage() {
  if ( !game.user.isActiveGM ) return;
  const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  let actor = ledgerActor();
  if ( !actor ) {
    actor = await Actor.implementation.create({
      name: t("SLL.Storage.actorName"),
      type: adapter().stashType(),
      img: "icons/svg/chest.svg",
      ownership: {default: observer},
      flags: {[MODULE_ID]: {ledger: true, coins: {pool: 0, fund: 0}}}
    });
  }
  if ( actor && (setting("ledgerActor") !== actor.id) ) await game.settings.set(MODULE_ID, "ledgerActor", actor.id);
  let journal = ledgerJournal();
  if ( !journal ) {
    journal = await JournalEntry.implementation.create({
      name: t("SLL.Storage.journalName"),
      ownership: {default: observer},
      flags: {[MODULE_ID]: {ledger: true, last: {seq: 0, hash: ""}}}
    });
  }
  if ( journal && (setting("ledgerJournal") !== journal.id) ) {
    await game.settings.set(MODULE_ID, "ledgerJournal", journal.id);
  }
}

/* -------------------------------------------- */

/**
 * The area of an item on the ledger actor.
 * @param {Item} item
 * @returns {"pool"|"stash"}
 */
export function areaOf(item) {
  return (flag(item, "area") === "pool") ? "pool" : "stash";
}

/**
 * The items of one area.
 * @param {"pool"|"stash"} area
 * @returns {Item[]}
 */
export function areaItems(area) {
  const actor = ledgerActor();
  if ( !actor ) return [];
  const a = adapter();
  return actor.items.filter(i => (areaOf(i) === area) && a.isTransferable(i) && !isContained(i))
    .sort((x, y) => (x.sort - y.sort) || x.name.localeCompare(y.name, game.i18n.lang));
}

/**
 * Is an item inside a container of the same actor (it then travels with the container)?
 * @param {Item} item
 * @returns {boolean}
 */
export function isContained(item) {
  const container = item?.system?.container;
  return !!(container && item.parent?.items.get(container));
}

/**
 * The coins of the loot and of the party fund in base units.
 * @returns {{pool: number, fund: number}}
 */
export function storedCoins() {
  const coins = flag(ledgerActor(), "coins") ?? {};
  return {pool: Math.max(Number(coins.pool) || 0, 0), fund: Math.max(Number(coins.fund) || 0, 0)};
}

/**
 * The open requests: approvals for the GM and offers between characters.
 * @returns {object[]}
 */
export function pendingRequests() {
  const list = setting("pending");
  return Array.isArray(list) ? list : [];
}
