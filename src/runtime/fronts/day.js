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
//   a region all but held is finished off
//   every third day, supply is worked out again
//   a region more than six tenths in the other side's hands changes hands in
//   name, and one wholly held changes hands on the map
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
  PATCH_MAX_KM2,
  TRAIT_DRIVE,
  WHOLE_AT,
} from "./constants.js";
import { holderOf, memberIndex, paintGround, readRegions, sideOfName } from "./battle.js";
import { closeDay, decideTasks, steer, stepForward } from "./combat.js";
import { countHolders, redistance, resampleField, takeCells, traceContour } from "./field.js";
import { createFrame, frameBounds, latToY, projectorOf, yToLat } from "./frame.js";
import { measureLine } from "./line.js";
import { ageOrders, readOrders } from "./orders.js";
import { createReplayRecorder } from "./replay.js";
import { readSectors } from "./sectors.js";
import { agePockets, fillPatches, markPockets, markSupply, refreshSupply } from "./supply.js";
import { drawTraits, isLive, liveCount, planLanes, settle, stands } from "./troops.js";

// What a run throws, and catches, when it needs the map's shapes and was not
// given them: the caller is told, and runs again with the regions.
export const REGIONS_NEEDED = Symbol("the map's regions are needed");

// Tells the recorder who the map is to draw a region as belonging to from a
// day on, and who it drew it as before. What was said is kept for the rig and
// the tests to read with the day's record.
const say = (battle, day, id, name, was = name) => {
  battle.recorder?.shown?.(day, id, name, was);
  battle.said.push([day, id, name, was]);
};

// A recorder for a battle from `day` on. The members it is told of are those
// the battle has, in the order the troops' owners and the painted ground
// count them. It is told at once of every region the map is to draw as
// someone else's than the world says: the ones taken in name and not yet whole.
export const startRecorder = (battle, run, day) => {
  battle.recorder = createReplayRecorder({ sides: battle.sides, cols: battle.frame.cols, rows: battle.frame.rows });
  const { arena } = battle;
  for (let region = 1; region < arena.ids.length; region += 1) {
    const id = arena.ids[region];
    const name = battle.shown.get(id) ?? "";
    if (battle.regionSide[region] >= 0 && name && name.toLowerCase() !== holderOf(battle, run, id).toLowerCase()) say(battle, day, id, name);
  }
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
      if (troop.drawn) return;
      // A troop new to the run: it draws its own hand, and has its side's radius.
      drawTraits(troop, battle.seed, battle.name, side, index, battle.even);
      troop.radiusKm = battle.radiusKm[side];
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

// A region all but taken is finished off at night. Where a side holds at least
// WHOLE_AT of a region that is shown as the other side's, no living troop of
// the other side stands on the rest of it, the rest is under the size of a
// pocket and no siege spares any of it, the rest becomes that side's, painted
// for the member the region goes to (or went to) in name. Cells of the region
// outside the frame count for whoever holds it in name. Only the side taking
// a region does this: done both ways, the first cells an advance took across
// a region's border would go back every night its troops slept on the near
// side of it. true when any ground changed hands.
export const mopUp = (battle, run) => {
  const { field, arena, place } = battle;
  if (run.braked) return false;
  const count = arena.ids.length;
  const held = [new Int32Array(count), new Int32Array(count)];
  const area = [new Float64Array(count), new Float64Array(count)];
  for (let index = 0; index < field.size; index += 1) {
    const holder = field.holders[index];
    if (holder !== HOLDER_SIDE_A && holder !== HOLDER_SIDE_B) continue;
    const km = place.rowKm[Math.floor(index / field.cols)];
    held[holder][arena.region[index]] += 1;
    area[holder][arena.region[index]] += km * km;
  }
  const taking = new Int8Array(count).fill(-1);
  let any = false;
  for (let region = 1; region < count; region += 1) {
    const owner = battle.regionSide[region];
    if (owner < 0) continue;
    const shownSide = sideOfName(battle, battle.shown.get(arena.ids[region]));
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      if (side === shownSide || held[1 - side][region] === 0 || !(area[1 - side][region] < PATCH_MAX_KM2)) continue;
      const mine = held[side][region] + (owner === side ? arena.outside[region] : 0);
      if (mine / (arena.cells[region] + arena.outside[region]) < WHOLE_AT) continue;
      taking[region] = side;
      any = true;
    }
  }
  if (!any) return false;
  // Not where one of the other side's still stands...
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const troop of battle.troops[side]) {
      if (!isLive(troop) || !stands(field, side, troop.x, troop.y)) continue;
      const region = arena.region[Math.floor(troop.y) * field.cols + Math.floor(troop.x)];
      if (taking[region] === 1 - side) taking[region] = -1;
    }
  }
  // ...nor where any of the rest is ground the taker is leaving alone for a siege.
  const cells = [[], []];
  for (let index = 0; index < field.size; index += 1) {
    const region = arena.region[index];
    const side = taking[region];
    if (side < 0 || field.holders[index] !== 1 - side) continue;
    let spared = battle.kept[side] !== null && battle.kept[side][index] === 1;
    const discs = battle.spared[side];
    for (let at = 0; at < discs.length && !spared; at += 3) {
      const dx = (index % field.cols) + 0.5 - discs[at];
      const dy = Math.floor(index / field.cols) + 0.5 - discs[at + 1];
      spared = dx * dx + dy * dy <= discs[at + 2] * discs[at + 2];
    }
    if (spared) taking[region] = -2;
    else cells[side].push(index);
  }
  let taken = false;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const mine = cells[side].filter((index) => taking[arena.region[index]] === side);
    if (mine.length === 0) continue;
    const painter = new Map();
    takeCells(field, side, mine, (index) => {
      const region = arena.region[index];
      if (!painter.has(region)) {
        const name = battle.regionSide[region] === side ? holderOf(battle, run, arena.ids[region]) : captorOf(battle, run, region, side);
        painter.set(region, Math.max(0, memberIndex(battle, side, name)));
      }
      return painter.get(region);
    });
    taken = true;
  }
  return taken;
};

