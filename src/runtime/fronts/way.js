/*! Open Historia — battlefields and fronts: an order as a way to go © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An attack order is never a point to gather at: troops sent to a point circle
// it and clump on it. It is a WAY for a group: a run of legs, each a direction
// and the line across the leg's end. A troop goes along its leg until it has
// crossed that line and then takes the next; past the last line it has done.
//
// Every troop of the group has its own place ACROSS the way (its slot, in
// cells to the left of it) and its own share of the last leg to go (its stop),
// so a group ends spread along the ground it took. The shape is the order's:
//
//   advance     a broad rank
//   blitz       a rank half as broad, that masses first and goes faster
//   spearhead   a point (the leading third, the armour in it) and its
//               shoulders, staggered back along the way
//   flank       a column, along a way that goes round
//   encircle    two columns, one each way round
//
// A troop under an order carries it as `troop.order`:
//   { kind: "way", standing, word, legs, leg, slot, stop, since, day }
// where `standing` is the standing order it serves, `since` the day it sets
// off and `day` the day it was told. The other kinds a troop may carry are
// made in move.js: "fallback", "pursue", "reduce", "assault", "breakout".

import { hashSeed } from "../unitMotion.js";
import {
  BLITZ_BREADTH,
  BLITZ_MASS_DAYS,
  COLUMN_BREADTH_KM,
  GROUP_BREADTH_BRUSHES,
  GROUP_BREADTH_MIN_KM,
  GROUP_BREADTH_OF_EXTENT,
  POINT_BREADTH,
  POINT_STOPS_SHORT,
  ROUND_KM,
  SHOULDER_OUT,
  SHOULDER_OUT_KM,
  SHOULDER_STOPS,
  SPEARHEAD_BREADTH_KM,
  WAY_BEND_CELLS,
  WAY_DAYS_MIN,
  WAY_LEGS_MAX,
} from "./constants.js";
import { cellAt, cheapestWay, downhill, measure } from "./ground.js";
import { KIND_ARMOUR, KIND_ARTILLERY, isLive } from "./troops.js";

// Gives a troop its next order. One that is closing on a pocket, or has been
// sent at a named place, finishes that first and goes on with the new order after.
export const takeOrder = (troop, next) => {
  const busy = troop.order && !troop.order.done && (troop.order.kind === "reduce" || troop.order.kind === "assault") ? troop.order : null;
  if (busy && next) busy.resume = next;
  else troop.order = next;
};

// A number from 0 up to 1 that is a battle's own for whatever names it.
export const chanceOf = (battle, ...parts) => (hashSeed([battle.seed, battle.name, ...parts].join("|")) % 10000) / 10000;

const aim = [0, 0];

// The legs of a way from a point through the points after it.
export const legsOf = (from, points) => {
  const legs = [];
  let [x, y] = from;
  for (const [ox, oy] of points) {
    const dx = ox - x;
    const dy = oy - y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0.01) legs.push({ ax: dx / length, ay: dy / length, ox, oy, length });
    x = ox;
    y = oy;
  }
  return legs;
};

// A way over the ground, cell by cell, cut down to a few points: its end, and
// the places where it bends furthest from straight.
const bendsOf = (field, cells) => {
  const point = (index) => [(cells[index] % field.cols) + 0.5, Math.floor(cells[index] / field.cols) + 0.5];
  const kept = [0, cells.length - 1];
  while (kept.length - 1 < WAY_LEGS_MAX) {
    let worst = WAY_BEND_CELLS;
    let at = -1;
    for (let span = 0; span + 1 < kept.length; span += 1) {
      const [ax, ay] = point(kept[span]);
      const [bx, by] = point(kept[span + 1]);
      const length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      if (!(length > 0)) continue;
      for (let index = kept[span] + 1; index < kept[span + 1]; index += 1) {
        const [px, py] = point(index);
        const off = Math.abs((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / length;
        if (off > worst) {
          worst = off;
          at = index;
        }
      }
    }
    if (at < 0) break;
    kept.push(at);
    kept.sort((a, b) => a - b);
  }
  return kept.slice(1).map(point);
};

// Where a group stands: the middle of it, and the way out from its own ground
// toward the other side's as its troops see it.
const standingOf = (battle, side, picked) => {
  const { field } = battle;
  const troops = battle.troops[side];
  const toOther = measure(battle)[1 - side];
  let midX = 0;
  let midY = 0;
  let outX = 0;
  let outY = 0;
  for (const index of picked) {
    midX += troops[index].x / picked.length;
    midY += troops[index].y / picked.length;
    if (downhill(field, toOther, troops[index].x, troops[index].y, aim)) {
      outX += aim[0];
      outY += aim[1];
    }
  }
  const length = Math.sqrt(outX * outX + outY * outY);
  return { midX, midY, outX: length > 0 ? outX / length : side === 0 ? 1 : -1, outY: length > 0 ? outY / length : 0 };
};

// Tells a group of a side's troops (by their indexes) to go a way.
//   day        the day it is told
//   word       the order's word, which is its shape
//   way        the points the way goes through, in cells
//   standing   the standing order it serves
//   breadthKm  how broad the group is to go, where the shape does not say
//   lagless    for an order the group was already under: nobody waits to set off
export const give = (battle, side, picked, { day, word, way, standing, breadthKm = 0, lagless = false }) => {
  if (picked.length === 0 || way.length === 0) return;
  const { kmAt } = battle.place;
  const troops = battle.troops[side];
  let midX = 0;
  let midY = 0;
  for (const index of picked) {
    midX += troops[index].x / picked.length;
    midY += troops[index].y / picked.length;
  }
  const legs = legsOf([midX, midY], way);
  if (legs.length === 0) return;
  const first = legs[0];
  const km = kmAt(midY);
  // Abreast in the order they already stand in, so that no two have to cross;
  // and from the front of the group to its rear.
  const across = (index) => (troops[index].x - midX) * -first.ay + (troops[index].y - midY) * first.ax;
  const ahead = (index) => (troops[index].x - midX) * first.ax + (troops[index].y - midY) * first.ay;
  const abreast = picked.slice().sort((a, b) => across(a) - across(b) || a - b);
  // At the point of a spearhead: its armour first, then whoever is furthest forward.
  const forward = picked.slice().sort((a, b) => (word === "spearhead" ? (troops[b].kind === KIND_ARMOUR) - (troops[a].kind === KIND_ARMOUR) : 0) || ahead(b) - ahead(a) || a - b);
  const placeAbreast = new Map(abreast.map((index, rank) => [index, rank]));
  const placeForward = new Map(forward.map((index, rank) => [index, rank]));
  const extent = (across(abreast[abreast.length - 1]) - across(abreast[0])) * km;
  const brush = battle.radiusKm[side];
  let breadth = breadthKm > 0 ? breadthKm
    : word === "spearhead" ? SPEARHEAD_BREADTH_KM
      : word === "flank" || word === "encircle" ? COLUMN_BREADTH_KM
        : Math.max(GROUP_BREADTH_MIN_KM, Math.min(picked.length * brush * GROUP_BREADTH_BRUSHES, extent * GROUP_BREADTH_OF_EXTENT));
  if (word === "blitz") breadth = Math.max(GROUP_BREADTH_MIN_KM, breadth * BLITZ_BREADTH);
  const point = Math.max(2, Math.ceil(picked.length / 3));
  for (const index of picked) {
    const troop = troops[index];
    const share = (placeAbreast.get(index) + 0.5) / picked.length - 0.5;
    const rank = placeForward.get(index);
    let slot = share * breadth;
    let stop = 1;
    if (word === "spearhead") {
      if (rank < point && troop.kind !== KIND_ARTILLERY) {
        // The point: narrow, but each with a place of its own and its own
        // stopping short of the end, so it ends spread over the ground it
        // took and not stacked where the way stops.
        slot = share * breadth * POINT_BREADTH;
        stop = 1 - POINT_STOPS_SHORT * chanceOf(battle, "point", side, index);
      } else {
        // The shoulders: out to the side they are already on, further back
        // the further back in the group they started.
        const back = Math.max(0, rank - point) / Math.max(1, picked.length - point);
        stop = SHOULDER_STOPS[0] + (SHOULDER_STOPS[1] - SHOULDER_STOPS[0]) * (1 - back);
        slot = (share >= 0 ? 1 : -1) * (breadth * SHOULDER_OUT + SHOULDER_OUT_KM[0] + (SHOULDER_OUT_KM[1] - SHOULDER_OUT_KM[0]) * chanceOf(battle, "shoulder", side, index));
      }
    }
    // A troop that was dug in takes a day to leave its works.
    const lag = lagless ? 0 : troop.lag + (troop.dug ? 1 : 0) + (word === "blitz" ? BLITZ_MASS_DAYS : 0);
    troop.dug = false;
    takeOrder(troop, { kind: "way", standing, word, legs, leg: 0, slot: slot / km, stop, since: day + lag, day });
    troop.fallback = null;
  }
};

// The way an attack order gives a group, as the points it goes through, in
// cells; for an encirclement, two ways, the one round to the left first.
// `target` is the place the order names (sectors.js findPlace), or null;
// `days` how long the run still has to go. Returns { ways, midX, midY, fx, fy }:
// the ways, the middle of the group, and the way it faces.
export const waysFor = (battle, run, side, picked, word, target, days) => {
  const { field, place } = battle;
  const troops = battle.troops[side];
  const { midX, midY, outX, outY } = standingOf(battle, side, picked);
  const km = place.kmAt(midY);
  // With nowhere named: straight out, for as far as the days would take it.
  const paceKm = Math.max(run.advanceKm[0], run.advanceKm[1], run.advanceKm[2]) * run.pace;
  const far = (Math.max(WAY_DAYS_MIN, days) * paceKm) / km;
  const straight = [[midX + outX * far, midY + outY * far]];
  const facing = { midX, midY, fx: outX, fy: outY };
  if (word === "flank" || word === "encircle") {
    // Round whatever it names, or round what lies two reaches ahead.
    const round = ROUND_KM / km;
    const tx = target ? target.x : midX + outX * round * 2;
    const ty = target ? target.y : midY + outY * round * 2;
    const gap = Math.sqrt((tx - midX) * (tx - midX) + (ty - midY) * (ty - midY));
    const fx = gap > 0 ? (tx - midX) / gap : outX;
    const fy = gap > 0 ? (ty - midY) / gap : outY;
    // The corner beside it on the near side, the corner beside it on the far
    // side, and the place behind it where two columns meet.
    const arm = (turn) => {
      const lx = -fy * turn;
      const ly = fx * turn;
      const points = [[tx + (lx + fx) * round, ty + (ly + fy) * round], [tx + fx * round, ty + fy * round]];
      if (gap > round * 1.5) points.unshift([tx + (lx - fx) * round, ty + (ly - fy) * round]);
      return points;
    };
    if (word === "encircle") return { ways: [arm(1), arm(-1)], midX, midY, fx, fy };
    // A flank goes round the side with fewer of the other side's troops beside it.
    const beside = [1, -1].map((turn) => {
      const px = tx + -fy * turn * round;
      const py = ty + fx * turn * round;
      let count = 0;
      for (const enemy of battle.troops[1 - side]) {
        if (isLive(enemy) && (enemy.x - px) * (enemy.x - px) + (enemy.y - py) * (enemy.y - py) <= round * round) count += 1;
      }
      return count;
    });
    return { ways: [arm(beside[1] < beside[0] ? -1 : 1)], midX, midY, fx, fy };
  }
  if (!target) return { ways: [straight], ...facing };
  // To a place: the cheapest way over the ground, in a few legs.
  let from = cellAt(field, midX, midY);
  if (from < 0 || !field.play[from]) from = cellAt(field, troops[picked[0]].x, troops[picked[0]].y);
  let goal = target.kind === "city" ? target.cell : cellAt(field, target.x, target.y);
  if (goal < 0 || !field.play[goal]) goal = -1;
  const cells = from >= 0 && goal >= 0 ? cheapestWay(battle, from, goal) : null;
  return { ways: [cells && cells.length > 1 ? bendsOf(field, cells) : [[target.x, target.y]]], ...facing };
};

// How far a troop still has to go to the line across its leg's end, in cells:
// under the leg's own length while it is on its way, and nothing or less once
// it has crossed.
export const leftOnLeg = (leg, troop) => (leg.ox - troop.x) * leg.ax + (leg.oy - troop.y) * leg.ay;
