/*! Open Historia — battlefields and fronts: where a side's new troops come in: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/deploy.test.js
//
// "make it so you can draw a line of where reinforcements are to get deployed
// in the war room"

import test from "node:test";
import assert from "node:assert/strict";

import { decodeTroops } from "./codec.js";
import { REINFORCE_ORDER } from "./constants.js";
import { deployLinesOf } from "./deploy.js";
import { runFronts } from "./engine.js";
import { projectorOf } from "./frame.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldForViewer } from "./view.js";
import { applyWarRoomOp, cleanWarRoomOp } from "./warRoomOps.js";

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 53, step: 1, stepLat: 0.5, key: "deploy" });
const run = (extra = {}) => runFronts(frontInput(sheet(), { days: 0, ...extra }));
const troopsAt = (record, side) => {
  const place = projectorOf(record.frame);
  return decodeTroops(record.troops[side]).map((troop) => ({ ...troop, lng: place.toLngLat(troop.x, troop.y)[0] }));
};
// A line drawn far back in Aland, from north to south.
const BACK = [[20.4, 52.7], [20.4, 50.3]];

test("a country's new troops come in on the line drawn for them, and on the front where none was drawn", () => {
  const [record] = run().battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  const drawn = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: BACK }, { player: "Aland", date: "2024-03-01" });
  assert.equal(drawn.error, undefined);
  assert.deepEqual(deployLinesOf(drawn.record, side).map((line) => line.country), ["Aland"]);
  const order = [{ day: 1, type: "order", battlefield: record.name, side: "Aland", order: REINFORCE_ORDER, sector: "all", count: 4, given: true, ref: 1 }];
  const before = troopsAt(record, side).length;
  const fresh = (result) => troopsAt(result.battlefields[0], side).slice(before);
  const onLine = fresh(run({ battlefields: [drawn.record], moments: order, days: 2 }));
  const onFront = fresh(run({ battlefields: [record], moments: order, days: 2 }));
  assert.equal(onLine.length, 4);
  assert.equal(onFront.length, 4);
  // (A day and a night have passed: they may have walked a little toward the front.)
  for (const troop of onLine) assert.ok(troop.lng < 21.5, `came in at ${troop.lng.toFixed(2)}, by the line at 20.4`);
  for (const troop of onFront) assert.ok(troop.lng > 22.5, `came in at ${troop.lng.toFixed(2)}, on the front at 24`);
  // The line is kept from run to run.
  const kept = run({ battlefields: [drawn.record], days: 2 }).battlefields[0];
  assert.deepEqual(deployLinesOf(kept, side).map((line) => line.country), ["Aland"]);
});

test("a deployment line is its side's own, and an empty way takes it off", () => {
  const [record] = run().battlefields;
  const side = record.sides.findIndex((members) => members.includes("Aland"));
  const drawn = applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: BACK }, { player: "Aland" }).record;
  assert.equal(deployLinesOf(battlefieldForViewer(drawn, "Borduria"), side).length, 0, "the other side is not sent it");
  assert.equal(deployLinesOf(battlefieldForViewer(drawn, "Aland"), side).length, 1);
  const off = applyWarRoomOp([drawn], { op: "deploy", battlefield: record.name, way: [] }, { player: "Aland" }).record;
  assert.equal(deployLinesOf(off, side).length, 0);
  assert.equal(off.brief.carry.deploy, undefined);
  // A line nowhere near the battlefield is refused; nobody draws one for a battlefield they are not on.
  assert.ok(applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: [[100, 10], [101, 10]] }, { player: "Aland" }).error);
  assert.ok(applyWarRoomOp([record], { op: "deploy", battlefield: record.name, way: BACK }, { player: "Neutralia" }).error);
  // It crosses to a host as a way and nothing else.
  assert.deepEqual(cleanWarRoomOp({ op: "deploy", battlefield: record.name, way: BACK, extra: 1 }), { op: "deploy", battlefield: record.name, way: BACK });
});
