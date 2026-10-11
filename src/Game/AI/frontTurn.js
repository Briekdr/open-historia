/*! Open Historia — a turn's land war, handed to the front engine and brought back © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The front engine (runtime/fronts/engine.js) knows nothing of a turn: it is
// given battlefields, a span of days and what happens on which day, and it
// answers with the battlefields afterwards and the regions that changed hands.
// This is the turn's side of that conversation:
//
//   before   the engine's own changes of an earlier apply are taken out of the
//            events (stripFrontOps), the turn's orders, its wars and the map
//            changes the model wrote itself are laid out day by day
//            (planFrontMoments), and each country is given a weight
//            (countryWeight);
//   the run  with the arenas it has cached, and again with the map's regions
//            when it says it needs them (runFrontTurn);
//   after    each change of hands is put on the event of its day as an ordinary
//            control operation marked by: "front" (attachFrontFlips), so the
//            reveal, a view of the world as seen, the region's history and
//            every reader of who holds what need nothing new; and the
//            formations that fought come back with where they stand
//            (applyFrontUnitChanges).
//
// runTurnFronts, at the end, is all of it in the order a turn needs it.
//
// Nothing here needs the map or the model, and it loads in plain Node: the
// engine and the map's regions are handed in (frontApply.js, for gameplay.js
// applySimulationResult).

import { diffGameDays, gameDateYear } from "../../runtime/gameDates.js";
import { arenaFor } from "../../runtime/fronts/arena.js";
import { pointInFrame } from "../../runtime/fronts/frame.js";
import { foldBattlefieldName, normalizeBattlefields } from "../../runtime/fronts/record.js";
import { TRANSPORT_LOAD_USUAL, TRANSPORT_ORDERS, isUnderWay, normalizeTransports, orderTransport } from "../../runtime/fronts/transports.js";

export const FRONT_MARK = "front";
// The mark on an order the turn itself drew from an event's own operations
// (statedCaptures): what the engine says of it is not the model's to be told.
export const STATED_REF = "stated:";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// ---- before ----------------------------------------------------------------------

// The events without what the engine added to them. A turn applied a second
// time (a turn cut short and continued, a held turn retried) works the land war
// out afresh from the same orders; left in, the first run's changes would be
// applied beside the second's.
export const stripFrontOps = (events) => asArray(events).map((event) => {
  const impacts = event?.impacts;
  if (!isRecord(impacts)) return event;
  const control = asArray(impacts.regionControlOps);
  const groups = asArray(impacts.groupOps);
  const own = (op) => op?.by !== FRONT_MARK;
  if (control.every(own) && groups.every(own)) return event;
  return { ...event, impacts: { ...impacts, regionControlOps: control.filter(own), groupOps: groups.filter(own) } };
});

// How many days the run covers, and the day an event falls on, counted from
// the day the turn began. A calendar the game cannot read (a fantasy
// scenario's own) gives no dates to count between: the run is then as long as
// the skip that was asked for, and the events are spread evenly through it in
// the order they were told.
export const frontRunSpan = ({ fromDate, toDate, requestedDays = 0, events = [] } = {}) => {
  const counted = diffGameDays(fromDate, toDate);
  const days = counted !== null && counted >= 0 ? counted : Math.max(0, Math.round(Number(requestedDays) || 0));
  const list = asArray(events);
  const dayOf = (event) => {
    const day = diffGameDays(fromDate, event?.date);
    if (day !== null) return Math.max(0, Math.min(days, day));
    const index = list.indexOf(event);
    return index < 0 ? days : Math.round(((index + 1) * days) / (list.length + 1));
  };
  return { days, dayOf };
};

const warSides = (war) => [asArray(war?.sideA).map(clean).filter(Boolean), asArray(war?.sideB).map(clean).filter(Boolean)];
const missingFrom = (list, others) => list.filter((name) => !others.some((other) => fold(other) === fold(name)));

// What the war ledger did this turn, as the engine is told it: read off the
// wars before and after the ledger's own merge, never off the model's records,
// because the ledger refuses and repairs records and the battlefields must
// follow the wars that actually stand.
const warMoments = (warsBefore, warsAfter, { fromDate, days }) => {
  const dayOn = (date) => {
    const day = diffGameDays(fromDate, date);
    return day === null ? days : Math.max(0, Math.min(days, day));
  };
  const before = new Map(asArray(warsBefore).map((war) => [clean(war?.id), war]));
  const moments = [];
  for (const war of asArray(warsAfter)) {
    const warId = clean(war?.id);
    if (!warId) continue;
    const was = before.get(warId);
    const [sideA, sideB] = warSides(war);
    const status = clean(war?.status) || "active";
    const changed = dayOn(war?.lastUpdatedDate || war?.startedDate);
    if (!was || clean(was.status) === "ended") {
      if (status !== "ended") {
        moments.push({ day: dayOn(war?.startedDate || war?.lastUpdatedDate), type: "war", warId, op: "start", names: sideA, opponents: sideB, title: clean(war?.title) });
        if (status === "ceasefire") moments.push({ day: changed, type: "war", warId, op: "ceasefire", names: [] });
      }
      continue;
    }
    const [wasA, wasB] = warSides(was);
    const joinedA = missingFrom(sideA, wasA);
    const joinedB = missingFrom(sideB, wasB);
    const left = [...missingFrom(wasA, sideA), ...missingFrom(wasB, sideB)];
    if (joinedA.length) moments.push({ day: changed, type: "war", warId, op: "join-a", names: joinedA });
    if (joinedB.length) moments.push({ day: changed, type: "war", warId, op: "join-b", names: joinedB });
    if (left.length) moments.push({ day: changed, type: "war", warId, op: "leave", names: left });
    const wasStatus = clean(was.status) || "active";
    if (status !== wasStatus) {
      const op = status === "ended" ? "end" : status === "ceasefire" ? "ceasefire" : "resume";
      moments.push({ day: status === "ended" ? dayOn(war?.endedDate || war?.lastUpdatedDate) : changed, type: "war", warId, op, names: [] });
    }
  }
  return moments;
};

// Everything the engine is told happens during the run, each with its day.
//   events        the turn's events in the order they are kept (stripFrontOps first)
//   frontOrders   the orders, bound to those events' ids (nativeFrontLedger.js)
//   warsBefore    world.wars as the turn began
//   warsAfter     world.wars as the ledger's merge of this turn leaves them
//   warStages     the same a record at a time, when the caller has it so: the
//                 wars as the turn began, then as each record the ledger
//                 merged left them. Two changes to one war in one turn (an
//                 ally joins on the fifth, a ceasefire on the twentieth) then
//                 fall each on its own day; read off the first and the last
//                 alone, both would fall on the day of the later.
// An order takes effect on the day of the earliest event it rests on, and one
// that rests on none on the first day. Except on a battlefield in `settled`
// (their names, folded): there the period was fought before the story was
// written and the story was told how it went, so an order is for what comes
// next: it is put to the troops as the run ends, and what the answer was told
// happened stays what happened. A change of control the model wrote
// itself (a control operation, a single region handed over) is told to the
// engine on its event's day: the world as written wins over the line, which is
// what makes the engine bend the line round it rather than fight it.
export const planFrontMoments = ({ events = [], frontOrders = [], warsBefore = [], warsAfter = [], warStages = null, fromDate = "", days = 0, dayOf = () => 0, settled = null } = {}) => {
  const list = asArray(events);
  const dayById = new Map(list.map((event) => [clean(event?.id), dayOf(event)]));
  const stages = asArray(warStages).length >= 2 ? asArray(warStages) : [warsBefore, warsAfter];
  const moments = [];
  for (let stage = 1; stage < stages.length; stage += 1) moments.push(...warMoments(stages[stage - 1], stages[stage], { fromDate, days }));

  for (const event of list) {
    const day = dayOf(event);
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    for (const op of asArray(impacts.regionControlOps)) {
      if (op?.by === FRONT_MARK || fold(op?.op) !== "control" || op?.wholeCountry === true) continue;
      const regionId = clean(op?.regionId);
      const to = clean(op?.toCode);
      if (regionId && to) moments.push({ day, type: "control", regionId, to, ref: clean(event?.id) });
    }
    for (const transfer of asArray(impacts.regionTransfers)) {
      if (transfer?.wholeCountry === true) continue;
      const regionId = clean(transfer?.regionId);
      const to = clean(transfer?.toCode);
      if (regionId && to) moments.push({ day, type: "control", regionId, to, ref: clean(event?.id) });
    }
  }

  for (const order of asArray(frontOrders)) {
    if (!isRecord(order) || order.problem) continue;
    const bound = asArray(order.eventIds).map((id) => dayById.get(clean(id))).filter((day) => day !== undefined);
    const held = settled instanceof Set && settled.has(foldBattlefieldName(order.battlefield));
    const moment = {
      day: held ? days : bound.length ? Math.min(...bound) : 0,
      type: "order",
      battlefield: clean(order.battlefield),
      side: clean(order.side),
      order: clean(order.order),
      sector: clean(order.sector) || "all",
      ref: clean(order.id),
    };
    if (clean(order.objective)) moment.objective = clean(order.objective);
    if (clean(order.result)) moment.result = clean(order.result);
    if (clean(order.effort)) moment.effort = clean(order.effort);
    if (moment.battlefield && moment.side && (moment.order || moment.result)) moments.push(moment);
  }

  // By day, and within a day in the order above (wars, then the map as
  // written, then orders): a stable order, so the same turn plans the same run.
  return moments
    .map((moment, index) => ({ moment, index }))
    .sort((a, b) => a.moment.day - b.moment.day || a.index - b.index)
    .map(({ moment }) => moment);
};

// A country's weight in a land war: the points of strength the engine sizes
// its troops by (runtime/fronts/constants.js TROOPS_PER_STRENGTH: a dozen
// counters a point, a great power bringing about 24 points and a small state
// one or two). Its people where its sheet counts them, by the square root, so
// that a country of a billion is not a hundred times one of ten million on the
// same front: 144 million is 24. Otherwise the land it holds, on the same
// scale: the few hundred regions the largest countries of the built-in map
// hold come to about 24, a country of three or four regions to two or three.
// (Most countries of most games have no sheet, so this is the common case. It
// used to start every country at four points and add two for the root of its
// regions, from when only the ratio of two sides counted: by the engine's
// count that stood a state of one region seventy counters.)
export const countryWeight = ({ population = 0, regions = 0 } = {}) => {
  const people = Number(population);
  if (Number.isFinite(people) && people > 0) return Math.max(1, 2 * Math.sqrt(people / 1e6));
  return Math.max(1, 1.3 * Math.sqrt(Math.max(0, Number(regions) || 0)));
};

// How many regions the engine may move this run under a scenario's ceiling on
// the map's tempo, after what the model's own changes already used. null where
// the scenario sets no ceiling.
export const frontFlipAllowance = ({ allowance, events = [] } = {}) => {
  if (!Number.isFinite(allowance)) return null;
  let used = 0;
  for (const event of asArray(events)) {
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    used += asArray(impacts.regionTransfers).length;
    used += asArray(impacts.regionControlOps).filter((op) => fold(op?.op) === "control" && op?.by !== FRONT_MARK).length;
  }
  return Math.max(0, Math.floor(allowance - used));
};

// ---- the map and the world, as the engine takes them ---------------------------------

// The box round a shape, [west, south, east, north], by its outer rings. null
// for one that runs across the date line: the engine works that box out itself.
const boxOf = (geometry) => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of geometry.type === "Polygon" ? [geometry.coordinates] : asArray(geometry.coordinates)) {
    for (const point of asArray(polygon?.[0])) {
      const lng = Number(point?.[0]);
      const lat = Number(point?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return west <= east && south <= north && east - west <= 180 ? [west, south, east, north] : null;
};

// The map's regions as the engine takes them, from the regions file the game
// draws: an id (read the way every other reader of that file reads it), a
// name, the shape, the box round it and its Workshop type. `nameOf(id)` is the
// name the rest of the game calls the region by; one with no name of its own is
// known by its id, which no reader is ever shown.
export const engineRegionsOf = (geojson, { nameOf = null } = {}) => {
  const regions = [];
  for (const feature of asArray(geojson?.features)) {
    const props = isRecord(feature?.properties) ? feature.properties : {};
    const id = String(props.id ?? props.GID_1 ?? props.gid_1 ?? props.HASC_1 ?? feature?.id ?? "").trim();
    const geometry = feature?.geometry;
    if (!id || !isRecord(geometry) || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    const region = {
      id,
      name: clean(typeof nameOf === "function" ? nameOf(id) : "") || clean(props.name ?? props.NAME_1 ?? props.name_1) || id,
      geometry,
    };
    const bbox = boxOf(geometry);
    if (bbox) region.bbox = bbox;
    const typeId = clean(props.typeId);
    if (typeId) region.typeId = typeId;
    regions.push(region);
  }
  return regions;
};

// Who controls, lawfully owns and groups each region as the turn began, and
// what each country weighs: the engine's questions about the world, answered
// from the world's own stores. What the turn's events change is told to the
// engine day by day (planFrontMoments), never read from here.
//   baseOwners   Map, region id -> who holds it on the map as drawn, for a
//                region no event has moved yet
//   regionIds    the regions of the map, to count what each country holds
//   groups       false when groups are switched off for the game
export const frontWorldReaders = (world, { baseOwners = null, regionIds = [], groups = true } = {}) => {
  const control = isRecord(world?.regionOwnershipOverrides) ? world.regionOwnershipOverrides : {};
  const sovereignty = isRecord(world?.regionSovereigntyOverrides) ? world.regionSovereigntyOverrides : {};
  const groupAreas = groups && isRecord(world?.groupAreas) ? world.groupAreas : {};
  const groupNames = new Set(Object.keys(groups && isRecord(world?.groups) ? world.groups : {}).map(fold));
  const base = baseOwners instanceof Map ? baseOwners : new Map();
  const controllerOf = (id) => clean(Object.hasOwn(control, id) ? control[id] : base.get(id));
  const sovereignOf = (id) => clean(Object.hasOwn(sovereignty, id) ? sovereignty[id] : "") || controllerOf(id);

  // The land each name holds: a country the regions it controls, a group the
  // regions of its area. Counted once, the first time a weight is asked for.
  let held = null;
  const heldBy = (name) => {
    if (!held) {
      held = new Map();
      const count = (owner) => {
        const key = fold(owner);
        if (key) held.set(key, (held.get(key) ?? 0) + 1);
      };
      for (const id of asArray(regionIds).length ? regionIds : Object.keys(control)) count(controllerOf(id));
      for (const group of Object.values(groupAreas)) count(group);
    }
    return held.get(fold(name)) ?? 0;
  };
  let people = null;
  const peopleOf = (name) => {
    people ??= new Map(Object.entries(isRecord(world?.countryStats) ? world.countryStats : {})
      .map(([key, sheet]) => [fold(key), Number(sheet?.population?.total)]));
    return people.get(fold(name));
  };

  return {
    controllerOf,
    sovereignOf,
    groupAreas,
    isGroup: (name) => groupNames.has(fold(name)),
    strengthOf: (name) => countryWeight({ population: peopleOf(name), regions: heldBy(name) }),
  };
};

// ---- names ---------------------------------------------------------------------------

// The renames a turn's events make, in the order they make them: a country
// given a new name by a polity change, a group by a group operation.
export const turnRenames = (events) => {
  const renames = [];
  const add = (from, to) => {
    if (clean(from) && clean(to) && fold(from) !== fold(to)) renames.push({ from: clean(from), to: clean(to) });
  };
  for (const event of asArray(events)) {
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    for (const change of asArray(impacts.polityChanges)) add(change?.code, change?.name);
    for (const op of asArray(impacts.groupOps)) add(op?.name, op?.newName);
  }
  return renames;
};

// The engine knows every country and group by the name it had as the turn
// began: it runs before the turn's events are applied, and the rename that one
// of them makes re-keys its battlefields afterwards with everything else. So a
// name an event gave during the turn is turned back into the one it replaced
// before the engine is told anything by it. `known` are the names in use as
// the turn began: a "new" name that one of them already answers to is somebody
// else's, and is left alone.
export const engineNamer = (renames, known = []) => {
  const taken = new Set(asArray(known).map(fold).filter(Boolean));
  const back = asArray(renames).filter((entry) => !taken.has(fold(entry?.to)));
  return (name) => {
    let current = clean(name);
    for (let index = back.length - 1; index >= 0; index -= 1) {
      if (fold(back[index].to) === fold(current)) current = back[index].from;
    }
    return current;
  };
};

// "country: Russia" in a field that takes a country or a group is Russia.
const withoutKind = (value) => clean(value).replace(/^(?:country|group|polity|nation|state|side)\s*:\s*/i, "");

