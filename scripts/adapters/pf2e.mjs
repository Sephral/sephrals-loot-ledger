/**
 * Pathfinder 2e (PF2e 7.x and 8.x, also Starfinder 2e as far as it shares the item model). Coins are treasure items
 * (pp, gp, sp, cp), so coins are changed with item operations. Physical items are weapons, armor, shields, equipment,
 * consumables, treasure and backpacks, with their quantity in system.quantity, the price in system.price and the
 * container in system.containerId. Things to reset when an item changes hands: carried (held, worn, invested) and the
 * place in a container; a backpack moves with its contents.
 *
 * The party inventory is a loot actor. PF2e's own party actor is no good for it: without an active party PF2e takes the
 * first party actor of the world as the party, which would then be the ledger. The party of the loot split is PF2e's
 * active party (game.actors.party), its member characters.
 *
 * Unidentified items use PF2e's own identification (system.identification), like D&D 5e. PF2e mystifies the name, the
 * picture and the description of an unidentified item on every client, the GM's too; the real name stays in the source.
 */

import {COVER_FLAG, DEFAULT_COVER_IMG, nativeCover, stackIdentity} from "../cover-logic.mjs";
import {MODULE_ID} from "../config.mjs";
import {dcByLevel} from "../merchant-logic.mjs";
import {BaseAdapter} from "./base.mjs";
import {COINS, COIN_SOURCES, PAYOUT_KEYS, bulkOf, nativeCoverFields, planPay, planReceive, planStacks, priceOf,
  remapContainers, resetEquipped} from "./pf2e-logic.mjs";

/** The skills a character identifies items with, the better one counts. */
const IDENTIFY_SKILLS = ["arcana", "nature", "occultism", "religion", "crafting", "society"];

export class Pf2eAdapter extends BaseAdapter {

  id = "pf2e";

  characterTypes = ["character"];

  separateCoins = true;

  /** @override */
  stashType() {
    return "loot";
  }

  /** PF2e has system.identification with its own unidentified name, picture and description. */
  get nativeIdentification() {
    return true;
  }

  /** Haggling is a Diplomacy check against the standard difficulty of the character's level. */
  get canHaggle() {
    return true;
  }

  /** @override */
  async haggleRoll(actor) {
    const statistic = actor?.skills?.diplomacy;
    const skill = statistic?.label ?? game.i18n.localize("PF2E.Skill.Diplomacy");
    let total = null;
    try {
      const roll = await statistic.roll({skipDialog: true, createMessage: false});
      total = roll?.total;
    } catch(err) {
      console.warn(`${MODULE_ID} | The system's Diplomacy roll failed, rolling the modifier by hand`, err);
    }
    if ( !Number.isFinite(total) ) {
      const roll = await new Roll("1d20 + @bonus", {bonus: Number(statistic?.mod) || 0}).evaluate();
      total = roll.total;
    }
    return {total, skill, baseline: dcByLevel(actor?.level)};
  }

  /** @override */
  systemParty() {
    return game.actors.party?.members ?? [];
  }

  /** @override */
  isDefeated(combatant) {
    const hp = combatant?.actor?.system?.attributes?.hp?.value;
    return !!combatant?.isDefeated || (Number.isFinite(hp) && (hp <= 0));
  }

  /* -------------------------------------------- */
  /*  Items                                       */
  /* -------------------------------------------- */

  /** @override */
  isTransferable(item) {
    if ( !item || (typeof item.isOfType !== "function") || !item.isOfType("physical") ) return false;
    return !isCoinItem(item) && !item.system?.temporary;
  }

  /** @override */
  blockReason(item) {
    return (item?.isCursed && item?.isInvested) ? "SLL.Block.cursed" : null;
  }

  /** @override */
  containerOf(item) {
    return item?.system?.containerId || null;
  }

  /** @override */
  unitValue(item) {
    return priceOf(item?.system?.price, 1);
  }

  /** @override */
  value(item, quantity, depth=0) {
    const own = priceOf(item?.system?.price, quantity);
    if ( depth > 10 ) return own;
    return this.contents(item).reduce((sum, i) => sum + this.value(i, this.quantity(i) || 1, depth + 1), own);
  }

  /** @override */
  weight(item, quantity, depth=0) {
    const own = bulkOf(item?.system?.bulk, quantity);
    if ( depth > 10 ) return own;
    return this.contents(item).reduce((sum, i) => sum + this.weight(i, this.quantity(i) || 1, depth + 1), own);
  }

