import assert from "node:assert/strict";
import test from "node:test";
import {MAX_DEPTH, drawLines, lootPayload, normalizeFormula, parseCoinText, plainText, resolveQuantity, summarize}
  from "../scripts/loot-roll.mjs";

const DND = [
  {key: "pp", value: 1000, abbr: "pp"}, {key: "gp", value: 100, abbr: "GM"}, {key: "ep", value: 50, abbr: "ep"},
  {key: "sp", value: 10, abbr: "sp"}, {key: "cp", value: 1, abbr: "cp"}
];

/** A tiny formula evaluator for the tests: numbers, dice as their maximum, + - * /. */
async function evaluate(formula) {
  if ( !/^[\d\sd+\-*/().]+$/.test(formula) ) throw new Error(`bad formula ${formula}`);
  const max = formula.replace(/(\d*)d(\d+)/g, (all, n, faces) => `(${n || 1}*${faces})`);
  return Function(`"use strict"; return (${max});`)();
}

test("formulas typed by a GM become rollable", () => {
  assert.equal(normalizeFormula(" 2d4 × 10 "), "2d4*10");
  assert.equal(normalizeFormula("2d4x10"), "2d4*10");
  assert.equal(normalizeFormula("1d6 + 2"), "1d6 + 2");
  assert.equal(normalizeFormula(""), "");
  assert.equal(normalizeFormula(null), "");
});

test("descriptions lose their HTML", () => {
  assert.equal(plainText("<p>3d6 <strong>gp</strong></p>"), "3d6 gp");
  assert.equal(plainText("a&nbsp;b &amp; c"), "a b & c");
});

test("coin texts are read with keys and abbreviations", () => {
  assert.deepEqual(parseCoinText("3d6 gp", DND), [{formula: "3d6", key: "gp"}]);
  assert.deepEqual(parseCoinText("2d4 × 10 GP", DND), [{formula: "2d4*10", key: "gp"}]);
  assert.deepEqual(parseCoinText("50 GM", DND), [{formula: "50", key: "gp"}]);
  assert.deepEqual(parseCoinText("1d4 pp, 2d6 sp and 5 cp", DND),
    [{formula: "1d4", key: "pp"}, {formula: "2d6", key: "sp"}, {formula: "5", key: "cp"}]);
  assert.deepEqual(parseCoinText("<p>4d6 sp.</p>", DND), [{formula: "4d6", key: "sp"}]);
  assert.deepEqual(parseCoinText("12gp + 3 sp", DND), [{formula: "12", key: "gp"}, {formula: "3", key: "sp"}]);
});

test("texts that are not only coins stay texts", () => {
  assert.equal(parseCoinText("Nothing", DND), null);
  assert.equal(parseCoinText("10 arrows", DND), null);
  assert.equal(parseCoinText("3d6 gp and a rusty key", DND), null);
  assert.equal(parseCoinText("", DND), null);
  assert.equal(parseCoinText("3d6 gp", []), null);
});

test("quantities: empty is 1, never below 0, null when the formula fails", async () => {
  assert.equal(await resolveQuantity("", evaluate), 1);
  assert.equal(await resolveQuantity("2d4", evaluate), 8);
  assert.equal(await resolveQuantity("1d4-10", evaluate), 0);
  assert.equal(await resolveQuantity("2.7", evaluate), 2);
  assert.equal(await resolveQuantity("lots", evaluate), null);
});

/**
 * A fake world: tables roll their results in order, documents by UUID.
 * @param {Record<string, object>} docs
 */
function world(docs) {
  const cursor = new Map();
  return {
    roll: async table => {
      const i = cursor.get(table.uuid) ?? 0;
      cursor.set(table.uuid, i + 1);
      return [table.results[i % table.results.length]];
    },
    evaluate,
    resolve: async uuid => docs[uuid] ?? null,
    quantityOf: result => result.flags?.["sephrals-loot-ledger"]?.quantity ?? "",
    coinParts: text => parseCoinText(text, DND),
    coinValue: key => DND.find(d => d.key === key)?.value ?? null,
    newId: (() => {
      let n = 0;
      return () => `l${++n}`;
    })()
  };
}

const qty = formula => ({"sephrals-loot-ledger": {quantity: formula}});

