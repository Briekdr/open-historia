/*! Open Historia — battlefields and fronts: the run © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The front engine. Given the battlefields as they stood, the days that passed
// and what was ordered and what happened on them, it says how every
// battlefield stands afterwards: where the line runs, where the troops are,
// which regions changed hands and when.
//
//   const run = createFrontRun(input);
//   while (!run.advance(15)) { /* the caller may yield here */ }
//   const result = run.finish();          // runFronts(input) does the same in one call
//
// The model commands and narrates; it never sets a position. The engine never
// writes who controls a region: it reports each change of hands as a flip and
// the game applies it the ordinary way.
//
// Two promises the rest of the game relies on. The same input gives the same
// result to the last character. And nothing dated day d changes anything
// before day d: a run cut at day k ends exactly as the full run stood after
// day k, which is what lets a player break into a turn half way through.
//
// The map's shapes are tens of megabytes, so a run is first tried without
// them (input.map.regions null): it works from arenas already drawn. When it
// finds it needs shapes after all (a battlefield to open, a frame to grow, an
// arena not kept) it answers { needsRegions: true } having changed nothing,
// and is run again in full with them.

import { addGameDays } from "../gameDates.js";
import { ADVANCE_KM_PER_DAY, OVERLAND_KM_PER_DAY, eraOf } from "../unitMotion.js";
import { arenaFor } from "./arena.js";
import { absorbUnit, keepStart, loadBattle, memberWeights, openBattle, paintGround, raiseTroops, readRegion, reconcile, releaseNamed, saveBattle, setRadii, sideOfName } from "./battle.js";
import { buildBrief } from "./brief.js";
import { assignCommands } from "./command.js";
import { hashKey } from "./codec.js";
import {
  BATTLEFIELD_NAME_MAX,
  EFFORT_FACTORS,
  FRONT_EFFORTS,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  LANDING_CELLS,
  MAX_BATTLEFIELDS,
  MAX_CLOSED_BATTLEFIELDS,
  MAX_SIDE_MEMBERS,
  MAX_TROOPS_PER_SIDE,
  POOL_PER_TROOP,
  STANDING_QUIET_DAYS,
  TROOPS_PER_STRENGTH,
  TROOP_KINDS,
} from "./constants.js";
import { contactAt, findContacts, frameForContact, middleOf } from "./contact.js";
import { REGIONS_NEEDED, prepare, recordDay, settleRegions, simulateDay, startRecorder } from "./day.js";
import { redistance, takeCapsule, traceContour } from "./field.js";
import { pointInFrame } from "./frame.js";
import { applyOrder, assignOrder, readSieges } from "./orders.js";
import { foldBattlefieldName, normalizeBattlefields } from "./record.js";
import { authoredName } from "./scenarioFronts.js";
import { findPockets } from "./supply.js";
import { createTroop, isLive, liveCount, troopsCap } from "./troops.js";

const clean = (value, max = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();
const fold = (value) => clean(value).toLowerCase();

const memberList = (value) => {
  const members = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const name = clean(entry);
    if (name && !members.some((member) => fold(member) === fold(name)) && members.length < MAX_SIDE_MEMBERS) members.push(name);
  }
  return members;
};

// ---- the run's own books -------------------------------------------------------

const createRun = (input) => {
  const days = Math.max(0, Math.floor(Number(input?.days) || 0));
  const fromDate = String(input?.fromDate ?? "");
  const dated = addGameDays(fromDate, 0) !== "";
  const era = eraOf(fromDate);
  const controller = new Map();
  const group = new Map();
  const areas = input?.groupAreas && typeof input.groupAreas === "object" ? input.groupAreas : {};
  const run = {
    input,
    days,
    day: 0,
    steps: 0,
    era,
    seed: String(input?.seed ?? ""),
    pace: Math.min(3, Math.max(0.1, Number(input?.pace) || 1)),
    // The weights that bend a troop's step, for a test or the rig to set aside.
    steer: input?.steering && typeof input.steering === "object" ? input.steering : {},
    advanceKm: [ADVANCE_KM_PER_DAY.infantry[era], ADVANCE_KM_PER_DAY.armor[era], ADVANCE_KM_PER_DAY.artillery[era]],
    overlandKm: [OVERLAND_KM_PER_DAY.infantry[era], OVERLAND_KM_PER_DAY.armor[era], OVERLAND_KM_PER_DAY.artillery[era]],
    battles: [],
    wars: new Map(),
    flips: [],
    unitChanges: [],
    notes: [],
    taken: new Set(),
    cursor: 0,
    flipsLeft: Number.isFinite(input?.flipAllowance) ? Math.max(0, Math.floor(input.flipAllowance)) : Infinity,
    braked: false,
    cache: input?.arenas instanceof Map ? input.arenas : null,
    regionIds: null,
    // A date the calendar cannot read gives every day the run's first date, and its end the last.
    dateOf: (day) => (dated ? addGameDays(fromDate, day) : day >= days && input?.toDate ? String(input.toDate) : fromDate),
    controllerOf: (id) => (controller.has(id) ? controller.get(id) : clean(input?.controllerOf?.(id))),
    sovereignOf: (id) => clean(input?.sovereignOf?.(id)),
    groupOf: (id) => (group.has(id) ? group.get(id) : clean(areas[id])),
    isGroup: (name) => input?.isGroup?.(name) === true,
    strengthOf: (name) => {
      const weight = Number(input?.strengthOf?.(name));
      return weight > 0 && Number.isFinite(weight) ? weight : 1;
    },
    setController: (id, name) => controller.set(id, clean(name)),
    setGroup: (id, name) => group.set(id, clean(name)),
  };
  // A region changed hands: every battlefield it lies on reads its side again.
  run.regionChanged = (id) => {
    for (const battle of run.battles) {
      if (battle.status === "closed" || !battle.arena.indexOf.has(id)) continue;
      readRegion(battle, run, id);
      battle.planKey = "";
    }
  };
  // A scenario's ceiling on how much may change hands in a run: once it is
  // reached nobody advances for the rest of it, and the caller is told once.
  run.spendFlip = () => {
    run.flipsLeft -= 1;
    if (run.flipsLeft > 0 || run.braked) return;
    run.braked = true;
    run.notes.push({ kind: "tempo" });
  };
  if (run.flipsLeft <= 0) run.braked = true;

  for (const war of Array.isArray(input?.wars) ? input.wars : []) {
    const id = clean(war?.id);
    if (!id || run.wars.has(id)) continue;
    run.wars.set(id, { id, title: clean(war.title), status: ["active", "ceasefire", "ended"].includes(war.status) ? war.status : "active", sides: [memberList(war.sideA), memberList(war.sideB)] });
  }
  run.moments = (Array.isArray(input?.moments) ? input.moments : [])
    .filter((moment) => moment && typeof moment === "object")
    .map((moment, index) => ({ moment, index, day: Math.min(days, Math.max(0, Math.floor(Number(moment.day) || 0))) }))
    .sort((a, b) => a.day - b.day || a.index - b.index);
  return run;
};

