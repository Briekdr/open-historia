/*! Open Historia — battlefields and fronts: one day on one battlefield © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A day, in order:
//
//   the line is traced and measured, and today's orders are read against it
//   every troop is read against the line: where its lane is, where it should be
//   who attacks today, and who steps forward
//   the moves that are not a step forward: drifting along the lane to mass,
//   walking up from a long way back, falling back
//   the troops that step forward do so, and take the ground they walk through
//   an enclosed patch too small to be a pocket is filled
//   the cells behind the moved line are given their true distances again
//   the day's losses are counted, works are dug, reserves come up
//   pockets grow a day older, and give up when their time has come
//   every third day, supply is worked out again
//   a region mostly in the other side's hands changes hands
//   the frame grows if the line has come near its edge
//   the day is handed to the recorder, to be played back on the map
//
// Nothing a day does looks ahead: the state after day k is the same whether
// the run stops there or goes on, which is what lets a player break into a
// turn half way through it.
//
// WHO GOES WHERE each day is decided in four places and nowhere else:
// planLanes and settle (troops.js), decideTasks and steer (combat.js).
// stepForward only carries out what they decided.

import { arenaFor } from "./arena.js";
import {
  CAPTOR_WITHIN_KM,
  FLIP_AT,
  GROW_KM,
  GROW_WITHIN_CELLS,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  MAX_CELLS,
  MAX_GRID_SPAN,
  MIN_DAYS_BETWEEN_FLIPS,
} from "./constants.js";
import { paintGround, readRegions, sideOfName } from "./battle.js";
import { closeDay, decideTasks, steer, stepForward } from "./combat.js";
import { countHolders, redistance, resampleField, traceContour } from "./field.js";
import { createFrame, frameBounds, latToY, projectorOf, yToLat } from "./frame.js";
import { measureLine } from "./line.js";
import { ageOrders, readOrders } from "./orders.js";
import { createReplayRecorder } from "./replay.js";
import { readSectors } from "./sectors.js";
import { agePockets, fillPatches, markPockets, markSupply, refreshSupply } from "./supply.js";
import { drawTraits, isLive, liveCount, planLanes, settle } from "./troops.js";

// What a run throws, and catches, when it needs the map's shapes and was not
// given them: the caller is told, and runs again with the regions.
export const REGIONS_NEEDED = Symbol("the map's regions are needed");

// A recorder for a battle from now on. The members it is told of are those
// the battle has, in the order the troops' owners and the painted ground
// count them.
export const startRecorder = (battle) => {
  battle.recorder = createReplayRecorder({ sides: battle.sides, cols: battle.frame.cols, rows: battle.frame.rows });
};

// The line, its sectors, the orders as they read today and where every troop
// stands against the line. Worked out again only when the line, the orders or
// the troops changed.
export const prepare = (battle, day) => {
  const contour = traceContour(battle.field);
  const line = measureLine(battle.field, contour);
  if (battle.sectorsFor !== contour) {
    battle.sectors = readSectors(line);
    battle.sectorsFor = contour;
  }
  battle.lineKm = line.total;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    battle.troops[side].forEach((troop, index) => {
      if (!troop.drawn) drawTraits(troop, battle.seed, battle.name, side, index, battle.even);
    });
  }
  const key = [battle.field.edits, battle.ordersChanged, battle.troops[0].length, liveCount(battle.troops[0]), battle.troops[1].length, liveCount(battle.troops[1]), day].join("|");
  if (battle.planKey !== key || !battle.plans) {
    readOrders(battle, line, battle.sectors);
    battle.plans = [planLanes(battle, HOLDER_SIDE_A, line, battle.views[0]), planLanes(battle, HOLDER_SIDE_B, line, battle.views[1])];
    battle.planKey = key;
  }
  return { day, line, sectors: battle.sectors };
};

// ---- regions changing hands ----------------------------------------------------

// Which member of a side takes a region it has captured: its lawful sovereign
// if that country is on the side; else the ally with the most troops near it;
// else the side's first member.
const captorOf = (battle, run, region, side) => {
  const { arena, place } = battle;
  const sovereign = String(run.sovereignOf(arena.ids[region]) ?? "").trim().toLowerCase();
  const lawful = battle.sides[side].findIndex((member, index) => !battle.gone[side].has(index) && member.toLowerCase() === sovereign);
  if (lawful >= 0) return battle.sides[side][lawful];
  const near = new Float64Array(battle.sides[side].length);
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || battle.gone[side].has(troop.owner)) continue;
    const dx = troop.x - arena.centreX[region];
    const dy = troop.y - arena.centreY[region];
    if (Math.sqrt(dx * dx + dy * dy) * place.kmAt(troop.y) <= CAPTOR_WITHIN_KM) near[troop.owner] += troop.strength;
  }
  let best = -1;
  for (let index = 0; index < near.length; index += 1) {
    if (battle.gone[side].has(index)) continue;
    if (best < 0 || near[index] > near[best]) best = index;
  }
  return best >= 0 ? battle.sides[side][best] : "";
};

// A region the side that does not control it holds six tenths of changes
// hands: reported as a flip for the game to apply, and taken as done here.
// Cells of the region outside the frame count for whoever controls it. A city
// whose cell changed holder goes to the log.
export const settleRegions = (battle, run, day) => {
  const { field, arena } = battle;
  if (battle.settledTurns === field.turns) return;
  battle.settledTurns = field.turns;
  const date = run.dateOf(day);
  arena.cities.forEach((city, index) => {
    const holder = field.holders[city.cell];
    const before = battle.cityHolder[index];
    battle.cityHolder[index] = holder;
    if (holder === before || (holder !== HOLDER_SIDE_A && holder !== HOLDER_SIDE_B) || (before !== HOLDER_SIDE_A && before !== HOLDER_SIDE_B)) return;
    battle.log.push({ d: date, k: "city", s: holder, at: `city: ${city.name}` });
    battle.citiesTaken[holder].push(city.name);
  });

  const held = [new Int32Array(arena.ids.length), new Int32Array(arena.ids.length)];
  for (let index = 0; index < field.size; index += 1) {
    const holder = field.holders[index];
    if (holder === HOLDER_SIDE_A || holder === HOLDER_SIDE_B) held[holder][arena.region[index]] += 1;
  }
  for (let region = 1; region < arena.ids.length; region += 1) {
    const owner = battle.regionSide[region];
    if (owner < 0 || run.braked || day - battle.lastFlip[region] < MIN_DAYS_BETWEEN_FLIPS) continue;
    const taker = 1 - owner;
    if (held[taker][region] / (arena.cells[region] + arena.outside[region]) < FLIP_AT) continue;
    const id = arena.ids[region];
    const captor = captorOf(battle, run, region, taker);
    if (!captor) continue;
    const group = run.groupOf(id);
    const controller = run.controllerOf(id);
    const flip = { day, date, battlefield: battle, regionId: id };
    if (run.isGroup(captor)) {
      // A group holds an area without owning it.
      run.flips.push({ ...flip, from: group && sideOfName(battle, group) === owner ? group : controller, to: captor, kind: "groupTake" });
      run.setGroup(id, captor);
    } else {
      if (group && sideOfName(battle, group) === owner) {
        run.flips.push({ ...flip, from: group, to: captor, kind: "groupRelease" });
        run.setGroup(id, "");
      }
      if (sideOfName(battle, controller) !== taker) {
        run.flips.push({ ...flip, from: controller, to: captor, kind: "control" });
        run.setController(id, captor);
      }
    }
    battle.lastFlip[region] = day;
    // A region with no name of its own is known only by its id, which no reader is shown.
    if (arena.names[region] !== id) battle.taken[taker].push(arena.names[region]);
    run.regionChanged(id);
    run.spendFlip();
  }
};

// ---- the frame growing ---------------------------------------------------------

// Which edges of the frame the line has come near, with ground in play at the
// edge beside it: [west, south, east, north], or null.
const edgesToGrow = (battle) => {
  const { field } = battle;
  const { cols, rows, play } = field;
  const contour = traceContour(field);
  const grow = [false, false, false, false];
  const landBy = (from, to, at, upright) => {
    for (let step = Math.max(0, Math.floor(from)); step <= Math.min((upright ? rows : cols) - 1, Math.floor(to)); step += 1) {
      if (play[upright ? step * cols + at : at * cols + step]) return true;
    }
    return false;
  };
  for (let vertex = 0; vertex < contour.x.length; vertex += 1) {
    const x = contour.x[vertex];
    const y = contour.y[vertex];
    const span = GROW_WITHIN_CELLS + 2;
    if (!grow[0] && x < GROW_WITHIN_CELLS && landBy(y - span, y + span, 0, true)) grow[0] = true;
    if (!grow[2] && x > cols - GROW_WITHIN_CELLS && landBy(y - span, y + span, cols - 1, true)) grow[2] = true;
    if (!grow[1] && y < GROW_WITHIN_CELLS && landBy(x - span, x + span, 0, false)) grow[1] = true;
    if (!grow[3] && y > rows - GROW_WITHIN_CELLS && landBy(x - span, x + span, rows - 1, false)) grow[3] = true;
  }
  return grow.some(Boolean) ? grow : null;
};

// A larger frame for a battle: the same cells where the limits allow, so the
// line does not move at all; else a coarser grid over the wider box.
const largerFrame = (frame, grow, map) => {
  const more = Math.max(GROW_WITHIN_CELLS * 2, Math.round(GROW_KM / frame.km));
  const west = grow[0] ? more : 0;
  const south = grow[1] ? more : 0;
  const cols = frame.cols + west + (grow[2] ? more : 0);
  const rows = frame.rows + south + (grow[3] ? more : 0);
  const y0 = latToY(frame.lat0) - south * frame.cell;
  if (cols <= MAX_GRID_SPAN && rows <= MAX_GRID_SPAN && cols * rows <= MAX_CELLS && y0 > latToY(-85)) {
    return { ...frame, lng0: frame.lng0 - west * frame.cell, lat0: yToLat(y0), cols, rows };
  }
  const bounds = frameBounds(frame);
  const [, lowLat] = projectorOf(frame).toLngLat(0, -south);
  const [, highLat] = projectorOf(frame).toLngLat(0, rows - south);
  return createFrame(
    { west: bounds.west - west * frame.cell, east: bounds.west + (cols - west) * frame.cell, south: lowLat, north: highLat },
    { flat: map.flat === true, scale: map.scale },
  );
};

// Where a point of one frame lies in another on the same map.
const carrier = (from, to) => {
  const scale = from.cell / to.cell;
  const shiftX = (from.lng0 - to.lng0) / to.cell;
  const shiftY = (latToY(from.lat0) - latToY(to.lat0)) / to.cell;
  return (x, y) => [x * scale + shiftX, y * scale + shiftY];
};

// Grows a battle's frame when its line nears the edge and there is ground of
// either side beyond: the field and the troops are carried onto the larger
// frame, and the line stays where it was. The replay is cut on one grid, so it
// begins again from the day the frame grew. false when there was nothing to do.
export const growIfNeeded = (battle, run) => {
  if ((battle.grown ?? 0) >= 6) return false;
  const grow = edgesToGrow(battle);
  if (!grow) return false;
  const frame = largerFrame(battle.frame, grow, run.input.map);
  if (!frame || (frame.cols === battle.frame.cols && frame.rows === battle.frame.rows && frame.cell === battle.frame.cell)) return false;
  const arena = arenaFor(run.input.arenas, run.input.map, frame, run.input.regionTypes);
  if (!arena) throw REGIONS_NEEDED;
  const carry = carrier(battle.frame, frame);
  const old = battle.field;
  const before = { arena: battle.arena, lastFlip: battle.lastFlip, startPhi: battle.startPhi, pockets: battle.pockets };

  battle.grown = (battle.grown ?? 0) + 1;
  battle.frame = frame;
  battle.arena = arena;
  battle.place = projectorOf(frame);
  readRegions(battle, run);
  battle.field = resampleField(old, arena, battle.regionSide);
  // The field the run began with, on the new frame too.
  const began = resampleField({ ...old, phi: before.startPhi }, arena, battle.regionSide);
  battle.startPhi = began.phi;
  battle.startHolders = began.holders;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const troop of battle.troops[side]) {
      [troop.x, troop.y] = carry(troop.x, troop.y);
      troop.station = null;
    }
  }
  battle.anchors = battle.anchors.map((anchor) => {
    const [x, y] = carry(anchor.x, anchor.y);
    return { s: anchor.s, x, y };
  });
  battle.pockets = before.pockets.map((pocket) => {
    const [x, y] = carry((pocket.cell % old.cols) + 0.5, Math.floor(pocket.cell / old.cols) + 0.5);
    return { s: pocket.s, cell: Math.floor(y) * arena.cols + Math.floor(x), days: pocket.days, km2: pocket.km2 };
  });
  battle.pocketOf = null;
  battle.pocketTurns = -1;
  battle.supply = null;
  battle.supplyTurns = -1;
  battle.claims = { stamp: new Int32Array(arena.size), power: new Float32Array(arena.size), moment: 0 };
  battle.lastFlip = new Int32Array(arena.ids.length).fill(-1000000);
  for (let region = 1; region < before.arena.ids.length; region += 1) {
    const now = arena.indexOf.get(before.arena.ids[region]);
    if (now !== undefined) battle.lastFlip[now] = before.lastFlip[region];
  }
  battle.cityHolder = Int8Array.from(arena.cities, (city) => battle.field.holders[city.cell]);
  battle.settledTurns = -1;
  battle.plans = null;
  battle.planKey = "";
  battle.sectorsFor = null;
  paintGround(battle, run);
  startRecorder(battle);
  return true;
};

// ---- the recorder --------------------------------------------------------------

// Hands the state at the end of a day to the recorder: every troop, and the
// ground cell by cell: who holds it, whose troops took it, whose home it is,
// and when in the day it changed hands. The map paints what a side holds away
// from home, and plays the colour spreading round each troop as it walks.
export const recordDay = (battle, day) => {
  const { field } = battle;
  const ground = { holders: field.holders, painters: field.painter, homes: battle.homes, when: field.when };
  battle.recorder.record(day, battle.troops, ground);
  battle.recorded = day;
  // For the rig, and for a test, to watch a run as the recorder is handed it.
  if (battle.watch) battle.watch({ battlefield: battle.name, day, troops: battle.troops, ...ground });
};

// ---- the day -------------------------------------------------------------------

// Simulates one day on a battle that is being fought. Returns how many
// sub-steps the fighting took.
export const simulateDay = (battle, run, day) => {
  const date = run.dateOf(day);
  const { line } = prepare(battle, day);
  if (line.count === 0) {
    // Nothing left to fight along: one side holds nothing here, or the two no longer touch.
    const held = countHolders(battle.field);
    battle.closing = held[0] === 0 || held[1] === 0 ? "taken" : "apart";
    return 0;
  }
  markPockets(battle);
  markSupply(battle);
  decideTasks(battle, run.braked);
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) settle(battle, side, battle.views[side], (troop) => troop.attacking, run.advanceKm, run.overlandKm);
  steer(battle, line, day, run.seed, run.steer);
  const steps = stepForward(battle, run.advanceKm, run.pace);
  fillPatches(battle, date);
  redistance(battle.field);
  closeDay(battle, date);
  if (agePockets(battle, date)) redistance(battle.field);
  ageOrders(battle);
  refreshSupply(battle, day, run.era);
  settleRegions(battle, run, day);
  growIfNeeded(battle, run);
  return steps;
};
