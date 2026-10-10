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
// Hundreds a side: a front is to be thick with troops, close together.
export const MAX_TROOPS_PER_SIDE = 400;
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

// "standing" is a border fortified in peace: troops deployed along it and dug
// in, with no war behind it. Nothing fights there until a war begins.
export const BATTLEFIELD_STATUSES = Object.freeze(["active", "frozen", "closed", "standing"]);
export const TROOP_KINDS = Object.freeze(["infantry", "armor", "artillery"]);
// "dug in" is a stance, not a pause: a troop told to hold a defence digs in,
// fights the stronger for it, and does not move at all while it is so.
export const TROOP_STATES = Object.freeze(["holding", "advancing", "encircled", "spent", "dug in"]);

// What a side can be told to do on a stretch of the line, and what the story
// may say came of it. These are the words an order is written in.
// "assault" is the one order that names WHAT is attacked and not where the
// line is pushed: a city, a structure, or a formation of the other side. The
// troops it takes are sent at that directly, from wherever they are.
export const FRONT_ORDERS = Object.freeze(["advance", "blitz", "spearhead", "encircle", "hold", "dig in", "fall back", "land", "flank", "assault"]);
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

// A troop. Each list is by kind, in the order of TROOP_KINDS.
// How far to either side of its path the ground becomes its side's. It is one
// figure for a whole side, worked out once a run from how close its troops
// stand: this share of the length of line each has, held between two bounds,
// so that a troop among hundreds paints a strip and not a province. Never
// under the least in cells: a brush narrower than a cell paints nothing.
export const CONTROL_RADIUS_OF_SPACING = 0.9;
export const CONTROL_RADIUS_MIN_KM = 6;
export const CONTROL_RADIUS_MAX_KM = 16;
export const CONTROL_RADIUS_MIN_CELLS = 0.9;
// How far it fights.
export const REACH_KM = 40;
export const REACH_MIN_CELLS = 4;
// Two neighbours within this many radii of each other advance as one line.
export const LINK_RADII = 4.5;
// How far behind the line it stands when it is not attacking, by kind, before
// its own depth is applied; and how far along the line from its ideal place
// still counts as in place, in control radii.
export const STAND_OFF_KM = Object.freeze([8, 8, 16]);
export const IN_PLACE_RADII = 1.5;
// A troop not attacking walks up to its stand-off only from further back than
// this: twice its stand-off, and never less than this many control radii. One
// that has just carved its way forward stands a radius behind its own line,
// and is to stay there.
export const STAND_OFF_FAR = 2;
export const STAND_OFF_FAR_RADII = 1.5;
export const TROOP_ATTACK = Object.freeze([1.0, 1.6, 1.2]);
export const TROOP_DEFENCE = Object.freeze([1.2, 1.0, 0.8]);
// A troop that cannot get nearer where it is going for this many days is carried round.
export const STUCK_DAYS = 3;
// A day's march is walked in legs of this many cells, at most this many.
export const MARCH_LEG_CELLS = 2;
export const MARCH_LEGS_MAX = 24;

