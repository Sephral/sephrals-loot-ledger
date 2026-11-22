// The made-up party loot of the sample windows (api.samples, see samples.mjs): pure data, no Foundry. Values are in
// gold and turned into base units by the caller (`gold` = base units of one gold coin), texts come from `L(key)` so
// they follow the language. The log is sealed with the real chain, so the sample log checks out like a real one.
import {seal} from "./chain.mjs";

const HOUR = 60 * 60 * 1000;

/** Pictures that ship with Foundry (v13 and v14). */
export const IMG = {
  potion: "icons/consumables/potions/bottle-bulb-corked-glowing-red.webp",
  rope: "icons/sundries/survival/rope-coiled-brown.webp",
  ring: "icons/equipment/finger/ring-ball-gold.webp",
  gem: "icons/commodities/gems/gem-cluster-blue-white.webp",
  blade: "icons/weapons/swords/greatsword-crossguard-steel.webp",
  scroll: "icons/sundries/scrolls/scroll-bound-red.webp",
  shield: "icons/equipment/shield/buckler-boss-iron-wood-brown.webp",
  amulet: "icons/equipment/neck/amulet-carved-stone-bottle.webp",
  lockpicks: "icons/tools/hand/lockpicks-steel-grey.webp",
  book: "icons/sundries/books/book-red-exclamation.webp",
  shovel: "icons/tools/hand/shovel-spade-steel-grey.webp",
  bow: "icons/weapons/bows/shortbow-recurve.webp",
  pack: "icons/containers/bags/pack-leather-brown.webp",
  coin: "icons/commodities/currency/coin-embossed-crown-gold.webp",
  mask: "icons/svg/mystery-man.svg"
};

/** The party of the samples: the shared cast's heroes with the id the sample rows use. */
export function sampleMembers(cast) {
  return cast.filter(c => c.side === "party").map(c => ({id: c.id, name: c.name, img: c.img, player: c.player}));
}

/**
 * The items, claims, coins, log, requests and wishes of the samples.
 * @param {(key: string) => string} L          Text of the sample items and places
 * @param {{gold?: number, now?: number, cast: object[]}} options
 */
