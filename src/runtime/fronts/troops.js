/*! Open Historia — battlefields and fronts: the troops © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A side's troops are counters the engine raises and moves: the player and the
// model never place one. They are individuals, not a rank. Each draws its own
// drive, depth, lane and lag for a run, so no two stand evenly spaced, none
// stands at the same depth behind the line, and they do not set off together.
//
// A troop has a LANE: its place along the line is where it already stands,
// and the troops of a side never swap places along it. What a side orders is
// where its weight goes: even weight spreads it out, a blitz masses it on a
// sector, a spearhead piles it behind one point. Each troop's ideal place
// follows from that weight and its own rank in the line, and it drifts toward
// it a little each day, so massing shows as columns converging over days and
// never as a row being dealt again.
//
// Nobody walks back into a row. A troop that carved its way forward stays
// where it ended up when the attack is over; one that is not attacking walks
// up behind the line only from a long way back, or off ground that is no
// longer its side's.
//
// A troop as it is saved is { x, y, strength, kind, owner, named, dig, state }
// (codec.js). The rest of what one carries here is the working state of a run.

import { hashSeed } from "../unitMotion.js";
import {
  ARMOUR_SHARE_BY_ERA,
  ARTILLERY_SHARE_BY_ERA,
  CONTROL_RADIUS_MAX_KM,
  CONTROL_RADIUS_MIN_CELLS,
  CONTROL_RADIUS_MIN_KM,
  CONTROL_RADIUS_OF_SPACING,
  EFFORT_FACTORS,
  DRIFT_SHARE,
  ENCIRCLE_APART_KM,
  ENCIRCLE_APART_SHARE,
  FALL_BACK_KM_PER_DAY,
  FALL_BACK_MAX_KM,
  FLANK_OPEN_RADII,
  FOOT_REACH_CELLS,
  HOLDER_SIDE_A,
  LANE_GAP_MIN,
  MARCH_LEGS_MAX,
  MARCH_LEG_CELLS,
  MAX_TROOPS_PER_SIDE,
  QUALITY_MAX,
  QUALITY_MIN,
  REACH_KM,
  REACH_MIN_CELLS,
  SPEARHEAD_PEAK,
  SPEARHEAD_WIDTH_KM,
  STAND_OFF_FAR,
  STAND_OFF_FAR_RADII,
  STAND_OFF_KM,
  STEER_INERTIA,
  STEER_ROOM,
  STEER_ROOM_RADII,
  STUCK_DAYS,
  TRAIT_DEPTH,
  TRAIT_DRIVE,
  TRAIT_LAG_DAYS,
  TRAIT_LANE,
  TROOPS_LINE_KM_EACH,
  TROOPS_MIN,
  TROOPS_PER_STRENGTH,
  TURNS,
  WEIGHT_ADVANCE,
  WEIGHT_BLITZ,
} from "./constants.js";
import { bodiesOf, nearest, nearestOnContour, ownCell, readField } from "./field.js";
import { inSector, sectorMiddle } from "./sectors.js";

export const KIND_INFANTRY = 0;
export const KIND_ARMOUR = 1;
export const KIND_ARTILLERY = 2;
export const STATE_HOLDING = 0;
export const STATE_ADVANCING = 1;
export const STATE_ENCIRCLED = 2;
export const STATE_SPENT = 3;

const ATTACKS = new Set(["advance", "blitz", "spearhead", "encircle", "flank"]);
export const isAttack = (word) => ATTACKS.has(word);

export const createTroop = ({ x = 0, y = 0, strength = 100, kind = KIND_INFANTRY, owner = 0, named = false, dig = 0, state = STATE_HOLDING } = {}) => ({
  x,
  y,
  strength,
  kind,
  owner,
  named,
  dig,
  state,
  // Its side's control radius, in kilometres (sideRadiusKm).
  radiusKm: CONTROL_RADIUS_MAX_KM,
  // What it drew for this run; an even hand until it draws.
  drive: 1,
  depth: 1,
  lane: 0,
  lag: 0,
  drawn: false,
  // Which way it is going, a unit vector, or nothing yet; and the axis of
  // the attack it is on, which it never goes backwards along (combat.js).
  hx: 0,
  hy: 0,
  axisX: 0,
  axisY: 0,
  axisFor: null,
  under: null,
  // The order it is driving a spearhead or a pincer for, and where at.
  thrustFor: null,
  thrustAim: null,
  // Where it stands against the line today (planLanes).
  station: null,
  // What it did today, and how far it walked forward yesterday.
  task: "",
  attacking: false,
  wasAttacking: false,
  stepping: false,
  stepped: false,
  walkedToday: false,
  walkedCells: 0,
  walkedBefore: 0,
  power: 0,
  // How it stands against the attackers in reach of it this moment (combat.js).
  flank: 1,
  flankMoment: -1,
  faceX: 0,
  faceY: 0,
  movedKm: 0,
  loss: 0,
  pinned: false,
  engaged: false,
  // Where it stands in the war.
  body: -1,
  pocket: false,
  besieged: false,
  supply: 1,
  stuck: 0,
});

export const isLive = (troop) => troop.strength > 0;
export const liveCount = (troops) => troops.reduce((count, troop) => count + (troop.strength > 0 ? 1 : 0), 0);

// A side's control radius, in kilometres: nine tenths of the length of line
// each of its troops has, within bounds. The same for every troop of the
// side, and worked out once a run.
export const sideRadiusKm = (lineKm, troops) =>
  Math.min(CONTROL_RADIUS_MAX_KM, Math.max(CONTROL_RADIUS_MIN_KM, (CONTROL_RADIUS_OF_SPACING * lineKm) / Math.max(1, troops)));
// How far to either side of its path the ground becomes its side's, in cells.
export const controlRadius = (troop, kmAt) => Math.max(CONTROL_RADIUS_MIN_CELLS, troop.radiusKm / kmAt(troop.y));
// How far a troop standing on a row fights, in cells.
export const reachCells = (kmAt, y) => Math.max(REACH_MIN_CELLS, REACH_KM / kmAt(y));
// How far behind the line it stands when it is not attacking, in cells.
export const standOff = (troop, kmAt) => (STAND_OFF_KM[troop.kind] * troop.depth) / kmAt(troop.y);

// Whether a point is on a side's own ground: in a cell it holds, or on its
// side of the line where the line runs through the cell.
export const stands = (field, side, x, y) => {
  if (!(x >= 0) || !(y >= 0) || x >= field.cols || y >= field.rows) return false;
  const cell = Math.floor(y) * field.cols + Math.floor(x);
  if (!field.play[cell]) return false;
  if (field.holders[cell] === side) return true;
  const value = readField(field, x, y);
  return side === HOLDER_SIDE_A ? value < 0 : value > 0;
};

// What a troop draws for a run, from the seed and who it is and nothing else:
// the same run always deals the same hand. `even` deals everyone the same,
// for a test that measures one thing at a time.
export const drawTraits = (troop, seed, name, side, index, even = false) => {
  troop.drawn = true;
  if (even) return;
  const draw = (trait) => (hashSeed([seed, name, side, index, trait].join("|")) % 10000) / 10000;
  troop.drive = TRAIT_DRIVE[0] + (TRAIT_DRIVE[1] - TRAIT_DRIVE[0]) * draw("drive");
  troop.depth = TRAIT_DEPTH[0] + (TRAIT_DEPTH[1] - TRAIT_DEPTH[0]) * draw("depth");
  troop.lane = TRAIT_LANE[0] + (TRAIT_LANE[1] - TRAIT_LANE[0]) * draw("lane");
  troop.lag = TRAIT_LAG_DAYS[Math.min(TRAIT_LAG_DAYS.length - 1, Math.floor(TRAIT_LAG_DAYS.length * draw("lag")))];
};

// ---- raising -------------------------------------------------------------------

// The most counters a side may have on a line of `lineKm`: one for every
// stretch of it, so that a short front is not stacked.
export const troopsCap = (lineKm) => Math.max(TROOPS_MIN, Math.min(MAX_TROOPS_PER_SIDE, Math.floor(lineKm / TROOPS_LINE_KM_EACH)));

// How many counters each side has on a line of `lineKm`. Each is sized by
// its own strength (what its members bring here) and the effort it is making,
// and by nothing of the other side's: a great power fields hundreds, a small
// state a dozen or two. What the count cannot carry of a side's strength,
// because the line is too short for it or the least is more than it has, its
// quality carries as far as quality goes; where both sides are over, only what
// one has over the other.
export const sizeSides = (lineKm, strengths, efforts = ["major", "major"]) => {
  const cap = troopsCap(lineKm);
  const wanted = strengths.map((strength, side) => TROOPS_PER_STRENGTH * Math.max(0, strength) * (EFFORT_FACTORS[efforts[side]] ?? 1));
  const counts = wanted.map((count) => Math.max(TROOPS_MIN, Math.min(cap, Math.round(count))));
  const over = wanted.map((count, side) => count / counts[side]);
  const both = Math.max(1, Math.min(over[0], over[1]));
  const quality = over.map((share) => Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, share / both)));
  return { counts, quality };
};

// A key that spreads equal things evenly: the fractional part of a multiple of
// the golden ratio.
const spread = (index) => {
  const turned = (index + 1) * 0.6180339887498949;
  return turned - Math.floor(turned);
};

// The kinds of `count` counters in an era, in the order they stand along the
// line: so many armour (cavalry before the tank) and so many artillery, spread
// along it rather than bunched at one end, the rest infantry.
export const kindsFor = (count, era) => {
  const armour = Math.round(count * ARMOUR_SHARE_BY_ERA[era]);
  const artillery = Math.min(count - armour, Math.round(count * ARTILLERY_SHARE_BY_ERA[era]));
  const ranked = Array.from({ length: count }, (_, index) => index).sort((a, b) => spread(a) - spread(b) || a - b);
  const kinds = new Array(count).fill(KIND_INFANTRY);
  ranked.forEach((rank, turn) => {
    if (turn < armour) kinds[rank] = KIND_ARMOUR;
    else if (turn < armour + artillery) kinds[rank] = KIND_ARTILLERY;
  });
  return kinds;
};

// `count` things shared among holders in proportion to their weights, whole
// numbers that add up to it: what is left over goes to the largest remainders,
// the earlier holder first.
export const shareOut = (count, weights) => {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const parts = weights.map((weight) => (total > 0 ? (count * Math.max(0, weight)) / total : count / weights.length));
  const shares = parts.map((part) => Math.floor(part));
  let left = count - shares.reduce((sum, share) => sum + share, 0);
  const order = parts.map((part, index) => index).sort((a, b) => (parts[b] - shares[b]) - (parts[a] - shares[a]) || a - b);
  for (let turn = 0; left > 0; turn += 1, left -= 1) shares[order[turn % order.length]] += 1;
  return shares;
};

// ---- lanes ---------------------------------------------------------------------

const wordWeight = (word) => (word === "advance" ? WEIGHT_ADVANCE : word === "blitz" ? WEIGHT_BLITZ : 1);

// Reads every live troop of a side against today's line.
//
//   views   that side's standing orders as they read today (orders.js):
//           [{ word, sector, target, age }], the later taking precedence
//
// Each troop's `station` becomes null (its body of ground touches no line: it
// rests where it is) or
//   { lx, ly          its foot: the point of its side's line nearest it
//     nx, ny          the line's normal there, from side A toward side B
//     tx, ty          the line's direction there, the way its lane runs
//     vertex, km      the nearest vertex of the line, and how far along it
//     distance        how far it stands from its foot, in cells
//     place           how far along its own body's line its foot is, in km
//     ideal           where along it the orders would have it, in km
//     idealX, idealY, idealNx, idealNy     that place as a point, and the normal there
//     low, high       how far along the line it may drift before it meets a neighbour
//     before, after   its neighbours in the lane (indexes of troops), or -1
//     view            which order governs the stretch it stands on (-1: none, so hold)
//     idealView       and the stretch its ideal place is on
//     aim, thrust }   for a troop in a spearhead or a pincer: where it drives
//
// Returns { governing, lanes }: the governing order of each vertex of the
// line, and the side's troops in the order they stand along it.
export const planLanes = (battle, side, line, views) => {
  const { field, place } = battle;
  const { kmAt } = place;
  const { contour, count } = line;
  const troops = battle.troops[side];
  const bodies = bodiesOf(field, side);
  const own = side === HOLDER_SIDE_A ? contour.cellA : contour.cellB;

  const body = new Int32Array(count).fill(-1);
  const governing = new Int16Array(count).fill(-1);
  const weight = new Float64Array(count).fill(1);
  const starts = [];
  for (let index = 0; index < contour.strands.length; index += 1) {
    const { first, count: length } = contour.strands[index];
    starts.push(line.km[first]);
    for (let step = 0; step < length; step += 1) {
      const vertex = first + step;
      if (own[vertex] >= 0) body[vertex] = bodies.label[own[vertex]];
      else if (step > 0) body[vertex] = body[vertex - 1];
    }
    // A strand that begins on a wall borrows from the vertex after it.
    for (let step = length - 2; step >= 0; step -= 1) if (body[first + step] < 0) body[first + step] = body[first + step + 1];
  }
  starts.push(line.total);
  for (let vertex = 0; vertex < count; vertex += 1) {
    for (let index = 0; index < views.length; index += 1) {
      if (inSector(views[index].sector, contour.x[vertex], contour.y[vertex], kmAt)) governing[vertex] = index;
    }
    if (governing[vertex] >= 0) weight[vertex] = wordWeight(views[governing[vertex]].word);
  }

  // Spearheads and pincers: a peak of weight on the line, and somewhere to drive.
  const strandKm = (vertex) => starts[line.strand[vertex] + 1] - starts[line.strand[vertex]];
  const along = (a, b) => {
    if (line.strand[a] !== line.strand[b]) return Infinity;
    const apart = Math.abs(line.km[a] - line.km[b]);
    return contour.strands[line.strand[a]].closed ? Math.min(apart, strandKm(a) - apart) : apart;
  };
  // Where a spearhead, a pincer or a flank puts its weight, as vertices of
  // today's line with the point each drives at.
  const peaksOf = (index, view) => {
    const [aimX, aimY] = view.target ? [view.target.x, view.target.y] : sectorMiddle(line, view.sector, kmAt);
    let anchor = -1;
    let least = Infinity;
    for (let vertex = 0; vertex < count; vertex += 1) {
      if (governing[vertex] !== index) continue;
      const dx = contour.x[vertex] - aimX;
      const dy = contour.y[vertex] - aimY;
      if (dx * dx + dy * dy < least) {
        least = dx * dx + dy * dy;
        anchor = vertex;
      }
    }
    if (anchor < 0) return [];
    if (view.word === "spearhead") return [{ view: index, vertex: anchor, aim: view.target ? [aimX, aimY] : null }];
    // Two pincers, either side of the point nearest the objective, driving to
    // meet beyond it: as far past it as they started from that point.
    const apartKm = Math.min(ENCIRCLE_APART_KM, strandKm(anchor) * ENCIRCLE_APART_SHARE);
    const beyond = apartKm / kmAt(aimY);
    const reach = Math.sqrt(least);
    const meet = view.target && reach > 0
      ? [aimX + ((aimX - contour.x[anchor]) / reach) * beyond, aimY + ((aimY - contour.y[anchor]) / reach) * beyond]
      : null;
    const wings = [];
    for (const way of [-1, 1]) {
      let pincer = anchor;
      let best = Infinity;
      const { first, count: length } = contour.strands[line.strand[anchor]];
      for (let step = 0; step < length; step += 1) {
        const vertex = first + step;
        const signed = (line.km[vertex] - line.km[anchor]) * way;
        const off = Math.abs(signed - apartKm);
        if (governing[vertex] === index && signed >= 0 && off < best) {
          best = off;
          pincer = vertex;
        }
      }
      wings.push({ view: index, vertex: pincer, aim: meet });
    }
    if (view.word === "encircle") return wings;
    // A flank is one pincer: the wing whose way round the objective is the
    // more open, by the defenders standing near the middle of it.
    const open = wings.map((wing) => {
      const midX = (contour.x[wing.vertex] + (meet ? meet[0] : aimX)) / 2;
      const midY = (contour.y[wing.vertex] + (meet ? meet[1] : aimY)) / 2;
      const near = (FLANK_OPEN_RADII * (battle.radiusKm?.[side] ?? CONTROL_RADIUS_MAX_KM)) / kmAt(midY);
      let defenders = 0;
      for (const enemy of battle.troops[1 - side]) {
        const dx = enemy.x - midX;
        const dy = enemy.y - midY;
        if (isLive(enemy) && dx * dx + dy * dy <= near * near) defenders += 1;
      }
      return defenders;
    });
    return [wings[open[1] < open[0] ? 1 : 0]];
  };
  const peaks = [];
  for (let index = 0; index < views.length; index += 1) {
    const view = views[index];
    if (view.word !== "spearhead" && view.word !== "encircle" && view.word !== "flank") continue;
    // The plan is made against the line as it stood when the order was first
    // read, and kept: an attack bends the line, and where the weight was to
    // go is not to move because of it.
    const order = view.order ?? view;
    if (order.peaksFor !== view.word) {
      order.peaksFor = view.word;
      order.peaks = peaksOf(index, view).map((peak) => ({ x: contour.x[peak.vertex], y: contour.y[peak.vertex], aim: peak.aim }));
    }
    for (const kept of order.peaks) {
      let vertex = -1;
      let least = Infinity;
      for (let other = 0; other < count; other += 1) {
        if (governing[other] !== index) continue;
        const dx = contour.x[other] - kept.x;
        const dy = contour.y[other] - kept.y;
        if (dx * dx + dy * dy < least) {
          least = dx * dx + dy * dy;
          vertex = other;
        }
      }
      if (vertex >= 0) peaks.push({ view: index, vertex, aim: kept.aim });
    }
  }
  const half = SPEARHEAD_WIDTH_KM / 2;
  for (const peak of peaks) {
    const { first, count: length } = contour.strands[line.strand[peak.vertex]];
    for (let step = 0; step < length; step += 1) {
      const off = along(first + step, peak.vertex);
      if (off < half) weight[first + step] += SPEARHEAD_PEAK * (1 - off / half);
    }
  }

  // The stretches of line each body of ground has, in the line's own order,
  // and how far along its body's line each vertex is: a troop's lane runs
  // along its own body's line and nobody else's.
  const laneAt = new Float64Array(count);
  const stretches = new Map();
  for (const { first, count: length, closed } of contour.strands) {
    const segments = closed ? length : length - 1;
    for (let step = 0; step < segments; step += 1) {
      const from = first + step;
      const to = first + ((step + 1) % length);
      if (body[from] < 0 || body[from] !== body[to]) continue;
      const lengthKm = (to > from ? line.km[to] : starts[line.strand[from] + 1]) - line.km[from];
      if (!(lengthKm > 0)) continue;
      let stretch = stretches.get(body[from]);
      if (!stretch) {
        stretch = { list: [], length: 0 };
        stretches.set(body[from], stretch);
      }
      laneAt[from] = stretch.length;
      stretch.list.push(from, to, lengthKm, stretch.length);
      stretch.length += lengthKm;
      if (to > from) laneAt[to] = stretch.length;
    }
  }

  // Each troop's foot on its own body's line.
  for (let index = 0; index < troops.length; index += 1) {
    const troop = troops[index];
    troop.station = null;
    if (!isLive(troop)) continue;
    const standing = ownCell(field, side, troop.x, troop.y);
    troop.body = standing >= 0 ? bodies.label[standing] : -1;
    const stretch = troop.body >= 0 ? stretches.get(troop.body) : null;
    if (!stretch) continue;
    let from = -1;
    let to = -1;
    let part = 0;
    let lengthKm = 0;
    let at = 0;
    // The foot is looked for from a little way along its heading. A troop at
    // the head of its own salient stands in the middle of the arc it swept,
    // as near one point of it as another: the one it is heading for is its foot.
    const lead = controlRadius(troop, kmAt) * 0.5;
    if (nearestOnContour(field, contour, troop.x + troop.hx * lead, troop.y + troop.hy * lead, FOOT_REACH_CELLS) !== Infinity && body[contour.from[nearest.segment]] === troop.body && body[contour.to[nearest.segment]] === troop.body) {
      from = contour.from[nearest.segment];
      to = contour.to[nearest.segment];
      part = nearest.along;
      lengthKm = (to > from ? line.km[to] : starts[line.strand[from] + 1]) - line.km[from];
      at = laneAt[from];
    } else {
      // Too far from the line, or nearest another body's: the nearest end of a stretch of its own.
      let best = Infinity;
      for (let item = 0; item < stretch.list.length; item += 4) {
        for (let end = 0; end < 2; end += 1) {
          const vertex = stretch.list[item + end];
          const dx = contour.x[vertex] - troop.x;
          const dy = contour.y[vertex] - troop.y;
          if (dx * dx + dy * dy >= best) continue;
          best = dx * dx + dy * dy;
          from = stretch.list[item];
          to = stretch.list[item + 1];
          part = end;
          lengthKm = stretch.list[item + 2];
          at = stretch.list[item + 3];
        }
      }
    }
    const sx = contour.x[to] - contour.x[from];
    const sy = contour.y[to] - contour.y[from];
    const span = Math.sqrt(sx * sx + sy * sy);
    let nx = line.nx[from] + (line.nx[to] - line.nx[from]) * part;
    let ny = line.ny[from] + (line.ny[to] - line.ny[from]) * part;
    const length = Math.sqrt(nx * nx + ny * ny);
    nx = length > 0 ? nx / length : span > 0 ? sy / span : 0;
    ny = length > 0 ? ny / length : span > 0 ? -sx / span : 0;
    const lx = contour.x[from] + sx * part;
    const ly = contour.y[from] + sy * part;
    const vertex = part < 0.5 ? from : to;
    troop.station = {
      lx,
      ly,
      nx,
      ny,
      // The lane runs the way the line does; side A's ground is on its left.
      tx: span > 0 ? sx / span : -ny,
      ty: span > 0 ? sy / span : nx,
      vertex,
      km: line.km[from] + lengthKm * part,
      distance: Math.sqrt((troop.x - lx) * (troop.x - lx) + (troop.y - ly) * (troop.y - ly)),
      place: at + lengthKm * part,
      ideal: at + lengthKm * part,
      idealX: lx,
      idealY: ly,
      idealNx: nx,
      idealNy: ny,
      low: -Infinity,
      high: Infinity,
      before: -1,
      after: -1,
      view: governing[vertex],
      idealView: governing[vertex],
      aim: null,
      thrust: false,
    };
    // A troop driving in a spearhead or a pincer is one that stands in its
    // peak. Once it is driving it goes on driving at the same point while the
    // order stands: the line it is bending out of shape is no longer a fair
    // measure of where the peak was.
    const order = governing[vertex] >= 0 ? views[governing[vertex]].order ?? views[governing[vertex]] : null;
    let peakOf = null;
    for (const peak of peaks) {
      if (governing[vertex] !== peak.view || along(vertex, peak.vertex) > half * 1.5) continue;
      if (!peakOf || along(vertex, peak.vertex) < along(vertex, peakOf.vertex)) peakOf = peak;
    }
    if (troop.thrustFor && troop.thrustFor === order) {
      troop.station.thrust = true;
      troop.station.aim = troop.thrustAim;
    } else if (peakOf) {
      troop.station.thrust = true;
      troop.station.aim = peakOf.aim;
      troop.thrustFor = order;
      troop.thrustAim = peakOf.aim;
    } else troop.thrustFor = null;
  }

  // The order the side's troops stand in along the line. It is kept from day
  // to day: nobody swaps places. The fallen leave it, and a troop new to it
  // takes its place by where its foot is.
  battle.lanes ??= [null, null];
  const listed = new Uint8Array(troops.length);
  let lanes = battle.lanes[side];
  if (!lanes) {
    lanes = [];
    troops.forEach((troop, index) => {
      if (troop.station) lanes.push(index);
    });
    lanes.sort((a, b) => troops[a].body - troops[b].body || troops[a].station.place - troops[b].station.place || a - b);
    for (const index of lanes) listed[index] = 1;
  } else {
    lanes = lanes.filter((index) => troops[index] && troops[index].station);
    for (const index of lanes) listed[index] = 1;
    for (let index = 0; index < troops.length; index += 1) {
      const troop = troops[index];
      if (!troop.station || listed[index]) continue;
      let at = lanes.length;
      for (let position = 0; position < lanes.length; position += 1) {
        const other = troops[lanes[position]];
        if (other.body === troop.body && other.station.place > troop.station.place) {
          at = position;
          break;
        }
      }
      lanes.splice(at, 0, index);
      listed[index] = 1;
    }
  }
  battle.lanes[side] = lanes;

  // Body by body: where the orders would have each troop, by its rank in the lane.
  const members = new Map();
  for (const index of lanes) {
    const id = troops[index].body;
    if (!members.has(id)) members.set(id, []);
    members.get(id).push(index);
  }
  for (const id of [...members.keys()].sort((a, b) => a - b)) {
    const list = members.get(id);
    const { list: segments, length: whole } = stretches.get(id);
    const total = list.length;
    let weighed = 0;
    for (let item = 0; item < segments.length; item += 4) weighed += ((weight[segments[item]] + weight[segments[item + 1]]) / 2) * segments[item + 2];

    // Places an equal weight of line apart...
    const ideal = new Float64Array(total);
    let passed = 0;
    let item = 0;
    for (let rank = 0; rank < total; rank += 1) {
      const wanted = ((rank + 0.5) / total) * weighed;
      let piece = ((weight[segments[item]] + weight[segments[item + 1]]) / 2) * segments[item + 2];
      while (item + 4 < segments.length && passed + piece < wanted) {
        passed += piece;
        item += 4;
        piece = ((weight[segments[item]] + weight[segments[item + 1]]) / 2) * segments[item + 2];
      }
      ideal[rank] = segments[item + 3] + segments[item + 2] * (piece > 0 ? Math.min(1, Math.max(0, (wanted - passed) / piece)) : 0);
    }
    // ...each shifted by its troop's own lane, and never crowding the one before it.
    const gap = (rank) => {
      const low = Math.max(0, rank - 1);
      const high = Math.min(total - 1, rank + 1);
      return high > low ? (ideal[high] - ideal[low]) / (high - low) : whole;
    };
    const shifted = new Float64Array(total);
    for (let rank = 0; rank < total; rank += 1) {
      shifted[rank] = Math.min(whole, Math.max(0, ideal[rank] + troops[list[rank]].lane * gap(rank)));
      if (rank > 0) shifted[rank] = Math.max(shifted[rank], Math.min(whole, shifted[rank - 1] + LANE_GAP_MIN * Math.min(gap(rank), gap(rank - 1))));
    }

    item = 0;
    let reached = -Infinity;
    for (let rank = 0; rank < total; rank += 1) {
      const station = troops[list[rank]].station;
      while (item + 4 < segments.length && segments[item + 3] + segments[item + 2] <= shifted[rank]) item += 4;
      const from = segments[item];
      const to = segments[item + 1];
      const part = Math.min(1, Math.max(0, (shifted[rank] - segments[item + 3]) / segments[item + 2]));
      station.ideal = shifted[rank];
      station.idealX = contour.x[from] + (contour.x[to] - contour.x[from]) * part;
      station.idealY = contour.y[from] + (contour.y[to] - contour.y[from]) * part;
      const nx = line.nx[from] + (line.nx[to] - line.nx[from]) * part;
      const ny = line.ny[from] + (line.ny[to] - line.ny[from]) * part;
      const length = Math.sqrt(nx * nx + ny * ny);
      station.idealNx = length > 0 ? nx / length : station.nx;
      station.idealNy = length > 0 ? ny / length : station.ny;
      station.idealView = governing[part < 0.5 ? from : to];
      // Where the troops stand is taken as it is, but never out of the lane's
      // order: one found behind the troop before it counts as beside it.
      reached = Math.max(reached, station.place);
      station.place = reached;
      station.before = rank > 0 ? list[rank - 1] : -1;
      station.after = rank < total - 1 ? list[rank + 1] : -1;
    }
    for (let rank = 0; rank < total; rank += 1) {
      const station = troops[list[rank]].station;
      const room = LANE_GAP_MIN * gap(rank);
      station.low = rank > 0 ? troops[list[rank - 1]].station.place + room : 0;
      station.high = rank < total - 1 ? troops[list[rank + 1]].station.place - room : whole;
    }
  }
  return { governing, lanes };
};

// Stands a side's troops at their ideal places, each at its own depth behind
// the line: for a battlefield that has just opened, when there is nowhere for
// them to have come from.
export const standAtPlaces = (battle, side) => {
  const { field, place } = battle;
  const back = side === HOLDER_SIDE_A ? -1 : 1;
  for (const troop of battle.troops[side]) {
    const station = troop.station;
    if (!station) continue;
    const depth = standOff(troop, place.kmAt);
    for (const share of [1, 0.5, 0.25, 0.05]) {
      const x = station.idealX + station.idealNx * back * depth * share;
      const y = station.idealY + station.idealNy * back * depth * share;
      if (!stands(field, side, x, y)) continue;
      troop.x = x;
      troop.y = y;
      break;
    }
  }
};

// Where a troop raised on a line that is already manned goes: the middle of
// the widest gap between two neighbours of its side. null when the side has
// no two neighbours yet.
export const widestGap = (battle, side) => {
  const troops = battle.troops[side];
  let widest = 0;
  let found = null;
  for (const troop of troops) {
    const next = troop.station && troop.station.after >= 0 ? troops[troop.station.after] : null;
    if (!next || !next.station || !isLive(troop) || !isLive(next)) continue;
    const gap = next.station.place - troop.station.place;
    if (gap > widest) {
      widest = gap;
      found = [(troop.x + next.x) / 2, (troop.y + next.y) / 2];
    }
  }
  return found && stands(battle.field, side, found[0], found[1]) ? found : null;
};

// ---- moving that is not attacking ----------------------------------------------

// The unit vector away from the nearest troop of its own side that crowds it,
// through `out`; nothing where none does.
export const roomFrom = (troops, index, radius, out) => {
  const troop = troops[index];
  const near = radius * STEER_ROOM_RADII;
  let best = near * near;
  let found = -1;
  for (let other = 0; other < troops.length; other += 1) {
    if (other === index || !isLive(troops[other])) continue;
    const dx = troop.x - troops[other].x;
    const dy = troop.y - troops[other].y;
    const distance = dx * dx + dy * dy;
    if (distance < best) {
      best = distance;
      found = other;
    }
  }
  out[0] = 0;
  out[1] = 0;
  if (found < 0 || !(best > 0)) return;
  const length = Math.sqrt(best);
  out[0] = (troop.x - troops[found].x) / length;
  out[1] = (troop.y - troops[found].y) / length;
};

// A heading's next value: mostly what it was, turned some of the way toward
// where it wants to go. A troop with no heading yet takes the one it wants.
export const turnHeading = (troop, wantX, wantY) => {
  const length = Math.sqrt(wantX * wantX + wantY * wantY);
  const wx = length > 0 ? wantX / length : 0;
  const wy = length > 0 ? wantY / length : 0;
  let hx = troop.hx === 0 && troop.hy === 0 ? wx : troop.hx * STEER_INERTIA + wx * (1 - STEER_INERTIA);
  let hy = troop.hx === 0 && troop.hy === 0 ? wy : troop.hy * STEER_INERTIA + wy * (1 - STEER_INERTIA);
  const turned = Math.sqrt(hx * hx + hy * hy);
  if (turned > 0) {
    hx /= turned;
    hy /= turned;
  }
  troop.hx = hx;
  troop.hy = hy;
};

// Where a step of `length` cells along a heading ends, by the first of the
// heading itself and its fixed turns that `allowed(x, y)` accepts. Answers
// through `out`; false when none is allowed and the troop stays.
export const stepAlong = (x, y, hx, hy, length, allowed, out) => {
  for (let turn = -1; turn * 2 < TURNS.length; turn += 1) {
    const cos = turn < 0 ? 1 : TURNS[turn * 2];
    const sin = turn < 0 ? 0 : TURNS[turn * 2 + 1];
    const tx = x + (hx * cos - hy * sin) * length;
    const ty = y + (hx * sin + hy * cos) * length;
    if (!allowed(tx, ty)) continue;
    out[0] = tx;
    out[1] = ty;
    return true;
  }
  return false;
};

const scratch = [0, 0];
const room = [0, 0];

// Walks a troop toward a point at a day's march, on its own side's ground
// only, in short legs with a heading that turns by degrees: so it rounds a bay
// or a salient of the enemy's instead of stopping in front of it.
const march = (battle, side, index, targetX, targetY, paceKm) => {
  const { field, place } = battle;
  const { kmAt } = place;
  const troops = battle.troops[side];
  const troop = troops[index];
  const own = (x, y) => stands(field, side, x, y);
  let dx = targetX - troop.x;
  let dy = targetY - troop.y;
  let gap = Math.sqrt(dx * dx + dy * dy);
  const before = gap;
  let left = paceKm / kmAt(troop.y);
  roomFrom(troops, index, controlRadius(troop, kmAt), room);
  for (let leg = 0; leg < MARCH_LEGS_MAX && gap > 1 / 32 && left > 0; leg += 1) {
    const length = Math.min(left, gap, MARCH_LEG_CELLS);
    // The last stretch is walked straight in, if nothing bars it.
    if (gap <= MARCH_LEG_CELLS && gap <= left && own((troop.x + targetX) / 2, (troop.y + targetY) / 2) && own(targetX, targetY)) {
      troop.movedKm += gap * kmAt(troop.y);
      troop.x = targetX;
      troop.y = targetY;
      gap = 0;
      break;
    }
    turnHeading(troop, dx / gap + room[0] * STEER_ROOM, dy / gap + room[1] * STEER_ROOM);
    if (!stepAlong(troop.x, troop.y, troop.hx, troop.hy, length, own, scratch)) break;
    troop.movedKm += length * kmAt(troop.y);
    troop.x = scratch[0];
    troop.y = scratch[1];
    left -= length;
    dx = targetX - troop.x;
    dy = targetY - troop.y;
    gap = Math.sqrt(dx * dx + dy * dy);
  }
  // One that gets no nearer day after day is carried round to where it was going.
  troop.stuck = gap > 0.5 && gap > before - 0.05 ? troop.stuck + 1 : 0;
  if (troop.stuck >= STUCK_DAYS && own(targetX, targetY)) {
    troop.x = targetX;
    troop.y = targetY;
    troop.stuck = 0;
  }
};

// The moves of a day that are not a step forward.
//
// While its side has an attack order standing anywhere, a troop drifts along
// its lane toward its ideal place, by a quarter of its day's advance at most
// and never past a neighbour: this is how a side masses. A troop that is
// itself under an attack order makes no part of that move against its own
// heading.
//
// A troop that is not attacking takes up its stand-off behind the line only
// from a long way back, or off ground that is not its side's; under `fall
// back` its stand-off lies further behind every day the order has stood.
// Everyone else stays where they stand.
//
//   attacking(troop)    whether a troop is under an attack order today
//   advanceKm, overlandKm    a day's advance and a day's march, by kind
export const settle = (battle, side, views, attacking, advanceKm, overlandKm) => {
  const { field, place } = battle;
  const { kmAt } = place;
  const troops = battle.troops[side];
  const back = side === HOLDER_SIDE_A ? -1 : 1;
  const massing = views.some((view) => isAttack(view.word));
  for (let index = 0; index < troops.length; index += 1) {
    const troop = troops[index];
    const station = troop.station;
    if (!isLive(troop) || !station) continue;
    const view = station.view >= 0 ? views[station.view] : null;
    const word = view ? view.word : "hold";
    const forward = attacking(troop);

    // A troop that steps forward today goes where its heading takes it, and
    // nowhere else: at the head of its own salient every point of the line is
    // as near as every other, and "along the line" would mean nothing. Nor
    // does one that walked forward yesterday and is held up today: it waits.
    if (massing && word !== "fall back" && !troop.stepping && !(forward && troop.walkedBefore > 0)) {
      const most = advanceKm[troop.kind] * DRIFT_SHARE;
      let drift = Math.max(-most, Math.min(most, station.ideal - station.place));
      if (drift > 0) drift = Math.max(0, Math.min(drift, station.high - station.place));
      else drift = Math.min(0, Math.max(drift, station.low - station.place));
      let dx = (station.tx * drift) / kmAt(troop.y);
      let dy = (station.ty * drift) / kmAt(troop.y);
      // Never back on itself: what of the drift runs against its heading is left out.
      const against = forward ? dx * troop.hx + dy * troop.hy : 0;
      if (against < 0) {
        dx -= troop.hx * against;
        dy -= troop.hy * against;
      }
      if ((dx !== 0 || dy !== 0) && stands(field, side, troop.x + dx, troop.y + dy)) {
        troop.x += dx;
        troop.y += dy;
        troop.movedKm += Math.sqrt(dx * dx + dy * dy) * kmAt(troop.y);
        station.place += drift;
      }
    }
    if (forward) continue;

    const depth = standOff(troop, kmAt);
    if (word === "fall back") {
      // Further behind the line every day, straight back or toward the place named.
      let further = Math.min(FALL_BACK_MAX_KM, FALL_BACK_KM_PER_DAY * (view.age + 1)) / kmAt(station.ly);
      let dx = station.nx * back;
      let dy = station.ny * back;
      let from = depth;
      if (view.target) {
        const tx = view.target.x - station.lx;
        const ty = view.target.y - station.ly;
        const away = Math.sqrt(tx * tx + ty * ty);
        if (away > 0) {
          dx = tx / away;
          dy = ty / away;
          further = Math.min(further, away);
          from = 0;
        }
      }
      for (const share of [1, 0.75, 0.5, 0.25]) {
        const x = station.lx + dx * (from + further) * share;
        const y = station.ly + dy * (from + further) * share;
        if (!stands(field, side, x, y)) continue;
        march(battle, side, index, x, y, overlandKm[troop.kind]);
        break;
      }
      continue;
    }
    const far = Math.max(depth * STAND_OFF_FAR, controlRadius(troop, kmAt) * STAND_OFF_FAR_RADII);
    if (station.distance <= far && stands(field, side, troop.x, troop.y)) continue;
    for (const share of [1, 0.5, 0.25, 0.05]) {
      const x = station.lx + station.nx * back * depth * share;
      const y = station.ly + station.ny * back * depth * share;
      if (!stands(field, side, x, y)) continue;
      march(battle, side, index, x, y, overlandKm[troop.kind]);
      break;
    }
  }
};

// ---- the list a record keeps ----------------------------------------------------

// The dead of the last run are dropped as a run begins, and the named
// formations follow their troops to their new places in the list.
export const dropTheDead = (troops, named) => {
  const kept = [[], []];
  const moved = [new Map(), new Map()];
  for (let side = 0; side < 2; side += 1) {
    troops[side].forEach((troop, index) => {
      if (!isLive(troop)) return;
      moved[side].set(index, kept[side].length);
      kept[side].push(troop);
    });
  }
  const names = [];
  for (const entry of named) {
    const index = moved[entry.s]?.get(entry.i);
    if (index === undefined || !kept[entry.s][index].named) continue;
    names.push({ ...entry, i: index });
  }
  // A counter marked as a named formation that no name answers for is an ordinary one.
  for (let side = 0; side < 2; side += 1) {
    kept[side].forEach((troop, index) => {
      if (troop.named && !names.some((entry) => entry.s === side && entry.i === index)) troop.named = false;
    });
  }
  return { troops: kept, named: names };
};
