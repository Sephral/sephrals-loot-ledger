import assert from "node:assert/strict";
import test from "node:test";
import {clampRequests, currencyKeys, currencyValue, pileCoinPlan} from "../scripts/pile-map.mjs";

const DND = [
  {key: "pp", value: 1000, abbr: "pp"}, {key: "gp", value: 100, abbr: "gp"}, {key: "ep", value: 50, abbr: "ep"},
  {key: "sp", value: 10, abbr: "sp"}, {key: "cp", value: 1, abbr: "cp"}
];

// The currencies of a D&D 5e pile as Item Piles 3.3 reports them (attributes on the actor)
const attr = (key, quantity, rate, primary=false) => ({type: "attribute", name: `DND5E.Currency${key.toUpperCase()}`,
  abbreviation: `{#}${key.toUpperCase()}`, data: {path: `system.currency.${key}`}, path: `system.currency.${key}`,
  id: `system.currency.${key}`, primary, exchangeRate: rate, quantity});

test("currencies are known by their path and their abbreviation", () => {
  assert.deepEqual(currencyKeys(attr("gp", 1, 1)), ["gp", "gp"]);
  assert.deepEqual(currencyKeys({abbreviation: "{#} Silver"}), ["silver"]);
  assert.deepEqual(currencyKeys({}), []);
});

test("D&D 5e coins match the module's coins", () => {
  assert.equal(currencyValue(attr("pp", 1, 10), DND, "gp"), 1000);
  assert.equal(currencyValue(attr("ep", 1, 0.5), DND, "gp"), 50);
  assert.equal(currencyValue(attr("cp", 1, 0.01), DND, "gp"), 1);
});

test("coins the module does not know count by their exchange rate if that gives whole units", () => {
  const generic = [{key: "coin", value: 1, abbr: "gp"}];
  assert.equal(currencyValue({type: "attribute", path: "system.money", exchangeRate: 1, primary: true}, generic, "coin"), 1);
  assert.equal(currencyValue({type: "attribute", path: "system.platinum", exchangeRate: 10}, generic, "coin"), 10);
  assert.equal(currencyValue({type: "attribute", path: "system.copper", exchangeRate: 0.01}, generic, "coin"), null);
  assert.equal(currencyValue({type: "attribute", path: "system.gems", exchangeRate: 5, secondary: true}, generic, "coin"),
    null);
});

test("a pile's coins: worth, what leaves the pile and what stays", () => {
  const plan = pileCoinPlan([
    attr("pp", 2, 10), attr("gp", 15, 1, true), attr("sp", 0, 0.1), attr("cp", 7, 0.01),
    {type: "item", name: "Gold Bar", id: "bar1", item: {id: "bar1"}, abbreviation: "{#} gp", quantity: 3},
    {type: "attribute", name: "Gems", path: "system.gems", exchangeRate: 5, secondary: true, quantity: 4}
  ], DND, "gp");
  assert.equal(plan.base, 2000 + 1500 + 7 + 300);
  assert.equal(plan.attributeBase, 3507);
  assert.equal(plan.itemBase, 300);
  assert.deepEqual(plan.attributes, {"system.currency.pp": 2, "system.currency.gp": 15, "system.currency.cp": 7});
  assert.deepEqual(plan.units, {"system.currency.pp": 1000, "system.currency.gp": 100, "system.currency.cp": 1});
  assert.deepEqual(plan.items, [{_id: "bar1", quantity: 3}]);
  assert.deepEqual(plan.kept, ["Gems"]);
});

test("an empty pile has no coins", () => {
  assert.deepEqual(pileCoinPlan([], DND, "gp"), {base: 0, attributeBase: 0, itemBase: 0, attributes: {}, units: {}, items: [],
    kept: []});
  assert.equal(pileCoinPlan(undefined, DND, "gp").base, 0);
});

test("requested items are clamped to what the pile holds", () => {
  const available = new Map([["a", 5], ["b", 1]]);
  assert.deepEqual(clampRequests([{id: "a"}, {id: "b", quantity: 3}, {id: "x"}, {id: "a", quantity: 1}], available),
    [{id: "a", quantity: 5}, {id: "b", quantity: 1}]);
  assert.deepEqual(clampRequests([{id: "a", quantity: 2}], available), [{id: "a", quantity: 2}]);
  assert.deepEqual(clampRequests([{id: "a", quantity: -4}], available), [{id: "a", quantity: 1}]);
  assert.deepEqual(clampRequests(undefined, available), []);
});
