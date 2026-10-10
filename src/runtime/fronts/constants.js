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

// ---- the engine's numbers ------------------------------------------------------
// One name a number, so the rig can tune them. Lengths are kilometres or cells
// as the name says; a day is a game day.

// The ground. A region type's speed is held to this range; 0 is impassable.
export const TERRAIN_SPEED_MIN = 0.2;
export const TERRAIN_SPEED_MAX = 2;
// How much slow ground helps whoever defends it: half-speed ground is worth
// 1 + 0.5 * this in defence.
export const TERRAIN_DEFENCE_GAIN = 1.25;

// The field. A cell far from the line holds this distance, with its side's sign.
export const FAR_CELLS = 8;
// A new line is placed from this many samples a cell, each way.
export const SUPERSAMPLE = 4;
// How far past a shape's edge an edit writes distances, and after a day's edits
// how far round a changed cell distances are worked out again, and how far a
// cell looks for the line before it is simply far.
export const EDIT_MARGIN_CELLS = 2;
export const REDISTANCE_NEAR_CELLS = 2;
export const REDISTANCE_REACH_CELLS = 4;
// What another writer's change to the map does to the field: a region the world
// gives to a side that holds less than this share of it is repainted.
export const REPAINT_BELOW = 0.4;
// The frame grows when the line comes this near its edge, by this much.
export const GROW_WITHIN_CELLS = 6;
export const GROW_KM = 400;
// The drawn line: how far a vertex may be left out of it, in cells.
export const LINE_SIMPLIFY_CELLS = 0.04;
// A stretch is marked as pushed where a troop swept ground this near it that day.
export const PUSHED_WITHIN_CELLS = 2;

// A troop. Each list is by kind, in the order of TROOP_KINDS.
// How far to either side of its path the ground becomes its side's: this many
// kilometres at full strength, less as it weakens, never under the least.
export const CONTROL_RADIUS_KM = Object.freeze([14, 12, 10]);
export const CONTROL_RADIUS_AT_NOTHING = 0.6;
export const CONTROL_RADIUS_MIN_CELLS = 0.9;
// How far it fights.
export const REACH_KM = 40;
export const REACH_MIN_CELLS = 4;
// Two neighbours within this many radii of each other advance as one line.
export const LINK_RADII = 4.5;
// Where it stands behind the line, and how near its station counts as in line.
export const STATION_BEHIND_RADII = 0.8;
export const IN_LINE_RADII = 1.5;
export const TROOP_ATTACK = Object.freeze([1.0, 1.6, 1.2]);
export const TROOP_DEFENCE = Object.freeze([1.2, 1.0, 0.8]);
// A troop that cannot get nearer its station for this many days is carried round.
export const STUCK_DAYS = 3;
// A day's march to a station is walked in legs of this many cells, at most this many.
export const MARCH_LEG_CELLS = 2;
export const MARCH_LEGS_MAX = 24;

// Raising troops. The heavier side has TROOPS_BASE + a counter for every
// TROOPS_KM_EACH of line; the other in proportion, never under TROOPS_MIN.
export const TROOPS_BASE = 12;
export const TROOPS_KM_EACH = 25;
export const TROOPS_MIN = 6;
export const POOL_PER_TROOP = 30;
export const EFFORT_FACTORS = Object.freeze({ token: 0.4, limited: 0.7, major: 1, total: 1.4 });
// The share of a side that is armour (cavalry before the tank) and artillery,
// by era: before 1500, 1500 to 1849, 1850 to 1944, from 1945.
export const ARMOUR_SHARE_BY_ERA = Object.freeze([0.15, 0.15, 0.1, 0.3]);
export const ARTILLERY_SHARE_BY_ERA = Object.freeze([0.1, 0.1, 0.15, 0.15]);
export const QUALITY_MIN = 0.5;
export const QUALITY_MAX = 1.5;
// A formation of the world's this near the line is taken into the battlefield.
export const NAMED_WITHIN_KM = 250;
// Reserves, as the brief words them: ample from this much a counter.
export const RESERVES_AMPLE_PER_TROOP = 15;

// Standing orders, as weight along the line. 1 where nothing is ordered.
export const WEIGHT_ADVANCE = 1.5;
export const WEIGHT_BLITZ = 4;
// A spearhead's peak over 1, and how wide it is; an encirclement's two peaks
// stand this far either side of the point nearest the objective, or a third of
// the line if that is less.
export const SPEARHEAD_PEAK = 8;
export const SPEARHEAD_WIDTH_KM = 60;
export const ENCIRCLE_APART_KM = 120;
export const ENCIRCLE_APART_SHARE = 1 / 3;
// A blitz steps off once this share of the troops stationed on its sector are in line.
export const BLITZ_READY_SHARE = 0.8;
export const FALL_BACK_KM_PER_DAY = 15;
export const FALL_BACK_MAX_KM = 150;
export const ATTACK_LAPSE_DAYS = 120;
// A sector named for a place is the line within this far of the point nearest it.
export const PLACE_SECTOR_KM = 60;
// A compass axis gives sector names when the line's extent along it is this
// share of its largest.
export const SECTOR_AXIS_SHARE = 0.35;

