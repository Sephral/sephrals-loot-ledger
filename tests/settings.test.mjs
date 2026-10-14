import assert from "node:assert/strict";
import test from "node:test";

// settings.mjs and the modules it imports touch these Foundry APIs at import time
globalThis.foundry = {
  utils: {debounce: fn => fn, deepClone: value => structuredClone(value)},
  applications: {api: {ApplicationV2: class {}, HandlebarsApplicationMixin: Base => class extends Base {}, DialogV2: class {}}},
  data: {fields: {NumberField: class {
    constructor(options) {
      Object.assign(this, options);
    }
  }}}
};
globalThis.game = {system: {id: "crucible"}};

const {MODULE_ID} = await import("../scripts/config.mjs");
const {FOLLOW_FOUNDRY} = await import("../scripts/language.mjs");
const {SETTINGS, hiddenSettings, registerSettings} = await import("../scripts/settings.mjs");

/**
 * Register the settings with a stub of game.settings which records every call.
 * @param {string} systemId
 * @returns {{settings: Map<string, object>, menus: Map<string, object>}}
 */
function register(systemId) {
  const settings = new Map();
  const menus = new Map();
  globalThis.game = {system: {id: systemId}, settings: {
    register: (module, key, data) => settings.set(`${module}.${key}`, data),
    registerMenu: (module, key, data) => menus.set(`${module}.${key}`, data)
  }};
  registerSettings();
  const strip = map => new Map([...map].map(([key, data]) => [key.replace(`${MODULE_ID}.`, ""), data]));
  return {settings: strip(settings), menus: strip(menus)};
}

test("the module language comes first and follows Foundry by default", () => {
  const {settings} = register("crucible");
  assert.equal([...settings.keys()][0], "uiLanguage");
  assert.equal(settings.get("uiLanguage").scope, "client");
  assert.equal(settings.get("uiLanguage").default, FOLLOW_FOUNDRY);
});

test("the defaults keep the party inventory open and the log public", () => {
  const {settings} = register("dnd5e");
  assert.equal(settings.get("stashWithdraw").default, "free");
  assert.equal(settings.get("giveAcceptance").default, true);
  assert.equal(settings.get("distribution").default, "fair");
  assert.equal(settings.get("remainder").default, "fund");
  assert.equal(settings.get("chatCards").default, "all");
  for ( const key of ["ledgerActor", "ledgerJournal", "pending", "acknowledgedVersions"] ) {
    assert.equal(settings.get(key).config, false, key);
  }
  for ( const key of Object.keys(SETTINGS) ) {
    assert.equal(settings.get(key).name, `SLL.SETTINGS.${key}.name`);
    assert.equal(settings.get(key).hint, `SLL.SETTINGS.${key}.hint`);
  }
});

test("the path settings only show in systems without an own adapter", () => {
  const generic = Object.keys(SETTINGS).filter(k => SETTINGS[k].generic);
  assert.ok(generic.length >= 4);
  const supported = register("crucible").settings;
  const other = register("swade").settings;
  for ( const key of generic ) {
    assert.equal(supported.get(key).config, false, key);
    assert.equal(other.get(key).config, true, key);
  }
});

test("loot table, party fund and balance are on by default and come right after the language", () => {
  const {settings} = register("dnd5e");
  assert.deepEqual([...settings.keys()].slice(1, 4), ["lootTable", "partyFund", "balanceTab"]);
  for ( const key of ["lootTable", "partyFund", "balanceTab"] ) {
    assert.equal(settings.get(key).type, Boolean, key);
    assert.equal(settings.get(key).default, true, key);
    assert.equal(settings.get(key).scope, "world", key);
  }
});

test("settings of a switched off part hide in the settings dialog", () => {
  assert.deepEqual(hiddenSettings({lootTable: true, partyFund: true}), []);
  assert.deepEqual(hiddenSettings({lootTable: false, partyFund: true}).sort(),
    ["collectPrompt", "distribution", "remainder"]);
  assert.deepEqual(hiddenSettings({lootTable: true, partyFund: false}).sort(), ["fundLimit", "remainder"]);
  for ( const key of Object.values(SETTINGS).flatMap(def => def.requires ?? []) ) {
    assert.equal(SETTINGS[key]?.type, Boolean, key);
  }
});

test("the self test is a GM menu", () => {
  const {menus} = register("crucible");
  assert.equal(menus.get("selfTest").restricted, true);
});
