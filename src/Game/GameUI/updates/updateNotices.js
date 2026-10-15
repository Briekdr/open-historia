/*! Open Historia — which update notices to show © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The notice behind the vault door (UpdateNotice.jsx, notes.js) shows each
// update once a device: the id of the newest update shown is kept in
// localStorage, and the updates above it in the list are new. One that missed
// several is shown all of them, newest first (at most UPDATES_SHOWN_MOST); one
// whose kept id is not in the list at all, or that has none (a first opening),
// is shown the newest and those released within FIRST_LOOK_DAYS of it (so the
// music, released before there was a notice to tell of it, is told with the
// update after it). Opening the game with ?updateNotice=<id> (or "latest")
// shows that update whatever is kept, and keeps nothing: for whoever is making
// one.
//
// Pure but for the storage, which is handed in; no React.

import { UPDATES } from "./notes.js";

export const UPDATE_NOTE_KEY = "oh-update-note-seen";
export const UPDATE_NOTICE_PARAM = "updateNotice";
export const UPDATES_SHOWN_MOST = 4;
export const FIRST_LOOK_DAYS = 30;

// Days from one "YYYY-MM-DD" to another, or Infinity where either cannot be read.
const daysBetween = (from, to) => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(b - a) / 86400000 : Infinity;
};

const browserStorage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

// The id of the newest update shown on this device, or null.
export const seenUpdate = (storage = browserStorage()) => {
  try {
    return storage?.getItem(UPDATE_NOTE_KEY) || null;
  } catch {
    return null;
  }
};

// Kept once its notice is closed: it is not shown again.
export const rememberUpdate = (id, storage = browserStorage()) => {
  try {
    if (id) storage?.setItem(UPDATE_NOTE_KEY, String(id));
  } catch {
    // Not kept: shown again the next time the game opens.
  }
};

// The updates to show at this opening, newest first ([] for none).
export const pendingUpdates = ({ updates = UPDATES, seen = seenUpdate() } = {}) => {
  if (updates.length === 0) return [];
  const at = seen ? updates.findIndex((update) => update.id === seen) : -1;
  if (at === 0) return [];
  if (at < 0) return updates.filter((update, index) => index === 0 || daysBetween(update.date, updates[0].date) <= FIRST_LOOK_DAYS).slice(0, UPDATES_SHOWN_MOST);
  return updates.slice(0, Math.min(at, UPDATES_SHOWN_MOST));
};

// The update a preview asks for (?updateNotice=<id> or latest), as a list, or null for none asked.
export const previewedUpdates = (search = "", updates = UPDATES) => {
  let wanted = "";
  try {
    wanted = new URLSearchParams(search).get(UPDATE_NOTICE_PARAM) || "";
  } catch {
    wanted = "";
  }
  if (!wanted) return null;
  const update = wanted === "latest" ? updates[0] : updates.find((entry) => entry.id === wanted);
  return update ? [update] : null;
};

// The pages of a notice: every banner of every update in it, each with its update.
export const noticePages = (updates = []) => updates.flatMap((update) => (Array.isArray(update.banners) ? update.banners : [])
  .map((banner, index) => ({ key: `${update.id}#${index}`, update, banner })));
