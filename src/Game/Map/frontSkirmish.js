/*! Open Historia — battlefields on the map: skirmishing along a front that stands still © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Nothing on a battlefield changes between time skips: the engine runs only in
// a skip, and what it did is played back once (FrontLayers.jsx). But a front
// that then stands stock still looks dead, and a war is not. So while a
// battlefield is at rest the map shows skirmishing along it: where troops of
// the two sides stand against each other, they push forward a little and come
// back, first one side and then the other, and the ground under each push
// changes colour and changes back. Only where they stand against each other:
// a troop with nobody in front of it has nobody to skirmish with, and stands.
// And the turns are taken place by place, so at any moment one side is
// pushing here and the other there.
//
// It is drawn and never kept. Every push is undone by the end of its turn, so
// nobody gains or loses anything, however long it is watched: it is what the
// front looks like while it holds, and what really happens happens in a skip.
// Everything here is worked out from the battlefield as it stands and the time
// on the clock, with no chance in it: the same moment always looks the same.
// Pure, and loads in plain Node.

import { PAINT_OWN_A, PAINT_OWN_B, PAINT_WALL } from "../../runtime/fronts/codec.js";
import { TROOP_STATES } from "../../runtime/fronts/constants.js";

// How near the other side's ground a troop stands to take part, how far past
// the edge of it a push goes, and how wide the ground under a push is, in km.
const CONTACT_KM = 13;
// How near a troop of the other side must stand for there to be anyone to
// skirmish with.
const OPPOSED_KM = 30;
const PUSH_PAST_KM = [2, 5.5];
const BITE_KM = 6.5;
// How long one exchange lasts, in seconds: one side pushes in its first half
// and the other in its second. Where in an exchange a place on the front is
// differs from place to place, smoothly, over this many km, so that the
// skirmishing runs along a front in waves and is never all at once; and how
// long it takes to get going once a battlefield has come to rest.
const EXCHANGE_SECONDS = 9;
const WAVE_KM = 110;
const WAVE_TURNS = 2.5;
const EASE_IN_SECONDS = 1.5;
// How many of a stretch's troops join an exchange.
const JOINING = 0.7;

// Who a troop's state lets skirmish: one that is dug in does not move, one
// that is cut off or spent has other things to see to.
const STANDS_STILL = new Set([TROOP_STATES[2], TROOP_STATES[3], TROOP_STATES[4]]);

// A number from 0 to 1 that depends on nothing but what it is given.
const chance = (a, b = 0, c = 0, d = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// A number from 0 to 1 that changes smoothly from place to place: the same for
// two places close together, whichever side's troops stand there.
const drift = (x, y) => {
  const col = Math.floor(x);
  const row = Math.floor(y);
  const fx = x - col;
  const fy = y - row;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = chance(col, row, 21) * (1 - sx) + chance(col + 1, row, 21) * sx;
  const bottom = chance(col, row + 1, 21) * (1 - sx) + chance(col + 1, row + 1, 21) * sx;
  return top * (1 - sy) + bottom * sy;
};

// How far each cell is from the nearest cell `isSource` picks, in cells (two
// passes of a 3-4 chamfer, which is near enough to round).
const distanceFrom = (cols, rows, isSource) => {
  const size = cols * rows;
  const out = new Float32Array(size);
  const far = 1e6;
  for (let cell = 0; cell < size; cell += 1) out[cell] = isSource(cell) ? 0 : far;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = row * cols + col;
      let best = out[cell];
      if (col > 0) best = Math.min(best, out[cell - 1] + 3);
      if (row > 0) {
        best = Math.min(best, out[cell - cols] + 3);
        if (col > 0) best = Math.min(best, out[cell - cols - 1] + 4);
        if (col < cols - 1) best = Math.min(best, out[cell - cols + 1] + 4);
      }
      out[cell] = best;
    }
  }
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      const cell = row * cols + col;
      let best = out[cell];
      if (col < cols - 1) best = Math.min(best, out[cell + 1] + 3);
      if (row < rows - 1) {
        best = Math.min(best, out[cell + cols] + 3);
        if (col < cols - 1) best = Math.min(best, out[cell + cols + 1] + 4);
        if (col > 0) best = Math.min(best, out[cell + cols - 1] + 4);
      }
      out[cell] = best;
    }
  }
  for (let cell = 0; cell < size; cell += 1) out[cell] /= 3;
  return out;
};

// A battlefield at rest, readied to skirmish: `drawing` is its troops as they
// stand (frontGeometry.js frontAt) and `player` its ground as it stands
// (frontPaint.js). null when nobody stands against the other side's ground.
export const createSkirmish = (drawing, player) => {
  if (!drawing || !player) return null;
  const { cols, rows, state, sideOf } = player;
  const size = cols * rows;
  const km = drawing.frame?.km > 0 ? drawing.frame.km : 4;
  // Whose each cell is: 0, 1, or 2 for sea and land outside the war.
  const side = new Uint8Array(size);
  const base = Uint8Array.from(state);
  for (let cell = 0; cell < size; cell += 1) side[cell] = base[cell] === PAINT_WALL ? 2 : sideOf(base[cell]);
  // For each side, how far each cell is from the other side's ground.
  const toFoe = [distanceFrom(cols, rows, (cell) => side[cell] === 1), distanceFrom(cols, rows, (cell) => side[cell] === 0)];
  const at = (field, x, y) => field[Math.max(0, Math.min(rows - 1, Math.floor(y))) * cols + Math.max(0, Math.min(cols - 1, Math.floor(x)))];
  const names = player.names ?? [];
  const firstOfB = drawing.sides?.[0]?.length ?? 0;
  const contact = CONTACT_KM / km;
  const opposed = OPPOSED_KM / km;
  const wave = Math.max(4, WAVE_KM / km);
  // Every troop that stands, of each side: whoever is there to be fought,
  // whatever it is doing.
  const standing = drawing.troops.map((list) => list.filter((troop) => troop && troop.strength > 0));

  const fighters = [];
  drawing.troops.forEach((list, own) => list.forEach((troop, index) => {
    if (!troop || !(troop.strength > 0) || STANDS_STILL.has(troop.state)) return;
    const col = Math.floor(troop.x);
    const row = Math.floor(troop.y);
    if (col < 0 || row < 0 || col >= cols || row >= rows || side[row * cols + col] !== own) return;
    const away = toFoe[own][row * cols + col];
    if (!(away <= contact)) return;
    // Somebody of the other side in front of it, or it has nobody to fight.
    if (!standing[1 - own].some((foe) => Math.abs(foe.x - troop.x) <= opposed && Math.abs(foe.y - troop.y) <= opposed
      && Math.hypot(foe.x - troop.x, foe.y - troop.y) <= opposed)) return;
    // Which way the other side's ground lies from it.
    let dx = at(toFoe[own], troop.x - 1.5, troop.y) - at(toFoe[own], troop.x + 1.5, troop.y);
    let dy = at(toFoe[own], troop.x, troop.y - 1.5) - at(toFoe[own], troop.x, troop.y + 1.5);
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-6)) return;
    dx /= length;
    dy /= length;
    // The state ground it pushes onto turns: its own country's colour.
    const member = (drawing.sides?.[own] ?? []).indexOf(troop.owner);
    const named = 1 + (own === 0 ? 0 : firstOfB) + Math.max(0, member);
    // Where in an exchange it is, by the place on the front it stands against:
    // the same place for the troops of the other side that face it, so the
    // two of them take turns.
    const phase = WAVE_TURNS * drift((troop.x + dx * away) / wave, (troop.y + dy * away) / wave);
    fighters.push({
      side: own, index, x: troop.x, y: troop.y, dx, dy, away, phase,
      paint: named <= names.length ? named : 0,
      seed: own * 100003 + index,
    });
  }));
  if (fighters.length === 0) return null;
  return { cols, rows, km, side, base, fighters, bite: Math.max(1.05, BITE_KM / km), began: null };
};

// The skirmishing at a moment, `seconds` on any clock that only goes forward:
//
//   moves   [{ side, index, x, y, push }] the troops that are out of their
//           places, where each is, and how far through its push (0 to 1)
//   cells, states, turned
//           the ground that is for the moment changing hands: a cell, the
//           state it is turning to (codec.js), and how far it has turned
//
// A troop not in `moves` stands where the battlefield has it, and ground not
// in `cells` is as the battlefield has it.
export const skirmishAt = (skirmish, seconds) => {
  const moves = [];
  if (!skirmish) return { moves, cells: new Int32Array(0), states: new Uint8Array(0), turned: new Float32Array(0) };
  if (skirmish.began === null) skirmish.began = seconds;
  const ease = Math.max(0, Math.min(1, (seconds - skirmish.began) / EASE_IN_SECONDS));
  const { cols, rows, km, side, base, bite } = skirmish;
  const bites = new Map();
  for (const fighter of skirmish.fighters) {
    // Where in an exchange its place on the front is.
    const turn = seconds / EXCHANGE_SECONDS + fighter.phase;
    const exchange = Math.floor(turn);
    const part = turn - exchange;
    if (chance(fighter.seed, exchange, 1) >= JOINING) continue;
    // One side pushes in the first half of an exchange and the other in the
    // second: which goes first changes from one exchange to the next.
    const first = chance(exchange, 31) < 0.5 ? 0 : 1;
    const start = (fighter.side === first ? 0.04 : 0.54) + 0.07 * chance(fighter.seed, exchange, 2);
    const length = 0.32 + 0.07 * chance(fighter.seed, exchange, 3);
    const through = (part - start) / length;
    if (!(through > 0 && through < 1)) continue;
    // Out and back: nothing at either end of it.
    const push = Math.sin(Math.PI * through) ** 1.2 * (0.7 + 0.3 * chance(fighter.seed, exchange, 4)) * ease;
    if (!(push > 0.01)) continue;
    const reach = fighter.away + (PUSH_PAST_KM[0] + (PUSH_PAST_KM[1] - PUSH_PAST_KM[0]) * chance(fighter.seed, exchange, 5)) / km;
    const across = ((chance(fighter.seed, exchange, 6) - 0.5) * 5) / km;
    const x = fighter.x + (fighter.dx * reach - fighter.dy * across) * push;
    const y = fighter.y + (fighter.dy * reach + fighter.dx * across) * push;
    moves.push({ side: fighter.side, index: fighter.index, x, y, push });
    // The ground round where it has got to turns its colour, the more the
    // nearer and the further the push has gone.
    const midX = x + fighter.dx * 0.35;
    const midY = y + fighter.dy * 0.35;
    const minCol = Math.max(0, Math.floor(midX - bite));
    const maxCol = Math.min(cols - 1, Math.floor(midX + bite));
    const minRow = Math.max(0, Math.floor(midY - bite));
    const maxRow = Math.min(rows - 1, Math.floor(midY + bite));
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const cell = row * cols + col;
        if (side[cell] !== 1 - fighter.side) continue;
        const distance = Math.hypot(col + 0.5 - midX, row + 0.5 - midY);
        const turned = Math.min(1, push * (1.3 - distance / bite) * 1.15);
        if (!(turned > 0.04)) continue;
        const known = bites.get(cell);
        if (known && known.turned >= turned) continue;
        // Ground the other side had taken goes back to being this side's own;
        // ground that was the other side's own is painted in the taker's name.
        const was = base[cell];
        const own = fighter.side === 0 ? PAINT_OWN_A : PAINT_OWN_B;
        const state = was === PAINT_OWN_A || was === PAINT_OWN_B ? fighter.paint || own : own;
        bites.set(cell, { state, turned });
      }
    }
  }
  const cells = new Int32Array(bites.size);
  const states = new Uint8Array(bites.size);
  const turned = new Float32Array(bites.size);
  let at = 0;
  for (const [cell, bitten] of bites) {
    cells[at] = cell;
    states[at] = bitten.state;
    turned[at] = bitten.turned;
    at += 1;
  }
  return { moves, cells, states, turned };
};
