/**
 * Everything that changes the loot, the stash, the party fund or a character runs here, on the client of the active
 * GM, one request at a time. Each action checks who asked: players may only act for characters they own, and only the
 * GM manages the loot. Every change ends up in the log.
 */

import {MODULE_ID, flag, setting, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {splitCoins} from "./coins.mjs";
import {append, entries} from "./ledger.mjs";
import {applyOperations, isBusy} from "./ops.mjs";
import {balance, pickWinner} from "./rules.mjs";
import {areaOf, isContained, isLedgerActor, ledgerActor, pendingRequests, storedCoins} from "./storage.mjs";
import {postApproval, postEntries, postOffer, postRolls, resolveCard} from "./chat.mjs";

/** Requests run one after another. */
let queue = Promise.resolve();

/**
 * Handle a request (active GM only).
 * @param {string} action
 * @param {object} payload
 * @param {User} user
 * @returns {Promise<object>}
 */
export function handleRequest(action, payload, user) {
  const run = queue.then(async () => {
    const fn = ACTIONS[action];
    if ( !fn ) return fail("SLL.Error.unknownAction");
    if ( !ledgerActor() ) return fail("SLL.Error.noStorage");
    try {
      return await fn(payload ?? {}, user);
    } catch(err) {
      console.error(`${MODULE_ID} | ${action} failed`, err);
      const key = String(err?.message ?? "");
      return fail(key.startsWith("SLL.") ? key : "SLL.Error.requestFailed");
    }
  });
  queue = run.catch(() => {});
  return run;
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const ok = (extra={}) => ({ok: true, ...extra});
const fail = (error, data) => ({ok: false, error, data});

/**
 * A world actor by id.
 * @param {string} id
 * @returns {Actor|null}
 */
function actorById(id) {
  return game.actors.get(id) ?? null;
}

/**
 * Does a user own an actor?
 * @param {User} user
 * @param {Actor} actor
 * @returns {boolean}
 */
function owns(user, actor) {
  return !!actor && (user.isGM || actor.testUserPermission(user, "OWNER"));
}

/**
 * Is an actor one of the player characters the module serves?
 * @param {Actor} actor
 * @returns {boolean}
 */
function isCharacter(actor) {
  return !!actor && !isLedgerActor(actor) && adapter().isCharacter(actor);
}

/**
 * A place for the log.
 * @param {Actor|string} where   An actor or "pool", "stash", "fund", "outside"
 * @returns {object}
 */
function place(where) {
  if ( typeof where === "string" ) return {kind: where};
  return {kind: "actor", id: where.id, name: where.name};
}

/**
 * Item details for the log.
 * @param {Item} item
 * @param {number} quantity
 * @returns {object}
 */
function itemInfo(item, quantity) {
  const a = adapter();
  return {name: a.displayName(item), img: item.img, quantity, value: a.value(item, quantity)};
}

/**
 * The log entry base for a user.
 * @param {User} user
 * @returns {{user: string, userName: string}}
 */
function by(user) {
  return {user: user.id, userName: user.name};
}

/**
 * Write log entries and post them to the chat.
 * @param {object[]} list
 * @returns {Promise<object[]>}
 */
async function record(list) {
  const sealed = await append(list);
  await postEntries(sealed);
  return sealed;
}

/**
 * The quantity to move: what was asked, at least 1, at most what there is.
 * @param {Item} item
 * @param {number} [quantity]
 * @returns {number}
 */
function amountOf(item, quantity) {
  const total = Math.max(adapter().quantity(item), 1);
  const asked = Math.floor(Number(quantity) || total);
  return Math.min(Math.max(asked, 1), total);
}

/**
 * Coins of the loot and the party fund as an actor update of the ledger actor.
 * @param {{pool?: number, fund?: number}} coins
 * @returns {object}
 */
function coinsUpdate(coins) {
  const current = storedCoins();
  const next = {pool: coins.pool ?? current.pool, fund: coins.fund ?? current.fund};
  if ( (next.pool < 0) || (next.fund < 0) ) throw new Error("SLL.Error.notEnoughCoins");
  return {_id: ledgerActor().id, [`flags.${MODULE_ID}.coins`]: next};
}

/* -------------------------------------------- */
/*  Moving items                                */
/* -------------------------------------------- */

/**
 * Move a number of units of an item to another actor, merging it into a matching stack.
 * @param {Item} item
 * @param {number} quantity
 * @param {Actor} target
 * @param {"pool"|"stash"} [area]   The area on the ledger actor
 * @returns {Promise<{itemId: string}>}   The item on the target which holds the units now
 */
async function moveItem(item, quantity, target, area) {
  const a = adapter();
  const source = item.parent;
  const total = a.quantity(item);
  const toLedger = isLedgerActor(target);
  const created = await a.transferData(item, quantity);
  for ( const data of created ) {
    data._id ??= foundry.utils.randomID();
    data.flags ??= {};
    if ( toLedger ) data.flags[MODULE_ID] = {area};
    else delete data.flags[MODULE_ID];
  }
  const [top] = created;
  const filter = toLedger ? (i => areaOf(i) === area) : (() => true);
  const stack = (created.length === 1) ? a.findStack(target, top, filter) : null;
  const qpath = a.quantityPath;

  // Inside the ledger actor a whole item without a stack to join only changes its area. It keeps its id, so older log
  // entries still find it.
  if ( (source === target) && !stack && (quantity >= total) ) {
    await applyOperations([{action: "update", documentName: "Item", parent: target, updates: a.deleteIds(item)
      .map(_id => ({_id, [`flags.${MODULE_ID}.area`]: area, [`flags.${MODULE_ID}.claims`]: null}))}]);
    return {itemId: item.id};
  }

  const operations = [];
  if ( stack ) {
    operations.push({action: "update", documentName: "Item", parent: target,
      updates: [{_id: stack.id, [qpath]: a.quantity(stack) + quantity}]});
  }
  else operations.push({action: "create", documentName: "Item", parent: target, data: created, options: {keepId: true}});
  if ( source ) {
    if ( quantity >= total ) {
      operations.push({action: "delete", documentName: "Item", parent: source, ids: a.deleteIds(item)});
    }
    else operations.push({action: "update", documentName: "Item", parent: source,
      updates: [{_id: item.id, [qpath]: total - quantity}]});
  }
  await applyOperations(operations);
  return {itemId: stack?.id ?? top._id};
}

/**
 * Find an item of the loot or the stash.
 * @param {string} itemId
 * @param {"pool"|"stash"} area
 * @returns {Item}
 */
function ledgerItem(itemId, area) {
  const item = ledgerActor().items.get(itemId);
  if ( !item || (areaOf(item) !== area) ) throw new Error("SLL.Error.itemGone");
  return item;
}

/**
 * Find an item a character carries and may hand over.
 * @param {Actor} actor
 * @param {string} itemId
 * @param {User} user
 * @returns {Item}
 */
function carriedItem(actor, itemId, user) {
  const item = actor?.items.get(itemId);
  if ( !item ) throw new Error("SLL.Error.itemGone");
  const a = adapter();
  if ( !a.isTransferable(item) ) throw new Error("SLL.Error.notTransferable");
  const reason = a.blockReason(item);
  if ( reason && !user.isGM ) throw new Error(reason);
  return item;
}

/* -------------------------------------------- */
/*  Pending requests                            */
/* -------------------------------------------- */

/**
 * Store an open request.
 * @param {object} request
 * @returns {Promise<object>}
 */
async function addPending(request) {
  const entry = {id: foundry.utils.randomID(), created: Date.now(), ...request};
  await game.settings.set(MODULE_ID, "pending", [...pendingRequests(), entry]);
  return entry;
}

/**
 * Remove an open request.
 * @param {string} id
 * @returns {Promise<object|null>}   The removed request
 */
async function takePending(id) {
  const list = pendingRequests();
  const request = list.find(r => r.id === id) ?? null;
  if ( request ) await game.settings.set(MODULE_ID, "pending", list.filter(r => r.id !== id));
  return request;
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

const ACTIONS = {

  /** A character claims an item of the loot: need, want, pass or nothing. */
  async claim({itemId, actorId, claim}, user) {
    const item = ledgerItem(itemId, "pool");
    const actor = actorById(actorId);
    if ( !isCharacter(actor) || !owns(user, actor) ) return fail("SLL.Error.notYours");
    const value = ["need", "want", "pass"].includes(claim) ? claim : null;
    await item.update({[`flags.${MODULE_ID}.claims.${actor.id}`]: value});
    return ok();
  },

  /** GM: give an item of the loot to a character. */
  async award({itemId, actorId, quantity}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const item = ledgerItem(itemId, "pool");
    const actor = actorById(actorId);
    if ( !isCharacter(actor) ) return fail("SLL.Error.noCharacter");
    const amount = amountOf(item, quantity);
    const info = itemInfo(item, amount);
    const {itemId: placed} = await moveItem(item, amount, actor);
    await record([{...by(user), kind: "award", from: place("pool"), to: place(actor), item: info,
      ref: {itemId: placed}}]);
    return ok();
  },

  /** GM: hand out every claimed item of the loot by the distribution rule. */
  async distribute({rule}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    rule ??= setting("distribution");
    const received = balance(entries());
    const lines = [];
    const log = [];
    for ( const item of ledgerActor().items.filter(i => (areaOf(i) === "pool") && !isContained(i)) ) {
      const claims = flag(item, "claims") ?? {};
      const rolls = {};
      let result = pickWinner(claims, {rule, received, rolls});
      let guard = 0;
      while ( !result.winner && result.needsRolls.length && (guard++ < 10) ) {
        for ( const id of result.needsRolls ) {
          const roll = await new Roll("1d100").evaluate();
          rolls[id] = roll.total;
        }
        result = pickWinner(claims, {rule, received, rolls});
        if ( result.reason === "tie" ) for ( const id of result.needsRolls ) delete rolls[id];
      }
      if ( !result.winner ) continue;
      const actor = actorById(result.winner);
      if ( !isCharacter(actor) ) continue;
      const amount = adapter().quantity(item) || 1;
      const info = itemInfo(item, amount);
      const {itemId: placed} = await moveItem(item, amount, actor);
      received[actor.id] = (received[actor.id] ?? 0) + info.value;
      log.push({...by(user), kind: "award", from: place("pool"), to: place(actor), item: info, ref: {itemId: placed},
        note: t(`SLL.Reason.${result.reason}`)});
      lines.push({item: info.name, winner: actor.name, reason: result.reason,
        rolls: Object.entries(rolls).map(([id, value]) => ({name: actorById(id)?.name ?? "?", value}))});
    }
    // Loot nobody wants goes into the party inventory
    const rest = await moveUnclaimed(user);
    if ( !log.length && !rest.length ) return fail("SLL.Error.nothingToDistribute");
    await postRolls(lines);
    await record([...log, ...rest]);
    return ok({notice: "SLL.Notice.distributed", data: {count: log.length, rest: rest.length}});
  },

  /** GM: move the loot nobody claimed into the party inventory. */
  async unclaimedToStash(payload, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const rest = await moveUnclaimed(user);
    if ( !rest.length ) return fail("SLL.Error.nothingUnclaimed");
    await record(rest);
    return ok();
  },

  /** GM: split the coins of the loot among characters. */
  async split({actorIds}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const actors = (actorIds ?? []).map(actorById).filter(isCharacter);
    if ( !actors.length ) return fail("SLL.Error.noCharacter");
    const coins = storedCoins();
    if ( !coins.pool ) return fail("SLL.Error.noCoinsToSplit");
    const {share, remainder} = splitCoins(coins.pool, actors.length);
    if ( !share ) return fail("SLL.Error.tooFewCoins");
    const a = adapter();
    const toFund = (setting("remainder") === "fund") ? remainder : 0;
    const updates = actors.map(actor => ({_id: actor.id, ...a.receiveUpdate(actor, share)}));
    updates.push(coinsUpdate({pool: coins.pool - (share * actors.length) - toFund, fund: coins.fund + toFund}));
    await applyOperations([{action: "update", documentName: "Actor", updates}]);
    const log = actors.map(actor => ({...by(user), kind: "split", from: place("pool"), to: place(actor), coins: share}));
    if ( toFund ) log.push({...by(user), kind: "move", from: place("pool"), to: place("fund"), coins: toFund,
      note: t("SLL.Reason.remainder")});
    await record(log);
    return ok();
  },

  /** GM: add coins to the loot or the party fund. */
  async addCoins({area, amount, note}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const base = Math.max(Math.floor(Number(amount) || 0), 0);
    if ( !base ) return fail("SLL.Error.noAmount");
    const key = (area === "fund") ? "fund" : "pool";
    const coins = storedCoins();
    await applyOperations([{action: "update", documentName: "Actor", updates: [coinsUpdate({[key]: coins[key] + base})]}]);
    await record([{...by(user), kind: "add", from: place("outside"), to: place(key), coins: base, note: note ?? ""}]);
    return ok();
  },

  /** GM: pay from the party fund (an inn, a ferry, a bribe). */
  async spend({amount, note}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const base = Math.max(Math.floor(Number(amount) || 0), 0);
    const coins = storedCoins();
    if ( !base ) return fail("SLL.Error.noAmount");
    if ( base > coins.fund ) return fail("SLL.Error.notEnoughCoins");
    await applyOperations([{action: "update", documentName: "Actor", updates: [coinsUpdate({fund: coins.fund - base})]}]);
    await record([{...by(user), kind: "spend", from: place("fund"), to: place("outside"), coins: base, note: note ?? ""}]);
    return ok();
  },

  /** GM: add items to the loot or the stash, from a sheet (moved) or from the sidebar, a compendium or a link (copied). */
  async addItems({area, uuids, data}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const key = (area === "stash") ? "stash" : "pool";
    const target = ledgerActor();
    const log = [];
    for ( const uuid of (uuids ?? []) ) {
      const item = await fromUuid(uuid);
      if ( !item ) continue;
      if ( item.parent instanceof Actor ) {
        if ( item.parent === target ) continue;
        if ( !adapter().isTransferable(item) ) continue;
        const amount = adapter().quantity(item) || 1;
        const info = itemInfo(item, amount);
        const from = item.parent;
        const {itemId} = await moveItem(item, amount, target, key);
        log.push({...by(user), kind: "add", from: place(from), to: place(key), item: info, ref: {itemId}});
      }
      else await addCopy(item.toObject(), key, target, log, user);
    }
    for ( const itemData of (data ?? []) ) await addCopy(itemData, key, target, log, user);
    if ( !log.length ) return fail("SLL.Error.notTransferable");
    await record(log);
    return ok();
  },

  /** GM: move an item between the loot and the stash. */
  async moveArea({itemId, to, quantity}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const from = (to === "pool") ? "stash" : "pool";
    const item = ledgerItem(itemId, from);
    const amount = amountOf(item, quantity);
    const info = itemInfo(item, amount);
    const {itemId: placed} = await moveItem(item, amount, ledgerActor(), to);
    await record([{...by(user), kind: "move", from: place(from), to: place(to), item: info, ref: {itemId: placed}}]);
    return ok();
  },

  /** GM: remove an item from the loot or the stash for good. */
  async removeItem({itemId, area}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const item = ledgerItem(itemId, area === "stash" ? "stash" : "pool");
    const info = itemInfo(item, adapter().quantity(item) || 1);
    await applyOperations([{action: "delete", documentName: "Item", parent: ledgerActor(), ids: adapter().deleteIds(item)}]);
    await record([{...by(user), kind: "remove", from: place(areaOf(item)), to: place("outside"), item: info}]);
    return ok();
  },

  /** A character puts an item into the stash. */
  async deposit({actorId, itemId, quantity}, user) {
    const actor = actorById(actorId);
    if ( !isCharacter(actor) || !owns(user, actor) ) return fail("SLL.Error.notYours");
    const item = carriedItem(actor, itemId, user);
    const amount = amountOf(item, quantity);
    const info = itemInfo(item, amount);
    const {itemId: placed} = await moveItem(item, amount, ledgerActor(), "stash");
    await record([{...by(user), kind: "deposit", from: place(actor), to: place("stash"), item: info,
      ref: {itemId: placed}}]);
    return ok();
  },

  /** A character takes an item from the stash, with the GM's approval if the world asks for it. */
  async withdraw({actorId, itemId, quantity}, user) {
    const actor = actorById(actorId);
    if ( !isCharacter(actor) || !owns(user, actor) ) return fail("SLL.Error.notYours");
    const item = ledgerItem(itemId, "stash");
    const amount = amountOf(item, quantity);
    if ( !user.isGM && (setting("stashWithdraw") === "approval") ) {
      const request = await addPending({type: "withdraw", user: user.id, payload: {actorId, itemId, quantity: amount},
        label: t("SLL.Pending.withdraw", {actor: actor.name, what: `${amount}× ${adapter().displayName(item)}`})});
      await postApproval(request);
      return ok({notice: "SLL.Notice.waitingApproval"});
    }
    return executeWithdraw(actor, item, amount, user);
  },

  /** A character pays coins into the party fund. */
  async depositCoins({actorId, coins}, user) {
    const actor = actorById(actorId);
    if ( !isCharacter(actor) || !owns(user, actor) ) return fail("SLL.Error.notYours");
    const a = adapter();
    const base = a.toBase(coins);
    if ( !base ) return fail("SLL.Error.noAmount");
    if ( !a.canPay(actor, coins) ) return fail("SLL.Error.notEnoughCoins");
    const stored = storedCoins();
    await applyOperations([{action: "update", documentName: "Actor",
      updates: [{_id: actor.id, ...a.payUpdate(actor, coins)}, coinsUpdate({fund: stored.fund + base})]}]);
    await record([{...by(user), kind: "deposit", from: place(actor), to: place("fund"), coins: base}]);
    return ok();
  },

  /** A character takes coins from the party fund, with the GM's approval above the world's limit. */
  async withdrawCoins({actorId, amount, note}, user) {
    const actor = actorById(actorId);
    if ( !isCharacter(actor) || !owns(user, actor) ) return fail("SLL.Error.notYours");
    const base = Math.max(Math.floor(Number(amount) || 0), 0);
    if ( !base ) return fail("SLL.Error.noAmount");
    if ( base > storedCoins().fund ) return fail("SLL.Error.notEnoughCoins");
    const a = adapter();
    const main = a.denominations().find(d => d.key === a.mainCoin())?.value ?? 1;
    const limit = Math.max(Number(setting("fundLimit")) || 0, 0) * main;
    if ( !user.isGM && (base > limit) ) {
      const request = await addPending({type: "withdrawCoins", user: user.id, payload: {actorId, amount: base, note},
        label: t("SLL.Pending.withdraw", {actor: actor.name, what: a.formatCoins(base)})});
      await postApproval(request);
      return ok({notice: "SLL.Notice.waitingApproval"});
    }
    return executeWithdrawCoins(actor, base, note, user);
  },

  /** A character gives an item to another character, who may have to accept it first. */
  async give({fromActorId, itemId, quantity, toActorId}, user) {
    const from = actorById(fromActorId);
    const to = actorById(toActorId);
    if ( !isCharacter(from) || !owns(user, from) ) return fail("SLL.Error.notYours");
    if ( !isCharacter(to) || (to === from) ) return fail("SLL.Error.noCharacter");
    const item = carriedItem(from, itemId, user);
    const amount = amountOf(item, quantity);
    if ( setting("giveAcceptance") && !owns(user, to) ) {
      const request = await addPending({type: "offer", user: user.id,
        payload: {fromActorId, itemId, quantity: amount, toActorId},
        label: t("SLL.Pending.offer", {from: from.name, to: to.name, what: `${amount}× ${adapter().displayName(item)}`})});
      await postOffer(request, to);
      return ok({notice: "SLL.Notice.offerSent", data: {name: to.name}});
    }
    return executeGive(from, item, amount, to, user);
  },

  /** The owner of a character accepts or declines an offer. */
  async answerOffer({id, accept}, user) {
    const request = pendingRequests().find(r => (r.id === id) && (r.type === "offer"));
    if ( !request ) return fail("SLL.Error.requestGone");
    const {fromActorId, itemId, quantity, toActorId} = request.payload;
    const from = actorById(fromActorId);
    const to = actorById(toActorId);
    if ( !owns(user, to) ) return fail("SLL.Error.notYours");
    await takePending(id);
    if ( !accept ) {
      await resolveCard(id, t("SLL.Card.declined", {name: to?.name ?? "?"}));
      return ok();
    }
    const giver = game.users.get(request.user) ?? user;
    const item = carriedItem(from, itemId, giver);
    const result = await executeGive(from, item, Math.min(quantity, adapter().quantity(item) || 1), to, giver);
    await resolveCard(id, t("SLL.Card.accepted", {name: to.name}));
    return result;
  },

  /** The asking user or the GM withdraws an open request. */
  async cancelRequest({id}, user) {
    const request = pendingRequests().find(r => r.id === id);
    if ( !request ) return fail("SLL.Error.requestGone");
    if ( !user.isGM && (request.user !== user.id) ) return fail("SLL.Error.notYours");
    await takePending(id);
    await resolveCard(id, t("SLL.Card.cancelled"));
    return ok();
  },

  /** GM: approve or deny a withdrawal. */
  async answerApproval({id, approve}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const request = pendingRequests().find(r => (r.id === id) && (r.type !== "offer"));
    if ( !request ) return fail("SLL.Error.requestGone");
    await takePending(id);
    const asker = game.users.get(request.user);
    if ( !approve || !asker ) {
      await resolveCard(id, t("SLL.Card.denied"));
      return ok();
    }
    const {actorId, itemId, quantity, amount, note} = request.payload;
    const actor = actorById(actorId);
    if ( !isCharacter(actor) ) return fail("SLL.Error.noCharacter");
    let result;
    if ( request.type === "withdraw" ) result = await executeWithdraw(actor, ledgerItem(itemId, "stash"), quantity, asker,
      t("SLL.Reason.approved", {name: user.name}));
    else result = await executeWithdrawCoins(actor, amount, note, asker, t("SLL.Reason.approved", {name: user.name}));
    await resolveCard(id, t("SLL.Card.approved"));
    return result;
  },

  /** GM: take the belongings of defeated combatants into the loot. */
  async collect({sources}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const a = adapter();
    const target = ledgerActor();
    const log = [];
    let coinsIn = 0;
    for ( const source of (sources ?? []) ) {
      const actor = await fromUuid(source.actorUuid);
      if ( !(actor instanceof Actor) || isLedgerActor(actor) ) continue;
      for ( const {id, quantity} of (source.items ?? []) ) {
        const item = actor.items.get(id);
        if ( !item || !a.isTransferable(item) ) continue;
        const amount = amountOf(item, quantity);
        const info = itemInfo(item, amount);
        const {itemId} = await moveItem(item, amount, target, "pool");
        log.push({...by(user), kind: "add", from: place(actor), to: place("pool"), item: info, ref: {itemId}});
      }
      // Coins: all of them, coin by coin where the system keeps them separately
      const base = source.coins ? a.coinsBase(actor) : 0;
      if ( base ) {
        await actor.update(a.payUpdate(actor, a.separateCoins ? a.purse(actor) : base));
        coinsIn += base;
        log.push({...by(user), kind: "add", from: place(actor), to: place("pool"), coins: base});
      }
    }
    if ( coinsIn ) {
      const coins = storedCoins();
      await applyOperations([{action: "update", documentName: "Actor", updates: [coinsUpdate({pool: coins.pool + coinsIn})]}]);
    }
    if ( !log.length ) return fail("SLL.Error.nothingCollected");
    await record(log);
    return ok({notice: "SLL.Notice.collected", data: {count: log.length}});
  },

  /** GM: reverse a log entry. */
  async undo({entryId}, user) {
    if ( !user.isGM ) return fail("SLL.Error.gmOnly");
    const all = entries();
    const entry = all.find(e => e.id === entryId);
    if ( !entry || ["undo", "edit", "remove"].includes(entry.kind) ) return fail("SLL.Error.cannotUndo");
    if ( all.some(e => (e.kind === "undo") && (e.undoes === entryId)) ) return fail("SLL.Error.alreadyUndone");
    await reverse(entry);
    await record([{...by(user), kind: "undo", undoes: entry.id, from: entry.to, to: entry.from, item: entry.item,
      coins: entry.coins}]);
    return ok();
  }
};

/* -------------------------------------------- */

/**
 * Move every item of the loot that nobody claimed (no claims, or everybody passed) into the party inventory.
 * @param {User} user
 * @returns {Promise<object[]>}   Log entries
 */
async function moveUnclaimed(user) {
  const log = [];
  for ( const item of ledgerActor().items.filter(i => (areaOf(i) === "pool") && !isContained(i)) ) {
    const claims = flag(item, "claims") ?? {};
    if ( Object.values(claims).some(c => (c === "need") || (c === "want")) ) continue;
    const amount = adapter().quantity(item) || 1;
    const info = itemInfo(item, amount);
    const {itemId} = await moveItem(item, amount, ledgerActor(), "stash");
    log.push({...by(user), kind: "move", from: place("pool"), to: place("stash"), item: info, ref: {itemId},
      note: t("SLL.Reason.unclaimed")});
  }
  return log;
}

/**
 * Add a copy of item data to the loot or the stash.
 * @param {object} data
 * @param {"pool"|"stash"} area
 * @param {Actor} target
 * @param {object[]} log
 * @param {User} user
 */
async function addCopy(data, area, target, log, user) {
  const a = adapter();
  const temp = new CONFIG.Item.documentClass(foundry.utils.deepClone(data), {parent: target});
  if ( !a.isTransferable(temp) ) return;
  const copy = foundry.utils.deepClone(data);
  delete copy._id;
  delete copy.folder;
  a.cleanData(copy);
  copy._id = foundry.utils.randomID();
  copy.flags = {...(copy.flags ?? {}), [MODULE_ID]: {area}};
  const amount = Math.max(a.quantity(copy), 1);
  const stack = a.findStack(target, copy, i => areaOf(i) === area);
  if ( stack ) {
    await applyOperations([{action: "update", documentName: "Item", parent: target,
      updates: [{_id: stack.id, [a.quantityPath]: a.quantity(stack) + amount}]}]);
  }
  else await applyOperations([{action: "create", documentName: "Item", parent: target, data: [copy],
    options: {keepId: true}}]);
  log.push({...by(user), kind: "add", from: place("outside"), to: place(area), item: itemInfo(temp, amount),
    ref: {itemId: stack?.id ?? copy._id}});
}

/**
 * Take an item from the stash.
 * @param {Actor} actor
 * @param {Item} item
 * @param {number} quantity
 * @param {User} user
 * @param {string} [note]
 * @returns {Promise<object>}
 */
async function executeWithdraw(actor, item, quantity, user, note="") {
  const amount = amountOf(item, quantity);
  const info = itemInfo(item, amount);
  const {itemId} = await moveItem(item, amount, actor);
  await record([{...by(user), kind: "withdraw", from: place("stash"), to: place(actor), item: info, ref: {itemId}, note}]);
  return ok();
}

/**
 * Take coins from the party fund.
 * @param {Actor} actor
 * @param {number} base
 * @param {string} note
 * @param {User} user
 * @param {string} [extra]
 * @returns {Promise<object>}
 */
async function executeWithdrawCoins(actor, base, note, user, extra="") {
  const coins = storedCoins();
  if ( base > coins.fund ) return fail("SLL.Error.notEnoughCoins");
  await applyOperations([{action: "update", documentName: "Actor",
    updates: [{_id: actor.id, ...adapter().receiveUpdate(actor, base)}, coinsUpdate({fund: coins.fund - base})]}]);
  await record([{...by(user), kind: "withdraw", from: place("fund"), to: place(actor), coins: base,
    note: [note, extra].filter(Boolean).join(", ")}]);
  return ok();
}

/**
 * Hand an item from one character to another.
 * @param {Actor} from
 * @param {Item} item
 * @param {number} quantity
 * @param {Actor} to
 * @param {User} user
 * @returns {Promise<object>}
 */
async function executeGive(from, item, quantity, to, user) {
  const info = itemInfo(item, quantity);
  const {itemId} = await moveItem(item, quantity, to);
  await record([{...by(user), kind: "give", from: place(from), to: place(to), item: info, ref: {itemId}}]);
  return ok();
}

/**
 * Reverse what an entry did.
 * @param {object} entry
 */
async function reverse(entry) {
  const a = adapter();
  const actorOf = p => ((p?.kind === "actor") ? actorById(p.id) : null);
  if ( entry.item ) {
    const holder = actorOf(entry.to) ?? (["pool", "stash"].includes(entry.to?.kind) ? ledgerActor() : null);
    const back = actorOf(entry.from) ?? (["pool", "stash"].includes(entry.from?.kind) ? ledgerActor() : null);
    const item = holder?.items.get(entry.ref?.itemId);
    if ( !holder || !item ) throw new Error("SLL.Error.cannotUndo");
    const amount = Math.min(entry.item.quantity, a.quantity(item) || 1);
    // Added from the sidebar, a compendium or a link: undoing removes it again
    if ( entry.from?.kind === "outside" ) {
      const total = a.quantity(item) || 1;
      if ( amount >= total ) await applyOperations([{action: "delete", documentName: "Item", parent: holder,
        ids: a.deleteIds(item)}]);
      else await applyOperations([{action: "update", documentName: "Item", parent: holder,
        updates: [{_id: item.id, [a.quantityPath]: total - amount}]}]);
    }
    else {
      if ( !back ) throw new Error("SLL.Error.cannotUndo");
      const area = ["pool", "stash"].includes(entry.from?.kind) ? entry.from.kind : undefined;
      await moveItem(item, amount, back, area);
    }
  }
  if ( entry.coins ) {
    const coins = storedCoins();
    const updates = [];
    const next = {...coins};
    const take = entry.to?.kind;
    const give = entry.from?.kind;
    if ( take === "actor" ) {
      const actor = actorOf(entry.to);
      if ( !actor || !a.canPay(actor, entry.coins) ) throw new Error("SLL.Error.cannotUndo");
      updates.push({_id: actor.id, ...a.payUpdate(actor, entry.coins)});
    }
    else if ( ["pool", "fund"].includes(take) ) {
      if ( next[take] < entry.coins ) throw new Error("SLL.Error.cannotUndo");
      next[take] -= entry.coins;
    }
    if ( give === "actor" ) {
      const actor = actorOf(entry.from);
      if ( !actor ) throw new Error("SLL.Error.cannotUndo");
      updates.push({_id: actor.id, ...a.receiveUpdate(actor, entry.coins)});
    }
    else if ( ["pool", "fund"].includes(give) ) next[give] += entry.coins;
    updates.push(coinsUpdate(next));
    await applyOperations([{action: "update", documentName: "Actor", updates}]);
  }
}

/* -------------------------------------------- */
/*  Changes made past the module                */
/* -------------------------------------------- */

/**
 * Hook on item changes: log changes to the ledger actor that did not come from the module (active GM only).
 * @param {"create"|"update"|"delete"} kind
 * @returns {Function}
 */
export function watchLedgerItems(kind) {
  return (item, changes) => {
    if ( !isLedgerActor(item.parent) ) return;
    // Every client keeps track, so a GM who becomes the active GM later knows the quantities too
    const a = adapter();
    const now = a.quantity(item);
    const before = knownQuantities.get(item.id);
    if ( kind === "delete" ) knownQuantities.delete(item.id);
    else knownQuantities.set(item.id, now);
    if ( !game.user.isActiveGM || isBusy() ) return;
    const area = areaOf(item);
    let entry;
    if ( kind === "update" ) {
      if ( !foundry.utils.hasProperty(changes ?? {}, a.quantityPath) || (before === now) ) return;
      const delta = Number.isFinite(before) ? Math.abs(now - before) : now;
      entry = {kind: "edit", item: {...itemInfo(item, now), value: a.value(item, delta)},
        ref: {before: before ?? null}, from: place(area), to: place(area)};
    }
    else entry = {kind: "edit", item: itemInfo(item, now || 1),
      from: place(kind === "create" ? "outside" : area), to: place(kind === "delete" ? "outside" : area)};
    handleRequest("_edit", {entry: {...by(game.user), ...entry}}, game.user);
  };
}

/** The quantities of the ledger actor's items as the active GM saw them last, to log how a quantity changed. */
const knownQuantities = new Map();

/** Remember the current quantities of the ledger actor's items (on ready). */
export function rememberLedgerItems() {
  const a = adapter();
  for ( const item of ledgerActor()?.items ?? [] ) knownQuantities.set(item.id, a.quantity(item));
}

ACTIONS._edit = async ({entry}, user) => {
  if ( !user.isGM ) return fail("SLL.Error.gmOnly");
  await record([entry]);
  return ok();
};