  /** The bulk a character carries and the bulk at which it becomes encumbered. */
  capacity(actor) {
    const bulk = actor?.inventory?.bulk;
    if ( !bulk || !Number.isFinite(bulk.encumberedAfter) ) return null;
    const value = bulk.value?.toLightUnits?.();
    if ( !Number.isFinite(value) ) return null;
    // Encumbered after N bulk means from N bulk and 1 light bulk upward
    return {value: value / 10, max: bulk.encumberedAfter + 1};
  }

  /** The best of the skills with which items are identified. */
  identifyBonus(actor) {
    const skills = actor?.skills ?? {};
    return Math.max(...IDENTIFY_SKILLS.map(slug => Number(skills[slug]?.mod) || 0), 0);
  }

  /** @override */
  coverOf(item) {
    const own = super.coverOf(item);
    const ident = item?.system?.identification;
    const unidentified = ident?.status === "unidentified";
    if ( own ) return ((own.mode === "system") && !unidentified) ? null : own;
    if ( !unidentified ) return null;
    return nativeCover({name: item.name, img: item.img, unidentifiedName: ident.unidentified?.name,
      unidentifiedDescription: ident.unidentified?.data?.description?.value});
  }

  /** PF2e shows its own mystified picture for the system's cover. */
  displayImg(item) {
    const cover = this.coverOf(item);
    return (cover?.mode === "system") ? item.img : (cover?.img || item.img);
  }

  /** @override */
  descriptionPath() {
    return "system.description.value";
  }

  /** @override */
  nativeCoverUpdate(cover) {
    return nativeCoverFields(cover, DEFAULT_COVER_IMG);
  }

  /** @override */
  nativeRevealUpdate() {
    return {"system.identification.status": "identified"};
  }

  /** @override */
  cleanData(data) {
    data.system ??= {};
    resetEquipped(data.system.equipped ??= {}, !!data.system.containerId);
    return data;
  }

  /** @override */
  async transferData(item, quantity) {
    if ( item.type !== "backpack" ) {
      const [data] = await super.transferData(item, quantity);
      // Out of a container: nothing is stowed any more
      data.system.containerId = null;
      resetEquipped(data.system.equipped, false);
      return [data];
    }
    // A backpack takes everything inside along, down to the last pouch
    const sources = [];
    const collect = (doc, depth=0) => {
      sources.push(doc.toObject());
      if ( depth > 10 ) return;
      for ( const inner of this.contents(doc) ) collect(inner, depth + 1);
    };
    collect(item);
    const created = remapContainers(sources, () => foundry.utils.randomID());
    created.forEach((data, index) => {
      if ( index === 0 ) this.setQuantity(data, quantity);
      this.cleanData(data);
    });
    return created;
  }

  /** @override */
  findStack(target, data, filter=() => true) {
    if ( data.type === "backpack" ) return null;
    const stackable = foundry.utils.deepClone(data);
    let candidate;
    try {
      candidate = new CONFIG.Item.documentClass(stackable);
    } catch {
      return null;
    }
    const identity = JSON.stringify(stackIdentity(foundry.utils.getProperty(data, `flags.${MODULE_ID}.${COVER_FLAG}`)));
    for ( const item of target.items ) {
      if ( !filter(item) || !this.isTransferable(item) || this.containerOf(item) || (item.type !== data.type) ) continue;
      if ( JSON.stringify(stackIdentity(foundry.utils.getProperty(item, `flags.${MODULE_ID}.${COVER_FLAG}`))) !== identity ) continue;
      if ( this.contents(item).length ) continue;
      if ( item.isStackableWith(candidate) ) return item;
    }
    return null;
  }

  /* -------------------------------------------- */
  /*  Coins                                       */
  /* -------------------------------------------- */

  /** @override */
  denominations() {
    return COINS.map(c => ({key: c.key, value: c.value, abbr: game.i18n.localize(`PF2E.CurrencyAbbreviations.${c.key}`)}));
  }

  /** @override */
  payoutDenominations() {
    return this.denominations().filter(d => PAYOUT_KEYS.includes(d.key));
  }

  /** @override */
  mainCoin() {
    return "gp";
  }

  /** @override */
  purse(actor) {
    const purse = Object.fromEntries(COINS.map(c => [c.key, 0]));
    for ( const item of coinItems(actor) ) purse[coinUnit(item)] += Math.max(Number(item.system.quantity) || 0, 0);
    return purse;
  }

