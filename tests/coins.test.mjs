import assert from "node:assert/strict";
import test from "node:test";
import {canPay, changePurse, formatCoins, parseCoins, payout, splitCoins, toBase} from "../scripts/coins.mjs";

const DND = [
  {key: "pp", value: 1000, abbr: "pp"}, {key: "gp", value: 100, abbr: "gp"}, {key: "ep", value: 50, abbr: "ep"},
  {key: "sp", value: 10, abbr: "sp"}, {key: "cp", value: 1, abbr: "cp"}
];
const PAY = DND.filter(d => ["gp", "sp", "cp"].includes(d.key));

test("a split never loses a copper", () => {
  assert.deepEqual(splitCoins(1000, 3), {share: 333, remainder: 1});
  assert.deepEqual(splitCoins(7, 3), {share: 2, remainder: 1});
  assert.deepEqual(splitCoins(2, 3), {share: 0, remainder: 2});
  assert.deepEqual(splitCoins(10, 0), {share: 0, remainder: 10});
  for ( const [total, count] of [[1234, 5], [99, 4], [1, 1]] ) {
    const {share, remainder} = splitCoins(total, count);
    assert.equal((share * count) + remainder, total);
  }
});

test("coins convert to base units and back", () => {
  assert.equal(toBase({gp: 3, sp: 4, cp: 5}, DND), 345);
  assert.equal(toBase({pp: 1, ep: 1}, DND), 1050);
  assert.deepEqual(payout(345, PAY), {gp: 3, sp: 4, cp: 5});
  assert.deepEqual(payout(1050, PAY), {gp: 10, sp: 5});
  assert.deepEqual(payout(0, PAY), {});
});

test("purses pay coin by coin", () => {
  const purse = {gp: 2, sp: 5, cp: 0};
  assert.equal(canPay(purse, {gp: 2, sp: 1}), true);
  assert.equal(canPay(purse, {cp: 1}), false);
  assert.deepEqual(changePurse(purse, {gp: 1, sp: 5}, -1), {gp: 1, sp: 0, cp: 0});
  assert.deepEqual(changePurse(purse, {cp: 7}, 1), {gp: 2, sp: 5, cp: 7});
});

test("amounts read and print", () => {
  assert.equal(formatCoins(345, PAY), "3 gp 4 sp 5 cp");
  assert.equal(formatCoins(0, PAY), "0 cp");
  assert.equal(parseCoins("12", DND, "gp"), 1200);
  assert.equal(parseCoins("1,5", DND, "gp"), 150);
  assert.equal(parseCoins("3gp 5sp", DND, "gp"), 350);
  assert.equal(parseCoins("2 pp 1 cp", DND, "gp"), 2001);
  assert.equal(parseCoins("drei", DND, "gp"), null);
  assert.equal(parseCoins("", DND, "gp"), null);
});