// ---- what the events themselves say of the war ---------------------------------------

// A change of control the turn's events carry for a region that lies on a
// battlefield being fought over, taking it from one side of that battlefield
// for the other, is the story stating a result: the region was CAPTURED that
// day. That is what a model writes when it does not write an order (it is how
// every capture was written before there were battlefields), what a capture
// told only in an event's prose becomes (narratedCapture.js), and what the
// Game Master writes. The operation stays on its event and is applied as it
// always was; the engine is told of the change of control on that day, as it
// is of any other, AND told the capture as a result, so that the nearest
// troops of the side walk there and the ground between follows them, in place
// of a region changing colour behind the line with nobody near it.
//   events        the turn's events, in the order they will be applied
//   battlefields  the battlefields as the turn began
//   arenaOf       (record) => the ground under a battlefield, or null when it
//                 is not to be had
//   readers       frontWorldReaders
//   nameOf        engineNamer
// Returns orders as planFrontMoments reads them, each resting on its event.
export const statedCaptures = ({ events = [], battlefields = [], arenaOf = () => null, readers = null, nameOf = clean } = {}) => {
  const fought = normalizeBattlefields(battlefields).filter((record) => record.status === "active" && record.field);
  if (fought.length === 0 || !readers) return [];
  const sideOf = (record, name) => {
    const wanted = fold(name);
    return wanted ? record.sides.findIndex((members) => members.some((member) => fold(member) === wanted)) : -1;
  };
  // Who controls a region as the events before this one leave it.
  const moved = new Map();
  const controllerNow = (id) => (moved.has(id) ? moved.get(id) : readers.controllerOf(id));
  const stated = [];
  for (const event of asArray(events)) {
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    for (const transfer of asArray(impacts.regionTransfers)) {
      const regionId = clean(transfer?.regionId);
      if (transfer?.wholeCountry !== true && regionId && clean(transfer?.toCode)) moved.set(regionId, nameOf(transfer.toCode));
    }
    for (const op of asArray(impacts.regionControlOps)) {
      if (op?.by === FRONT_MARK || fold(op?.op) !== "control" || op?.wholeCountry === true) continue;
      const regionId = clean(op?.regionId);
      const to = nameOf(op?.toCode);
      if (!regionId || !to) continue;
      let best = null;
      for (const record of fought) {
        const arena = arenaOf(record);
        const index = arena?.indexOf?.get(regionId);
        if (index === undefined || !(arena.cells[index] > 0)) continue;
        const taker = sideOf(record, to);
        if (taker < 0) continue;
        const group = clean(readers.groupAreas?.[regionId]);
        const holder = group && sideOf(record, group) >= 0 ? group : controllerNow(regionId);
        if (sideOf(record, holder) !== 1 - taker) continue;
        if (!best || arena.cells[index] > best.arena.cells[best.index]) best = { record, arena, index };
      }
      moved.set(regionId, to);
      if (!best) continue;
      // The engine finds a region by its exact name: two of one name on the same
      // ground cannot be told apart, and the change of control alone is told.
      const name = best.arena.names[best.index];
      if (best.arena.names.filter((other) => fold(other) === fold(name)).length !== 1) continue;
      stated.push({
        id: `${STATED_REF}${clean(event?.id)}:${regionId}`,
        battlefield: best.record.name,
        side: to,
        order: "",
        sector: "all",
        eventIds: [clean(event?.id)],
        objective: `region: ${name}`,
        result: "captured",
      });
    }
  }
  return stated;
};

