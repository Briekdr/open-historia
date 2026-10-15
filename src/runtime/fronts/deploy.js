/*! Open Historia — battlefields and fronts: where a side's new troops come in © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so you can draw a line of where reinforcements are to get deployed
// in the war room" (the owner, 2026-10-15).
//
// A country's DEPLOYMENT LINE on a battlefield is drawn in the war room
// (GameUI/warRoom.jsx; the op "deploy", warRoomOps.js) and kept in the
// battlefield's brief.carry.deploy, a list a side of { country, way }: one
// line a country, a side's own as its plans are (view.js). Its new troops on
// that battlefield come in on it: the levies it musters (engine.js
// musterDay), a draft or a reinforcement of its own (reinforceOnFront), and
// its troops when it joins the battle (raiseFor). They stand on ground their
// side holds along the line, each point of it the nearest such cell within
// DEPLOY_REACH_KM, spread evenly from one end to the other; where their side
// holds none along it they come in on their own stretch of the front, as a
// country with no line does.
//
// Only + - * / and comparisons.

import { HOLDER_SIDE_A, HOLDER_SIDE_B, MAX_WAY_POINTS } from "./constants.js";

// How far from the line drawn a new troop may stand, and the most points a line keeps.
export const DEPLOY_REACH_KM = 40;
export const DEPLOY_WAY_MOST = MAX_WAY_POINTS * 4;

const clean = (value, most = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const isSide = (side) => side === HOLDER_SIDE_A || side === HOLDER_SIDE_B;

// A line as it is kept: [lng, lat] points, rounded, at most DEPLOY_WAY_MOST of them (thinned evenly, ends kept).
const readWay = (value) => {
  const way = [];
  for (const point of Array.isArray(value) ? value : []) {
    const lng = Number(Array.isArray(point) ? point[0] : NaN);
    const lat = Number(Array.isArray(point) ? point[1] : NaN);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat > 90 || lat < -90) continue;
    way.push([Math.round(lng * 10000) / 10000, Math.round(lat * 10000) / 10000]);
  }
  if (way.length <= DEPLOY_WAY_MOST) return way;
  const kept = [];
  for (let index = 0; index < DEPLOY_WAY_MOST; index += 1) kept.push(way[Math.round((index * (way.length - 1)) / (DEPLOY_WAY_MOST - 1))]);
  return kept;
};

// The deployment lines of a record's carry, a list a side, checked: a country once a side.
export const readDeploy = (value) => [HOLDER_SIDE_A, HOLDER_SIDE_B].map((side) => {
  const kept = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) && Array.isArray(value[side]) ? value[side] : []) {
    const country = clean(raw?.country, 120);
    const way = readWay(raw?.way);
    if (!country || seen.has(fold(country)) || way.length < 2) continue;
    seen.add(fold(country));
    kept.push({ country, way });
  }
  return kept;
});

// Whether any side keeps a line.
export const hasDeploy = (deploy) => Array.isArray(deploy) && deploy.some((list) => Array.isArray(list) && list.length > 0);

const carryOf = (record) => (record?.brief && typeof record.brief.carry === "object" && record.brief.carry ? record.brief.carry : {});

// A side's deployment lines on a record.
export const deployLinesOf = (record, side) => (isSide(side) ? readDeploy(carryOf(record).deploy)[side] : []);

// A record with a country's deployment line drawn (or, with a way of fewer than two points, taken off).
export const withDeployLine = (record, side, { country, way } = {}) => {
  const name = clean(country, 120);
  if (!record || !isSide(side) || !name) return record;
  const deploy = readDeploy(carryOf(record).deploy);
  const line = readWay(way);
  const others = deploy[side].filter((entry) => fold(entry.country) !== fold(name));
  deploy[side] = line.length >= 2 ? [...others, { country: name, way: line }] : others;
  const carry = { ...carryOf(record) };
  if (hasDeploy(deploy)) carry.deploy = deploy;
  else delete carry.deploy;
  return { ...record, brief: { ...record.brief, carry } };
};

// Where a member's new troops on a battle stand: on its deployment line, where its side holds ground along it,
// as cells in order from one end of the line to the other; otherwise `cells` as they were.
export const deployCells = (battle, side, member, cells) => {
  const lines = Array.isArray(battle.deploy) && Array.isArray(battle.deploy[side]) ? battle.deploy[side] : [];
  const line = lines.find((entry) => fold(entry.country) === fold(member));
  if (!line) return cells;
  const { field, place } = battle;
  const { cols, rows } = field;
  const reach = Math.max(1, Math.round(DEPLOY_REACH_KM / battle.frame.km));
  const out = [];
  const seen = new Set();
  const take = (x, y) => {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let best = -1;
    let bestAt = reach * reach + 1;
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const gx = cx + dx;
        const gy = cy + dy;
        const far = dx * dx + dy * dy;
        if (gx < 0 || gy < 0 || gx >= cols || gy >= rows || far >= bestAt) continue;
        const cell = gy * cols + gx;
        if (field.holders[cell] !== side) continue;
        best = cell;
        bestAt = far;
      }
    }
    if (best >= 0 && !seen.has(best)) {
      seen.add(best);
      out.push(best);
    }
  };
  const points = line.way.map(([lng, lat]) => place.toCell(lng, lat));
  for (let at = 1; at < points.length; at += 1) {
    const [ax, ay] = points[at - 1];
    const [bx, by] = points[at];
    const steps = Math.max(1, Math.floor(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))) + 1);
    for (let step = at === 1 ? 0 : 1; step <= steps; step += 1) take(ax + ((bx - ax) * step) / steps, ay + ((by - ay) * step) / steps);
  }
  return out.length > 0 ? out : cells;
};
