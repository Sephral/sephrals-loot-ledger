import assert from "node:assert/strict";
import test from "node:test";

import {
  COINS, bulkOf, copperOf, nativeCoverFields, planPay, planReceive, planStacks, priceOf, remapContainers, resetEquipped,
  unitCopper
} from "../scripts/adapters/pf2e-logic.mjs";
import {DEFAULT_COVER_IMG, planCover, planReveal} from "../scripts/cover-logic.mjs";

const get = (object, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), object);
const set = (object, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), object)[last] = value;
};
let counter = 0;
globalThis.foundry = {utils: {getProperty: get, setProperty: set, deepClone: value => structuredClone(value),
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b), randomID: () => `id${++counter}`}};
globalThis.game = {system: {id: "pf2e"}, settings: {get: () => undefined}, i18n: {localize: key => key.split(".").pop()}};
globalThis.CONFIG = {Item: {documentClass: class {}}};

const {Pf2eAdapter} = await import("../scripts/adapters/pf2e.mjs");

const SCOPE = "sephrals-loot-ledger";

/** A prepared PF2e item as far as the adapter reads it. */
function item(data, parent = null) {
  const doc = {
    ...data,
    parent,
    isOfType: (...types) => types.includes(data.type) || (types.includes("physical") && PHYSICAL.includes(data.type)),
    toObject() {
      return structuredClone({_id: data._id, name: data.name, type: data.type, system: data.system, flags: data.flags});
    }
  };
  Object.defineProperty(doc, "id", {value: data._id});
  return doc;
}
const PHYSICAL = ["weapon", "armor", "shield", "equipment", "consumable", "treasure", "backpack"];

const longsword = (extra = {}) => ({
  _id: "sword", name: "Longsword", type: "weapon", img: "sword.webp",
  system: {quantity: 1, containerId: null, price: {value: {gp: 1}, per: 1}, bulk: {value: 1}, temporary: false,
    equipped: {carryType: "held", handsHeld: 1, inSlot: false, invested: null},
    identification: {status: "identified", unidentified: {name: "Unidentified Weapon", img: "unknown.webp",
      data: {description: {value: ""}}}}, ...extra}
});

test("prices: a Coins object, plain data and prices for several units", () => {
  assert.equal(copperOf({pp: 1, gp: 2, sp: 3, cp: 4}), 1234);
  assert.equal(copperOf({copperValue: 250, gp: 99}), 250);
  assert.equal(copperOf({gp: undefined, sp: 5}), 50);
  assert.equal(copperOf(null), 0);
  // 1 sp for 10 arrows
  assert.equal(unitCopper({value: {sp: 1}, per: 10}), 1);
  assert.equal(priceOf({value: {sp: 1}, per: 10}, 25), 25);
  assert.equal(priceOf({value: {gp: 4}, per: 1}, 3), 1200);
  assert.equal(priceOf({value: {cp: 1}, per: 20}, 10), 1);
  assert.equal(priceOf(undefined, 3), 0);
});

test("bulk: light bulk, per and quantities", () => {
  assert.equal(bulkOf({value: 1}, 3), 3);
  assert.equal(bulkOf({value: 0.1}, 10), 1);
  assert.equal(bulkOf({value: 1, per: 10}, 5), 0.5);
  assert.equal(bulkOf(undefined, 4), 0);
});

test("paying: exact coins first, the smallest bigger coin breaks into change", () => {
  // 2 gp 5 sp: only 3 sp in the purse, so a gold coin breaks and 5 sp come back, minus the 3 sp already paid
  const pay = planPay({pp: 0, gp: 5, sp: 3, cp: 7}, 250);
  const after = {gp: 5 + (pay.gp ?? 0), sp: 3 + (pay.sp ?? 0), cp: 7 + (pay.cp ?? 0)};
  assert.equal((after.gp * 100) + (after.sp * 10) + after.cp, 500 + 30 + 7 - 250);
  assert.equal(planPay({pp: 0, gp: 1, sp: 0, cp: 0}, 1000), null);
  assert.equal(planPay({}, 1), null);
  assert.deepEqual(planPay({gp: 3}, 0), {});
  // a platinum coin pays for 3 gp and gives 7 gp back
  assert.deepEqual(planPay({pp: 1}, 300), {pp: -1, gp: 7});
  // exact coins are used without change
  assert.deepEqual(planPay({gp: 2, sp: 4}, 240), {gp: -2, sp: -4});
});

