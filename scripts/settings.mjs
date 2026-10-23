/**
 * Settings of the module. Like in every Sephral module, all options appear in Foundry's settings dialog under this
 * module, starting with the module language. World settings apply to everyone and are only shown to the GM; client
 * settings follow the user. The settings for systems without an own adapter only appear in such systems.
 */

import {MODULE_ID} from "./config.mjs";
import {adapter, hasAdapter} from "./adapters/index.mjs";
import {refreshLedger} from "./app.mjs";
import {editCoinValues} from "./dialogs.mjs";
import {FOLLOW_FOUNDRY, applyModuleLanguage} from "./language.mjs";
import {runSelfTest} from "./selftest.mjs";

/**
 * @typedef SettingDefinition
 * @property {Function} type                  Boolean, String or Number
 * @property {*} default
 * @property {Record<string, string>} [choices]
 * @property {{min: number, max: number, step: number}} [range]
 * @property {"world"|"client"} [scope="world"]
 * @property {boolean} [generic]              Only for systems without an own adapter
 * @property {string[]} [requires]            Switches this setting depends on; it hides while one of them is off
 * @property {Function} [onChange]
 */

/** Redraw the window after a setting changed. */
const redraw = () => refreshLedger();

/**
 * The settings of the module, in the order they appear in the settings dialog.
 * @type {Record<string, SettingDefinition>}
 */
export const SETTINGS = {
  uiLanguage: {type: String, default: FOLLOW_FOUNDRY, scope: "client", onChange: onLanguageChange, choices: {
    [FOLLOW_FOUNDRY]: "SLL.LANGUAGE.default", de: "SLL.LANGUAGE.de", en: "SLL.LANGUAGE.en"}},
  lootTable: {type: Boolean, default: true, onChange: redraw},
  partyFund: {type: Boolean, default: true, onChange: redraw},
  balanceTab: {type: Boolean, default: true, onChange: redraw},
  recipients: {type: String, default: "party", onChange: redraw, choices: {
    party: "SLL.SETTINGS.recipients.party", players: "SLL.SETTINGS.recipients.players"}},
  stashWithdraw: {type: String, default: "free", choices: {
    free: "SLL.SETTINGS.stashWithdraw.free", approval: "SLL.SETTINGS.stashWithdraw.approval"}},
  fundLimit: {type: Number, default: 10, range: {min: 0, max: 10000, step: 1}, requires: ["partyFund"]},
  giveAcceptance: {type: Boolean, default: true},
  distribution: {type: String, default: "fair", onChange: redraw, requires: ["lootTable"], choices: {
    fair: "SLL.SETTINGS.distribution.fair", roll: "SLL.SETTINGS.distribution.roll", gm: "SLL.SETTINGS.distribution.gm"}},
  remainder: {type: String, default: "fund", requires: ["lootTable", "partyFund"], choices: {
    fund: "SLL.SETTINGS.remainder.fund", pool: "SLL.SETTINGS.remainder.pool"}},
  collectPrompt: {type: Boolean, default: true, requires: ["lootTable"]},
  chatCards: {type: String, default: "all", choices: {
    all: "SLL.SETTINGS.chatCards.all", gm: "SLL.SETTINGS.chatCards.gm", off: "SLL.SETTINGS.chatCards.off"}},
  genericCharacterType: {type: String, default: "character", generic: true, onChange: redraw},
  genericQuantity: {type: String, default: "system.quantity", generic: true, onChange: redraw},
  genericPrice: {type: String, default: "system.price", generic: true, onChange: redraw},
  genericCurrency: {type: String, default: "", generic: true, onChange: redraw},
  genericCoinName: {type: String, default: "gp", generic: true, onChange: redraw}
};

/* -------------------------------------------- */

/**
 * Switch the module strings when the user picks another module language, and redraw what shows them.
 * @param {string} value
 */
function onLanguageChange(value) {
  applyModuleLanguage(value).then(() => {
    refreshLedger();
    ui.controls?.render();
    if ( game.settings.sheet?.rendered ) game.settings.sheet.render();
  });
}