// The fight. Below RATIO_NEEDED to 1 nothing moves; GAIN scales what a better
// ratio earns, so that 2 to 1 on foot is about 5 km a day and 3 to 1 with
// armour about 20 in the modern era.
export const RATIO_NEEDED = 1.15;
export const RATIO_SOFTNESS = 2;
export const GAIN = 0.9;
export const SUBSTEPS_MAX = 32;
// A troop made to give way loses this for every 10 km; one that cannot, this a day.
export const RETREAT_LOSS = 1.5;
export const PINNED_LOSS = 8;
// A troop on the other side's ground with none of its own within this is overrun.
export const OVERRUN_CELLS = 6;
// Percent of strength a day in a fight at even odds, held between these ratios;
// a quiet stretch in contact costs this share of it.
export const ATTRITION = 0.6;
export const ATTRITION_RATIO_MIN = 0.3;
export const ATTRITION_RATIO_MAX = 3;
export const QUIET_ATTRITION = 0.1;
export const DIG_PER_DAY_HOLD = 0.04;
export const DIG_MAX_HOLD = 0.5;
export const DIG_PER_DAY_DIG_IN = 0.08;
export const DIG_MAX_DIG_IN = 1;
// A troop that moved more than this in a day has left its works behind.
export const DIG_LOST_KM = 2;
export const REINFORCE_PER_DAY = 1;

// Steering: what bends a troop's step away from the bare direction of its
// order, each as a weight on a unit vector.
export const STEER_BASE = 1;
export const STEER_RESISTANCE = 0.6;
export const STEER_PRIZE = 0.5;
export const STEER_GROUND = 0.4;
export const STEER_ROOM = 0.3;
export const STEER_WANDER = 0.25;
// How much of yesterday's heading is kept, and how far off its base direction
// a heading may come (the cosine of about 75 degrees).
export const STEER_INERTIA = 0.65;
export const STEER_LEAST_FORWARD = 0.26;
export const STEER_RESISTANCE_RADII = 3;
export const STEER_PRIZE_KM = 80;
export const STEER_PRIZE_CONE = 0.5;
export const STEER_ROOM_RADII = 0.8;
export const WANDER_DAYS = 6;
// The points of a 16-gon, written out so that no step of a day needs a sine.
export const COMPASS_16 = Object.freeze([
  1, 0, 0.9238795325112867, 0.3826834323650898, 0.7071067811865476, 0.7071067811865476, 0.3826834323650898, 0.9238795325112867,
  0, 1, -0.3826834323650898, 0.9238795325112867, -0.7071067811865476, 0.7071067811865476, -0.9238795325112867, 0.3826834323650898,
  -1, 0, -0.9238795325112867, -0.3826834323650898, -0.7071067811865476, -0.7071067811865476, -0.3826834323650898, -0.9238795325112867,
  0, -1, 0.3826834323650898, -0.9238795325112867, 0.7071067811865476, -0.7071067811865476, 0.9238795325112867, -0.3826834323650898,
]);
// What a step blocked by a wall tries instead: its heading turned by 30, -30,
// 60, -60, 90 and -90 degrees, as cosine and sine.
export const TURNS = Object.freeze([
  0.8660254037844387, 0.5, 0.8660254037844387, -0.5,
  0.5, 0.8660254037844387, 0.5, -0.8660254037844387,
  0, 1, 0, -1,
]);

// Supply, worked out every so many days: full within this far of a source by
// era, falling to the least at SUPPLY_FAR_FACTOR times that.
export const SUPPLY_EVERY_DAYS = 3;
export const SUPPLY_FULL_KM = Object.freeze([120, 180, 300, 450]);
export const SUPPLY_FAR_FACTOR = 2.5;
export const SUPPLY_LEAST = 0.4;
// A body of ground cut off from every source.
export const POCKET_DAYS = 10;
export const POCKET_LOSS = 4;
export const POCKET_DEFENCE = 0.5;
// A cut-off piece of a side's own country still feeds itself if it is this
// share of all of its own country that the side holds here.
export const SOURCE_MIN_SHARE = 0.2;

// A region changes hands when the side that does not control it holds this share.
export const FLIP_AT = 0.6;
export const MIN_DAYS_BETWEEN_FLIPS = 3;
// Whose troops are near a region, to say which ally takes it.
export const CAPTOR_WITHIN_KM = 150;

// Results the story may state.
export const CAPTURED_LOSS = 0.3;
export const CAPTURED_COLUMN = 3;
export const CAPTURED_CITY_CELLS = 2;
export const BREAKTHROUGH_KM = 80;
export const BREAKTHROUGH_LOSS = 0.5;
export const REPULSED_LOSS = 0.25;
export const HALT_DAYS = 14;
export const COLLAPSE_LEFT = 0.2;
export const LANDING_CELLS = 2;
export const LANDING_TROOPS = 4;

// Opening a battlefield: the frame is the box round every region of either
// side this near the contact, with this margin.
export const CONTACT_WITHIN_KM = 1200;
export const FRAME_MARGIN_KM = 100;

export const BRIEF_TEXT_MAX = 700;