test("paying: the purse never ends up with a wrong sum", () => {
  for ( let i = 0; i < 400; i++ ) {
    const purse = {pp: i % 3, gp: (i * 7) % 11, sp: (i * 5) % 13, cp: (i * 3) % 17};
    const total = COINS.reduce((sum, c) => sum + (purse[c.key] * c.value), 0);
    const base = (i * 37) % (total + 40);
    const pay = planPay(purse, base);
    if ( base > total ) {
      assert.equal(pay, null);
      continue;
    }
    let left = 0;
    for ( const c of COINS ) {
      const n = purse[c.key] + (pay[c.key] ?? 0);
      assert.ok(n >= 0, `no negative ${c.key} for ${JSON.stringify(purse)} pay ${base}`);
      left += n * c.value;
    }
    assert.equal(left, total - base);
  }
});

test("receiving: gold, silver and copper, platinum stays where it is", () => {
  assert.deepEqual(planReceive(1234), {gp: 12, sp: 3, cp: 4});
  assert.deepEqual(planReceive(0), {});
  assert.deepEqual(planReceive(5), {cp: 5});
});

test("coin stacks: add to the first stack, create, take over several stacks", () => {
  assert.deepEqual(planStacks([{id: "a", quantity: 4}], 3), {updates: [{id: "a", quantity: 7}], deletes: [], create: 0});
  assert.deepEqual(planStacks([], 3), {updates: [], deletes: [], create: 3});
  assert.deepEqual(planStacks([{id: "a", quantity: 4}, {id: "b", quantity: 5}], -6),
    {updates: [{id: "b", quantity: 3}], deletes: ["a"], create: 0});
  assert.deepEqual(planStacks([{id: "a", quantity: 4}], -4), {updates: [], deletes: ["a"], create: 0});
  assert.throws(() => planStacks([{id: "a", quantity: 2}], -3), /notEnoughCoins/);
});

test("containers: a backpack and what is inside get new ids that point at each other", () => {
  let n = 0;
  const sources = [
    {_id: "bag", system: {containerId: "old"}},
    {_id: "rope", system: {containerId: "bag"}},
    {_id: "pouch", system: {containerId: "bag"}},
    {_id: "gem", system: {containerId: "pouch"}}
  ];
  const out = remapContainers(sources, () => `n${++n}`);
  assert.deepEqual(out.map(d => d._id), ["n1", "n2", "n3", "n4"]);
  assert.equal(out[0].system.containerId, null);
  assert.equal(out[1].system.containerId, "n1");
  assert.equal(out[3].system.containerId, "n3");
  // the sources stay as they were
  assert.equal(sources[1].system.containerId, "bag");
});

test("equipment: nothing stays held, worn or invested", () => {
  assert.deepEqual(resetEquipped({carryType: "held", handsHeld: 2, inSlot: true, invested: true}, false),
    {carryType: "worn", handsHeld: 0, inSlot: false, invested: false});
  assert.deepEqual(resetEquipped({carryType: "worn", handsHeld: 0, invested: null}, true),
    {carryType: "stowed", handsHeld: 0, invested: null});
  assert.equal(resetEquipped(undefined, false).carryType, "worn");
});

