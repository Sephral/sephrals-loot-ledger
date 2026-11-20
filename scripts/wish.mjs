/**
 * The wish list. Every user keeps a list of things they look for, in their own user flag: a name (or part of one) or an
 * item link. Matching loot gets a star in the loot table, the GM sees who wished for what, and the player whose wish
 * matches is told once per wish and loot entry. Players change their own flag, nobody changes another user's list except
 * the GM, so no request to the GM is needed. The active GM does the matching when loot appears and writes the keys of
 * the told wishes on the loot entry; the players' clients show the notice when they see that update.
 */

import {MODULE_ID, flag, setting, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {areaOf, isContained, isLedgerActor, ledgerActor} from "./storage.mjs";
import {afterRequests} from "./service.mjs";
import {scheduleRefresh} from "./app.mjs";
import {countFeature} from "./usage.mjs";
import {MAX_WISHES, cleanWishes, findMatches, freshMatches, hasWish, keysOfUser, makeWish, matchesWish}
  from "./wish-logic.mjs";

/** The notices this browser showed already, so a redraw or a second update never repeats one. */
const told = new Set();

/** The ids of every user's wishes as this browser last saw them, to count the ones added. */
const known = new Map();

/** The flag path of the wishes on a user. */
const PATH = `flags.${MODULE_ID}.wishes`;

/**
 * Is the wish list switched on?
 * @returns {boolean}
 */
export function wishesOn() {
  return !!setting("wishList");
}

/**
 * The wishes of a user.
 * @param {User} user
 * @returns {object[]}
 */
export function userWishes(user) {
  return cleanWishes(foundry.utils.getProperty(user ?? {}, PATH));
}

/**
 * The wishes of every user who has any.
 * @returns {Record<string, object[]>}
 */
export function allWishes() {
  const out = {};
  for ( const user of game.users ) {
    const list = userWishes(user);
    if ( list.length ) out[user.id] = list;
  }
  return out;
}

/**
 * What a piece of loot looks like to a wish: the name players see (the cover name for an unidentified item) and the
 * items it was copied from.
 * @param {Item} item
 * @returns {import("./wish-logic.mjs").WishTarget}
 */
export function wishTarget(item) {
  const a = adapter();
  const cover = a.coverOf(item);
  return {
    name: cover ? cover.name : a.displayName(item),
    covered: !!cover,
    sources: [item._stats?.compendiumSource, item._stats?.duplicateSource, foundry.utils.getProperty(item, "flags.core.sourceId")]
      .filter(Boolean)
  };
}

/**
 * The wishes of a user which match a piece of loot.
 * @param {User} user
 * @param {Item} item
 * @returns {object[]}
 */
export function wishesMatching(user, item) {
  const target = wishTarget(item);
  return userWishes(user).filter(w => matchesWish(w, target));
}

/* -------------------------------------------- */
/*  Changing the list                           */
/* -------------------------------------------- */

/** Changes of the own list run one after another, so two quick wishes cannot overwrite each other. */
let writing = Promise.resolve();

/**
 * Add a wish to the list of the current user.
 * @param {{text?: string, uuid?: string, img?: string}} input
 * @returns {Promise<"added"|"empty"|"known"|"full">}
 */
export function addWish(input) {
  const run = writing.then(async () => {
    const wish = makeWish(input, foundry.utils.randomID());
    if ( !wish ) return "empty";
    const list = userWishes(game.user);
    if ( hasWish(list, wish) ) return "known";
    if ( list.length >= MAX_WISHES ) return "full";
    await game.user.setFlag(MODULE_ID, "wishes", [...list, wish]);
    return "added";
  });
  writing = run.catch(() => {});
  return run;
}

/**
 * Remove a wish from the list of a user (the user themselves, or the GM).
 * @param {string} userId
 * @param {string} wishId
 * @returns {Promise<void>}
 */
export function removeWish(userId, wishId) {
  const run = writing.then(async () => {
    const user = game.users.get(userId);
    if ( !user || ((user !== game.user) && !game.user.isGM) ) return;
    await user.setFlag(MODULE_ID, "wishes", userWishes(user).filter(w => w.id !== wishId));
  });
  writing = run.catch(() => {});
  return run;
}

/* -------------------------------------------- */
/*  Matching loot                               */
/* -------------------------------------------- */

/**
 * Check one piece of loot against everybody's wishes and write the keys of the wishes nobody was told about yet on it
 * (active GM). The players' clients show the notice when they see that update.
 * @param {string} itemId
 * @returns {Promise<void>}
 */
async function evaluate(itemId) {
  const item = ledgerActor()?.items.get(itemId);
  if ( !item || (areaOf(item) !== "pool") || isContained(item) ) return;
  const fresh = freshMatches(findMatches(allWishes(), wishTarget(item)), flag(item, "wishNotified"));
  if ( !fresh.length ) return;
  await item.update({[`flags.${MODULE_ID}.wishNotified`]: [...(flag(item, "wishNotified") ?? []), ...fresh.map(m => m.key)]});
  countFeature(MODULE_ID, "wishMatched", fresh.length);
}

/**
 * Hook "createItem": loot appeared (active GM).
 * @param {Item} item
 */
export function onCreateItem(item) {
  if ( !game.user.isActiveGM || !wishesOn() || !isLedgerActor(item.parent) || (areaOf(item) !== "pool") ) return;
  afterRequests(() => evaluate(item.id));
}

/**
 * Hook "updateItem": loot moved into the loot table (active GM), or the keys of told wishes changed (every user).
 * @param {Item} item
 * @param {object} changes
 */
export function onUpdateItem(item, changes) {
  if ( !wishesOn() || !isLedgerActor(item.parent) ) return;
  if ( game.user.isActiveGM && (foundry.utils.getProperty(changes, `flags.${MODULE_ID}.area`) === "pool") ) {
    afterRequests(() => evaluate(item.id));
  }
  const keys = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.wishNotified`);
  if ( !Array.isArray(keys) ) return;
  const mine = keysOfUser(keys, game.user.id).map(k => `${item.id}|${k}`).filter(k => !told.has(k));
  if ( !mine.length ) return;
  for ( const key of mine ) told.add(key);
  ui.notifications.info(t("SLL.Wish.matched", {item: wishTarget(item).name}), {console: false});
}

/**
 * Remember the wishes of every user (on ready), so only added ones count later.
 */
export function rememberWishes() {
  for ( const user of game.users ) known.set(user.id, new Set(userWishes(user).map(w => w.id)));
}

/**
 * Hook "updateUser": a list changed. The active GM counts the wishes added, every window redraws.
 * @param {User} user
 * @param {object} changes
 */
export function onUpdateUser(user, changes) {
  if ( !foundry.utils.hasProperty(changes ?? {}, PATH) ) return;
  const now = new Set(userWishes(user).map(w => w.id));
  const before = known.get(user.id) ?? new Set();
  known.set(user.id, now);
  const added = [...now].filter(id => !before.has(id)).length;
  if ( added && game.user.isActiveGM ) countFeature(MODULE_ID, "wishAdded", added);
  scheduleRefresh();
}