// Every troop is its own: what it draws for a run, each between two values.
// Its drive multiplies its step forward, its depth its stand-off behind the
// line, its lane shifts its place along the line by that share of the gap to
// its neighbours, and its lag is the days it takes to set off under a new
// attack order (one of the list).
export const TRAIT_DRIVE = Object.freeze([0.7, 1.35]);
export const TRAIT_DEPTH = Object.freeze([0.4, 1.8]);
export const TRAIT_LANE = Object.freeze([-0.45, 0.45]);
export const TRAIT_LAG_DAYS = Object.freeze([0, 0, 1, 1, 2]);
// Neighbours are never placed nearer than this share of the gap between places.
export const LANE_GAP_MIN = 0.35;
// A troop drifts along the line toward its ideal place by this share of its day's advance.
export const DRIFT_SHARE = 0.25;
// How far the line is looked for round a troop, in cells, before the nearest
// vertex of its own body's line is taken instead.
export const FOOT_REACH_CELLS = 6;
// Under a plain advance a troop waits when it is this many control radii
// further forward than its nearer neighbour in the line.
export const ADVANCE_AHEAD_RADII = 4;
// A heading turns by at most this in a day (the cosine of 45 degrees), and by
// less the less the troop walked the day before: a full turn takes a walk of
// TURN_WALK_RADII control radii, and a troop that barely moved turns by
// TURN_LEAST of it. That is what keeps a slow troop's path from curling.
// An attacking troop keeps to the axis it set off on where the line beside it
// faces more than 60 degrees away from it (the cosine of that angle).
export const AXIS_KEPT_COS = 0.5;
export const TURN_MOST_COS = 0.7071067811865476;
export const TURN_WALK_RADII = 1;
export const TURN_LEAST = 0.15;
// A troop gives way when a step's sweep comes within this of where it stands, in cells.
export const GIVE_WAY_MARGIN_CELLS = 0.25;
// Flanking. A defender with attackers in reach in separated directions (the
// directions to two of them more than a right angle apart) defends at the
// first of these; with two on opposite sides of it (the cosine between them
// under FLANK_OPPOSITE_COS), at the second. And works dug facing the enemy
// count only against an attacker in front of them.
// A flank takes the wing with fewer defenders within this many control radii of its way.
export const FLANK_OPEN_RADII = 3;
export const FLANKED_DEFENCE = 0.75;
export const SURROUNDED_DEFENCE = 0.55;
export const FLANK_OPPOSITE_COS = -0.7;
// An attacker has come round a defender when it is this far past the
// defender's front (the cosine of the angle off the way the defender faces).
export const FLANK_BEHIND_COS = -0.2;

// Raising troops. A side is sized by its own strength and by nothing else:
// this many counters for each point of strength its members bring here (a
// great power brings about 24, a small state one or two), scaled by the effort
// it is making. Never under TROOPS_MIN, and never more than one for every
// TROOPS_LINE_KM_EACH of line, which is what keeps a short front from being
// stacked. What the count cannot carry of a side's strength its quality does.
export const TROOPS_PER_STRENGTH = 12;
export const TROOPS_LINE_KM_EACH = 1.5;
export const TROOPS_MIN = 6;
export const POOL_PER_TROOP = 30;
export const EFFORT_FACTORS = Object.freeze({ token: 0.3, limited: 0.6, major: 1, total: 1.4 });
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
// A body of ground cut off from every source. With none of its side's troops
// in it and under this many square kilometres it is a patch, filled the day
// the ring closes. Anything else is a pocket, fought for like any other ground
// but at a disadvantage: its troops attack and defend at these shares of their
// power and waste away by this much a day, and it gives up after this many
// days, or once no troop is left in it.
export const PATCH_MAX_KM2 = 1500;
export const POCKET_DAYS = 10;
export const POCKET_LOSS = 2;
export const POCKET_ATTACK = 0.7;
export const POCKET_DEFENCE = 0.75;
// A siege: a side told to encircle a place takes the ground round it and
// leaves the place itself, this far round it. What is shut in there is
// besieged: it is never filled as a patch, holds this many days, and wastes
// this much a day.
export const SIEGE_SPARE_KM = 20;
export const SIEGE_DAYS = 45;
export const SIEGE_LOSS = 1;

// A region changes hands in name when the side that does not hold it holds
// more than this share of it: for the game, at once; on the map, not yet.
export const FLIP_AT = 0.6;
export const MIN_DAYS_BETWEEN_FLIPS = 3;
// On the map it changes hands only when the whole of it is held. A side that
// holds this share of a region is given the rest of it at night, if nobody of
// the other side's stands there and the rest is under the size of a pocket: a
// strip of cells along an edge is not to keep a region from ever being whole.
export const WHOLE_AT = 0.95;
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

// ---- how troops move -----------------------------------------------------------
// An attack order is a WAY for a group: a run of legs, each a direction and the
// line across the leg's end. Every troop of the group has its own place across
// the way (its slot) and its own share of the last leg to go (its stop), so a
// group ends spread along the ground it took and nobody gathers at a point.

