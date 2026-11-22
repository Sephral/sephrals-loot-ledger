/**
 * Unidentified items, the Foundry side. A covered item shows a cover name, picture and description; the GM or a check
 * reveals it. The changes themselves are planned in cover-logic.mjs. Where the game system has its own identification
 * (D&D 5e) the module uses that. Everywhere else the item carries the cover and the real name, picture and
 * description wait in a journal only GMs can see ("swap"), so they never reach a player's client.
 *
 * What can still leak, honestly: the numbers and options of the item (type, price, bonuses, properties) stay in its
 * data in every system, and with the system's own identification (D&D 5e) the real name and picture stay in the item's
 * source data too. The setting "coverSafe" swaps in D&D 5e as well. Log entries and chat cards written before an item
 * was covered keep what they said, so cover items before they enter the loot.
 */

import {MODULE_ID, esc, flag, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {COVER_FLAG, defaultCoverName, normalizeCover, parseSecret, planCover, planReveal, serializeSecret}
  from "./cover-logic.mjs";

/** The key of a secret in the GM's browser (device store). */
const deviceKey = id => `${MODULE_ID}.secret.${game.world.id}.${id}`;

/**
 * Where new secrets go (world setting): the secrets journal, or the GM's browser only.
 * @returns {"journal"|"device"}
 */
function secretStore() {
  try {
    return (game.settings.get(MODULE_ID, "coverSecrets") === "device") ? "device" : "journal";
  } catch {
    return "journal";
  }
}

/* -------------------------------------------- */
/*  The secrets                                 */
/* -------------------------------------------- */

/**
 * The journal with the real values of covered items. Players do not receive it at all (ownership none).
 * @returns {JournalEntry|null}
 */
export function secretsJournal() {
  return game.journal.find(j => flag(j, "secrets")) ?? null;
}

/**
 * The secrets journal, created by a GM when it is missing.
 * @returns {Promise<JournalEntry>}
 */
async function ensureSecrets() {
  return secretsJournal() ?? JournalEntry.implementation.create({
    name: t("SLL.Cover.journalName"),
    ownership: {default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE},
    flags: {[MODULE_ID]: {secrets: true}}
  });
}

/**
 * Store a secret.
 * @param {object} payload
 * @param {"journal"|"device"} store
 * @returns {Promise<string>}   Its id
 */
async function saveSecret(payload, store) {
  if ( store === "device" ) {
    const id = foundry.utils.randomID();
    try {
      localStorage.setItem(deviceKey(id), serializeSecret(payload));
    } catch(err) {
      throw new Error("SLL.Error.deviceStore", {cause: err});
    }
    return id;
  }
  const journal = await ensureSecrets();
  const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
    name: payload.name || t("SLL.Cover.secretPage"), type: "text", text: {content: serializeSecret(payload)}
  }]);
  return page.id;
}

/**
 * Read a secret. The journal secrets are readable by every GM, the device secrets only in the browser that made them.
 * @param {string|null} id
 * @param {"journal"|"device"} [store]
 * @returns {object|null}
 */
export function readSecret(id, store = "journal") {
  if ( !id ) return null;
  if ( store === "device" ) {
    try {
      return parseSecret(localStorage.getItem(deviceKey(id)));
    } catch {
      return null;
    }
  }
  const page = secretsJournal()?.pages.get(id);
  return page ? parseSecret(page.text?.content) : null;
}

/**
 * Is a secret still named by a covered item (world items, items of world actors)? Copies of one covered item share it.
 * @param {string} id
 * @param {Item} [except]   The item being revealed
 * @returns {boolean}
 */
function secretInUse(id, except) {
  const named = item => (item !== except) && (flag(item, `${COVER_FLAG}.secret`) === id);
  return game.items.some(named) || game.actors.some(actor => actor.items.some(named));
}

/**
 * Remove the secret of a revealed item once nothing refers to it any more, so the real values do not stay behind.
 * @param {object} cover   The cover flag of the item
 * @param {Item} item
 * @returns {Promise<void>}
 */
