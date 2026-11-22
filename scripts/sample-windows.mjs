// Sample windows (api.samples, contract in samples.mjs): the Loot Ledger, the merchant, the loot roll, the questions and
// the chat cards of the module filled with made-up party loot, so translators and testers see every text in its place
// without playing a session first. Nothing here writes: the windows are the module's own classes with their data taken
// from memory, every button that would change something only says that it does nothing.
import {MODULE_ID, esc, t} from "./config.mjs";
import {adapter} from "./adapters/index.mjs";
import {LootLedger} from "./app.mjs";
import {MerchantWindow} from "./merchant.mjs";
import {LootRoll} from "./tables.mjs";
import {NOT_UNDOABLE, describe, placeName} from "./ledger.mjs";
import {verifyChain} from "./chain.mjs";
import {CLAIM_RANK, balance, pickWinner} from "./rules.mjs";
import {MAX_WISHES} from "./wish-logic.mjs";
import {clampShare, offerOf} from "./merchant-logic.mjs";
import {approvalBody, cardHtml, entriesBody, offerBody, rollsBody} from "./chat.mjs";
import {coinValuesContent, coinsContent, quantityContent, recipientContent, splitContent} from "./dialogs.mjs";
import {coverContent} from "./cover.mjs";
import {collectContent, collectSection} from "./collect.mjs";
import {pileSection, pilesContent} from "./piles.mjs";
import {selfTestBody} from "./selftest.mjs";
import {sampleLedger} from "./sample-data.mjs";
import {markSample, openSampleChat, openSampleHtml, sampleActions, sampleBlocked, sampleCast, sampleId} from "./samples.mjs";

// Actions of the windows that only look
const LEDGER_LOOKING = ["showTab"];
const MERCHANT_LOOKING = ["all"];

/** A text of the sample items and places. */
const L = key => t(`SLL.Sample.text.${key}`);

/** Base units of one gold coin in the running system (100 where the system has no gold coin). */
function goldValue() {
  return adapter().denominations?.().find(d => d.key === "gp")?.value ?? 100;
}

/** The sample data in the language of the user. */
function data() {
  return sampleLedger(L, {gold: goldValue(), cast: sampleCast()});
}

/* -------------------------------------------- */
/*  The Loot Ledger window                      */
/* -------------------------------------------- */

class SampleLedger extends LootLedger {