// A region the side that does not hold it in name holds MORE than six tenths
// of changes hands in name: reported as a flip for the game to apply, and
// taken as done here. Nothing on the map changes that day: the region goes on
// being shown as its old holder's, and the recorder is told so. On the day the
// side that holds a region in name holds the whole of it, the region changes
// hands on the map too: it is shown as its holder's, it is that side's home
// ground, and all of it is painted for that member. Cells of a region outside
// the frame count for whoever holds it in name. A city whose cell changed
// holder goes to the log.
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
    if (owner < 0 || run.braked) continue;
    const taker = 1 - owner;
    if (held[taker][region] / (arena.cells[region] + arena.outside[region]) <= FLIP_AT) continue;
    if (day - battle.lastFlip[region] < MIN_DAYS_BETWEEN_FLIPS) {
      // Too soon after it last changed hands: it is looked at again tomorrow,
      // whether or not the ground has moved by then.
      battle.settledTurns = -1;
      continue;
    }
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
    // In name only: the map goes on drawing it as it did.
    say(battle, day, id, battle.shown.get(id));
  }

  // The regions that are whole today, and are not yet shown as their holder's.
  const member = new Int16Array(arena.ids.length).fill(-1);
  let any = false;
  for (let region = 1; region < arena.ids.length; region += 1) {
    const side = battle.regionSide[region];
    if (side < 0 || arena.cells[region] === 0 || held[side][region] !== arena.cells[region]) continue;
    const id = arena.ids[region];
    const name = holderOf(battle, run, id);
    const was = battle.shown.get(id) ?? "";
    if (!name || was.toLowerCase() === name.toLowerCase()) continue;
    battle.shown.set(id, name);
    member[region] = Math.max(0, memberIndex(battle, side, name));
    any = true;
    say(battle, day, id, name, was);
    if (arena.names[region] !== id) battle.log.push({ d: date, k: "whole", s: side, at: `region: ${arena.names[region]}` });
  }
  if (!any) return;
  for (let index = 0; index < field.size; index += 1) {
    const region = arena.region[index];
    if (member[region] < 0) continue;
    battle.homes[index] = battle.regionSide[region];
    field.painter[index] = member[region];
  }
};

