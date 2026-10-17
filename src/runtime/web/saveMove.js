/*! Open Historia — brings a browser's saves across from the http address © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A browser keeps http://openhistoria.com and https://openhistoria.com as two
// sites with two libraries. Players who first came over http had their games
// stored under it; once every http visit was redirected to https they opened an
// empty library, with their games untouched next door (reported 2026-10-10 as
// "saves reset after updating").
//
// This is the https half. Once per browser, as the game starts:
//   1. it sends the browser to http://<this host>/save-move/ (public/save-move/),
//      the only place the old library can be read;
//   2. that page posts the library, packed into one file, back to the game's
//      own address, where the service worker (public/sw.js) keeps it;
//   3. the game starts again, finds the file and merges it into this library.
// Nothing is ever replaced or deleted: a game or scenario whose id is taken here
// arrives under a new id, and the http library is left as it was.
//
// It only leaves the game when the round trip can work: the service worker
// answers, and the site sends https://<host>/save-move/ back to http (which is
// how a browser that upgrades http by itself is made to stay on it). Until the
// site is set up that way this does nothing at all. Web build only.

import { DEFAULT_SCENARIO_ID } from "./storeConstants.js";

// The same six bytes public/save-move/sender.js writes (saveMove.test.js checks).
export const SAVE_MOVE_MAGIC = "OHMV1\n";
export const SAVE_MOVE_STATE_KEY = "oh:http-saves";
const CACHE_NAME = "oh-save-move";
const MAX_TRIES = 3;
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const SW_WAIT_MS = 4000;
const BIN = "\u0000bin";
const DATE = "\u0000date";
const VIEWS = {
  Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView,
};

const isLoopback = (hostname) => hostname === "localhost" || hostname === "127.0.0.1";

// --- Reading the packed file ---------------------------------------------------

const decodeRecord = (json, bins) => {
  const walk = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value[DATE] === "number") return new Date(value[DATE]);
    if (typeof value[BIN] === "number") {
      const buffer = bins[value[BIN]];
      if (value.kind === "buffer") return buffer;
      if (value.kind === "blob") return new Blob([buffer], { type: value.type || "" });
      const View = VIEWS[value.kind] ?? Uint8Array;
      return View === DataView ? new DataView(buffer) : new View(buffer);
    }
    const out = {};
    for (const key of Object.keys(value)) out[key] = walk(value[key]);
    return out;
  };
  return walk(JSON.parse(json));
};

// The file's index, and a reader that unpacks one record at a time, so a library
// with a 100 MB map in it is never held twice.
export const openPackedSaves = async (blob) => {
  const head = SAVE_MOVE_MAGIC.length + 4;
  const start = new Uint8Array(await blob.slice(0, head).arrayBuffer());
  if (new TextDecoder().decode(start.slice(0, SAVE_MOVE_MAGIC.length)) !== SAVE_MOVE_MAGIC) throw new Error("not a saves file");
  const indexLength = new DataView(start.buffer).getUint32(SAVE_MOVE_MAGIC.length, true);
  const index = JSON.parse(await blob.slice(head, head + indexLength).text());
  const data = head + indexLength;
  const slice = ([offset, length]) => blob.slice(data + offset, data + offset + length);
  return {
    settings: index.settings ?? {},
    entries: index.entries ?? [],
    read: async (entry) => decodeRecord(
      await slice(entry.json).text(),
      await Promise.all(entry.bins.map((at) => slice(at).arrayBuffer())),
    ),
  };
};

// --- Merging it into this library ----------------------------------------------

const freeId = (wanted, taken) => {
  let next = `${wanted}-moved`;
  let suffix = 2;
  while (taken.has(next)) { next = `${wanted}-moved-${suffix}`; suffix += 1; }
  return next;
};

const sameSave = (a, b) => Boolean(a?.meta?.updatedAt) && a.meta.updatedAt === b?.meta?.updatedAt;

// `db` is idb.js's surface (idbGet, idbGetAllKeys, idbPut, kvGet, kvPut, STORES),
// passed in so this runs under node:test against a stand-in.
export const mergePackedSaves = async (packed, db, storage) => {
  const { STORES } = db;
  const moved = { games: 0, scenarios: 0, others: 0 };
  const scenarioIds = new Set(await db.idbGetAllKeys(STORES.scenarios));
  const gameIds = new Set(await db.idbGetAllKeys(STORES.games));
  const scenarioIdMap = new Map();
  const gameIdMap = new Map();
  const newScenarios = [];
  const newGames = [];
  const manifests = {};
  const byStore = (store) => packed.entries.filter((entry) => entry.store === store);

  for (const entry of byStore("scenarios")) {
    const record = await packed.read(entry);
    if (!record?.id) continue;
    if (scenarioIds.has(record.id)) {
      // The built-in scenario is this build's own, and the same download from
      // the hub is the same scenario: neither is carried a second time.
      if (record.id === DEFAULT_SCENARIO_ID || sameSave(record, await db.idbGet(STORES.scenarios, record.id))) continue;
      const id = freeId(record.id, scenarioIds);
      scenarioIdMap.set(record.id, id);
      record.id = id;
      if (record.meta) record.meta.id = id;
    }
    scenarioIds.add(record.id);
    await db.idbPut(STORES.scenarios, record);
    newScenarios.push(record.id);
    moved.scenarios += 1;
  }

  for (const entry of byStore("games")) {
    const record = await packed.read(entry);
    if (!record?.id) continue;
    const from = record.id;
    if (gameIds.has(record.id)) {
      if (sameSave(record, await db.idbGet(STORES.games, record.id))) continue;
      const id = freeId(record.id, gameIds);
      record.id = id;
      if (record.meta) record.meta.id = id;
    }
    const scenarioId = record.meta?.scenarioId;
    if (scenarioId && scenarioIdMap.has(scenarioId)) record.meta.scenarioId = scenarioIdMap.get(scenarioId);
    gameIdMap.set(from, record.id);
    gameIds.add(record.id);
    await db.idbPut(STORES.games, record);
    newGames.push(record.id);
    moved.games += 1;
  }

  for (const store of ["mapeditorDocs", "basemapMeta", "basemapPayload", "flags"]) {
    if (!STORES[store]) continue;
    const have = new Set(await db.idbGetAllKeys(STORES[store]));
    for (const entry of byStore(store)) {
      const record = await packed.read(entry);
      if (!record?.id || have.has(record.id)) continue;
      await db.idbPut(STORES[store], record);
      moved.others += 1;
    }
  }

  for (const entry of byStore("kv")) {
    const record = await packed.read(entry);
    if (record?.key) manifests[record.key] = record.value;
  }

  // The lists the library is drawn from: what arrived goes after what is here,
  // in the order it had there.
  if (newScenarios.length) {
    const here = await db.kvGet("scenario-manifest", null);
    const order = Array.isArray(here?.order) ? [...here.order] : [DEFAULT_SCENARIO_ID];
    const theirs = (manifests["scenario-manifest"]?.order ?? []).map((id) => scenarioIdMap.get(id) ?? id);
    for (const id of [...theirs, ...newScenarios]) {
      if (newScenarios.includes(id) && !order.includes(id)) order.push(id);
    }
    await db.kvPut("scenario-manifest", { ...(here ?? {}), order, selectedScenarioId: here?.selectedScenarioId ?? DEFAULT_SCENARIO_ID });
  }
  if (newGames.length) {
    const here = await db.kvGet("game-manifest", null);
    const order = Array.isArray(here?.order) ? [...here.order] : [];
    const theirs = (manifests["game-manifest"]?.order ?? []).map((id) => gameIdMap.get(id) ?? id);
    for (const id of [...theirs, ...newGames]) {
      if (newGames.includes(id) && !order.includes(id)) order.push(id);
    }
    // The game they were playing opens again, unless one is being played here.
    const theirActive = gameIdMap.get(manifests["game-manifest"]?.activeGameId);
    const activeGameId = here?.activeGameId || theirActive || "";
    await db.kvPut("game-manifest", { activeGameId, order });
  }
  if (manifests["ui-settings"] && (await db.kvGet("ui-settings", null)) == null) {
    await db.kvPut("ui-settings", manifests["ui-settings"]);
  }

  // Settings and the AI key: only what this address does not have yet.
  let settings = 0;
  for (const [key, value] of Object.entries(packed.settings)) {
    try {
      if (key === SAVE_MOVE_STATE_KEY || typeof value !== "string" || storage.getItem(key) !== null) continue;
      storage.setItem(key, value);
      settings += 1;
    } catch { /* full or closed: the games are what matter */ }
  }
  return { ...moved, settings };
};

