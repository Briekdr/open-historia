/*! Open Historia — battlefields and fronts: supply, patches and pockets © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A side fights from its own country: the ground it holds that it is sovereign
// in, and wherever it has landed. Supply runs out from there through ground it
// holds, and thins with distance, so a thrust weakens the further it gets from
// home.
//
// A body of ground with no way back to a source is ENCLOSED, and what becomes
// of it depends on its size. A small patch, under 1,500 square kilometres, is
// filled the day the ring closes round it: the gap between two columns that
// have met, the sliver a thrust left behind. It goes to the other side at
// once and whoever stood in it is lost. A larger one is a POCKET, a real
// encirclement: it cannot attack, it defends at half, its troops waste away,
// and after ten days, or once no troop is left in it, it surrenders. Nothing
// fills a pocket early; it has to be starved out or walked into.
//
// What counts as a way back is the subtle part. Encirclements nearly always
// happen on the defender's own soil, where every cut-off piece still holds
// home ground: if home ground were a source wherever it lay, no defender could
// ever be encircled at home. And a peninsula or an island that is a side's
// home ground but joined to its mainland only by sea must not count as cut off
// merely for being the smaller piece. So home ground is read in its connected
// pieces, and of all the bodies a side holds, the one holding the most of a
// piece of home ground is the one that piece feeds. A body the other side's
// ground touches nowhere is left alone: it is cut off from no one.
//
// For a group, which is sovereign nowhere, the area it held when the run began
// stands for its home ground: otherwise every rising would be a pocket.

import {
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  PATCH_MAX_KM2,
  POCKET_DAYS,
  SUPPLY_EVERY_DAYS,
  SUPPLY_FAR_FACTOR,
  SUPPLY_FULL_KM,
  SUPPLY_LEAST,
} from "./constants.js";
import { bodiesOf, ownCell, takeCells } from "./field.js";
import { describePoint } from "./sectors.js";
import { isLive } from "./troops.js";

const cellOf = (field, x, y) => (x >= 0 && y >= 0 && x < field.cols && y < field.rows ? Math.floor(y) * field.cols + Math.floor(x) : -1);

// The member of a side whose troops are nearest a cell: who newly won ground
// is painted for when no one troop took it. Member 0 when the side has no
// troop left. Of two equally near, the lower in the list.
export const nearestOwner = (battle, side) => (cell) => {
  const x = (cell % battle.field.cols) + 0.5;
  const y = Math.floor(cell / battle.field.cols) + 0.5;
  let best = Infinity;
  let owner = 0;
  for (const troop of battle.troops[side]) {
    if (!isLive(troop)) continue;
    const dx = troop.x - x;
    const dy = troop.y - y;
    if (dx * dx + dy * dy < best) {
      best = dx * dx + dy * dy;
      owner = troop.owner;
    }
  }
  return owner;
};

// The connected pieces of a side's home ground: its mainland, a peninsula
// joined only by sea, an island. piece[cell] is the piece a cell of its home
// ground belongs to, -1 for any other cell. Home ground does not move with
// the line, so this is worked out once for each reading of the regions.
const homePieces = (battle, side) => {
  battle.homePieces ??= [null, null];
  const known = battle.homePieces[side];
  if (known && known.homeSide === battle.homeSide && known.size === battle.field.size) return known;
  const { field, arena } = battle;
  const { cols, rows, size } = field;
  const piece = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  const home = (index) => field.play[index] === 1 && battle.homeSide[arena.region[index]] === side;
  let count = 0;
  for (let seed = 0; seed < size; seed += 1) {
    if (piece[seed] >= 0 || !home(seed)) continue;
    let head = 0;
    let tail = 0;
    queue[tail] = seed;
    tail += 1;
    piece[seed] = count;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      const col = index % cols;
      const row = (index - col) / cols;
      for (let step = 0; step < 4; step += 1) {
        const next = step === 0 ? (row > 0 ? index - cols : -1)
          : step === 1 ? (col > 0 ? index - 1 : -1)
            : step === 2 ? (col < cols - 1 ? index + 1 : -1)
              : (row < rows - 1 ? index + cols : -1);
        if (next < 0 || piece[next] >= 0 || !home(next)) continue;
        piece[next] = count;
        queue[tail] = next;
        tail += 1;
      }
    }
    count += 1;
  }
  battle.homePieces[side] = { homeSide: battle.homeSide, size, piece, count };
  return battle.homePieces[side];
};

// Which of the bodies of ground a side holds are supplied, and which of them
// the other side's ground touches.
//
// A body is supplied when, of all the bodies its side holds, it is the one
// holding the most of the piece of home ground it holds most of: the main
// part of the mainland, the main part of a peninsula. Every other body is cut
// off: a lesser part of a piece of home ground (a pocket on a side's own soil),
// or ground with no home in it at all (taken ground severed from the rest).
// Where a side has landed, that body is supplied whatever else is true.
const suppliedBodies = (battle, side) => {
  const { field } = battle;
  const { cols, rows, size, holders } = field;
  const bodies = bodiesOf(field, side);
  const pieces = homePieces(battle, side);
  // How much of each piece of home ground each body holds.
  const held = new Map();
  const touched = new Uint8Array(bodies.count);
  for (let index = 0; index < size; index += 1) {
    const body = bodies.label[index];
    if (body < 0) continue;
    if (pieces.piece[index] >= 0) {
      const key = body * pieces.count + pieces.piece[index];
      held.set(key, (held.get(key) ?? 0) + 1);
    }
    if (touched[body]) continue;
    const col = index % cols;
    const row = (index - col) / cols;
    const other = 1 - side;
    if ((row > 0 && holders[index - cols] === other) || (col > 0 && holders[index - 1] === other)
      || (col < cols - 1 && holders[index + 1] === other) || (row < rows - 1 && holders[index + cols] === other)) touched[body] = 1;
  }
  // The piece each body holds most of, and for each piece the body that holds most of it.
  const mostOf = new Int32Array(bodies.count).fill(-1);
  const mostHeld = new Int32Array(bodies.count);
  const holderOf = new Int32Array(pieces.count).fill(-1);
  const heldBy = new Int32Array(pieces.count);
  for (let body = 0; body < bodies.count; body += 1) {
    for (let piece = 0; piece < pieces.count; piece += 1) {
      const cells = held.get(body * pieces.count + piece) ?? 0;
      if (cells > mostHeld[body]) {
        mostHeld[body] = cells;
        mostOf[body] = piece;
      }
    }
  }
  for (let body = 0; body < bodies.count; body += 1) {
    const piece = mostOf[body];
    if (piece >= 0 && mostHeld[body] > heldBy[piece]) {
      heldBy[piece] = mostHeld[body];
      holderOf[piece] = body;
    }
  }
  const supplied = new Uint8Array(bodies.count);
  for (let piece = 0; piece < pieces.count; piece += 1) if (holderOf[piece] >= 0) supplied[holderOf[piece]] = 1;
  for (const anchor of battle.anchors) {
    if (anchor.s !== side) continue;
    const cell = cellOf(field, anchor.x, anchor.y);
    if (cell >= 0 && bodies.label[cell] >= 0) supplied[bodies.label[cell]] = 1;
  }
  // A side with no home ground on this battlefield at all (its country lies
  // beyond the frame) is fed through the largest body it holds.
  if (pieces.count === 0 && !supplied.some((value) => value === 1) && bodies.count > 0) {
    let largest = 0;
    for (let body = 1; body < bodies.count; body += 1) if (bodies.sizes[body] > bodies.sizes[largest]) largest = body;
    supplied[largest] = 1;
  }
  return { bodies, supplied, touched };
};

// Finds the enclosed ground as it now lies. battle.pockets becomes
// [{ s, cell, days, km2 }], a pocket that was already one keeping the days it
// has stood, and battle.pocketOf[side][cell] the entry a cell is in, or -1.
// Worked out again only when ground has changed hands.
export const findPockets = (battle) => {
  const { field, place } = battle;
  if (battle.pocketTurns === field.turns && battle.pocketOf) return;
  const before = battle.pocketOf;
  const known = battle.pockets;
  const pockets = [];
  const pocketOf = [new Int32Array(field.size).fill(-1), new Int32Array(field.size).fill(-1)];
  battle.supplied = [null, null];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const { bodies, supplied, touched } = suppliedBodies(battle, side);
    battle.supplied[side] = supplied;
    const pocketOfBody = new Int32Array(bodies.count).fill(-1);
    for (let index = 0; index < field.size; index += 1) {
      const body = bodies.label[index];
      // Cut off, and with the other side's ground against it somewhere.
      if (body < 0 || supplied[body] || !touched[body]) continue;
      if (pocketOfBody[body] < 0) {
        pocketOfBody[body] = pockets.length;
        pockets.push({ s: side, cell: index, days: 0, km2: 0 });
      }
      const pocket = pockets[pocketOfBody[body]];
      const km = place.rowKm[Math.floor(index / field.cols)];
      pocket.km2 += km * km;
      pocketOf[side][index] = pocketOfBody[body];
      // Any cell it shares with a pocket that was there before makes it that
      // pocket still, however it has shrunk.
      const was = before ? before[side][index] : known.findIndex((entry) => entry.s === side && entry.cell === index);
      if (was >= 0 && known[was] && known[was].days > pocket.days) pocket.days = known[was].days;
    }
  }
  battle.pockets = pockets;
  battle.pocketOf = pocketOf;
  battle.pocketTurns = field.turns;
};

// Which troops stand in a pocket today.
export const markPockets = (battle) => {
  findPockets(battle);
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const troop of battle.troops[side]) {
      const cell = ownCell(battle.field, side, troop.x, troop.y);
      troop.pocket = isLive(troop) && cell >= 0 && battle.pocketOf[side][cell] >= 0;
    }
  }
};

// Enclosed ground goes to the other side: every cell of it, painted for the
// member whose troops are nearest, and the troops that stood in it are lost.
// The log says where, once: `kind` is "pocket" for one that gave up, "overrun"
// for a patch that was filled with someone in it.
const giveUp = (battle, index, date, kind) => {
  const { field, arena } = battle;
  const pocket = battle.pockets[index];
  const cells = [];
  let sumX = 0;
  let sumY = 0;
  for (let cell = 0; cell < field.size; cell += 1) {
    if (battle.pocketOf[pocket.s][cell] !== index) continue;
    cells.push(cell);
    sumX += (cell % field.cols) + 0.5;
    sumY += Math.floor(cell / field.cols) + 0.5;
  }
  let lost = 0;
  for (const troop of battle.troops[pocket.s]) {
    const cell = ownCell(field, pocket.s, troop.x, troop.y);
    if (!isLive(troop) || cell < 0 || battle.pocketOf[pocket.s][cell] !== index) continue;
    troop.strength = 0;
    lost += 1;
  }
  if (cells.length === 0) return;
  takeCells(field, 1 - pocket.s, cells, nearestOwner(battle, 1 - pocket.s));
  const at = describePoint(arena, sumX / cells.length, sumY / cells.length);
  if (at && (kind === "pocket" || lost > 0)) battle.log.push({ d: date, k: kind, s: pocket.s, at });
};

// A pocket surrenders now (the story said so): `index` is its place in battle.pockets.
export const surrenderPocket = (battle, index, date) => giveUp(battle, index, date, "pocket");

// After the day's sweeps: every enclosed patch under the size of a pocket is
// filled. true when any was.
export const fillPatches = (battle, date) => {
  findPockets(battle);
  let any = false;
  for (let index = 0; index < battle.pockets.length; index += 1) {
    if (battle.pockets[index].km2 >= PATCH_MAX_KM2) continue;
    giveUp(battle, index, date, "overrun");
    any = true;
  }
  if (any) findPockets(battle);
  return any;
};

// The end of a day for the pockets: each is a day older, and one that has
// stood its ten days, or has no troop left in it, surrenders. true when any did.
export const agePockets = (battle, date) => {
  findPockets(battle);
  let any = false;
  const manned = new Uint8Array(battle.pockets.length);
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    for (const troop of battle.troops[side]) {
      const cell = ownCell(battle.field, side, troop.x, troop.y);
      if (isLive(troop) && cell >= 0 && battle.pocketOf[side][cell] >= 0) manned[battle.pocketOf[side][cell]] = 1;
    }
  }
  for (let index = 0; index < battle.pockets.length; index += 1) {
    const pocket = battle.pockets[index];
    pocket.days += 1;
    if (manned[index] && pocket.days < POCKET_DAYS) continue;
    giveUp(battle, index, date, "pocket");
    any = true;
  }
  if (any) findPockets(battle);
  return any;
};

// How well supplied each cell a side holds is, 1 at home falling to the least
// far from it: the shortest way back to a source through the side's own
// ground, counted five for a step along a row or a column and seven for a
// step on the diagonal. Worked out every few days, and only if ground changed
// hands since.
export const refreshSupply = (battle, day, era) => {
  const { field, arena } = battle;
  if (battle.supply && (day % SUPPLY_EVERY_DAYS !== 0 || battle.supplyTurns === field.turns)) return;
  findPockets(battle);
  const { cols, rows, size } = field;
  const fullKm = SUPPLY_FULL_KM[era];
  const farKm = fullKm * SUPPLY_FAR_FACTOR;
  const kmEach = arena.frame.km / 5;
  battle.supply = [null, null];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const bodies = bodiesOf(field, side);
    const supplied = battle.supplied[side];
    const cost = new Int32Array(size).fill(-1);
    const rounds = [[], [], [], [], [], [], [], []];
    let waiting = 0;
    const reach = (index, value) => {
      if (cost[index] >= 0 && cost[index] <= value) return;
      cost[index] = value;
      rounds[value & 7].push(index);
      waiting += 1;
    };
    let homeless = true;
    for (let index = 0; index < size; index += 1) {
      if (field.holders[index] !== side || !supplied[bodies.label[index]] || battle.homeSide[arena.region[index]] !== side) continue;
      reach(index, 0);
      homeless = false;
    }
    for (const anchor of battle.anchors) {
      const cell = cellOf(field, anchor.x, anchor.y);
      if (anchor.s === side && cell >= 0 && field.holders[cell] === side) {
        reach(cell, 0);
        homeless = false;
      }
    }
    // With its country beyond the frame, a side is at home wherever it is fed.
    if (homeless) {
      for (let index = 0; index < size; index += 1) if (field.holders[index] === side && supplied[bodies.label[index]]) reach(index, 0);
    }
    for (let value = 0; waiting > 0; value += 1) {
      const round = rounds[value & 7];
      for (let position = 0; position < round.length; position += 1) {
        const index = round[position];
        waiting -= 1;
        if (cost[index] !== value) continue;
        const col = index % cols;
        const row = (index - col) / cols;
        for (let dy = -1; dy <= 1; dy += 1) {
          const y = row + dy;
          if (y < 0 || y >= rows) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const x = col + dx;
            if ((dx === 0 && dy === 0) || x < 0 || x >= cols || field.holders[y * cols + x] !== side) continue;
            reach(y * cols + x, value + (dx !== 0 && dy !== 0 ? 7 : 5));
          }
        }
      }
      round.length = 0;
    }
    const supply = new Float32Array(size);
    for (let index = 0; index < size; index += 1) {
      if (field.holders[index] !== side) continue;
      const km = cost[index] < 0 ? Infinity : cost[index] * kmEach;
      supply[index] = km <= fullKm ? 1 : km >= farKm ? SUPPLY_LEAST : 1 - ((1 - SUPPLY_LEAST) * (km - fullKm)) / (farKm - fullKm);
    }
    battle.supply[side] = supply;
  }
  battle.supplyTurns = field.turns;
};

// How well supplied each troop is where it stands today.
export const markSupply = (battle) => {
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const supply = battle.supply?.[side];
    for (const troop of battle.troops[side]) {
      const cell = ownCell(battle.field, side, troop.x, troop.y);
      const value = supply && cell >= 0 ? supply[cell] : 0;
      // Ground taken since supply was last worked out has no figure yet: a
      // troop standing on it is as well supplied as it was.
      if (value > 0) troop.supply = value;
    }
  }
};