const regionsOf = (run) => (Array.isArray(run.input?.map?.regions) ? run.input.map.regions : null);
const openBattles = (run) => run.battles.filter((battle) => battle.status !== "closed");

// Which side of a war holds a region: the group in whose area it lies if that
// group is in the war, else its controller.
const warSideOf = (run, war, id) => {
  const sideOf = (name) => {
    const wanted = fold(name);
    if (!wanted) return -1;
    return war.sides[0].some((member) => fold(member) === wanted) ? 0 : war.sides[1].some((member) => fold(member) === wanted) ? 1 : -1;
  };
  const group = sideOf(run.groupOf(id));
  return group >= 0 ? group : sideOf(run.controllerOf(id));
};

// ---- battlefields opening and closing ------------------------------------------

// The name of a battlefield that opened by itself: its two leading members,
// made its own with the largest city near the line if another has that name.
const nameFor = (run, battle) => {
  const { arena } = battle;
  const lead = [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
    const cells = new Float64Array(battle.sides[side].length);
    for (let region = 1; region < arena.ids.length; region += 1) {
      const holder = run.groupOf(arena.ids[region]) || run.controllerOf(arena.ids[region]);
      const index = battle.sides[side].findIndex((member) => fold(member) === fold(holder));
      if (index >= 0) cells[index] += arena.cells[region];
    }
    let best = 0;
    for (let index = 1; index < cells.length; index += 1) if (cells[index] > cells[best]) best = index;
    return battle.sides[side][best];
  });
  const taken = (name) => run.battles.some((other) => other !== battle && foldBattlefieldName(other.name) === foldBattlefieldName(name));
  // A front its scenario's author named is called that (scenarioFronts.js).
  const authored = clean(authoredName(run.input?.authored, battle.sides), BATTLEFIELD_NAME_MAX);
  if (authored && !taken(authored)) return authored;
  const plain = clean(`${lead[0]} - ${lead[1]} front`, BATTLEFIELD_NAME_MAX);
  if (!taken(plain)) return plain;
  const contour = traceContour(battle.field);
  let city = null;
  for (const candidate of arena.cities) {
    let near = false;
    for (let vertex = 0; vertex < contour.x.length && !near; vertex += 1) {
      near = Math.abs(contour.x[vertex] - candidate.x) <= 12 && Math.abs(contour.y[vertex] - candidate.y) <= 12;
    }
    if (near && (!city || candidate.population > city.population)) city = candidate;
  }
  const named = city ? clean(`${lead[0]} - ${lead[1]} front, ${city.name}`, BATTLEFIELD_NAME_MAX) : "";
  if (named && !taken(named)) return named;
  for (let count = 2; ; count += 1) {
    const numbered = clean(`${plain} ${count}`, BATTLEFIELD_NAME_MAX);
    if (!taken(numbered)) return numbered;
  }
};

// Formations of the world's that stand on a battle and belong to its sides are
// taken into it.
const absorbUnits = (battle, run) => {
  for (const unit of Array.isArray(run.input?.units) ? run.input.units : []) {
    const id = clean(unit?.id);
    if (!id || clean(unit.committedTo) || run.taken.has(id)) continue;
    if (absorbUnit(battle, run, unit)) run.taken.add(id);
  }
};

