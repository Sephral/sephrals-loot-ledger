import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_COVER_IMG, carriedFlags, checkFormula, checkPasses, defaultCoverName, hasTried, nativeCover, normalizeCover,
  parseSecret, planCover, planReveal, serializeSecret, stackIdentity
} from "../scripts/cover-logic.mjs";

// The adapters read these Foundry APIs
const get = (object, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), object);
const set = (object, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), object)[last] = value;
};
globalThis.foundry = {utils: {getProperty: get, setProperty: set, deepClone: value => structuredClone(value),
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b)}};
let safe = false;
globalThis.game = {system: {id: "dnd5e"}, settings: {get: (id, key) => (key === "coverSafe" ? safe : undefined)}};

const {BaseAdapter, stackCompare} = await import("../scripts/adapters/base.mjs");
const {Dnd5eAdapter} = await import("../scripts/adapters/dnd5e.mjs");
const {CrucibleAdapter} = await import("../scripts/adapters/crucible.mjs");

const SCOPE = "sephrals-loot-ledger";

test("the cover input is cleaned and falls back to the defaults", () => {
  assert.deepEqual(normalizeCover({name: "  Old ring ", img: "a.webp", description: "<p>Plain</p>", dc: "15"}),
    {name: "Old ring", img: "a.webp", description: "<p>Plain</p>", dc: 15});
  assert.deepEqual(normalizeCover({}, {name: "Unidentified weapon"}),
    {name: "Unidentified weapon", img: DEFAULT_COVER_IMG, description: "", dc: null});
  assert.equal(normalizeCover({name: "x", dc: ""}).dc, null);
  assert.equal(normalizeCover({name: "x", dc: "0"}).dc, null);
  assert.equal(normalizeCover({name: "x", dc: 500}).dc, 99);
  assert.equal(normalizeCover({name: "x", dc: "abc"}).dc, null);
  assert.equal(normalizeCover({}).name, "?");
  assert.equal(defaultCoverName("Unidentified {type}", "Weapon"), "Unidentified Weapon");
  assert.equal(defaultCoverName("Unidentified {type}", ""), "Unidentified item");
});

test("swap mode: the cover goes on the item, the real values go into the secret", () => {
  const cover = normalizeCover({name: "Old blade", img: "blade.webp", description: "<p>Rusty.</p>", dc: 14});
  const plan = planCover({mode: "swap", scope: SCOPE, real: {name: "Vorpal Sword", img: "vorpal.webp", description: "<p>Snicker snack.</p>"},
    cover, descriptionPath: "system.description.value", secretId: "sec1"});
  assert.equal(plan.update.name, "Old blade");
  assert.equal(plan.update.img, "blade.webp");
  assert.equal(plan.update["system.description.value"], "<p>Rusty.</p>");
  assert.equal(plan.flag.secret, "sec1");
  assert.equal(plan.flag.check, true);
  assert.deepEqual(plan.flag.tries, {});
  // nothing of the real item is in what the players receive
  assert.equal(JSON.stringify(plan.update).includes("Vorpal"), false);
  assert.equal(JSON.stringify(plan.flag).includes("Vorpal"), false);
  assert.equal(JSON.stringify(plan.flag).includes("Snicker"), false);
  assert.deepEqual(plan.secret, {dc: 14, name: "Vorpal Sword", img: "vorpal.webp", description: "<p>Snicker snack.</p>"});
  // an item without a description path keeps its description out of the secret
  const bare = planCover({mode: "swap", scope: SCOPE, real: {name: "A", img: "a"}, cover, descriptionPath: null});
  assert.equal("system.description.value" in bare.update, false);
  assert.equal(bare.secret.description, null);
});

test("system mode: the system's own identification is switched, the real name is not copied", () => {
  const cover = normalizeCover({name: "Odd ring", description: "<p>Shiny.</p>"});
  const plan = planCover({mode: "system", scope: SCOPE, real: {name: "Ring of Protection", img: "r"}, cover});
  assert.equal(plan.update["system.identified"], false);
  assert.equal(plan.update["system.unidentified.name"], "Odd ring");
  assert.equal(plan.update["system.unidentified.description"], "<p>Shiny.</p>");
  assert.equal("name" in plan.update, false);
  assert.equal(plan.flag.check, false);
  assert.equal(plan.flag.secret, null);
});

test("reveal puts the real values back or switches the identification on", () => {
  const swap = planReveal({mode: "swap", scope: SCOPE, secret: {name: "Vorpal Sword", img: "v.webp", description: "<p>D</p>"},
    descriptionPath: "system.description.value"});
  assert.deepEqual(swap, {[`flags.${SCOPE}.-=cover`]: null, name: "Vorpal Sword", img: "v.webp", "system.description.value": "<p>D</p>"});
  assert.throws(() => planReveal({mode: "swap", scope: SCOPE, secret: null}), /secretMissing/);
  assert.throws(() => planReveal({mode: "swap", scope: SCOPE, secret: {img: "x"}}), /secretMissing/);
  const system = planReveal({mode: "system", scope: SCOPE, secret: null});
  assert.deepEqual(system, {[`flags.${SCOPE}.-=cover`]: null, "system.identified": true});
});

