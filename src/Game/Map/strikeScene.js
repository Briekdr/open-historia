/*! Open Historia — strikes as they are played on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A strike (runtime/strikes.js) is a few words: who, with what, from where, at
// what, how many, how many shot down. This turns one into what is SEEN, moment
// by moment: each missile on its own arc from where it is launched to where it
// comes down, each aircraft in its place in a formation, the bombs it lets go;
// a burst in the air where one is intercepted; and where one arrives, the
// blast: for a nuclear weapon a flash, a fireball, a shock wave that spreads
// over the ground and a glow that lingers, for bombs a scatter of bursts.
//
// planStrike() lays a strike out once (its units, their timings, where each
// comes down). strikeItemsAt() says what is drawn of a plan at a time: ribbons
// (trails, shock rings), points (heads, aircraft, flashes) and discs, each
// with a height above the ground.
//
// On a GLOBE that height is drawn (strikeCustomLayer.js): a missile's arc is
// an arc in space, with its shadow on the ground under it, and an aircraft
// flies above the land. A FLAT map has no up, so there a missile's way is
// bowed to one side instead, as such arcs are drawn on any map; and on both an
// aircraft casts its shadow a little way off, which is how one is seen to be
// off the ground from straight above.
//
// Pure, and nothing here is left to chance twice: the same strike is the same
// spectacle every time it is played.

import { fliesAsAircraft, isNuclear } from "../../runtime/strikes.js";

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
// The most of a strike that is drawn: a salvo of hundreds is a dozen arcs.
export const MISSILES_SHOWN_MOST = 14;
export const AIRCRAFT_SHOWN_MOST = 20;
// How high things fly, in kilometres. A ballistic missile's arc is as high as
// it is: about a quarter of its range, up to some 1,300 km. Aircraft are drawn
// far higher than they fly, or on a globe they would not be seen to leave the ground.
export const APOGEE_SHARE = Object.freeze({ "silo missile": 0.24, "submarine missile": 0.22, "missile strike": 0.09 });
const APOGEE_KM = { "silo missile": [140, 1300], "submarine missile": [120, 1200], "missile strike": [22, 240] };
export const AIRCRAFT_HEIGHT_KM = 90;
// On a flat map a missile's way bows aside by this much of its arc's height.
const BOW_OF_HEIGHT = 0.55;
// (and never so far that it would be carried over a pole, where a flat map ends)
const BOW_LAT_MOST = 74;
// How long the flight is on screen, in seconds, for the shortest and the longest ways.
const MISSILE_SECONDS = [3.0, 6.6];
const AIRCRAFT_SECONDS = [5.0, 10.0];
const SALVO_GAP = 0.16;
const TRAIL_SHARE = 0.24;
// An aircraft goes on past what it bombed, this far again, and is lost to sight.
const FLIES_ON = 1.18;
// Aircraft keep this far apart: 16 km where the map is close in, and where it
// is far out as many kilometres as this many pixels are, so that each can be
// told from the next. Never so far that a formation is wider than half its own
// flight: on a short raid seen from far out they are drawn smaller instead.
const FORMATION_KM = 16;
const FORMATION_PX = 21;
const AIRCRAFT_PX = [8, 17];
// Bombs: where along its way an aircraft lets each go, and how long one falls (s).
const BOMBS = 3;
const BOMB_FROM = 0.925;
const BOMB_GAP = 0.025;
const BOMB_FALLS = 0.5;
const NUCLEAR_BOMB_FROM = 0.9;
const NUCLEAR_BOMB_FALLS = 0.9;
// The blast: how far its fireball, its shock wave and its second wave go (km),
// the least each is drawn on the screen (px), and for how long each is seen (s).
const NUCLEAR = { fire: 62, wave: 190, second: 270, glow: 30, fireFor: 3.4, waveFor: 3.0, secondFor: 3.9, glowFor: 7.5, firePx: 9, wavePx: 30, secondPx: 44, glowPx: 6 };
const BURST = { fire: 9, wave: 26, fireFor: 0.95, waveFor: 1.1, firePx: 3, wavePx: 8 };
const AIR_BURST_FOR = 0.85;
// An aircraft's shadow lies this much of its height away, and no farther than this on the screen (px).
const SHADOW_OF_HEIGHT = 0.6;
const SHADOW_PX_MOST = 14;
const SHADOW_BEARING = 135;

const COLOURS = {
  head: [1, 0.97, 0.86],
  trail: [1, 0.62, 0.24],
  smoke: [0.72, 0.72, 0.76],
  aircraft: [0.9, 0.92, 0.95],
  contrail: [0.95, 0.96, 1],
  flash: [1, 0.96, 0.8],
  fire: [1, 0.7, 0.26],
  glow: [0.86, 0.3, 0.1],
  wave: [1, 0.93, 0.8],
  bomb: [1, 0.86, 0.5],
  splash: [0.78, 0.9, 1],
  shadow: [0.02, 0.03, 0.05],
};

const clamp = (value, least, most) => Math.min(most, Math.max(least, value));
const easeOut = (value) => 1 - (1 - clamp(value, 0, 1)) * (1 - clamp(value, 0, 1));

// A number from 0 up to 1 that belongs to one unit of one strike.
const chance = (id, unit, what) => {
  const text = `${id}|${unit}|${what}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
};

// ---- the globe ---------------------------------------------------------------------------
const toVector = (lng, lat) => [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];
const toLngLat = (vector) => [Math.atan2(vector[1], vector[0]) / RAD, Math.atan2(vector[2], Math.hypot(vector[0], vector[1])) / RAD];
const unit = (vector) => {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// A longitude as the nearest of its turns to another.
const unwrap = (lng, near) => lng + 360 * Math.round((near - lng) / 360);
export const rangeKm = (from, to) => {
  const a = toVector(from[0], from[1]);
  const b = toVector(to[0], to[1]);
  return EARTH_KM * Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
};
// The place a distance from another, the way a bearing points (degrees clockwise from north).
export const placeFrom = ([lng, lat], bearing, km) => {
  const angle = km / EARTH_KM;
  const phi = lat * RAD;
  const there = Math.asin(clamp(Math.sin(phi) * Math.cos(angle) + Math.cos(phi) * Math.sin(angle) * Math.cos(bearing * RAD), -1, 1));
  const across = Math.atan2(Math.sin(bearing * RAD) * Math.sin(angle) * Math.cos(phi), Math.cos(angle) - Math.sin(phi) * Math.sin(there));
  return [lng + across / RAD, there / RAD];
};
const bearingOf = (from, to) => {
  const across = (to[0] - from[0]) * RAD;
  const y = Math.sin(across) * Math.cos(to[1] * RAD);
  const x = Math.cos(from[1] * RAD) * Math.sin(to[1] * RAD) - Math.sin(from[1] * RAD) * Math.cos(to[1] * RAD) * Math.cos(across);
  return (Math.atan2(y, x) / RAD + 360) % 360;
};

// A way between two places that bows to one side: (share) => [lng, lat], for
// any share of the way along (and past its end, for what flies on). `bend` is
// how far it bows, as a share of its length: to the left of its going for a
// bend above nothing. Its longitudes are followed from its start, so a way
// that crosses the date line is one way and not two halves a world apart.
const WAY_STEPS = 96;
const bentWay = (from, to, bend) => {
  const a = toVector(from[0], from[1]);
  const b = toVector(to[0], to[1]);
  const middle = unit([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  const side = unit(cross(a, b));
  const reach = Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
  // (The corner of the bow: pulled out to twice the bend, as a curve of this kind comes half way to its corner.)
  const corner = unit([middle[0] + side[0] * bend * reach * 2, middle[1] + side[1] * bend * reach * 2, middle[2] + side[2] * bend * reach * 2]);
  const exact = (share) => {
    const one = 1 - share;
    return toLngLat(unit([
      one * one * a[0] + 2 * one * share * corner[0] + share * share * b[0],
      one * one * a[1] + 2 * one * share * corner[1] + share * share * b[1],
      one * one * a[2] + 2 * one * share * corner[2] + share * share * b[2],
    ]));
  };
  const last = Math.round(WAY_STEPS * FLIES_ON) + 2;
  const followed = new Float64Array(last + 1);
  let before = from[0];
  for (let step = 0; step <= last; step += 1) {
    before = unwrap(exact(step / WAY_STEPS)[0], before);
    followed[step] = before;
  }
  return (share) => {
    const [lng, lat] = exact(share);
    return [unwrap(lng, followed[clamp(Math.round(share * WAY_STEPS), 0, last)]), lat];
  };
};

// Which way a missile's arc bows on a flat map, as the sign of its bend: to
// the north side, as an arc is drawn; to the other where that would carry it
// over a pole.
const bowSide = (from, to, bend) => {
  const north = unit(cross(toVector(from[0], from[1]), toVector(to[0], to[1])))[2] >= 0 ? 1 : -1;
  const highest = (sign) => {
    const way = bentWay(from, to, bend * sign);
    let most = 0;
    for (let step = 0; step <= 24; step += 1) most = Math.max(most, Math.abs(way(step / 24)[1]));
    return most;
  };
  const one = highest(north);
  if (one <= BOW_LAT_MOST) return north;
  return highest(-north) < one ? -north : north;
};

// ---- a strike laid out -------------------------------------------------------------------

// Which of `shown` units are the ones shot down: spread through the salvo.
const fallen = (shown, down) => {
  const set = new Set();
  for (let index = 0; index < down; index += 1) set.add(Math.min(shown - 1, Math.floor(((index + 0.5) * shown) / down)));
  return set;
};

// Lays a strike out. `from` and `to` are [lng, lat]; a strike without both is
// not played. `flat` says the map it is played on has no up (see above), and
// `kmPerPixel` how far out it is being looked from as it sets off.
// Returns { id, weapon, nuclear, aircraft, flat, from, to, km, count, shown,
// down, units, bomber, hits, lasts } where each unit is
// { index, start, flight, down, way(share), height(share), lands: [lng, lat] }.
export const planStrike = (strike, { from, to, flat = false, kmPerPixel = 0 } = {}) => {
  if (!strike || !Array.isArray(from) || !Array.isArray(to) || ![from[0], from[1], to[0], to[1]].every(Number.isFinite)) return null;
  const km = Math.max(1, rangeKm(from, to));
  const aircraft = fliesAsAircraft(strike.weapon);
  const nuclear = isNuclear(strike.weapon);
  const most = aircraft ? AIRCRAFT_SHOWN_MOST : MISSILES_SHOWN_MOST;
  const count = Math.max(1, Math.round(Number(strike.count) || 1));
  const shown = Math.min(most, count);
  const wanted = Math.max(0, Math.min(count, Math.round(Number(strike.down) || 0)));
  // As many of those shown are lost as their share of the whole: all, when all were.
  const down = wanted >= count ? shown : wanted === 0 ? 0 : clamp(Math.round((wanted * shown) / count), 1, Math.max(1, shown - 1));
  const lost = fallen(shown, down);
  const seconds = aircraft ? AIRCRAFT_SECONDS : MISSILE_SECONDS;
  const flight = clamp(seconds[0] + km / (aircraft ? 1300 : 2400), seconds[0], seconds[1]) * (strike.weapon === "missile strike" ? 0.82 : 1);
  const spread = aircraft ? (nuclear ? 6 : 24) : nuclear ? 16 : 9;
  const share = APOGEE_SHARE[strike.weapon] ?? APOGEE_SHARE["silo missile"];
  const bow = !aircraft && flat ? share * BOW_OF_HEIGHT * bowSide(from, to, share * BOW_OF_HEIGHT) : 0;
  const bearing = bearingOf(from, to);
  const looked = Number.isFinite(kmPerPixel) && kmPerPixel > 0 ? kmPerPixel : 0;
  const gap = aircraft ? Math.min(Math.max(Math.min(FORMATION_KM, km * 0.03), FORMATION_PX * looked), Math.max(1, km / 8)) : 0;
  // (How long an aircraft takes to fly as far as it keeps from the next.)
  const gapSeconds = aircraft ? Math.max(0.22, (gap * flight) / km) : 0;
  const units = [];
  for (let index = 0; index < shown; index += 1) {
    const lands = placeFrom(to, chance(strike.id, index, "bearing") * 360, spread * Math.sqrt(chance(strike.id, index, "off")) * (shown > 1 ? 1 : 0));
    let way;
    let height;
    let start;
    if (aircraft) {
      // A formation: rows of five abreast, each row behind the one before.
      const row = Math.floor(index / 5);
      const place = (index % 5) - Math.min(4, shown - row * 5 - 1) / 2;
      const aside = place * gap;
      way = bentWay(placeFrom(from, bearing + 90, aside), placeFrom(to, bearing + 90, aside), 0);
      height = (at) => AIRCRAFT_HEIGHT_KM * clamp(at / 0.08, 0, 1);
      // Each row a little more than a place behind the one before, and its outer aircraft behind its middle one.
      start = (row * 1.25 + Math.abs(place) * 0.3) * gapSeconds;
    } else {
      const [low, high] = APOGEE_KM[strike.weapon] ?? APOGEE_KM["silo missile"];
      const apogee = clamp(km * share, low, high) * (0.82 + 0.36 * chance(strike.id, index, "apogee"));
      // Each of a salvo on a way of its own: a fan of them on a flat map, a sheaf on a globe.
      const own = chance(strike.id, index, "bend");
      way = bentWay(from, lands, shown > 1 ? (flat ? bow * (0.78 + 0.44 * own) : (own - 0.5) * 0.11) : bow);
      height = (at) => apogee * 4 * clamp(at, 0, 1) * (1 - clamp(at, 0, 1));
      start = index * SALVO_GAP;
    }
    units.push({
      index,
      start,
      flight,
      // Where along its way it is shot down, or null.
      down: lost.has(index) ? (aircraft ? 0.34 : 0.48) + (aircraft ? 0.5 : 0.4) * chance(strike.id, index, "down") : null,
      way,
      height,
      lands,
    });
  }
  const through = units.filter((entry) => entry.down === null);
  // The aircraft that lets a nuclear bomb go: the first of them to get there.
  const bomber = aircraft && nuclear && through.length > 0 ? through.reduce((first, entry) => (entry.start < first.start ? entry : first)).index : -1;
  const last = units.reduce((latest, entry) => Math.max(latest, entry.start + entry.flight * (aircraft ? FLIES_ON : 1)), 0);
  return {
    id: strike.id,
    weapon: strike.weapon,
    nuclear,
    aircraft,
    flat: flat === true,
    from: [from[0], from[1]],
    to: [to[0], to[1]],
    km,
    count,
    shown,
    down,
    gapKm: gap,
    units,
    bomber,
    hits: through.length > 0,
    lasts: last + (through.length > 0 ? (nuclear ? NUCLEAR.glowFor : 1.8) : 1.2),
  };
};

// ---- what is seen of it at a moment --------------------------------------------------------

// A ring on the ground round a place, as the points of a ribbon.
export const ringOf = (centre, km, height = 2) => {
  const points = [];
  for (let step = 0; step <= 48; step += 1) {
    const [lng, lat] = placeFrom(centre, (step * 360) / 48, km);
    points.push([lng, lat, height]);
  }
  return points;
};

// A ring spreading over the ground: pale, with a wider ring of fire's colour
// under it so that it is seen on pale ground as on dark.
const waveRing = (items, at, km, width, alpha, height = 2) => {
  const points = ringOf(at, km, height);
  items.ribbons.push({ points, width: width * 2 + 1, colour: COLOURS.fire, from: alpha * 0.5, to: alpha * 0.5 });
  items.ribbons.push({ points, width, colour: COLOURS.wave, from: alpha, to: alpha });
};

// (`least` px of the screen is the least anything of a blast is drawn, however far out the map is.)
const nuclearBlast = (items, at, since, kmPerPixel) => {
  if (since < 0) return;
  const atLeast = (km, pixels) => Math.max(km, pixels * kmPerPixel);
  // The flash, seen from far off whatever the map's scale.
  if (since < 1.5) items.points.push({ at: [at[0], at[1], 4], size: 34 + 64 * easeOut(since / 0.45), shape: 2, colour: COLOURS.flash, alpha: 1 - clamp((since - 0.25) / 1.25, 0, 1) });
  if (since < NUCLEAR.fireFor) {
    const grown = easeOut(since / 0.7);
    const most = atLeast(NUCLEAR.fire, NUCLEAR.firePx);
    items.discs.push({ centre: at, km: most * (0.16 + 0.84 * grown), colour: since < 0.5 ? COLOURS.flash : COLOURS.fire, alpha: 0.9 * (1 - clamp(since / NUCLEAR.fireFor, 0, 1)) });
  }
  if (since < NUCLEAR.glowFor) items.discs.push({ centre: at, km: atLeast(NUCLEAR.glow, NUCLEAR.glowPx), colour: COLOURS.glow, alpha: 0.5 * (1 - since / NUCLEAR.glowFor) });
  if (since < NUCLEAR.waveFor) {
    const gone = since / NUCLEAR.waveFor;
    waveRing(items, at, Math.max(1, atLeast(NUCLEAR.wave, NUCLEAR.wavePx) * easeOut(gone)), 3.4, (1 - gone) * (1 - gone));
  }
  const later = since - 0.42;
  if (later > 0 && later < NUCLEAR.secondFor) {
    const gone = later / NUCLEAR.secondFor;
    waveRing(items, at, Math.max(1, atLeast(NUCLEAR.second, NUCLEAR.secondPx) * easeOut(gone)), 1.8, 0.55 * (1 - gone));
  }
};
const burst = (items, at, since, kmPerPixel, scale = 1) => {
  if (since < 0) return;
  const atLeast = (km, pixels) => Math.max(km, pixels * kmPerPixel) * scale;
  if (since < BURST.fireFor) {
    const left = 1 - since / BURST.fireFor;
    items.points.push({ at: [at[0], at[1], 1], size: (9 + 16 * easeOut(since / 0.25)) * scale, shape: 2, colour: since < 0.2 ? COLOURS.flash : COLOURS.fire, alpha: left });
    items.discs.push({ centre: at, km: atLeast(BURST.fire, BURST.firePx) * (0.34 + 0.66 * easeOut(since / 0.4)), colour: COLOURS.fire, alpha: 0.75 * left });
  }
  if (since < BURST.waveFor) {
    const gone = since / BURST.waveFor;
    waveRing(items, at, Math.max(0.5, atLeast(BURST.wave, BURST.wavePx) * easeOut(gone)), 1.6, 0.7 * (1 - gone), 1);
  }
};
// One shot down: a flash in the air where it was, and a ring that opens round it.
const airBurst = (items, at, since) => {
  if (since < 0 || since > AIR_BURST_FOR) return;
  const left = 1 - since / AIR_BURST_FOR;
  items.points.push({ at, size: 12 + 30 * easeOut(since / 0.3), shape: 2, colour: COLOURS.flash, alpha: left });
  items.points.push({ at, size: 18 + 46 * easeOut(since / AIR_BURST_FOR), shape: 3, colour: COLOURS.fire, alpha: 0.85 * left });
};
// A bomb on its way down: from where it was let go to where it bursts.
const falling = (items, from, to, share, size) => {
  // (Faster as it falls. Its landing place is told from where it was let go, should the date line lie between.)
  const lng = unwrap(to[0], from[0]);
  items.points.push({ at: [from[0] + (lng - from[0]) * share, from[1] + (to[1] - from[1]) * share, from[2] * (1 - share * share)], size, shape: 0, colour: COLOURS.bomb, alpha: 1 });
};

// What is drawn of a plan `seconds` after it began:
//   ribbons   [{ points: [[lng, lat, km]...], width (px), colour, from, to }]  (alpha at its first and last point)
//   points    [{ at: [lng, lat, km], toward?: [lng, lat, km], size (px), shape, colour, alpha }]
//             shape 0 a glow, 1 an aircraft (turned the way `toward` lies), 2 a flash, 3 a ring
//   discs     [{ centre: [lng, lat], km, colour, alpha }]
// `kmPerPixel` is the map's scale where the strike is watched: a blast is
// never drawn smaller than can be seen, nor a shadow farther off than looks right.
export const strikeItemsAt = (plan, seconds, { kmPerPixel = 0 } = {}) => {
  const items = { ribbons: [], points: [], discs: [] };
  if (!plan || !(seconds >= 0) || seconds > plan.lasts) return items;
  const scale = Number.isFinite(kmPerPixel) && kmPerPixel > 0 ? kmPerPixel : 0;
  for (const entry of plan.units) {
    const share = (seconds - entry.start) / entry.flight;
    if (share < 0) continue;
    const ends = entry.down ?? (plan.aircraft ? FLIES_ON : 1);
    const place = (at) => {
      const [lng, lat] = entry.way(at);
      return [lng, lat, entry.height(at)];
    };
    const flying = share <= ends;
    const head = Math.min(share, ends);
    // Its trail: the last stretch of its way, fading once it is no more.
    const since = (share - ends) * entry.flight;
    const fade = flying ? 1 : 1 - clamp(since / 0.9, 0, 1);
    if (fade > 0) {
      const tail = Math.max(0, head - (plan.aircraft ? 0.12 : TRAIL_SHARE));
      const points = [];
      for (let step = 0; step <= 14; step += 1) points.push(place(tail + ((head - tail) * step) / 14));
      // On a globe a missile's arc is in the air: its shadow follows it over the ground.
      if (!plan.aircraft && !plan.flat) items.ribbons.push({ points: points.map(([lng, lat]) => [lng, lat, 0]), width: 2, colour: COLOURS.shadow, from: 0, to: 0.3 * fade });
      // The glow round a missile's fire, under the trail itself.
      if (!plan.aircraft && flying) items.ribbons.push({ points, width: 7, colour: COLOURS.trail, from: 0, to: 0.22 });
      items.ribbons.push({ points, width: plan.aircraft ? 1.3 : 2.4, colour: plan.aircraft ? COLOURS.contrail : flying ? COLOURS.trail : COLOURS.smoke, from: 0, to: (plan.aircraft ? 0.4 : 0.95) * fade });
    }
    if (flying) {
      if (plan.aircraft) {
        // (An aircraft that has dropped its load goes on, and is lost to sight.)
        const seen = share > 1.04 ? 1 - clamp((share - 1.04) / (FLIES_ON - 1.04), 0, 1) : 1;
        const at = place(head);
        const toward = place(head + 0.012);
        // (Smaller where they have had to be drawn close together.)
        const size = scale > 0 ? clamp((plan.gapKm / scale) * 0.85, AIRCRAFT_PX[0], AIRCRAFT_PX[1]) : AIRCRAFT_PX[1];
        // Its shadow, on the ground a little way off.
        const off = Math.min(at[2] * SHADOW_OF_HEIGHT, scale > 0 ? SHADOW_PX_MOST * scale : Infinity);
        if (off > 0) {
          const under = placeFrom(at, SHADOW_BEARING, off);
          const ahead = placeFrom(toward, SHADOW_BEARING, off);
          items.points.push({ at: [under[0], under[1], 0], toward: [ahead[0], ahead[1], 0], size, shape: 1, colour: COLOURS.shadow, alpha: 0.34 * seen });
        }
        items.points.push({ at, toward, size, shape: 1, colour: COLOURS.aircraft, alpha: seen });
      } else {
        items.points.push({ at: place(head), size: 9, shape: 0, colour: COLOURS.head, alpha: 1 });
        // The fire of its launch, while it is still low; from a submarine, the water it breaks.
        if (share < 0.07) items.points.push({ at: place(0), size: 16 * (1 - share / 0.07) + 6, shape: 2, colour: COLOURS.trail, alpha: 1 - share / 0.07 });
        if (plan.weapon === "submarine missile" && share < 0.16) items.points.push({ at: place(0), size: 14 + 40 * easeOut(share / 0.16), shape: 3, colour: COLOURS.splash, alpha: 0.8 * (1 - share / 0.16) });
      }
    }
    if (entry.down !== null) {
      airBurst(items, place(entry.down), (share - entry.down) * entry.flight);
      continue;
    }
    // It arrives.
    if (!plan.aircraft) {
      // (Where its own way ends: the same place as `lands`, told as the way tells its longitudes.)
      const landed = (share - 1) * entry.flight;
      if (landed < 0) continue;
      const ended = entry.way(1);
      if (plan.nuclear) nuclearBlast(items, ended, landed, scale);
      else burst(items, ended, landed, scale, 1.25);
      continue;
    }
    if (plan.nuclear) {
      // One bomb, from the first of them to get there.
      if (entry.index !== plan.bomber) continue;
      const fell = ((share - NUCLEAR_BOMB_FROM) * entry.flight) / NUCLEAR_BOMB_FALLS;
      if (fell >= 0 && fell < 1) falling(items, place(NUCLEAR_BOMB_FROM), plan.to, fell, 7);
      nuclearBlast(items, plan.to, (fell - 1) * NUCLEAR_BOMB_FALLS, scale);
      continue;
    }
    // A stick of bombs from each, let go as it comes over and bursting where they fall.
    for (let bomb = 0; bomb < BOMBS; bomb += 1) {
      const from = BOMB_FROM + bomb * BOMB_GAP;
      const fell = ((share - from) * entry.flight) / BOMB_FALLS;
      if (fell < 0) continue;
      const at = placeFrom(entry.lands, chance(plan.id, entry.index, `bomb${bomb}`) * 360, 4 + 14 * chance(plan.id, entry.index, `far${bomb}`));
      if (fell < 1) falling(items, place(from), at, fell, 4.5);
      else burst(items, at, (fell - 1) * BOMB_FALLS, scale);
    }
  }
  return items;
};

// How long a plan takes to play, in seconds.
export const strikeLasts = (plan) => (plan ? plan.lasts : 0);