// A battle that has just opened: troops are raised, formations taken in, and
// its first day goes to the recorder.
const startBattle = (run, battle, day) => {
  run.battles.push(battle);
  raiseTroops(battle, run);
  absorbUnits(battle, run);
  setRadii(battle);
  paintGround(battle, run);
  keepStart(battle);
  readSieges(battle);
  findPockets(battle);
  startRecorder(battle, run, day);
  recordDay(battle, day, day >= run.days);
};

const closeBattle = (run, battle, day) => {
  if (battle.status === "closed") return;
  const { arena } = battle;
  battle.status = "closed";
  battle.closedDate = run.dateOf(day);
  releaseNamed(battle, run);
  // What is still held by a country that is not its sovereign: the war ending
  // moves no border, so the model is told what is left occupied.
  const occupied = [];
  for (let region = 1; region < arena.ids.length && occupied.length < 12; region += 1) {
    const id = arena.ids[region];
    const controller = run.controllerOf(id);
    if (battle.regionSide[region] < 0 || arena.names[region] === id || fold(controller) === fold(run.sovereignOf(id))) continue;
    occupied.push(`region: ${arena.names[region]}`);
  }
  run.notes.push({ kind: "closed", battlefield: battle, detail: occupied.join(", ") });
  if (!battle.recorder) startRecorder(battle, run, day);
  recordDay(battle, day, true);
  battle.replay = battle.recorder.finish({ date: run.input.fromDate, days: day });
  battle.closing = "";
};

// What names a war as it stands for the question "do its sides touch anywhere
// no battlefield covers": its members, and the regions each side holds that do
// not lie wholly inside one of its battlefields. "" when the regions are not known.
const contactKey = (run, war) => {
  if (!run.regionIds) return "";
  const frames = run.battles.filter((battle) => battle.warId === war.id && battle.status !== "closed");
  const covered = (id) => frames.some((battle) => battle.arena.indexOf.has(id) && battle.arena.outside[battle.arena.indexOf.get(id)] === 0);
  const held = [[], []];
  for (const id of run.regionIds) {
    const side = warSideOf(run, war, id);
    if (side >= 0 && !covered(id)) held[side].push(id);
  }
  return `contact|${clean(run.input.map?.key)}|${war.id}|${hashKey([war.sides[0].join("\u0002"), war.sides[1].join("\u0002"), held[0].length, held[1].length, held[0].join("\u0002"), held[1].join("\u0002")])}`;
};

// Opens a battlefield for every stretch where an active war's two sides touch
// and none covers it. A war already looked at as it stands is not looked at
// again: that answer is kept with the arenas, so an overseas war does not ask
// for the map's shapes turn after turn.
const examineWar = (run, war, day) => {
  if (war.status !== "active" || war.sides[0].length === 0 || war.sides[1].length === 0) return;
  adoptStanding(run, war);
  const key = contactKey(run, war);
  if (key && run.cache?.get(key) === true) return;
  const regions = regionsOf(run);
  if (!regions) throw REGIONS_NEEDED;
  const map = run.input.map;
  for (const contact of findContacts(regions, (id) => warSideOf(run, war, id), map)) {
    if (run.battles.some((battle) => battle.warId === war.id && battle.status !== "closed" && pointInFrame(battle.frame, contact.lng, contact.lat))) continue;
    if (openBattles(run).length >= MAX_BATTLEFIELDS) {
      run.notes.push({ kind: "too-many-battlefields", detail: war.title || war.id });
      break;
    }
    const frame = frameForContact(contact, map);
    const arena = frame ? arenaFor(run.cache, map, frame, run.input.regionTypes) : null;
    if (!arena) continue;
    const battle = openBattle(run, { name: "", warId: war.id, sides: war.sides, frame, arena, day });
    if (!battle) continue;
    battle.name = nameFor(run, battle);
    battle.autoNamed = true;
    startBattle(run, battle, day);
  }
  const after = contactKey(run, war);
  if (after && run.cache) run.cache.set(after, true);
};

// ---- a war changing ------------------------------------------------------------

// Counters for a member that has just joined a battle, on its side's ground
// along the line: as many as its own strength brings, while the line has room
// for them.
const raiseFor = (battle, run, side, owner) => {
  const wanted = Math.round(TROOPS_PER_STRENGTH * memberWeights(battle, run, side)[owner] * EFFORT_FACTORS[battle.effort[side]]);
  const room = Math.min(MAX_TROOPS_PER_SIDE - battle.troops[side].length, troopsCap(battle.lineKm) - liveCount(battle.troops[side]));
  const count = Math.max(0, Math.min(room, Math.max(2, wanted)));
  const contour = traceContour(battle.field);
  const own = side === HOLDER_SIDE_A ? contour.cellA : contour.cellB;
  const cells = [];
  for (let vertex = 0; vertex < own.length; vertex += 1) if (own[vertex] >= 0) cells.push(own[vertex]);
  if (cells.length === 0) return;
  for (let index = 0; index < count; index += 1) {
    const cell = cells[Math.min(cells.length - 1, Math.floor(((index + 0.5) * cells.length) / count))];
    battle.troops[side].push(createTroop({ x: (cell % battle.field.cols) + 0.5, y: Math.floor(cell / battle.field.cols) + 0.5, owner }));
  }
  battle.pool[side] += count * POOL_PER_TROOP;
};

