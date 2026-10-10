/*! Open Historia — battlefields and fronts: orders, and what the story says came of them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A side is told what to do on a stretch of the line in one of eight words,
// and keeps doing it until it is told otherwise: these are its STANDING ORDERS.
// A new order for a sector replaces the one that stood there, an order for the
// whole line replaces them all, and an attack nobody renews lapses to a hold.
//
// The story may also state what came of a battle: a RESULT. The engine works
// out how far an advance gets by itself; a result is the model overruling it,
// on the day it is dated and never earlier. Where a result takes ground it
// does so the way everything here does, by troops walking: the objective of a
// capture is reached along a path and the path is what changes hands.
//
// A result may come with no order at all: the story saying what happened to a
// side whose orders are not the engine's to change (a human player's). It is
// then applied against the orders that side already has, and they are left
// exactly as they are.

import {
  ATTACK_LAPSE_DAYS,
  BREAKTHROUGH_KM,
  BREAKTHROUGH_LOSS,
  CAPTURED_CITY_CELLS,
  CAPTURED_COLUMN,
  CAPTURED_LOSS,
  COLLAPSE_LEFT,
  EFFORT_FACTORS,
  FRONT_EFFORTS,
  FRONT_ORDERS,
  FRONT_RESULTS,
  HALT_DAYS,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  LANDING_CELLS,
  LANDING_TROOPS,
  MAX_ORDERS_PER_SIDE,
  MAX_TROOPS_PER_SIDE,
  OVERRUN_CELLS,
  POOL_PER_TROOP,
  REPULSED_LOSS,
} from "./constants.js";
import { nearestHeld, redistance, restoreCells, takeCapsule, takeCells } from "./field.js";
import { WHOLE_LINE, describePoint, findPlace, inSector, placeText, resolveSector, sectorMiddle } from "./sectors.js";
import { findPockets, nearestOwner, surrenderPocket } from "./supply.js";
import { KIND_INFANTRY, controlRadius, createTroop, isAttack, isLive, liveCount, stands } from "./troops.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// Other ways of telling a side to go round: each is read as `flank`.
const FLANK_WORDS = new Set(["flank", "outflank", "envelop", "turn the flank"]);

// Which side of a battlefield a country or a group fights on (by its exact
// name in any case), and its place among that side's members; [-1, -1] for
// neither, or for one that has left.
export const memberOf = (battle, name) => {
  const wanted = fold(name);
  if (wanted) {
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      const index = battle.sides[side].findIndex((member, at) => fold(member) === wanted && !battle.gone[side].has(at));
      if (index >= 0) return [side, index];
    }
  }
  return [-1, -1];
};

// ---- standing orders as they read today ------------------------------------------

// Each side's standing orders against today's line: the word in force (an
// attack that has stood too long reads as a hold), the ground its sector
// covers, the place it aims at. The later order of a side takes precedence
// where two cover the same ground. Also the stretches a side may make no step
// on for now.
export const readOrders = (battle, line, sectors) => {
  const { arena, place } = battle;
  const views = [[], []];
  for (const order of battle.orders) {
    const sector = resolveSector(arena, line, sectors, order.sector) ?? WHOLE_LINE;
    const target = order.objective ? findPlace(arena, order.objective) : null;
    const word = isAttack(order.order) && order.age >= ATTACK_LAPSE_DAYS ? "hold" : order.order;
    views[order.s].push({
      order,
      word,
      sector,
      target,
      age: order.age,
      middle: target && (word === "advance" || word === "blitz") ? sectorMiddle(line, sector, place.kmAt) : null,
    });
  }
  battle.views = views;
  battle.haltsToday = battle.halts.map((halt) => ({ s: halt.s, sector: resolveSector(arena, line, sectors, halt.sector) ?? WHOLE_LINE }));
};

// A day passes for the orders: each has stood a day longer, an attack that has
// stood its time becomes the hold it already reads as, and a halt runs down.
export const ageOrders = (battle) => {
  for (const order of battle.orders) {
    order.age += 1;
    if (isAttack(order.order) && order.age >= ATTACK_LAPSE_DAYS) {
      order.order = "hold";
      delete order.objective;
      battle.ordersChanged += 1;
    }
  }
  const before = battle.halts.length;
  for (const halt of battle.halts) halt.days -= 1;
  battle.halts = battle.halts.filter((halt) => halt.days > 0);
  if (battle.halts.length !== before) battle.ordersChanged += 1;
};

const sectorText = (sector) => (sector.kind === "all" ? "all" : sector.word);

// Puts an order among a side's standing orders: it replaces the one for the
// same sector, and one for the whole line replaces them all.
export const setStandingOrder = (battle, side, order) => {
  const sector = fold(order.sector);
  battle.orders = battle.orders.filter((standing) => standing.s !== side || (sector !== "all" && fold(standing.sector) !== sector));
  battle.orders.push({ ...order, s: side });
  const mine = battle.orders.filter((standing) => standing.s === side);
  if (mine.length > MAX_ORDERS_PER_SIDE) {
    const dropped = mine[0];
    battle.orders = battle.orders.filter((standing) => standing !== dropped);
  }
  battle.ordersChanged += 1;
};

// ---- the ground a result takes -----------------------------------------------------

// The cheapest way over ground in play from one cell to another, by what the
// ground costs to cross: a list of cells from the first to the last, or null
// when there is no way. Cells are settled in order of cost and, at equal cost,
// of index, so the same ground always gives the same way.
export const cheapestWay = (battle, from, to) => {
  const { field, arena } = battle;
  const { cols, rows, size, play } = field;
  if (from < 0 || to < 0 || !play[from] || !play[to]) return null;
  const cost = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const heap = [from];
  cost[from] = 0;
  const before = (a, b) => cost[a] < cost[b] || (cost[a] === cost[b] && a < b);
  const settled = new Uint8Array(size);
  while (heap.length > 0) {
    const index = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        const right = left + 1;
        let least = at;
        if (left < heap.length && before(heap[left], heap[least])) least = left;
        if (right < heap.length && before(heap[right], heap[least])) least = right;
        if (least === at) break;
        [heap[at], heap[least]] = [heap[least], heap[at]];
        at = least;
      }
    }
    if (settled[index]) continue;
    settled[index] = 1;
    if (index === to) break;
    const col = index % cols;
    const row = (index - col) / cols;
    for (let dy = -1; dy <= 1; dy += 1) {
      const y = row + dy;
      if (y < 0 || y >= rows) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = col + dx;
        const next = y * cols + x;
        if ((dx === 0 && dy === 0) || x < 0 || x >= cols || !play[next] || settled[next]) continue;
        const step = (dx !== 0 && dy !== 0 ? 1.4142135623730951 : 1) * (0.5 / arena.speed[index] + 0.5 / arena.speed[next]);
        if (!(cost[index] + step < cost[next])) continue;
        cost[next] = cost[index] + step;
        parent[next] = index;
        heap.push(next);
        for (let at = heap.length - 1; at > 0;) {
          const up = (at - 1) >> 1;
          if (!before(heap[at], heap[up])) break;
          [heap[at], heap[up]] = [heap[up], heap[at]];
          at = up;
        }
      }
    }
  }
  if (!settled[to]) return null;
  const way = [];
  for (let index = to; index >= 0; index = parent[index]) way.push(index);
  return way.reverse();
};

// Troops left standing on ground that is no longer their side's fall back onto
// their own, at a cost; one with none of its own within `reach` cells is lost.
const giveWay = (battle, side, lossShare, date, reach = OVERRUN_CELLS) => {
  const { field, arena } = battle;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || stands(field, side, troop.x, troop.y)) continue;
    const cell = nearestHeld(field, side, troop.x, troop.y, reach);
    if (cell < 0) {
      const at = describePoint(arena, troop.x, troop.y);
      if (at) battle.log.push({ d: date, k: "overrun", s: side, at });
      troop.strength = 0;
      continue;
    }
    troop.x = (cell % field.cols) + 0.5;
    troop.y = Math.floor(cell / field.cols) + 0.5;
    troop.strength *= 1 - lossShare;
    troop.dig = 0;
  }
};

const cellAt = (field, x, y) => (x >= 0 && y >= 0 && x < field.cols && y < field.rows ? Math.floor(y) * field.cols + Math.floor(x) : -1);

// "Captured": the objective is the attacker's by the end of the day, by a
// walk. Its strongest troop nearest the objective, with up to three of its
// neighbours in column behind it, walks the cheapest way there; the strip it
// walks becomes its side's, then the objective itself. false when there is no
// way to walk.
const capture = (battle, side, target, date) => {
  const { field, arena, place } = battle;
  const troops = battle.troops[side];
  let leader = -1;
  let best = Infinity;
  for (let index = 0; index < troops.length; index += 1) {
    const troop = troops[index];
    if (!isLive(troop) || !stands(field, side, troop.x, troop.y)) continue;
    const dx = troop.x - target.x;
    const dy = troop.y - target.y;
    // Of two as near, the stronger leads.
    const away = Math.sqrt(dx * dx + dy * dy) - troop.strength / 1000;
    if (away < best) {
      best = away;
      leader = index;
    }
  }
  if (leader < 0) return false;
  let goal = target.kind === "city" ? target.cell : cellAt(field, target.x, target.y);
  if (goal < 0 || !field.play[goal]) {
    // A region's middle may lie in a lake: the nearest of its own cells will do.
    goal = -1;
    let nearest = Infinity;
    for (let index = 0; index < field.size; index += 1) {
      if (!field.play[index] || (target.kind === "region" && arena.region[index] !== target.region)) continue;
      const dx = (index % field.cols) + 0.5 - target.x;
      const dy = Math.floor(index / field.cols) + 0.5 - target.y;
      if (dx * dx + dy * dy < nearest) {
        nearest = dx * dx + dy * dy;
        goal = index;
      }
    }
  }
  const way = cheapestWay(battle, cellAt(field, troops[leader].x, troops[leader].y), goal);
  if (!way) return false;

  const order = battle.plans ? battle.plans[side].lanes : [];
  const at = order.indexOf(leader);
  const column = [leader];
  for (const offset of [-1, 1, -2, 2, -3, 3]) {
    const index = at >= 0 ? order[at + offset] : undefined;
    if (index !== undefined && isLive(troops[index]) && column.length <= CAPTURED_COLUMN) column.push(index);
  }
  let radius = 0;
  for (const index of column) radius = Math.max(radius, controlRadius(troops[index], place.kmAt));
  const how = { painter: troops[leader].owner };
  let fromX = troops[leader].x;
  let fromY = troops[leader].y;
  for (const cell of way) {
    const x = (cell % field.cols) + 0.5;
    const y = Math.floor(cell / field.cols) + 0.5;
    takeCapsule(field, side, fromX, fromY, x, y, radius, radius, how);
    fromX = x;
    fromY = y;
  }
  if (target.kind === "city") takeCapsule(field, side, target.x, target.y, target.x, target.y, CAPTURED_CITY_CELLS, CAPTURED_CITY_CELLS, how);
  else {
    const cells = [];
    for (let index = 0; index < field.size; index += 1) if (field.play[index] && arena.region[index] === target.region) cells.push(index);
    takeCells(field, side, cells, troops[leader].owner);
  }
  // The column ends the day at the objective, one behind the other along the way it came.
  column.forEach((index, rank) => {
    const cell = way[Math.max(0, way.length - 1 - Math.round(rank * radius * 1.5))];
    troops[index].x = (cell % field.cols) + 0.5;
    troops[index].y = Math.floor(cell / field.cols) + 0.5;
    troops[index].dig = 0;
    troops[index].walkedToday = true;
  });
  giveWay(battle, 1 - side, CAPTURED_LOSS, date);
  redistance(field);
  return true;
};

// "Repulsed": the ground the attacker took on that sector since the run began
// goes back, its troops there go back behind the restored line a quarter
// weaker, and they make no step there for a fortnight.
const repulse = (battle, side, sector, date) => {
  const { field, place } = battle;
  const cells = [];
  for (let index = 0; index < field.size; index += 1) {
    if (!field.play[index] || battle.startPhi[index] === 0) continue;
    const gained = side === HOLDER_SIDE_A ? field.phi[index] < battle.startPhi[index] : field.phi[index] > battle.startPhi[index];
    if (gained && inSector(sector, (index % field.cols) + 0.5, Math.floor(index / field.cols) + 0.5, place.kmAt)) cells.push(index);
  }
  restoreCells(field, cells, battle.startPhi, nearestOwner(battle, 1 - side));
  for (const troop of battle.troops[side]) {
    if (!isLive(troop) || !inSector(sector, troop.x, troop.y, place.kmAt)) continue;
    troop.strength *= 1 - REPULSED_LOSS;
    troop.dig = 0;
  }
  giveWay(battle, side, 0, date, field.cols + field.rows);
  redistance(field);
  battle.halts.push({ s: side, sector: sectorText(sector), days: HALT_DAYS });
  battle.ordersChanged += 1;
};

// "Land": the attacker takes a disc of ground at a place the other side holds,
// with an anchor there that feeds it, and counters for it out of its reserves.
const land = (battle, side, target, today, notes, note) => {
  const { field } = battle;
  const cell = cellAt(field, target.x, target.y);
  if (cell < 0 || field.holders[cell] !== 1 - side) {
    notes.push({ ...note, kind: "landing-refused", detail: placeText(target) });
    return;
  }
  const room = MAX_TROOPS_PER_SIDE - battle.troops[side].length;
  const strength = Math.min(100, battle.pool[side]);
  if (room <= 0 || strength < 10) {
    notes.push({ ...note, kind: "landing-refused", detail: "no reserves" });
    return;
  }
  const x = (cell % field.cols) + 0.5;
  const y = Math.floor(cell / field.cols) + 0.5;
  const [, owner] = memberOf(battle, note.side);
  takeCapsule(field, side, x, y, x, y, LANDING_CELLS, LANDING_CELLS, { painter: Math.max(0, owner) });
  battle.anchors.push({ s: side, x, y });
  for (let landed = 0; landed < Math.min(LANDING_TROOPS, room) && battle.pool[side] >= 10; landed += 1) {
    const sent = Math.min(100, battle.pool[side]);
    battle.pool[side] -= sent;
    battle.troops[side].push(createTroop({ x: x + (landed % 2 === 0 ? 0.3 : -0.3), y: y + (landed < 2 ? 0.3 : -0.3), strength: sent, kind: KIND_INFANTRY, owner: Math.max(0, owner) }));
  }
  giveWay(battle, 1 - side, 0, today.date);
  redistance(field);
};

// ---- an order, and a result ---------------------------------------------------------

// Applies one order moment to a battlefield as it stands on its day.
//   moment   { side, order, sector, objective?, result?, effort?, ref? }: `order`
//            may be empty when `result` is given
//   today    { day, date, line, sectors }: the line the words are read against
//   notes    refusals and adjustments are added to it, for the caller to word
export const applyOrder = (battle, moment, today, notes) => {
  const { arena, place } = battle;
  const note = { battlefield: battle.name, side: String(moment.side ?? ""), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) };
  const [side] = memberOf(battle, moment.side);
  if (side < 0) {
    notes.push({ ...note, kind: "side-not-fighting" });
    return;
  }
  const by = battle.sides[side][memberOf(battle, moment.side)[1]];
  const told = FLANK_WORDS.has(fold(moment.order)) ? "flank" : moment.order;
  const word = FRONT_ORDERS.includes(told) ? told : "";
  const result = FRONT_RESULTS.includes(moment.result) ? moment.result : "";
  if (!word && !result) return;

  let sector = resolveSector(arena, today.line, today.sectors, moment.sector);
  if (!sector) {
    sector = WHOLE_LINE;
    notes.push({ ...note, kind: "sector-read-as-all", detail: today.sectors.names.join(", ") });
  }
  let target = moment.objective ? findPlace(arena, moment.objective) : null;
  if (moment.objective && !target) {
    notes.push({ ...note, kind: "objective-not-found", detail: String(moment.objective) });
    if (word === "land") return;
  }

  if (FRONT_EFFORTS.includes(moment.effort) && moment.effort !== battle.effort[side]) {
    // More effort brings up reserves; less never takes a troop away.
    const rise = EFFORT_FACTORS[moment.effort] / EFFORT_FACTORS[battle.effort[side]] - 1;
    if (rise > 0) battle.pool[side] += rise * POOL_PER_TROOP * liveCount(battle.troops[side]);
    battle.effort[side] = moment.effort;
  }

  if (word === "land") {
    if (!target) notes.push({ ...note, kind: "objective-not-found", detail: "" });
    else land(battle, side, target, today, notes, note);
  } else if (word) {
    const order = { sector: sectorText(sector), order: word, since: today.date, by, age: 0 };
    if (target) order.objective = placeText(target);
    if (FRONT_EFFORTS.includes(moment.effort)) order.effort = moment.effort;
    setStandingOrder(battle, side, order);
  }
  if (!result) return;

  if (result === "captured") {
    // With no objective of its own, the result is about the standing order's.
    if (!target) {
      const standing = battle.orders.filter((order) => order.s === side && order.objective && (sector.kind === "all" || fold(order.sector) === fold(sectorText(sector)))).at(-1);
      target = standing ? findPlace(arena, standing.objective) : null;
    }
    if (!target) notes.push({ ...note, kind: "objective-not-found", detail: "captured" });
    else if (!capture(battle, side, target, today.date)) notes.push({ ...note, kind: "objective-unreachable", detail: placeText(target) });
  } else if (result === "breakthrough") {
    const [x, y] = sectorMiddle(today.line, sector, place.kmAt);
    for (const troop of battle.troops[1 - side]) {
      const dx = troop.x - x;
      const dy = troop.y - y;
      if (!isLive(troop) || Math.sqrt(dx * dx + dy * dy) * place.kmAt(y) > BREAKTHROUGH_KM / 2) continue;
      troop.strength *= 1 - BREAKTHROUGH_LOSS;
      troop.dig = 0;
    }
  } else if (result === "repulsed") {
    repulse(battle, side, sector, today.date);
  } else if (result === "stalemate") {
    // Both sides hold there. A side whose orders are not the engine's to
    // change is simply kept from stepping for a while.
    for (const each of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      if (each === side && !word) battle.halts.push({ s: each, sector: sectorText(sector), days: HALT_DAYS });
      else setStandingOrder(battle, each, { sector: sectorText(sector), order: "hold", since: today.date, age: 0, ...(each === side ? { by } : {}) });
    }
    battle.ordersChanged += 1;
  } else if (result === "collapse") {
    for (const troop of battle.troops[side]) {
      troop.strength *= COLLAPSE_LEFT;
      troop.dig = 0;
    }
    battle.pool[side] = 0;
    setStandingOrder(battle, 1 - side, { sector: "all", order: "advance", since: today.date, age: 0 });
  } else if (result === "surrender") {
    if (sector.kind === "all") {
      for (const troop of battle.troops[side]) troop.strength = 0;
      battle.closing = "surrender";
      return;
    }
    // A place inside a pocket: that pocket goes now.
    findPockets(battle);
    const where = sector.kind === "place" ? findPlace(arena, moment.sector) : null;
    const cell = where ? cellAt(battle.field, where.x, where.y) : -1;
    const pocket = cell >= 0 ? battle.pocketOf[side][cell] : -1;
    if (pocket < 0) notes.push({ ...note, kind: "no-pocket-there", detail: sectorText(sector) });
    else {
      surrenderPocket(battle, pocket, today.date);
      redistance(battle.field);
      findPockets(battle);
    }
  }
};
