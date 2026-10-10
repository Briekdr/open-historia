/*! Open Historia — a turn's land war: the game's side of the front engine © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// frontTurn.js is the turn's side of the conversation with the front engine
// and knows nothing of the game: it is handed a world, the events and a way to
// read the map. This is where the game hands them over, and the only file
// gameplay.js calls for any of it:
//
//   applyTurnFronts      a turn being applied (applySimulationResult): the engine
//                        is run over the days the turn covers and its changes of
//                        hands are put on the turn's events
//   withFrontUnits       the formations that went onto a battlefield or came back
//   frontsLiveBlock      the [Fronts] block of a time skip's prompt
//   frontPowers,         the old stand-ins for a front (a counter raised for a
//   withoutFrontPowers,  power with none, the territory Director's marks) keep
//   frontRegionTest      clear of the powers and the regions a battlefield has
//
// Every one of them does nothing, and reads nothing, in a game whose fronts are
// switched off (frontsGate.js).

import { noteReceipt } from "../../runtime/applicationReceipt.js";
import { JSON_URLS, loadRegionCatalog, readJson } from "../../runtime/assets.js";
import { effectiveCityPopulation } from "../../runtime/cityPopulation.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { createFrontRun } from "../../runtime/fronts/engine.js";
import { getActiveWorldDirection, isActiveFeatureEnabled } from "../../runtime/gameFeatures.js";
import { humanCountriesOf } from "../../runtime/humanPolities.js";
import { FREEFORM, normalizeProjection } from "../../../server/mapProjection.js";
import { battlefieldPowers, buildFrontsBlock } from "./frontPrompt.js";
import { frontsOn, frontsPace } from "./frontsGate.js";
import { applyFrontUnitChanges, battlefieldRegionTest, engineRegionsOf, frontWorldReaders, runTurnFronts, stripFrontOps } from "./frontTurn.js";
import { applyWarUpdates, eventNarratesHardCombat } from "./nativeWarLedger.js";
import { filterToRenderedRegions } from "./promptContext.js";
import { territoryTempoAllowance } from "./worldDirection.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// ---- the map, as the engine is told it -------------------------------------------

// The ground under each battlefield (runtime/fronts/arena.js), drawn once from
// the map's shapes and kept while the same map is being played: a war that is
// already being fought then needs no shapes read at all. Another campaign's
// map, or the same one with a region or a city's name changed, is another key,
// and what was kept for the last one is let go.
let kept = { key: "", arenas: new globalThis.Map() };
const arenasFor = (key) => {
  if (kept.key !== key) kept = { key, arenas: new globalThis.Map() };
  return kept.arenas;
};

const hashOf = (text) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

// What the engine needs of the map besides its shapes: each region's name and
// who held it before any override, the cities, the structures, and a key that
// names this map. Read from what the game already keeps in hand (the compact
// region catalog, the cities file); the shapes themselves are read only when
// the engine asks for them.
const readFrontMap = async (world, game, campaignId) => {
  const [catalogRows, citiesGeojson] = await Promise.all([
    loadRegionCatalog().catch(() => []),
    readJson(JSON_URLS.citiesGeojson, { defaultValue: null }).catch(() => null),
  ]);
  const catalog = filterToRenderedRegions(catalogRows, world);
  const baseOwners = new globalThis.Map();
  const names = new globalThis.Map();
  const regionIds = [];
  for (const row of catalog) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;
    regionIds.push(id);
    baseOwners.set(id, clean(row.owner ?? row.country));
    names.set(id, clean(row.name) || id);
  }
  const date = clean(game?.gameDate || game?.startDate);
  const renames = isRecord(world?.cityRenames) ? world.cityRenames : {};
  const cities = [];
  for (const feature of asArray(citiesGeojson?.features)) {
    const props = isRecord(feature?.properties) ? feature.properties : {};
    const point = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
    const name = clean(props.city || props.name);
    if (!name || !Array.isArray(point) || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))) continue;
    cities.push({
      name: clean(renames[name.toLowerCase()]) || name,
      lng: Number(point[0]),
      lat: Number(point[1]),
      population: effectiveCityPopulation(props, { date, cityPopulations: world?.cityPopulations, name }),
      capital: Boolean(clean(props.capital)) && !["false", "0", "no"].includes(fold(props.capital)),
    });
  }
  // What an assault may be sent at besides a city: the structures of the map,
  // by name and place. (The engine finds a formation among the units it is given.)
  const structures = asArray(world?.markers)
    .map((marker) => ({ name: clean(marker?.name), kind: clean(marker?.kind), owner: clean(marker?.ownerCode), lng: Number(marker?.lng), lat: Number(marker?.lat) }))
    .filter((entry) => entry.name && Number.isFinite(entry.lng) && Number.isFinite(entry.lat));
  const projection = normalizeProjection(world?.projection);
  const key = [
    clean(campaignId) || "game",
    regionIds.length,
    hashOf(regionIds.join("\u0002")),
    hashOf([...names.values()].join("\u0002")),
    cities.length,
    hashOf(JSON.stringify(renames)),
  ].join(":");
  return {
    baseOwners,
    names,
    regionIds,
    // A flat sheet is a map with no globe behind it; nothing in the game says
    // how many kilometres its degree is, so it is the world's.
    map: { key, cities, structures, flat: projection.type === FREEFORM },
  };
};

// The wars as each record of the turn's war ledger leaves them, one stage a
// record: what tells the engine on which day a war began, was joined, froze or
// ended. The ledger's own merge, a record at a time, so a record it refuses
// moves nothing here either. It reads only the wars, so they are all it is given.
const warStagesOf = ({ wars, updates, events, stopDate, round }) => {
  const stages = [asArray(wars)];
  for (const update of asArray(updates)) {
    try {
      stages.push(applyWarUpdates({ world: { wars: stages.at(-1) }, updates: [update], events, stopDate, round, limit: Infinity }).wars);
    } catch (error) {
      console.warn("[fronts] a war record could not be read for the battlefields; they follow the wars as they stood.", error);
    }
  }
  return stages;
};

// ---- a turn being applied --------------------------------------------------------------

const pauseFor = (signal) => async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new DOMException("Timeline jump cancelled.", "AbortError"));
};

// Runs the front engine over a turn that is about to be applied.
//   events        the turn's events as the world will receive them
//   frontOrders   the orders that survived with them (nativeFrontLedger.js)
//   warUpdates    the turn's war ledger records, as the ledger will merge them
//   loadRegions   reads the map's regions file (gameplay.js createRenderedRegionsReader)
// Returns null when fronts are off. Otherwise { events, battlefields,
// unitChanges, ... }: the events with what an earlier apply's run added taken
// out and this run's changes of hands put on, the battlefields to write (null
// to leave them as they are) and the formations that changed. What the engine
// could not do as it was told goes on `receipt`. It never fails a turn: if the
// engine cannot be run, the turn goes on without it and the battlefields stand.
export const applyTurnFronts = async ({
  baseGame = {},
  baseWorld = {},
  campaignId = "",
  events = [],
  frontOrders = [],
  loadRegions = null,
  nextGame = {},
  receipt = null,
  requestedDays = 0,
  signal = null,
  warUpdates = [],
} = {}) => {
  if (!frontsOn()) return null;
  const startedAt = Date.now();
  const fromDate = clean(baseGame?.gameDate);
  const toDate = clean(nextGame?.gameDate) || fromDate;
  const round = Number(nextGame?.round) || (Number(baseGame?.round) || 1) + 1;
  try {
    // The map is read only once there is a war, a battlefield or an order to
    // run on: a turn of peace costs nothing here.
    let front = null;
    const direction = getActiveWorldDirection();
    const run = await runTurnFronts({
      createFrontRun,
      world: baseWorld,
      events,
      frontOrders,
      warStages: warStagesOf({ wars: baseWorld?.wars, updates: warUpdates, events, stopDate: toDate, round }),
      fromDate,
      toDate,
      requestedDays,
      regionTypes: asArray(baseWorld?.regionTypes),
      groups: isActiveFeatureEnabled("groups"),
      readMap: async () => {
        front = await readFrontMap(baseWorld, baseGame, campaignId);
        return { map: front.map, baseOwners: front.baseOwners, regionIds: front.regionIds, arenas: arenasFor(front.map.key) };
      },
      loadRegions: typeof loadRegions === "function"
        ? async () => engineRegionsOf(await loadRegions(), { nameOf: (id) => front?.names.get(id) })
        : null,
      pause: pauseFor(signal),
      pace: frontsPace(),
      tempoAllowance: (days) => (direction?.territoryTempo > 0 ? territoryTempoAllowance(direction.territoryTempo, Math.max(1, days)) : null),
      // The same turn of the same campaign is the same run, whoever applies it and how often.
      seed: `${clean(campaignId)}|${round}|${fromDate}`,
      players: humanCountriesOf(baseGame),
      narratesCombat: eventNarratesHardCombat,
    });
    for (const note of run.notes) noteReceipt(receipt, note.kind, note.text);
    if (run.stats) {
      const open = asArray(run.battlefields).filter((record) => record.status !== "closed");
      const troops = open.reduce((sum, record) => sum + asArray(record.brief?.strength).reduce((count, side) => count + (Number(side?.n) || 0), 0), 0);
      const told = `${open.length} battlefield${open.length === 1 ? "" : "s"} open with ${troops} formation${troops === 1 ? "" : "s"} standing; `
        + `${run.flips.length} region${run.flips.length === 1 ? "" : "s"} changed hands over ${run.stats.days} day${run.stats.days === 1 ? "" : "s"} (${Date.now() - startedAt} ms).`;
      console.info(`[OH fronts] ${told}`);
      logDebugEvent("turn", `Fronts: ${told}`, {
        battlefields: open.map((record) => record.name),
        flips: run.flips.length,
        unitChanges: run.unitChanges.length,
        notes: run.notes.length,
      }, { verbose: true });
    }
    return run;
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    console.warn("[fronts] the front engine could not be run for this turn; the turn goes on without it and the battlefields stand as they were.", error);
    logDebugEvent("turn", "Fronts: the engine could not be run for this turn; the battlefields stand as they were.", error, { problem: true });
    return { events: stripFrontOps(events), battlefields: null, unitChanges: [], notes: [], flips: [], stats: null };
  }
};

// The world's formations after a turn's run: the ones that went onto a
// battlefield carry its name, the ones that came back stand where their troops
// stood, and a formation on a battlefield keeps no standing order of its own,
// since the engine is what moves it now.
export const withFrontUnits = (world, fronts) => {
  if (!fronts || asArray(fronts.unitChanges).length === 0) return world;
  const units = applyFrontUnitChanges(world?.units, fronts.unitChanges);
  const committed = new Set(units.filter((unit) => clean(unit?.committedTo)).map((unit) => unit.id));
  return {
    ...world,
    units,
    pendingUnitOrders: asArray(world?.pendingUnitOrders).filter((order) => !committed.has(order?.unitId)),
  };
};

// ---- the prompt -------------------------------------------------------------------------

// The [Fronts] block of a time skip's live records; "" with fronts off, so the
// prompt is then exactly what it was.
export const frontsLiveBlock = (world, game) => (frontsOn()
  ? buildFrontsBlock({ battlefields: world?.battlefields, players: humanCountriesOf(game) })
  : "");

// ---- the old stand-ins --------------------------------------------------------------------

// The countries and groups the engine is fielding on a battlefield: none of
// them is "at war with nobody on the map". [] with fronts off.
export const frontPowers = (world) => (frontsOn() ? battlefieldPowers(world?.battlefields) : []);

// The powers the unit Director would have a counter raised for, less the ones
// a battlefield already fields (nativeUnitDirector.js missingCombatantSpawns).
export const withoutFrontPowers = (missing, world) => {
  const fielded = new Set(frontPowers(world).map(fold));
  return fielded.size ? asArray(missing).filter((entry) => !fielded.has(fold(entry?.power))) : missing;
};

// The test the territory Director takes for "this region is on a battlefield"
// (frontTurn.js battlefieldRegionTest), from the map's own catalog of regions.
// null with fronts off, or with no battlefield open.
export const frontRegionTest = async (world) => {
  if (!frontsOn() || asArray(world?.battlefields).length === 0) return null;
  const rows = filterToRenderedRegions(await loadRegionCatalog().catch(() => []), world);
  const baseOwners = new globalThis.Map(rows.map((row) => [String(row?.id ?? "").trim(), clean(row?.owner ?? row?.country)]));
  return battlefieldRegionTest({
    battlefields: world.battlefields,
    rows,
    readers: frontWorldReaders(world, { baseOwners, groups: isActiveFeatureEnabled("groups") }),
  });
};