const joinBattle = (run, battle, side, names) => {
  for (const name of names) {
    const index = battle.sides[side].findIndex((member) => fold(member) === fold(name));
    if (index >= 0 && !battle.gone[side].has(index)) continue;
    if (sideOfName(battle, name) >= 0) continue;
    let owner = index;
    if (index >= 0) battle.gone[side].delete(index);
    else if (battle.sides[side].length < MAX_SIDE_MEMBERS) owner = battle.sides[side].push(name) - 1;
    else continue;
    // Its land in the frame becomes its side's ground.
    reconcile(battle, run);
    raiseFor(battle, run, side, owner);
    paintGround(battle, run);
  }
  battle.planKey = "";
};

const leaveBattle = (run, battle, names) => {
  for (const name of names) {
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
      const index = battle.sides[side].findIndex((member, at) => fold(member) === fold(name) && !battle.gone[side].has(at));
      if (index < 0) continue;
      battle.gone[side].add(index);
      // Its troops go home with it: a named formation back to the world, the rest away.
      battle.troops[side].forEach((troop, at) => {
        if (troop.owner !== index || !isLive(troop)) return;
        const named = battle.named.find((entry) => entry.s === side && entry.i === at);
        if (named && !named.reported) {
          const [lng, lat] = battle.place.toLngLat(troop.x, troop.y);
          run.unitChanges.push({ unitId: named.unitId, committedTo: "", lng, lat, strength: Math.round(troop.strength) });
          named.reported = true;
        }
        troop.strength = 0;
        troop.station = null;
      });
      if (battle.gone[side].size >= battle.sides[side].length) battle.closing = "left";
    }
  }
  // Its ground is no longer either side's: it becomes wall.
  reconcile(battle, run);
  battle.planKey = "";
};

// ---- a border fortified in peace -----------------------------------------------
// Troops may be deployed along a border with no war behind it: a battlefield
// that is STANDING. Nothing fights there and no ground changes hands; an order
// to attack is refused. If a war between its two sides begins it becomes
// active as it stands, with whoever is dug in there.

const BORDER = /^\s*border\s*:\s*(.+?)\s*\/\s*(.+?)\s*$/i;

// Which side of a war a name fights on: 0, 1, or -1.
const warSide = (war, name) => (war.sides[0].some((member) => fold(member) === fold(name)) ? 0 : war.sides[1].some((member) => fold(member) === fold(name)) ? 1 : -1);
// A battle's side for a side of its war: the same, unless the battle was laid
// out before the war and its first side fights on the war's second.
const battleSide = (battle, side) => (battle.swap ? 1 - side : side);

// A standing battlefield whose two sides have gone to war with each other is
// that war's from now on: whoever has nobody there yet raises troops.
const adoptStanding = (run, war) => {
  for (const battle of run.battles) {
    if (battle.status !== "standing") continue;
    const first = warSide(war, battle.sides[0][0]);
    const second = warSide(war, battle.sides[1][0]);
    if (first < 0 || second < 0 || first === second) continue;
    battle.warId = war.id;
    battle.status = war.status === "ceasefire" ? "frozen" : "active";
    battle.swap = first === 1;
    for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) if (liveCount(battle.troops[side]) === 0) raiseTroops(battle, run, side);
    setRadii(battle);
    paintGround(battle, run);
    battle.planKey = "";
    battle.touched = true;
  }
};

// A day on a border fortified in peace: nothing happens. Left at token effort
// with nothing ordered for long enough, or with nobody on it, it is given up.
const standDay = (battle) => {
  battle.quiet += 1;
  const manned = [HOLDER_SIDE_A, HOLDER_SIDE_B].filter((side) => liveCount(battle.troops[side]) > 0);
  if (manned.length === 0 || (battle.quiet >= STANDING_QUIET_DAYS && manned.every((side) => battle.effort[side] === "token"))) battle.closing = "stood-down";
};

// A saved battlefield against its war as the war now stands: who is in it,
// and whether it is fought, frozen or over.
const syncWithWar = (run, battle) => {
  if (battle.status === "standing") {
    for (const war of run.wars.values()) if (war.status !== "ended") adoptStanding(run, war);
    if (battle.status === "standing") return;
  }
  const war = run.wars.get(battle.warId);
  if (!war || war.status === "ended") {
    battle.closing = "war-over";
    return;
  }
  battle.swap = warSide(war, battle.sides[0][0]) === 1;
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const theirs = war.sides[battleSide(battle, side)];
    const left = battle.sides[side].filter((member) => !theirs.some((name) => fold(name) === fold(member)));
    if (left.length > 0) leaveBattle(run, battle, left);
    joinBattle(run, battle, side, theirs);
  }
  battle.status = war.status === "ceasefire" ? "frozen" : "active";
};

// ---- moments -------------------------------------------------------------------