// A formation fighting on a battlefield is one of its side's troops there, and
// the engine is what moves it. A move an event still writes for one (the model
// remembered it from an earlier turn, a player ordered it by name) is left out,
// or the world would say it stands in one place and its battlefield in another.
// `ignored` names the formations, for the turn's receipt.
export const withoutCommittedMoves = (events, units) => {
  const committed = new Map(asArray(units)
    .filter((unit) => clean(unit?.committedTo) && clean(unit?.id))
    .map((unit) => [clean(unit.id), clean(unit.name)]));
  if (committed.size === 0) return { events: asArray(events), ignored: [] };
  const ignored = [];
  const next = asArray(events).map((event) => {
    const ops = asArray(event?.impacts?.unitOps);
    const kept = ops.filter((op) => {
      if (fold(op?.op) !== "move" || !committed.has(clean(op?.unitId))) return true;
      ignored.push(committed.get(clean(op.unitId)));
      return false;
    });
    return kept.length === ops.length ? event : { ...event, impacts: { ...event.impacts, unitOps: kept } };
  });
  return { events: next, ignored: [...new Set(ignored.filter(Boolean))] };
};

// (regionRef) => whether a region, named by its id or by its exact name, lies
// on an open battlefield: one of that battlefield's sides holds it, and its
// middle is on the battlefield's frame. Who holds such a region is the engine's
// to work out, so the territory Director's own marks on it are left out
// (nativeTerritoryDirector.js). By the frame and not by the ground, because the
// Director is checked before any shape of the map is read; a region the frame's
// edge cuts is judged by where its middle falls. null when no battlefield is
// open, or none has a region.
//   rows      the map's regions: { id, name, lng, lat } (the middle of each), or
//             `bounds` [[west, south], [east, north]] where it has no middle
//   readers   frontWorldReaders
export const battlefieldRegionTest = ({ battlefields = [], rows = [], readers = null } = {}) => {
  const open = normalizeBattlefields(battlefields).filter((record) => record.status !== "closed");
  if (open.length === 0 || !readers) return null;
  const middle = (own, box, axis) => {
    if (own !== null && own !== undefined && own !== "" && Number.isFinite(Number(own))) return Number(own);
    return Array.isArray(box) ? (Number(box[0]?.[axis]) + Number(box[1]?.[axis])) / 2 : NaN;
  };
  const ids = new Set();
  const names = new Set();
  for (const row of asArray(rows)) {
    const id = String(row?.id ?? "").trim();
    const lng = middle(row?.lng, row?.bounds, 0);
    const lat = middle(row?.lat, row?.bounds, 1);
    if (!id || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const holders = [readers.groupAreas?.[id], readers.controllerOf(id)].map(fold).filter(Boolean);
    const onOne = open.some((record) => pointInFrame(record.frame, lng, lat)
      && record.sides.some((members) => members.some((member) => holders.includes(fold(member)))));
    if (!onOne) continue;
    ids.add(id);
    if (clean(row.name) && clean(row.name) !== id) names.add(fold(row.name));
  }
  if (ids.size === 0) return null;
  return (regionRef) => {
    const text = clean(regionRef);
    return ids.has(text) || names.has(fold(text.replace(/^region\s*:\s*/i, "")));
  };
};

// ---- the run -----------------------------------------------------------------------

// Runs the engine over the turn. First with only the arenas it has kept from
// earlier turns: reading the map's regions is a fetch and a parse of tens of
// megabytes, and a war that is already being fought needs none of it. When the
// engine answers that it needs the regions (a battlefield has to open, a frame
// has to grow), they are loaded and the run starts again from the beginning.
//   createFrontRun  runtime/fronts/engine.js
//   input           everything but map.regions
//   loadRegions     async () => the map's regions, or null when they cannot be read
//   pause           async () => {} between chunks of days, so a long war does
//                   not hold the page
// null when the regions were needed and could not be had: the turn then goes on
// without the engine, and the battlefields stay as they were.
export const runFrontTurn = async ({ createFrontRun, input, loadRegions = null, pause = null, chunkDays = 15 } = {}) => {
  if (typeof createFrontRun !== "function") return null;
  let regions = input?.map?.regions ?? null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const run = createFrontRun({ ...input, map: { ...input?.map, regions } });
    while (!run.advance(chunkDays)) {
      if (typeof pause === "function") await pause();
    }
    const result = run.finish();
    if (!result?.needsRegions) return result ?? null;
    if (regions || typeof loadRegions !== "function") return null;
    regions = await loadRegions();
    if (!Array.isArray(regions) || regions.length === 0) return null;
  }
  return null;
};