// ---- the frame growing ---------------------------------------------------------

// How near an edge the line may come before the frame grows, in cells: never
// nearer than the line can come in one more day, which is the full step of the
// fastest troop over the fastest ground. A line that reached the edge would
// leave one side holding nothing on the frame, and the battle would read as won.
const growWithin = (battle, run) => {
  if (battle.withinFor !== battle.arena) {
    let fastest = 0;
    for (let index = 0; index < battle.arena.size; index += 1) if (battle.arena.speed[index] > fastest) fastest = battle.arena.speed[index];
    let least = Infinity;
    for (let row = 0; row < battle.place.rowKm.length; row += 1) if (battle.place.rowKm[row] < least) least = battle.place.rowKm[row];
    const stepKm = Math.max(run.advanceKm[0], run.advanceKm[1], run.advanceKm[2]) * run.pace * TRAIT_DRIVE[1] * fastest;
    battle.within = Math.max(GROW_WITHIN_CELLS, Math.ceil(stepKm / least) + 2);
    battle.withinFor = battle.arena;
  }
  return battle.within;
};

// Which edges of the frame the line has come within `within` cells of, with
// ground in play at the edge beside it: [west, south, east, north], or null.
const edgesToGrow = (battle, within) => {
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
    const span = within + 2;
    if (!grow[0] && x < within && landBy(y - span, y + span, 0, true)) grow[0] = true;
    if (!grow[2] && x > cols - within && landBy(y - span, y + span, cols - 1, true)) grow[2] = true;
    if (!grow[1] && y < within && landBy(x - span, x + span, 0, false)) grow[1] = true;
    if (!grow[3] && y > rows - within && landBy(x - span, x + span, rows - 1, false)) grow[3] = true;
  }
  return grow.some(Boolean) ? grow : null;
};

// A larger frame for a battle: the same cells where the limits allow, so the
// line does not move at all; else a coarser grid over the wider box.
const largerFrame = (frame, grow, map, within) => {
  const more = Math.max(within * 2, Math.round(GROW_KM / frame.km));
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
export const growIfNeeded = (battle, run, day) => {
  if ((battle.grown ?? 0) >= 6) return false;
  const within = growWithin(battle, run);
  const grow = edgesToGrow(battle, within);
  if (!grow) return false;
  const frame = largerFrame(battle.frame, grow, run.input.map, within);
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
    return { ...pocket, cell: Math.floor(y) * arena.cols + Math.floor(x) };
  });
  battle.pocketOf = null;
  battle.pocketTurns = -1;
  // The sieges are places on the frame: they are read again on the new one.
  battle.sieges = [];
  battle.spared = [[], []];
  battle.siegeKey = "";
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
  startRecorder(battle, run, day);
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
  // For the rig, and for a test, to watch a run as the recorder is handed it:
  // the day's ground, and what the recorder was told of who regions are shown as.
  if (battle.watch) battle.watch({ battlefield: battle.name, day, troops: battle.troops, ...ground, shown: battle.said });
  battle.said = [];
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
  decideTasks(battle, run.braked, line);
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) settle(battle, side, battle.views[side], (troop) => troop.attacking, run.advanceKm, run.overlandKm);
  steer(battle, line, day, run.seed, run.steer);
  const steps = stepForward(battle, run.advanceKm, run.pace);
  fillPatches(battle, date);
  redistance(battle.field);
  closeDay(battle, date);
  if (agePockets(battle, date)) redistance(battle.field);
  if (mopUp(battle, run)) redistance(battle.field);
  ageOrders(battle);
  refreshSupply(battle, day, run.era);
  settleRegions(battle, run, day);
  growIfNeeded(battle, run, day);
  return steps;
};
