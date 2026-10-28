import assert from "node:assert/strict";
import test from "node:test";

// The scripts behind debug.mjs touch these Foundry APIs at import time
globalThis.foundry = {
  utils: {debounce: fn => fn, deepClone: value => structuredClone(value)},
  applications: {api: {ApplicationV2: class {}, HandlebarsApplicationMixin: Base => class extends Base {}, DialogV2: class {}}}
};
globalThis.CONFIG = {};
globalThis.Hooks = {on: () => {}};
globalThis.game = {system: {id: "dnd5e"}};

const {MODULE_ID} = await import("../scripts/config.mjs");
const {debugTrace, payloadInfo, resultInfo} = await import("../scripts/trace.mjs");
const {registerTransport, request} = await import("../scripts/transport.mjs");
const {describeMessage, isModuleMessage, ledgerSummary} = await import("../scripts/debug.mjs");

/**
 * Users and the Foundry generation for a request.
 * @param {object} options
 * @param {boolean} options.activeGM   Whether this client is the active GM
 * @param {boolean} [options.gmOnline]
 * @param {number} [options.generation]
 */
function setClient({activeGM, gmOnline=true, generation=14}) {
  const gm = {id: "gm1", isGM: true};
  globalThis.game = {
    system: {id: "dnd5e"},
    release: {generation},
    user: activeGM ? {...gm, isActiveGM: true} : {id: "player1", isGM: false, isActiveGM: false},
    users: {activeGM: gmOnline ? gm : null, filter: () => []}
  };
}

test("the trace keeps ids and sizes of a payload, never item data or notes", () => {
  const info = payloadInfo({
    itemId: "a1B2c3", area: "stash", quantity: 3, approve: true, note: "for the rogue",
    uuids: ["Actor.x.Item.y", "Actor.x.Item.z"], data: [{name: "Longsword", system: {}}], coins: {gp: 3, sp: 2}, none: null
  });
  assert.deepEqual(info, {
    itemId: "a1B2c3", area: "stash", quantity: 3, approve: true, note: "(13 characters)",
    uuids: ["Actor.x.Item.y", "Actor.x.Item.z"], data: "(1 entries)", coins: "(2 keys)", none: null
  });
  assert.deepEqual(payloadInfo(undefined), {});
  assert.deepEqual(resultInfo({ok: true, notice: "SLL.Notice.waitingApproval"}), {ok: true});
  assert.deepEqual(resultInfo({ok: false, error: "SLL.Error.notYours"}), {ok: false, error: "SLL.Error.notYours"});
  assert.deepEqual(resultInfo(undefined), {ok: false, error: "SLL.Error.requestFailed"});
});

test("requests and handled queries end up in the trace with their route", async () => {
  debugTrace.clear();
  registerTransport(async action => (action === "give" ? {ok: false, error: "SLL.Error.notYours"} : {ok: true}));

  setClient({activeGM: true});
  const result = await request("give", {itemId: "abc", data: [{name: "Rope"}]});
  assert.deepEqual(result, {ok: false, error: "SLL.Error.notYours"});

  setClient({activeGM: false, gmOnline: false});
  assert.deepEqual(await request("claim", {itemId: "abc", claim: "need"}), {ok: false, error: "SLL.Error.noGM"});

  // The query handler on the GM's client: Foundry 14 names the sender
  setClient({activeGM: true});
  await CONFIG.queries[`${MODULE_ID}.request`]({action: "claim", payload: {itemId: "abc"}}, {user: {id: "player1"}});
  await CONFIG.queries[`${MODULE_ID}.request`]({action: "claim", payload: {}}, {});

  const entries = debugTrace.entries.map(({event, action, route, ok, error, user, payload}) => ({event, action, route, ok, error, user, payload}));
  assert.deepEqual(entries, [
    {event: "request", action: "give", route: "gm", ok: false, error: "SLL.Error.notYours", user: undefined,
      payload: {itemId: "abc", data: "(1 entries)"}},
    {event: "request", action: "claim", route: "noGM", ok: false, error: "SLL.Error.noGM", user: undefined,
      payload: {itemId: "abc", claim: "need"}},
    {event: "handled", action: "claim", route: "query", ok: true, error: undefined, user: "player1", payload: {itemId: "abc"}},
    {event: "handled", action: "claim", route: "query", ok: false, error: "SLL.Error.unknownSender", user: null, payload: {}}
  ]);
  assert.ok(debugTrace.entries.every(entry => Number.isFinite(entry.ms) && entry.at));
});