// A landing where no battlefield is: one opens round the place, the attacker
// holding a disc of ground there with an anchor that feeds it. The place is a
// city of the map or a region, by its exact name. null when it cannot be done.
const openLanding = (run, moment, day) => {
  const regions = regionsOf(run);
  const war = [...run.wars.values()].find((entry) => entry.status === "active" && entry.sides.some((members) => members.some((member) => fold(member) === fold(moment.side))));
  const named = /^\s*(city|region)\s*:\s*(.*)$/i.exec(String(moment.objective ?? ""));
  const wanted = fold(named ? named[2] : moment.objective);
  if (!war || !wanted || openBattles(run).length >= MAX_BATTLEFIELDS) return null;
  if (!regions) throw REGIONS_NEEDED;
  const map = run.input.map;
  const kind = named ? named[1].toLowerCase() : "";
  const city = kind === "region" ? null : (Array.isArray(map.cities) ? map.cities : []).find((entry) => fold(entry?.name) === wanted);
  const region = city || kind === "city" ? null : regions.find((entry) => fold(entry?.name) === wanted);
  if (!city && !region) return null;
  const [lng, lat] = city ? [Number(city.lng), Number(city.lat)] : middleOf(region);
  // The frame a contact there would have: the box round both sides' land within reach of the place.
  const contact = contactAt(regions, (id) => warSideOf(run, war, id), map, lng, lat);
  const frame = contact ? frameForContact(contact, map) : null;
  const arena = frame ? arenaFor(run.cache, map, frame, run.input.regionTypes) : null;
  if (!arena) return null;
  const opening = { name: clean(moment.battlefield, BATTLEFIELD_NAME_MAX), warId: war.id, sides: war.sides, frame, arena, day };
  const battle = openBattle(run, opening) ?? landingGround(run, opening);
  const side = sideOfName(battle, moment.side);
  const [x, y] = battle.place.toCell(lng, lat);
  const cell = x >= 0 && y >= 0 && x < arena.cols && y < arena.rows ? Math.floor(y) * arena.cols + Math.floor(x) : -1;
  if (side < 0 || cell < 0 || battle.field.holders[cell] !== 1 - side) return null;
  takeCapsule(battle.field, side, x, y, x, y, LANDING_CELLS, LANDING_CELLS);
  redistance(battle.field);
  battle.anchors.push({ s: side, x, y });
  startBattle(run, battle, day);
  return battle;
};

// The ground of a battlefield whose sides do not touch yet: every cell held by
// its region's side, and no line.
const landingGround = (run, opening) => {
  const battle = loadBattle(run, {
    name: opening.name,
    warId: opening.warId,
    sides: opening.sides,
    frame: opening.frame,
    openedDate: run.dateOf(opening.day),
    status: "active",
    field: { mask: "", band: "", key: opening.arena.key },
    troops: ["", ""],
    named: [],
    pool: [0, 0],
    base: [0, 0],
    quality: [1, 1],
    effort: ["major", "major"],
    orders: [],
    brief: {},
    log: [],
  }, opening.arena);
  battle.openedDay = opening.day;
  battle.fresh = true;
  return battle;
};

// An order on a battlefield that is fought over (or frozen): put to its side as it is.
const orderOnFront = (run, battle, moment, day) => {
  const today = prepare(battle, day);
  applyOrder(battle, moment, { ...today, date: run.dateOf(day), run }, run.notes);
  battle.touched = true;
  // What a result took is counted on its own day: a town in the log, a region changing hands.
  if (battle.status === "active" && battle.cityHolder) settleRegions(battle, run, day);
};

// An order for a border: `border: A / B`, to dig in or to hold. It opens a
// standing battlefield along the stretch where the two touch if there is none,
// raises troops there for the side that gives it, and puts the order to them.
// Between two that are at war already the border is the front: the order goes
// to every battlefield the two share, whatever it is.
const applyBorderMoment = (run, moment, day, first, second) => {
  const note = { kind: "", battlefield: clean(moment.battlefield, BATTLEFIELD_NAME_MAX), side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) };
  const names = [clean(`${first} / ${second} border`, BATTLEFIELD_NAME_MAX), clean(`${second} / ${first} border`, BATTLEFIELD_NAME_MAX)];
  let battle = run.battles.find((entry) => entry.status !== "closed" && names.some((name) => foldBattlefieldName(entry.name) === foldBattlefieldName(name))) ?? null;
  if (!battle) {
    const fronts = run.battles.filter((entry) => entry.status !== "closed" && entry.status !== "standing" && sideOfName(entry, first) >= 0 && sideOfName(entry, second) >= 0 && sideOfName(entry, first) !== sideOfName(entry, second));
    if (fronts.length > 0) {
      for (const front of fronts) orderOnFront(run, front, { ...moment, battlefield: front.name }, day);
      return;
    }
    const atWar = [...run.wars.values()].some((war) => war.status !== "ended" && warSide(war, first) >= 0 && warSide(war, second) >= 0 && warSide(war, first) !== warSide(war, second));
    if (atWar || !["dig in", "hold"].includes(moment.order) || fold(first) === fold(second)) {
      run.notes.push({ ...note, kind: atWar ? "border-at-war" : "not-at-war" });
      return;
    }
    if (openBattles(run).length >= MAX_BATTLEFIELDS) {
      run.notes.push({ ...note, kind: "too-many-battlefields" });
      return;
    }
    const regions = regionsOf(run);
    if (!regions) throw REGIONS_NEEDED;
    const map = run.input.map;
    const sideOf = (id) => {
      const holder = run.groupOf(id) || run.controllerOf(id);
      return fold(holder) === fold(first) ? 0 : fold(holder) === fold(second) ? 1 : -1;
    };
    for (const contact of findContacts(regions, sideOf, map)) {
      const frame = frameForContact(contact, map);
      const arena = frame ? arenaFor(run.cache, map, frame, run.input.regionTypes) : null;
      battle = arena ? openBattle(run, { name: names[0], warId: "", sides: [[first], [second]], frame, arena, day }) : null;
      if (battle) break;
    }
    if (!battle) {
      run.notes.push({ ...note, kind: "border-not-found" });
      return;
    }
    battle.status = "standing";
    run.battles.push(battle);
    setRadii(battle);
    paintGround(battle, run);
    keepStart(battle);
    readSieges(battle);
    findPockets(battle);
    startRecorder(battle, run, day);
  }
  orderOnBorder(run, battle, moment, day);
};