  /**
   * @param {object} view   {tab, lootOn, balanceOn, noGM, emptyPool, broken}
   * @param {object} [options]
   */
  constructor(view, options = {}) {
    super(options);
    this.view = view;
    this.tab = view.tab;
    markSample(this);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await Object.getPrototypeOf(LootLedger.prototype)._prepareContext.call(this, options);
    const a = adapter();
    const isGM = game.user.isGM;
    const view = this.view;
    const d = data();
    const members = d.members;
    const own = isGM ? members : [members[0]];
    const acting = own.find(m => m.id === this.actingId) ?? own[0];
    this.actingId = acting.id;
    const lootOn = view.lootOn !== false;
    const hasLoot = !view.emptyPool;
    const received = balance(d.log);
    const fmt = n => (n ? a.formatCoins(n) : "");

    context.ready = true;
    context.isGM = isGM;
    const visible = ["stash", (lootOn || hasLoot) && "pool", "wishes", "log", (view.balanceOn !== false) && "balance"].filter(Boolean);
    if ( !visible.includes(this.tab) ) this.tab = visible[0];
    context.tab = this.tab;
    context.tabs = visible.map(id => ({id, label: t(`SLL.Tab.${id}`), active: id === this.tab,
      badge: (id === "pool") && hasLoot ? d.pool.length : ""}));
    context.lootOn = lootOn;
    context.wishesOn = true;
    context.pilesOn = isGM;
    context.noGM = !!view.noGM;
    context.acting = {id: acting.id, name: acting.name, img: acting.img};
    context.showActing = ["stash", "pool"].includes(this.tab);
    context.ownCharacters = own.map(x => ({id: x.id, name: x.name, selected: x.id === acting.id}));
    context.members = members.map(x => ({id: x.id, name: x.name, img: x.img}));

    const itemRow = (item, area) => {
      const row = {id: item.id, area, name: item.name, img: item.img, quantity: item.quantity, many: item.quantity > 1,
        value: item.value ? a.formatCoins(item.value) : "", worth: item.value,
        contents: item.contents ? t("SLL.Stash.contains", {list: item.contents.join(", ")}) : ""};
      if ( item.covered ) {
        row.covered = true;
        row.canIdentify = !isGM;
        if ( isGM ) {
          row.realName = item.realName;
          row.dc = item.dc;
        }
      }
      row.heavy = !!item.heavy && (area !== "mine");
      return row;
    };

    // Loot
    context.pool = hasLoot ? d.pool.map(item => {
      const row = itemRow(item, "pool");
      const claims = item.claims ?? {};
      row.claims = members.filter(m => claims[m.id]).sort((x, y) => CLAIM_RANK[claims[y.id]] - CLAIM_RANK[claims[x.id]])
        .map(m => ({name: m.name, img: m.img, claim: claims[m.id], label: t(`SLL.Claim.${claims[m.id]}`)}));
      row.wanted = row.claims.some(c => c.claim !== "pass");
      if ( item.wishers ) {
        if ( isGM ) row.wishers = item.wishers.map(w => ({name: w.user, text: L(w.key), color: "#2e86c1"}));
        else if ( item.id === "p2" ) row.wished = L("wishRing");
      }
      if ( !isGM && (item.id === "p1") ) row.wished = L("wishHealing");
      row.myClaim = claims[acting.id] ?? null;
      row.claimButtons = ["need", "want", "pass"].map(c => ({claim: c, label: t(`SLL.Claim.${c}`), active: row.myClaim === c}));
      if ( isGM ) {
        const pick = pickWinner(claims, {rule: "fair", received});
        const suggested = pick.winner ?? pick.contenders[0] ?? null;
        row.options = [{id: "", name: "–", selected: !suggested},
          ...members.map(m => ({id: m.id, name: m.name, selected: m.id === suggested}))];
      }
      return row;
    }) : [];
    context.poolCoins = hasLoot ? fmt(d.coins.pool) : "";
    context.hasPoolCoins = hasLoot;

    // Party inventory
    let stashValue = 0;
    context.stash = d.stash.map(item => {
      const row = itemRow(item, "stash");
      stashValue += row.worth;
      if ( item.from ) row.origin = t("SLL.Stash.origin", {name: placeName(item.from),
        date: new Date(Date.now() - (item.ago * 3600000)).toLocaleDateString(game.i18n.lang)});
      return row;
    });
    context.stashValue = fmt(stashValue);
    context.hasUnclaimed = lootOn ? context.pool.some(r => !r.wanted) : context.pool.length > 0;
    context.fund = a.formatCoins(d.coins.fund);
    context.coinsAvailable = (a.id !== "generic") || !!a.hasCoins;
    context.fundOn = true;
    context.showFund = context.coinsAvailable;
    context.mine = (d.mine[acting.id] ?? []).map(item => {
      const row = itemRow(item, "mine");
      row.blocked = (!isGM && item.blocked) ? t(item.blocked) : "";
      return row;
    });
    context.purse = a.formatCoins(d.coins.purse[acting.id] ?? 0);
    context.capacity = t("SLL.Stash.capacity", {value: 112, max: 180});

    // Wish list
    context.wishList = d.wishes.mine.map(w => ({id: w.id, userId: "me", text: w.text, img: w.img ?? "", link: !!w.link,
      found: w.found.join(", ")}));
    context.wishFull = false;
    context.wishMax = MAX_WISHES;
    if ( isGM ) context.wishUsers = d.wishes.others.map(u => ({id: u.name, name: u.name, color: u.color,
      wishes: u.wishes.map(w => ({id: w.id, userId: u.name, text: w.text, img: w.img ?? "", link: !!w.link,
        found: w.found.join(", ")}))}));

    // Open requests (on the party inventory tab)
    context.pending = [];
    if ( this.tab === "stash" ) {
      const [withdraw, offer] = d.pending;
      if ( isGM ) context.pending = [
        {id: withdraw.id, label: t("SLL.Pending.withdraw", {actor: withdraw.actorName, what: withdraw.what}), mine: false,
          canApprove: true, canAccept: false, waiting: t("SLL.Pending.waitingGM")},
        {id: offer.id, label: t("SLL.Pending.offer", {from: offer.from, to: offer.to, what: offer.what}), mine: false,
          canApprove: false, canAccept: true, waiting: t("SLL.Pending.waitingOffer")}
      ];
      else context.pending = [
        {id: withdraw.id, label: t("SLL.Pending.withdraw", {actor: acting.name, what: withdraw.what}), mine: true,
          canApprove: false, canAccept: false, waiting: t("SLL.Pending.waitingGM")},
        {id: offer.id, label: t("SLL.Pending.offer", {from: members[1].name, to: acting.name, what: offer.what}), mine: false,
          canApprove: false, canAccept: true, waiting: t("SLL.Pending.waitingOffer")}
      ];
    }

    // Log
    let log = d.log;
    if ( view.broken ) log = log.map(e => (e.seq === 6 ? {...e, coins: e.coins + 1} : e));
    const byId = new Map(log.map(e => [e.id, e]));
    const undone = new Set(log.filter(e => e.kind === "undo").map(e => e.undoes));
    context.log = log.slice().reverse().map(e => ({
      id: e.id, seq: e.seq, kind: e.kind,
      time: new Date(e.time).toLocaleString(game.i18n.lang, {dateStyle: "short", timeStyle: "short"}),
      user: e.userName, text: describe(e, byId), img: e.item?.img ?? null,
      value: ((e.item?.value ?? 0) + (e.coins ?? 0)) ? a.formatCoins((e.item?.value ?? 0) + (e.coins ?? 0)) : "",
      undone: undone.has(e.id),
      canUndo: isGM && !NOT_UNDOABLE.includes(e.kind) && (e.to?.kind !== "pile") && !undone.has(e.id)
    }));
    const check = verifyChain(log);
    context.check = {ok: check.ok, count: log.length,
      text: check.ok ? t("SLL.Log.intact", {count: log.length}) : t("SLL.Log.broken", {seq: log[check.brokenAt]?.seq ?? "?"})};

    // Balance
    const session = balance(d.log, {since: Date.now() - (30 * 3600000)});
    context.balance = members.map(m => ({name: m.name, img: m.img,
      total: a.formatCoins(Math.abs(received[m.id] ?? 0)), totalNegative: (received[m.id] ?? 0) < 0,
      today: a.formatCoins(Math.abs(session[m.id] ?? 0)), todayNegative: (session[m.id] ?? 0) < 0}));
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Nothing is dropped or added in a sample
    const block = event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      sampleBlocked();
    };
    if ( this.sampleWired ) return;
    this.sampleWired = true;
    this.element.addEventListener("drop", block, true);
    this.element.addEventListener("keydown", event => {
      if ( (event.key === "Enter") && (event.target.name === "wish") ) block(event);
    }, true);
  }
}