async function dropSecret(cover, item) {
  if ( !cover?.secret || secretInUse(cover.secret, item) ) return;
  if ( cover.store === "device" ) {
    try {
      localStorage.removeItem(deviceKey(cover.secret));
    } catch {
      // nothing to remove
    }
    return;
  }
  await secretsJournal()?.pages.get(cover.secret)?.delete();
}

/* -------------------------------------------- */
/*  Covering and revealing                      */
/* -------------------------------------------- */

/**
 * What the GM sees about a covered item: the real name and the check.
 * @param {Item} item
 * @returns {{cover: object, realName: string|null, dc: number|null}|null}
 */
export function gmInfo(item) {
  const cover = adapter().coverOf(item);
  if ( !cover ) return null;
  const secret = readSecret(cover.secret, cover.store);
  const realName = (cover.mode === "system") ? (item._source?.name ?? item.name) : (secret?.name ?? null);
  return {cover, realName, dc: secret?.dc ?? null, missing: (cover.mode === "swap") && !secret};
}

/**
 * The cover a GM starts from: what the item has already, or a name made from its type.
 * @param {Item} item
 * @returns {{name: string, img: string, description: string, dc: number|null}}
 */
export function coverDefaults(item) {
  const a = adapter();
  const current = a.coverOf(item);
  const info = (game.user.isGM && current) ? gmInfo(item) : null;
  if ( current ) return {name: current.name, img: current.img, description: current.description ?? "", dc: info?.dc ?? null};
  const label = CONFIG.Item.typeLabels?.[item.type];
  const typeLabel = label ? game.i18n.localize(label) : "";
  return {name: defaultCoverName(t("SLL.Cover.defaultName"), typeLabel), img: "", description: "", dc: null};
}

/**
 * Put a cover on an item (GM client). An item that is covered already gets the new cover over its real values.
 * @param {Item} item
 * @param {{name?: string, img?: string, description?: string, dc?: number|string|null}} input
 * @returns {Promise<{coverName: string, mode: string}>}
 */
export async function coverItem(item, input) {
  const a = adapter();
  if ( a.isCovered(item) ) await revealItem(item);
  const mode = a.coverMode();
  const cover = normalizeCover(input, coverDefaults(item));
  const descriptionPath = (mode === "swap") ? a.descriptionPath(item) : null;
  const source = item._source;
  const real = {name: source.name, img: source.img,
    description: descriptionPath ? foundry.utils.getProperty(source, descriptionPath) : null};
  const store = secretStore();
  const plan = planCover({mode, scope: MODULE_ID, real, cover, descriptionPath, store,
    nativeUpdate: (mode === "system") ? a.nativeCoverUpdate(cover) : null});
  // The secret only exists when there is something to keep
  if ( (mode === "swap") || (cover.dc !== null) ) {
    plan.flag.secret = await saveSecret({...plan.secret}, store);
    plan.update[`flags.${MODULE_ID}.${COVER_FLAG}`] = plan.flag;
  }
  await item.update(plan.update);
  return {coverName: cover.name, mode};
}

/**
 * Reveal an item (GM client): the real values come back and the cover goes.
 * @param {Item} item
 * @returns {Promise<{coverName: string, realName: string}>}
 */
export async function revealItem(item) {
  const a = adapter();
  const cover = a.coverOf(item);
  if ( !cover ) throw new Error("SLL.Error.notCovered");
  const secret = readSecret(cover.secret, cover.store);
  const realName = (cover.mode === "system") ? (item._source?.name ?? item.name) : secret?.name;
  const update = planReveal({mode: cover.mode, scope: MODULE_ID, secret, descriptionPath: a.descriptionPath(item),
    nativeUpdate: (cover.mode === "system") ? a.nativeRevealUpdate() : null});
  await item.update(update);
  await dropSecret(cover, item);
  return {coverName: cover.name, realName: realName ?? item.name};
}