// ---- after ---------------------------------------------------------------------------

// Each change of hands on the first event of its day or later, as the ordinary
// operation every reader of the map already understands. An event told to some
// governments only is passed over (a change everyone can see on the map does
// not ride on a secret), and a change later than every event goes on the last.
// A turn whose every event is such a secret still has the map to change: its
// last event carries them all. `unattached` is what there was no event at all
// to carry. With `aboutOf(event, battlefield)` (whether an event tells of the
// war on that battlefield), a change rides on such an event where there is
// one: the first of its day or later, else the last before it. The map then
// moves with the report of the fighting, not with whatever came next.
export const attachFrontFlips = (events, flips, { dayOf = () => 0, aboutOf = null } = {}) => {
  const list = asArray(events);
  const dated = list.map((event, index) => ({ index, day: dayOf(event), open: asArray(event?.audience).length === 0 && !clean(event?.audience) }));
  const carriers = (dated.some((entry) => entry.open) ? dated.filter((entry) => entry.open) : dated.slice(-1))
    .sort((a, b) => a.day - b.day || a.index - b.index);
  const added = new Map();
  const unattached = [];
  for (const flip of asArray(flips)) {
    const regionId = clean(flip?.regionId);
    if (!regionId) continue;
    const day = Number(flip?.day) || 0;
    const own = typeof aboutOf === "function" ? carriers.filter((entry) => aboutOf(list[entry.index], clean(flip?.battlefield))) : [];
    const carrier = own.find((entry) => entry.day >= day) ?? own[own.length - 1] ?? carriers.find((entry) => entry.day >= day) ?? carriers[carriers.length - 1];
    if (!carrier) {
      unattached.push(flip);
      continue;
    }
    if (!added.has(carrier.index)) added.set(carrier.index, { regionControlOps: [], groupOps: [] });
    const ops = added.get(carrier.index);
    const note = clean(flip?.battlefield);
    if (flip?.kind === "groupTake" || flip?.kind === "groupRelease") {
      const name = clean(flip.kind === "groupTake" ? flip.to : flip.from);
      if (name) ops.groupOps.push({ op: flip.kind === "groupTake" ? "take" : "release", name, regionIds: [regionId], note, by: FRONT_MARK });
    } else if (clean(flip?.from) && clean(flip?.to)) {
      ops.regionControlOps.push({ op: "control", regionId, fromCode: clean(flip.from), toCode: clean(flip.to), basis: "occupation", note, by: FRONT_MARK });
    }
  }
  const next = list.map((event, index) => {
    const ops = added.get(index);
    if (!ops) return event;
    const impacts = isRecord(event?.impacts) ? event.impacts : {};
    return {
      ...event,
      impacts: {
        ...impacts,
        ...(ops.regionControlOps.length ? { regionControlOps: [...asArray(impacts.regionControlOps), ...ops.regionControlOps] } : {}),
        ...(ops.groupOps.length ? { groupOps: [...asArray(impacts.groupOps), ...ops.groupOps] } : {}),
      },
    };
  });
  return { events: next, unattached };
};

