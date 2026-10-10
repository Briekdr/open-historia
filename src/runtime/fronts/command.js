/*! Open Historia — battlefields and fronts: who commands whom © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A side's troops on a battlefield are under its GENERALS: a few of them, each
// with a body of troops that stood together along the line when the commands
// were first given out. A troop keeps its general for as long as it lives; one
// that comes later is under whoever commands the nearest of its side.
//
// The engine only keeps the books: which general each troop is under, and what
// each general's body of troops amounts to (the brief). What a general is
// CALLED, and what he is told, come from outside it. A person who plays a side
// speaks to its generals in the war room, and what they are told is written
// onto the saved record between runs, here:
//
//   an order for a body of troops picked out (a general's, or a handful the
//   player drew a box round) is a standing order marked `chosen`, and the
//   record's carry says which troops serve it;
//
//   a route drawn for such a body is the same with a `way`.
//
// The next run finds each order with the troops it was given to and puts it to
// them (engine.js assignStanding): until then nothing on the map has moved.

import { decodeTroops } from "./codec.js";
import {
  COMMAND_TROOPS,
  FRONT_ORDERS,
  GENERAL_NAME_MAX,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  MAX_COMMANDS,
  MARK_MAX,
  MAX_ORDERS_PER_SIDE,
  MAX_TALK_LINES,
  MAX_WAY_POINTS,
  TALK_TEXT_MAX,
} from "./constants.js";

const DIAGONAL = 0.7071067811865476;
// The four ways a body of troops can be strung out: north to south, west to
// east, and the two diagonals. Along each, which end is counted first.
const AXES = Object.freeze([[0, -1], [1, 0], [DIAGONAL, -DIAGONAL], [DIAGONAL, DIAGONAL]]);

const live = (troop) => troop.strength > 0;
const clean = (value, most) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();

// How many generals a side with this many troops has.
export const commandCount = (troops) => {
  let count = 1;
  for (const limit of COMMAND_TROOPS) if (troops >= limit) count += 1;
  return Math.min(MAX_COMMANDS, count);
};

// ---- in a run --------------------------------------------------------------------

// Puts every living troop of one side under a general. A side none of whose
// troops has one yet is shared out: its troops in the order they stand along
// the way they are strung out (the northernmost first, or the westernmost),
// in bodies of the same size. After that only newcomers are placed: each
// under whoever commands the nearest of its side.
const shareOut = (troops) => {
  const led = [];
  const loose = [];
  troops.forEach((troop, index) => {
    if (!live(troop)) return;
    (troop.command >= 0 ? led : loose).push(index);
  });
  if (loose.length === 0) return;
  if (led.length === 0) {
    let axis = 0;
    let widest = -1;
    AXES.forEach(([ax, ay], at) => {
      let low = Infinity;
      let high = -Infinity;
      for (const index of loose) {
        const along = troops[index].x * ax + troops[index].y * ay;
        if (along < low) low = along;
        if (along > high) high = along;
      }
      if (high - low > widest) {
        widest = high - low;
        axis = at;
      }
    });
    const [ax, ay] = AXES[axis];
    const along = (index) => troops[index].x * ax + troops[index].y * ay;
    const count = commandCount(loose.length);
    loose.slice().sort((a, b) => along(a) - along(b) || a - b).forEach((index, rank) => {
      troops[index].command = Math.min(count - 1, Math.floor((rank * count) / loose.length));
    });
    return;
  }
  for (const index of loose) {
    let best = Infinity;
    let command = troops[led[0]].command;
    for (const other of led) {
      const dx = troops[other].x - troops[index].x;
      const dy = troops[other].y - troops[index].y;
      if (dx * dx + dy * dy < best) {
        best = dx * dx + dy * dy;
        command = troops[other].command;
      }
    }
    troops[index].command = command;
  }
};

// Every living troop of a battle under a general, both sides.
export const assignCommands = (battle) => {
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) shareOut(battle.troops[side]);
};

// The names a record carries for its generals, a list a side: read on the way in.
export const readGenerals = (value) => [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
  const names = Array.isArray(value) && Array.isArray(value[side]) ? value[side] : [];
  return names.slice(0, MAX_COMMANDS).map((name) => clean(name, GENERAL_NAME_MAX));
});

// What was said in each side's war room, read on the way in: a list a side of
//   { who, text, at }
// `who` is "" for the person who commands the side, else the command of the
// general who spoke (0 for the first); `at` is the game date it was said on.
export const readTalk = (value) => [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
  const lines = Array.isArray(value) && Array.isArray(value[side]) ? value[side] : [];
  const kept = [];
  for (const line of lines) {
    const text = String(line?.text ?? "").replace(/[ \t]+/g, " ").trim().slice(0, TALK_TEXT_MAX);
    if (!text) continue;
    const command = Number(line?.who);
    kept.push({ who: line?.who === "" || !Number.isInteger(command) || command < 0 || command >= MAX_COMMANDS ? "" : command, text, at: clean(line?.at, 40) });
  }
  return kept.slice(-MAX_TALK_LINES);
});

// What a general's command is called wherever it is named: to the player on
// the war room's panel, and to the model that speaks for him (it is how the
// model says which general it means, so it is the same from the first message
// to the last, whatever name he is given).
const ORDINALS = Object.freeze(["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"]);
export const commandTitle = (command) => `${ORDINALS[command] ?? `${Number(command) + 1}th`} Army`;

// ---- on a saved record -------------------------------------------------------------

const carryOf = (record) => (record?.brief && typeof record.brief.carry === "object" && record.brief.carry ? record.brief.carry : {});

// Which general each troop of a record is under, a list a side, as long as its
// troops: -1 for the dead and for a record that was never shared out.
// A side that was never shared out (a battlefield saved before there were
// generals, or opened and not yet run) is shared out here by the very rule the
// engine uses when it next runs, so that it has its generals from the start.
const commandsIn = (record, troops) => {
  const saved = carryOf(record).command;
  return troops.map((list, side) => {
    const commands = list.map((troop, index) => {
      const command = Array.isArray(saved?.[side]) ? saved[side][index] : -1;
      return live(troop) && Number.isInteger(command) && command >= 0 && command < MAX_COMMANDS ? command : -1;
    });
    if (commands.some((command) => command >= 0) || !list.some(live)) return commands;
    const fresh = list.map((troop) => ({ x: troop.x, y: troop.y, strength: troop.strength, command: -1 }));
    shareOut(fresh);
    return fresh.map((troop) => (live(troop) ? troop.command : -1));
  });
};

// Which standing order each troop serves, a list a side: -1 for none.
const underIn = (record, troops) => {
  const saved = carryOf(record).under;
  return troops.map((list, side) => list.map((troop, index) => {
    const order = Array.isArray(saved?.[side]) ? saved[side][index] : -1;
    return Number.isInteger(order) && order >= 0 && order < record.orders.length ? order : -1;
  }));
};

// The generals of a side of a saved battlefield, in the order of their
// commands, each with the troops under him:
//   { command, name, troops: [index in the record's list], n, pct, at, doing, cut, dug }
// `at` (the place his troops stand about), `doing`, `cut` and `dug` are the
// engine's, from the brief; a general with nobody left is left out.
export const generalsOf = (record, side) => {
  if (!record || !Array.isArray(record.troops) || (side !== 0 && side !== 1)) return [];
  const troops = [decodeTroops(record.troops[0]), decodeTroops(record.troops[1])];
  const commands = commandsIn(record, troops)[side];
  const names = readGenerals(carryOf(record).generals)[side];
  const told = Array.isArray(record.brief?.commands?.[side]) ? record.brief.commands[side] : [];
  const generals = [];
  commands.forEach((command, index) => {
    if (command < 0) return;
    if (!generals[command]) generals[command] = { command, name: names[command] ?? "", troops: [], n: 0, pct: 0, at: "", doing: "", cut: 0, dug: 0 };
    generals[command].troops.push(index);
    generals[command].n += 1;
    generals[command].pct += troops[side][index].strength;
  });
  return generals.filter(Boolean).map((general) => {
    const brief = told[general.command] ?? {};
    return {
      ...general,
      pct: Math.round(general.pct / Math.max(1, general.n)),
      at: clean(brief.at, 120),
      doing: clean(brief.doing, 40),
      cut: Math.max(0, Math.floor(Number(brief.cut) || 0)),
      dug: Math.max(0, Math.floor(Number(brief.dug) || 0)),
    };
  });
};

// Which general each troop of a side is under, by its place in the record's list.
export const commandOfTroops = (record, side) => {
  if (!record || !Array.isArray(record.troops)) return [];
  const troops = [decodeTroops(record.troops[0]), decodeTroops(record.troops[1])];
  return commandsIn(record, troops)[side] ?? [];
};

// A record with its generals named: `names` in the order of their commands.
// A name already there is kept unless `replace` says otherwise.
export const nameGenerals = (record, side, names, { replace = false } = {}) => {
  if (!record || (side !== 0 && side !== 1)) return record;
  const generals = readGenerals(carryOf(record).generals);
  let changed = false;
  (Array.isArray(names) ? names : []).slice(0, MAX_COMMANDS).forEach((name, command) => {
    const next = clean(name, GENERAL_NAME_MAX);
    if (!next || (generals[side][command] && !replace) || generals[side][command] === next) return;
    while (generals[side].length < command) generals[side].push("");
    generals[side][command] = next;
    changed = true;
  });
  if (!changed) return record;
  return { ...record, brief: { ...record.brief, carry: { ...carryOf(record), generals } } };
};

// The standing orders of a record with those nobody serves any more taken out
// (of the ones given to troops picked out: an order for a stretch of line
// stands whether or not anybody is carrying it out), and every troop's order
// renumbered to match.
const tidy = (record, orders, under, ages) => {
  const served = new Set();
  for (const list of under) for (const order of list) if (order >= 0) served.add(order);
  const moved = new Map();
  const kept = [];
  const keptAges = [];
  orders.forEach((order, index) => {
    if (order.chosen && !served.has(index)) return;
    moved.set(index, kept.length);
    kept.push(order);
    keptAges.push(ages[index] ?? 0);
  });
  return {
    ...record,
    orders: kept,
    brief: { ...record.brief, carry: { ...carryOf(record), under: under.map((list) => list.map((order) => moved.get(order) ?? -1)), ages: keptAges } },
  };
};

// A saved record with an order written onto it for a body of a side's troops,
// to be put to them when the next run begins.
//   side       which side of the record
//   troops     their places in the record's list of that side's troops
//   order      one of the engine's words (advance, dig in, hold, fall back...)
//   objective  a place by its name with its kind, where the order has one
//   way        a route drawn for them, as [lng, lat] points
//   by, since  who gives it (a country or a group by its exact name), and the date
//   mark       what it was written for, when not by hand (record.js normalizeOrder)
// The record comes back unchanged when there is nothing to write: no such
// troops, a word the engine does not know, or no room for another order.
export const orderTroops = (record, { side, troops, order, objective = "", way = null, by = "", since = "", mark = "" } = {}) => {
  if (!record || !Array.isArray(record.orders) || (side !== 0 && side !== 1)) return record;
  // A route is an advance along it, whatever word came with it or none.
  const word = Array.isArray(way) && way.length > 0 ? "advance" : clean(order, 20).toLowerCase();
  if (!FRONT_ORDERS.includes(word) || word === "land" || word === "assault") return record;
  const decoded = [decodeTroops(record.troops[0]), decodeTroops(record.troops[1])];
  const wanted = new Set((Array.isArray(troops) ? troops : []).filter((index) => Number.isInteger(index) && index >= 0 && index < decoded[side].length && live(decoded[side][index])));
  if (wanted.size === 0) return record;
  const route = [];
  for (const point of Array.isArray(way) ? way : []) {
    const lng = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) route.push([lng, lat]);
  }
  const under = underIn(record, decoded);
  const ages = record.orders.map((entry, index) => {
    const age = carryOf(record).ages?.[index];
    return Number.isFinite(age) ? age : 0;
  });
  // They serve this order now and no other.
  const index = record.orders.length;
  for (const troop of wanted) under[side][troop] = index;
  const entry = { s: side, sector: "all", order: route.length > 0 ? "advance" : word, since: clean(since, 40), chosen: true };
  const named = clean(objective, 120);
  if (named && route.length === 0) entry.objective = named;
  const giver = clean(by, 120);
  if (giver) entry.by = giver;
  const written = clean(mark, MARK_MAX);
  if (written) entry.mark = written;
  if (route.length > 0) entry.way = thinRoute(route, MAX_WAY_POINTS);
  const next = tidy(record, [...record.orders, entry], under, [...ages, 0]);
  // No room: the oldest of this side's orders for troops picked out gives way, and failing that nothing is written.
  if (next.orders.filter((standing) => standing.s === side).length > MAX_ORDERS_PER_SIDE) return record;
  return next;
};

// A saved record with a body of troops taken off whatever order they were
// given by hand: they go back to what their stretch of the line is told.
export const releaseTroops = (record, { side, troops } = {}) => {
  if (!record || !Array.isArray(record.orders) || (side !== 0 && side !== 1)) return record;
  const decoded = [decodeTroops(record.troops[0]), decodeTroops(record.troops[1])];
  const under = underIn(record, decoded);
  let changed = false;
  for (const troop of Array.isArray(troops) ? troops : []) {
    const order = under[side]?.[troop];
    if (order === undefined || order < 0 || !record.orders[order].chosen) continue;
    under[side][troop] = -1;
    changed = true;
  }
  if (!changed) return record;
  const ages = record.orders.map((entry, index) => carryOf(record).ages?.[index] ?? 0);
  return tidy(record, record.orders, under, ages);
};

// The orders a side's troops were given by hand that are still to be carried
// out or are being: each with the troops that serve it.
//   { index, order, objective, way, troops: [index in the record's list] }
export const chosenOrdersOf = (record, side) => {
  if (!record || !Array.isArray(record.orders)) return [];
  const decoded = [decodeTroops(record.troops[0]), decodeTroops(record.troops[1])];
  const under = underIn(record, decoded)[side] ?? [];
  const found = [];
  record.orders.forEach((order, index) => {
    if (!order.chosen || order.s !== side) return;
    const troops = [];
    under.forEach((serves, troop) => {
      if (serves === index && live(decoded[side][troop])) troops.push(troop);
    });
    if (troops.length > 0) found.push({ index, order: order.order, objective: order.objective ?? "", way: order.way ?? null, troops, by: order.by ?? "", mark: order.mark ?? "" });
  });
  return found;
};

// A saved record with every troop taken off the orders of a side that were
// written for something that no longer holds: `gone(mark)` says which.
export const releaseMarked = (record, side, gone) => {
  const troops = [];
  for (const order of chosenOrdersOf(record, side)) if (order.mark && gone(order.mark)) troops.push(...order.troops);
  return troops.length > 0 ? releaseTroops(record, { side, troops }) : record;
};

// What has been said in a side's war room on a battlefield, oldest first.
export const talkOf = (record, side) => (side === 0 || side === 1 ? readTalk(carryOf(record).talk)[side] : []);

// A record with more said in a side's war room: `lines` as readTalk keeps them.
export const withTalk = (record, side, lines) => {
  if (!record || (side !== 0 && side !== 1) || !Array.isArray(lines) || lines.length === 0) return record;
  const talk = readTalk(carryOf(record).talk);
  talk[side] = readTalk(side === 0 ? [[...talk[0], ...lines], []] : [[], [...talk[1], ...lines]])[side];
  return { ...record, brief: { ...record.brief, carry: { ...carryOf(record), talk } } };
};

// The place on a drawn route nearest a point: which stretch of it (counted
// from 0), and how far along that stretch, from 0 to 1. The points and the
// point are in the same units, whatever they are.
export const nearestOnRoute = (points, x, y) => {
  let best = Infinity;
  let at = 0;
  let part = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [ax, ay] = points[index];
    const dx = points[index + 1][0] - ax;
    const dy = points[index + 1][1] - ay;
    const length = dx * dx + dy * dy;
    const along = length > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
    const off = (x - ax - dx * along) * (x - ax - dx * along) + (y - ay - dy * along) * (y - ay - dy * along);
    if (off < best) {
      best = off;
      at = index;
      part = along;
    }
  }
  return { at, part };
};

// The part of a drawn route that still lies ahead of a point: everything after
// the place on it nearest that point, and the whole of it when that is where
// it begins. Troops told to follow a route go on with it from where they have
// got to, and do not go back to the start of it every run; and the arrow the
// war room draws for a route under way is only what is left of it.
export const routeAhead = (points, x, y) => {
  if (points.length <= 1) return points;
  const { at, part } = nearestOnRoute(points, x, y);
  return at === 0 && part === 0 ? points : points.slice(at + 1);
};

// A drawn route cut down to a few points: its ends, and the places where it
// turns furthest from straight (Douglas and Peucker's way), in degrees.
export const thinRoute = (points, most = MAX_WAY_POINTS) => {
  if (points.length <= 2) return points.map(([lng, lat]) => [lng, lat]);
  const kept = [0, points.length - 1];
  while (kept.length < most) {
    let worst = 0;
    let at = -1;
    for (let span = 0; span + 1 < kept.length; span += 1) {
      const [ax, ay] = points[kept[span]];
      const [bx, by] = points[kept[span + 1]];
      const length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      for (let index = kept[span] + 1; index < kept[span + 1]; index += 1) {
        const [px, py] = points[index];
        const off = length > 0 ? Math.abs((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / length : Math.sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
        if (off > worst) {
          worst = off;
          at = index;
        }
      }
    }
    // Nothing left that is off the line by more than a hair.
    if (at < 0 || worst < 0.01) break;
    kept.push(at);
    kept.sort((a, b) => a - b);
  }
  return kept.map((index) => [points[index][0], points[index][1]]);
};