/* -------------------------------------------- */
/*  The merchant window                         */
/* -------------------------------------------- */

class SampleMerchant extends MerchantWindow {

  /**
   * @param {object} view   {picked: string[], haggle: boolean, split: boolean, empty: boolean}
   * @param {object} [options]
   */
  constructor(view, options = {}) {
    super(options);
    this.view = view;
    this.picked = new Set(view.picked ?? []);
    this.share = 50;
    this.merchant = view.empty ? "" : L("merchant");
    this.payout = view.split ? "split" : "fund";
    if ( view.haggle ) this.haggle = {actor: data().members[3].name, skill: L("skill"), total: 17, baseline: 12, adjust: 10, limit: 20};
    markSample(this);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await Object.getPrototypeOf(MerchantWindow.prototype)._prepareContext.call(this, options);
    const a = adapter();
    const d = data();
    const members = d.members;
    this.split ??= new Set(members.map(m => m.id));
    this.haggler = members.find(m => m.id === this.haggler)?.id ?? members[3].id;
    const rows = this.view.empty ? [] : d.stash.filter(i => i.value > 0);
    let base = 0;
    context.items = rows.map(item => {
      const on = this.picked.has(item.id);
      const quantity = Math.min(Math.max(this.quantities.get(item.id) ?? item.quantity, 1), item.quantity);
      const value = item.each * quantity;
      if ( on ) base += value;
      return {id: item.id, img: item.img, name: item.name, max: item.quantity, many: item.quantity > 1, quantity, on,
        value: a.formatCoins(value)};
    });
    const adjust = this.haggle?.adjust ?? 0;
    const offer = offerOf(base, this.share, adjust);
    context.canHaggle = true;
    context.limit = 20;
    context.share = this.share = clampShare(this.share);
    context.merchant = this.merchant;
    context.hasItems = rows.length > 0;
    context.picked = this.picked.size;
    context.base = a.formatCoins(base);
    context.offer = a.formatCoins(offer);
    context.shareOffer = a.formatCoins(offerOf(base, this.share, 0));
    context.canSell = !!this.picked.size && (offer > 0);
    context.fundOn = true;
    context.toFund = this.payout === "fund";
    context.members = members.map(m => ({id: m.id, name: m.name, img: m.img, on: this.split.has(m.id), haggler: m.id === this.haggler}));
    if ( this.haggle ) {
      const signed = `${(adjust > 0) ? "+" : ""}${adjust}`;
      context.haggle = {...this.haggle, signed, text: t("SLL.Merchant.haggled", {actor: this.haggle.actor,
        skill: this.haggle.skill, total: this.haggle.total, baseline: this.haggle.baseline, adjust: signed,
        limit: this.haggle.limit})};
    }
    context.canRoll = !this.haggle && (this.picked.size > 0);
    return context;
  }
}

