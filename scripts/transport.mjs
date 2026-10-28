/**
 * Requests to the GM. Players may not change the ledger actor or other players' characters, so every change runs on
 * the client of the active GM, which checks who asked. The GM must know the sender for sure:
 * - Foundry 14 hands the sender of a query to the handler.
 * - Foundry 13 does not, so a request travels there as a whispered chat message, whose author the server confirms.
 *   The GM's client answers in the same message and deletes it; nobody sees these messages.
 */

import {MODULE_ID, generation, t} from "./config.mjs";
import {debugTrace, payloadInfo, resultInfo} from "./trace.mjs";

/** The query name. */
const QUERY = `${MODULE_ID}.request`;

/** Requests which wait for an answer on Foundry 13, by id. */
const waiting = new Map();

/** The function which handles a request on the GM's client. */
let handler = null;

/* -------------------------------------------- */

/**
 * Install the transport. Call once in "init".
 * @param {(action: string, payload: object, user: User) => Promise<object>} handle
 */
export function registerTransport(handle) {
  handler = handle;
  CONFIG.queries ??= {};
  CONFIG.queries[QUERY] = async (data, options={}) => {
    // Foundry 13 does not name the sender of a query, so it never takes this path
    const user = options.user ?? null;
    const started = Date.now();
    const result = user ? await handler(data.action, data.payload ?? {}, user)
      : {ok: false, error: "SLL.Error.unknownSender"};
    debugTrace.add("handled", {action: data.action, route: "query", user: user?.id ?? null, ...resultInfo(result),
      ms: Date.now() - started, payload: payloadInfo(data.payload)});
    return result;
  };
  Hooks.on("createChatMessage", onCreateRequest);
  Hooks.on("updateChatMessage", onAnswer);
  Hooks.on("renderChatMessageHTML", hideRequest);
}

/**
 * Which way a request of this client travels: handled right here (active GM), as a query (Foundry 14), as a chat
 * message (Foundry 13), or nowhere because no GM is online.
 * @returns {"gm"|"query"|"chat"|"noGM"}
 */
export function requestRoute() {
  if ( game.user.isActiveGM ) return "gm";
  if ( !game.users.activeGM ) return "noGM";
  return (generation() >= 14) ? "query" : "chat";
}

/**
 * Send a request to the GM and wait for the answer.
 * @param {string} action
 * @param {object} [payload]
 * @returns {Promise<object>}   {ok: true, ...} or {ok: false, error}
 */
export async function request(action, payload={}) {
  const started = Date.now();
  const route = requestRoute();
  const trace = (result, extra={}) => {
    debugTrace.add("request", {action, route, ...resultInfo(result), ms: Date.now() - started,
      payload: payloadInfo(payload), ...extra});
    return result;
  };
  if ( route === "gm" ) return trace(await handler(action, payload, game.user));
  if ( route === "noGM" ) return trace({ok: false, error: "SLL.Error.noGM"});
  try {
    if ( route === "query" ) return trace(await game.users.activeGM.query(QUERY, {action, payload}, {timeout: 30000}));
    return trace(await chatRequest(action, payload));
  } catch(err) {
    console.error(`${MODULE_ID} | Request ${action} failed`, err);
    return trace({ok: false, error: "SLL.Error.requestFailed"}, {exception: String(err?.message ?? err)});
  }
}

/**
 * Show the error of an answer, if any.
 * @param {object} result
 * @returns {boolean}   Whether the request succeeded
 */
export function report(result) {
  if ( result?.ok ) {
    if ( result.notice ) ui.notifications.info(t(result.notice, result.data));
    return true;
  }
  const key = result?.error ?? "SLL.Error.requestFailed";
  ui.notifications.warn(game.i18n.has(key) ? t(key, result?.data) : key);
  return false;
}

/* -------------------------------------------- */
/*  Foundry 13: requests as chat messages       */
/* -------------------------------------------- */

/**
 * Send a request as a whispered chat message and wait for the GM's answer.
 * @param {string} action
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function chatRequest(action, payload) {
  const id = foundry.utils.randomID();
  const answer = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("timeout"));
    }, 30000);
    waiting.set(id, result => {
      clearTimeout(timer);
      resolve(result);
    });
  });
  const message = await ChatMessage.implementation.create({
    content: "<span></span>",
    whisper: game.users.filter(u => u.isGM).map(u => u.id),
    flags: {[MODULE_ID]: {request: {id, action, payload}}}
  });
  debugTrace.add("chat request sent", {action, requestId: id, messageId: message?.id ?? null});
  return answer;
}

/**
 * GM: handle a request message.
 * @param {ChatMessage} message
 */
async function onCreateRequest(message) {
  const req = message.getFlag(MODULE_ID, "request");
  if ( !req || !game.user.isActiveGM || message.getFlag(MODULE_ID, "answer") ) return;
  const user = message.author;
  const started = Date.now();
  let result;
  let exception;
  try {
    result = user ? await handler(req.action, req.payload ?? {}, user) : {ok: false, error: "SLL.Error.unknownSender"};
  } catch(err) {
    console.error(`${MODULE_ID} | Request ${req.action} failed`, err);
    result = {ok: false, error: "SLL.Error.requestFailed"};
    exception = String(err?.message ?? err);
  }
  debugTrace.add("handled", {action: req.action, route: "chat", user: user?.id ?? null, messageId: message.id,
    requestId: req.id, ...resultInfo(result), ms: Date.now() - started, payload: payloadInfo(req.payload), exception});
  await message.update({[`flags.${MODULE_ID}.answer`]: result});
  setTimeout(() => message.delete().catch(() => {}), 3000);
}

/**
 * Player: receive the answer to a request.
 * @param {ChatMessage} message
 */
function onAnswer(message) {
  const req = message.getFlag(MODULE_ID, "request");
  const answer = message.getFlag(MODULE_ID, "answer");
  if ( !req || !answer ) return;
  const resolve = waiting.get(req.id);
  if ( !resolve ) {
    // The asking client has stopped waiting: the answer came after the timeout
    if ( message.author?.id === game.user.id ) {
      debugTrace.add("late answer", {action: req.action, requestId: req.id, messageId: message.id});
    }
    return;
  }
  waiting.delete(req.id);
  resolve(answer);
}

/**
 * Keep request messages out of the chat log.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
function hideRequest(message, html) {
  if ( !message.getFlag(MODULE_ID, "request") ) return;
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  if ( element ) element.style.display = "none";
}
