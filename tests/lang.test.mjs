import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * All keys of a nested translation object, dotted.
 * @param {object} object
 * @param {string} [prefix]
 * @returns {string[]}
 */
function keysOf(object, prefix="") {
  return Object.entries(object).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return (value && (typeof value === "object")) ? keysOf(value, full) : [full];
  });
}

/**
 * All files of a folder, recursively.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function files(dir) {
  const list = await readdir(dir, {withFileTypes: true});
  return (await Promise.all(list.map(e => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])))).flat();
}

const en = JSON.parse(await readFile(path.join(root, "lang/en.json"), "utf8"));
const de = JSON.parse(await readFile(path.join(root, "lang/de.json"), "utf8"));
const enKeys = new Set(keysOf(en));

test("English and German have the same keys", () => {
  assert.deepEqual([...keysOf(de)].sort(), [...enKeys].sort());
});

test("no key is both a text and a group", () => {
  for ( const key of enKeys ) {
    assert.ok(![...enKeys].some(other => other.startsWith(`${key}.`)), key);
  }
});

test("every key used by scripts and templates exists", async () => {
  const sources = [...await files(path.join(root, "scripts")), ...await files(path.join(root, "templates"))];
  const used = new Set();
  for ( const file of sources ) {
    const text = await readFile(file, "utf8");
    for ( const match of text.matchAll(/["'`](SLL\.[A-Za-z0-9_.]+)["'`]/g) ) used.add(match[1]);
  }
  // Keys built from template strings
  const {SETTINGS} = {SETTINGS: JSON.parse(await readFile(path.join(root, "lang/en.json"), "utf8")).SLL.SETTINGS};
  for ( const key of Object.keys(SETTINGS) ) {
    used.add(`SLL.SETTINGS.${key}.name`);
    used.add(`SLL.SETTINGS.${key}.hint`);
  }
  for ( const tab of ["stash", "pool", "log", "balance"] ) used.add(`SLL.Tab.${tab}`);
  for ( const claim of ["need", "want", "pass"] ) used.add(`SLL.Claim.${claim}`);
  for ( const rule of ["fair", "roll", "gm"] ) used.add(`SLL.Pool.distributeConfirm.${rule}`);
  for ( const reason of ["single", "fair", "fairRoll", "roll"] ) used.add(`SLL.Reason.${reason}`);
  for ( const place of ["pool", "stash", "fund", "outside"] ) used.add(`SLL.Place.${place}`);
  // Built from parts in ledger.mjs: SLL.Log.<kind>[.<variant>]
  for ( const key of used ) if ( /\.$/.test(key) || key.endsWith(".SLL") ) used.delete(key);
  const missing = [...used].filter(key => !enKeys.has(key) && ![...enKeys].some(k => k.startsWith(`${key}.`)));
  assert.deepEqual(missing, []);
});

test("every log kind has a sentence", () => {
  const log = en.SLL.Log;
  for ( const kind of ["award", "split", "move", "give", "spend", "undo"] ) assert.equal(typeof log[kind], "string", kind);
  assert.equal(typeof log.edit.update, "string");
  for ( const area of ["pool", "stash"] ) {
    assert.equal(typeof log.edit.create[area], "string");
    assert.equal(typeof log.edit.delete[area], "string");
  }
  for ( const area of ["pool", "stash", "fund"] ) {
    assert.equal(typeof log.add.new[area], "string");
    assert.equal(typeof log.add.from[area], "string");
  }
  for ( const v of ["stash", "fund"] ) {
    assert.equal(typeof log.deposit[v], "string");
    assert.equal(typeof log.withdraw[v], "string");
  }
});