  /** @override */
  coinsBase(actor) {
    return this.toBase(this.purse(actor));
  }

  /** @override */
  payUpdate() {
    throw new Error("PF2e coins are items, use payOps");
  }

  /** @override */
  receiveUpdate() {
    throw new Error("PF2e coins are items, use receiveOps");
  }

  /** @override */
  async payOps(actor, coins) {
    const purse = this.purse(actor);
    const delta = (typeof coins === "number") ? planPay(purse, coins) : negate(coins);
    if ( !delta || !this.canPay(actor, coins) ) throw new Error("SLL.Error.notEnoughCoins");
    return coinOperations(actor, delta);
  }

  /** @override */
  async receiveOps(actor, base) {
    return coinOperations(actor, planReceive(base));
  }

  /* -------------------------------------------- */

  /** @override */
  selfTest() {
    const problems = [];
    // PF2e's item class is a proxy, so the method is looked up on an item
    const physical = game.actors.find(a => a.isOfType?.("character"))?.items.find(i => i.isOfType?.("physical"));
    if ( physical && (typeof physical.isStackableWith !== "function") ) problems.push("SLL.SELFTEST.Stacking");
    const sample = game.actors.find(a => a.isOfType?.("character") && a.inventory);
    if ( sample && (typeof sample.inventory.addCoins !== "function") ) problems.push("SLL.SELFTEST.Coins");
    if ( !(game.documentTypes?.Actor ?? []).includes("loot") ) problems.push("SLL.SELFTEST.StashType");
    return problems;
  }
}

/**
 * Is an item a coin (a stack of platinum, gold, silver or copper pieces)?
 * @param {Item} item
 * @returns {boolean}
 */
function isCoinItem(item) {
  return (item.type === "treasure") && (item.system?.category === "coin");
}

/**
 * The coin items of an actor which are one of the four coins.
 * @param {Actor} actor
 * @returns {Item[]}
 */
function coinItems(actor) {
  return (actor?.items?.contents ?? []).filter(i => isCoinItem(i) && coinUnit(i));
}

/**
 * The coin a coin item holds, or null.
 * @param {Item} item
 * @returns {string|null}
 */
function coinUnit(item) {
  const unit = item.unit;
  if ( COINS.some(c => c.key === unit) ) return unit;
  const price = item._source?.system?.price?.value ?? item.system?.price?.value ?? {};
  const keys = COINS.map(c => c.key).filter(key => Number(price[key]) > 0);
  return (keys.length === 1) ? keys[0] : null;
}

/**
 * The negative of a set of coins.
 * @param {Record<string, number>} coins
 * @returns {Record<string, number>}
 */
function negate(coins) {
  return Object.fromEntries(Object.entries(coins ?? {}).filter(([, n]) => Number(n) > 0).map(([key, n]) => [key, -Math.floor(Number(n))]));
}

/**
 * The item operations which change the coins of an actor.
 * @param {Actor} actor
 * @param {Record<string, number>} delta   Coins to add (positive) or take (negative) by coin
 * @returns {Promise<import("../ops.mjs").Operation[]>}
 */
async function coinOperations(actor, delta) {
  const updates = [];
  const deletes = [];
  const creates = [];
  for ( const c of COINS ) {
    const change = Math.floor(Number(delta?.[c.key]) || 0);
    if ( !change ) continue;
    const stacks = coinItems(actor).filter(i => coinUnit(i) === c.key)
      .map(i => ({id: i.id, quantity: Math.max(Number(i.system.quantity) || 0, 0)}));
    const plan = planStacks(stacks, change);
    for ( const u of plan.updates ) updates.push({_id: u.id, "system.quantity": u.quantity});
    deletes.push(...plan.deletes);
    if ( plan.create ) {
      const source = await fromUuid(COIN_SOURCES[c.key]);
      if ( source?.type !== "treasure" ) throw new Error("SLL.Error.noCoinItem");
      const data = source.toObject(true);
      delete data._id;
      data.system.quantity = plan.create;
      creates.push(data);
    }
  }
  const operations = [];
  if ( creates.length ) operations.push({action: "create", documentName: "Item", parent: actor, data: creates});
  if ( updates.length ) operations.push({action: "update", documentName: "Item", parent: actor, updates});
  if ( deletes.length ) operations.push({action: "delete", documentName: "Item", parent: actor, ids: deletes});
  return operations;
}
