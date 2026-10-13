/*! Open Historia — sea battles as the map marks them: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/seaBattleFeatures.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withTurnSeaBattles } from "../../runtime/naval/record.js";
import { MAP_LAYER_ORDER } from "./mapLayerOrder.js";
import { EMPTY_SEA_BATTLE_FEATURES, seaBattleFeatures, seaBattleTone } from "./seaBattleFeatures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8").split("\r\n").join("\n");

const battle = (extra = {}) => ({
  id: "sea:1914-08-12:0",
  date: "1914-08-12",
  place: "off Heligoland",
  lng: 5,
  lat: 52,
  warId: "war-1",
  sides: [["Albion", "Gallia"], ["Teutonia"]],
  fleets: [[{ name: "Grand Fleet", owner: "Albion", before: 100, after: 88 }], [{ name: "High Seas Fleet", owner: "Teutonia", before: 70, after: 41, broke: true }]],
  winner: 0,
  ...extra,
});

test("a battle is a point where it was fought, with who fought it and when, in the colour of how it went for the player", () => {
  const kept = withTurnSeaBattles([], [battle()], 4);
  const { features } = seaBattleFeatures({ battles: kept, viewer: "Albion" });
  assert.deepEqual(features, [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [5, 52] },
    properties: { id: "sea:1914-08-12:0", tone: "own", label: "Albion, Gallia – Teutonia\n1914-08-12", fresh: true },
  }]);
  // To the other side it was a defeat; to an ally a victory; to anyone else, and where neither had the better of it, neither.
  assert.equal(seaBattleTone(battle(), "Teutonia"), "enemy");
  assert.equal(seaBattleTone(battle(), "gallia"), "own");
  assert.equal(seaBattleTone(battle(), "Neutralia"), "other");
  assert.equal(seaBattleTone(battle(), ""), "other");
  assert.equal(seaBattleTone(battle({ winner: -1 }), "Albion"), "other");
  assert.equal(seaBattleTone(battle({ winner: 1 }), "Albion"), "enemy");
});

test("the newest turn's battles stand out, the turn before's are fainter, and a record with no place is not drawn", () => {
  const first = withTurnSeaBattles([], [battle()], 4);
  const both = withTurnSeaBattles(first, [battle({ id: "sea:1914-09-02:0", date: "1914-09-02", lng: 4, lat: 53 })], 5);
  assert.deepEqual(seaBattleFeatures({ battles: both, viewer: "Albion" }).features.map((feature) => [feature.properties.id, feature.properties.fresh]), [["sea:1914-08-12:0", false], ["sea:1914-09-02:0", true]]);
  assert.deepEqual(seaBattleFeatures({ battles: [{ id: "x" }, null, { id: "", lng: 1, lat: 1 }] }).features, []);
  assert.deepEqual(seaBattleFeatures().features, []);
  assert.deepEqual(EMPTY_SEA_BATTLE_FEATURES.features, []);
});

test("its layers are in the map's order, under the fleets' own counters, and the scene mounts it", () => {
  const index = (id) => MAP_LAYER_ORDER.indexOf(id);
  const layers = ["seabattles-ring", "seabattles-mark", "seabattles-label"];
  for (const id of layers) assert.ok(index(id) >= 0, `${id} is missing from the map's order`);
  assert.deepEqual([...layers].sort((a, b) => index(a) - index(b)), layers);
  assert.ok(index("seabattles-ring") > index("transports-lost"));
  assert.ok(index("seabattles-label") < index("units-fill"), "under the world's own formations");
  const component = read("SeaBattleLayers.jsx");
  assert.deepEqual([...component.matchAll(/id="(seabattles-[a-z-]+)"/g)].map((match) => match[1]), layers, "every layer it declares is in the order, and no other");
  assert.ok(read("MapScene.jsx").includes("<StrikeLayers />\n      <SeaBattleLayers />"));
  // Flat colour: the map's own three tones and no gradient.
  assert.equal(component.toLowerCase().includes("gradient"), false);
  assert.ok(component.includes("TRANSPORT_TONES.own") && component.includes("TRANSPORT_TONES.enemy") && component.includes("TRANSPORT_TONES.other"));
});
