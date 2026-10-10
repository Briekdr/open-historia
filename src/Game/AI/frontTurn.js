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
// Nothing here needs the map or the model, and it loads in plain Node: the
// engine and the map's regions are handed in (gameplay.js applySimulationResult).

import { diffGameDays } from "../../runtime/gameDates.js";

export const FRONT_MARK = "front";

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
// An order takes effect on the day of the earliest event it rests on, and one
// that rests on none on the first day. A change of control the model wrote
// itself (a control operation, a single region handed over) is told to the
// engine on its event's day: the world as written wins over the line, which is
// what makes the engine bend the line round it rather than fight it.
export const planFrontMoments = ({ events = [], frontOrders = [], warsBefore = [], warsAfter = [], fromDate = "", days = 0, dayOf = () => 0 } = {}) => {
  const list = asArray(events);
  const dayById = new Map(list.map((event) => [clean(event?.id), dayOf(event)]));
  const moments = [...warMoments(warsBefore, warsAfter, { fromDate, days })];

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
    const moment = {
      day: bound.length ? Math.min(...bound) : 0,
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

// A country's weight in a land war: how many troops its side is given, in
// proportion to the other's. Its people where its sheet counts them, by the
// square root, so that a country of a billion is not a hundred times one of ten
// million on the same front; otherwise the land it holds. Only ratios matter.
export const countryWeight = ({ population = 0, regions = 0 } = {}) => {
  const people = Number(population);
  if (Number.isFinite(people) && people > 0) return Math.max(1, 2 * Math.sqrt(people / 1e6));
  return 4 + 2 * Math.sqrt(Math.max(0, Number(regions) || 0));
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
// `unattached` is what there was no event at all to carry.
export const attachFrontFlips = (events, flips, { dayOf = () => 0 } = {}) => {
  const list = asArray(events);
  const carriers = list
    .map((event, index) => ({ index, day: dayOf(event), open: asArray(event?.audience).length === 0 && !clean(event?.audience) }))
    .filter((entry) => entry.open)
    .sort((a, b) => a.day - b.day || a.index - b.index);
  const added = new Map();
  const unattached = [];
  for (const flip of asArray(flips)) {
    const regionId = clean(flip?.regionId);
    if (!regionId) continue;
    const carrier = carriers.find((entry) => entry.day >= (Number(flip?.day) || 0)) ?? carriers[carriers.length - 1];
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
  tempo: () => "The fronts stopped moving for the rest of the period: this scenario's ceiling on how fast the map may change was reached.",
  closed: (notes) => `${one(notes, "battlefield") ? "A battlefield" : "Battlefields"} closed with the war (${quoted(notes, "battlefield")}). Land a side still holds there that is not its own stays occupied until an event settles it.`,
};

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