// --- The trip ------------------------------------------------------------------

const readState = (storage) => {
  try { return JSON.parse(storage.getItem(SAVE_MOVE_STATE_KEY) || "{}") || {}; } catch { return {}; }
};
const writeState = (storage, state) => {
  try { storage.setItem(SAVE_MOVE_STATE_KEY, JSON.stringify(state)); } catch { /* decided again next visit */ }
};

// Whether to try the trip now. "moved" and "none" are final; a failed or
// unanswered trip is tried again, a few times, hours apart.
export const shouldTryMove = (state, now) => {
  if (state.done) return false;
  if ((state.tries ?? 0) >= MAX_TRIES) return false;
  return !state.at || now - state.at >= RETRY_AFTER_MS;
};

const showNotice = (text) => {
  try {
    const note = document.createElement("div");
    note.setAttribute("role", "status");
    note.textContent = text;
    Object.assign(note.style, {
      position: "fixed", left: "50%", top: "1rem", transform: "translateX(-50%)", zIndex: "2147483000",
      maxWidth: "min(32rem, calc(100vw - 2rem))", padding: "0.75rem 1rem", borderRadius: "12px",
      background: "#1d1d20", color: "#f6f6f7", border: "1px solid rgba(240,240,242,0.29)",
      font: "400 0.9rem/1.45 system-ui, 'Segoe UI', sans-serif", boxShadow: "0 0.75rem 2rem rgba(0,0,0,0.5)",
    });
    note.addEventListener("click", () => note.remove());
    document.body.append(note);
    setTimeout(() => note.remove(), 15000);
  } catch { /* the games are there either way */ }
};

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// The service worker that keeps the posted file must be answering for this page
// before the browser leaves: without it the post would reach the web server.
const receiverReady = async (base) => {
  if (!("serviceWorker" in navigator) || typeof caches === "undefined") return false;
  await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  if (!(await within(navigator.serviceWorker.ready, SW_WAIT_MS))) return false;
  if (!navigator.serviceWorker.controller) {
    await within(new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true })), SW_WAIT_MS);
  }
  if (!navigator.serviceWorker.controller) return false;
  const ping = await fetch(`${base}save-move/ping`, { cache: "no-store" });
  return ping.ok && (await ping.text()).startsWith("oh-save-move");
};