/* -------------------------------------------- */
/*  The loot roll window                        */
/* -------------------------------------------- */

class SampleLootRoll extends LootRoll {
  constructor(options = {}) {
    super({id: sampleId(MODULE_ID, "roll-table"), name: L("tableName")}, options);
    this.lines = data().table.map(line => ({...line, coins: line.coins}));
    markSample(this);
  }

  /** Nothing is drawn: the lines are the sample's. */
  async reroll() {}
}

/* -------------------------------------------- */
/*  Entries                                     */
/* -------------------------------------------- */

/** A window of the module as a sample: its id is not the real window's, its actions only look. */
async function openWindow(Class, key, build, looking, extra = {}) {
  const app = build({id: sampleId(MODULE_ID, key), actions: sampleActions(Class, looking), position: {height: 800}, ...extra});
  const open = foundry.applications.instances.get(app.id);
  if ( open ) await open.close({animate: false}).catch(() => {});
  await app.render({force: true});
  return app;
}

/** The buttons of a dialog, drawn as the dialog shows them (they do nothing here). */
function dialogBody(content, ok) {
  return `<div class="sll-sample-dialog">${content}<footer class="form-footer" style="display:flex;gap:6px;margin-top:8px;">`
    + `<button type="button" style="flex:1"><i class="fa-solid fa-check" inert></i> ${esc(ok)}</button></footer></div>`;
}

function question(key, title, build, ok, width = 420) {
  return openSampleHtml({moduleId: MODULE_ID, id: key, title: title(), width, body: () => dialogBody(build(), ok())});
}

function card(key, title, body, flags = {}, whisper = []) {
  return openSampleChat({moduleId: MODULE_ID, id: key, title: title(), whisper,
    content: () => cardHtml(body()), flags: {[MODULE_ID]: {card: true, ...flags}}});
}

/**
 * The sample entries of the module.
 * @returns {{id: string, label: string, group: string, open: () => Promise<Application>}[]}
 */
