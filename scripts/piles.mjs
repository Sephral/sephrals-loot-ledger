/**
 * The bridge to Item Piles (only while that module is active). The GM takes what a pile holds into the loot, from a
 * button on the pile's token or from the Loot Ledger window, and can leave the loot nobody claimed as a new pile on the
 * scene. Items always leave and enter piles through Item Piles' own API, so its rules (empty piles vanish, vault logs,
 * macros) keep working. The changes themselves run in service.mjs on the active GM's client like every other change.
 */

import {esc, parts, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {pileCoinPlan} from "./pile-map.mjs";
import {isContained, isLedgerActor} from "./storage.mjs";
import {report, request} from "./transport.mjs";

/**
 * Item Piles' API, if the module is active.
 * @returns {object|null}
 */
export function pilesApi() {
  if ( !game.modules.get("item-piles")?.active ) return null;
  return game.itempiles?.API ?? null;
}

/**
 * Is a token or actor an Item Pile the party can loot (a pile or a container, not a merchant or a vault)?
 * @param {TokenDocument|Actor} doc
 * @returns {boolean}
 */
export function isLootablePile(doc) {
  const api = pilesApi();
  if ( !api || !doc ) return false;
  try {
    return !!api.isItemPileLootable(doc);
  } catch {
    return false;
  }
}

/**
 * What the module can take from a pile: its items (containers with their contents) and its coins.
 * @param {TokenDocument|Actor} pile
 * @returns {{items: Item[], coins: ReturnType<typeof pileCoinPlan>}}
 */
export function pileContents(pile) {
  const api = pilesApi();
  const a = adapter();
  const items = (api?.getActorItems(pile) ?? []).filter(i => a.isTransferable(i) && !isContained(i));
  const coinsOn = (a.id !== "generic") || a.hasCoins;
  const coins = pileCoinPlan(coinsOn ? (api?.getActorCurrencies(pile) ?? []) : [], a.denominations(), a.mainCoin());
  return {items, coins};
}

/**
 * The lootable piles on the scene the GM looks at.
 * @returns {TokenDocument[]}
 */
export function scenePiles() {
  const scene = canvas?.scene;
  if ( !scene ) return [];
  return scene.tokens.filter(token => token.actor && !isLedgerActor(token.actor) && isLootablePile(token));
}

/* -------------------------------------------- */

/**
 * GM: pick what to take from piles, by default every pile on the current scene.
 * @param {string[]} [uuids]   Token or actor UUIDs of piles
 * @returns {Promise<void>}
 */
export async function openPiles(uuids) {
  if ( !game.user.isGM || !pilesApi() ) return;
  const piles = uuids ? uuids.map(uuid => fromUuidSync(uuid)).filter(isLootablePile) : scenePiles();
  const a = adapter();
  const {loot, fund} = parts();
  const withCoins = loot || fund;
  const sources = [];
  const sections = piles.map((pile, index) => {
    const {items, coins} = pileContents(pile);
    const base = withCoins ? coins.base : 0;
    if ( !items.length && !base ) return "";
    sources.push({index, uuid: pile.uuid});
    const rows = items.map(item => {
      const qty = a.quantity(item);
      return `<label class="sll-check"><input type="checkbox" name="pick.p${index}.${esc(item.id)}" checked>`
        + `<img src="${esc(item.img)}" alt=""> ${esc(a.displayName(item))}${qty > 1 ? ` <small>× ${qty}</small>` : ""}</label>`;
    }).join("");
    const coinRow = base ? `<label class="sll-check"><input type="checkbox" name="coins.p${index}" checked>`
      + `<i class="fa-solid fa-coins" inert></i> ${esc(a.formatCoins(base))}</label>` : "";
    const kept = coins.kept.length ? `<p class="hint">${esc(t("SLL.Piles.kept", {list: coins.kept.join(", ")}))}</p>` : "";
    return `<fieldset class="sll-collect"><legend>${esc(pile.name)}</legend>${rows}${coinRow}${kept}</fieldset>`;
  }).filter(Boolean);
  if ( !sections.length ) {
    ui.notifications.info(t(piles.length ? "SLL.Notice.pilesEmpty" : "SLL.Notice.noPiles"));
    return;
  }
  const result = await foundry.applications.api.DialogV2.prompt({
    window: {title: t("SLL.Piles.title"), icon: "fa-solid fa-box-open"},
    position: {width: 480},
    content: `<p>${esc(t(loot ? "SLL.Piles.hint" : "SLL.Piles.hintStash"))}</p><div class="sll-collect-list">${sections.join("")}</div>`,
    rejectClose: false,
    ok: {label: t(loot ? "SLL.Collect.take" : "SLL.Collect.takeStash"), callback: (event, button) => {
      const FDE = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;
      return foundry.utils.expandObject(new FDE(button.form).object);
    }}
  });
  if ( !result ) return;
  const picked = sources.map(({index, uuid}) => ({
    pileUuid: uuid,
    items: Object.entries(result.pick?.[`p${index}`] ?? {}).filter(([, on]) => on).map(([id]) => ({id})),
    coins: !!result.coins?.[`p${index}`]
  })).filter(s => s.items.length || s.coins);
  if ( !picked.length ) return;
  report(await request("takePile", {sources: picked}));
}

/**
 * GM: leave the loot nobody claimed as a new Item Pile, next to the selected token or in the middle of the view.
 * @returns {Promise<void>}
 */
export async function dropLeftovers() {
  if ( !game.user.isGM || !pilesApi() ) return;
  const scene = canvas?.scene;
  if ( !scene ) {
    ui.notifications.warn(t("SLL.Error.noScene"));
    return;
  }
  const token = canvas.tokens?.controlled?.[0];
  const size = canvas.grid?.size ?? 100;
  const center = token ? {x: token.document.x + (token.document.width * size), y: token.document.y}
    : {x: canvas.stage.pivot.x, y: canvas.stage.pivot.y};
  let position = center;
  try {
    position = canvas.grid.getSnappedPoint(center, {mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX});
  } catch {
    position = {x: Math.round(center.x), y: Math.round(center.y)};
  }
  const {DialogV2} = foundry.applications.api;
  const yes = await DialogV2.confirm({window: {title: t("SLL.Piles.drop")}, content: `<p>${esc(t("SLL.Piles.dropConfirm"))}</p>`,
    rejectClose: false});
  if ( !yes ) return;
  report(await request("dropPile", {sceneId: scene.id, position: {x: position.x, y: position.y}}));
}

/* -------------------------------------------- */

/**
 * Hook "renderTokenHUD": a button on lootable piles that takes their contents into the loot (GM).
 * @param {TokenHUD} hud
 * @param {HTMLElement} html
 */
export function onRenderTokenHUD(hud, html) {
  if ( !game.user.isGM || !pilesApi() ) return;
  const token = hud.document ?? hud.object?.document;
  if ( !isLootablePile(token) ) return;
  const element = (html instanceof HTMLElement) ? html : html?.[0];
  const column = element?.querySelector(".col.right") ?? element?.querySelector(".col.left");
  if ( !column || column.querySelector(".sll-pile") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon sll-pile";
  button.dataset.tooltip = t("SLL.Piles.hud");
  button.setAttribute("aria-label", t("SLL.Piles.hud"));
  button.innerHTML = `<i class="fa-solid fa-scroll" inert></i>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openPiles([token.uuid]);
  });
  column.append(button);
}
