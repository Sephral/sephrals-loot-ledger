/**
 * The transfer log. Only the active GM writes it, everyone can read it: one journal page per day lists the entries as a
 * table (readable even without the module), and the entries themselves sit on the page as data for the module's own
 * views. Every entry is chained to the one before it, so a later change shows up as a broken chain.
 */

import {MODULE_ID, esc, flag, t} from "./config.mjs";
import {seal, verifyChain} from "./chain.mjs";
import {ledgerJournal} from "./storage.mjs";
import {adapter} from "./adapters/index.mjs";

/**
 * @typedef LedgerPlace
 * @property {"actor"|"pool"|"stash"|"fund"|"outside"} kind
 * @property {string} [id]     Actor id
 * @property {string} [name]
 */

/**
 * @typedef LedgerEntry
 * @property {string} id
 * @property {number} seq
 * @property {number} time         Real time (ms)
 * @property {string} user         Id of the user who asked for it
 * @property {string} userName
 * @property {string} kind         add, award, split, move, remove, deposit, withdraw, give, spend, edit, undo
 * @property {LedgerPlace} from
 * @property {LedgerPlace} to
 * @property {{name: string, img: string, quantity: number, value: number}|null} item
 * @property {number} coins        Base units
 * @property {string} note
 * @property {string|null} undoes  Id of the entry an undo reverses
 * @property {object} ref          What an undo needs (item ids), for a changed quantity the one before
 * @property {string} prev
 * @property {string} hash
 */

/* -------------------------------------------- */

/**
 * The day key of a time, in the local time zone.
 * @param {number} time
 * @returns {string}
 */
function dayKey(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * All entries in order.
 * @returns {LedgerEntry[]}
 */
export function entries() {
  const journal = ledgerJournal();
  if ( !journal ) return [];
  const list = journal.pages.contents.flatMap(p => flag(p, "entries") ?? []);
  return list.sort((a, b) => a.seq - b.seq);
}

/**
 * Check the chain of all entries.
 * @returns {{ok: boolean, brokenAt: number|null, count: number}}
 */
export function verify() {
  const list = entries();
  return {...verifyChain(list), count: list.length};
}

/* -------------------------------------------- */

/**
 * Append entries to the log (active GM only). The caller serializes calls.
 * @param {Partial<LedgerEntry>[]} list
 * @returns {Promise<LedgerEntry[]>}
 */
export async function append(list) {
  const journal = ledgerJournal();
  if ( !journal || !list.length ) return [];
  const all = entries();
  let last = all.at(-1) ?? {seq: 0, hash: ""};
  const sealed = [];
  for ( const raw of list ) {
    const entry = seal({
      id: foundry.utils.randomID(),
      seq: last.seq + 1,
      time: Date.now(),
      user: raw.user ?? game.user.id,
      userName: raw.userName ?? game.users.get(raw.user ?? game.user.id)?.name ?? "",
      kind: raw.kind,
      from: raw.from ?? {kind: "outside"},
      to: raw.to ?? {kind: "outside"},
      item: raw.item ?? null,
      coins: Math.max(Math.floor(raw.coins ?? 0), 0),
      note: raw.note ?? "",
      undoes: raw.undoes ?? null,
      ref: raw.ref ?? {}
    }, last.hash);
    sealed.push(entry);
    last = entry;
  }

  // Today's page
  const day = dayKey(Date.now());
  let page = journal.pages.find(p => flag(p, "day") === day);
  const pageEntries = [...(page ? (flag(page, "entries") ?? []) : []), ...sealed];
  const content = renderTable(pageEntries);
  if ( page ) {
    await page.update({"text.content": content, [`flags.${MODULE_ID}.entries`]: pageEntries});
  }
  else {
    [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
      name: new Date().toLocaleDateString(game.i18n.lang, {year: "numeric", month: "long", day: "numeric"}),
      type: "text",
      sort: -Date.now(),
      text: {content},
      flags: {[MODULE_ID]: {day, entries: pageEntries}}
    }]);
  }
  return sealed;
}

/* -------------------------------------------- */

/**
 * The name of a place in an entry.
 * @param {LedgerPlace} place
 * @returns {string}
 */