export function sampleWindows() {
  const label = key => t(`SLL.Sample.entry.${key}`);
  const windows = t("SLL.Sample.group.windows");
  const questions = t("SLL.Sample.group.questions");
  const cards = t("SLL.Sample.group.cards");
  const ok = () => t("SLL.Dialog.ok");
  const members = () => data().members;
  const ledger = (key, view) => ({id: key, group: windows, label: label(key),
    open: () => openWindow(SampleLedger, key, options => new SampleLedger(view, options), LEDGER_LOOKING)});
  const merchant = (key, view) => ({id: key, group: windows, label: label(key),
    open: () => openWindow(SampleMerchant, key, options => new SampleMerchant(view, options), MERCHANT_LOOKING)});

  return [
    ledger("pool", {tab: "pool"}),
    ledger("poolOff", {tab: "pool", lootOn: false, noGM: true}),
    ledger("poolEmpty", {tab: "pool", emptyPool: true}),
    ledger("stash", {tab: "stash"}),
    ledger("wishes", {tab: "wishes"}),
    ledger("log", {tab: "log"}),
    ledger("logBroken", {tab: "log", broken: true}),
    ledger("balance", {tab: "balance"}),
    merchant("merchant", {picked: ["s1", "s4", "s2"], haggle: true}),
    merchant("merchantSplit", {picked: ["s6"], split: true}),
    merchant("merchantEmpty", {empty: true}),
    {id: "lootRoll", group: windows, label: label("lootRoll"),
      open: () => openWindow(SampleLootRoll, "lootRoll", options => new SampleLootRoll(options), [], {position: {height: "auto"}})},

    {id: "askQuantity", group: questions, label: label("askQuantity"),
      open: () => question("askQuantity", () => t("SLL.Stash.deposit"), () => quantityContent(4), ok)},
    {id: "askRecipient", group: questions, label: label("askRecipient"),
      open: () => question("askRecipient", () => t("SLL.Pool.award"), () => recipientContent(members(), 3), ok)},
    {id: "askCoins", group: questions, label: label("askCoins"),
      open: () => question("askCoins", () => t("SLL.Stash.addFund"), () => coinsContent({note: true}), ok)},
    {id: "askCoinsByCoin", group: questions, label: label("askCoinsByCoin"),
      open: () => question("askCoinsByCoin", () => t("SLL.Pool.addCoins"), () => coinsContent({byCoin: true}), ok)},
    {id: "askSplit", group: questions, label: label("askSplit"),
      open: () => question("askSplit", () => t("SLL.Dialog.splitTitle"), () => splitContent(members(), true),
        () => t("SLL.Dialog.split"))},
    {id: "askCoinValues", group: questions, label: label("askCoinValues"),
      open: () => question("askCoinValues", () => t("SLL.SETTINGS.coinValues.name"), () => {
        const gp = goldValue();
        const system = [{key: "gp", abbr: "gp", value: gp}, {key: "sp", abbr: "sp", value: Math.max(gp / 10, 1)},
          {key: "cp", abbr: "cp", value: 1}];
        return coinValuesContent(system, new Map(system.map(d => [d.key, d.value])));
      }, ok)},
    {id: "askCover", group: questions, label: label("askCover"),
      open: () => question("askCover", () => t("SLL.Cover.title"), () => coverContent(L("amulet"),
        {name: L("amuletCovered"), img: "", description: L("coverText"), dc: 15}, "SLL.Cover.modeSwap"),
      () => t("SLL.Cover.confirm"), 460)},
    {id: "collect", group: questions, label: label("collect"),
      open: () => question("collect", () => t("SLL.Collect.title"), () => {
        const d = data();
        const sections = [
          collectSection(L("troll"), 0, [{id: "c1", name: L("potion"), img: d.pool[0].img, quantity: 2, covered: false},
            {id: "c2", name: L("gem"), img: d.pool[5].img, quantity: 1, covered: false}], 40 * goldValue()),
          collectSection(`${L("bandit")} 1`, 1, [{id: "c3", name: L("blade"), img: d.pool[2].img, quantity: 1, covered: false},
            {id: "c4", name: L("amuletCovered"), img: d.pool[3].img, quantity: 1, covered: true}], 12 * goldValue())
        ];
        return collectContent(sections, true);
      }, () => t("SLL.Collect.take"), 480)},
    {id: "piles", group: questions, label: label("piles"),
      open: () => question("piles", () => t("SLL.Piles.title"), () => {
        const d = data();
        return pilesContent([pileSection(L("pile"), 0, [{id: "k1", name: L("scroll"), img: d.pool[4].img, quantity: 2},
          {id: "k2", name: L("rope"), img: d.stash[0].img, quantity: 1}], 25 * goldValue(), ["+ 3 " + L("gems")])], true);
      }, () => t("SLL.Collect.take"), 480)},
    {id: "confirms", group: questions, label: label("confirms"),
      open: () => openSampleHtml({moduleId: MODULE_ID, id: "confirms", title: label("confirms"), width: 460, body: () => [
        [t("SLL.Pool.distribute"), t("SLL.Pool.distributeConfirm.fair")],
        [t("SLL.Pool.distribute"), t("SLL.Pool.distributeConfirm.roll")],
        [t("SLL.Pool.distribute"), t("SLL.Pool.distributeConfirm.gm")],
        [t("SLL.Pool.remove"), t("SLL.Pool.removeConfirm", {name: L("potion")})],
        [t("SLL.Cover.reveal"), t("SLL.Cover.revealConfirm", {name: L("amuletCovered")})],
        [t("SLL.Log.undoTitle"), t("SLL.Log.undoConfirm")],
        [t("SLL.Piles.drop"), t("SLL.Piles.dropConfirm")]
      ].map(([title, text]) => `<h4 style="margin:6px 0 2px">${esc(title)}</h4><p style="margin:0 0 6px">${esc(text)}</p>`).join("")})},

    {id: "cardEntries", group: cards, label: label("cardEntries"),
      open: () => card("cardEntries", () => label("cardEntries"), () => {
        const d = data();
        const log = d.log;
        return entriesBody([log[2], log[3], log[9], log[11]], new Map(log.map(e => [e.id, e])));
      })},
    {id: "cardRolls", group: cards, label: label("cardRolls"),
      open: () => card("cardRolls", () => label("cardRolls"), () => {
        const [ari, mira, tovin] = members();
        return rollsBody([
          {item: L("potion"), winner: ari.name, reason: "", rolls: [{name: ari.name, value: 17}, {name: tovin.name, value: 9}]},
          {item: L("ring"), winner: mira.name, reason: "", rolls: [{name: mira.name, value: 14}, {name: tovin.name, value: 14}]}
        ]);
      })},
    {id: "cardApproval", group: cards, label: label("cardApproval"),
      open: () => card("cardApproval", () => label("cardApproval"), () => {
        const [withdraw] = data().pending;
        return approvalBody({id: withdraw.id, label: t("SLL.Pending.withdraw", {actor: withdraw.actorName, what: withdraw.what})},
          members()[2].player);
      }, {kind: "approval", pending: "r1"})},
    {id: "cardOffer", group: cards, label: label("cardOffer"),
      open: () => card("cardOffer", () => label("cardOffer"), () => {
        const [, offer] = data().pending;
        return offerBody({id: offer.id, label: t("SLL.Pending.offer", {from: offer.from, to: offer.to, what: offer.what})});
      }, {kind: "offer", pending: "r2"})},
    {id: "cardAnswered", group: cards, label: label("cardAnswered"),
      open: () => card("cardAnswered", () => label("cardAnswered"), () => {
        const [, offer] = data().pending;
        return offerBody({id: offer.id, label: t("SLL.Pending.offer", {from: offer.from, to: offer.to, what: offer.what})});
      }, {kind: "offer", pending: "r2", resolved: t("SLL.Card.accepted", {name: members()[1].name})})},
    {id: "cardSelfTest", group: cards, label: label("cardSelfTest"),
      open: () => card("cardSelfTest", () => label("cardSelfTest"), () => selfTestBody(
        t("SLL.SELFTEST.Passed", {checks: 14, system: adapter().id}), "core 14.370, dnd5e 6.1.0", []))},
    {id: "cardSelfTestProblems", group: cards, label: label("cardSelfTestProblems"),
      open: () => card("cardSelfTestProblems", () => label("cardSelfTestProblems"), () => selfTestBody(
        t("SLL.SELFTEST.Problems", {problems: 2, checks: 14}), "core 14.370, dnd5e 6.1.0",
        [L("problemOne"), L("problemTwo")]))}
  ];
}
