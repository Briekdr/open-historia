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

import { addGameDays, compareGameDates, gameDateYear } from "../gameDates.js";
import { waterTypeIds } from "../regionTypes.js";
import { ADVANCE_KM_PER_DAY, OVERLAND_KM_PER_DAY, eraOf } from "../unitMotion.js";
import { arenaFor } from "./arena.js";
import { absorbUnit, holderOf, keepStart, lineLength, loadBattle, memberIndex, memberWeights, openBattle, paintGround, raiseTroops, readRegion, reconcile, releaseNamed, saveBattle, setHandicap, setRadii, sideOfName } from "./battle.js";
import { buildBrief } from "./brief.js";
import { assignCommands } from "./command.js";
import { hashKey } from "./codec.js";
import {
  BATTLEFIELD_NAME_MAX,
  EFFORT_FACTORS,
  FRONT_EFFORTS,
  FRONT_ORDERS,
  HOLDER_SIDE_A,
  HOLDER_SIDE_B,
  HAND_OVER_REACH_CELLS,
  SCENARIO_MARK,
  WAR_EFFORTS,
  INVADE_REACH_KM,
  LANDING_CELLS,
  MAX_BATTLEFIELDS,
  MAX_CLOSED_BATTLEFIELDS,
  MAX_SIDE_MEMBERS,
  MAX_TROOPS_PER_SIDE,
  POOL_PER_TROOP,
  STAFF_MARK,
  STAFF_REVIEW_DAYS,
  STANDING_QUIET_DAYS,
  TROOPS_PER_STRENGTH,
  TROOP_KINDS,
  WITHDRAW_DAYS_MOST,
  WITHDRAW_KM,
} from "./constants.js";
import { contactAt, findContacts, frameForContact, middleOf } from "./contact.js";
import { REGIONS_NEEDED, prepare, recordDay, settleRegions, simulateDay, startRecorder } from "./day.js";
import { redistance, takeCapsule, traceContour } from "./field.js";
import { pointInFrame } from "./frame.js";
import { landWithin, othersOnWay } from "./invade.js";
import { applyOrder, assignOrder, landCarried, putAshore, readSieges, setStandingOrder } from "./orders.js";
import { foldBattlefieldName, normalizeBattlefields } from "./record.js";
import { authoredName } from "./scenarioFronts.js";
import { sideIsPlayed, staffDecision, staffMayOrder, staffStanding } from "./staff.js";
import { findPockets } from "./supply.js";
import { TRANSPORT_ENDED, boundFor, interceptionOf, loadOf, moveOn, normalizeTransports, setOut, struck, transportChance } from "./transports.js";
import { createTroop, isLive, kindsFor, liveCount, troopsCap } from "./troops.js";
import { buildWorldGrid, kmBetween, placeAlong, worldSheetKey } from "./worldGrid.js";

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
    // The countries troops were sent into during the run, each brought into
    // its war (invadeWhereSent): the caller writes them into the war ledger.
    joins: [],
    // The wars that began during the run because one country sent its troops
    // at another it was at peace with (attackOpensWar): for the ledger too.
    starts: [],
    // The transporters of the world (transports.js), and what became of each
    // during the run, in the order it happened.
    transports: [],
    voyages: [],
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
    // One that withdrew from here is left where it went, and a side that is away takes nobody in.
    if (battle.sentHome.has(id)) continue;
    const side = sideOfName(battle, unit?.ownerCode ?? unit?.owner);
    if (side >= 0 && battle.away[side]) continue;
    if (absorbUnit(battle, run, unit)) run.taken.add(id);
  }
};