// The world's formations after the run: one taken onto a battlefield carries its
// name, one that came back stands where its troop stood with what is left of
// it, and one that was destroyed there is gone.
export const applyFrontUnitChanges = (units, changes) => {
  const byId = new Map(asArray(changes).filter(isRecord).map((change) => [clean(change.unitId), change]));
  if (byId.size === 0) return asArray(units);
  const next = [];
  for (const unit of asArray(units)) {
    const change = byId.get(clean(unit?.id));
    if (!change) {
      next.push(unit);
      continue;
    }
    if (change.remove === true) continue;
    const { committedTo: _was, ...rest } = unit;
    const lng = Number(change.lng);
    const lat = Number(change.lat);
    const strength = Number(change.strength);
    next.push({
      ...rest,
      ...(Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : {}),
      ...(Number.isFinite(strength) ? { strength: Math.max(1, Math.min(100, Math.round(strength))) } : {}),
      ...(clean(change.committedTo) ? { committedTo: clean(change.committedTo) } : {}),
    });
  }
  return next;
};

// What the engine could not do as it was told, in the words the simulator
// reads at the top of its next turn. One line a kind, the cases counted.
const named = (notes, field) => [...new Set(notes.map((note) => clean(note?.[field])).filter(Boolean))];
const quoted = (notes, field) => named(notes, field).slice(0, 4).join("; ") || "unnamed";
const one = (notes, field) => named(notes, field).length <= 1;
const NOTE_TEXT = {
  "unknown-battlefield": (notes) => `Front orders named ${one(notes, "battlefield") ? "a battlefield that does" : "battlefields that do"} not exist (${quoted(notes, "battlefield")}). Use the names listed under [Fronts]; a battlefield opens by itself where two sides at war hold touching land.`,
  "side-not-fighting": (notes) => `Front orders were given for ${quoted(notes, "side")}, which ${one(notes, "side") ? "is" : "are"} not fighting on the battlefield named. Only a side of that battlefield's war takes orders there.`,
  "sector-read-as-all": (notes) => `A sector that does not fit its line was read as the whole line (${quoted(notes, "detail")}). The sectors each line has are listed under [Fronts].`,
  "objective-not-found": (notes) => `An objective was not found on its battlefield and was left out (${quoted(notes, "detail")}). Name a city or a region that lies on that battlefield.`,
  "objective-unreachable": (notes) => `A capture was stated that the side's troops had no way to reach, and the place was not taken (${quoted(notes, "detail")}). A side takes only what its troops on that battlefield can get to.`,
  "landing-refused": (notes) => {
    const places = named(notes, "detail").filter((detail) => detail !== "no-reserves").slice(0, 4).join("; ");
    return `A landing was not made${places ? ` (${places})` : ""}: it needs a place the other side holds, and reserves left to put ashore.`;
  },
  "no-pocket-there": (notes) => `A surrender was stated where no troops are cut off (${quoted(notes, "detail")}). Only a whole side, or the troops of a pocket, can be made to surrender.`,
  // The war it was for is not named: a war has a title only sometimes, and never an id a model is shown.
  "too-many-battlefields": () => "No more battlefields can be open at once, so a front that should have opened did not. It opens when another closes.",
  tempo: () => "The fronts stopped moving for the rest of the period: this scenario's ceiling on how fast the map may change was reached.",
  "transport-refused": (notes) => `${one(notes, "detail") ? "A transporter was" : "Transporters were"} not sent (${quoted(notes, "detail")}). One is sent by a side at war, to a place on the map that its kind can reach: a ship to a coast, rail through land its side holds.`,
  closed: (notes) => `${one(notes, "battlefield") ? "A battlefield" : "Battlefields"} closed (${quoted(notes, "battlefield")}): the fighting there is over. Land a side still holds there that is not its own stays occupied until an event settles it.`,
};

