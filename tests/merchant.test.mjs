import assert from "node:assert/strict";
import test from "node:test";
import {clampShare, dcByLevel, haggleAdjust, offerOf, splitProceeds} from "../scripts/merchant-logic.mjs";

const get = (object, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), object);
const has = (object, path) => get(object, path) !== undefined;
globalThis.foundry = {utils: {getProperty: get, hasProperty: has, deepClone: value => structuredClone(value),
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b), randomID: () => "id"}};
globalThis.game = {system: {id: "dnd5e"}, settings: {get: () => undefined}, i18n: {localize: key => key.split(".").pop()}};
globalThis.CONFIG = {
  DND5E: {currencies: {pp: {conversion: 0.1, abbreviation: "pp"}, gp: {conversion: 1, abbreviation: "gp"},
    ep: {conversion: 2, abbreviation: "ep"}, sp: {conversion: 10, abbreviation: "sp"}, cp: {conversion: 100, abbreviation: "cp"}}},
  Item: {documentClass: class {}}
};
globalThis.crucible = {CONFIG: {currency: {gp: {multiplier: 100, abbreviation: "gp"}, sp: {multiplier: 10, abbreviation: "sp"},
  cp: {multiplier: 1, abbreviation: "cp"}}}};

const {Dnd5eAdapter} = await import("../scripts/adapters/dnd5e.mjs");
const {CrucibleAdapter} = await import("../scripts/adapters/crucible.mjs");
const {Pf2eAdapter} = await import("../scripts/adapters/pf2e.mjs");

/** An item as far as the adapters read the price. */
const thing = (system, extra = {}) => ({id: "i", system, parent: null, ...extra});

test("the share is a whole percent between 1 and 200", () => {
  assert.equal(clampShare(50), 50);
  assert.equal(clampShare("62.4"), 62);
  assert.equal(clampShare(0), 1);
  assert.equal(clampShare(900), 200);
  assert.equal(clampShare("abc", 40), 40);
});

test("the offer is a share of the value moved by the haggle, in whole units", () => {
  assert.equal(offerOf(1000, 50), 500);
  assert.equal(offerOf(1000, 50, 20), 600);
  assert.equal(offerOf(1000, 50, -20), 400);
  assert.equal(offerOf(1001, 50), 501);
  assert.equal(offerOf(7, 50, 4), 4);
  assert.equal(offerOf(0, 50), 0);
  assert.equal(offerOf(-5, 50), 0);
  assert.equal(offerOf(1000, 100), 1000);
  assert.equal(offerOf(1000, 150), 1500);
});

test("the haggle moves two percent per point and stays within the limit", () => {
  assert.equal(haggleAdjust(15, 15), 0);
  assert.equal(haggleAdjust(19, 15), 8);
  assert.equal(haggleAdjust(10, 15), -10);
  assert.equal(haggleAdjust(40, 15), 20);
  assert.equal(haggleAdjust(2, 15), -20);
  assert.equal(haggleAdjust(40, 15, 10), 10);
  assert.equal(haggleAdjust(40, 15, 0), 0);
  assert.equal(haggleAdjust(NaN, 15), 0);
});

test("proceeds split evenly, the rest goes to the fund or to the first character", () => {
  assert.deepEqual(splitProceeds(100, 3, true), {shares: [33, 33, 33], toFund: 1});
  assert.deepEqual(splitProceeds(100, 3, false), {shares: [34, 33, 33], toFund: 0});
  assert.deepEqual(splitProceeds(99, 3, false), {shares: [33, 33, 33], toFund: 0});
  assert.deepEqual(splitProceeds(100, 0, true), {shares: [], toFund: 0});
  assert.deepEqual(splitProceeds(2, 3, true), {shares: [0, 0, 0], toFund: 2});
});

test("PF2e standard difficulty by level", () => {
  assert.equal(dcByLevel(0), 14);
  assert.equal(dcByLevel(1), 15);
  assert.equal(dcByLevel(5), 20);
  assert.equal(dcByLevel(20), 40);
  assert.equal(dcByLevel(99), 50);
  assert.equal(dcByLevel(undefined), 14);
});

test("D&D 5e: the price in its coin, in copper", () => {
  const a = new Dnd5eAdapter();
  assert.equal(a.unitValue(thing({price: {value: 50, denomination: "gp"}})), 5000);
  assert.equal(a.unitValue(thing({price: {value: 5, denomination: "sp"}})), 50);
  assert.equal(a.unitValue(thing({price: {value: 2, denomination: "pp"}})), 2000);
  assert.equal(a.unitValue(thing({price: {value: 3}})), 300);
  assert.equal(a.unitValue(thing({})), 0);
  assert.equal(a.value(thing({price: {value: 50, denomination: "gp"}}), 3), 15000);
  assert.equal(offerOf(a.value(thing({price: {value: 50, denomination: "gp"}}), 3), 50), 7500);
});

test("Crucible: the price in copper", () => {
  const a = new CrucibleAdapter();
  assert.equal(a.unitValue(thing({price: 250})), 250);
  assert.equal(a.value(thing({price: 250}), 4), 1000);
  assert.equal(a.unitValue(thing({price: -5})), 0);
});

test("PF2e: the price per unit, with a price for several units", () => {
  const a = new Pf2eAdapter();
  const arrows = thing({price: {value: {sp: 1}, per: 10}}, {parent: {items: []}});
  assert.equal(a.value(arrows, 20), 20);
  const potion = thing({price: {value: {gp: 4}}}, {parent: {items: []}});
  assert.equal(a.value(potion, 2), 800);
  assert.equal(offerOf(a.value(potion, 2), 50), 400);
  const priceless = thing({price: {value: {}}}, {parent: {items: []}});
  assert.equal(a.value(priceless, 1), 0);
});

test("the systems with a skill check can haggle", () => {
  assert.equal(new Dnd5eAdapter().canHaggle, true);
  assert.equal(new CrucibleAdapter().canHaggle, true);
  assert.equal(new Pf2eAdapter().canHaggle, true);
});