// An order given on a border fortified in peace, by whichever name the
// battlefield was called. The side that gives it raises troops there if it has
// none; told to leave by every side that has troops there, it is given up.
const orderOnBorder = (run, battle, moment, day) => {
  const note = { kind: "", battlefield: battle.name, side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) };
  const side = sideOfName(battle, moment.side);
  if (side < 0) {
    run.notes.push({ ...note, kind: "side-not-fighting" });
    return;
  }
  battle.quiet = 0;
  battle.touched = true;
  if (battle.status === "standing") {
    if (FRONT_EFFORTS.includes(moment.effort)) battle.effort[side] = moment.effort;
    // Told to leave by every side that has troops there, it is given up.
    battle.leaving[side] = moment.order === "fall back";
    if ([HOLDER_SIDE_A, HOLDER_SIDE_B].every((each) => battle.leaving[each] || liveCount(battle.troops[each]) === 0) && moment.order === "fall back") {
      battle.closing = "stood-down";
      return;
    }
    if (liveCount(battle.troops[side]) === 0 && ["dig in", "hold"].includes(moment.order)) {
      raiseTroops(battle, run, side);
      setRadii(battle);
      paintGround(battle, run);
    }
  }
  orderOnFront(run, battle, { ...moment, battlefield: battle.name }, day);
};

const applyOrderMoment = (run, moment, day) => {
  const border = BORDER.exec(String(moment.battlefield ?? ""));
  if (border) {
    applyBorderMoment(run, moment, day, clean(border[1]), clean(border[2]));
    return;
  }
  const wanted = foldBattlefieldName(moment.battlefield);
  let battle = wanted ? run.battles.find((entry) => entry.status !== "closed" && foldBattlefieldName(entry.name) === wanted) : null;
  if (!battle && wanted) {
    // A battlefield that opened by itself this run takes the name its first order gives it.
    battle = run.battles.find((entry) => entry.autoNamed && entry.fresh && entry.status === "active" && sideOfName(entry, moment.side) >= 0) ?? null;
    if (battle) {
      battle.name = clean(moment.battlefield, BATTLEFIELD_NAME_MAX);
      battle.autoNamed = false;
    }
  }
  if (!battle && wanted && moment.order === "land") {
    battle = openLanding(run, moment, day);
    if (battle) return;
  }
  if (!battle) {
    run.notes.push({ kind: "unknown-battlefield", battlefield: clean(moment.battlefield, BATTLEFIELD_NAME_MAX), side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) });
    return;
  }
  if (battle.status === "standing") orderOnBorder(run, battle, moment, day);
  else orderOnFront(run, battle, moment, day);
};

const applyWarMoment = (run, moment, day) => {
  const id = clean(moment.warId);
  const names = memberList(moment.names);
  const mine = () => run.battles.filter((battle) => battle.warId === id && battle.status !== "closed");
  if (moment.op === "start") {
    if (!id || run.wars.has(id)) return;
    run.wars.set(id, { id, title: clean(moment.title), status: "active", sides: [names, memberList(moment.opponents)] });
    examineWar(run, run.wars.get(id), day);
    return;
  }
  const war = run.wars.get(id);
  if (!war) return;
  if (moment.op === "join-a" || moment.op === "join-b") {
    const side = moment.op === "join-a" ? 0 : 1;
    for (const name of names) {
      if (!war.sides.some((members) => members.some((member) => fold(member) === fold(name))) && war.sides[side].length < MAX_SIDE_MEMBERS) war.sides[side].push(name);
    }
    for (const battle of mine()) {
      joinBattle(run, battle, battleSide(battle, side), names);
      battle.touched = true;
    }
    examineWar(run, war, day);
  } else if (moment.op === "leave") {
    war.sides = war.sides.map((members) => members.filter((member) => !names.some((name) => fold(name) === fold(member))));
    for (const battle of mine()) {
      leaveBattle(run, battle, names);
      battle.touched = true;
    }
  } else if (moment.op === "ceasefire") {
    war.status = "ceasefire";
    for (const battle of mine()) battle.status = "frozen";
  } else if (moment.op === "resume") {
    war.status = "active";
    for (const battle of mine()) battle.status = "active";
    examineWar(run, war, day);
  } else if (moment.op === "end") {
    war.status = "ended";
    for (const battle of mine()) battle.closing = "war-over";
  }
};