// How broad a group goes: a rank this many brushes a troop, never under the
// least, and never much wider than the group already stands.
export const GROUP_BREADTH_MIN_KM = 40;
export const GROUP_BREADTH_BRUSHES = 1.5;
export const GROUP_BREADTH_OF_EXTENT = 1.2;
// A spearhead: its point is the leading third, across three quarters of this
// breadth, each stopping up to three tenths short of the way's end; the rest
// are its shoulders, out to the side they began on, stopping between a quarter
// and nine tenths of the way by how far back they began.
export const SPEARHEAD_BREADTH_KM = 70;
export const POINT_BREADTH = 0.75;
export const POINT_STOPS_SHORT = 0.3;
export const SHOULDER_STOPS = Object.freeze([0.25, 0.9]);
export const SHOULDER_OUT = 0.3;
export const SHOULDER_OUT_KM = Object.freeze([8, 30]);
// A column that goes round (a flank, each arm of an encirclement): this broad,
// and this far out from what it goes round. A blitz is a rank half as broad,
// that waits these days to mass and then goes this much faster.
export const COLUMN_BREADTH_KM = 28;
export const ROUND_KM = 34;
export const BLITZ_BREADTH = 0.5;
export const BLITZ_MASS_DAYS = 4;
export const BLITZ_PACE = 1.3;
// With no objective a way runs straight out for this many days of advance at
// least; one found over the ground is kept to this many legs.
export const WAY_DAYS_MIN = 10;
export const WAY_LEGS_MAX = 3;
export const WAY_BEND_CELLS = 3;

// Under an order a troop wants: its leg's direction; a slide toward its slot,
// full from this far off and never more than this much of its step; away from
// where the defenders in front of it are thick; and a slow drift of its own.
export const SLOT_SLIDE_KM = 30;
export const SLOT_SLIDE_MOST = 0.7;
export const STEER_PRESS = 0.3;
export const STEER_PRESS_KM = 35;
export const STEER_DRIFT = 0.15;
export const DRIFT_DAYS = 5;
// It turns by degrees: this much of yesterday's heading is kept, it turns by no
// more than 30 degrees in a day (cosine and sine), 45 closing on a pocket, and
// at least this much of its step is along its way.
export const HEADING_KEPT = 0.7;
export const HEADING_KEPT_CLOSING = 0.5;
export const TURN_COS = 0.8660254037844387;
export const TURN_SIN = 0.5;
export const TURN_CLOSING = 0.7071067811865476;
export const WAY_LEAST = 0.2;
// Crowding only eases it aside, across its way: by this at most, or this share
// of its step. Those within this many brushes of it crowd it.
export const EASE_KM = 2.5;
export const EASE_SHARE = 0.2;
export const ROOM_BRUSHES = 1.25;

// With no order a troop moves only when it must. Driven off its ground, or
// with the other side's ground nearer than this share of its depth, it picks
// one place to fall back to (its own ground, this many depths from the other
// side's, within this far) and goes straight there at this pace. Left behind
// by its own line by more than this many depths it comes up, to within this
// many. With fighting this near along its own ground it slides toward it.
export const HOLD_TOO_NEAR = 0.45;
export const HOLD_BACK_TO = 1.1;
export const FALL_BACK_SEARCH_KM = 64;
export const FALL_BACK_PACE_KM = 26;
export const COME_UP_FROM = 3.5;
export const COME_UP_TO = 2;
export const COME_UP_KM = 7;
export const SLIDE_KM = 6;
export const SLIDE_HEARS_KM = 110;
export const SLIDE_NEAR_KM = 30;
export const SLIDE_FAR_KM = 75;
export const SLIDE_BAND = Object.freeze([0.8, 3.5]);
export const SLIDE_LEAST_DEPTH = 0.7;
// On the other side's ground with nowhere to fall back to, it is taken after this many days.
export const STRANDED_DAYS = 2;

// Dug in: stronger in defence, cheaper to hold, and it does not move at all.
// Thrown out of its works when the ground under it is lost, at this cost.
export const DUG_IN_DEFENCE = 1.6;
export const DUG_IN_LOSS = 0.55;
export const THROWN_OUT_LOSS = 15;

