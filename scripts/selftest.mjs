/**
 * Self-test: checks the storage, the log, the requests to the GM and the system adapter. Meant to be run after an
 * update of Foundry or the game system; the GM also gets a notice once when a newer version than the verified one is
 * installed.
 */

import {MODULE_ID, TESTED_VERSIONS, esc, generation, t} from "./config.mjs";
import {adapter, hasAdapter} from "./adapters/index.mjs";
import {verify} from "./ledger.mjs";
import {pilesApi} from "./piles.mjs";
import {ledgerActor, ledgerJournal} from "./storage.mjs";

/** The functions of Item Piles' API the bridge needs. */
const PILE_FUNCTIONS = ["isItemPileLootable", "isValidItemPile", "getActorItems", "getActorCurrencies", "removeItems",
  "removeAttributes", "addItems", "createItemPile"];

/**
 * The installed versions of what the module was verified against.
 * @returns {Record<string, string>}
 */
function currentVersions() {
  const current = {core: game.version, [game.system.id]: game.system.version};
  const piles = game.modules.get("item-piles");
  if ( piles?.active ) current["item-piles"] = piles.version;
  return current;
}

/**
 * Run all checks.
 * @returns {{problems: string[], checks: number}}
 */
function checkAll() {
  const problems = [];
  let checks = 0;
  const check = (ok, key, data) => {
    checks++;
    if ( !ok ) problems.push(game.i18n.has(key) ? t(key, data) : key);
  };
  const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const actor = ledgerActor();
  const journal = ledgerJournal();
  check(!!actor, "SLL.SELFTEST.NoActor");
  check(!actor || ((actor.ownership?.default ?? 0) >= observer), "SLL.SELFTEST.ActorOwnership");
  check(!actor || ((actor.ownership?.default ?? 0) < CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER), "SLL.SELFTEST.ActorOwner");
  check(!!journal, "SLL.SELFTEST.NoJournal");
  check(!journal || ((journal.ownership?.default ?? 0) >= observer), "SLL.SELFTEST.JournalOwnership");
  const chain = verify();
  check(chain.ok, "SLL.SELFTEST.Chain", {count: chain.count});
  if ( generation() >= 14 ) check(typeof CONFIG.queries?.[`${MODULE_ID}.request`] === "function", "SLL.SELFTEST.Query");
  check(hasAdapter(), "SLL.SELFTEST.Generic", {system: game.system.title});
  for ( const problem of adapter().selfTest() ) check(false, problem);
  check(adapter().partyMembers().length > 0, "SLL.SELFTEST.NoCharacters");
  // Item Piles: the functions the bridge calls
  const piles = pilesApi();
  if ( piles ) check(PILE_FUNCTIONS.every(name => typeof piles[name] === "function"), "SLL.SELFTEST.ItemPiles");
  // Roll tables: the result editor the quantity field goes into
  check(!!foundry.applications.sheets?.TableResultConfig, "SLL.SELFTEST.TableResult");
  return {problems, checks};
}

/**
 * The installed versions next to the tested ones.
 * @returns {string}
 */
function versionLine() {
  const current = currentVersions();
  return Object.entries(TESTED_VERSIONS).filter(([id]) => id in current)
    .map(([id, tested]) => t("SLL.SELFTEST.Version", {id, current: current[id] ?? "–", tested}))
    .join(", ");
}

/**
 * Run the self-test and report the result as a notification and a whispered chat message.
 * @param {object} [options]
 * @param {boolean} [options.report=true]   Post the chat report
 * @returns {Promise<{problems: string[], checks: number}>}
 */
export async function runSelfTest({report=true}={}) {
  const {problems, checks} = checkAll();
  const versions = versionLine();
  const summary = problems.length ? t("SLL.SELFTEST.Problems", {problems: problems.length, checks})
    : t("SLL.SELFTEST.Passed", {checks, system: adapter().id});
  console.group(`${MODULE_ID} | Self-test`);
  console.log(versions);
  if ( problems.length ) console.warn("Problems:", problems);
  console.groupEnd();
  if ( problems.length ) ui.notifications.warn(summary, {permanent: true});
  else ui.notifications.info(summary);
  if ( report ) {
    let content = `<h3>${esc(t("SLL.SELFTEST.Title"))}</h3><p>${esc(summary)}</p><p><small>${esc(versions)}</small></p>`;
    if ( problems.length ) content += `<ul>${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`;
    await ChatMessage.implementation.create({content, whisper: [game.user.id],
      speaker: {alias: game.modules.get(MODULE_ID).title}});
  }
  return {problems, checks};
}

/**
 * Tell the GM once when Foundry or the system is newer than the versions the module was verified against.
 */
export function noticeNewVersions() {
  if ( !game.user.isGM ) return;
  const current = currentVersions();
  const newer = Object.entries(current)
    .filter(([id, version]) => TESTED_VERSIONS[id] && version && foundry.utils.isNewerVersion(version, TESTED_VERSIONS[id]))
    .map(([id, version]) => `${id} ${version}`);
  if ( !newer.length ) return;
  const signature = newer.join(",");
  if ( game.settings.get(MODULE_ID, "acknowledgedVersions") === signature ) return;
  game.settings.set(MODULE_ID, "acknowledgedVersions", signature);
  ui.notifications.info(t("SLL.SELFTEST.NewVersions", {versions: newer.join(", ")}), {permanent: true});
}