// The address the old library is under, or "" when there is no trip to make.
const senderAddress = async (base, storage) => {
  if (isLoopback(location.hostname)) {
    // Two ports of this machine stand in for the two addresses in tests.
    const from = storage.getItem("oh:save-move-test-from") || "";
    return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(from)
      ? `${from}/save-move/?back=${encodeURIComponent(base)}&to=${encodeURIComponent(location.origin)}`
      : "";
  }
  if (location.protocol !== "https:") return "";
  // Only when the site sends this same path back to http: that is what keeps a
  // browser that upgrades http by itself on the http address, and it is the
  // sign that the http address is being served at all.
  const probe = await fetch("/save-move/", { redirect: "manual", cache: "no-store" });
  if (probe.type !== "opaqueredirect") return "";
  return `http://${location.host}/save-move/?back=${encodeURIComponent(base)}`;
};

// Called before the library is first read. Resolves when the game should go on
// starting; when the browser is leaving for the http address it does not resolve.
export const bringHttpSavesAcross = async ({ base = import.meta.env.BASE_URL, db, storage = localStorage } = {}) => {
  try {
    const state = readState(storage);
    const params = new URLSearchParams(location.search);
    const answer = params.get("saves-moved");
    if (answer) {
      params.delete("saves-moved");
      const query = params.toString();
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    }

    // The file the http page posted, kept by the service worker.
    if (typeof caches !== "undefined" && (answer === "arrived" || await caches.has(CACHE_NAME))) {
      const cache = await caches.open(CACHE_NAME);
      const key = `${base}save-move/payload`;
      const kept = await cache.match(key);
      if (kept) {
        const moved = await mergePackedSaves(await openPackedSaves(await kept.blob()), db, storage);
        await cache.delete(key);
        await caches.delete(CACHE_NAME);
        writeState(storage, { done: "moved", at: Date.now(), ...moved });
        if (moved.games || moved.scenarios || moved.others) {
          showNotice(`Your saved games from before are back: ${count(moved.games, "game", "games")} and ${count(moved.scenarios, "scenario", "scenarios")} were brought across from the site's old address.`);
        }
        return;
      }
    }
    if (answer === "none") { writeState(storage, { done: "none", at: Date.now() }); return; }
    if (answer) { writeState(storage, { ...state, at: Date.now(), last: answer }); return; }

    if (!shouldTryMove(state, Date.now())) return;
    const address = await senderAddress(base, storage);
    if (!address) return;
    if (!(await receiverReady(base))) return;
    writeState(storage, { ...state, tries: (state.tries ?? 0) + 1, at: Date.now() });
    location.replace(address);
    await new Promise((resolve) => setTimeout(resolve, 10000));
  } catch (error) {
    console.warn("Saves from the site's old address were not brought across:", error);
  }
};