// Ground to be closed on draws in the nearest troops, whatever they are at: one
// for every stretch of its rim and one more for every so much strength in it,
// between a least and a most. From this near if they are under an order, or
// free; from this far if those are not enough. Not one under this strength,
// nor one that came out of a pocket within these days, or gave an attempt up.
export const CLOSE_RIM_KM = 22;
export const CLOSE_STRENGTH = 160;
export const CLOSE_LEAST = 3;
export const CLOSE_MOST = 16;
export const CLOSE_NEAR_KM = Object.freeze([60, 35]);
export const CLOSE_FAR_KM = Object.freeze([150, 80]);
export const CLOSE_UNDER_STRENGTH = 30;
export const CLOSE_REST_DAYS = 3;
export const CLOSE_GIVEN_UP_DAYS = 6;
export const CLOSE_WORN = 24;
// One closing on a pocket leaves it alone from this far off (free, or under an order).
export const CLOSE_LEAVES_KM = Object.freeze([160, 90]);
// How far apart those closing on a pocket come at it from, as the cosine of
// the angle between two of them, by how many it wants (3 to 16).
export const CLOSE_APART_COS = Object.freeze([0.309, 0.5878, 0.729, 0.809, 0.8584, 0.891, 0.9135, 0.9298, 0.9418, 0.9511, 0.9582, 0.964, 0.9686, 0.9724]);
// Those closing on it wear a cut-off troop this much faster; what is left of
// one under this strength, with the other side upon it, gives up.
export const CLOSE_WEAR = 1.8;
export const GIVES_UP_UNDER = 14;
// A cut-off troop tries to break out to its own side's supplied ground when
// that is within this far, for this many days, and then holds for this many.
export const BREAK_OUT_KM = 55;
export const BREAK_OUT_DAYS = 4;
export const BREAK_OUT_REST_DAYS = 7;
// A scrap of cut-off ground under this size with troops on it is overrun at
// once; so is a small pocket with this many times its strength closing on it
// and within this far of it. Those in it get away, at this cost, if their own
// side's ground is within this far. An empty pocket under this size gives up.
export const SCRAP_KM2 = 400;
export const OVERRUN_ODDS = 4;
export const OVERRUN_WITHIN_KM = 14;
export const OVERRUN_ESCAPE_KM = 60;
export const OVERRUN_LOSS = 10;
export const EMPTY_POCKET_KM2 = 6000;

// Squeezed and cornered ground. A side's ground is in the grip of the other
// where the other's is within GRIP_KM. Out of the grip it is a body and
// perhaps parts joined to the body only through the grip; such a part, and a
// tongue reaching further than STRAND_KM out through the grip, is squeezed if
// it is this large and the fighting made it so: this share of it taken ground,
// or this share of it within SQUEEZED_NEAR_KM of ground the other has taken.
// Its troops waste by this much a day.
export const GRIP_KM = 16;
export const STRAND_KM = 40;
export const SQUEEZED_MIN_KM2 = 300;
export const SQUEEZED_TAKEN = 0.5;
export const SQUEEZED_NEAR = 0.15;
export const SQUEEZED_NEAR_KM = 24;
export const SQUEEZED_LOSS = 1;

// An assault on a named city, structure or formation: this many troops and
// one more for every so much strength defending within reach of it (doubled),
// between a least and a most; the nearest, from within this far. Each stops
// short on a ring of its own. It is given up after these days. A formation is
// worn by this much a day by each troop that has reached it.
export const ASSAULT_BASE = 4;
export const ASSAULT_PER_STRENGTH = 70;
export const ASSAULT_LEAST = 6;
export const ASSAULT_MOST = 24;
export const ASSAULT_DEFENDERS_KM = 25;
export const ASSAULT_FROM_KM = 280;
export const ASSAULT_RING_KM = Object.freeze([3, 11]);
export const ASSAULT_DAYS = 20;
export const ASSAULT_WEAR = 2.5;

// A border fortified in peace is given up after this many quiet days at token effort.
export const STANDING_QUIET_DAYS = 30;
