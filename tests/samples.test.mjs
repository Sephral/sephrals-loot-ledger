import assert from "node:assert/strict";
import test from "node:test";
import {IMG, sampleLedger} from "../scripts/sample-data.mjs";
import {verifyChain} from "../scripts/chain.mjs";

const cast = [
  {id: "ari", name: "Ari", side: "party", img: "a.webp", player: "Lena"},
  {id: "mira", name: "Mira", side: "party", img: "b.webp", player: "Tom"},
  {id: "tovin", name: "Tovin", side: "party", img: "c.webp", player: "Sam"},
  {id: "sela", name: "Sela", side: "party", img: "d.webp", player: "Jo"},
  {id: "troll", name: "Troll", side: "foe"}
];
const build = () => sampleLedger(key => `<${key}>`, {gold: 100, now: 1_000_000_000_000, cast});

test("the sample log is a valid chain, and a changed entry breaks it", () => {
  const {log} = build();
  assert.ok(log.length > 10);
  assert.deepEqual(verifyChain(log), {ok: true, brokenAt: null});
  const tampered = log.map(e => (e.seq === 6 ? {...e, coins: e.coins + 1} : e));
  assert.equal(verifyChain(tampered).brokenAt, 5);
});

test("the sample party is the shared cast and every loot row has what the window needs", () => {
  const d = build();
  assert.deepEqual(d.members.map(m => m.id), ["ari", "mira", "tovin", "sela"]);
  for ( const row of [...d.pool, ...d.stash, ...Object.values(d.mine).flat()] ) {
    assert.ok(row.id && row.name && row.img && row.quantity >= 1, row.id);
    assert.equal(row.value, row.each * row.quantity);
  }
  assert.ok(d.pool.some(r => r.covered && r.realName && r.dc), "an unidentified item");
  assert.ok(d.pool.some(r => Object.values(r.claims).includes("need")) && d.pool.some(r => Object.values(r.claims).includes("pass")));
  assert.ok(d.table.some(l => l.invalid) && d.table.some(l => l.kind === "coins") && d.table.some(l => !l.include));
  assert.ok(d.log.some(e => e.kind === "undo" && d.log.some(o => o.id === e.undoes)));
});

test("values follow the gold factor and no id repeats", () => {
  const d = sampleLedger(key => key, {gold: 1000, now: 0, cast});
  assert.equal(d.coins.fund, 480 * 1000);
  const ids = [...d.pool, ...d.stash, ...Object.values(d.mine).flat()].map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Object.values(IMG).every(p => p.startsWith("icons/")));
});