/**
 * Remember a try of a character (GM client).
 * @param {Item} item
 * @param {string} actorId
 * @returns {Promise<void>}
 */
export async function markTried(item, actorId) {
  await item.update({[`flags.${MODULE_ID}.${COVER_FLAG}.tries.${actorId}`]: true});
}

/* -------------------------------------------- */
/*  The dialog                                  */
/* -------------------------------------------- */

/**
 * The form of the cover question.
 * @param {string} name       The item's name
 * @param {{name: string, img: string, description: string, dc: number|null}} d
 * @param {string} hint       Key of the hint about where the secret is kept
 * @returns {string}
 */
export function coverContent(name, d, hint) {
  return `<p>${esc(t("SLL.Cover.hint", {name}))}</p>
      <div class="form-group"><label>${esc(t("SLL.Cover.name"))}</label>
        <div class="form-fields"><input type="text" name="name" value="${esc(d.name)}"></div></div>
      <div class="form-group"><label>${esc(t("SLL.Cover.img"))}</label>
        <div class="form-fields"><file-picker name="img" type="image" value="${esc(d.img)}"></file-picker></div></div>
      <div class="form-group stacked"><label>${esc(t("SLL.Cover.description"))}</label>
        <textarea name="description" rows="4">${esc(d.description)}</textarea></div>
      <div class="form-group"><label>${esc(t("SLL.Cover.dc"))}</label>
        <div class="form-fields"><input type="number" name="dc" min="1" max="99" step="1" value="${d.dc ?? ""}"></div>
        <p class="hint">${esc(t("SLL.Cover.dcHint"))}</p></div>
      <p class="hint">${esc(t(hint))}</p>`;
}

/**
 * Ask the GM for the cover of an item.
 * @param {Item} item
 * @returns {Promise<{name: string, img: string, description: string, dc: number|null}|null>}
 */
export async function askCover(item) {
  const d = coverDefaults(item);
  const mode = adapter().coverMode();
  const hint = (mode === "system") ? "SLL.Cover.modeSystem" : (secretStore() === "device" ? "SLL.Cover.modeDevice" : "SLL.Cover.modeSwap");
  const FDE = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: {title: t("SLL.Cover.title"), icon: "fa-solid fa-mask"},
    position: {width: 460},
    content: coverContent(item.name, d, hint),
    rejectClose: false,
    ok: {label: t("SLL.Cover.confirm"), callback: (event, button) => foundry.utils.expandObject(new FDE(button.form).object)}
  });
  if ( !result ) return null;
  return normalizeCover(result, d);
}

/* -------------------------------------------- */
/*  The item directory                          */
/* -------------------------------------------- */

/**
 * Hook "getItemContextOptions": cover or reveal a world item from the Items directory (GM). Both key sets of the entry
 * are set, so Foundry 13 and 14 read it without a warning.
 * @param {Application} app
 * @param {object[]} entries
 * @param {(action: string, payload: object) => Promise<void>} act   Sends the request
 */
export function addDirectoryEntries(app, entries, act) {
  const itemOf = li => {
    const element = li?.[0] ?? li;
    return game.items.get(element?.dataset?.entryId ?? element?.dataset?.documentId);
  };
  const make = (key, icon, show, run) => {
    const label = t(key);
    entries.push({
      name: label, label, icon: `<i class="${icon}"></i>`,
      condition: li => game.user.isGM && show(itemOf(li)), visible: li => game.user.isGM && show(itemOf(li)),
      callback: li => run(itemOf(li)), onClick: (_event, li) => run(itemOf(li))
    });
  };
  const a = () => adapter();
  make("SLL.Cover.menuCover", "fa-solid fa-mask", item => !!item && a().isTransferable(item) && !a().isCovered(item),
    async item => {
      const input = await askCover(item);
      if ( input ) await act("cover", {uuid: item.uuid, ...input});
    });
  make("SLL.Cover.menuReveal", "fa-solid fa-eye", item => !!item && a().isCovered(item), item => act("reveal", {uuid: item.uuid}));
}