// A land formation raised or sent to a battlefield during the run.
const applyReinforce = (run, moment) => {
  const kind = typeof moment.kind === "number" ? TROOP_KINDS[moment.kind] : String(moment.kind ?? "infantry");
  const unit = { id: clean(moment.unitId), name: clean(moment.name), type: kind, ownerCode: moment.owner, strength: moment.strength, lng: moment.lng, lat: moment.lat };
  for (const battle of run.battles) {
    if (battle.status !== "active" || sideOfName(battle, moment.owner) < 0 || !pointInFrame(battle.frame, Number(moment.lng), Number(moment.lat))) continue;
    if (unit.id) {
      if (run.taken.has(unit.id) || !absorbUnit(battle, run, unit, { anyDistance: true })) continue;
      run.taken.add(unit.id);
    } else {
      const side = sideOfName(battle, moment.owner);
      if (battle.troops[side].length >= MAX_TROOPS_PER_SIDE || !TROOP_KINDS.includes(kind)) continue;
      const [x, y] = battle.place.toCell(Number(moment.lng), Number(moment.lat));
      const owner = battle.sides[side].findIndex((member) => fold(member) === fold(moment.owner));
      battle.troops[side].push(createTroop({ x, y, strength: Math.min(100, Math.max(1, Number(moment.strength) || 100)), kind: TROOP_KINDS.indexOf(kind), owner }));
      battle.planKey = "";
    }
    battle.touched = true;
    return;
  }
};

// Applies every moment dated up to a day, in the order they were given.
const applyMoments = (run, day) => {
  while (run.cursor < run.moments.length && run.moments[run.cursor].day <= day) {
    const { moment } = run.moments[run.cursor];
    run.cursor += 1;
    if (moment.type === "order") applyOrderMoment(run, moment, day);
    else if (moment.type === "war") applyWarMoment(run, moment, day);
    else if (moment.type === "reinforce") applyReinforce(run, moment);
    else if (moment.type === "control") {
      // Someone other than the engine changed who controls a region: the world wins.
      const id = clean(moment.regionId);
      run.setController(id, moment.to);
      for (const battle of run.battles) {
        if (battle.status === "closed" || !battle.arena.indexOf.has(id)) continue;
        reconcile(battle, run);
        battle.planKey = "";
        battle.touched = true;
      }
    }
  }
  for (const battle of run.battles) if (battle.closing && battle.status !== "closed") closeBattle(run, battle, day);
  // What a moment did to the orders or the ground is read at once: which
  // places are besieged, and what is cut off.
  for (const battle of run.battles) {
    if (battle.status === "closed" || !battle.touched) continue;
    readSieges(battle);
    findPockets(battle);
  }
};

// ---- the run -------------------------------------------------------------------

// Whether a run that was given no shapes can do without them: no war moment
// that could open a battlefield, no landing where none is.
const mustHaveRegions = (run) => run.moments.some(({ moment }) => {
  if (moment.type === "war") return ["start", "join-a", "join-b", "resume"].includes(moment.op);
  if (moment.type !== "order") return false;
  // An order for a border that has no battlefield yet opens one.
  const border = BORDER.exec(String(moment.battlefield ?? ""));
  if (border) {
    const names = [`${clean(border[1])} / ${clean(border[2])} border`, `${clean(border[2])} / ${clean(border[1])} border`].map(foldBattlefieldName);
    return !normalizeBattlefields(run.input.battlefields).some((record) => record.status !== "closed" && names.includes(foldBattlefieldName(record.name)));
  }
  if (moment.order !== "land") return false;
  const wanted = foldBattlefieldName(moment.battlefield);
  return !normalizeBattlefields(run.input.battlefields).some((record) => record.status !== "closed" && foldBattlefieldName(record.name) === wanted);
});

const begin = (run) => {
  const { input } = run;
  const map = input.map ?? {};
  const regions = regionsOf(run);
  const listKey = `regions|${clean(map.key)}`;
  if (regions) {
    run.regionIds = regions.map((region) => clean(region?.id)).filter(Boolean);
    if (run.cache && clean(map.key)) run.cache.set(listKey, run.regionIds);
  } else {
    run.regionIds = run.cache?.get(listKey) ?? null;
    if (mustHaveRegions(run)) throw REGIONS_NEEDED;
  }

  // A closed battlefield has been through its one more run: it is not carried on.
  for (const record of normalizeBattlefields(input.battlefields)) {
    if (record.status === "closed" || !record.field) continue;
    const arena = arenaFor(run.cache, map, record.frame, input.regionTypes);
    if (!arena) throw REGIONS_NEEDED;
    run.battles.push(loadBattle(run, record, arena));
  }
  for (const battle of run.battles) {
    syncWithWar(run, battle);
    reconcile(battle, run);
    setRadii(battle);
  }
  for (const battle of run.battles) {
    if (battle.closing) continue;
    if (battle.status === "active") absorbUnits(battle, run);
    setRadii(battle);
    paintGround(battle, run);
    keepStart(battle);
    readSieges(battle);
    findPockets(battle);
    startRecorder(battle, run, 0);
    assignStanding(run, battle);
  }
  // A formation still marked as committed to a battlefield that is gone, or
  // that does not know it, is given back to the world.
  for (const unit of Array.isArray(input.units) ? input.units : []) {
    const committed = clean(unit?.committedTo);
    if (!committed || !clean(unit.id)) continue;
    const battle = run.battles.find((entry) => foldBattlefieldName(entry.name) === foldBattlefieldName(committed));
    if (!battle || !battle.named.some((entry) => entry.unitId === clean(unit.id))) run.unitChanges.push({ unitId: clean(unit.id), committedTo: "" });
  }
  for (const battle of run.battles.slice()) {
    if (battle.closing) {
      keepStart(battle);
      closeBattle(run, battle, 0);
    } else recordDay(battle, 0, run.days === 0);
  }
  for (const war of run.wars.values()) examineWar(run, war, 0);
  if (run.braked) run.notes.push({ kind: "tempo" });

  for (const battle of run.battles) battle.touched = false;
  applyMoments(run, 0);
  // What a moment of the first day did is part of the state the run begins from.
  for (const battle of run.battles) {
    if (battle.touched && battle.status !== "closed" && battle.recorded === 0) recordDay(battle, 0, run.days === 0);
  }
  // Every troop is under one of its side's generals from the first day.
  for (const battle of run.battles) if (battle.status !== "closed") assignCommands(battle);
};

