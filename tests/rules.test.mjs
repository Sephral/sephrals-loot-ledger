import assert from "node:assert/strict";
import test from "node:test";
import {canonical, hashString, seal, verifyChain} from "../scripts/chain.mjs";
import {balance, contenders, pickWinner} from "../scripts/rules.mjs";

test("the strongest claims contend, passing is no claim", () => {
  assert.deepEqual(contenders({a: "want", b: "need", c: "need", d: "pass"}), {rank: 2, ids: ["b", "c"]});
  assert.deepEqual(contenders({a: "pass", b: null}), {rank: 0, ids: []});
});

test("fair distribution gives to whoever received the least", () => {
  const claims = {a: "need", b: "need", c: "want"};
  assert.equal(pickWinner(claims, {rule: "fair", received: {a: 500, b: 100}}).winner, "b");
  const tie = pickWinner(claims, {rule: "fair", received: {a: 100, b: 100}});
  assert.equal(tie.winner, null);
  assert.deepEqual(tie.needsRolls.sort(), ["a", "b"]);
  assert.equal(pickWinner(claims, {rule: "fair", received: {}, rolls: {a: 12, b: 80}}).winner, "b");
  assert.equal(pickWinner({a: "want"}, {rule: "fair"}).winner, "a");
});

test("rolls decide and ties roll again", () => {
  const claims = {a: "want", b: "want"};
  assert.deepEqual(pickWinner(claims, {rule: "roll"}).needsRolls, ["a", "b"]);
  assert.equal(pickWinner(claims, {rule: "roll", rolls: {a: 40, b: 41}}).winner, "b");
  const tie = pickWinner(claims, {rule: "roll", rolls: {a: 50, b: 50}});
  assert.equal(tie.reason, "tie");
  assert.deepEqual(tie.needsRolls, ["a", "b"]);
  assert.equal(pickWinner(claims, {rule: "gm"}).winner, null);
  assert.equal(pickWinner({}, {rule: "roll"}).reason, "none");
});

test("the balance counts takes and deposits, undone entries count for nothing", () => {
  const entries = [
    {id: "1", kind: "award", from: {kind: "pool"}, to: {kind: "actor", id: "a"}, item: {value: 300}},
    {id: "2", kind: "split", from: {kind: "pool"}, to: {kind: "actor", id: "b"}, coins: 50},
    {id: "3", kind: "deposit", from: {kind: "actor", id: "a"}, to: {kind: "stash"}, item: {value: 100}},
    {id: "4", kind: "give", from: {kind: "actor", id: "a"}, to: {kind: "actor", id: "b"}, item: {value: 20}},
    {id: "5", kind: "withdraw", from: {kind: "fund"}, to: {kind: "actor", id: "b"}, coins: 30},
    {id: "6", kind: "undo", undoes: "5", from: {kind: "actor", id: "b"}, to: {kind: "fund"}, coins: 30},
    {id: "7", kind: "move", from: {kind: "pool"}, to: {kind: "stash"}, item: {value: 999}}
  ];
  assert.deepEqual(balance(entries), {a: 180, b: 70});
  assert.deepEqual(balance(entries.map(e => ({...e, time: 10})), {since: 20}), {});
});

test("the chain shows a later change", () => {
  assert.equal(canonical({b: 1, a: [2, {d: 3, c: undefined}]}), "{\"a\":[2,{\"d\":3}],\"b\":1}");
  assert.equal(hashString("abc"), hashString("abc"));
  assert.notEqual(hashString("abc"), hashString("abd"));
  assert.equal(hashString("abc").length, 14);
  const one = seal({id: "1", kind: "award", coins: 5}, "");
  const two = seal({id: "2", kind: "split", coins: 7}, one.hash);
  const three = seal({id: "3", kind: "give", coins: 1}, two.hash);
  assert.deepEqual(verifyChain([one, two, three]), {ok: true, brokenAt: null});
  assert.deepEqual(verifyChain([one, {...two, coins: 70}, three]), {ok: false, brokenAt: 1});
  assert.deepEqual(verifyChain([one, three]), {ok: false, brokenAt: 1});
  assert.deepEqual(verifyChain([]), {ok: true, brokenAt: null});
});
