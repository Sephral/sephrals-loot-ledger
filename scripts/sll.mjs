import {MODULE_ID, t} from "./config.mjs";
import {adapter, registerAdapter, BaseAdapter} from "./adapters/index.mjs";
import {openLedger, scheduleRefresh} from "./app.mjs";
import {onRenderChatMessage} from "./chat.mjs";
import {onDeleteCombat, openCollect} from "./collect.mjs";
import {registerDebug} from "./debug.mjs";
import {saveDebugFile} from "./debug-file.mjs";
import {applyModuleLanguage} from "./language.mjs";
import {entries, verify} from "./ledger.mjs";
import {dropLeftovers, onRenderTokenHUD, openPiles} from "./piles.mjs";
import {noticeNewVersions, runSelfTest} from "./selftest.mjs";
import {handleRequest, rememberLedgerItems, watchLedgerItems} from "./service.mjs";
import {onRenderSettingsConfig, registerSettings} from "./settings.mjs";
import {ensureStorage, isLedgerActor, ledgerActor} from "./storage.mjs";
import {onGetHeaderControls, onGetRollTableContextOptions, onRenderRollTableSheet, onRenderTableResultConfig, openLootRoll}
  from "./tables.mjs";
import {registerTransport, report, request} from "./transport.mjs";
import {registerUsage} from "./usage.mjs";

/** The name of the tool in the token controls. */
const TOOL = "sll-ledger";

Hooks.once("init", () => {
  registerSettings();
  registerUsage(MODULE_ID, {
    features: ["lootClaim", "lootDistribute", "coinSplit", "stashTransfer", "itemGive", "fundCoins", "combatCollect",
      "logUndo", "pileTake", "pileDrop", "tableLoot"],
    settings: ["lootTable", "partyFund", "distribution"]
  });
  registerTransport(handleRequest);
  registerDebug();

  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
  Hooks.on("renderActorDirectory", onRenderActorDirectory);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("dropActorSheetData", onDropActorSheetData);
  Hooks.on("renderSettingsConfig", onRenderSettingsConfig);
  Hooks.on("renderTokenHUD", onRenderTokenHUD);
  Hooks.on("renderTableResultConfig", onRenderTableResultConfig);
  Hooks.on("renderRollTableSheet", onRenderRollTableSheet);
  Hooks.on("getHeaderControlsRollTableSheet", onGetHeaderControls);
  Hooks.on("getRollTableContextOptions", onGetRollTableContextOptions);

  // Changes made past the module and redraws of the window
  for ( const kind of ["create", "update", "delete"] ) {
    const watch = watchLedgerItems(kind);
    Hooks.on(`${kind}Item`, (item, changes) => {
      watch(item, changes);
      if ( item.parent instanceof Actor ) scheduleRefresh();
    });
    Hooks.on(`${kind}JournalEntryPage`, page => {
      if ( page.parent?.getFlag(MODULE_ID, "ledger") ) scheduleRefresh();
    });
  }
  Hooks.on("updateActor", () => scheduleRefresh());

  game.modules.get(MODULE_ID).api = {
    /** Open the window, optionally on a tab ("stash", "pool", "log", "balance"). */
    open: openLedger,
    /** Open the dialog which collects the belongings of defeated combatants (GM). */
    collect: openCollect,
    /** Open the dialog which takes the contents of Item Piles into the loot (GM), by default those on the scene. */
    takeFromPiles: openPiles,
    /** Leave the loot nobody claimed as a new Item Pile on the scene (GM). */
    dropLeftovers,
    /** Roll loot on a roll table (a RollTable or its UUID) in the preview window (GM). */
    rollLoot: openLootRoll,
    /** Send a request to the GM, like the window does. */
    request: async (action, payload) => report(await request(action, payload)),
    /** All log entries in order. */
    entries,
    /** Check the log for later changes. */
    verify,
    /** The actor which holds the loot and the party inventory. */
    ledgerActor,
    /** The adapter of the running system. */
    adapter,
    /** Register an adapter for another system (before "ready"). */
    registerAdapter,
    /** The adapter base class to extend. */
    BaseAdapter,
    /** Check the storage, the log and the system adapter (GM). */
    runSelfTest,
    /** Save the debug file of Sephral's modules (GM): about one chat message, or without an id the latest picture. */
    saveDebugFile: messageId => saveDebugFile(messageId ?? null, {moduleId: MODULE_ID})
  };
});

/** Applying a fixed module language loads its file; the rest of "ready" waits for it. */
let languageReady = Promise.resolve();

Hooks.once("i18nInit", () => {
  languageReady = applyModuleLanguage(game.settings.get(MODULE_ID, "uiLanguage"));
});

Hooks.once("ready", async () => {
  await languageReady;
  await ensureStorage();
  rememberLedgerItems();
  noticeNewVersions();
});

/* -------------------------------------------- */

/**
 * Hook "getSceneControlButtons": the Loot Ledger in the token controls.
 * @param {Record<string, object>|object[]} controls
 */
function onGetSceneControlButtons(controls) {
  const tokens = controls?.tokens ?? (Array.isArray(controls) ? controls.find(c => c.name === "token") : null);
  if ( !tokens ) return;
  const tool = {
    name: TOOL,
    title: "SLL.Title",
    icon: "fa-solid fa-scroll",
    button: true,
    visible: true,
    onChange: () => openLedger()
  };
  if ( Array.isArray(tokens.tools) ) tokens.tools.push({...tool, onClick: tool.onChange});
  else {
    tool.order = Object.keys(tokens.tools ?? {}).length;
    tokens.tools[TOOL] = tool;
  }
}

/**
 * Hook "renderActorDirectory": a button above the actor list.
 * @param {Application} app
 * @param {HTMLElement} html
 */
function onRenderActorDirectory(app, html) {
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  const actions = element?.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".sll-open") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sll-open";
  button.innerHTML = `<i class="fa-solid fa-scroll" inert></i> <span>${t("SLL.Title")}</span>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    openLedger();
  });
  actions.append(button);
}

/**
 * Hook "dropActorSheetData": items dropped on the ledger actor's own sheet go through the module, so nothing lands there
 * unlogged.
 * @param {Actor} actor
 * @param {ActorSheet} sheet
 * @param {object} data
 * @returns {boolean|void}
 */
function onDropActorSheetData(actor, sheet, data) {
  if ( !isLedgerActor(actor) || (data?.type !== "Item") ) return;
  (async () => {
    const item = await Item.implementation.fromDropData(data);
    if ( !item ) return;
    const onActor = (item.parent instanceof Actor) && item.parent.items.get(item.id);
    report(await request("addItems", onActor ? {area: "stash", uuids: [item.uuid]} : {area: "stash", data: [item.toObject()]}));
  })();
  return false;
}
