/**
 * Small input dialogs: a quantity, a recipient, coins, the characters of a split. Built on DialogV2, which Foundry 13 and
 * 14 both offer.
 */

import {esc, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {parseCoins} from "./coins.mjs";

const {DialogV2} = foundry.applications.api;

/**
 * The form data of a dialog button's form.
 * @param {HTMLButtonElement} button
 * @returns {object}
 */
function formData(button) {
  const FDE = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;
  return foundry.utils.expandObject(new FDE(button.form).object);
}

/**
 * Ask how many units.
 * @param {string} title
 * @param {number} max
 * @returns {Promise<number|null>}
 */
export async function askQuantity(title, max) {
  if ( max <= 1 ) return 1;
  const content = `<div class="form-group"><label>${esc(t("SLL.Dialog.quantity"))}</label>`
    + `<input type="number" name="quantity" value="${max}" min="1" max="${max}" step="1" autofocus></div>`;
  const result = await DialogV2.prompt({
    window: {title}, content, rejectClose: false,
    ok: {label: t("SLL.Dialog.ok"), callback: (event, button) => Number(formData(button).quantity)}
  });
  if ( !Number.isFinite(result) || (result < 1) ) return null;
  return Math.min(Math.floor(result), max);
}

/**
 * Ask who gets an item, and how many units.
 * @param {string} title
 * @param {Actor[]} actors
 * @param {number} max
 * @returns {Promise<{actorId: string, quantity: number}|null>}
 */
export async function askRecipient(title, actors, max) {
  if ( !actors.length ) {
    ui.notifications.warn(t("SLL.Error.noCharacter"));
    return null;
  }
  const options = actors.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("");
  let content = `<div class="form-group"><label>${esc(t("SLL.Dialog.recipient"))}</label>`
    + `<select name="actorId">${options}</select></div>`;
  if ( max > 1 ) content += `<div class="form-group"><label>${esc(t("SLL.Dialog.quantity"))}</label>`
    + `<input type="number" name="quantity" value="${max}" min="1" max="${max}" step="1"></div>`;
  const result = await DialogV2.prompt({
    window: {title}, content, rejectClose: false,
    ok: {label: t("SLL.Dialog.ok"), callback: (event, button) => formData(button)}
  });
  if ( !result?.actorId ) return null;
  return {actorId: result.actorId, quantity: Math.min(Math.max(Math.floor(Number(result.quantity) || 1), 1), max)};
}

/**
 * Ask for an amount of coins.
 * @param {string} title
 * @param {object} [options]
 * @param {boolean} [options.byCoin]   One field per coin (systems which keep coins separately)
 * @param {boolean} [options.note]     Ask for a note too
 * @returns {Promise<{coins: Record<string, number>|number, note: string}|null>}
 */
export async function askCoins(title, {byCoin=false, note=false}={}) {
  const a = adapter();
  const denoms = [...a.denominations()].sort((x, y) => y.value - x.value);
  let content;
  if ( byCoin ) {
    content = `<div class="sll-coin-fields">${denoms.map(d => `<label><span>${esc(d.abbr)}</span>`
      + `<input type="number" name="coin.${esc(d.key)}" value="0" min="0" step="1"></label>`).join("")}</div>`;
  }
  else {
    const main = denoms.find(d => d.key === a.mainCoin());
    content = `<div class="form-group"><label>${esc(t("SLL.Dialog.amount"))}</label>`
      + `<input type="text" name="amount" placeholder="${esc(t("SLL.Dialog.amountHint", {coin: main?.abbr ?? ""}))}" autofocus>`
      + `</div>`;
  }
  if ( note ) content += `<div class="form-group"><label>${esc(t("SLL.Dialog.note"))}</label>`
    + `<input type="text" name="note" maxlength="120"></div>`;
  const result = await DialogV2.prompt({
    window: {title}, content, rejectClose: false,
    ok: {label: t("SLL.Dialog.ok"), callback: (event, button) => formData(button)}
  });
  if ( !result ) return null;
  if ( byCoin ) {
    const coins = {};
    for ( const d of denoms ) {
      const count = Math.max(Math.floor(Number(foundry.utils.getProperty(result, `coin.${d.key}`)) || 0), 0);
      if ( count ) coins[d.key] = count;
    }
    if ( !Object.keys(coins).length ) return null;
    return {coins, note: result.note ?? ""};
  }
  const base = parseCoins(result.amount, denoms, a.mainCoin());
  if ( !base ) {
    ui.notifications.warn(t("SLL.Error.noAmount"));
    return null;
  }
  return {coins: base, note: result.note ?? ""};
}

/**
 * Ask which characters share the coins of the loot.
 * @param {Actor[]} actors
 * @returns {Promise<string[]|null>}
 */
export async function askSplit(actors) {
  const rows = actors.map(a => `<label class="sll-check"><input type="checkbox" name="ids.${esc(a.id)}" checked>`
    + `<img src="${esc(a.img)}" alt=""> ${esc(a.name)}</label>`).join("");
  const result = await DialogV2.prompt({
    window: {title: t("SLL.Dialog.splitTitle")},
    content: `<p>${esc(t("SLL.Dialog.splitHint"))}</p><div class="sll-check-list">${rows}</div>`,
    rejectClose: false,
    ok: {label: t("SLL.Dialog.split"), callback: (event, button) => formData(button)}
  });
  if ( !result ) return null;
  return Object.entries(result.ids ?? {}).filter(([, on]) => on).map(([id]) => id);
}

/**
 * Ask for confirmation.
 * @param {string} title
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function confirm(title, text) {
  return !!(await DialogV2.confirm({window: {title}, content: `<p>${esc(text)}</p>`, rejectClose: false}));
}