// Why a transporter did not set out, in words.
const TRANSPORT_REFUSALS = {
  "no-war": "its sender is fighting no war",
  "no-place": "the place it was sent to is not on the map",
  "no-origin": "its sender has no city to send it from",
  "no-coast": "no sea is near where it would set out",
  "no-shore": "no shore is near where it was sent",
  "no-sea-way": "no sea leads there",
  "no-ground": "it has no land of its own side's to start on",
  "no-troops": "the troops it was to take are gone",
  "too-far": "no way there was found",
  "off-map": "the place is off the map",
  "not-yet": "nothing of that kind exists yet",
  "too-many": "too many transporters are out already",
  "nothing-aboard": "it was given nothing to carry",
  incomplete: "its order is incomplete",
};
export const transportRefusal = (code) => TRANSPORT_REFUSALS[clean(code)] ?? "it could not set out";

export const describeFrontNotes = (notes) => {
  const byKind = new Map();
  for (const note of asArray(notes)) {
    const kind = clean(note?.kind);
    if (!NOTE_TEXT[kind]) continue;
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(note);
  }
  return [...byKind.entries()].map(([kind, list]) => ({
    kind: kind === "tempo" || kind === "closed" ? "adjusted" : "dropped",
    text: NOTE_TEXT[kind](list),
  }));
};

// ---- a turn, start to finish ---------------------------------------------------------

const isOpen = (record) => record?.status !== "closed";
const listed = (names, most = 3) => `${names.slice(0, most).join("; ")}${names.length > most ? `; and ${names.length - most} more` : ""}`;