export function placeName(place) {
  switch ( place?.kind ) {
    case "actor": return place.name || "?";
    case "pool": return t("SLL.Place.pool");
    case "stash": return t("SLL.Place.stash");
    case "fund": return t("SLL.Place.fund");
    default: return place?.name || t("SLL.Place.outside");
  }
}

/**
 * The item or coins of an entry as text.
 * @param {LedgerEntry} entry
 * @returns {string}
 */
export function whatText(entry) {
  const parts = [];
  if ( entry.item ) parts.push((entry.item.quantity > 1) ? `${entry.item.quantity}× ${entry.item.name}` : entry.item.name);
  if ( entry.coins ) parts.push(adapter().formatCoins(entry.coins));
  return parts.join(", ");
}

/**
 * An entry as a sentence.
 * @param {LedgerEntry} entry
 * @param {Map<string, LedgerEntry>} [byId]   All entries, to describe what an undo reverses
 * @returns {string}
 */
export function describe(entry, byId) {
  const data = {from: placeName(entry.from), to: placeName(entry.to), what: whatText(entry), note: entry.note ?? ""};
  if ( entry.kind === "undo" ) {
    const original = byId?.get(entry.undoes);
    return t("SLL.Log.undo", {entry: original ? describe(original) : "?"});
  }
  const keys = [];
  if ( entry.kind === "edit" ) {
    // Older entries name the change only through their places
    if ( entry.from?.kind === "outside" ) keys.push(`SLL.Log.edit.create.${entry.to?.kind}`);
    else if ( entry.to?.kind === "outside" ) keys.push(`SLL.Log.edit.delete.${entry.from?.kind}`);
    else {
      keys.push("SLL.Log.edit.update");
      Object.assign(data, {name: entry.item?.name ?? "?", old: entry.ref?.before ?? "?", new: entry.item?.quantity ?? "?"});
    }
  }
  if ( entry.kind === "add" ) keys.push(`SLL.Log.add.${entry.from?.kind === "outside" ? "new" : "from"}.${entry.to?.kind}`);
  if ( ["deposit", "remove"].includes(entry.kind) ) keys.push(`SLL.Log.${entry.kind}.${entry.to?.kind === "fund" ? "fund" : entry.from?.kind === "pool" ? "pool" : "stash"}`);
  if ( entry.kind === "withdraw" ) keys.push(`SLL.Log.withdraw.${entry.from?.kind === "fund" ? "fund" : "stash"}`);
  keys.push(`SLL.Log.${entry.kind}`);
  const key = keys.find(k => game.i18n.has(k) && (typeof foundry.utils.getProperty(game.i18n.translations, k) === "string"));
  const text = key ? t(key, data) : `${data.from} → ${data.to}: ${data.what}`;
  return (entry.note && !text.includes(entry.note)) ? `${text} (${entry.note})` : text;
}

/**
 * The log of a day as an HTML table, for reading in the journal.
 * @param {LedgerEntry[]} list
 * @returns {string}
 */
export function renderTable(list) {
  const byId = new Map(entries().map(e => [e.id, e]));
  for ( const e of list ) byId.set(e.id, e);
  const a = adapter();
  const rows = list.map(e => {
    const time = new Date(e.time).toLocaleTimeString(game.i18n.lang, {hour: "2-digit", minute: "2-digit"});
    const value = (e.item?.value ?? 0) + (e.coins ?? 0);
    return `<tr><td>${e.seq}</td><td>${esc(time)}</td><td>${esc(e.userName)}</td><td>${esc(describe(e, byId))}</td>`
      + `<td>${value ? esc(a.formatCoins(value)) : ""}</td></tr>`;
  }).join("");
  return `<p>${esc(t("SLL.Log.pageIntro"))}</p><table><thead><tr><th>#</th><th>${esc(t("SLL.Log.time"))}</th>`
    + `<th>${esc(t("SLL.Log.by"))}</th><th>${esc(t("SLL.Log.what"))}</th><th>${esc(t("SLL.Log.value"))}</th></tr></thead>`
    + `<tbody>${rows}</tbody></table>`;
}