// Puts each standing order of a battle that was carried over to the troops it
// is for: the ones the record says were serving it, or failing that those
// that stand in its sector. The ways are found afresh from where they stand.
const assignStanding = (run, battle) => {
  if (battle.status === "closed" || battle.orders.length === 0) return;
  const today = prepare(battle, 0);
  // Those for a body of troops picked out come last, so that they stand
  // whatever the stretch of line those troops are on was told; and such an
  // order is for those troops alone, never for a sector in their place.
  const turns = battle.orders.map((order, index) => index).sort((a, b) => (battle.orders[a].chosen ? 1 : 0) - (battle.orders[b].chosen ? 1 : 0) || a - b);
  for (const index of turns) {
    const order = battle.orders[index];
    const picked = [];
    if (battle.served) battle.troops[order.s].forEach((troop, at) => { if (troop.serves === index) picked.push(at); });
    if (order.chosen && picked.length === 0) continue;
    assignOrder(battle, run, order, { ...today, date: run.dateOf(0), run }, { picked: picked.length > 0 ? picked : null, lagless: order.age > 0 });
  }
};

const stepDay = (run) => {
  const day = run.day + 1;
  for (let index = 0; index < run.battles.length; index += 1) {
    const battle = run.battles[index];
    if (battle.status === "active") run.steps += simulateDay(battle, run, day);
    else if (battle.status === "standing") standDay(battle);
    if (battle.closing && battle.status !== "closed") closeBattle(run, battle, day);
  }
  applyMoments(run, day);
  for (const battle of run.battles) {
    if (battle.status !== "closed" && battle.recorded !== day) recordDay(battle, day, day >= run.days);
    // Whoever came today (reserves, a landing, a formation taken in) is put under a general.
    if (battle.status !== "closed") assignCommands(battle);
  }
  run.day = day;
};

// The result of a run as it stands after the days simulated so far.
const snapshot = (run) => {
  const day = run.day;
  const changes = run.unitChanges.map(({ committedTo, ...change }) => ({ ...change, committedTo: typeof committedTo === "string" ? committedTo : committedTo.name }));
  const records = run.battles.map((battle) => saveBattle(battle, run, day, changes, buildBrief(battle, battle.openedDay > 0 ? battle.openedDate : run.dateOf(0))));
  const open = records.filter((record) => record.status !== "closed").slice(0, MAX_BATTLEFIELDS);
  const closed = records.filter((record) => record.status === "closed").slice(-MAX_CLOSED_BATTLEFIELDS);
  return {
    battlefields: [...open, ...closed],
    flips: run.flips.map(({ day: on, date, battlefield, regionId, from, to, kind }) => ({ day: on, date, battlefield: battlefield.name, regionId, from, to, kind })),
    unitChanges: changes,
    notes: run.notes.map((note) => (note.battlefield && typeof note.battlefield === "object" ? { ...note, battlefield: note.battlefield.name } : { ...note })),
    stats: { days: day, steps: run.steps },
  };
};

export const createFrontRun = (input) => {
  let run = null;
  let needsRegions = false;
  // The work of a run, with the one thing it may stop for: shapes it was not given.
  const work = (task) => {
    if (needsRegions) return;
    try {
      task();
    } catch (error) {
      if (error !== REGIONS_NEEDED) throw error;
      needsRegions = true;
    }
  };
  work(() => {
    run = createRun(input ?? {});
    begin(run);
  });
  const advance = (maxDays = Infinity) => {
    work(() => {
      for (let done = 0; done < maxDays && run.day < run.days; done += 1) stepDay(run);
    });
    return needsRegions || run.day >= run.days;
  };
  return {
    // Simulates up to `maxDays` more days; true when the run is finished.
    advance,
    // The result as it stands now, without ending the run: what a run cut here would give.
    snapshot: () => (needsRegions ? { needsRegions: true } : snapshot(run)),
    finish: () => {
      advance();
      return needsRegions ? { needsRegions: true } : snapshot(run);
    },
  };
};

export const runFronts = (input) => createFrontRun(input).finish();
