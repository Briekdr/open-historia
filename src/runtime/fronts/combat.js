/*! Open Historia — battlefields and fronts: the fight, and the ground it takes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The ground changes hands as a direct result of the path each troop takes,
// and by nothing else. A troop under an attack order steps forward by what its
// own local fight allows: nothing below 1.15 to 1, the full pace of its era
// through ground nobody defends, more or less as its own drive has it. The
// ground within its control radius of the stretch it just walked becomes its
// side's, painted for the country it belongs to. Neighbours stepping together
// are bridged, so troops advancing side by side sweep a strip and a thrust
// that leaves its neighbours behind sweeps only its own corridor. Where no
// troop walks, nothing is written.
//
// A troop does not walk in a straight line. It keeps a heading, and each day
// the heading turns part of the way toward where it wants to go: the direction
// its order gives, bent by the gaps between the defenders ahead, a town within
// reach, easier ground, room from its own side, and a slow wander of its own.
// And it never comes back on itself: a heading turns by 45 degrees a day at
// most, less for a troop that barely moved, so a path is an arc and never a
// curl.
//
// A defender is weaker for being attacked from two directions at once, and
// works dug facing the enemy are no help against an attacker coming from the
// side or from behind: that is what a flank is for.
//
// Only + - * / and square roots from here down, in index order: the same
// input gives the same war to the last digit on every machine.

import { hashSeed } from "../unitMotion.js";
import {
  ADVANCE_AHEAD_RADII,
  ATTRITION,
  ATTRITION_RATIO_MAX,
  ATTRITION_RATIO_MIN,
  BLITZ_READY_SHARE,
  COMPASS_16,
  DIG_LOST_KM,
  DIG_MAX_DIG_IN,
  DIG_MAX_HOLD,
  DIG_PER_DAY_DIG_IN,
  DIG_PER_DAY_HOLD,
  FLANKED_DEFENCE,
  FLANK_OPPOSITE_COS,
  GAIN,
  GIVE_WAY_MARGIN_CELLS,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  IN_PLACE_RADII,
  LINK_RADII,
  OVERRUN_CELLS,
  PINNED_LOSS,
  POCKET_DEFENCE,
  POCKET_LOSS,
  QUIET_ATTRITION,
  RATIO_NEEDED,
  RATIO_SOFTNESS,
  REINFORCE_PER_DAY,
  RETREAT_LOSS,
  STEER_BASE,
  STEER_GROUND,
  STEER_LEAST_FORWARD,
  STEER_PRIZE,
  STEER_PRIZE_CONE,
  STEER_PRIZE_KM,
  STEER_RESISTANCE,
  STEER_RESISTANCE_RADII,
  STEER_ROOM,
  STEER_WANDER,
  SUBSTEPS_MAX,
  SURROUNDED_DEFENCE,
  TERRAIN_DEFENCE_GAIN,
  TROOP_ATTACK,
  TROOP_DEFENCE,
  TURN_LEAST,
  TURN_MOST_COS,
  TURN_WALK_RADII,
  WANDER_DAYS,
} from "./constants.js";
import { nearestHeld, ownCell, takeCapsule } from "./field.js";
import { describePoint, inSector } from "./sectors.js";
import { STATE_ADVANCING, STATE_ENCIRCLED, STATE_HOLDING, STATE_SPENT, controlRadius, isAttack, isLive, reachCells, roomFrom, stands, stepAlong, turnHeading } from "./troops.js";

const clampRatio = (value) => (value < ATTRITION_RATIO_MIN ? ATTRITION_RATIO_MIN : value > ATTRITION_RATIO_MAX ? ATTRITION_RATIO_MAX : value);

// How much slow ground is worth to whoever defends it.
const terrainDefence = (speed) => 1 + Math.min(0.8, Math.max(0, 1 - speed)) * TERRAIN_DEFENCE_GAIN;

// What a troop is worth in defence where it stands; `dug` is whether its works count.
const defensivePower = (battle, side, troop, dug = true) =>
  troop.strength * TROOP_DEFENCE[troop.kind] * (1 + (dug ? troop.dig : 0)) * battle.quality[side] * troop.supply * (troop.pocket ? POCKET_DEFENCE : 1);

// ---- who steps -----------------------------------------------------------------

const halted = (battle, side, x, y) => {
  for (const halt of battle.haltsToday) if (halt.s === side && inSector(halt.sector, x, y, battle.place.kmAt)) return true;
  return false;
};

// Under a plain advance a troop that has got well ahead of its nearer
// neighbour in the line waits a day for it: an advance stays an advance on a
// front, and does not become a dozen lone columns.
const tooFarAhead = (battle, side, troop) => {
  const { kmAt } = battle.place;
  const station = troop.station;
  const troops = battle.troops[side];
  const toward = side === HOLDER_SIDE_A ? 1 : -1;
  let nearer = null;
  let least = Infinity;
  for (const index of [station.before, station.after]) {
    const other = index >= 0 ? troops[index] : null;
    if (!other || !isLive(other)) continue;
    const dx = other.x - troop.x;
    const dy = other.y - troop.y;
    if (dx * dx + dy * dy < least) {
      least = dx * dx + dy * dy;
      nearer = other;
    }
  }
  if (!nearer) return false;
  const ahead = ((troop.x - nearer.x) * station.nx + (troop.y - nearer.y) * station.ny) * toward;
  return ahead > ADVANCE_AHEAD_RADII * controlRadius(troop, kmAt);
};

// What each troop is to do today, from the order that governs the stretch it
// stands on. `attacking` is whether it is under an attack order at all (which
// is what keeps it from walking back); `stepping` whether it steps forward
// today. It steps once its own lag has passed; under a blitz, once the mass
// has gathered; under a spearhead, a pincer or a flank, if it stands in the
// peak; under a plain advance, unless it has run too far ahead of its
// neighbour. Where the other side is falling back, a troop not told to dig in
// or to fall back itself goes after it.
export const decideTasks = (battle, braked) => {
  const { kmAt } = battle.place;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const views = battle.views[side];
    const enemyViews = battle.views[1 - side];
    const enemyGoverning = battle.plans[1 - side].governing;
    const troops = battle.troops[side];
    const wanted = new Int32Array(views.length);
    const inPlace = new Int32Array(views.length);
    for (const troop of troops) {
      const station = troop.station;
      if (!isLive(troop) || !station || station.idealView < 0) continue;
      wanted[station.idealView] += 1;
      if (Math.abs(station.ideal - station.place) <= IN_PLACE_RADII * controlRadius(troop, kmAt) * kmAt(troop.y)) inPlace[station.idealView] += 1;
    }
    for (const troop of troops) {
      troop.stepping = false;
      troop.attacking = false;
      troop.task = "";
      const station = troop.station;
      if (!isLive(troop) || !station) continue;
      const view = station.view >= 0 ? views[station.view] : null;
      const word = view ? view.word : "hold";
      let stood = view ? view.age : 0;
      troop.task = word;
      if (!isAttack(word) && word !== "dig in" && word !== "fall back") {
        const theirs = enemyGoverning[station.vertex];
        if (theirs >= 0 && enemyViews[theirs].word === "fall back") {
          troop.task = "pursue";
          stood = enemyViews[theirs].age;
        }
      }
      troop.attacking = isAttack(word) || troop.task === "pursue";
      if (!troop.attacking || braked || troop.pocket || stood < troop.lag || halted(battle, side, station.lx, station.ly)) continue;
      if (word === "blitz" && inPlace[station.view] < wanted[station.view] * BLITZ_READY_SHARE) continue;
      if ((word === "spearhead" || word === "encircle" || word === "flank") && !station.thrust) continue;
      if (word === "advance" && tooFarAhead(battle, side, troop)) continue;
      troop.stepping = true;
    }
  }
};

// ---- which way -----------------------------------------------------------------

const base = [0, 0];
const pull = [0, 0];
const ended = [0, 0];

// The direction a troop's order gives it, through `base`: false when it has
// nowhere left to go (it stands on its objective, or has passed it).
const baseDirection = (battle, side, troop, line) => {
  const { kmAt } = battle.place;
  const station = troop.station;
  const view = station.view >= 0 ? battle.views[side][station.view] : null;
  if (station.aim) {
    const dx = station.aim[0] - troop.x;
    const dy = station.aim[1] - troop.y;
    const away = Math.sqrt(dx * dx + dy * dy);
    if (away < 0.5) return false;
    base[0] = dx / away;
    base[1] = dy / away;
    return true;
  }
  if (view && view.target && view.middle && (view.word === "advance" || view.word === "blitz")) {
    const dx = view.target.x - view.middle[0];
    const dy = view.target.y - view.middle[1];
    const away = Math.sqrt(dx * dx + dy * dy);
    if (away > 0) {
      base[0] = dx / away;
      base[1] = dy / away;
      return (view.target.x - troop.x) * base[0] + (view.target.y - troop.y) * base[1] > 0;
    }
  }
  // The line's outward normal where it stands, taken over two radii of line
  // either side so that neighbours go the same way.
  const toward = side === HOLDER_SIDE_A ? 1 : -1;
  const spanKm = 2 * controlRadius(troop, kmAt) * kmAt(station.ly);
  const { first, count } = line.contour.strands[line.strand[station.vertex]];
  let nx = 0;
  let ny = 0;
  for (let step = 0; step < count; step += 1) {
    const vertex = first + step;
    if (Math.abs(line.km[vertex] - station.km) > spanKm) continue;
    nx += line.nx[vertex];
    ny += line.ny[vertex];
  }
  const length = Math.sqrt(nx * nx + ny * ny);
  base[0] = (length > 0 ? nx / length : station.nx) * toward;
  base[1] = (length > 0 ? ny / length : station.ny) * toward;
  return true;
};

const addUnit = (x, y, weight) => {
  const length = Math.sqrt(x * x + y * y);
  if (!(length > 0)) return;
  pull[0] += (x / length) * weight;
  pull[1] += (y / length) * weight;
};

// What the ground costs to cross, a cell at a time; a wall costs as much as
// the worst ground in the arena.
const groundCost = (arena) => {
  if (arena.cost) return arena.cost;
  let worst = 1;
  for (let index = 0; index < arena.size; index += 1) if (arena.speed[index] > 0 && 1 / arena.speed[index] > worst) worst = 1 / arena.speed[index];
  arena.cost = Float32Array.from(arena.speed, (speed) => (speed > 0 ? 1 / speed : worst));
  arena.costWorst = worst;
  return arena.cost;
};

// A slow drift of a troop's own, so that neighbours do not draw parallel
// lines: two points of a 16-gon picked by the seed, the troop and the week,
// blended as the week goes by.
const wander = (seed, battle, side, index, day, weight) => {
  const week = Math.floor(day / WANDER_DAYS);
  const from = hashSeed([seed, battle.name, side, index, week].join("|")) % 16;
  const to = hashSeed([seed, battle.name, side, index, week + 1].join("|")) % 16;
  const part = (day - week * WANDER_DAYS) / WANDER_DAYS;
  addUnit(
    COMPASS_16[from * 2] * (1 - part) + COMPASS_16[to * 2] * part,
    COMPASS_16[from * 2 + 1] * (1 - part) + COMPASS_16[to * 2 + 1] * part,
    weight,
  );
};

// Turns each stepping troop's heading for the day. `weights` are the pulls on
// it (constants.js STEER_*), which a test may set aside one at a time.
export const steer = (battle, line, day, seed, weights = {}) => {
  const { field, arena, place } = battle;
  const { kmAt } = place;
  const cost = groundCost(arena);
  const { cols, rows } = field;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const troops = battle.troops[side];
    const enemies = battle.troops[1 - side];
    for (let index = 0; index < troops.length; index += 1) {
      const troop = troops[index];
      if (!troop.stepping) continue;
      if (!baseDirection(battle, side, troop, line)) {
        troop.stepping = false;
        continue;
      }
      const nx = base[0];
      const ny = base[1];
      const radius = controlRadius(troop, kmAt);
      pull[0] = nx * (weights.base ?? STEER_BASE);
      pull[1] = ny * (weights.base ?? STEER_BASE);

      // The way of least resistance: away from the defenders ahead, the nearer the more.
      let awayX = 0;
      let awayY = 0;
      const near = radius * STEER_RESISTANCE_RADII;
      for (const enemy of enemies) {
        if (!isLive(enemy)) continue;
        const dx = enemy.x - troop.x;
        const dy = enemy.y - troop.y;
        const apart = dx * dx + dy * dy;
        if (!(apart > 0) || apart > near * near || dx * nx + dy * ny <= 0) continue;
        const power = defensivePower(battle, 1 - side, enemy);
        awayX -= (power * dx) / apart;
        awayY -= (power * dy) / apart;
      }
      addUnit(awayX, awayY, weights.resistance ?? STEER_RESISTANCE);

      // The pull of a prize: the nearest town the other side holds, roughly ahead.
      let prize = -1;
      let nearest = STEER_PRIZE_KM / kmAt(troop.y);
      for (let at = 0; at < arena.cities.length; at += 1) {
        const city = arena.cities[at];
        if (field.holders[city.cell] !== 1 - side) continue;
        const dx = city.x - troop.x;
        const dy = city.y - troop.y;
        const away = Math.sqrt(dx * dx + dy * dy);
        if (!(away > 0) || away >= nearest || (dx * nx + dy * ny) / away < STEER_PRIZE_CONE) continue;
        nearest = away;
        prize = at;
      }
      if (prize >= 0) addUnit(arena.cities[prize].x - troop.x, arena.cities[prize].y - troop.y, weights.prize ?? STEER_PRIZE);

      // Easier ground: down the slope of what the ground costs to cross.
      const col = Math.min(cols - 1, Math.max(0, Math.floor(troop.x)));
      const row = Math.min(rows - 1, Math.max(0, Math.floor(troop.y)));
      const here = row * cols + col;
      const east = col < cols - 1 ? cost[here + 1] : arena.costWorst;
      const west = col > 0 ? cost[here - 1] : arena.costWorst;
      const north = row < rows - 1 ? cost[here + cols] : arena.costWorst;
      const south = row > 0 ? cost[here - cols] : arena.costWorst;
      addUnit(west - east, south - north, weights.ground ?? STEER_GROUND);

      // Room from its own side, and a wander of its own.
      roomFrom(troops, index, radius, ended);
      pull[0] += ended[0] * (weights.room ?? STEER_ROOM);
      pull[1] += ended[1] * (weights.room ?? STEER_ROOM);
      wander(seed, battle, side, index, day, weights.wander ?? STEER_WANDER);

      // A troop that was not stepping yesterday sets off the way its order
      // points: it was standing, so there is no path yet to come back on.
      const fresh = !troop.wasStepping || (troop.hx === 0 && troop.hy === 0);
      if (fresh) {
        troop.hx = nx;
        troop.hy = ny;
      }
      const fromX = troop.hx;
      const fromY = troop.hy;
      turnHeading(troop, pull[0], pull[1]);
      // Never backwards: no more than about 75 degrees off the way its order points.
      for (let pass = 0; pass < 3; pass += 1) {
        const forward = troop.hx * nx + troop.hy * ny;
        if (forward >= STEER_LEAST_FORWARD) break;
        const hx = troop.hx + nx * (STEER_LEAST_FORWARD - forward) * 2;
        const hy = troop.hy + ny * (STEER_LEAST_FORWARD - forward) * 2;
        const length = Math.sqrt(hx * hx + hy * hy);
        if (!(length > 0)) break;
        troop.hx = hx / length;
        troop.hy = hy / length;
      }
      // Never back on itself: a heading turns by 45 degrees a day at most...
      const kept = troop.hx * fromX + troop.hy * fromY;
      if (kept < TURN_MOST_COS) {
        const sideX = troop.hx - fromX * kept;
        const sideY = troop.hy - fromY * kept;
        const length = Math.sqrt(sideX * sideX + sideY * sideY);
        troop.hx = length > 0 ? fromX * TURN_MOST_COS + (sideX / length) * TURN_MOST_COS : fromX;
        troop.hy = length > 0 ? fromY * TURN_MOST_COS + (sideY / length) * TURN_MOST_COS : fromY;
      }
      // ...and by less the less it walked yesterday, so a troop that is barely
      // moving does not turn on the spot and draw a curl.
      if (!fresh) {
        const share = Math.max(TURN_LEAST, Math.min(1, troop.walkedBefore / (radius * TURN_WALK_RADII)));
        const hx = fromX + (troop.hx - fromX) * share;
        const hy = fromY + (troop.hy - fromY) * share;
        const length = Math.sqrt(hx * hx + hy * hy);
        troop.hx = length > 0 ? hx / length : fromX;
        troop.hy = length > 0 ? hy / length : fromY;
      }
    }
  }
};

// ---- the day's steps -----------------------------------------------------------

const kernel = (distance, reach) => {
  const left = 1 - distance / reach;
  return left > 0 ? left * left : 0;
};

// The troops of both sides that step today, in a fixed order: side A's by
// index, then side B's.
const steppers = (battle) => {
  const list = [];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    battle.troops[side].forEach((troop, index) => {
      if (troop.stepping && isLive(troop)) list.push({ side, index, troop });
    });
  }
  return list;
};

// How a defender stands against the attackers in reach of it this moment:
// `flank` scales its defence down when two of them come at it from separated
// directions, further when from opposite sides; (faceX, faceY) is the way it
// faces, toward the nearest of the other side's ground, which is the only way
// its works are any use. Worked out once a moment for each defender.
const readDefender = (battle, side, troop, active, moment) => {
  if (troop.flankMoment === moment) return;
  troop.flankMoment = moment;
  const { kmAt } = battle.place;
  const reach = reachCells(kmAt, troop.y);
  const station = troop.station;
  const toward = side === HOLDER_SIDE_A ? 1 : -1;
  let faceX = station ? station.lx - troop.x : 0;
  let faceY = station ? station.ly - troop.y : 0;
  const away = Math.sqrt(faceX * faceX + faceY * faceY);
  if (away > 0.05) {
    faceX /= away;
    faceY /= away;
  } else {
    faceX = station ? station.nx * toward : 0;
    faceY = station ? station.ny * toward : 0;
  }
  troop.faceX = faceX;
  troop.faceY = faceY;
  // The directions the attackers in reach come from, and the widest angle between two of them.
  let least = 1;
  const from = [];
  for (const entry of active) {
    if (entry.side === side) continue;
    const dx = entry.troop.x - troop.x;
    const dy = entry.troop.y - troop.y;
    const apart = Math.sqrt(dx * dx + dy * dy);
    if (!(apart > 0) || apart > reach) continue;
    for (let other = 0; other < from.length; other += 2) {
      const between = (from[other] * dx + from[other + 1] * dy) / apart;
      if (between < least) least = between;
    }
    from.push(dx / apart, dy / apart);
  }
  troop.flank = least < FLANK_OPPOSITE_COS ? SURROUNDED_DEFENCE : least < 0 ? FLANKED_DEFENCE : 1;
};

// What one defender is worth against one attacker at (x, y).
const defenceAgainst = (battle, side, defender, x, y) => {
  const front = (x - defender.x) * defender.faceX + (y - defender.y) * defender.faceY >= 0;
  return defensivePower(battle, side, defender, front) * defender.flank;
};

// Walks the day in sub-steps short enough that no troop goes more than half
// its control radius in one. Each sub-step is worked out from the positions it
// began with: every troop's fight and step first, then the moves, side A's
// before side B's; ground both step into is kept by the stronger, side A on a
// tie. `paceKm[kind]` is the era's advance in a day, `pace` the scenario's
// setting. Returns how many sub-steps were walked.
export const stepForward = (battle, day, paceKm, pace) => {
  const { field, arena, place, claims } = battle;
  const { kmAt } = place;
  const active = steppers(battle);
  if (active.length === 0) return 0;

  let parts = 1;
  for (const entry of active) {
    const { troop } = entry;
    const cell = Math.max(0, ownCell(field, entry.side, troop.x, troop.y));
    entry.radius = controlRadius(troop, kmAt);
    entry.dayCells = (paceKm[troop.kind] * arena.speed[cell] * troop.supply * pace * troop.drive) / kmAt(troop.y);
    parts = Math.max(parts, Math.ceil(entry.dayCells / (entry.radius * 0.5)));
  }
  parts = Math.min(SUBSTEPS_MAX, parts);
  const inPlay = (x, y) => x >= 0 && y >= 0 && x < field.cols && y < field.rows && field.play[Math.floor(y) * field.cols + Math.floor(x)] === 1;
  const share = (ATTRITION / 100) / parts;

  for (let part = 0; part < parts; part += 1) {
    claims.moment += 1;
    // Every troop's fight and step, from where everyone stands now.
    for (const entry of active) {
      const { side, troop } = entry;
      const reach = reachCells(kmAt, troop.y);
      let attack = 0;
      for (const other of active) {
        if (other.side !== side) continue;
        const dx = other.troop.x - troop.x;
        const dy = other.troop.y - troop.y;
        const weight = kernel(Math.sqrt(dx * dx + dy * dy), reach);
        if (weight > 0) attack += other.troop.strength * TROOP_ATTACK[other.troop.kind] * battle.quality[side] * other.troop.supply * weight;
      }
      const aheadX = troop.x + troop.hx * entry.radius;
      const aheadY = troop.y + troop.hy * entry.radius;
      let defence = 0;
      const enemies = battle.troops[1 - side];
      for (const enemy of enemies) {
        if (!isLive(enemy)) continue;
        const dx = enemy.x - aheadX;
        const dy = enemy.y - aheadY;
        const weight = kernel(Math.sqrt(dx * dx + dy * dy), reach);
        if (!(weight > 0)) continue;
        readDefender(battle, 1 - side, enemy, active, claims.moment);
        defence += defenceAgainst(battle, 1 - side, enemy, troop.x, troop.y) * weight;
      }
      const raw = defence;
      if (inPlay(aheadX, aheadY)) defence *= terrainDefence(arena.speed[Math.floor(aheadY) * field.cols + Math.floor(aheadX)]);
      const ratio = defence > 0 ? attack / defence : Infinity;
      const gain = defence > 0 ? Math.min(1, Math.max(0, (GAIN * (ratio - RATIO_NEEDED)) / (ratio + RATIO_SOFTNESS))) : 1;
      entry.power = attack;
      entry.fromX = troop.x;
      entry.fromY = troop.y;
      let length = Math.min((entry.dayCells * gain) / parts, entry.radius * 0.5);
      // A troop driving at a point stops on it.
      if (troop.station.aim) {
        const dx = troop.station.aim[0] - troop.x;
        const dy = troop.station.aim[1] - troop.y;
        length = Math.min(length, Math.sqrt(dx * dx + dy * dy));
      }
      entry.length = length > 0 && stepAlong(troop.x, troop.y, troop.hx, troop.hy, length, inPlay, ended) ? length : 0;
      entry.toX = entry.length > 0 ? ended[0] : troop.x;
      entry.toY = entry.length > 0 ? ended[1] : troop.y;
      // What the fight costs, whether or not it gained anything: a failed assault is paid for too.
      if (raw > 0 && attack > 0) {
        troop.loss += troop.strength * share * clampRatio(defence / attack);
        const theirs = share * clampRatio(attack / defence);
        for (const enemy of enemies) {
          if (!isLive(enemy)) continue;
          const dx = enemy.x - aheadX;
          const dy = enemy.y - aheadY;
          const weight = kernel(Math.sqrt(dx * dx + dy * dy), reach);
          if (!(weight > 0)) continue;
          enemy.loss += enemy.strength * theirs * ((defenceAgainst(battle, 1 - side, enemy, troop.x, troop.y) * weight) / raw);
          enemy.engaged = true;
        }
      }
    }

    // The moves, and the ground each takes: the strip it walked, and the
    // bridge to its neighbour in the line if that one walked beside it.
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      const troops = battle.troops[side];
      const marks = battle.swept[side];
      for (const entry of active) {
        if (entry.side !== side) continue;
        entry.troop.stepped = entry.length > 0;
        if (entry.length <= 0) continue;
        const { troop } = entry;
        takeCapsule(field, side, entry.fromX, entry.fromY, entry.toX, entry.toY, entry.radius, entry.radius, {
          claims,
          strength: entry.power,
          marks,
          day,
          painter: troop.owner,
          from: part / parts,
          span: 1 / parts,
        });
        troop.x = entry.toX;
        troop.y = entry.toY;
        troop.movedKm += entry.length * kmAt(troop.y);
        troop.walkedCells += entry.length;
        troop.walkedToday = true;
        troop.power = entry.power;
      }
      for (const entry of active) {
        if (entry.side !== side || !entry.troop.stepped) continue;
        const one = entry.troop;
        const other = one.station.after >= 0 ? troops[one.station.after] : null;
        if (!other || !other.stepped || !other.stepping || one.body !== other.body) continue;
        const radiusOther = controlRadius(other, kmAt);
        const dx = other.x - one.x;
        const dy = other.y - one.y;
        if (Math.sqrt(dx * dx + dy * dy) > (LINK_RADII * (entry.radius + radiusOther)) / 2) continue;
        takeCapsule(field, side, one.x, one.y, other.x, other.y, entry.radius, radiusOther, {
          claims,
          strength: Math.min(one.power, other.power),
          marks,
          day,
          painter: one.owner,
          painterQ: other.owner,
          from: (part + 1) / parts,
        });
      }
    }

    // Giving way: a troop that did not step, standing where a step's sweep
    // came, is pushed along that step, so that it is still in front of the attacker.
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      for (const troop of battle.troops[side]) {
        if (!isLive(troop) || troop.stepped) continue;
        let pusher = null;
        for (const entry of active) {
          if (entry.side === side || entry.length <= 0 || (pusher && entry.length <= pusher.length)) continue;
          const sx = entry.toX - entry.fromX;
          const sy = entry.toY - entry.fromY;
          const span = sx * sx + sy * sy;
          let along = span > 0 ? ((troop.x - entry.fromX) * sx + (troop.y - entry.fromY) * sy) / span : 0;
          along = along < 0 ? 0 : along > 1 ? 1 : along;
          const ox = troop.x - (entry.fromX + sx * along);
          const oy = troop.y - (entry.fromY + sy * along);
          if (Math.sqrt(ox * ox + oy * oy) <= entry.radius + GIVE_WAY_MARGIN_CELLS) pusher = entry;
        }
        if (!pusher) continue;
        // Far enough along the step to stand clear of the ground it took.
        const sx = pusher.toX - pusher.fromX;
        const sy = pusher.toY - pusher.fromY;
        let moved = false;
        for (const times of [1, 2, 3]) {
          const x = troop.x + sx * times;
          const y = troop.y + sy * times;
          if (!stands(field, side, x, y)) continue;
          const km = pusher.length * times * kmAt(troop.y);
          troop.x = x;
          troop.y = y;
          troop.movedKm += km;
          troop.loss += (RETREAT_LOSS * km) / 10;
          moved = true;
          break;
        }
        if (!moved) troop.pinned = true;
      }
    }
    for (const entry of active) entry.troop.stepped = false;
  }
  return parts;
};

// ---- the end of a day ----------------------------------------------------------

// What the day cost and what it mended: the losses of the fight, of standing in
// contact, of being pinned or cut off; troops left on the other side's ground
// falling back onto their own, or lost; digging in; reinforcement from the
// side's reserves. `date` marks what goes in the log.
export const closeDay = (battle, date) => {
  const { field, arena, place } = battle;
  const { kmAt } = place;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const troops = battle.troops[side];
    const enemies = battle.troops[1 - side];
    for (const troop of troops) {
      if (!isLive(troop)) continue;
      // A quiet stretch in contact costs a little: a tenth of a fight's worth.
      if (!troop.engaged && !troop.walkedToday && troop.loss === 0) {
        const reach = reachCells(kmAt, troop.y);
        let theirs = 0;
        let ours = 0;
        for (const enemy of enemies) {
          if (!isLive(enemy)) continue;
          const dx = enemy.x - troop.x;
          const dy = enemy.y - troop.y;
          theirs += enemy.strength * kernel(Math.sqrt(dx * dx + dy * dy), reach);
        }
        if (theirs > 0) {
          for (const friend of troops) {
            if (!isLive(friend)) continue;
            const dx = friend.x - troop.x;
            const dy = friend.y - troop.y;
            ours += friend.strength * kernel(Math.sqrt(dx * dx + dy * dy), reach);
          }
          troop.loss += troop.strength * (ATTRITION / 100) * QUIET_ATTRITION * clampRatio(theirs / ours);
        }
      }
      troop.strength -= troop.loss + (troop.pinned ? PINNED_LOSS : 0) + (troop.pocket ? POCKET_LOSS : 0);
    }
  }
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const views = battle.views[side];
    for (const troop of battle.troops[side]) {
      if (troop.strength > 0 && !stands(field, side, troop.x, troop.y)) {
        // On ground that is no longer its side's: back onto its own, if any is near.
        const cell = nearestHeld(field, side, troop.x, troop.y, OVERRUN_CELLS);
        if (cell < 0) {
          const at = describePoint(arena, troop.x, troop.y);
          if (at) battle.log.push({ d: date, k: "overrun", s: side, at });
          troop.strength = 0;
        } else {
          const x = (cell % field.cols) + 0.5;
          const y = Math.floor(cell / field.cols) + 0.5;
          troop.movedKm += Math.sqrt((x - troop.x) * (x - troop.x) + (y - troop.y) * (y - troop.y)) * kmAt(y);
          troop.x = x;
          troop.y = y;
        }
      }
      if (troop.strength > 0) {
        const word = troop.station && troop.station.view >= 0 ? views[troop.station.view].word : "hold";
        if (troop.movedKm > DIG_LOST_KM) troop.dig = 0;
        else if (word === "dig in") troop.dig = Math.min(DIG_MAX_DIG_IN, troop.dig + DIG_PER_DAY_DIG_IN);
        else if (word === "hold" && troop.dig < DIG_MAX_HOLD) troop.dig = Math.min(DIG_MAX_HOLD, troop.dig + DIG_PER_DAY_HOLD);
        // Reserves reach every troop that is not cut off.
        if (!troop.pocket && troop.strength < 100 && battle.pool[side] > 0) {
          const sent = Math.min(REINFORCE_PER_DAY, 100 - troop.strength, battle.pool[side]);
          troop.strength += sent;
          battle.pool[side] -= sent;
        }
      }
      if (!(troop.strength > 0)) {
        troop.strength = 0;
        troop.dig = 0;
        troop.station = null;
      }
      troop.state = troop.strength <= 0 ? STATE_SPENT : troop.pocket ? STATE_ENCIRCLED : troop.walkedToday ? STATE_ADVANCING : STATE_HOLDING;
      troop.wasStepping = troop.walkedToday;
      troop.walkedBefore = troop.walkedCells;
      troop.walkedCells = 0;
      troop.stepping = false;
      troop.stepped = false;
      troop.walkedToday = false;
      troop.movedKm = 0;
      troop.loss = 0;
      troop.pinned = false;
      troop.engaged = false;
    }
  }
};
