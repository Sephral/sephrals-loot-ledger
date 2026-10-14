/**
 * Collecting loot from a fight: the GM picks what the defeated combatants leave behind, and it moves into the loot.
 * When a combat ends, the GM's client offers this right away (world setting). Without the loot table nothing is offered
 * after a fight; the GM collects by hand, straight into the party inventory.
 */

import {esc, parts, setting, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {report, request} from "./transport.mjs";
import {isLedgerActor} from "./storage.mjs";

/** The defeated combatants of the last ended combat, as actor UUIDs. */
let lastDefeated = [];

/**
 * The defeated non-player combatants of a combat.
 * @param {Combat} combat
 * @returns {string[]}   Actor UUIDs
 */
function defeatedOf(combat) {
  const a = adapter();
  return (combat?.combatants.contents ?? []).filter(c => c.actor && !a.isCharacter(c.actor) && !isLedgerActor(c.actor)
    && a.isDefeated(c)).map(c => c.actor.uuid);
}

/**
 * What an actor can leave behind.
 * @param {Actor} actor
 * @returns {{items: Item[], coins: number}}
 */
function belongings(actor) {
  const a = adapter();
  const items = actor.items.filter(i => a.isTransferable(i) && !i.system?.container);
  return {items, coins: a.coinsBase(actor)};
}

/**
 * Hook "deleteCombat": remember the defeated and offer to collect their belongings (active GM).
 * @param {Combat} combat
 */
export function onDeleteCombat(combat) {
  if ( !game.user.isActiveGM ) return;
  const uuids = defeatedOf(combat);
  if ( uuids.length ) lastDefeated = uuids;
  if ( !uuids.length || !parts().loot || !setting("collectPrompt") ) return;
  const any = uuids.some(uuid => {
    const actor = fromUuidSync(uuid);
    if ( !actor ) return false;
    const {items, coins} = belongings(actor);
    return items.length || coins;
  });
  if ( any ) openCollect(uuids);
}

/**
 * Open the collect dialog for a list of actors, by default the defeated of the running or the last combat.
 * @param {string[]} [uuids]
 * @returns {Promise<void>}
 */
export async function openCollect(uuids) {
  if ( !game.user.isGM ) return;
  uuids ??= defeatedOf(game.combat);
  if ( !uuids.length ) uuids = lastDefeated;
  const a = adapter();
  const {loot, fund} = parts();
  const withCoins = loot || fund;
  const actors = uuids.map(uuid => fromUuidSync(uuid)).filter(actor => actor instanceof Actor);
  const sections = actors.map((actor, index) => {
    const {items, coins: purse} = belongings(actor);
    const coins = withCoins ? purse : 0;
    if ( !items.length && !coins ) return "";
    const rows = items.map(item => {
      const qty = a.quantity(item);
      return `<label class="sll-check"><input type="checkbox" name="pick.a${index}.${esc(item.id)}" checked>`
        + `<img src="${esc(item.img)}" alt=""> ${esc(a.displayName(item))}${qty > 1 ? ` <small>× ${qty}</small>` : ""}</label>`;
    }).join("");
    const coinRow = coins ? `<label class="sll-check"><input type="checkbox" name="coins.a${index}" checked>`
      + `<i class="fa-solid fa-coins" inert></i> ${esc(a.formatCoins(coins))}</label>` : "";
    return `<fieldset class="sll-collect"><legend>${esc(actor.name)}</legend>${rows}${coinRow}</fieldset>`;
  }).filter(Boolean);
  if ( !sections.length ) {
    ui.notifications.info(t("SLL.Notice.nothingToCollect"));
    return;
  }
  const result = await foundry.applications.api.DialogV2.prompt({
    window: {title: t("SLL.Collect.title"), icon: "fa-solid fa-sack"},
    position: {width: 480},
    content: `<p>${esc(t(loot ? "SLL.Collect.hint" : "SLL.Collect.hintStash"))}</p><div class="sll-collect-list">${sections.join("")}</div>`,
    rejectClose: false,
    ok: {label: t(loot ? "SLL.Collect.take" : "SLL.Collect.takeStash"), callback: (event, button) => {
      const FDE = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;
      return foundry.utils.expandObject(new FDE(button.form).object);
    }}
  });
  if ( !result ) return;
  const sources = actors.map((actor, index) => ({
    actorUuid: actor.uuid,
    items: Object.entries(result.pick?.[`a${index}`] ?? {}).filter(([, on]) => on).map(([id]) => ({id})),
    coins: !!result.coins?.[`a${index}`]
  })).filter(s => s.items.length || s.coins);
  if ( !sources.length ) return;
  report(await request("collect", {sources}));
}