test("items get their quantity, coins their worth, other results stay out", async () => {
  const docs = {"Item.arrow": {documentName: "Item", uuid: "Item.arrow", name: "Arrow", img: "arrow.webp"},
    "Actor.goblin": {documentName: "Actor", uuid: "Actor.goblin", name: "Goblin"}};
  const table = {uuid: "RollTable.main", results: [
    {type: "document", documentUuid: "Item.arrow", name: "Arrow", flags: qty("2d10")},
    {type: "text", name: "3d6 gp"},
    {type: "text", name: "", description: "<p>A dusty map</p>"},
    {type: "document", documentUuid: "Actor.goblin", name: "Goblin"},
    {type: "document", documentUuid: "Item.gone", name: "Lost thing"}
  ]};
  const lines = await drawLines(table, world(docs), {times: 5});
  assert.deepEqual(lines.map(l => [l.kind, l.name, l.quantity, l.coins, l.include]), [
    ["item", "Arrow", 20, 0, true],
    ["coins", "3d6 gp", 0, 1800, true],
    ["text", "A dusty map", 0, 0, false],
    ["text", "Goblin", 0, 0, false],
    ["text", "Lost thing", 0, 0, false]
  ]);
  assert.equal(lines[0].uuid, "Item.arrow");
  assert.equal(lines[0].formula, "2d10");
  assert.ok(lines.every(l => l.tableUuid === "RollTable.main"));
  assert.deepEqual(summarize(lines), {items: 1, coins: 1800});
  assert.deepEqual(lootPayload(lines), {items: [{uuid: "Item.arrow", quantity: 20}], coins: 1800});
});

test("a nested table is drawn as often as its quantity says", async () => {
  const inner = {uuid: "RollTable.gems", documentName: "RollTable", results: [
    {type: "document", documentUuid: "Item.ruby", name: "Ruby"},
    {type: "text", name: "10 sp", flags: qty("2")}
  ]};
  const docs = {"RollTable.gems": inner, "Item.ruby": {documentName: "Item", uuid: "Item.ruby", name: "Ruby"}};
  const table = {uuid: "RollTable.hoard", results: [{type: "document", documentUuid: "RollTable.gems", flags: qty("3")}]};
  const lines = await drawLines(table, world(docs));
  assert.deepEqual(lines.map(l => [l.kind, l.name, l.coins, l.tableUuid, l.depth]), [
    ["item", "Ruby", 0, "RollTable.gems", 1],
    ["coins", "10 sp", 200, "RollTable.gems", 1],
    ["item", "Ruby", 0, "RollTable.gems", 1]
  ]);
  assert.deepEqual(summarize(lines), {items: 2, coins: 200});
});

test("a table that contains itself stops at the depth limit", async () => {
  const loop = {uuid: "RollTable.loop", documentName: "RollTable", results: [
    {type: "document", documentUuid: "RollTable.loop"},
    {type: "text", name: "1 cp"}
  ]};
  let rolls = 0;
  const lines = await drawLines(loop, {...world({"RollTable.loop": loop}), roll: async () => {
    rolls++;
    return loop.results;
  }});
  assert.equal(rolls, MAX_DEPTH + 1);
  assert.equal(lines.filter(l => l.kind === "coins").length, MAX_DEPTH + 1);
});

test("an invalid quantity formula counts as 1 and is marked", async () => {
  const docs = {"Item.rope": {documentName: "Item", uuid: "Item.rope", name: "Rope"}};
  const table = {uuid: "RollTable.t", results: [{type: "document", documentUuid: "Item.rope", flags: qty("lots")}]};
  const [line] = await drawLines(table, world(docs));
  assert.equal(line.quantity, 1);
  assert.equal(line.invalid, true);
  assert.equal(line.include, true);
});

test("a quantity of 0 leaves the item out", async () => {
  const docs = {"Item.rope": {documentName: "Item", uuid: "Item.rope", name: "Rope"}};
  const table = {uuid: "RollTable.t", results: [{type: "document", documentUuid: "Item.rope", flags: qty("1d4-10")}]};
  const lines = await drawLines(table, world(docs));
  assert.equal(lines[0].include, false);
  assert.deepEqual(lootPayload(lines), {items: [], coins: 0});
});

test("excluded lines do not count", () => {
  const lines = [
    {kind: "item", uuid: "Item.a", quantity: 2, include: true, coins: 0},
    {kind: "item", uuid: "Item.b", quantity: 1, include: false, coins: 0},
    {kind: "coins", quantity: 0, include: false, coins: 500},
    {kind: "coins", quantity: 0, include: true, coins: 30}
  ];
  assert.deepEqual(summarize(lines), {items: 1, coins: 30});
  assert.deepEqual(lootPayload(lines), {items: [{uuid: "Item.a", quantity: 2}], coins: 30});
});
