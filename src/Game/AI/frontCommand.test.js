/*! Open Historia — who commands what, in a turn: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontCommand.test.js
//
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
//
// Three things a turn has to get right about command:
//   - what a person TYPES as an action is their order ("I withdraw my troops",
//     "north-west dig trenches, the south pushes for the city"): the story
//     writes it as their lines, and it is carried out in that very skip;
//   - on a side of several countries each commands its own, and an ally of a
//     player's does what the two agreed in their talks;
//   - a war between countries nobody plays is fought like any other.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeEvents } from "../../runtime/gameState.js";
import { decodeTroops } from "../../runtime/fronts/codec.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { projectorOf } from "../../runtime/fronts/frame.js";
import { syntheticMap } from "../../runtime/fronts/syntheticMap.js";
import { playerFronts } from "../GameUI/warRoomData.js";
import { actionsCommandTroops } from "./frontApply.js";
import { alliesRule, buildFrontsBlock } from "./frontPrompt.js";
import { runTurnFronts } from "./frontTurn.js";
import { bindFrontOrdersToEvents, screenFrontOrders } from "./nativeFrontLedger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

// Aland in the west (with Cisland, its ally, south of it) and Borduria all along their east.
const legend = { A: "Aland", C: "Cisland", B: "Borduria", N: "Neutralia", "~": null };
const cities = [
  { name: "Alba", lng: 21.5, lat: 51.5, capital: true },
  { name: "Brod", lng: 26.5, lat: 50.6, capital: true },
  { name: "Cis", lng: 21.5, lat: 50.4, capital: true },
];
const sheet = (layout = ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"]) => syntheticMap({ layout, legend, west: 20, north: 52, step: 1, stepLat: 0.5, cities, key: `command ${layout.join("")}` });
const polity = (name) => ({ code: name, name, aliases: [], color: "", note: "" });
const worldOn = (map, wars, extra = {}) => ({
  customRegions: true,
  regionOwnershipOverrides: Object.fromEntries(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  polityOverrides: Object.fromEntries(["Aland", "Borduria", "Cisland", "Neutralia"].map((name) => [name, polity(name)])),
  countryStats: { Aland: { population: { total: 2e6 } }, Borduria: { population: { total: 2e6 } }, Cisland: { population: { total: 1e6 } } },
  wars,
  battlefields: [],
  transports: [],
  units: [],
  ...extra,
});
const WAR = { id: "war-1", title: "The Border War", status: "active", sideA: ["Aland"], sideB: ["Borduria"], startedDate: "2024-02-01", lastUpdatedDate: "2024-02-01" };
const turn = (map, world, overrides = {}) => ({
  createFrontRun,
  world,
  events: [],
  frontOrders: [],
  warStages: [world.wars],
  map: { key: map.map.key, cities: map.map.cities, flat: false },
  baseOwners: new Map(map.regions.map((region) => [region.id, map.controllerOf(region.id)])),
  regionIds: map.regions.map((region) => region.id),
  arenas: new Map(),
  loadRegions: async () => map.regions,
  fromDate: "2024-03-01",
  toDate: "2024-03-11",
  seed: "campaign|2|2024-03-01",
  ...overrides,
});
const event = (id, date, extra = {}) => ({ id, date, title: `The ${id}`, description: "Orders go down the line.", source: "ai", impacts: {}, ...extra });
// A side's living troops with where they stand: [{ lng, lat, state }].
const troopsOf = (record, side) => {
  const { toLngLat } = projectorOf(record.frame);
  return decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0).map((troop) => {
    const [lng, lat] = toLngLat(troop.x, troop.y);
    return { lng, lat, state: troop.state, owner: troop.owner };
  });
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const STATE_DUG_IN = 4;

test("a turn whose actions command the player's troops is asked for without its period fought first", () => {
  const map = sheet();
  const game = { country: "Aland", gameDate: "2024-03-01" };
  const front = { name: "The Front", status: "active", sides: [["Aland"], ["Borduria"]] };
  const atWar = worldOn(map, [WAR], { battlefields: [front] });
  const action = (text, extra = {}) => ({ id: `a-${text.length}`, kind: "action", status: "planned", text, title: text.slice(0, 40), ...extra });
  const asks = (world, ...texts) => actionsCommandTroops({ world, game, actions: texts.map((text) => (typeof text === "string" ? action(text) : text)) });
  // What a person types to their troops.
  assert.equal(asks(atWar, "I withdraw my troops from Borduria."), true);
  assert.equal(asks(atWar, "Have the troops in the north west dig trenches and have the southern troops all push toward Brod."), true);
  assert.equal(asks(atWar, "Pull back to the river and hold the line there"), true);
  assert.equal(asks(atWar, "Launch a spring offensive"), true);
  // Naming the battlefield is enough, in whatever words.
  assert.equal(asks(atWar, "Sur The Front, on ne bouge plus."), true);
  // What has nothing to do with them, or is not waiting to be done, or is a chat.
  assert.equal(asks(atWar, "Raise the income tax to 20% and open talks with Neutralia."), false);
  assert.equal(asks(atWar, action("Withdraw my troops", { status: "done" })), false);
  assert.equal(asks(atWar, action("Withdraw my troops", { kind: "chat" })), false);
  assert.equal(asks(atWar), false);
  // At peace an order to attack begins a war, which is fought from its day; talk of troops alone is no order to any battlefield.
  const atPeace = worldOn(map, []);
  assert.equal(asks(atPeace, "Invade Borduria at dawn with everything we have."), true);
  assert.equal(asks(atPeace, "Parade the troops through Alba on the national day."), false);
  // A battlefield somebody else fights on is not the player's to order.
  const elsewhere = worldOn(map, [WAR], { battlefields: [{ ...front, sides: [["Cisland"], ["Borduria"]] }] });
  assert.equal(asks(elsewhere, "Reinforce the garrison of Alba."), false);
  // The skip reads it before it would fight the period.
  const skip = read("./gameplay.js");
  assert.match(skip, /const frontsForecast = actionsCommandTroops\(\{ world: bundle\.world, game: bundle\.game, actions: bundle\.actions \}\) \? null : await forecastTurnFronts\(\{/);
});

test("what a person types is written as their own order lines, which stand because the event carries their action out", async () => {
  // The story is told so, with the two examples a person is most likely to give.
  const block = buildFrontsBlock({ players: ["Aland"] });
  assert.match(block, /Aland is played by a person: write no order for it of your own\. But what that person tells its troops to do in an action of this turn IS its order, and you write it for them: a line for each stretch of line the action speaks of, with the sector and the objective it names, resting on the event that carries the action out/);
  assert.match(block, /`NAME~X~dig in~northwest~4` and `NAME~X~advance~south~4~city: Y`; to pull out is `NAME~X~withdraw~all~4`/);
  assert.match(block, /It is carried out from that event's date\./);
  assert.match(block, /\| fall back \| withdraw \| land\./);
  assert.match(block, /Troops told to withdraw leave the battlefield and go home: the ground stays whose it is/);

  const map = sheet();
  // (Aland is much the stronger: what it is told to do can be seen to happen within a turn.)
  const world = worldOn(map, [WAR], { countryStats: { Aland: { population: { total: 6e6 } }, Borduria: { population: { total: 5e5 } } } });
  // A war already being fought, both lines holding.
  const opened = await runTurnFronts(turn(map, world, { fromDate: "2024-02-20", toDate: "2024-03-01", seed: "campaign|1|2024-02-20" }));
  const [front] = opened.battlefields;
  const fighting = { ...world, battlefields: opened.battlefields };
  const before = troopsOf(front, 0);
  const northLine = mean(before.filter((troop) => troop.lat > 51.4).map((troop) => troop.lng));
  const southLine = mean(before.filter((troop) => troop.lat < 50.6).map((troop) => troop.lng));

  // The player typed: "north dig trenches; the south pushes for Brod." The story carries it out in event 1.
  const events = normalizeEvents([event("e1", "2024-03-03", { warId: "war-1", impacts: { actionIds: ["act-1"] } }), event("e2", "2024-03-07", { warId: "war-1" })]);
  const lines = [`${front.name}~Aland~dig in~north~1`, `${front.name}~Aland~advance~south~1~city: Brod`, `${front.name}~Aland~blitz~centre~2`];
  const citesOrderOf = (side, entry) => (entry?.impacts?.actionIds ?? []).includes("act-1") && side === "Aland";
  const { kept, dropped } = screenFrontOrders(bindFrontOrdersToEvents(lines, events), { events, humanSides: ["Aland"], citesOrderOf });
  // The two that rest on the event of the player's action are the player's; the one the story made up is not.
  assert.deepEqual(kept.map((entry) => [entry.order, entry.sector]), [["dig in", "north"], ["advance", "south"]]);
  assert.match(dropped[0].reason, /Aland is played by a person, and no order of theirs asks for this/);

  // Carried out in this very period, from the day of that event.
  const run = await runTurnFronts(turn(map, fighting, { events, frontOrders: kept, players: ["Aland"] }));
  const [after] = run.battlefields;
  assert.deepEqual(after.orders.map((entry) => [after.sides[entry.s][0], entry.sector, entry.order, entry.objective ?? "", entry.since]), [
    ["Aland", "north", "dig in", "", "2024-03-03"],
    ["Aland", "south", "advance", "city: Brod", "2024-03-03"],
  ]);
  const mine = troopsOf(after, 0);
  const north = mine.filter((troop) => troop.lat > 51.4);
  const south = mine.filter((troop) => troop.lat < 50.6);
  assert.ok(north.length > 0 && north.every((troop) => troop.state === STATE_DUG_IN), "the north has dug in where it stood");
  assert.ok(Math.abs(mean(north.map((troop) => troop.lng)) - northLine) < 0.1);
  assert.ok(mean(south.map((troop) => troop.lng)) > southLine + 0.15, "and the south has gone forward, toward Brod");

  // The turn after, the player types "I withdraw my troops": one line, and they are gone from it, the ground as it was.
  const next = { ...world, battlefields: run.battlefields };
  const leave = normalizeEvents([event("e3", "2024-03-12", { warId: "war-1", impacts: { actionIds: ["act-2"] } })]);
  const out = screenFrontOrders(bindFrontOrdersToEvents([`${front.name}~Aland~withdraw~all~1`], leave), { events: leave, humanSides: ["Aland"], citesOrderOf: () => true });
  assert.deepEqual(out.kept.map((entry) => entry.order), ["withdraw"]);
  const gone = await runTurnFronts(turn(map, next, { events: leave, frontOrders: out.kept, players: ["Aland"], fromDate: "2024-03-11", toDate: "2024-03-26", seed: "campaign|3|2024-03-11" }));
  assert.equal(troopsOf(gone.battlefields[0], 0).length, 0);
  assert.ok(troopsOf(gone.battlefields[0], 1).length > 0);
  assert.equal(gone.flips.some((flip) => flip.to === "Borduria"), false, "nothing is handed back");
  assert.ok(gone.news.some((entry) => entry.k === "withdrew" && entry.s === 0));
  // And the story of the period after is told that they went.
  const told = buildFrontsBlock({ battlefields: gone.battlefields, players: ["Aland"] });
  assert.match(told, /Aland has withdrawn its troops from here: the ground it holds is unguarded until it orders them back\./);
  assert.match(told, /Standing orders: Aland: all withdraw/);
});

test("an ally of a player's commands its own troops, and what the two agreed in their talks is what it does", async () => {
  const map = sheet(["AAAABBBB", "AAAABBBB", "CCCCBBBB", "CCCCBBBB"]);
  const coalition = [{ ...WAR, sideA: ["Aland", "Cisland"] }];
  const world = worldOn(map, coalition);
  const opened = await runTurnFronts(turn(map, world, { fromDate: "2024-02-20", toDate: "2024-03-01", seed: "campaign|1|2024-02-20", players: ["Aland"] }));
  const [front] = opened.battlefields;
  assert.deepEqual(front.sides, [["Aland", "Cisland"], ["Borduria"]]);
  // The story is told who the player's allies are, that their orders are its to write, and where a plan agreed in talks comes from.
  const block = buildFrontsBlock({ battlefields: opened.battlefields, players: ["Aland"] });
  assert.match(block, /On a side of several countries each commands its own troops: a line orders the troops of the country it names, and a line for a side's first country also orders any ally there that nobody plays and that has no line of its own\./);
  assert.match(block, new RegExp(`Allies of a player command their own troops, and their orders are yours to write: Cisland beside Aland on ${front.name}\\. Where such an ally and the player have agreed a plan in their talks \\(\\[Diplomatic Memory\\]\\), its orders carry that plan out, in the sector and at the time agreed\\.`));
  assert.match(block, /Strength: Aland \d+ formations \(\d+%\) \(Aland \d+, Cisland \d+\)/);
  // Nobody played, or no ally beside them: nothing is said of it.
  assert.equal(alliesRule(opened.battlefields, []), "");
  assert.equal(alliesRule(opened.battlefields, ["Borduria"]), "");
  assert.equal(alliesRule([{ ...front, status: "closed" }], ["Aland"]), "");
  // In a shared game where both are played, neither is the other's to write.
  assert.equal(alliesRule(opened.battlefields, ["Aland", "Cisland"]), "");

  // The story orders the ally (the player has asked it to push in the south): its troops go, the player's stay the player's.
  const fighting = { ...world, battlefields: opened.battlefields };
  const events = normalizeEvents([event("e1", "2024-03-02", { warId: "war-1" })]);
  const orders = screenFrontOrders(bindFrontOrdersToEvents([`${front.name}~Cisland~advance~all~1`, `${front.name}~Aland~advance~all~1`], events), { events, humanSides: ["Aland"] });
  assert.deepEqual(orders.kept.map((entry) => entry.side), ["Cisland"], "the ally's line stands; one made up for the player does not");
  const before = troopsOf(front, 0);
  const run = await runTurnFronts(turn(map, fighting, { events, frontOrders: orders.kept, players: ["Aland"] }));
  const after = troopsOf(run.battlefields[0], 0);
  const lng = (troops, owner) => mean(troops.filter((troop) => troop.owner === owner).map((troop) => troop.lng));
  assert.ok(lng(after, 1) > lng(before, 1) + 0.15, "Cisland's troops have advanced");
  assert.ok(Math.abs(lng(after, 0) - lng(before, 0)) < 0.08, "Aland's are where the player left them");
});

test("a war between countries nobody plays is fought in full: opened by the story, ordered on both sides, told to it, and on the map", async () => {
  // The player is Cisland, at peace in the south-west; Aland and Borduria go to war by the story's own choice.
  const map = sheet(["AAAABBBB", "AAAABBBB", "CCCC~~~~", "CCCC~~~~"]);
  const world = worldOn(map, [], { countryStats: { Aland: { population: { total: 3e6 } }, Borduria: { population: { total: 1e6 } }, Cisland: { population: { total: 1e6 } } } });
  const events = normalizeEvents([event("e1", "2024-03-02"), event("e2", "2024-03-06")]);
  // One line is enough to begin it: Aland attacks across their border. Borduria is told to dig in.
  const orders = screenFrontOrders(bindFrontOrdersToEvents(["border: Aland / Borduria~Aland~advance~all~1", "border: Aland / Borduria~Borduria~dig in~all~2"], events), { events, humanSides: ["Cisland"] });
  assert.equal(orders.dropped.length, 0, "neither is the player's: both lines stand");
  const run = await runTurnFronts(turn(map, world, { events, frontOrders: orders.kept, players: ["Cisland"], toDate: "2024-03-21" }));
  assert.deepEqual(run.starts.map((start) => [start.attacker, start.defender, start.date]), [["Aland", "Borduria", "2024-03-02"]]);
  const [field] = run.battlefields;
  assert.deepEqual([field.status, field.sides], ["active", [["Aland"], ["Borduria"]]]);
  assert.deepEqual(field.orders.map((entry) => [field.sides[entry.s][0], entry.order]), [["Aland", "advance"], ["Borduria", "dig in"]]);
  assert.ok(troopsOf(field, 0).length > 0 && troopsOf(field, 1).length > 0);
  // Ground changes hands on the turn's events, as on any battlefield.
  assert.ok(run.flips.length > 0, `${run.flips.length} regions changed hands`);
  assert.ok(run.events.some((entry) => (entry.impacts?.regionControlOps ?? []).some((op) => op.by === "front")));
  // The story is told to fight and tell such wars like any other.
  const block = buildFrontsBlock({ battlefields: run.battlefields, players: ["Cisland"] });
  assert.match(block, /Every war on the map is fought this way, between countries nobody plays as much as any other: when the story has two of them go to war, open it \(its warUpdates record, or an order to attack across their border\) and give each side its orders every period\./);
  assert.ok(block.includes(`- ${field.name}: Aland against Borduria`));
  // It is not the player's to command: the war room does not list it. The map draws every battlefield of the world.
  assert.equal(playerFronts(run.battlefields, "Cisland").length, 0);
  assert.equal(playerFronts(run.battlefields, "Aland").length, 1);
});
