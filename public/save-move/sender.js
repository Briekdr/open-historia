/*! Open Historia — carries a browser's saves from the http address to the https one © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A browser keeps http://openhistoria.com and https://openhistoria.com as two
// sites with two libraries. Players who first came over http had their games
// stored under it; once every http visit was redirected to https they opened an
// empty library, with their games untouched next door.
//
// This page is the half that runs AT THE HTTP ADDRESS, the only place those
// saves can be read. The game on https sends the browser here once
// (src/runtime/web/saveMove.js); this reads the library, packs it into one file
// and posts it, as a form, to the https game, whose service worker
// (public/sw.js) keeps it for the game to unpack. Nothing here is deleted: the
// http library stays as it was.
//
// It imports nothing and is served as it is, so the pack format lives here and
// its reader lives in saveMove.js; saveMove.test.js holds the two together.

export const SAVE_MOVE_MAGIC = "OHMV1\n";
export const SAVE_DB_NAME = "open-historia-web";
// What a library is made of. The lean scenarioMeta/gameMeta rows are rebuilt by
// the game from the records, so they are not carried.
export const SAVE_MOVE_STORES = ["scenarios", "games", "mapeditorDocs", "basemapMeta", "basemapPayload", "flags", "kv"];
const BIN = "\u0000bin";
const DATE = "\u0000date";

// A record as JSON text plus the binary values taken out of it, in order.
export const encodeRecord = (record) => {
  const bins = [];
  const walk = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return { [DATE]: value.getTime() };
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      bins.push(value);
      return { [BIN]: bins.length - 1, kind: "blob", type: value.type || "" };
    }
    if (value instanceof ArrayBuffer) {
      bins.push(value);
      return { [BIN]: bins.length - 1, kind: "buffer" };
    }
    if (ArrayBuffer.isView(value)) {
      bins.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      return { [BIN]: bins.length - 1, kind: value.constructor.name };
    }
    if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : walk(item)));
    const out = {};
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) out[key] = walk(value[key]);
    }
    return out;
  };
  return { json: JSON.stringify(walk(record)), bins };
};

const sizeOf = (part) => (typeof part === "string" ? new TextEncoder().encode(part).byteLength : part.size ?? part.byteLength);

// entries: [{ store, record }]; settings: the page's localStorage as an object.
// The file: the magic, the index's length (4 bytes, little-endian), the index
// (JSON), then every record's text and binaries at the offsets the index gives.
export const packSaves = (entries, settings = {}) => {
  const parts = [];
  let offset = 0;
  const place = (part) => {
    const length = sizeOf(part);
    parts.push(part);
    const at = [offset, length];
    offset += length;
    return at;
  };
  const index = { version: 1, settings, entries: [] };
  for (const { store, record } of entries) {
    const { json, bins } = encodeRecord(record);
    index.entries.push({ store, json: place(json), bins: bins.map(place) });
  }
  const indexText = new TextEncoder().encode(JSON.stringify(index));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, indexText.byteLength, true);
  return new Blob([SAVE_MOVE_MAGIC, length, indexText, ...parts], { type: "application/octet-stream" });
};

const isLoopback = (hostname) => hostname === "localhost" || hostname === "127.0.0.1";

// Where the https game is. On this machine (tests) the two "sites" are two
// ports, and the receiving one is named in ?to=; anywhere else the target is
// always this same host over https, so a link cannot send saves elsewhere.
export const receiverOrigin = (location) => {
  if (isLoopback(location.hostname)) {
    const to = new URLSearchParams(location.search).get("to") || "";
    try {
      const url = new URL(to);
      if (url.protocol === "http:" && isLoopback(url.hostname)) return url.origin;
    } catch { /* fall through */ }
    return "";
  }
  return `https://${location.host}`;
};

// The game's folder on the https site ("/play/"), from ?back=.
export const gameBase = (search) => {
  const back = new URLSearchParams(search).get("back") || "/play/";
  return /^\/(?!\/)[\w\-./]*\/$/.test(back) || back === "/" ? back : "/play/";
};

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// Opens the library without ever creating one where there was none.
const openExisting = () => new Promise((resolve, reject) => {
  const open = indexedDB.open(SAVE_DB_NAME);
  let fresh = false;
  open.onupgradeneeded = () => { fresh = true; open.transaction.abort(); };
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => (fresh ? resolve(null) : reject(open.error));
});

const readLibrary = async () => {
  const db = await openExisting();
  if (!db) return null;
  try {
    const entries = [];
    let games = 0;
    let scenarios = 0;
    let others = 0;
    for (const store of SAVE_MOVE_STORES) {
      if (!db.objectStoreNames.contains(store)) continue;
      const records = await request(db.transaction(store).objectStore(store).getAll());
      for (const record of records) {
        if (store === "kv" && !["game-manifest", "scenario-manifest", "ui-settings"].includes(record?.key)) continue;
        entries.push({ store, record });
        if (store === "games") games += 1;
        else if (store === "scenarios") scenarios += 1;
        else if (store !== "kv") others += 1;
      }
    }
    return { entries, games, scenarios, others };
  } finally {
    db.close();
  }
};

const readSettings = () => {
  const settings = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      // The diagnostics log is big and belongs to this address's own sessions.
      if (key.startsWith("oh_debug_log") || value.length > 200000) continue;
      settings[key] = value;
    }
  } catch { /* storage closed to this page: the games still go */ }
  return settings;
};

const run = async () => {
  const target = receiverOrigin(location);
  const base = gameBase(location.search);
  const back = (state) => { location.replace(`${target || location.origin}${base}?saves-moved=${state}`); };
  // Reached over https: the http address is not being served, so there is
  // nothing this page can read. The game is told, and tries another day.
  if (location.protocol !== "http:" || !target) { back("unreachable"); return; }
  try {
    const library = await readLibrary();
    // A library with nothing of the player's in it: only the built-in scenario.
    if (!library || (library.games === 0 && library.scenarios <= 1 && library.others === 0)) { back("none"); return; }
    const file = new File([packSaves(library.entries, readSettings())], "open-historia-saves.bin", { type: "application/octet-stream" });
    const form = document.createElement("form");
    form.method = "POST";
    form.enctype = "multipart/form-data";
    form.action = `${target}${base}save-move/receive`;
    const input = document.createElement("input");
    input.type = "file";
    input.name = "saves";
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    form.hidden = true;
    form.append(input);
    document.body.append(form);
    form.submit();
  } catch (error) {
    console.error("The saves could not be read:", error);
    back("failed");
  }
};

if (typeof document !== "undefined" && document.documentElement?.dataset?.saveMove === "sender") run();