// A battle that has just opened: troops are raised, formations taken in, and
// its first day goes to the recorder.
//   landed   troops a transporter brought there: { side, x, y, load, owner }.
//            They are its side's force, so only the side landed on raises any.
const startBattle = (run, battle, day, landed = null) => {
  run.battles.push(battle);
  raiseTroops(battle, run, landed ? 1 - landed.side : -1);
  if (landed) {
    battle.base[landed.side] = Math.round(memberWeights(battle, run, landed.side).reduce((sum, weight) => sum + weight, 0) * 1000) / 1000;
    putAshore(battle, landed.side, landed.x, landed.y, landed.load, landed.owner);
  }
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

// The map's regions that are LAND. Two sides touch where their land does: a
// stretch of sea each holds a region of is no front, and no frame is laid
// round it. null while the shapes have not been read.
const landRegionsOf = (run) => {
  const regions = regionsOf(run);
  if (!regions) return null;
  if (run.landRegions?.of !== regions) {
    const water = waterTypeIds(run.input.regionTypes);
    run.landRegions = { of: regions, list: water.size > 0 ? regions.filter((region) => !water.has(clean(region?.typeId))) : regions };
  }
  return run.landRegions.list;
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
  const regions = landRegionsOf(run);
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
  let cells = [];
  for (let vertex = 0; vertex < own.length; vertex += 1) if (own[vertex] >= 0) cells.push(own[vertex]);
  // On its OWN stretch of the line, where it has one: a country that has just
  // been attacked stands on its own border, not along its ally's front.
  const wantedName = fold(battle.sides[side][owner]);
  const home = cells.filter((cell) => {
    const region = battle.arena.region[cell];
    return region > 0 && fold(holderOf(battle, run, battle.arena.ids[region])) === wantedName;
  });
  if (home.length > 0) cells = home;
  if (cells.length === 0) return;
  for (let index = 0; index < count; index += 1) {
    const cell = cells[Math.min(cells.length - 1, Math.floor(((index + 0.5) * cells.length) / count))];
    battle.troops[side].push(createTroop({ x: (cell % battle.field.cols) + 0.5, y: Math.floor(cell / battle.field.cols) + 0.5, owner }));
  }
  battle.pool[side] += count * POOL_PER_TROOP * battle.edge[side].reserves;
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
    // Its land in the frame becomes its side's ground, and the line is as
    // long as it now is: how many troops there is room for goes by that.
    reconcile(battle, run);
    lineLength(battle);
    // (Who is fighting has changed: so, it may be, has which side the difficulty weighs.)
    setHandicap(battle, run);
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
  setHandicap(battle, run);
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
    // What stood on it was the posture of a border at peace: the war is the
    // event that ends it, and whoever began the war is there to attack (reviewStaff).
    for (const order of battle.orders) if (order.mark === SCENARIO_MARK) delete order.mark;
    battle.begun = battle.status === "active";
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

// ---- a war that begins with an attack -------------------------------------------
// A side may send its troops at a country it is not at war with: a line of
// orders that has it attack across their border, an order aimed at a place the
// other holds, a transporter bound for its land. That IS the war beginning,
// whoever the other is: a country a person plays is attacked like any other.
// A war begins between the two (`starts`), whatever other war either is
// fighting: the country attacked is at war with whoever attacked it and with
// nobody else, and who else comes into that war is the story's to say. (Only
// a ROUTE drawn through a country outside a war brings it into that war,
// `joins`: the troops on that battlefield are the ones it has to fight.) The
// caller writes it into the war ledger, so the ledger says what the
// battlefields do.

const ATTACK_ORDERS = ["advance", "blitz", "spearhead", "flank", "encircle", "assault", "land"];
const isAttackWord = (word) => ATTACK_ORDERS.includes(word);
// The war two names are on opposite sides of (fought, or frozen), or null.
const warBetween = (run, a, b) => [...run.wars.values()].find((war) => war.status !== "ended" && warSide(war, a) >= 0 && warSide(war, b) >= 0 && warSide(war, a) !== warSide(war, b)) ?? null;
const slugOf = (name) => fold(name).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
// Nobody's war: what stands in for one while a country at peace is finding its
// way to another's land, or asking whose a place is.
const peaceOf = (owner, others = []) => ({ id: "", status: "active", sides: [[owner], others], peace: true });

// The war an attack by one country on another is fought in from `day`, or
// null when there is none to be had (they are allies in a war, a ceasefire
// stands between them, or there is no room for another member).
//   serious   false for an order of the story's that is no war by itself (seriousAttack):
//             it opens only a war the story opens in the same answer
const attackOpensWar = (run, attacker, defender, day, serious = true) => {
  if (!clean(attacker) || !clean(defender) || fold(attacker) === fold(defender)) return null;
  const between = warBetween(run, attacker, defender);
  if (between) return between.status === "active" ? between : null;
  const date = run.dateOf(day);
  // Nobody attacks a country it is fighting a war beside.
  if ([...run.wars.values()].some((war) => war.status !== "ended" && warSide(war, attacker) >= 0 && warSide(war, attacker) === warSide(war, defender))) return null;
  // The story may open this very war in the same answer, on a later day: that is the war, and it begins today.
  const told = run.moments.findIndex(({ moment }, at) => at >= run.cursor && moment.type === "war" && moment.op === "start"
    && [[moment.names, moment.opponents], [moment.opponents, moment.names]].some(([one, other]) => memberList(one).some((name) => fold(name) === fold(attacker)) && memberList(other).some((name) => fold(name) === fold(defender))));
  if (told >= 0) {
    const [{ moment }] = run.moments.splice(told, 1);
    applyWarMoment(run, moment, day);
    return run.wars.get(clean(moment.warId)) ?? null;
  }
  if (!serious) return null;
  const id = `war-${slugOf(attacker)}-${slugOf(defender)}-${date}`;
  if (run.wars.has(id)) return run.wars.get(id).status === "active" ? run.wars.get(id) : null;
  run.wars.set(id, { id, title: "", status: "active", sides: [[clean(attacker)], [clean(defender)]] });
  run.starts.push({ day, date, warId: id, attacker: clean(attacker), defender: clean(defender) });
  examineWar(run, run.wars.get(id), day);
  return run.wars.get(id);
};

// BATTLEFIELDS ARE FOR WARS. "Border clashes, minor incidents and so forth
// also just cause war fronts to happen": an order of the story's to attack a
// country its giver is at peace with used to be the war beginning, whatever
// the event behind it was. It begins one now only as a real offensive (effort
// major or total), or when the story opens that war itself in its ledger. A
// person's own order is that person's decision and always does: one given
// through the skip's function, and any line for a country a person plays (the
// story writes none for it of its own: such a line is what that person's
// action said).
const seriousAttack = (run, moment) => moment.given === true || WAR_EFFORTS.includes(moment.effort)
  || (Array.isArray(run.input?.players) ? run.input.players : []).some((name) => fold(name) === fold(moment.side));

// The battlefields two names fight each other on.
const frontsBetween = (run, a, b) => run.battles.filter((entry) => entry.status === "active" && sideOfName(entry, a) >= 0 && sideOfName(entry, b) >= 0 && sideOfName(entry, a) !== sideOfName(entry, b));
// The log's word for an attack that began a war, or brought a country into one.
const tellAttack = (run, battle, attacker, defender, day) => {
  const side = sideOfName(battle, attacker);
  if (side >= 0) battle.log.push({ d: run.dateOf(day), k: "attacked", s: side, at: `${run.isGroup(defender) ? "group" : "country"}: ${defender}` });
};
// Whether two names hold land that touches.
const landsTouch = (run, first, second) => {
  const regions = landRegionsOf(run);
  if (!regions) throw REGIONS_NEEDED;
  const sideOf = (id) => {
    const holder = run.groupOf(id) || run.controllerOf(id);
    return fold(holder) === fold(first) ? 0 : fold(holder) === fold(second) ? 1 : -1;
  };
  return findContacts(regions, sideOf, run.input.map).length > 0;
};

// An order that names no battlefield there is, but aims its side's troops at a
// place: who holds the place is who is attacked. Between two at war already it
// goes to the battlefields they share; between two at peace the war begins,
// and the battlefield that opens for it takes the order's name. A landing
// opens one round the place where they do not touch. Returns true when the
// order was put to somebody.
const attackAtObjective = (run, moment, day) => {
  const attacker = clean(moment.side);
  const grid = worldGridOf(run);
  if (!grid || !attacker) return false;
  const alone = peaceOf(attacker);
  const at = moment.objectiveAt && Number.isFinite(Number(moment.objectiveAt.lng)) && Number.isFinite(Number(moment.objectiveAt.lat))
    ? { lng: Number(moment.objectiveAt.lng), lat: Number(moment.objectiveAt.lat) }
    : placeNamed(run, grid, alone, moment.objective);
  if (!at) return false;
  const defender = holderAtPoint(run, grid, alone, at.lng, at.lat);
  if (!defender || fold(defender) === fold(attacker)) return false;
  const already = warBetween(run, attacker, defender);
  // (A landing needs no border; anything else needs one to cross.)
  if (!already && moment.order !== "land" && !landsTouch(run, attacker, defender)) return false;
  const war = already ?? attackOpensWar(run, attacker, defender, day, seriousAttack(run, moment));
  if (!war && !already && !seriousAttack(run, moment)) {
    run.notes.push({ kind: "minor-attack", battlefield: clean(moment.battlefield, BATTLEFIELD_NAME_MAX), side: attacker, ...(moment.ref !== undefined ? { ref: moment.ref } : {}) });
    return true;
  }
  if (!war || war.status !== "active") return false;
  let fronts = frontsBetween(run, attacker, defender);
  if (fronts.length === 0 && moment.order === "land" && openBattles(run).length < MAX_BATTLEFIELDS) {
    const taken = run.battles.some((entry) => entry.status !== "closed" && foldBattlefieldName(entry.name) === foldBattlefieldName(moment.battlefield));
    const landing = openLandingAt(run, { war, sideName: attacker, lng: at.lng, lat: at.lat, name: taken ? "" : moment.battlefield, day });
    if (!landing) return false;
    if (!already) tellAttack(run, landing, attacker, defender, day);
    return true;
  }
  if (fronts.length === 0) return false;
  // The one the place lies on, where there are several.
  const near = fronts.find((entry) => pointInFrame(entry.frame, at.lng, at.lat)) ?? fronts[0];
  if (near.autoNamed && near.fresh && !run.battles.some((entry) => entry !== near && entry.status !== "closed" && foldBattlefieldName(entry.name) === foldBattlefieldName(moment.battlefield))) {
    near.name = clean(moment.battlefield, BATTLEFIELD_NAME_MAX);
    near.autoNamed = false;
  }
  if (!already) for (const front of fronts) tellAttack(run, front, attacker, defender, day);
  orderOnFront(run, near, { ...moment, battlefield: near.name }, day);
  return true;
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
  return openLandingAt(run, { war, sideName: moment.side, lng, lat, name: moment.battlefield, day });
};

// The battlefield a landing at a point opens, begun: the attacker holds a disc
// of ground there. null when it cannot be (no room for another battlefield,
// neither side's land near, or the place is not the other side's).
//   carried   the troops a transporter brought ([[strength, kind]...]): they
//             are the attacker's force there. Without it both sides raise theirs.
const openLandingAt = (run, { war, sideName, lng, lat, name = "", day, carried = null }) => {
  const regions = landRegionsOf(run);
  if (!war || openBattles(run).length >= MAX_BATTLEFIELDS) return null;
  if (!regions) throw REGIONS_NEEDED;
  const map = run.input.map;
  // The frame a contact there would have: the box round both sides' land within reach of the place.
  const contact = contactAt(regions, (id) => warSideOf(run, war, id), map, lng, lat);
  const frame = contact ? frameForContact(contact, map) : null;
  const arena = frame ? arenaFor(run.cache, map, frame, run.input.regionTypes) : null;
  if (!arena) return null;
  const opening = { name: clean(name, BATTLEFIELD_NAME_MAX), warId: war.id, sides: war.sides, frame, arena, day };
  const battle = openBattle(run, opening) ?? landingGround(run, opening);
  const side = sideOfName(battle, sideName);
  let [x, y] = battle.place.toCell(lng, lat);
  let cell = x >= 0 && y >= 0 && x < arena.cols && y < arena.rows ? Math.floor(y) * arena.cols + Math.floor(x) : -1;
  // (Troops set down on a coast are put on the other side's nearest ground: the point may fall in the water beside it.)
  if (carried && side >= 0 && cell >= 0 && battle.field.holders[cell] !== 1 - side) {
    cell = nearestHeldCell(battle.field, 1 - side, x, y, 4);
    if (cell >= 0) {
      x = (cell % arena.cols) + 0.5;
      y = Math.floor(cell / arena.cols) + 0.5;
    }
  }
  if (side < 0 || cell < 0 || battle.field.holders[cell] !== 1 - side) return null;
  takeCapsule(battle.field, side, x, y, x, y, LANDING_CELLS, LANDING_CELLS);
  redistance(battle.field);
  battle.anchors.push({ s: side, x, y });
  if (!opening.name) {
    battle.name = nameFor(run, battle);
    battle.autoNamed = true;
  }
  startBattle(run, battle, day, carried ? { side, x, y, load: carried, owner: Math.max(0, memberIndex(battle, side, sideName)) } : null);
  return battle;
};
const nearestHeldCell = (field, side, x, y, reach) => {
  const { cols, rows, holders } = field;
  let best = -1;
  let least = Infinity;
  for (let dy = -reach; dy <= reach; dy += 1) {
    const row = Math.floor(y) + dy;
    if (row < 0 || row >= rows) continue;
    for (let dx = -reach; dx <= reach; dx += 1) {
      const col = Math.floor(x) + dx;
      if (col < 0 || col >= cols || holders[row * cols + col] !== side) continue;
      const far = dx * dx + dy * dy;
      if (far < least) {
        least = far;
        best = row * cols + col;
      }
    }
  }
  return best;
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

// ---- withdrawing ------------------------------------------------------------------
// Troops told to withdraw go back from the line and leave the battlefield: a
// formation of the world is a unit of the world again, where it left from, and
// a counter the battle raised is stood down. THE GROUND STAYS AS IT IS: what a
// side took it still holds, with nobody standing on it, until the other side
// walks back in. A side whose last troops have gone is AWAY: it has nobody
// there, takes no formation in, and stands under an order to withdraw until it
// is told anything else. Then it comes back onto the ground it holds.

const standsToWithdraw = (battle, side) => battle.orders.some((order) => order.s === side && !order.chosen && order.order === "withdraw");
const withdrawWhoLeft = (run, battle, day) => {
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    const troops = battle.troops[side];
    let left = 0;
    for (let index = 0; index < troops.length; index += 1) {
      const troop = troops[index];
      const order = isLive(troop) && troop.order && troop.order.kind === "withdraw" ? troop.order : null;
      // Clear of the line, or with nowhere further back to go, or long enough on the way.
      if (!order || !(order.home === true || order.gone >= WITHDRAW_KM || day - order.since >= WITHDRAW_DAYS_MOST)) continue;
      const named = battle.named.find((entry) => entry.s === side && entry.i === index);
      if (named && !named.reported) {
        const [lng, lat] = battle.place.toLngLat(troop.x, troop.y);
        run.unitChanges.push({ unitId: named.unitId, committedTo: "", lng, lat, strength: Math.round(troop.strength) });
        named.reported = true;
        battle.sentHome.set(named.unitId, side);
      }
      troop.strength = 0;
      troop.station = null;
      troop.order = null;
      left += 1;
    }
    if (left === 0) continue;
    battle.touched = true;
    battle.planKey = "";
    if (liveCount(troops) > 0) continue;
    // The last of them has gone.
    battle.away[side] = true;
    battle.pool[side] = 0;
    if (!standsToWithdraw(battle, side)) setStandingOrder(battle, side, { sector: "all", order: "withdraw", since: run.dateOf(day), age: 0 });
    battle.log.push({ d: run.dateOf(day), k: "withdrew", s: side, at: "" });
  }
};
// A side that is away and is no longer told to be comes back: it raises its troops on the ground it holds.
const comeBack = (run, battle, day) => {
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    if (!battle.away[side] || standsToWithdraw(battle, side)) continue;
    battle.away[side] = false;
    for (const [unitId, of] of [...battle.sentHome]) if (of === side) battle.sentHome.delete(unitId);
    if (liveCount(battle.troops[side]) > 0) continue;
    raiseTroops(battle, run, side);
    setRadii(battle);
    paintGround(battle, run);
    battle.planKey = "";
    battle.touched = true;
    if (liveCount(battle.troops[side]) > 0) battle.log.push({ d: run.dateOf(day), k: "returned", s: side, at: "" });
  }
};

// An order on a battlefield that is fought over (or frozen): put to its side as it is.
const orderOnFront = (run, battle, moment, day) => {
  // A side that had withdrawn and is told anything else comes back first, and the order is put to those who came.
  const ordered = sideOfName(battle, moment.side);
  if (battle.status === "active" && ordered >= 0 && battle.away[ordered] && FRONT_ORDERS.includes(moment.order) && moment.order !== "withdraw") {
    battle.orders = battle.orders.filter((order) => !(order.s === ordered && !order.chosen && order.order === "withdraw"));
    comeBack(run, battle, day);
  }
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
// to every battlefield the two share, whatever it is. And an order to ATTACK
// across a border in peace, from one of the two, is the war beginning: the
// battlefield along it opens (one fortified in peace becomes the front), and
// the order is carried out there.
const applyBorderMoment = (run, moment, day, first, second) => {
  const note = { kind: "", battlefield: clean(moment.battlefield, BATTLEFIELD_NAME_MAX), side: clean(moment.side), ...(moment.ref !== undefined ? { ref: moment.ref } : {}) };
  const names = [clean(`${first} / ${second} border`, BATTLEFIELD_NAME_MAX), clean(`${second} / ${first} border`, BATTLEFIELD_NAME_MAX)];
  let battle = run.battles.find((entry) => entry.status !== "closed" && names.some((name) => foldBattlefieldName(entry.name) === foldBattlefieldName(name))) ?? null;
  const peace = !warBetween(run, first, second);
  const other = fold(moment.side) === fold(first) ? second : fold(moment.side) === fold(second) ? first : "";
  if (peace && !battle && other && fold(first) !== fold(second) && ATTACK_ORDERS.includes(moment.order) && moment.order !== "land") {
    if (!landsTouch(run, first, second)) {
      run.notes.push({ ...note, kind: "border-not-found" });
      return;
    }
    const war = attackOpensWar(run, clean(moment.side), other, day, seriousAttack(run, moment));
    const fronts = war ? frontsBetween(run, first, second) : [];
    if (fronts.length === 0) {
      run.notes.push({ ...note, kind: !war && !seriousAttack(run, moment) ? "minor-attack" : "not-at-war" });
      return;
    }
    for (const front of fronts) {
      tellAttack(run, front, clean(moment.side), other, day);
      orderOnFront(run, front, { ...moment, battlefield: front.name }, day);
    }
    return;
  }
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
    const regions = landRegionsOf(run);
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
  // An order to attack across a border fortified in peace is the war beginning:
  // the battlefield is that war's from today, with whoever stands on it.
  if (battle.status === "standing" && ATTACK_ORDERS.includes(moment.order) && moment.order !== "land") {
    const attacker = battle.sides[side].find((member) => fold(member) === fold(moment.side)) ?? battle.sides[side][0];
    const defender = battle.sides[1 - side][0];
    if (attackOpensWar(run, attacker, defender, day, seriousAttack(run, moment)) && battle.status === "active") tellAttack(run, battle, attacker, defender, day);
    else if (battle.status === "standing" && !seriousAttack(run, moment)) {
      run.notes.push({ ...note, kind: "minor-attack" });
      return;
    }
  }
  if (battle.status === "standing") {
    if (FRONT_EFFORTS.includes(moment.effort)) battle.effort[side] = moment.effort;
    // Told to leave by every side that has troops there, it is given up.
    // (To fall back from a border fortified in peace, or to withdraw from it, is to go home.)
    const goes = moment.order === "fall back" || moment.order === "withdraw";
    battle.leaving[side] = goes;
    if ([HOLDER_SIDE_A, HOLDER_SIDE_B].every((each) => battle.leaving[each] || liveCount(battle.troops[each]) === 0) && goes) {
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
  // No battlefield of that name: an attack aimed at a place is an attack on whoever holds it.
  if (!battle && wanted && ATTACK_ORDERS.includes(moment.order) && clean(moment.objective) && attackAtObjective(run, moment, day)) return;
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
    // A country that troops are on their way into is brought in by those
    // troops, on the day they come to it (invadeWhereSent), and not on the day
    // the story names: the run that was made before the story was written did
    // it that way, and this one has to be that run again.
    if (moment.sent !== true) {
      // (The same for a country a transporter is bound for: it is in the war on the day the troops are put down there.)
      const shipped = (name) => run.transports.some((transport) => transport.status === "moving" && transport.warId === id && warSide(war, transport.owner) === 1 - side
        && asArrayOf(transport.attacks).some((entry) => fold(entry) === fold(name)));
      const awaited = (name) => shipped(name) || run.battles.some((battle) => battle.warId === id && battle.status === "active" && sideOfName(battle, name) < 0
        && battle.orders.some((order) => order.chosen && battleSide(battle, side) !== order.s && asArrayOf(order.attacks).some((entry) => fold(entry) === fold(name))));
      for (let index = names.length - 1; index >= 0; index -= 1) if (awaited(names[index])) names.splice(index, 1);
      if (names.length === 0) return;
    }
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

// ---- troops sent into a country outside the war ----------------------------------

const asArrayOf = (value) => (Array.isArray(value) ? value : []);

// Reads, for every route a battle's troops were sent along by hand, the
// countries outside the war it goes into (invade.js): what sending troops
// along it attacks. Worked out from the ground whenever the routes are put to
// their troops, and kept on the order for whoever reads the record.
const markAttacks = (run, battle) => {
  if (battle.status !== "active") return;
  for (const order of battle.orders) {
    if (!order.chosen || !Array.isArray(order.way) || order.way.length === 0) continue;
    const troops = battle.troops[order.s];
    let midX = 0;
    let midY = 0;
    let count = 0;
    troops.forEach((troop) => {
      if (!isLive(troop) || !(troop.order && !troop.order.done && (troop.order.standing === order || troop.order.resume?.standing === order))) return;
      midX += troop.x;
      midY += troop.y;
      count += 1;
    });
    const route = order.way.map(([lng, lat]) => battle.place.toCell(lng, lat));
    const names = othersOnWay({
      arena: battle.arena,
      place: battle.place,
      // From where they stand, as they will go: the way to the route's first point is part of it.
      way: count > 0 ? [[midX / count, midY / count], ...route] : route,
      holderOf: (id) => holderOf(battle, run, id),
      inWar: (name) => sideOfName(battle, name) >= 0,
    });
    // A country their own is at war with already, on a battlefield of that
    // war's, is no newcomer to be brought into this one: troops sent into its
    // land go over to the battlefield where it is fought (handOver).
    const sender = senderOf(battle, order);
    const elsewhere = names.filter((name) => otherFrontAgainst(run, battle, sender, name));
    const fresh = names.filter((name) => !elsewhere.includes(name));
    if (fresh.length > 0) order.attacks = fresh;
    else delete order.attacks;
    if (elsewhere.length > 0) order.crosses = elsewhere;
    else delete order.crosses;
  }
};

// Who a hand order's troops belong to: whoever gave it, else its side's first country still there.
const senderOf = (battle, order) => clean(order.by) || battle.sides[order.s].find((member, at) => !battle.gone[order.s].has(at)) || "";

// The battlefield on which a country already fights another, in a war of
// their own: not this one.
const otherFrontAgainst = (run, battle, member, name) => (member ? frontsBetween(run, member, name).find((entry) => entry !== battle && entry.field) ?? null : null);

// The troops marching a hand order's route.
const onRoute = (battle, order, day) => {
  const marching = [];
  battle.troops[order.s].forEach((troop, at) => {
    if (!isLive(troop)) return;
    const mine = troop.order && !troop.order.done ? troop.order : null;
    const way = mine && mine.kind !== "way" ? mine.resume : mine;
    if (way && !way.done && way.standing === order && day >= way.since) marching.push(at);
  });
  return marching;
};

// Every troop a hand order was given to that has not finished with it, whether it has set off yet or not.
const underOrder = (battle, order) => {
  const serving = [];
  battle.troops[order.s].forEach((troop, at) => {
    if (isLive(troop) && troop.order && !troop.order.done && (troop.order.standing === order || troop.order.resume?.standing === order)) serving.push(at);
  });
  return serving;
};

// Whether any of a route's troops has come within reach of a country's land on this battlefield.
const reachedLandOf = (run, battle, order, name, day) => {
  const { arena } = battle;
  const held = new Uint8Array(arena.ids.length);
  let any = false;
  for (let region = 1; region < arena.ids.length; region += 1) {
    if (fold(holderOf(battle, run, arena.ids[region])) !== fold(name)) continue;
    held[region] = 1;
    any = true;
  }
  if (!any) return false;
  return onRoute(battle, order, day).some((at) => {
    const troop = battle.troops[order.s][at];
    return landWithin(arena, held, troop.x, troop.y, INVADE_REACH_KM / battle.place.kmAt(troop.y));
  });
};

// TROOPS OF ONE FRONT SENT AGAINST THE ENEMY OF ANOTHER. A country at war
// with two others fights each on a battlefield of its own, and the ground one
// of them holds is that battlefield's ground: on every other it is a wall. So
// troops sent from the first front into land the second enemy holds (to take
// back their own country's ground, most often) cannot fight for it where they
// are. They used to bring that enemy into their own war as if it were a
// newcomer, and the same ground then lay on two battlefields that each kept
// its own account of who held it: the troops fought, and the map went on
// showing the land as the enemy's.
//
// They GO OVER instead. On the day the first of them comes to that land, the
// troops on the route leave this battlefield and stand, where they are, on the
// one that is fought against that enemy, with the same route to march. A
// formation of the world's own (a named one) goes back to the world there, and
// that battlefield takes it in when it next begins.
const handOver = (run, battle, order, other, day) => {
  const side = order.s;
  const date = run.dateOf(day);
  const moved = [[], []];
  let lngSum = 0;
  let latSum = 0;
  for (const at of underOrder(battle, order)) {
    const troop = battle.troops[side][at];
    const member = battle.sides[side][troop.owner] ?? senderOf(battle, order);
    const theirSide = sideOfName(other, member);
    if (theirSide < 0 || other.troops[theirSide].length >= MAX_TROOPS_PER_SIDE) continue;
    const [lng, lat] = battle.place.toLngLat(troop.x, troop.y);
    const named = battle.named.find((entry) => entry.s === side && entry.i === at);
    if (named) {
      if (!named.reported) {
        run.unitChanges.push({ unitId: named.unitId, committedTo: "", lng, lat, strength: Math.round(troop.strength) });
        named.reported = true;
      }
    } else {
      // Where it stands, on that battlefield's own sheet: on its side's ground there, or the nearest of it.
      const [x, y] = other.place.toCell(lng, lat);
      const inside = x >= 0 && y >= 0 && x < other.field.cols && y < other.field.rows;
      const cell = inside && other.field.holders[Math.floor(y) * other.field.cols + Math.floor(x)] === theirSide
        ? Math.floor(y) * other.field.cols + Math.floor(x)
        : nearestHeldCell(other.field, theirSide, Math.max(0, Math.min(other.field.cols - 1, x)), Math.max(0, Math.min(other.field.rows - 1, y)), HAND_OVER_REACH_CELLS);
      // (Nowhere of its side's to stand there: it stays where it is, at the wall.)
      if (cell < 0) continue;
      const exact = inside && cell === Math.floor(y) * other.field.cols + Math.floor(x);
      moved[theirSide].push(other.troops[theirSide].length);
      other.troops[theirSide].push(createTroop({
        x: exact ? x : (cell % other.field.cols) + 0.5,
        y: exact ? y : Math.floor(cell / other.field.cols) + 0.5,
        strength: troop.strength,
        kind: troop.kind,
        owner: Math.max(0, memberIndex(other, theirSide, member)),
      }));
      lngSum += lng;
      latSum += lat;
    }
    troop.strength = 0;
    troop.station = null;
    troop.order = null;
  }
  const count = moved[0].length + moved[1].length;
  // The route is that battlefield's now: here it has nobody left to march it.
  if (underOrder(battle, order).length === 0) battle.orders = battle.orders.filter((entry) => entry !== order);
  battle.touched = true;
  battle.planKey = "";
  if (count === 0) return 0;
  const today = prepare(other, day);
  for (const theirSide of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    if (moved[theirSide].length === 0) continue;
    const entry = { s: theirSide, sector: "all", order: "advance", since: date, age: 0, chosen: true, way: order.way.map((point) => point.slice()), ...(order.by ? { by: order.by } : {}) };
    other.orders.push(entry);
    assignOrder(other, run, entry, { ...today, date, run }, { picked: moved[theirSide] });
  }
  const at = cityNear(run, lngSum / count, latSum / count, 150) || other.name;
  other.log.push({ d: date, k: "reinforced", s: moved[0].length > 0 ? HOLDER_SIDE_A : HOLDER_SIDE_B, at });
  other.touched = true;
  other.planKey = "";
  assignCommands(other);
  return count;
};

// A day's look at the troops sent into a country outside the war: the first
// of them to come within reach of its land brings it into the war, against
// their side. It is the war ledger's own "joins" (applyWarMoment), so the
// country joins every battlefield of that war, raises its troops, and a new
// battlefield opens wherever else it now touches an enemy. What it holds on
// this one is ground to be fought over from then on.
const invadeWhereSent = (run, battle, day) => {
  if (battle.status !== "active" || !battle.orders.some((order) => order.chosen && (asArrayOf(order.attacks).length > 0 || asArrayOf(order.crosses).length > 0))) return;
  const war = run.wars.get(battle.warId);
  if (!war || war.status !== "active") return;
  // Troops sent against a country their own already fights on another battlefield go over to it.
  for (const order of battle.orders.slice()) {
    if (!order.chosen) continue;
    for (const name of asArrayOf(order.crosses)) {
      const other = otherFrontAgainst(run, battle, senderOf(battle, order), name);
      if (!other || !reachedLandOf(run, battle, order, name, day)) continue;
      handOver(run, battle, order, other, day);
      break;
    }
  }
  // Once a country is in the war a route into it attacks nobody new, and its order no longer says so.
  const settle = (order, name) => {
    const left = asArrayOf(order.attacks).filter((other) => fold(other) !== fold(name));
    if (left.length > 0) order.attacks = left;
    else delete order.attacks;
  };
  for (const order of battle.orders.slice()) {
    if (!order.chosen) continue;
    for (const name of asArrayOf(order.attacks)) {
      if (sideOfName(battle, name) >= 0) {
        settle(order, name);
        continue;
      }
      if (warSide(war, name) >= 0) continue;
      if (!reachedLandOf(run, battle, order, name, day)) continue;
      // The side of the war the country joins: the one its attackers are not on.
      const joins = battleSide(battle, 1 - order.s);
      applyWarMoment(run, { type: "war", op: joins === 0 ? "join-a" : "join-b", warId: war.id, names: [name], sent: true }, day);
      // No room for another member there: it stays a wall, and nobody is at war with it.
      if (sideOfName(battle, name) < 0) continue;
      const date = run.dateOf(day);
      battle.log.push({ d: date, k: "invaded", s: order.s, at: `${run.isGroup(name) ? "group" : "country"}: ${name}` });
      run.joins.push({ day, date, battlefield: battle, warId: war.id, name, side: joins, by: clean(order.by) || battle.sides[order.s][0] });
      settle(order, name);
      battle.touched = true;
      battle.planKey = "";
    }
  }
};

// ---- transporters ----------------------------------------------------------------

// The sheet of the whole map (worldGrid.js), drawn once and kept with the arenas.
const worldGridOf = (run) => {
  const map = run.input.map ?? {};
  // (Regions of a type that is water are sea on it: ships sail them.)
  const water = waterTypeIds(run.input.regionTypes);
  const key = worldSheetKey(clean(map.key), water);
  const kept = clean(map.key) && run.cache ? run.cache.get(key) : null;
  if (kept) return kept;
  if (run.worldGrid) return run.worldGrid;
  const regions = regionsOf(run);
  if (!regions) throw REGIONS_NEEDED;
  const grid = buildWorldGrid(regions, { flat: map.flat === true, scale: map.scale, water });
  if (grid && clean(map.key) && run.cache) run.cache.set(key, grid);
  run.worldGrid = grid;
  return grid;
};

// The war a transporter serves: the one it was sent for while that is being
// fought with its owner in it, else the first such war of its owner's.
const transportWar = (run, transport) => {
  const fought = (war) => Boolean(war) && war.status === "active" && warSide(war, transport.owner) >= 0;
  const named = run.wars.get(transport.warId);
  return fought(named) ? named : [...run.wars.values()].find(fought) ?? null;
};
// Who holds a region in name, to a war: the group whose area it is if that group is in it.
const holderIn = (run, war, id) => {
  const group = run.groupOf(id);
  return group && warSide(war, group) >= 0 ? group : run.controllerOf(id);
};
const holderAtPoint = (run, grid, war, lng, lat) => {
  const cell = grid.cellOf(lng, lat);
  const mark = cell >= 0 ? grid.region[cell] : 0;
  return mark ? clean(holderIn(run, war, grid.ids[mark])) : "";
};
const cityNear = (run, lng, lat, withinKm) => {
  const flat = run.input.map?.flat === true;
  let best = null;
  for (const city of Array.isArray(run.input.map?.cities) ? run.input.map.cities : []) {
    const far = kmBetween(lng, lat, Number(city.lng), Number(city.lat), { flat, scale: run.input.map?.scale });
    if (far <= withinKm && (!best || far < best.far)) best = { far, name: clean(city.name) };
  }
  return best ? `city: ${best.name}` : "";
};
const tellVoyage = (run, day, k, transport, extra = {}) => {
  run.voyages.push({ d: run.dateOf(day), day, k, id: transport.id, owner: transport.owner, kind: transport.kind, medium: transport.medium, to: boundFor(transport), n: loadOf(transport), ...extra });
};

// Where a place named by the story is: a city of the map, a region, or a
// country (its capital, or its largest city). null when nothing is called that.
const placeNamed = (run, grid, war, text) => {
  const named = /^\s*(city|region|country|group)\s*:\s*(.*)$/i.exec(String(text ?? ""));
  const wanted = fold(named ? named[2] : text);
  const kind = named ? named[1].toLowerCase() : "";
  if (!wanted) return null;
  const cities = Array.isArray(run.input.map?.cities) ? run.input.map.cities : [];
  if (kind !== "region" && kind !== "country" && kind !== "group") {
    const city = cities.find((entry) => fold(entry?.name) === wanted);
    if (city) return { lng: Number(city.lng), lat: Number(city.lat), name: `city: ${clean(city.name)}` };
    if (kind === "city") return null;
  }
  if (kind !== "region") {
    const seat = seatOf(run, grid, war, wanted);
    if (seat) return { lng: seat.lng, lat: seat.lat, name: seat.name };
    if (kind === "country" || kind === "group") return null;
  }
  const regions = regionsOf(run);
  if (!regions) throw REGIONS_NEEDED;
  const region = regions.find((entry) => fold(entry?.name) === wanted);
  if (!region) return null;
  const [lng, lat] = middleOf(region);
  return { lng, lat, name: `region: ${clean(region.name)}` };
};
// A country's seat: its capital among the map's cities, else the largest city on its land.
const seatOf = (run, grid, war, wanted) => {
  let best = null;
  for (const city of Array.isArray(run.input.map?.cities) ? run.input.map.cities : []) {
    const lng = Number(city.lng);
    const lat = Number(city.lat);
    if (fold(holderAtPoint(run, grid, war, lng, lat)) !== wanted) continue;
    const weight = (city.capital ? 1e12 : 0) + Math.max(0, Number(city.population) || 0);
    if (!best || weight > best.weight) best = { weight, lng, lat, name: `city: ${clean(city.name)}` };
  }
  return best;
};
// Where a dispatch nobody gave a starting place sets out from: its owner's
// cities, the nearest to where it is sent first (a ship from a country whose
// capital is far inland sails from its nearest port).
const originsOf = (run, grid, war, transport) => {
  const flat = run.input.map?.flat === true;
  const mine = [];
  for (const city of Array.isArray(run.input.map?.cities) ? run.input.map.cities : []) {
    const lng = Number(city.lng);
    const lat = Number(city.lat);
    if (!Number.isFinite(lng + lat) || fold(holderAtPoint(run, grid, war, lng, lat)) !== fold(transport.owner)) continue;
    mine.push({ lng, lat, name: `city: ${clean(city.name)}`, far: kmBetween(lng, lat, transport.to.lng, transport.to.lat, { flat, scale: run.input.map?.scale }) });
  }
  mine.sort((a, b) => a.far - b.far || a.name.localeCompare(b.name));
  return mine.slice(0, 8);
};

// Whether a transporter set out with its owner fighting no war, to attack a
// country it was at peace with (departTransport): it serves no war yet.
const sailsInPeace = (transport) => !clean(transport.warId) && asArrayOf(transport.attacks).length > 0;

// A transporter that was ordered sets out: its war is found, its troops go
// aboard, and its way is found. One that cannot is refused, and says why.
const departTransport = (run, index, day) => {
  let transport = run.transports[index];
  const date = run.dateOf(day);
  const refuse = (note) => {
    run.transports[index] = { ...transport, status: "refused", note, ended: date };
    tellVoyage(run, day, "refused", transport, { why: note });
  };
  let war = transportWar(run, transport);
  const grid = worldGridOf(run);
  // Its owner is fighting no war: bound for land of a country it is at peace
  // with, it is an attack on that country, and the war begins where it lands.
  let surprise = "";
  if (!war) {
    if (!grid) return refuse("off-map");
    const alone = peaceOf(transport.owner);
    const place = Number.isFinite(transport.to.lng) && Number.isFinite(transport.to.lat) ? transport.to : placeNamed(run, grid, alone, transport.to.name);
    const holder = place ? holderAtPoint(run, grid, alone, place.lng, place.lat) : "";
    // (Its own land, nobody's, or a country a ceasefire stands with: nothing sails.)
    if (!holder || fold(holder) === fold(transport.owner) || warBetween(run, transport.owner, holder)) return refuse("no-war");
    surprise = holder;
    war = peaceOf(transport.owner, [holder]);
  }
  if (!grid) return refuse("off-map");
  const mine = warSide(war, transport.owner);
  const friendly = (name) => warSide(war, name) === mine;
  const hostile = (name) => warSide(war, name) === 1 - mine;
  if (!Number.isFinite(transport.to.lng) || !Number.isFinite(transport.to.lat)) {
    const place = placeNamed(run, grid, war, transport.to.name);
    if (!place) return refuse("no-place");
    transport = { ...transport, to: place };
  }
  // What goes aboard, and from where.
  let load = transport.load;
  let origins = transport.from ? [transport.from] : [];
  let boarding = null;
  if (transport.embark) {
    const battle = run.battles.find((entry) => entry.status !== "closed" && foldBattlefieldName(entry.name) === foldBattlefieldName(transport.embark.battlefield));
    const side = transport.embark.side;
    const picked = battle ? transport.embark.troops.filter((at) => battle.troops[side][at] && isLive(battle.troops[side][at]) && !battle.named.some((entry) => entry.s === side && entry.i === at)) : [];
    if (picked.length === 0) return refuse("no-troops");
    let x = 0;
    let y = 0;
    for (const at of picked) {
      x += battle.troops[side][at].x;
      y += battle.troops[side][at].y;
    }
    const [lng, lat] = battle.place.toLngLat(x / picked.length, y / picked.length);
    origins = [{ lng, lat, name: cityNear(run, lng, lat, 150) }];
    load = picked.map((at) => [Math.round(battle.troops[side][at].strength), battle.troops[side][at].kind]);
    boarding = { battle, side, picked };
  } else if (load.length === 0) {
    load = kindsFor(Math.max(1, transport.raise || 1), run.era).map((kind) => [100, kind]);
    if (origins.length === 0) origins = originsOf(run, grid, war, transport);
  }
  if (origins.length === 0) return refuse("no-origin");
  const { embark: _embark, raise: _raise, ...bare } = transport;
  const loaded = { ...bare, load, warId: war.id };
  let out = null;
  for (const origin of origins) {
    out = setOut({ ...loaded, from: { lng: origin.lng, lat: origin.lat, name: clean(origin.name) } }, {
      grid,
      from: [origin.lng, origin.lat],
      holderOf: (id) => holderIn(run, war, id),
      friendly,
      hostile,
      year: gameDateYear(run.dateOf(0)),
      date,
      dateOf: (days) => run.dateOf(day + days),
    });
    if (out.status === "moving") break;
  }
  if (out.status !== "moving") return refuse(out.note || "no-way");
  // Where it is to put them down is somebody's land: a country outside the war is attacked by it.
  const holder = holderAtPoint(run, grid, war, out.landing[0], out.landing[1]);
  if (surprise) out = { ...out, attacks: [holder && fold(holder) !== fold(transport.owner) ? holder : surprise] };
  else if (holder && warSide(war, holder) < 0) out = { ...out, attacks: [holder] };
  if (boarding) {
    for (const at of boarding.picked) {
      boarding.battle.troops[boarding.side][at].strength = 0;
      boarding.battle.troops[boarding.side][at].station = null;
    }
    boarding.battle.touched = true;
    boarding.battle.planKey = "";
  }
  run.transports[index] = out;
  tellVoyage(run, day, "sailed", out, { from: out.from.name, due: out.due, km: out.km });
};

// A transporter that has come to the end of its way puts its troops down.
const landTransport = (run, index, day) => {
  const transport = run.transports[index];
  const date = run.dateOf(day);
  const end = (status, k, extra = {}) => {
    run.transports[index] = { ...transport, status, ended: date, at: transport.landing ?? transport.at };
    tellVoyage(run, day, k, transport, extra);
  };
  let war = transportWar(run, transport);
  const grid = worldGridOf(run);
  const [lng, lat] = transport.landing ?? [transport.to.lng, transport.to.lat];
  // It set out in peace, to attack: the war begins here, today, with whoever holds this land.
  let opened = "";
  if (!war && sailsInPeace(transport)) {
    const target = grid ? holderAtPoint(run, grid, peaceOf(transport.owner), lng, lat) : "";
    const before = run.starts.length;
    war = target && fold(target) !== fold(transport.owner) ? attackOpensWar(run, transport.owner, target, day) : null;
    if (war && run.starts.length > before) opened = target;
  }
  // The war it was sent for is over, or frozen: it turns back with its troops.
  if (!war) return end("returned", "returned");
  const mine = warSide(war, transport.owner);
  const holder = grid ? holderAtPoint(run, grid, war, lng, lat) : "";
  let joined = null;
  // Troops put down in a country that was in no war with their sender: it is
  // at war with them from today, on the other side of theirs.
  if (holder && warSide(war, holder) < 0) {
    applyWarMoment(run, { type: "war", op: mine === 0 ? "join-b" : "join-a", warId: war.id, names: [holder], sent: true }, day);
    if (warSide(war, holder) < 0) return end("returned", "returned", { why: "no-room" });
    joined = holder;
  }
  let battle = run.battles.find((entry) => entry.warId === war.id && entry.status === "active" && sideOfName(entry, transport.owner) >= 0 && pointInFrame(entry.frame, lng, lat)) ?? null;
  let hostile = true;
  let landed = 0;
  if (battle) {
    const side = sideOfName(battle, transport.owner);
    const [x, y] = battle.place.toCell(lng, lat);
    const put = landCarried(battle, side, x, y, transport.load, Math.max(0, memberIndex(battle, side, transport.owner)), date);
    landed = put.landed;
    hostile = put.hostile;
    if (landed === 0) battle = null;
    else {
      battle.touched = true;
      if (hostile && battle.cityHolder) settleRegions(battle, run, day);
    }
  } else {
    const before = run.battles.length;
    // (The name it was given for the front it opens, unless a battlefield is called that already.)
    const named = run.battles.some((entry) => entry.status !== "closed" && foldBattlefieldName(entry.name) === foldBattlefieldName(transport.battlefield)) ? "" : transport.battlefield;
    battle = openLandingAt(run, { war, sideName: transport.owner, lng, lat, name: named, day, carried: transport.load });
    if (battle) {
      landed = Math.min(transport.load.length, battle.troops[sideOfName(battle, transport.owner)].length);
      // Troops put ashore to open a front go inland unless they are told otherwise: nobody has ordered anything there yet.
      orderOnFront(run, battle, { type: "order", battlefield: battle.name, side: transport.owner, order: "advance", sector: "all" }, day);
    } else if (run.battles.length > before) run.battles.length = before;
  }
  if (joined) {
    run.joins.push({ day, date, battlefield: battle ?? { name: "" }, warId: war.id, name: joined, side: 1 - mine, by: transport.owner });
    tellVoyage(run, day, "invaded", transport, { at: `${run.isGroup(joined) ? "group" : "country"}: ${joined}` });
  }
  if (opened) {
    tellVoyage(run, day, "invaded", transport, { at: `${run.isGroup(opened) ? "group" : "country"}: ${opened}`, opened: true });
    if (battle) tellAttack(run, battle, transport.owner, opened, day);
  }
  // Nowhere to fight there (its own side's ground with no battle on it, or no room for another battlefield): they go home.
  if (!battle || landed === 0) return end("returned", "returned", { why: "no-landing" });
  const at = cityNear(run, lng, lat, 120) || transport.to.name || `region: ${battle.arena.names[battle.arena.region[Math.max(0, Math.floor(battle.place.toCell(lng, lat)[1]) * battle.arena.cols + Math.floor(battle.place.toCell(lng, lat)[0]))]] ?? ""}`;
  const side = sideOfName(battle, transport.owner);
  battle.log.push({ d: date, k: hostile ? "landed" : "reinforced", s: side, at });
  battle.planKey = "";
  run.transports[index] = { ...transport, status: "landed", ended: date, at: [lng, lat], battlefield: battle.name, warId: war.id };
  tellVoyage(run, day, hostile ? "landed" : "reinforced", transport, { at, battlefield: battle, landed });
};

// The transporters at the run's beginning: one that ended before it has been
// told and shown, and is let go; one that was ordered sets out today.
const beginTransports = (run) => {
  const first = run.dateOf(0);
  run.transports = normalizeTransports(run.input.transports).filter((transport) => !TRANSPORT_ENDED.includes(transport.status) || (transport.ended && compareGameDates(transport.ended, first) > 0));
  // (Nothing sets out in a run no day passes in: such a run only reads the world.)
  if (run.days <= 0) return;
  for (let index = 0; index < run.transports.length; index += 1) if (run.transports[index].status === "ordered") departTransport(run, index, 0);
};

// A day of every transporter under way: it goes on along its way, whoever can
// reach it may catch it, and at the end of its way it puts its troops down.
const moveTransports = (run, day) => {
  const map = run.input.map ?? {};
  const options = { flat: map.flat === true, scale: map.scale };
  const date = run.dateOf(day);
  for (let index = 0; index < run.transports.length; index += 1) {
    const before = run.transports[index];
    if (before.status !== "moving") continue;
    // (One that set out today has its first day's sailing tomorrow.)
    if (before.departed === date) continue;
    // (One that set out in peace to attack sails on in peace: nobody is at war with it yet.)
    const war = transportWar(run, before) ?? (sailsInPeace(before) ? peaceOf(before.owner, asArrayOf(before.attacks)) : null);
    if (!war) {
      run.transports[index] = { ...before, status: "returned", ended: date };
      tellVoyage(run, day, "returned", before);
      continue;
    }
    const { transport: moved, arrived } = moveOn(before, options);
    run.transports[index] = moved;
    // Caught on the day's stretch, at the middle of it.
    const mine = warSide(war, moved.owner);
    const middle = placeAlong(moved.way, (before.gone + moved.gone) / 2, options);
    const grid = worldGridOf(run);
    const risk = interceptionOf(moved, middle ? [middle.lng, middle.lat] : moved.at, {
      units: run.input.units,
      // (Nobody hunts what nobody is at war with.)
      enemy: (name) => war.peace !== true && warSide(war, name) === 1 - mine,
      ally: (name) => warSide(war, name) === mine,
      grid,
      holderOf: (id) => holderIn(run, war, id),
      ...options,
    });
    if (risk.chance > 0 && transportChance(run.seed, moved.id, day, "caught") < risk.chance) {
      const hit = struck(moved, transportChance(run.seed, moved.id, day, "hurt"), date);
      run.transports[index] = hit.transport;
      const near = middle ? cityNear(run, middle.lng, middle.lat, 250) : "";
      tellVoyage(run, day, hit.transport.status === "lost" ? "lost" : "intercepted", moved, { by: risk.by, with: risk.with, lost: hit.lost, at: near, where: middle ? [Math.round(middle.lng * 1000) / 1000, Math.round(middle.lat * 1000) / 1000] : null });
      if (hit.transport.status === "lost") continue;
    }
    if (arrived) landTransport(run, index, day);
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
    markAttacks(run, battle);
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
  // Transporters that were ordered set out: their troops leave the battlefields
  // they stood on. (Before the first day's moments: whoever a transporter is
  // bound for is known before the story names the day it is brought in.)
  beginTransports(run);

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

// The staff of each side nobody plays looks at how it stands and decides what
// it does (staff.js): on a battle's first day of a run and every
// STAFF_REVIEW_DAYS after. Before the day is fought, and after whatever the
// story ordered for that day or before it: an order of the story's is left
// alone, and the staff's own is replaced only when it would decide otherwise.
const reviewStaff = (run, battle, day) => {
  // (A run may be told to leave every side to its orders: the engine's own tests of other things are.)
  if (run.input?.staff === false) return;
  const war = run.wars.get(battle.warId);
  if (!war || war.status !== "active") return;
  let today = null;
  // A war begun on a border that was fortified in peace: both sides stand
  // dug in or holding, as the peace left them, and a war in which nobody moves
  // is not one. The side that began it attacks along the whole line from its
  // first day, unless a person plays it or the story has ordered it already.
  const begun = battle.begun === true;
  battle.begun = false;
  if (begun) {
    const side = battle.swap ? HOLDER_SIDE_B : HOLDER_SIDE_A;
    const peaceful = battle.orders.filter((order) => order.s === side && !order.chosen).every((order) => !isAttackWord(order.order) && order.since !== run.dateOf(day));
    if (!battle.away[side] && !sideIsPlayed(battle, side, run.input?.players) && peaceful && liveCount(battle.troops[side]) > 0) {
      today = prepare(battle, day);
      const lead = battle.sides[side].find((member, at) => !battle.gone[side].has(at)) ?? "";
      battle.orders = battle.orders.filter((order) => order.s !== side || order.chosen);
      const order = setStandingOrder(battle, side, { sector: "all", order: "advance", since: run.dateOf(day), age: 0, by: lead, mark: STAFF_MARK });
      assignOrder(battle, run, order, { ...today, date: run.dateOf(day), run });
      battle.touched = true;
      battle.planKey = "";
      battle.log.push({ d: run.dateOf(day), k: "offensive", s: side, at: "the whole line" });
      battle.begunBy = side;
    }
  }
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) {
    // (The side that has just gone over to the attack is left to it until the staff next looks.)
    if (begun && battle.begunBy === side) continue;
    if (battle.away[side] || sideIsPlayed(battle, side, run.input?.players) || !staffMayOrder(battle, side)) continue;
    if (liveCount(battle.troops[side]) === 0) continue;
    today = today ?? prepare(battle, day);
    const decided = staffDecision(battle, side, {
      // (The first side of a war is the one that began it.)
      began: battleSide(battle, side) === 0,
      today,
      key: `${run.seed}|${battle.name}|${side}|${run.dateOf(day)}`,
    });
    if (!decided) continue;
    const wanted = `${decided.order}|${fold(decided.sector)}`;
    const stands = staffStanding(battle, side);
    // To hold is what a side with no order does: nothing is written for it, unless the staff had it attacking.
    if (stands === wanted || (decided.order === "hold" && stands === "" && !battle.orders.some((order) => order.s === side && !order.chosen))) continue;
    const lead = battle.sides[side].find((member, at) => !battle.gone[side].has(at)) ?? "";
    // What the staff had the side doing before is over, and so is an order of the story's that has
    // stood too long to be left alone (staffMayOrder): the line is the staff's to order afresh.
    battle.orders = battle.orders.filter((order) => order.s !== side || order.chosen);
    const order = setStandingOrder(battle, side, { sector: decided.sector, order: decided.order, since: run.dateOf(day), age: 0, by: lead, mark: STAFF_MARK });
    assignOrder(battle, run, order, { ...today, date: run.dateOf(day), run });
    battle.touched = true;
    battle.planKey = "";
    // Going over to the attack is something to tell.
    if (decided.order === "advance" && !stands.startsWith("advance")) battle.log.push({ d: run.dateOf(day), k: "offensive", s: side, at: decided.sector === "all" ? "the whole line" : decided.sector });
  }
};

const stepDay = (run) => {
  const day = run.day + 1;
  for (let index = 0; index < run.battles.length; index += 1) {
    const battle = run.battles[index];
    if (battle.status === "active") {
      // Whoever was sent into a country outside the war and has come to it
      // brings it in before the day is fought: its land is ground from today.
      invadeWhereSent(run, battle, day);
      // A side that withdrew and whose orders no longer say so (the war room sent it back) is back.
      if (battle.away[0] || battle.away[1]) comeBack(run, battle, day);
      if (battle.begun || battle.daysRun === 0 || battle.daysRun % STAFF_REVIEW_DAYS === 0) reviewStaff(run, battle, day);
      run.steps += simulateDay(battle, run, day);
      // Whoever was told to withdraw and has got clear is gone from the battlefield.
      withdrawWhoLeft(run, battle, day);
      battle.daysRun += 1;
    } else if (battle.status === "standing") standDay(battle);
    if (battle.closing && battle.status !== "closed") closeBattle(run, battle, day);
  }
  // The day's sailing: whoever arrives is on the ground from this evening.
  moveTransports(run, day);
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
    // The countries troops were sent into, each with the war it is in from
    // that day and the side of it (0 for its first, 1 for its second).
    joins: run.joins.map(({ day: on, date, battlefield, warId, name, side, by }) => ({ day: on, date, battlefield: battlefield.name, warId, name, side, by })),
    // The wars that began with an attack during the run: who attacked whom, and from what day.
    starts: run.starts.map((start) => ({ ...start })),
    unitChanges: changes,
    // The transporters as the days leave them, and what became of each on the way.
    transports: run.transports.map((transport) => ({ ...transport })),
    voyages: run.voyages.map(({ battlefield, ...voyage }) => (battlefield ? { ...voyage, battlefield: battlefield.name } : voyage)),
    notes: run.notes.map((note) => (note.battlefield && typeof note.battlefield === "object" ? { ...note, battlefield: note.battlefield.name } : { ...note })),
    // What the days of this run added to each battlefield's log, all of it and
    // in the order it happened: a record keeps only the last few entries.
    // A town that changed hands says how large it is, for whoever has to
    // choose which of many to tell.
    news: run.battles.flatMap((battle) => battle.log.slice(battle.logFrom).map((entry) => {
      const told = { ...entry, battlefield: battle.name };
      if (entry.k !== "city") return told;
      const city = battle.arena.cities.find((candidate) => `city: ${candidate.name}` === entry.at);
      return city ? { ...told, size: Math.max(0, Number(city.population) || 0), ...(city.capital ? { capital: true } : {}) } : told;
    })),
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
