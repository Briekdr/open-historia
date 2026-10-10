/*! Open Historia — battlefields and fronts: a battlefield while a run works on it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A saved battlefield is short strings (record.js). To be fought over it is
// opened out into what the engine works on: the field as numbers, the troops
// as objects, the ground and who is on which side of it. That is a `battle`.
// Here one is made (from a saved record, or new where two sides at war touch),
// kept in step with what the rest of the world did to the map, and written
// back as a record when the run ends.
//
// Whatever others did to the map wins over the field, by one rule: a region
// the world gives to a side that holds less than four tenths of it is
// repainted for that side, and one whose controller is no longer in the war
// becomes wall. The engine never writes who controls a region itself: it
// reports each change of hands and the game applies it the ordinary way.
//
// A region has two holders. Who holds it IN NAME is what the world says: its
// controller, or the group in whose area it lies. Who it is SHOWN as belonging
// to is what the map draws, and that changes only when the whole of the region
// is held: a region taken in name is drawn as its old holder's, with the
// taker's ground painted over it, until the last of it has changed hands.

import { diffGameDays } from "../gameDates.js";
import { decodeTroops, encodeLines, encodeTroops } from "./codec.js";
import {
  BATTLEFIELD_VERSION,
  CONTROL_RADIUS_MAX_KM,
  DEFAULT_EFFORT,
  FAR_CELLS,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  MAX_CONTESTED_REGIONS,
  MAX_LOG_ENTRIES,
  MAX_NAMED_TROOPS,
  MAX_TROOPS_PER_SIDE,
  NAMED_WITHIN_KM,
  POOL_PER_TROOP,
  REDISTANCE_REACH_CELLS,
  REPAINT_BELOW,
  TROOP_UNITS,
} from "./constants.js";
import { nearestOnContour, openField, ownCell, packField, redistance, setGround, takeCells, traceContour, unpackField } from "./field.js";
import { awayOf, downhill, measure } from "./ground.js";
import { placeBehind } from "./move.js";
import { servingOf } from "./orders.js";
import { projectorOf } from "./frame.js";
import { drawLine, measureLine } from "./line.js";
import { nearestOwner } from "./supply.js";
import { KIND_ARMOUR, KIND_ARTILLERY, KIND_INFANTRY, createTroop, drawTraits, dropTheDead, isLive, kindsFor, liveCount, planLanes, shareOut, sideRadiusKm, sizeSides, standAtPlaces, standOff, stands } from "./troops.js";

const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const round3 = (value) => Math.round(value * 1000) / 1000;

// Which side a name fights on in a battle: 0, 1, or -1.
export const sideOfName = (battle, name) => {
  const wanted = fold(name);
  if (!wanted) return -1;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    if (battle.sides[side].some((member, index) => fold(member) === wanted && !battle.gone[side].has(index))) return side;
  }
  return -1;
};

// Who holds a region in name: the group in whose area it lies if that group
// is in the war, else its controller.
export const holderOf = (battle, run, id) => {
  const group = run.groupOf(id);
  return group && sideOfName(battle, group) >= 0 ? group : run.controllerOf(id);
};

// The side each region of the arena fights on, from who holds it in name. And
// whose home ground it is for supply: the same for a group's area, else the
// side of its lawful sovereign. And who the map draws it as belonging to: a
// region new to the battle is shown as whoever holds it in name, and so is
// one outside the war, where the engine has no say.
export const readRegions = (battle, run) => {
  const { arena } = battle;
  const count = arena.ids.length;
  const regionSide = new Int8Array(count).fill(-1);
  const homeSide = new Int8Array(count).fill(-1);
  for (let index = 1; index < count; index += 1) {
    const id = arena.ids[index];
    const group = sideOfName(battle, run.groupOf(id));
    regionSide[index] = group >= 0 ? group : sideOfName(battle, run.controllerOf(id));
    homeSide[index] = group >= 0 ? group : sideOfName(battle, run.sovereignOf(id));
    if (!battle.shown.has(id) || regionSide[index] < 0) battle.shown.set(id, holderOf(battle, run, id));
  }
  battle.regionSide = regionSide;
  battle.homeSide = homeSide;
  // For the map: the side whose home ground each cell is (2 for neither), which
  // is the side of the name its region is shown under. The map lays a side's
  // paint over the region's own colour wherever the side holding a cell is
  // not its home side.
  const homeOfRegion = new Uint8Array(count).fill(2);
  for (let index = 1; index < count; index += 1) {
    const side = sideOfName(battle, battle.shown.get(arena.ids[index]));
    if (side >= 0) homeOfRegion[index] = side;
  }
  battle.homes = Uint8Array.from(arena.region, (region) => homeOfRegion[region]);
};

// One region changed hands during a run: its side is read again, and whose
// home it is. Nothing else about the ground can have changed, so nothing else
// is read: a war in which hundreds of regions change hands would otherwise
// read every region of the arena for each of them.
export const readRegion = (battle, run, id) => {
  const index = battle.arena.indexOf.get(id);
  if (index === undefined || !battle.regionSide) return;
  const group = sideOfName(battle, run.groupOf(id));
  battle.regionSide[index] = group >= 0 ? group : sideOfName(battle, run.controllerOf(id));
  const home = group >= 0 ? group : sideOfName(battle, run.sovereignOf(id));
  if (home === battle.homeSide[index]) return;
  // A list of its own, so that what was worked out from the old one is worked out again.
  battle.homeSide = Int8Array.from(battle.homeSide);
  battle.homeSide[index] = home;
};

// The place of a name among a side's members, or -1.
export const memberIndex = (battle, side, name) => {
  const wanted = fold(name);
  return wanted ? battle.sides[side].findIndex((member) => fold(member) === wanted) : -1;
};

// Whose colour each cell a side holds is painted in, worked out afresh: at
// home, whoever its region is shown as belonging to; elsewhere whoever the
// world says holds the region, if that is a member of the side holding the
// cell, else the member whose troops are nearest. Only the map reads it, and
// it is never saved: a run begins by working it out again.
export const paintGround = (battle, run) => {
  const { field, arena } = battle;
  const near = [nearestOwner(battle, HOLDER_SIDE_A), nearestOwner(battle, HOLDER_SIDE_B)];
  const shownAs = [new Int16Array(arena.ids.length).fill(-1), new Int16Array(arena.ids.length).fill(-1)];
  const holder = [new Int16Array(arena.ids.length).fill(-1), new Int16Array(arena.ids.length).fill(-1)];
  for (let region = 1; region < arena.ids.length; region += 1) {
    const id = arena.ids[region];
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      shownAs[side][region] = memberIndex(battle, side, battle.shown.get(id));
      const group = memberIndex(battle, side, run.groupOf(id));
      holder[side][region] = group >= 0 ? group : memberIndex(battle, side, run.controllerOf(id));
    }
  }
  for (let index = 0; index < field.size; index += 1) {
    const side = field.holders[index];
    if (side !== HOLDER_SIDE_A && side !== HOLDER_SIDE_B) continue;
    const region = arena.region[index];
    const known = battle.homes[index] === side ? Math.max(0, shownAs[side][region]) : holder[side][region];
    field.painter[index] = known >= 0 ? known : near[side](index);
  }
};

const createBattle = (run, { name, warId, sides, frame, arena, openedDate, openedDay }) => ({
  name,
  warId,
  status: "active",
  sides: [sides[0].slice(), sides[1].slice()],
  gone: [new Set(), new Set()],
  openedDate,
  openedDay,
  frame,
  arena,
  place: projectorOf(frame),
  field: null,
  regionSide: null,
  homeSide: null,
  // Who the map draws each region as belonging to, by the region's id, and
  // what the recorder was told of it since the last day was recorded.
  shown: new Map(),
  said: [],
  troops: [[], []],
  named: [],
  pool: [0, 0],
  base: [0, 0],
  quality: [1, 1],
  effort: [DEFAULT_EFFORT, DEFAULT_EFFORT],
  orders: [],
  ordersChanged: 0,
  halts: [],
  haltsToday: [],
  views: [[], []],
  plans: null,
  planKey: "",
  pockets: [],
  pocketOf: null,
  pocketTurns: -1,
  // The ground to be closed on (closing.js), and the distances over the ground (ground.js).
  close: null,
  toSide: null,
  fed: null,
  bodyOf: null,
  // Whose home each cell is as the map is told it: as the run began, until its last day.
  drawnHomes: null,
  // Whether the record said which troops serve which standing order.
  served: false,
  // A border fortified in peace: the days nothing has been ordered there, and
  // which of its sides have been told to leave it.
  quiet: 0,
  leaving: [false, false],
  // Whether its first side fights on the second side of its war.
  swap: false,
  // The sieges that stand, and the ground each side's steps leave alone (orders.js).
  sieges: [],
  spared: [[], []],
  siegeKey: "",
  // And the cells of the places each side is besieging, which it leaves alone (supply.js).
  kept: [null, null],
  supplied: [null, null],
  supply: null,
  supplyTurns: -1,
  anchors: [],
  log: [],
  claims: { stamp: new Int32Array(arena.size), power: new Float32Array(arena.size), moment: 0 },
  // The field as the run found it: what a repulsed attack is put back to, and
  // what the brief measures the run's gains from.
  startPhi: null,
  startHolders: null,
  lastFlip: new Int32Array(arena.ids.length).fill(-1000000),
  settledTurns: -1,
  taken: [[], []],
  citiesTaken: [[], []],
  cityHolder: null,
  recorder: null,
  drawn: null,
  drawnFlags: null,
  drawnContour: null,
  closing: "",
  closedDate: "",
  lineKm: 0,
  fresh: true,
  autoNamed: false,
  seed: run.seed,
  even: run.steer.even === true,
  radiusKm: [CONTROL_RADIUS_MAX_KM, CONTROL_RADIUS_MAX_KM],
  watch: typeof run.input?.watch === "function" ? run.input.watch : null,
  homes: null,
});

export const keepStart = (battle) => {
  battle.startPhi = Float64Array.from(battle.field.phi);
  battle.startHolders = Uint8Array.from(battle.field.holders);
  battle.cityHolder = Int8Array.from(battle.arena.cities, (city) => battle.field.holders[city.cell]);
};

// The length of a battle's line as it stands, in kilometres.
export const lineLength = (battle) => {
  battle.lineKm = measureLine(battle.field, traceContour(battle.field)).total;
  return battle.lineKm;
};

// Each side's control radius for the run, from how close its troops stand
// along the line as the run finds them. Worked out once: a side that loses
// troops does not paint a wider strip for it.
export const setRadii = (battle) => {
  lineLength(battle);
  battle.radiusKm = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => sideRadiusKm(battle.lineKm, liveCount(battle.troops[side])));
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) for (const troop of battle.troops[side]) troop.radiusKm = battle.radiusKm[side];
};

// ---- what the world did --------------------------------------------------------

// Brings a battle's field into step with who controls what now. true when the
// field changed.
export const reconcile = (battle, run) => {
  readRegions(battle, run);
  const { field, arena, regionSide } = battle;
  let changed = setGround(field, regionSide);
  const held = new Int32Array(arena.ids.length);
  for (let index = 0; index < field.size; index += 1) {
    if (field.play[index] && field.holders[index] === regionSide[arena.region[index]]) held[arena.region[index]] += 1;
  }
  const repaint = new Uint8Array(arena.ids.length);
  let any = false;
  for (let region = 1; region < arena.ids.length; region += 1) {
    if (regionSide[region] < 0 || arena.regionSpeed[region] <= 0) continue;
    const whole = arena.cells[region] + arena.outside[region];
    if ((held[region] + arena.outside[region]) / whole >= REPAINT_BELOW) continue;
    repaint[region] = 1;
    any = true;
  }
  if (any) {
    const cells = [[], []];
    for (let index = 0; index < field.size; index += 1) {
      if (field.play[index] && repaint[arena.region[index]]) cells[regionSide[arena.region[index]]].push(index);
    }
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      if (cells[side].length === 0) continue;
      // Painted for whoever the world gave the region to, if that is one of the side's own.
      const near = nearestOwner(battle, side);
      takeCells(field, side, cells[side], (index) => {
        const id = arena.ids[arena.region[index]];
        const named = memberIndex(battle, side, run.groupOf(id) || run.controllerOf(id));
        return named >= 0 ? named : near(index);
      });
    }
    changed = true;
  }
  if (changed) redistance(field);
  return changed;
};

// ---- raising -------------------------------------------------------------------

// A side's strength on a battle: what each of its members brings to it, a
// member on several battlefields splitting itself among them by the length of
// their lines.
export const memberWeights = (battle, run, side) => battle.sides[side].map((member, index) => {
  if (battle.gone[side].has(index)) return 0;
  let elsewhere = 0;
  for (const other of run.battles) {
    if (other !== battle && other.status !== "closed" && sideOfName(other, member) >= 0) elsewhere += other.lineKm;
  }
  const share = battle.lineKm + elsewhere > 0 ? battle.lineKm / (battle.lineKm + elsewhere) : 1;
  return Math.max(0, Number(run.strengthOf(member)) || 0) * share;
});

// A troop that has just been raised is stood where it would stay: not nearer
// the other side's ground than it would bear, nor further back than it would
// leave be. So a front nobody pushes is at rest from its first day.
const settleRaised = (battle, side, raised) => {
  const { field, place } = battle;
  const toOther = measure(battle)[1 - side];
  const toward = [0, 0];
  for (const troop of raised) {
    const depth = standOff(troop, place.kmAt);
    for (let round = 0; round < 6; round += 1) {
      const onOwn = stands(field, side, troop.x, troop.y);
      const away = onOwn ? awayOf(battle, side, troop.x, troop.y) : 0;
      if (!onOwn || away < depth * 0.6) {
        const behind = placeBehind(battle, side, troop, depth);
        if (!behind || (behind[0] === troop.x && behind[1] === troop.y)) break;
        [troop.x, troop.y] = behind;
      } else if (away > depth * 3 && downhill(field, toOther, troop.x, troop.y, toward)) {
        const step = away - depth * 2;
        if (!stands(field, side, troop.x + toward[0] * step, troop.y + toward[1] * step)) break;
        troop.x += toward[0] * step;
        troop.y += toward[1] * step;
      } else break;
    }
  }
};

// Raises both sides' troops on a battle that has just opened, and stands them
// along the line: nobody has ordered anything yet, so the weight is even, and
// what makes the line uneven is the troops themselves.
export const raiseTroops = (battle, run, only = -1) => {
  const line = measureLine(battle.field, traceContour(battle.field));
  battle.lineKm = line.total;
  const members = [memberWeights(battle, run, 0), memberWeights(battle, run, 1)];
  const strengths = members.map((list) => list.reduce((sum, weight) => sum + weight, 0));
  const { counts, quality } = sizeSides(line.total, strengths, battle.effort);
  battle.quality = quality.map((value, side) => (only >= 0 && side !== only ? battle.quality[side] : round3(value)));
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    // (On a border fortified in peace only the side that deploys there raises troops.)
    if (only >= 0 && side !== only) continue;
    const room = Math.max(0, Math.min(counts[side], MAX_TROOPS_PER_SIDE - battle.troops[side].length));
    battle.base[side] = round3(members[side].reduce((sum, weight) => sum + weight, 0));
    battle.pool[side] += room * POOL_PER_TROOP;
    const first = battle.troops[side].length;
    for (const kind of kindsFor(room, run.era)) battle.troops[side].push(createTroop({ kind }));
    const raised = battle.troops[side].slice(first);
    if (raised.length === 0) continue;
    // New troops begin on their own ground along the line, in the order they
    // are listed, so that each body of ground has its share of them; then each
    // is stood at the place an evenly held line gives its rank, shifted and
    // set back by what it drew: there is nowhere for it to have come from.
    const own = side === HOLDER_SIDE_A ? line.contour.cellA : line.contour.cellB;
    const fallback = battle.field.holders.indexOf(side);
    raised.forEach((troop, index) => {
      let vertex = Math.min(line.count - 1, Math.floor(((index + 0.5) * line.count) / raised.length));
      while (vertex > 0 && own[vertex] < 0) vertex -= 1;
      const home = own[vertex] >= 0 ? own[vertex] : fallback;
      troop.x = (home % battle.field.cols) + 0.5;
      troop.y = Math.floor(home / battle.field.cols) + 0.5;
      drawTraits(troop, run.seed, battle.name, side, first + index, battle.even);
    });
    planLanes(battle, side, line);
    standAtPlaces(battle, side);
    settleRaised(battle, side, raised);
    // Each member's share of the counters, the ally whose ground a counter
    // stands on taking it where it still has some to take.
    const quota = shareOut(raised.length, members[side].some((weight) => weight > 0) ? members[side] : members[side].map((weight, index) => (battle.gone[side].has(index) ? 0 : 1)));
    const waiting = [];
    for (const troop of raised) {
      const cell = Math.max(0, ownCell(battle.field, side, troop.x, troop.y));
      const local = battle.sides[side].findIndex((member) => fold(member) === fold(run.controllerOf(battle.arena.ids[battle.arena.region[cell]])));
      if (local >= 0 && quota[local] > 0) {
        troop.owner = local;
        quota[local] -= 1;
      } else waiting.push(troop);
    }
    let owner = 0;
    for (const troop of waiting) {
      while (owner < quota.length - 1 && quota[owner] <= 0) owner += 1;
      troop.owner = owner;
      quota[owner] -= 1;
    }
  }
  battle.planKey = "";
};

// ---- named formations ----------------------------------------------------------

const KIND_OF_TYPE = { infantry: KIND_INFANTRY, armor: KIND_ARMOUR, artillery: KIND_ARTILLERY };

// Takes a formation of the world's into a battle as a named troop, at its own
// place and strength. false when it does not belong here: not a land
// formation, not a member's, off the frame, too far from the line, or no room.
export const absorbUnit = (battle, run, unit, { anyDistance = false } = {}) => {
  const kind = KIND_OF_TYPE[String(unit?.type ?? "")];
  const unitId = String(unit?.id ?? "").trim();
  const side = sideOfName(battle, unit?.ownerCode ?? unit?.owner);
  if (kind === undefined || !unitId || side < 0) return false;
  if (battle.named.some((entry) => entry.unitId === unitId)) return false;
  if (battle.troops[side].length >= MAX_TROOPS_PER_SIDE || battle.named.length >= MAX_NAMED_TROOPS) return false;
  const lng = Number(unit.lng);
  const lat = Number(unit.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  const [x, y] = battle.place.toCell(lng, lat);
  if (!(x >= 0) || !(y >= 0) || x >= battle.field.cols || y >= battle.field.rows) return false;
  if (!anyDistance) {
    const contour = traceContour(battle.field);
    const reach = NAMED_WITHIN_KM / battle.place.kmAt(y);
    const near = reach <= REDISTANCE_REACH_CELLS ? nearestOnContour(battle.field, contour, x, y, reach) : nearestVertexDistance(contour, x, y);
    if (!(near <= reach)) return false;
  }
  const owner = battle.sides[side].findIndex((member) => fold(member) === fold(unit.ownerCode ?? unit.owner));
  const strength = Math.min(100, Math.max(1, Number(unit.strength) || 100));
  battle.troops[side].push(createTroop({ x, y, strength, kind, owner, named: true }));
  battle.named.push({ s: side, i: battle.troops[side].length - 1, name: String(unit.name ?? "").trim(), unitId });
  // The battle itself, not its name: a battlefield may still be named by its first order.
  run.unitChanges.push({ unitId, committedTo: battle });
  battle.planKey = "";
  return true;
};

const nearestVertexDistance = (contour, x, y) => {
  let best = Infinity;
  for (let vertex = 0; vertex < contour.x.length; vertex += 1) {
    const dx = contour.x[vertex] - x;
    const dy = contour.y[vertex] - y;
    if (dx * dx + dy * dy < best) best = dx * dx + dy * dy;
  }
  return Math.sqrt(best);
};

// A battle is over: its named formations go back to the world where they
// stand, and the ones that fell are struck off.
export const releaseNamed = (battle, run) => {
  for (const entry of battle.named) {
    const troop = battle.troops[entry.s][entry.i];
    if (!troop || entry.reported) continue;
    entry.reported = true;
    if (!isLive(troop)) {
      run.unitChanges.push({ unitId: entry.unitId, committedTo: "", remove: true });
      continue;
    }
    const [lng, lat] = battle.place.toLngLat(troop.x, troop.y);
    run.unitChanges.push({ unitId: entry.unitId, committedTo: "", lng, lat, strength: Math.round(troop.strength) });
  }
};

// A named formation that fell during the run is struck off the world's list
// when the run is saved; its counter stays in the record until the next run.
const reportTheFallen = (battle, changes) => {
  for (const entry of battle.named) {
    const troop = battle.troops[entry.s][entry.i];
    if (troop && !isLive(troop) && !entry.reported) changes.push({ unitId: entry.unitId, committedTo: "", remove: true });
  }
};

// ---- from a record, and back ---------------------------------------------------

// A saved battlefield opened out to be worked on. `arena` is its frame's.
export const loadBattle = (run, record, arena) => {
  const battle = createBattle(run, {
    name: record.name,
    warId: record.warId,
    sides: record.sides,
    frame: record.frame,
    arena,
    openedDate: record.openedDate,
    openedDay: 0,
  });
  battle.status = record.status;
  battle.fresh = false;
  // Who the map draws each region as: the names the last run left for the
  // regions it listed. A region it did not list is shown as its holder in name.
  const carry = record.brief?.carry ?? {};
  for (const entry of Array.isArray(record.contested) ? record.contested : []) {
    if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string" && entry[0] && entry[1]) battle.shown.set(entry[0], entry[1]);
  }
  readRegions(battle, run);
  battle.field = unpackField(arena, record.field, battle.regionSide);
  const read = [decodeTroops(record.troops[0]).map(createTroop), decodeTroops(record.troops[1]).map(createTroop)];
  // Which standing order each troop was serving when the last run ended.
  battle.served = Array.isArray(carry.under) && carry.under.length === 2;
  if (battle.served) {
    read.forEach((list, side) => list.forEach((troop, index) => {
      const serves = Array.isArray(carry.under[side]) ? carry.under[side][index] : -1;
      troop.serves = Number.isInteger(serves) ? serves : -1;
    }));
  }
  const kept = dropTheDead(read, record.named);
  battle.troops = kept.troops;
  battle.named = kept.named;
  battle.pool = record.pool.slice();
  battle.base = record.base.slice();
  battle.quality = record.quality.slice();
  battle.effort = record.effort.slice();
  battle.orders = record.orders.map((order, index) => {
    const stood = Array.isArray(carry.ages) && Number.isFinite(carry.ages[index]) ? carry.ages[index] : diffGameDays(order.since, run.input.fromDate);
    return { ...order, age: Math.max(0, Math.floor(Number(stood) || 0)) };
  });
  battle.halts = (Array.isArray(carry.halts) ? carry.halts : [])
    .filter((halt) => (halt?.s === 0 || halt?.s === 1) && halt.days > 0)
    .map((halt) => ({ s: halt.s, sector: String(halt.sector ?? "all"), days: Math.floor(halt.days) }));
  battle.anchors = (Array.isArray(carry.anchors) ? carry.anchors : [])
    .filter((anchor) => (anchor?.s === 0 || anchor?.s === 1) && Number.isFinite(anchor.x) && Number.isFinite(anchor.y))
    .map((anchor) => ({ s: anchor.s, x: anchor.x, y: anchor.y }));
  battle.pockets = (Array.isArray(carry.pockets) ? carry.pockets : [])
    .filter((pocket) => (pocket?.s === 0 || pocket?.s === 1) && Number.isInteger(pocket.cell))
    .map((pocket) => ({ s: pocket.s, cell: pocket.cell, days: Math.max(0, Math.floor(Number(pocket.days) || 0)), km2: 0, siege: "", told: pocket.told === true }));
  battle.log = record.log.map((entry) => ({ ...entry }));
  battle.quiet = Math.max(0, Math.floor(Number(carry.quiet) || 0));
  return battle;
};

// A new battle on a frame, where two sides at war touch. null when they do not
// touch on this ground after all.
export const openBattle = (run, { name, warId, sides, frame, arena, day }) => {
  const battle = createBattle(run, { name, warId, sides, frame, arena, openedDate: run.dateOf(day), openedDay: day });
  readRegions(battle, run);
  battle.field = openField(arena, run.input.map.regions, battle.regionSide);
  if (!battle.field || traceContour(battle.field).segments === 0) return null;
  lineLength(battle);
  return battle;
};

// The rings round the ground each side holds that is not its home ground, by
// who each region is shown as belonging to: what the map hatches. A ring is
// marked with the side that holds the ground.
const takenRings = (battle) => {
  const { field } = battle;
  const { cols, rows, size } = field;
  const rings = [];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    // A field of its own: inside where this side holds another's ground, and a
    // cell further out all round, so the hatch covers every such cell whole.
    const taken = new Uint8Array(size);
    let any = false;
    for (let index = 0; index < size; index += 1) {
      if (field.holders[index] !== side || battle.homes[index] === side) continue;
      taken[index] = 1;
      any = true;
    }
    if (!any) continue;
    const scratch = {
      cols,
      rows,
      size,
      edits: 0,
      contour: null,
      contourEdits: -1,
      play: new Uint8Array(size).fill(1),
      holders: new Uint8Array(size).fill(HOLDER_SIDE_B),
      phi: new Float64Array(size).fill(FAR_CELLS),
      ghost: Int32Array.from({ length: size }, (_, index) => index),
      pieceFrom: new Int32Array(size * 2).fill(-1),
      pieceTo: new Int32Array(size * 2).fill(-1),
    };
    for (let index = 0; index < size; index += 1) {
      const col = index % cols;
      const row = (index - col) / cols;
      if (col === 0 || row === 0 || col === cols - 1 || row === rows - 1) continue;
      let inside = taken[index] === 1;
      for (let dy = -1; dy <= 1 && !inside; dy += 1) {
        for (let dx = -1; dx <= 1 && !inside; dx += 1) inside = taken[index + dy * cols + dx] === 1;
      }
      if (!inside) continue;
      // Against the other side the edge of the hatch is the front line itself:
      // both keep the distances the field has. A wall beside it is simply inside.
      const other = field.holders[index] === 1 - side;
      const distance = field.play[index] ? Math.max(1 / 64, Math.abs(field.phi[index])) : 0.5;
      scratch.phi[index] = other ? distance : -distance;
      scratch.holders[index] = other ? HOLDER_SIDE_B : HOLDER_SIDE_A;
    }
    const contour = traceContour(scratch);
    const flags = new Uint8Array(contour.x.length).fill(side);
    for (const strand of drawLine(contour, flags)) if (strand.closed) rings.push(strand);
  }
  return rings;
};

// The record of a battle as it stands. `day` is the day of the run it is
// written on; `changes` takes the named formations that fell.
export const saveBattle = (battle, run, day, changes, brief) => {
  const { arena, field } = battle;
  // Members that left are struck off, and every troop's owner follows.
  const owners = [[], []];
  const sides = [[], []];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    battle.sides[side].forEach((member, index) => {
      owners[side].push(battle.gone[side].has(index) ? 0 : sides[side].length);
      if (!battle.gone[side].has(index)) sides[side].push(member);
    });
  }
  // A troop's place is kept to a sixteenth of a cell. Rounded to the nearest,
  // one standing at the very edge of its cell would be saved in the cell next
  // door, which may be a wall or the other side's: it is kept in its own.
  const within = (value) => Math.min(Math.floor(value) + 1 - 1 / TROOP_UNITS, Math.max(Math.floor(value), Math.round(value * TROOP_UNITS) / TROOP_UNITS));
  const troops = battle.troops.map((list, side) => encodeTroops(list.map((troop) => ({ ...troop, x: within(troop.x), y: within(troop.y), owner: owners[side][troop.owner] ?? 0 }))));
  reportTheFallen(battle, changes);
  const closed = battle.status === "closed";
  // The regions the map draws as someone else's than the world says they are:
  // taken in name, and not yet whole. If there are too many to list, the
  // largest are kept.
  let disputed = [];
  for (let region = 1; region < arena.ids.length && !closed; region += 1) {
    const name = battle.shown.get(arena.ids[region]) ?? "";
    if (battle.regionSide[region] >= 0 && name && fold(name) !== fold(holderOf(battle, run, arena.ids[region]))) disputed.push(region);
  }
  if (disputed.length > MAX_CONTESTED_REGIONS) {
    const largest = new Set(disputed.slice().sort((a, b) => arena.cells[b] - arena.cells[a] || a - b).slice(0, MAX_CONTESTED_REGIONS));
    disputed = disputed.filter((region) => largest.has(region));
  }
  const contested = disputed.map((region) => [arena.ids[region], battle.shown.get(arena.ids[region])]);
  const record = {
    v: BATTLEFIELD_VERSION,
    name: battle.name,
    warId: battle.warId,
    status: battle.status,
    sides,
    openedDate: battle.openedDate,
    asOf: closed ? battle.closedDate : run.dateOf(day),
    frame: battle.frame,
    troops,
    named: battle.named.map(({ s, i, name, unitId }) => ({ s, i, name, unitId })),
    pool: battle.pool.map(round3),
    base: battle.base.slice(),
    quality: battle.quality.slice(),
    effort: battle.effort.slice(),
    orders: battle.orders.map(({ s, sector, order, objective, effort, by, since }) => ({
      s,
      sector,
      order,
      since,
      ...(objective ? { objective } : {}),
      ...(effort ? { effort } : {}),
      ...(by ? { by } : {}),
    })),
    replay: battle.replay ?? battle.recorder.finish({ date: run.input.fromDate, days: day }),
    held: "",
    contested,
    brief: {
      ...brief,
      carry: {
        // Which of the standing orders each troop is serving, so that the next
        // run finds the same group under each.
        under: battle.troops.map((list) => list.map((troop) => servingOf(battle, troop))),
        ages: battle.orders.map((order) => order.age),
        ...(battle.status === "standing" ? { quiet: battle.quiet } : {}),
        halts: battle.halts.map(({ s, sector, days }) => ({ s, sector, days })),
        anchors: battle.anchors.map(({ s, x, y }) => ({ s, x, y })),
        pockets: battle.pockets.map(({ s, cell, days, told }) => ({ s, cell, days, ...(told ? { told: true } : {}) })),
      },
    },
    log: battle.log.slice(-MAX_LOG_ENTRIES),
  };
  if (closed) record.closedDate = battle.closedDate;
  else {
    record.field = packField(field);
    record.held = encodeLines(takenRings(battle));
  }
  return record;
};
