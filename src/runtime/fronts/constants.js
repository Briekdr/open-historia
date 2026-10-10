/*! Open Historia — battlefields and fronts: limits and vocabulary © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A battlefield is where a land war is fought: two sides, the troops each has
// on it, and the front line between what each holds. The line is free: it runs
// anywhere, through the middle of a region if that is where the fighting is,
// and moves by kilometres a day. The regions keep their shapes.
//
//   world.battlefields  [ record ]      like world.wars; see record.js
//
// These are the limits every part agrees on (the saved record, the engine, the
// map) and the words an order is written in. Import-free on purpose: the server
// re-keys a renamed country's battlefields, and server code never imports src/.

export const BATTLEFIELD_VERSION = 1;

// How much of it a world may hold. A battlefield rides in world.json, which is
// written whole and copied into every restore point.
export const MAX_BATTLEFIELDS = 12;
export const MAX_CLOSED_BATTLEFIELDS = 4;
export const MAX_BATTLEFIELDS_CHARS = 160000;
export const BATTLEFIELD_NAME_MAX = 80;

// A side is the countries (or groups) fighting together on it.
export const MAX_SIDE_MEMBERS = 8;
export const MAX_TROOPS_PER_SIDE = 96;
export const MAX_NAMED_TROOPS = 64;
export const MAX_ORDERS_PER_SIDE = 6;

// The grid the engine keeps its books on. It is never drawn: the line the
// player sees is traced between the cells' centres, to a fraction of a cell.
export const MAX_CELLS = 48000;
export const MAX_GRID_SPAN = 255;
export const CELL_STEPS_KM = Object.freeze([4, 6, 8, 12, 16, 24, 32, 48, 64, 96]);

// Who holds a cell.
export const HOLDER_SIDE_A = 0;
export const HOLDER_SIDE_B = 1;
export const HOLDER_WALL = 2; // sea, a country outside the war, impassable ground, out of the frame

// The distance to the line is kept only for the cells this near to one held by
// the other side, in steps of 1/32 of a cell.
export const BAND_CELLS = 3;
export const BAND_UNITS = 32;

// A troop's place is kept to 1/16 of a cell, a vertex of the drawn line to 1/32.
export const TROOP_UNITS = 16;
export const LINE_UNITS = 32;

// The moments of the last run the map can move between, the first being the
// state it began from.
export const MAX_FRAMES = 5;
export const MAX_CONTESTED_REGIONS = 160;
export const MAX_LOG_ENTRIES = 12;
export const LOG_TEXT_MAX = 160;

export const BATTLEFIELD_STATUSES = Object.freeze(["active", "frozen", "closed"]);
export const TROOP_KINDS = Object.freeze(["infantry", "armor", "artillery"]);
export const TROOP_STATES = Object.freeze(["holding", "advancing", "encircled", "spent"]);

// What a side can be told to do on a stretch of the line, and what the story
// may say came of it. These are the words an order is written in.
export const FRONT_ORDERS = Object.freeze(["advance", "blitz", "spearhead", "encircle", "hold", "dig in", "fall back", "land"]);
export const FRONT_RESULTS = Object.freeze(["breakthrough", "captured", "repulsed", "stalemate", "collapse", "surrender"]);
export const FRONT_EFFORTS = Object.freeze(["token", "limited", "major", "total"]);
export const DEFAULT_EFFORT = "major";
export const DEFAULT_ORDER = "hold";

// How a stretch of the drawn line is marked, a vertex at a time.
export const LINE_QUIET = 0; // where it stood when the battlefield opened
export const LINE_MOVED = 1; // moved since, still now
export const LINE_PUSHED_BY_A = 2;
export const LINE_PUSHED_BY_B = 3;
