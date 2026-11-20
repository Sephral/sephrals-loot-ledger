import assert from "node:assert/strict";
import test from "node:test";
import {MAX_TEXT, cleanWishes, findMatches, freshMatches, hasWish, keysOfUser, makeWish, matchKey, matchesWish, normalize}
  from "../scripts/wish-logic.mjs";

const wish = (text, extra = {}) => ({id: `w-${text}`, text, ...extra});

test("names are compared without case, accents and extra spaces", () => {
  assert.equal(normalize("  Potion   of  HEALING "), "potion of healing");
  assert.equal(normalize("Café Ärger"), "cafe arger");
  assert.equal(normalize(null), "");
});

test("a wish needs two letters and is cut at the limit", () => {
  assert.equal(makeWish({text: " a "}, "x"), null);
  assert.equal(makeWish({text: ""}, "x"), null);
  const long = makeWish({text: "x".repeat(200)}, "x", 5);
  assert.equal(long.text.length, MAX_TEXT);
  assert.deepEqual(makeWish({text: "Healing", uuid: "Compendium.a.b.Item.c", img: "i.png"}, "id", 7),
    {id: "id", text: "Healing", added: 7, uuid: "Compendium.a.b.Item.c", img: "i.png"});
});

test("stored lists are cleaned: no broken entries, no double ids", () => {
  const list = cleanWishes([wish("Heal"), {id: 5, text: "x"}, wish("Heal"), null, {id: "a", text: "q"}, wish("Rope")]);
  assert.deepEqual(list.map(w => w.text), ["Heal", "Rope"]);
  assert.deepEqual(cleanWishes("nope"), []);
  assert.equal(cleanWishes(Array.from({length: 50}, (_, i) => ({id: `i${i}`, text: `wish ${i}`}))).length, 30);
});

test("the same text or link is not added twice", () => {
  const list = [wish("Healing"), wish("Sword", {uuid: "u1"})];
  assert.equal(hasWish(list, {text: "  healing "}), true);
  assert.equal(hasWish(list, {text: "Other name", uuid: "u1"}), true);
  assert.equal(hasWish(list, {text: "Sword"}), false);
  assert.equal(hasWish(list, {text: "Rope"}), false);
});

test("a text matches partial words in any case, several words in any order", () => {
  const name = {name: "Potion of Greater Healing"};
  assert.equal(matchesWish(wish("heal"), name), true);
  assert.equal(matchesWish(wish("HEALING"), name), true);
  assert.equal(matchesWish(wish("greater potion"), name), true);
  assert.equal(matchesWish(wish("greater sword"), name), false);
  assert.equal(matchesWish(wish("rope"), name), false);
  assert.equal(matchesWish(wish("x"), name), false);
  assert.equal(matchesWish(wish("heal"), {name: ""}), false);
  assert.equal(matchesWish(wish("heil"), {name: "Großer Heiltrank"}), true);
});

test("a link matches its copies and the same name, a covered item only by its cover name", () => {
  const link = wish("Flame Tongue", {uuid: "Compendium.dnd5e.items.Item.ft"});
  assert.equal(matchesWish(link, {name: "Something else", sources: ["Compendium.dnd5e.items.Item.ft"]}), true);
  assert.equal(matchesWish(link, {name: "flame tongue"}), true);
  assert.equal(matchesWish(link, {name: "Flame Tongue Longsword"}), false);
  assert.equal(matchesWish(link, {name: "Unidentified Sword", covered: true, sources: ["Compendium.dnd5e.items.Item.ft"]}), false);
  assert.equal(matchesWish(link, {name: "Flame Tongue", covered: true}), true);
});

test("every match of every user is found, and each one is told only once", () => {
  const users = {anna: [wish("heal"), wish("rope")], ben: [wish("potion")], cleo: []};
  const target = {name: "Potion of Healing"};
  const matches = findMatches(users, target);
  assert.deepEqual(matches.map(m => m.key), [matchKey("anna", "w-heal"), matchKey("ben", "w-potion")]);
  assert.equal(freshMatches(matches, []).length, 2);
  const done = [matches[0].key];
  assert.deepEqual(freshMatches(matches, done).map(m => m.userId), ["ben"]);
  assert.deepEqual(freshMatches(matches, matches.map(m => m.key)), []);
  assert.deepEqual(keysOfUser([...done, matches[1].key], "ben"), [matches[1].key]);
  assert.deepEqual(keysOfUser(undefined, "ben"), []);
});