/* -------------------------------------------- */

/**
 * The settings to hide in the settings dialog, because a switch they depend on is off.
 * @param {Record<string, boolean>} switches   The current state of the switches
 * @returns {string[]}
 */
export function hiddenSettings(switches) {
  return Object.keys(SETTINGS).filter(key => SETTINGS[key].requires?.some(s => !switches[s]));
}

/**
 * Hook "renderSettingsConfig": hide the settings of parts that are switched off, and follow the switches while the GM
 * changes them.
 * @param {Application} app
 * @param {HTMLElement} html
 */
export function onRenderSettingsConfig(app, html) {
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  const input = key => element?.querySelector(`[name="${MODULE_ID}.${key}"]`);
  const switches = [...new Set(Object.values(SETTINGS).flatMap(def => def.requires ?? []))].filter(key => input(key));
  if ( !switches.length ) return;
  const update = () => {
    const hidden = new Set(hiddenSettings(Object.fromEntries(switches.map(key => [key, input(key).checked]))));
    for ( const key of Object.keys(SETTINGS) ) {
      const group = input(key)?.closest(".form-group");
      if ( group ) group.style.display = hidden.has(key) ? "none" : "";
    }
  };
  for ( const key of switches ) input(key).addEventListener("change", update);
  update();
}

/* -------------------------------------------- */

/**
 * The menu button which runs the self-test. Foundry only accepts application classes as menus; this one runs the test
 * instead of opening a window.
 */
class LedgerSelfTestMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    if ( game.user.isGM ) await runSelfTest();
    return this;
  }
}

/** The menu button which opens the coin values dialog (D&D 5e). */
class LedgerCoinValuesMenu extends foundry.applications.api.ApplicationV2 {
  /** @override */
  async render() {
    if ( game.user.isGM ) await editCoinValues();
    return this;
  }
}

/* -------------------------------------------- */

/**
 * Register all settings of the module and the self-test menu button.
 */
export function registerSettings() {
  const generic = !hasAdapter();
  for ( const [key, def] of Object.entries(SETTINGS) ) {
    game.settings.register(MODULE_ID, key, {
      name: `SLL.SETTINGS.${key}.name`,
      hint: `SLL.SETTINGS.${key}.hint`,
      scope: def.scope ?? "world",
      config: def.generic ? generic : true,
      type: def.range ? new foundry.data.fields.NumberField({...def.range, initial: def.default}) : def.type,
      choices: def.choices,
      default: def.default,
      onChange: def.onChange
    });
  }

  // Storage and open requests, written by the GM's client
  game.settings.register(MODULE_ID, "ledgerActor", {scope: "world", config: false, type: String, default: ""});
  game.settings.register(MODULE_ID, "ledgerJournal", {scope: "world", config: false, type: String, default: ""});
  game.settings.register(MODULE_ID, "pending", {scope: "world", config: false, type: Array, default: [],
    onChange: redraw});

  // Worth of each coin for tables with their own exchange rates, only the values that differ from the system
  game.settings.register(MODULE_ID, "coinValues", {scope: "world", config: false, type: Object, default: {},
    onChange: redraw});

  // The newer Foundry and system versions the GM was already told about
  game.settings.register(MODULE_ID, "acknowledgedVersions", {scope: "client", config: false, type: String, default: ""});

  game.settings.registerMenu(MODULE_ID, "selfTest", {
    name: "SLL.SELFTEST.Title",
    label: "SLL.SELFTEST.Run",
    hint: "SLL.SELFTEST.Hint",
    icon: "fa-solid fa-stethoscope",
    type: LedgerSelfTestMenu,
    restricted: true
  });

  if ( adapter().coinValuesConfigurable ) game.settings.registerMenu(MODULE_ID, "coinValuesMenu", {
    name: "SLL.SETTINGS.coinValues.name",
    label: "SLL.SETTINGS.coinValues.label",
    hint: "SLL.SETTINGS.coinValues.hint",
    icon: "fa-solid fa-coins",
    type: LedgerCoinValuesMenu,
    restricted: true
  });
}
