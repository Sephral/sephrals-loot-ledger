/**
 * Chat cards. All of them are written by the active GM's client, so players cannot delete them:
 * - a card for every change of the log (public, only for the GM, or off),
 * - the rolls of a distribution,
 * - approval requests for the GM and offers for the receiving character's players, with buttons.
 */

import {MODULE_ID, esc, flag, setting, t} from "./config.mjs";
import {describe, entries} from "./ledger.mjs";
import {adapter} from "./adapters/index.mjs";
import {report, request} from "./transport.mjs";

/**
 * The ids of all GM users.
 * @returns {string[]}
 */
function gmIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

/**
 * Create a card as the GM.
 * @param {string} body
 * @param {object} [options]
 * @param {string[]|null} [options.whisper]
 * @param {object} [options.flags]
 * @returns {Promise<ChatMessage|null>}
 */
async function postCard(body, {whisper=null, flags={}}={}) {
  if ( !game.user.isGM ) return null;
  const content = cardHtml(body);
  const data = {content, speaker: {alias: t("SLL.Card.speaker")}, flags: {[MODULE_ID]: {card: true, ...flags}}};
  if ( whisper ) data.whisper = whisper;
  return ChatMessage.implementation.create(data);
}

/**
 * Post log entries, as the world chose.
 * @param {object[]} list
 */
export async function postEntries(list) {
  const mode = setting("chatCards");
  if ( (mode === "off") || !list.length ) return;
  await postCard(entriesBody(list, new Map(entries().map(e => [e.id, e]))), {whisper: (mode === "gm") ? gmIds() : null});
}

/**
 * The body of the card for log entries.
 * @param {object[]} list
 * @param {Map<string, object>} byId
 * @returns {string}
 */
export function entriesBody(list, byId) {
  const a = adapter();
  const items = list.map(e => {
    const value = (e.item?.value ?? 0) + (e.coins ?? 0);
    const img = e.item?.img ? `<img src="${esc(e.item.img)}" alt="">` : `<i class="fa-solid fa-coins" inert></i>`;
    return `<li>${img}<span>${esc(describe(e, byId))}</span>${value ? `<small>${esc(a.formatCoins(value))}</small>` : ""}</li>`;
  }).join("");
  return `<ul class="sll-card-entries">${items}</ul>`;
}

/**
 * Post the outcome of a distribution with its rolls.
 * @param {{item: string, winner: string, reason: string, rolls: {name: string, value: number}[]}[]} lines
 */
export async function postRolls(lines) {
  const mode = setting("chatCards");
  if ( (mode === "off") || !lines.length || !lines.some(l => l.rolls.length) ) return;
  await postCard(rollsBody(lines), {whisper: (mode === "gm") ? gmIds() : null});
}

/**
 * The body of the card for the rolls of a distribution.
 * @param {{item: string, winner: string, reason: string, rolls: {name: string, value: number}[]}[]} lines
 * @returns {string}
 */
export function rollsBody(lines) {
  const rows = lines.filter(l => l.rolls.length).map(l => {
    const rolls = [...l.rolls].sort((x, y) => y.value - x.value).map(r => `${esc(r.name)} ${r.value}`).join(" · ");
    return `<li><strong>${esc(l.item)}</strong> → ${esc(l.winner)}<br><small>${esc(t("SLL.Card.rolls"))}: ${rolls}</small></li>`;
  }).join("");
  return `<p>${esc(t("SLL.Card.distribution"))}</p><ul class="sll-card-rolls">${rows}</ul>`;
}

/**
 * Ask the GM to approve a request.
 * @param {object} pending
 */
export async function postApproval(pending) {
  const asker = game.users.get(pending.user)?.name ?? "?";
  await postCard(approvalBody(pending, asker), {whisper: gmIds(), flags: {pending: pending.id, kind: "approval"}});
}

/**
 * The body of an approval card.
 * @param {{id: string, label: string}} pending
 * @param {string} asker   Name of the user who asked
 * @returns {string}
 */
export function approvalBody(pending, asker) {
  return `<p>${esc(t("SLL.Card.approval", {user: asker}))}</p><p><strong>${esc(pending.label)}</strong></p>`
    + buttons(pending.id, "approval");
}

/**
 * Offer an item to the players of a character.
 * @param {object} pending
 * @param {Actor} to
 */
export async function postOffer(pending, to) {
  const owners = game.users.filter(u => !u.isGM && to.testUserPermission(u, "OWNER")).map(u => u.id);
  const whisper = [...new Set([...owners, pending.user, ...gmIds()])];
  await postCard(offerBody(pending), {whisper, flags: {pending: pending.id, kind: "offer", to: to.id}});
}

/**
 * The body of an offer card.
 * @param {{id: string, label: string}} pending
 * @returns {string}
 */
export function offerBody(pending) {
  return `<p><strong>${esc(pending.label)}</strong></p>${buttons(pending.id, "offer")}`;
}

/**
 * A card as the chat shows it: the body in the module's frame.
 * @param {string} body
 * @returns {string}
 */
export function cardHtml(body) {
  return `<div class="sll-card">${body}</div>`;
}

/**
 * The answer buttons of a card.
 * @param {string} id
 * @param {"approval"|"offer"} kind
 * @returns {string}
 */
function buttons(id, kind) {
  const [yes, no] = (kind === "offer") ? ["SLL.Card.accept", "SLL.Card.decline"] : ["SLL.Card.approve", "SLL.Card.deny"];
  return `<div class="sll-card-buttons"><button type="button" data-sll-answer="yes" data-sll-id="${esc(id)}">`
    + `<i class="fa-solid fa-check" inert></i> ${esc(t(yes))}</button>`
    + `<button type="button" data-sll-answer="no" data-sll-id="${esc(id)}"><i class="fa-solid fa-xmark" inert></i> `
    + `${esc(t(no))}</button></div>`;
}

/**
 * Mark the card of a request as answered.
 * @param {string} id
 * @param {string} text
 */
export async function resolveCard(id, text) {
  for ( const message of game.messages.filter(m => flag(m, "pending") === id) ) {
    await message.update({[`flags.${MODULE_ID}.resolved`]: text});
  }
}

/* -------------------------------------------- */

/**
 * Hook "renderChatMessageHTML": wire the answer buttons, hide them from users who may not answer, and show the outcome
 * of answered requests.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function onRenderChatMessage(message, html) {
  if ( !flag(message, "card") ) return;
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  if ( !element ) return;
  element.classList.add("sll-message");
  const box = element.querySelector(".sll-card-buttons");
  if ( !box ) return;
  const resolved = flag(message, "resolved");
  if ( resolved ) {
    box.outerHTML = `<p class="sll-card-resolved">${esc(resolved)}</p>`;
    return;
  }
  const kind = flag(message, "kind");
  const to = game.actors.get(flag(message, "to"));
  const mayAnswer = (kind === "approval") ? game.user.isGM : (game.user.isGM || to?.isOwner);
  if ( !mayAnswer ) {
    box.remove();
    return;
  }
  for ( const button of box.querySelectorAll("button[data-sll-answer]") ) {
    button.addEventListener("click", async event => {
      event.preventDefault();
      const yes = button.dataset.sllAnswer === "yes";
      for ( const b of box.querySelectorAll("button") ) b.disabled = true;
      const action = (kind === "approval") ? "answerApproval" : "answerOffer";
      const result = await request(action, {id: button.dataset.sllId, approve: yes, accept: yes});
      if ( !report(result) ) for ( const b of box.querySelectorAll("button") ) b.disabled = false;
    });
  }
}
