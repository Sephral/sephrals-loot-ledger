/**
 * Loot Ledger's part of the debug file of Sephral's modules: how requests reach the GM, the state of the ledger, the
 * module's chat cards and the recent requests this client sent or handled. GMs save it from the settings, from the
 * chat context menu or with api.saveDebugFile(). It holds chat text and whispers, the notice says so.
 */

import {MODULE_ID, flag, generation, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {recentMessages, registerDebugProvider} from "./debug-file.mjs";
import {entries, verify} from "./ledger.mjs";
import {areaItems, ledgerActor, ledgerJournal, pendingRequests, storedCoins} from "./storage.mjs";
import {debugTrace, payloadInfo, resultInfo} from "./trace.mjs";
import {requestRoute} from "./transport.mjs";

/** How many of the latest chat messages are searched for the module's cards. */
const RECENT_LIMIT = 50;

/**
 * Does a chat message belong to the module: a card, or a request to the GM (Foundry 13)?
 * @param {ChatMessage} message
 * @returns {boolean}
 */
export function isModuleMessage(message) {
  return !!message?.flags?.[MODULE_ID];
}

/* -------------------------------------------- */
/*  Content                                     */
/* -------------------------------------------- */

/**
 * The state of the ledger in a few numbers.
 * @param {object} state
 * @param {{id: string, name: string, type: string, items: number}|null} [state.actor]
 * @param {{id: string, name: string, pages: number}|null} [state.journal]
 * @param {{pool: number, fund: number}} [state.coins]   Base units
 * @param {{id: string, name: string, claims: object|null}[]} [state.pool]   The items of the loot
 * @param {number} [state.stash]                          The number of items in the party inventory
 * @param {object[]} [state.pending]                      The open approvals and offers
 * @param {{ok: boolean, brokenAt: number|null, count: number}|null} [state.chain]   The check of the log
 * @returns {object}
 */
export function ledgerSummary({actor=null, journal=null, coins={}, pool=[], stash=0, pending=[], chain=null}={}) {
  const wanted = claims => Object.values(claims ?? {}).some(c => (c === "need") || (c === "want"));
  const offers = pending.filter(r => r.type === "offer");
  return {
    actor,
    journal,
    coins: {pool: coins.pool ?? 0, fund: coins.fund ?? 0},
    loot: {
      items: pool.length,
      claimed: pool.filter(item => wanted(item.claims)).length,
      claims: pool.filter(item => item.claims && Object.keys(item.claims).length)
        .map(item => ({id: item.id, name: item.name, claims: item.claims}))
    },
    stash: {items: stash},
    pending: {
      approvals: pending.length - offers.length,
      offers: offers.length,
      requests: pending.map(r => ({id: r.id, type: r.type, user: r.user ?? null, label: r.label ?? "",
        created: Number.isFinite(r.created) ? new Date(r.created).toISOString() : null, payload: payloadInfo(r.payload)}))
    },
    log: chain
  };
}

/**
 * Read the state of the ledger for ledgerSummary.
 * @returns {object}
 */
function collectState() {
  try {
    const actor = ledgerActor();
    const journal = ledgerJournal();
    const coins = storedCoins();
    return {
      ...ledgerSummary({
        actor: actor ? {id: actor.id, name: actor.name, type: actor.type, items: actor.items.size} : null,
        journal: journal ? {id: journal.id, name: journal.name, pages: journal.pages.size} : null,
        coins,
        pool: areaItems("pool").map(item => ({id: item.id, name: item.name, claims: flag(item, "claims") ?? null})),
        stash: areaItems("stash").length,
        pending: pendingRequests(),
        chain: verify()
      }),
      coinsText: {pool: adapter().formatCoins(coins.pool), fund: adapter().formatCoins(coins.fund)},
      lastEntry: entries().at(-1)?.seq ?? 0
    };
  } catch(err) {
    return {error: String(err?.stack ?? err)};
  }
}

/**
 * How requests reach the GM in this world.
 * @returns {object}
 */
function transportState() {
  return {
    generation: generation(),
    playerRoute: (generation() >= 14) ? "query" : "chat",
    thisClient: requestRoute(),
    queryRegistered: typeof CONFIG.queries?.[`${MODULE_ID}.request`] === "function",
    activeGM: game.users.activeGM?.id ?? null
  };
}

/**
 * What a chat message of the module is and whether the request behind it is still open.
 * @param {ChatMessage} message
 * @param {object[]} [pending]   The open approvals and offers
 * @returns {object}
 */
export function describeMessage(message, pending=pendingRequests()) {
  const data = message?.flags?.[MODULE_ID] ?? {};
  const kind = data.request ? "request" : data.card ? (data.kind ?? "card") : "other";
  const description = {messageId: message?.id ?? null, kind};
  if ( data.pending ) {
    const open = pending.find(r => r.id === data.pending);
    // Missing: neither open nor marked as answered, the card lost its request
    const state = data.resolved ? "resolved" : open ? "open" : "missing";
    description.pending = {id: data.pending, state, type: open?.type ?? null, resolved: data.resolved ?? null};
  }
  if ( data.to ) description.to = {id: data.to, name: game.actors?.get(data.to)?.name ?? null};
  if ( data.request ) {
    description.request = {id: data.request.id, action: data.request.action, payload: payloadInfo(data.request.payload),
      answer: data.answer ? resultInfo(data.answer) : null};
  }
  return description;
}

/* -------------------------------------------- */
/*  Part of the debug file                      */
/* -------------------------------------------- */

/**
 * The ledger and the module's cards among the latest chat messages.
 * @returns {{messages: ChatMessage[], details: object}}
 */
export function describeRecent() {
  const messages = recentMessages(RECENT_LIMIT).filter(isModuleMessage);
  const pending = pendingRequests();
  return {
    messages,
    details: {
      transport: transportState(),
      ledger: collectState(),
      messages: Object.fromEntries(messages.map(m => [m.id, describeMessage(m, pending)]))
    }
  };
}

/**
 * Loot Ledger's part of the debug file of Sephral's modules, for its own chat messages. Call in "init": the chat log
 * builds its context menu before "ready". t() follows a fixed module language.
 */
export function registerDebug() {
  registerDebugProvider({
    moduleId: MODULE_ID,
    label: () => t("SLL.DEBUG.Entry"),
    notice: file => t("SLL.DEBUG.Saved", {file}),
    applies: isModuleMessage,
    message: message => ({message: describeMessage(message), transport: transportState(), ledger: collectState()}),
    recent: describeRecent,
    trace: debugTrace
  });
}