// A turn's land war: everything above, in the order a turn needs it.
//   createFrontRun   runtime/fronts/engine.js
//   world            the world as the turn began
//   events           the turn's events, as they are about to be applied
//   frontOrders      the orders that survived with them (nativeFrontLedger.js)
//   warStages        the wars as the turn began, then as each record of the
//                    turn's war ledger leaves them (planFrontMoments)
//   fromDate, toDate, requestedDays   the days the turn covers (frontRunSpan)
//   map              { key, cities, flat, scale, structures }: all of the map
//                    the engine is told but its shapes
//   regionTypes      world.regionTypes
//   baseOwners, regionIds, groups   frontWorldReaders
//   arenas           the Map the caller keeps the engine's arenas in
//   readMap          async () => { map, baseOwners, regionIds, arenas }, for a
//                    caller that has to read them: asked only once it is known
//                    there is a war, a battlefield or an order to run
//   loadRegions      async () => the map's regions as engineRegionsOf gives
//                    them, or null when they cannot be read. Called at most once.
//   pause            async () => {} between chunks of days
//   pace             the scenario's pace for an advance, as a factor
//   tempoAllowance   (days) => the regions a scenario lets the map move in a
//                    span of that many days, or null for no ceiling
//   seed             what makes this turn's run its own
//   players          the countries and groups people play
//   narratesCombat   (event) => whether an event tells of fighting
//   foretold         true when the period was fought BEFORE the story was asked
//                    for and the story was given its account (frontApply.js
//                    forecastTurnFronts): the same run, then, with the answer's
//                    orders for the battlefields that were being fought put at
//                    its end, for the next period to carry out
// Returns
//   events           the turn's events: an earlier apply's changes of hands
//                    taken out, moves of formations that are on a battlefield
//                    left out, this run's changes of hands put on
//   battlefields     world.battlefields as the run leaves it; null to leave it
//                    as it is (nothing to run on, or the map could not be read)
//   unitChanges      for applyFrontUnitChanges
//   notes            [{ kind, text }] for the turn's receipt
//   flips, stats     what the engine reported, for the log
//   news             what the days of the run added to the battlefields' logs
//   joins            the countries troops were sent into, each now in its war:
//                    [{ day, date, battlefield, warId, name, side, by }], for
//                    the war ledger (frontApply.js frontWarJoins)
//   transports       world.transports as the run leaves it, with what the
//                    answer ordered added (those set out when the next period
//                    begins); null to leave it as it is
//   voyages          what became of each transporter during the run
// The same arguments give the same result: a turn applied twice is one turn.
export const runTurnFronts = async ({
  createFrontRun,
  world = {},
  events = [],
  frontOrders = [],
  warStages = null,
  fromDate = "",
  toDate = "",
  requestedDays = 0,
  map: givenMap = {},
  regionTypes = [],
  baseOwners: givenOwners = null,
  regionIds: givenIds = [],
  groups = true,
  arenas: givenArenas = null,
  readMap = null,
  loadRegions = null,
  pause = null,
  pace = 1,
  tempoAllowance = null,
  seed = "",
  players = [],
  narratesCombat = null,
  // The fronts a scenario begins with (runtime/fronts/scenarioFronts.js), on
  // the one run that builds them: what they are called and how many troops
  // each side has. No other run is given any.
  authored = null,
  foretold = false,
} = {}) => {
  const cleared = withoutCommittedMoves(stripFrontOps(events), world?.units);
  const list = cleared.events;
  const notes = [];
  if (cleared.ignored.length) {
    notes.push({
      kind: "dropped",
      text: `Unit operations moved ${cleared.ignored.length === 1 ? "a formation that is" : "formations that are"} fighting on a battlefield (${listed(cleared.ignored)}); the moves were left out. `
        + "Troops on a battlefield are moved by front orders, under [Fronts].",
    });
  }
  const nothing = (battlefields) => ({ events: list, battlefields, unitChanges: [], notes, flips: [], stats: null, news: [], joins: [], transports: null, voyages: [] });

  const saved = normalizeBattlefields(world?.battlefields);
  const stages = asArray(warStages).length ? asArray(warStages).map(asArray) : [asArray(world?.wars)];
  const written = asArray(frontOrders).filter((order) => isRecord(order) && !order.problem);
  // A line that sends a transporter is not an order for a battlefield: it is
  // set apart here and becomes a transporter of the world, below.
  const orders = written.filter((order) => !Object.hasOwn(TRANSPORT_ORDERS, order.order));
  const dispatches = written.filter((order) => Object.hasOwn(TRANSPORT_ORDERS, order.order));
  const atWar = stages.some((wars) => wars.some((war) => clean(war?.status) !== "ended"));
  const committed = asArray(world?.units).some((unit) => clean(unit?.committedTo));
  // No battlefield, no war and no order: there is nothing for the engine to do.
  // A battlefield that closed last turn has had its one more turn on the map.
  if (!saved.some(isOpen) && !atWar && written.length === 0 && !committed) return nothing(saved.length ? [] : null);

  const read = typeof readMap === "function" ? await readMap() : null;
  const map = read?.map ?? givenMap;
  const baseOwners = read?.baseOwners ?? givenOwners;
  const regionIds = read?.regionIds ?? givenIds;
  const arenas = read?.arenas ?? givenArenas;
  const { days, dayOf } = frontRunSpan({ fromDate, toDate, requestedDays, events: list });
  const readers = frontWorldReaders(world, { baseOwners, regionIds, groups });
  const nameOf = engineNamer(turnRenames(list), [
    ...stages[0].flatMap((war) => [...asArray(war?.sideA), ...asArray(war?.sideB)]),
    ...saved.flatMap((record) => record.sides.flat()),
    ...Object.keys(isRecord(world?.polityOverrides) ? world.polityOverrides : {}),
    ...Object.keys(groups && isRecord(world?.groups) ? world.groups : {}),
  ]);

  // The map's shapes, read once and only if something needs them.
  let regions = null;
  let asked = false;
  const readRegions = async () => {
    if (!asked) {
      asked = true;
      const loaded = typeof loadRegions === "function" ? await loadRegions() : null;
      regions = Array.isArray(loaded) && loaded.length ? loaded : null;
    }
    return regions;
  };

  // What the events themselves state of the battlefields being fought over.
  // It needs the ground under each: kept from an earlier turn, or drawn now
  // from the shapes, which the engine would then have asked for anyway.
  const fought = saved.filter((record) => record.status === "active" && record.field);
  const writesControl = list.some((event) => asArray(event?.impacts?.regionControlOps)
    .some((op) => op?.by !== FRONT_MARK && fold(op?.op) === "control" && op?.wholeCountry !== true));
  let stated = [];
  if (fought.length && writesControl) {
    const drawn = new Map();
    const arenaOf = (record) => {
      if (!drawn.get(record)) drawn.set(record, arenaFor(arenas, { ...map, regions }, record.frame, regionTypes));
      return drawn.get(record);
    };
    if (fought.some((record) => !arenaOf(record))) await readRegions();
    stated = statedCaptures({ events: list, battlefields: fought, arenaOf, readers, nameOf });
  }

  // The battlefields whose period the story was told before it was written.
  const settled = foretold ? new Set(saved.filter((record) => record.status === "active").map((record) => foldBattlefieldName(record.name))) : null;
  const moments = planFrontMoments({ events: list, frontOrders: [...orders, ...stated], warStages: stages, fromDate, days, dayOf, settled })
    .map((moment) => {
      if (moment.type === "order") return { ...moment, side: nameOf(withoutKind(moment.side)) };
      if (moment.type === "control") return { ...moment, to: nameOf(moment.to) };
      if (moment.type === "war") return { ...moment, names: asArray(moment.names).map(nameOf), ...(moment.opponents ? { opponents: asArray(moment.opponents).map(nameOf) } : {}) };
      return moment;
    });

  const allowance = typeof tempoAllowance === "function" ? tempoAllowance(days) : tempoAllowance;
  const result = await runFrontTurn({
    createFrontRun,
    input: {
      battlefields: saved,
      fromDate,
      toDate,
      days,
      moments,
      wars: stages[0],
      controllerOf: readers.controllerOf,
      sovereignOf: readers.sovereignOf,
      groupAreas: readers.groupAreas,
      isGroup: readers.isGroup,
      units: asArray(world?.units),
      transports: normalizeTransports(world?.transports),
      map: { ...map, regions },
      regionTypes: asArray(regionTypes),
      strengthOf: readers.strengthOf,
      pace,
      flipAllowance: frontFlipAllowance({ allowance, events: list }),
      seed,
      arenas,
      ...(asArray(authored).length ? { authored: asArray(authored) } : {}),
    },
    loadRegions: readRegions,
    pause,
  });
  // The map could not be read: the turn goes on without the engine.
  if (!result) return nothing(null);

  // A battlefield an order names "border: A / B" is a border fortified in
  // peace, which the engine opens itself; one it does not know is not the
  // model's mistake to be told of. Nor is what it says of an order the turn
  // drew from an event's own operations.
  const told = asArray(result.notes).filter((note) => !clean(note?.ref).startsWith(STATED_REF)
    && !(note?.kind === "unknown-battlefield" && /^border\s*:/i.test(clean(note?.battlefield))));
  notes.push(...describeFrontNotes(told));

  // Which events tell of the war on a battlefield: bound to its war, or with
  // members of both its sides on the field.
  const byName = new Map(asArray(result.battlefields).map((record) => [foldBattlefieldName(record.name), record]));
  const aboutOf = (event, battlefield) => {
    const record = byName.get(foldBattlefieldName(battlefield));
    if (!record) return false;
    const bound = clean(event?.warId);
    if (bound) return bound === record.warId;
    return record.sides.every((members) => asArray(event?.combatants).some((name) => members.some((member) => fold(member) === fold(nameOf(name)))));
  };

  // Fighting told on a battlefield no order was written for: the troops there
  // kept the orders they had, and the model is told so it writes them next time.
  // (Not where the story was told the fighting before it wrote: it tells what
  // standing orders did, and owes no line for it.)
  if (typeof narratesCombat === "function" && !foretold) {
    const human = new Set(asArray(players).map(fold).filter(Boolean));
    const ordered = new Set(orders.map((order) => foldBattlefieldName(order.battlefield)));
    const unordered = asArray(result.battlefields).filter((record) => record.status === "active"
      && !ordered.has(foldBattlefieldName(record.name))
      && !record.sides.flat().every((member) => human.has(fold(member)))
      && list.some((event) => {
        const bound = clean(event?.warId);
        const onIt = bound
          ? bound === record.warId
          : record.sides.every((members) => asArray(event?.combatants).some((name) => members.some((member) => fold(member) === fold(nameOf(name)))));
        return onIt && narratesCombat(event);
      }));
    if (unordered.length) {
      notes.push({
        kind: "short",
        text: `Events told of fighting on ${listed(unordered.map((record) => record.name))} and no line of frontOrders gave a side there an order, so its troops kept the orders they had. `
          + "Give each side an event has attacking, holding or falling back its order in frontOrders.",
      });
    }
  }

  // The transporters the answer ordered: each is the world's from now, and
  // sets out when the next period begins, so that its voyage is fought before
  // the story of that period is written and told in it.
  let transports = normalizeTransports(result.transports);
  const refused = [];
  // One the run refused when it was to set out, when it was the story that ordered it.
  for (const voyage of asArray(result.voyages)) {
    const mine = transports.find((entry) => entry.id === voyage?.id);
    if (voyage?.k === "refused" && mine && !mine.by) refused.push({ kind: "transport-refused", detail: `${clean(voyage.owner)} to ${clean(voyage.to) || "?"}: ${transportRefusal(voyage.why)}` });
  }
  const year = gameDateYear(fromDate);
  for (const order of dispatches) {
    const owner = nameOf(withoutKind(order.side));
    // The battlefield it names is the one its landing opens: not one that is open already.
    const taken = asArray(result.battlefields).some((record) => record.status !== "closed" && foldBattlefieldName(record.name) === foldBattlefieldName(order.battlefield));
    const sent = orderTransport(transports, {
      medium: TRANSPORT_ORDERS[order.order],
      owner,
      to: { name: clean(order.objective) },
      battlefield: taken ? "" : clean(order.battlefield),
      kind: clean(order.carrier),
      speed: Number(order.speed) || 0,
      raise: Number(order.strength) > 0 ? Number(order.strength) : TRANSPORT_LOAD_USUAL,
    }, { date: toDate, year });
    if (sent.error) refused.push({ kind: "transport-refused", detail: `${owner} to ${clean(order.objective) || "?"}: ${transportRefusal(sent.error)}` });
    else transports = sent.transports;
  }
  notes.push(...describeFrontNotes(refused));

  return {
    transports,
    voyages: asArray(result.voyages),
    underWay: transports.filter(isUnderWay).length,
    events: attachFrontFlips(list, result.flips, { dayOf, aboutOf }).events,
    // A battlefield whose period the story was told before it was written says
    // so (brief.told): the next turn has nothing of this one left to tell. One
    // that does not (it opened in this answer, or the turn was asked for the
    // old way) is told then, with the period after it (frontPrompt.js).
    battlefields: asArray(result.battlefields).map((record) => (settled?.has(foldBattlefieldName(record?.name)) && isRecord(record.brief)
      ? { ...record, brief: { ...record.brief, told: true } }
      : record)),
    unitChanges: asArray(result.unitChanges),
    notes,
    flips: asArray(result.flips),
    stats: result.stats ?? null,
    news: asArray(result.news),
    joins: asArray(result.joins),
  };
};