test("identification: PF2e's own fields cover and reveal an item", () => {
  const cover = {name: "Strange ring", img: "ring.webp", description: "<p>Odd.</p>", dc: 20};
  const fields = nativeCoverFields(cover, DEFAULT_COVER_IMG);
  assert.equal(fields["system.identification.status"], "unidentified");
  assert.equal(fields["system.identification.unidentified.name"], "Strange ring");
  assert.equal(fields["system.identification.unidentified.img"], "ring.webp");
  assert.equal(fields["system.identification.unidentified.data.description.value"], "<p>Odd.</p>");
  // the module's default picture does not replace PF2e's own placeholder for the item type
  assert.equal("system.identification.unidentified.img" in nativeCoverFields({...cover, img: DEFAULT_COVER_IMG}, DEFAULT_COVER_IMG), false);
  const plan = planCover({mode: "system", scope: SCOPE, real: {name: "Ring of Wizardry", img: "r"}, cover, nativeUpdate: fields});
  assert.equal(plan.update["system.identification.status"], "unidentified");
  assert.equal("system.identified" in plan.update, false);
  assert.equal(JSON.stringify(plan.update).includes("Wizardry"), false);
  const reveal = planReveal({mode: "system", scope: SCOPE, secret: null, nativeUpdate: {"system.identification.status": "identified"}});
  assert.equal(reveal["system.identification.status"], "identified");
  assert.equal("system.identified" in reveal, false);
  // without the system's fields the D&D 5e ones apply, as before
  assert.equal(planCover({mode: "system", scope: SCOPE, real: {}, cover}).update["system.identified"], false);
});

test("adapter: which items change hands", () => {
  const a = new Pf2eAdapter();
  assert.equal(a.isTransferable(item(longsword())), true);
  assert.equal(a.isTransferable(item({_id: "c", name: "Gold Pieces", type: "treasure", system: {category: "coin", quantity: 5}})), false);
  assert.equal(a.isTransferable(item({_id: "g", name: "Ruby", type: "treasure", system: {category: "gem", quantity: 1}})), true);
  assert.equal(a.isTransferable(item({_id: "t", name: "Torch", type: "equipment", system: {quantity: 1, temporary: true}})), false);
  assert.equal(a.isTransferable(item({_id: "s", name: "Strike", type: "melee", system: {}})), false);
  assert.equal(a.isTransferable(null), false);
  assert.equal(a.stashType(), "loot");
  assert.equal(a.nativeIdentification, true);
  assert.equal(a.coverMode(), "system");
});

test("adapter: value and bulk of a backpack include its contents", () => {
  const a = new Pf2eAdapter();
  const items = [];
  const parent = {items: {filter: fn => items.filter(fn)}};
  const bag = item({_id: "bag", name: "Backpack", type: "backpack", system: {quantity: 1, containerId: null,
    price: {value: {sp: 1}}, bulk: {value: 0.1}}}, parent);
  const rope = item({_id: "rope", name: "Rope", type: "equipment", system: {quantity: 2, containerId: "bag",
    price: {value: {cp: 5}}, bulk: {value: 0.1}}}, parent);
  items.push(bag, rope);
  assert.equal(a.value(bag, 1), 10 + 10);
  assert.ok(Math.abs(a.weight(bag, 1) - 0.3) < 1e-9);
  assert.equal(a.containerOf(rope), "bag");
  assert.equal(a.containerOf(bag), null);
  assert.deepEqual(a.deleteIds(bag), ["bag", "rope"]);
  assert.equal(a.quantity(rope), 2);
});

test("adapter: an item that is unidentified counts as covered", () => {
  const a = new Pf2eAdapter();
  const plain = item(longsword());
  assert.equal(a.coverOf(plain), null);
  const hidden = item({...longsword(), name: "Unidentified Weapon", system: {...longsword().system,
    identification: {status: "unidentified", unidentified: {name: "Unidentified Weapon", img: "unknown.webp",
      data: {description: {value: "<p>A weapon.</p>"}}}}}});
  const cover = a.coverOf(hidden);
  assert.equal(cover.mode, "system");
  assert.equal(cover.name, "Unidentified Weapon");
  assert.equal(cover.description, "<p>A weapon.</p>");
  assert.equal(a.isCovered(hidden), true);
  assert.equal(a.displayImg(hidden), "sword.webp");
  // a cover of the module that PF2e's identification already took off counts as revealed
  const revealed = item({...longsword(), flags: {[SCOPE]: {cover: {mode: "system", name: "x", img: "i"}}}});
  assert.equal(a.coverOf(revealed), null);
});