test("the identify check: formula, one try per character, pass at the difficulty", () => {
  assert.equal(checkFormula("1d20", 0), "1d20");
  assert.equal(checkFormula("1d20", 5), "1d20 + 5");
  assert.equal(checkFormula("", -2), "1d20 - 2");
  assert.equal(checkFormula("2d10", 3.4), "2d10 + 3");
  assert.equal(checkPasses(15, 15), true);
  assert.equal(checkPasses(14, 15), false);
  assert.equal(checkPasses(NaN, 15), false);
  assert.equal(hasTried({tries: {a1: true}}, "a1"), true);
  assert.equal(hasTried({tries: {a1: true}}, "a2"), false);
  assert.equal(hasTried(null, "a1"), false);
});

test("the cover travels with an item, claims and tries do not decide a stack", () => {
  const flags = {area: "pool", claims: {a1: "need"}, cover: {mode: "swap", secret: "s1", name: "Old blade", tries: {a1: true}}};
  assert.deepEqual(carriedFlags(flags, "stash"), {cover: flags.cover, area: "stash"});
  assert.deepEqual(carriedFlags(flags, null), {cover: flags.cover});
  assert.deepEqual(carriedFlags({area: "pool", claims: {}}, null), {});
  assert.deepEqual(carriedFlags(undefined, "pool"), {area: "pool"});
  assert.deepEqual(stackIdentity(flags.cover), {mode: "swap", secret: "s1", name: "Old blade"});
  assert.equal(stackIdentity(undefined), null);
});

test("the secret is plain JSON on a page, also when an editor wrapped it", () => {
  const payload = {name: "Vorpal", description: "<p>Snicker</p>", dc: 12};
  const text = serializeSecret(payload);
  assert.deepEqual(parseSecret(text), {v: 1, ...payload});
  assert.deepEqual(parseSecret(`<p>${text}</p>`), {v: 1, ...payload});
  assert.equal(parseSecret("not json"), null);
  assert.equal(parseSecret(null), null);
});

test("an item the system marked itself counts as covered", () => {
  const cover = nativeCover({name: "Ring", img: "r.webp", unidentifiedName: "Odd ring", unidentifiedDescription: "<p>?</p>"});
  assert.equal(cover.name, "Odd ring");
  assert.equal(cover.mode, "system");
  assert.equal(cover.check, false);
  assert.equal(nativeCover({name: "Ring"}).img, DEFAULT_COVER_IMG);
});

test("adapters: dnd5e uses its own identification, the others swap, the safe setting swaps everywhere", () => {
  const dnd = new Dnd5eAdapter();
  const crucible = new CrucibleAdapter();
  const generic = new BaseAdapter();
  safe = false;
  assert.equal(dnd.coverMode(), "system");
  assert.equal(crucible.coverMode(), "swap");
  assert.equal(generic.coverMode(), "swap");
  safe = true;
  assert.equal(dnd.coverMode(), "swap");
  safe = false;
  assert.equal(crucible.descriptionPath({}), "system.description.public");
  assert.equal(dnd.descriptionPath({}), "system.description.value");
  assert.equal(generic.descriptionPath({system: {description: {value: "<p>x</p>"}}}), "system.description.value");
  assert.equal(generic.descriptionPath({system: {description: "plain"}}), "system.description");
  assert.equal(generic.descriptionPath({system: {}}), null);
});

test("adapters: what a player sees of a covered item", () => {
  const dnd = new Dnd5eAdapter();
  const generic = new BaseAdapter();
  // dnd5e's own checkbox
  const native = {name: "Odd ring", img: "ring.webp", system: {identified: false, unidentified: {name: "Odd ring", description: "?"}}};
  assert.equal(dnd.isCovered(native), true);
  assert.equal(dnd.coverOf(native).name, "Odd ring");
  assert.equal(dnd.isCovered({name: "Ring", system: {identified: true}}), false);
  // the module's cover with dnd5e's checkbox switched on again is revealed
  const stale = {name: "Ring", system: {identified: true}, flags: {[SCOPE]: {cover: {mode: "system", name: "Odd ring"}}}};
  assert.equal(dnd.isCovered(stale), false);
  // a swapped cover stays covered, also in dnd5e
  const swapped = {name: "Old blade", img: "blade.webp", system: {identified: true}, flags: {[SCOPE]: {cover: {mode: "swap", name: "Old blade", img: "blade.webp", secret: "s"}}}};
  assert.equal(dnd.isCovered(swapped), true);
  assert.equal(dnd.displayImg(swapped), "blade.webp");
  assert.equal(generic.isCovered({name: "Sword"}), false);
  assert.equal(generic.displayImg({name: "Sword", img: "sword.webp"}), "sword.webp");
  assert.equal(dnd.identifyBonus({system: {skills: {arc: {total: 2}, inv: {total: 5}}}}), 5);
  assert.equal(dnd.identifyBonus({system: {}}), 0);
  assert.equal(generic.identifyBonus({}), 0);
});

test("stacks: covered items only merge when they hide the same thing", () => {
  const generic = new BaseAdapter();
  const item = (cover, name = "Old blade") => ({_id: "x", name, type: "weapon", system: {quantity: 1}, flags: {[SCOPE]: {area: "pool", claims: {a: "need"}, ...(cover ? {cover} : {})}}});
  const same = stackCompare(item({mode: "swap", secret: "s1", name: "Old blade", tries: {}}), generic);
  const triedToo = stackCompare(item({mode: "swap", secret: "s1", name: "Old blade", tries: {a1: true}}), generic);
  const other = stackCompare(item({mode: "swap", secret: "s2", name: "Old blade", tries: {}}), generic);
  const none = stackCompare(item(null), generic);
  assert.deepEqual(same, triedToo);
  assert.notDeepEqual(same, other);
  assert.notDeepEqual(same, none);
  assert.equal(JSON.stringify(none).includes("claims"), false);
});