export function sampleLedger(L, {gold = 100, now = Date.now(), cast}) {
  const members = sampleMembers(cast);
  const [ari, mira, tovin, sela] = members;
  const item = (id, key, img, quantity, each, extra = {}) => ({id, name: L(key), img, quantity, each: each * gold,
    value: each * gold * quantity, ...extra});

  const pool = [
    item("p1", "potion", IMG.potion, 3, 50, {claims: {[ari.id]: "need", [mira.id]: "want", [tovin.id]: "need", [sela.id]: "pass"}}),
    item("p2", "ring", IMG.ring, 1, 600, {claims: {[mira.id]: "need", [sela.id]: "want"}, wishers: [{user: mira.player, key: "wishRing"}]}),
    item("p3", "blade", IMG.blade, 1, 150, {claims: {[ari.id]: "want"}, heavy: true}),
    item("p4", "amuletCovered", IMG.mask, 1, 0, {covered: true, realName: L("amulet"), dc: 15, claims: {}}),
    item("p5", "scroll", IMG.scroll, 2, 75, {claims: {}}),
    item("p6", "gem", IMG.gem, 4, 100, {claims: {[sela.id]: "pass"}})
  ];

  const stash = [
    item("s1", "rope", IMG.rope, 2, 1, {from: {kind: "pool"}, ago: 30}),
    item("s2", "lockpicks", IMG.lockpicks, 1, 25, {from: {kind: "actor", name: tovin.name}, ago: 52}),
    item("s3", "shovel", IMG.shovel, 1, 2, {from: {kind: "outside", name: L("place")}, ago: 74}),
    item("s4", "book", IMG.book, 1, 250, {from: {kind: "pool"}, ago: 8}),
    item("s5", "pack", IMG.pack, 1, 5, {contents: [`${L("rope")} × 2`, L("shovel")], ago: 100}),
    item("s6", "shield", IMG.shield, 1, 10, {from: {kind: "pool"}, ago: 20})
  ];

  const mine = {
    [ari.id]: [item("m1", "potion", IMG.potion, 2, 50), item("m2", "blade", IMG.blade, 1, 150),
      item("m3", "bow", IMG.bow, 1, 25), item("m4", "amuletCursed", IMG.amulet, 1, 5, {blocked: "SLL.Block.cursed"})],
    [mira.id]: [item("m5", "scroll", IMG.scroll, 3, 75), item("m6", "book", IMG.book, 1, 250)],
    [tovin.id]: [item("m7", "shield", IMG.shield, 1, 10), item("m8", "potion", IMG.potion, 1, 50)],
    [sela.id]: [item("m9", "bow", IMG.bow, 1, 25), item("m10", "lockpicks", IMG.lockpicks, 1, 25)]
  };

  const coins = {pool: 120 * gold, fund: 480 * gold, purse: {[ari.id]: 85 * gold, [mira.id]: 40 * gold,
    [tovin.id]: 62 * gold, [sela.id]: 110 * gold}};

  // The log, oldest first, chained like the real one
  const where = {
    pool: {kind: "pool"}, stash: {kind: "stash"}, fund: {kind: "fund"}, outside: {kind: "outside", name: L("place")},
    actor: m => ({kind: "actor", id: m.id, name: m.name})
  };
  const logItem = (it, quantity = it.quantity) => ({name: it.name, img: it.img, quantity, value: it.each * quantity});
  const gm = L("gm");
  const spec = [
    {kind: "add", from: where.outside, to: where.pool, item: logItem(pool[0]), user: gm, ago: 70},
    {kind: "add", from: where.outside, to: where.pool, coins: 120 * gold, user: gm, ago: 69},
    {kind: "award", from: where.pool, to: where.actor(ari), item: logItem(pool[2], 1), user: gm, ago: 66, note: L("reasonStrongest")},
    {kind: "split", from: where.pool, to: where.actor(mira), coins: 30 * gold, user: gm, ago: 60},
    {kind: "deposit", from: where.actor(tovin), to: where.stash, item: logItem(stash[1]), user: tovin.player, ago: 52},
    {kind: "deposit", from: where.actor(sela), to: where.fund, coins: 50 * gold, user: sela.player, ago: 40},
    {kind: "give", from: where.actor(ari), to: where.actor(mira), item: logItem(mine[ari.id][0], 1), user: ari.player, ago: 34},
    {kind: "withdraw", from: where.stash, to: where.actor(sela), item: logItem(stash[0], 1), user: sela.player, ago: 30},
    {kind: "spend", from: where.fund, to: where.outside, coins: 25 * gold, user: gm, ago: 26, note: L("noteInn")},
    {kind: "sale", from: where.stash, to: where.outside, item: logItem(stash[2]), user: gm, ago: 22, ref: {merchant: L("merchant")}},
    {kind: "sale", from: where.outside, to: where.fund, coins: 1 * gold, user: gm, ago: 22, ref: {merchant: L("merchant")}},
    {kind: "reveal", from: where.stash, to: where.stash, item: logItem(pool[3], 1), user: gm, ago: 18, note: L("amuletCovered")},
    {kind: "move", from: where.pool, to: where.stash, item: logItem(stash[3]), user: gm, ago: 8},
    {kind: "remove", from: where.pool, to: where.outside, item: logItem(pool[4], 1), user: gm, ago: 6},
    {kind: "edit", from: where.stash, to: where.stash, item: {...logItem(stash[0], 3), name: stash[0].name}, user: gm, ago: 4,
      ref: {before: 2}},
    {kind: "edit", from: where.outside, to: where.stash, item: logItem(stash[5], 1), user: gm, ago: 3}
  ];
  const log = [];
  let previous = "";
  spec.forEach((s, index) => {
    const {ago, ...rest} = s;
    const entry = seal({id: `e${index + 1}`, seq: index + 1, time: now - ago * HOUR, user: rest.user, userName: rest.user,
      kind: rest.kind, from: rest.from, to: rest.to, item: rest.item ?? null, coins: rest.coins ?? 0, note: rest.note ?? "",
      undoes: null, ref: rest.ref ?? {}}, previous);
    log.push(entry);
    previous = entry.hash;
  });
  // The party fund payment is taken back
  const undo = seal({id: `e${log.length + 1}`, seq: log.length + 1, time: now - 2 * HOUR, user: gm, userName: gm, kind: "undo",
    from: where.outside, to: where.outside, item: null, coins: 0, note: "", undoes: "e9", ref: {}}, previous);
  log.push(undo);

  const pending = [
    {id: "r1", type: "withdraw", asker: tovin.name, actorName: tovin.name, what: `2× ${L("potion")}`},
    {id: "r2", type: "offer", asker: ari.name, from: ari.name, to: mira.name, what: `1× ${L("blade")}`, toId: mira.id}
  ];

  const wishes = {
    mine: [{id: "w1", text: L("wishHealing"), found: [L("potion")], link: false},
      {id: "w2", text: L("ring"), found: [L("ring")], link: true, img: IMG.ring},
      {id: "w3", text: L("wishBoots"), found: [], link: false}],
    others: [
      {name: ari.player, color: "#c0392b", wishes: [{id: "w4", text: L("wishHealing"), found: [L("potion")]},
        {id: "w5", text: L("blade"), found: [L("blade")], link: true, img: IMG.blade}]},
      {name: mira.player, color: "#2e86c1", wishes: [{id: "w6", text: L("wishRing"), found: [L("ring")]}]}
    ]
  };

  // A drawn table for the loot window: item, formula, coins, plain text, nested table, a broken formula, one left out
  const table = [
    {id: "t1", kind: "item", name: L("potion"), img: IMG.potion, quantity: 2, coins: 0, formula: "1d3", invalid: false,
      tableUuid: "", depth: 0, include: true},
    {id: "t2", kind: "coins", name: "3d6 gp", img: "", quantity: 0, coins: 11 * gold, formula: "", invalid: false,
      tableUuid: "", depth: 0, include: true},
    {id: "t3", kind: "item", name: L("gem"), img: IMG.gem, quantity: 1, coins: 0, formula: "", invalid: false,
      tableUuid: "Sample.RollTable.gems", depth: 1, include: true},
    {id: "t4", kind: "item", name: L("scroll"), img: IMG.scroll, quantity: 1, coins: 0, formula: "2d", invalid: true,
      tableUuid: "", depth: 0, include: true},
    {id: "t5", kind: "text", name: L("tableText"), img: "", quantity: 0, coins: 0, formula: "", invalid: false,
      tableUuid: "", depth: 0, include: false},
    {id: "t6", kind: "item", name: L("rope"), img: IMG.rope, quantity: 0, coins: 0, formula: "1d4-1", invalid: false,
      tableUuid: "", depth: 0, include: false}
  ];

  return {members, pool, stash, mine, coins, log, pending, wishes, table};
}

export const __test__ = {HOUR};
