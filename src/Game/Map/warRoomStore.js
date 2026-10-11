/*! Open Historia — the war room: what its panel and the map share © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war room is two things on the screen at once: a drawer with the generals
// in it (GameUI/warRoom.jsx) and the map beside it, on which troops are picked
// out and ways are drawn (WarRoomTools.jsx, WarRoomLayers.jsx). They are in
// different parts of the tree, so what they share is kept here, outside React:
// which battlefield is open, which tool is in hand, which troops are picked,
// which general's troops are lit, and the plans to draw.
//
// Nothing here is saved, and nothing here writes the game: a way that has been
// drawn is handed to whoever is listening (onWay), which is the panel.

import { useSyncExternalStore } from "react";

// The tools of the war room's map. "pan" is the map as it always is.
//   select     drag a box round troops to pick them out
//   route      draw the way the troops picked out are to take
//   diversion  draw a movement to be stolen and never made
//   replan     draw a Board operation's arrow anew (`replan` holds which)
export const WAR_ROOM_TOOLS = Object.freeze(["pan", "select", "route", "diversion", "replan"]);

const CLOSED = Object.freeze({
  open: false,
  // The battlefield shown, by name, and which side of it is the player's.
  battlefield: "",
  side: -1,
  tool: "pan",
  // The player's troops picked out, by their places in the record's list.
  selected: Object.freeze([]),
  // The general whose troops are lit (his command), or -1.
  highlight: -1,
  // The Board operation whose arrow is being redrawn, by its id.
  replan: "",
  // The plan the panel points at, by its id, so the map can show which it is.
  pointed: "",
  // What the map draws: the player's own planned movements and what is known
  // of the other side's (runtime/fronts/plans.js plansOf / knownPlans).
  plans: Object.freeze([]),
  known: Object.freeze([]),
  // How far the drawer covers the map from the right, in px, so that a
  // battlefield is fitted into what is left of it.
  cover: 0,
  // And how far the tool rail covers it from the left (GameUI/warRoomRail.jsx).
  rail: 0,
  // Raised whenever the panel wants the battlefield fitted on the map again.
  fit: 0,
});

let state = CLOSED;
const listeners = new Set();
const emit = () => {
  for (const listener of [...listeners]) listener();
};

export const getWarRoom = () => state;
export const subscribeWarRoom = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const sameList = (a, b) => a === b || (a.length === b.length && a.every((value, index) => value === b[index]));

// Changes what is shared. A value equal to the one there changes nothing, so a
// caller may set what it has on every render.
export const setWarRoom = (patch) => {
  let next = state;
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!(key in CLOSED)) continue;
    const before = next[key];
    if (before === value || (Array.isArray(before) && Array.isArray(value) && sameList(before, value))) continue;
    if (next === state) next = { ...state };
    next[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  if (next === state) return;
  state = Object.freeze(next);
  emit();
};

export const openWarRoom = (battlefield, side) => setWarRoom({ open: true, battlefield, side, tool: "pan", selected: [], highlight: -1, replan: "", pointed: "", fit: state.fit + 1 });
export const closeWarRoom = () => {
  if (state === CLOSED) return;
  state = CLOSED;
  emit();
};

// Which battlefield is shown: what was picked out on the last one is put down.
export const showBattlefield = (battlefield, side) => {
  if (state.battlefield === battlefield && state.side === side) return;
  setWarRoom({ battlefield, side, tool: "pan", selected: [], highlight: -1, replan: "", pointed: "", plans: [], known: [], fit: state.fit + 1 });
};

// The tool in hand. Taking up the one already in hand puts it down.
export const takeTool = (tool, { replan = "" } = {}) => {
  if (!WAR_ROOM_TOOLS.includes(tool)) return;
  const same = state.tool === tool && (tool !== "replan" || state.replan === replan);
  setWarRoom({ tool: same ? "pan" : tool, replan: !same && tool === "replan" ? replan : "" });
};

export const useWarRoom = (select = (value) => value) => useSyncExternalStore(subscribeWarRoom, () => select(state), () => select(CLOSED));

// ---- a way that was drawn -------------------------------------------------------------

// Who is told when a way has been drawn on the map: (tool, way, { replan }),
// `way` as [lng, lat] points. One listener: the war room's panel.
let wayListener = null;
export const onWarRoomWay = (listener) => {
  wayListener = listener;
  return () => {
    if (wayListener === listener) wayListener = null;
  };
};
export const reportWarRoomWay = (tool, way, extra = {}) => {
  try {
    wayListener?.(tool, way, extra);
  } catch (error) {
    console.error("the war room could not take the way that was drawn:", error);
  }
};