test("adapter: cleaning item data for the new owner", () => {
  const a = new Pf2eAdapter();
  const data = longsword();
  a.cleanData(data);
  assert.deepEqual(data.system.equipped, {carryType: "worn", handsHeld: 0, inSlot: false, invested: null});
  const inside = longsword({containerId: "bag"});
  a.cleanData(inside);
  assert.equal(inside.equipped?.carryType ?? inside.system.equipped.carryType, "stowed");
});

test("adapter: the denominations and the payout coins", () => {
  const a = new Pf2eAdapter();
  assert.deepEqual(a.denominations().map(d => [d.key, d.value]), [["pp", 1000], ["gp", 100], ["sp", 10], ["cp", 1]]);
  assert.deepEqual(a.payoutDenominations().map(d => d.key), ["gp", "sp", "cp"]);
  assert.equal(a.mainCoin(), "gp");
  assert.equal(a.formatCoins(1234), "12 gp 3 sp 4 cp");
});

test("adapter: coins are read from the coin items of an actor", () => {
  const a = new Pf2eAdapter();
  const coin = (id, unit, quantity) => item({_id: id, name: unit, type: "treasure", unit,
    system: {category: "coin", quantity, price: {value: {[unit]: 1}}}});
  const actor = {items: {contents: [coin("g", "gp", 12), coin("s", "sp", 3), coin("g2", "gp", 1), longsword() && item(longsword())]}};
  assert.deepEqual(a.purse(actor), {pp: 0, gp: 13, sp: 3, cp: 0});
  assert.equal(a.coinsBase(actor), 1330);
  assert.equal(a.canPay(actor, {gp: 13}), true);
  assert.equal(a.canPay(actor, {gp: 14}), false);
  assert.equal(a.canPay(actor, 1330), true);
  assert.equal(a.canPay(actor, 1331), false);
});

test("adapter: coin operations are item operations", async () => {
  const a = new Pf2eAdapter();
  const coin = (id, unit, quantity) => item({_id: id, name: unit, type: "treasure", unit,
    system: {category: "coin", quantity, price: {value: {[unit]: 1}}}});
  const actor = {id: "hero", items: {contents: [coin("g", "gp", 12), coin("s", "sp", 3)]}};
  // pay 2 gp 5 sp: the 3 sp go, a gold coin breaks and gives 5 sp back, so 3 sp stay: delete none, update both
  const ops = await a.payOps(actor, 250);
  const flat = ops.map(o => `${o.action}:${(o.updates ?? o.ids ?? o.data).map(u => JSON.stringify(u)).join(",")}`);
  assert.deepEqual(ops.map(o => o.action), ["update"]);
  assert.deepEqual(ops[0].updates, [{_id: "g", "system.quantity": 9}, {_id: "s", "system.quantity": 8}], flat.join(" "));
  assert.ok(ops.every(o => o.documentName === "Item" && o.parent === actor));
  await assert.rejects(() => a.payOps(actor, 100000), /notEnoughCoins/);
  // paying the whole purse coin by coin deletes the stacks
  const all = await a.payOps(actor, {gp: 12, sp: 3});
  assert.deepEqual(all.map(o => o.action), ["delete"]);
  assert.deepEqual(all[0].ids, ["g", "s"]);
  // receiving: silver exists, copper has no stack and is made from the compendium
  globalThis.fromUuid = async uuid => ({type: "treasure", toObject: () => ({_id: "x", name: "Copper Pieces", type: "treasure",
    system: {category: "coin", quantity: 1, price: {value: {cp: 1}}}, uuid})});
  const got = await a.receiveOps(actor, 1230);
  assert.deepEqual(got.map(o => o.action), ["update"]);
  assert.deepEqual(got[0].updates, [{_id: "g", "system.quantity": 24}, {_id: "s", "system.quantity": 6}]);
  const copper = await a.receiveOps(actor, 7);
  assert.equal(copper[0].action, "create");
  assert.equal(copper[0].data[0].system.quantity, 7);
  assert.equal("_id" in copper[0].data[0], false);
});