test("the ledger summary counts loot claims, approvals and offers", () => {
  const summary = ledgerSummary({
    actor: {id: "act", name: "Party", type: "group", items: 4},
    journal: {id: "jrn", name: "Loot log", pages: 2},
    coins: {pool: 120, fund: 30},
    pool: [
      {id: "i1", name: "Rope", claims: {a1: "need", a2: "pass"}},
      {id: "i2", name: "Torch", claims: {a1: "pass"}},
      {id: "i3", name: "Gem", claims: null}
    ],
    stash: 1,
    pending: [
      {id: "p1", type: "withdraw", user: "player1", label: "Mira takes 2× Rope", created: 0, payload: {actorId: "a1", itemId: "i9"}},
      {id: "p2", type: "offer", user: "player2", label: "Gem for Mira", payload: {fromActorId: "a2", toActorId: "a1"}}
    ],
    chain: {ok: true, brokenAt: null, count: 12}
  });
  assert.deepEqual(summary.loot, {items: 3, claimed: 1, claims: [
    {id: "i1", name: "Rope", claims: {a1: "need", a2: "pass"}},
    {id: "i2", name: "Torch", claims: {a1: "pass"}}
  ]});
  assert.equal(summary.pending.approvals, 1);
  assert.equal(summary.pending.offers, 1);
  assert.equal(summary.pending.requests[0].created, new Date(0).toISOString());
  assert.equal(summary.pending.requests[1].created, null);
  assert.deepEqual(summary.pending.requests[1].payload, {fromActorId: "a2", toActorId: "a1"});
  assert.deepEqual(summary.coins, {pool: 120, fund: 30});
  assert.deepEqual(summary.log, {ok: true, brokenAt: null, count: 12});
  assert.deepEqual(ledgerSummary().loot, {items: 0, claimed: 0, claims: []});
});

test("a card tells whether its request is still open", () => {
  globalThis.game = {actors: {get: id => (id === "a1" ? {name: "Mira"} : null)}};
  const card = (id, flags) => ({id, flags: {[MODULE_ID]: {card: true, ...flags}}});
  const pending = [{id: "p1", type: "offer"}];

  assert.deepEqual(describeMessage(card("m1", {pending: "p1", kind: "offer", to: "a1"}), pending), {
    messageId: "m1", kind: "offer", pending: {id: "p1", state: "open", type: "offer", resolved: null},
    to: {id: "a1", name: "Mira"}
  });
  assert.equal(describeMessage(card("m2", {pending: "p2", kind: "approval", resolved: "Approved"}), pending).pending.state, "resolved");
  assert.equal(describeMessage(card("m3", {pending: "p3", kind: "approval"}), pending).pending.state, "missing");
  assert.deepEqual(describeMessage(card("m4", {}), pending), {messageId: "m4", kind: "card"});

  const requestMessage = {id: "m5", flags: {[MODULE_ID]: {
    request: {id: "r1", action: "deposit", payload: {itemId: "i1", note: "keep it safe"}},
    answer: {ok: false, error: "SLL.Error.notYours"}
  }}};
  assert.deepEqual(describeMessage(requestMessage, pending), {messageId: "m5", kind: "request", request: {
    id: "r1", action: "deposit", payload: {itemId: "i1", note: "(12 characters)"}, answer: {ok: false, error: "SLL.Error.notYours"}
  }});
  assert.equal(isModuleMessage(requestMessage), true);
  assert.equal(isModuleMessage({flags: {core: {}}}), false);
});
