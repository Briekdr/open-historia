/*! Open Historia — battlefields and fronts: air wings over the battlefield: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/air.test.js
//
// "Air units don't take part in front-line fighting currently: make them part
// of the actual battlefields."

import test from "node:test";
import assert from "node:assert/strict";

import { describeBattlefield } from "./brief.js";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "air" });
const fixed = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" });
const wing = (id, ownerCode, extra = {}) => ({ id, name: id, type: "air", ownerCode, strength: 100, lng: 21, lat: 51, ...extra });
const wings = (owner, count) => Array.from({ length: count }, (_, at) => wing(`${owner}-${at}`, owner));
const fight = (extra = {}) => {
  let last = null;
  const result = runFronts(frontInput(sheet(), {
    arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: () => 4, staffPolicy: fixed,
    watch: (seen) => { last = seen.holders; },
    ...extra,
  }));
  const aland = result.battlefields[0].sides.findIndex((members) => members[0] === "Aland");
  return { result, held: last.filter((holder) => holder === aland).length };
};

test("the side that holds the sky over a battlefield takes more ground; with the mechanic off wings do nothing", () => {
  const ground = fight();
  const aloft = fight({ mechanics: { air: true }, units: wings("Aland", 6) });
  assert.ok(aloft.held > ground.held, `${aloft.held} against ${ground.held}`);
  // The enemy's wings in the sky take it back.
  const contested = fight({ mechanics: { air: true }, units: [...wings("Aland", 6), ...wings("Borduria", 6).map((unit) => ({ ...unit, lng: 27 }))] });
  assert.ok(contested.held < aloft.held, `${contested.held} against ${aloft.held}`);
  // Off, the same wings are nothing.
  assert.equal(fight({ units: wings("Aland", 6) }).held, ground.held);
  // Nor before there were aircraft, nor for a country with no air arm.
  assert.equal(fight({ mechanics: { air: true }, units: wings("Aland", 6), era: 1 }).held, fight({ era: 1 }).held);
  assert.equal(fight({ mechanics: { air: true, military: true }, militaryOf: (name) => (name === "Aland" ? { air: 0 } : null), units: wings("Aland", 6) }).held,
    fight({ mechanics: { military: true }, militaryOf: (name) => (name === "Aland" ? { air: 0 } : null) }).held);
  // The story is told who held the sky.
  assert.match(describeBattlefield(aloft.result.battlefields[0]), /Air: Aland holds the sky \(6 wings against 0\)/);
});

test("a storm grounds the wings, and wings that flew come back worn, once a wing", () => {
  const stormy = fight({ mechanics: { air: true, weather: true }, steering: { weather: "storm" }, units: wings("Aland", 6) });
  const stormyBare = fight({ mechanics: { weather: true }, steering: { weather: "storm" } });
  assert.equal(stormy.held, stormyBare.held, "in a storm nobody flies");
  const flown = fight({ mechanics: { air: true }, units: wings("Aland", 2) });
  const changes = flown.result.unitChanges.filter((change) => change.unitId.startsWith("Aland-"));
  assert.deepEqual(changes.map((change) => change.unitId).sort(), ["Aland-0", "Aland-1"]);
  for (const change of changes) {
    assert.equal(change.committedTo, "");
    assert.ok(change.strength < 100 && change.strength > 50, String(change.strength));
  }
  assert.deepEqual(fight({ mechanics: { air: true }, units: wings("Aland", 2) }).result.unitChanges, flown.result.unitChanges, "the same run is the same war");
});
