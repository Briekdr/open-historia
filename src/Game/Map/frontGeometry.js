/*! Open Historia — battlefields on the map: a run's troops played back, as shapes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A battlefield keeps a replay of its last run (runtime/fronts/replay.js): the
// path each troop took, and the ground as it was taken. The map plays it back,
// so the troops are seen going the way they went. This works out where every
// troop of a battlefield is on any day of its run, a fraction of a day
// included, with the way it has come so far, and writes that out as the
// features the layers read (FrontLayers.jsx): a counter a troop, and an arrow
// along the way it came. The ground is frontPaint.js's.
// Pure, and loads in plain Node.
//
//   drawing { name, status, sides, frame, toLngLat, troops: [[troop], [troop]] }
//   troop   { x, y, strength, kind, owner, named, state, label, moving, way }
//           or null for one not standing that day; x and y are in cell units of
//           the frame, owner is a name, and way the way it has come so far
//           this run, as { xs, ys, days }: each point of it with the day the
//           troop was there (null for one that has not gone anywhere)
//
// There is no front line to draw: the front is where the troops stand and
// where the colours of the ground meet.

import { TROOP_KINDS, TROOP_STATES } from "../../runtime/fronts/constants.js";
import { projectorOf } from "../../runtime/fronts/frame.js";

export const TROOP_KIND_GLYPH = Object.freeze({ infantry: "I", armor: "A", artillery: "G" });

const EMPTY = Object.freeze({ type: "FeatureCollection", features: [] });

// ---- the way a troop went -----------------------------------------------------------

// A path is kept as a few points (the days it changed its course or its
// pace), and a troop went straight from each to the next. It is drawn rounding
// each corner a little on the inside, as a column on the march does, and the
// line left behind it is the same curve. The rounding is short (never more
// than a part of the shorter of the two legs it joins), so what is drawn stays
// beside the way it really went and never swings outside it: a curve through
// the corner itself would have to swing wide of the corner first, off the
// troop's own ground. Where it stood still on either side of a point it stops
// dead there.
const ROUND_CELLS = 0.75;
const ROUND_PART = 0.4;
const ROUND_STEPS = 5;

// A track as a fine run of points, each with the day the troop was there.
const curveOf = (track) => {
  const days = [];
  const xs = [];
  const ys = [];
  const put = (day, x, y) => {
    const last = days.length - 1;
    if (last >= 0 && days[last] === day && xs[last] === x && ys[last] === y) return;
    days.push(day);
    xs.push(x);
    ys.push(y);
  };
  if (track.length > 0) put(track[0].day, track[0].x, track[0].y);
  for (let index = 1; index < track.length; index += 1) {
    const here = track[index];
    const before = track[index - 1];
    const after = track[index + 1];
    const inLeg = Math.sqrt((here.x - before.x) ** 2 + (here.y - before.y) ** 2);
    const outLeg = after ? Math.sqrt((after.x - here.x) ** 2 + (after.y - here.y) ** 2) : 0;
    const round = Math.min(ROUND_CELLS, ROUND_PART * inLeg, ROUND_PART * outLeg);
    if (!(round > 0)) {
      put(here.day, here.x, here.y);
      continue;
    }
    // Where it leaves the straight for the corner, and where it is back on it.
    const inPart = round / inLeg;
    const outPart = round / outLeg;
    const enterX = here.x - (here.x - before.x) * inPart;
    const enterY = here.y - (here.y - before.y) * inPart;
    const enterDay = here.day - (here.day - before.day) * inPart;
    const leaveX = here.x + (after.x - here.x) * outPart;
    const leaveY = here.y + (after.y - here.y) * outPart;
    const leaveDay = here.day + (after.day - here.day) * outPart;
    put(enterDay, enterX, enterY);
    for (let step = 1; step <= ROUND_STEPS; step += 1) {
      const u = step / ROUND_STEPS;
      const a = (1 - u) * (1 - u);
      const b = 2 * u * (1 - u);
      const c = u * u;
      put(enterDay + (leaveDay - enterDay) * u, a * enterX + b * here.x + c * leaveX, a * enterY + b * here.y + c * leaveY);
    }
  }
  return { days: Float64Array.from(days), xs: Float64Array.from(xs), ys: Float64Array.from(ys) };
};

// ---- a battlefield readied to be played ----------------------------------------------

// What frontAt needs of a view (record.js frontViewOf), made once for it: each
// troop's curve.
const stages = new WeakMap();
export const stageOf = (view) => {
  let stage = stages.get(view);
  if (stage) return stage;
  const { toLngLat } = projectorOf(view.frame);
  const labels = new Map();
  for (const entry of view.named ?? []) labels.set(`${entry.s}:${entry.i}`, entry.name);
  const replay = view.replay;
  const troops = view.troops.map((list, side) => {
    const tracks = replay?.tracks?.[side] ?? [];
    const count = Math.max(list.length, tracks.length);
    const made = [];
    for (let index = 0; index < count; index += 1) {
      const standing = list[index] ?? null;
      const track = tracks[index] ?? [];
      const curve = curveOf(track);
      // The last point of the curve at which it still stood where it began:
      // its way starts there, and it has none until it has left.
      let setOff = 0;
      while (setOff + 1 < curve.days.length && curve.xs[setOff + 1] === curve.xs[0] && curve.ys[setOff + 1] === curve.ys[0]) setOff += 1;
      made.push({
        track,
        curve,
        setOff,
        kind: TROOP_KINDS[standing?.kind ?? 0] ?? TROOP_KINDS[0],
        owner: view.sides[side]?.[standing?.owner ?? 0] ?? view.sides[side]?.[0] ?? "",
        named: standing?.named === true,
        label: standing?.named === true ? labels.get(`${side}:${index}`) ?? "" : "",
        // A troop the replay has no path for is where the record has it.
        standing,
      });
    }
    return made;
  });
  stage = {
    view,
    toLngLat,
    troops,
    known: Boolean(replay),
    start: replay?.start ?? 0,
    // The last day of the battlefield's own replay, and of the run.
    last: replay?.end ?? 0,
    end: replay?.days ?? 0,
  };
  stages.set(view, stage);
  return stage;
};

const troopAt = (stage, troop, day) => {
  const { track, curve, setOff } = troop;
  if (track.length === 0) {
    const standing = troop.standing;
    if (!standing || !(standing.strength > 0)) return null;
    return {
      x: standing.x, y: standing.y, strength: standing.strength, state: TROOP_STATES[standing.state] ?? TROOP_STATES[0],
      kind: troop.kind, owner: troop.owner, named: troop.named, label: troop.label, moving: false, way: null,
    };
  }
  if (day < track[0].day) return null;
  // What it was doing, and how strong it was, by the points kept.
  let sample = 1;
  while (sample < track.length && track[sample].day < day) sample += 1;
  const last = track[track.length - 1];
  const ended = day >= last.day;
  const to = ended ? last : track[sample];
  const from = ended ? last : track[sample - 1];
  const span = to.day - from.day;
  const part = ended || !(span > 0) ? 1 : (day - from.day) / span;
  const strength = from.strength + (to.strength - from.strength) * part;
  if (!(strength > 0)) return null;
  // Where it was, by the curve through them, and the way it has come.
  let point = 1;
  const count = curve.days.length;
  while (point < count && curve.days[point] < day) point += 1;
  let x;
  let y;
  let way = null;
  if (point >= count) {
    x = curve.xs[count - 1];
    y = curve.ys[count - 1];
    if (count - 1 > setOff) way = { xs: curve.xs.subarray(setOff), ys: curve.ys.subarray(setOff), days: curve.days.subarray(setOff) };
  } else {
    const leg = curve.days[point] - curve.days[point - 1];
    const along = leg > 0 ? (day - curve.days[point - 1]) / leg : 1;
    x = curve.xs[point - 1] + (curve.xs[point] - curve.xs[point - 1]) * along;
    y = curve.ys[point - 1] + (curve.ys[point] - curve.ys[point - 1]) * along;
    if (point - 1 > setOff || (point - 1 === setOff && along > 0)) {
      const gone = point - setOff;
      const xs = new Float64Array(gone + 1);
      const ys = new Float64Array(gone + 1);
      const days = new Float64Array(gone + 1);
      xs.set(curve.xs.subarray(setOff, point));
      ys.set(curve.ys.subarray(setOff, point));
      days.set(curve.days.subarray(setOff, point));
      xs[gone] = x;
      ys[gone] = y;
      days[gone] = day;
      way = { xs, ys, days };
    }
  }
  return {
    x, y, strength, state: TROOP_STATES[to.state] ?? TROOP_STATES[0],
    kind: troop.kind, owner: troop.owner, named: troop.named, label: troop.label,
    moving: !ended && (Math.abs(to.x - from.x) > 1 / 32 || Math.abs(to.y - from.y) > 1 / 32),
    way,
  };
};

// Whether a battlefield is to be seen at all on a day of its run: not before
// it opened, and not once it has closed.
export const frontShownOn = (stage, day) =>
  stage.known && day >= stage.start && !(stage.view.status === "closed" && day >= stage.last);

// A battlefield's troops as they were on a day of its run (a fraction of a day
// is fine): null when it is not to be seen that day.
export const frontAt = (stage, day) => {
  if (!frontShownOn(stage, day)) return null;
  const { view } = stage;
  return {
    name: view.name,
    status: view.status,
    sides: view.sides,
    frame: view.frame,
    toLngLat: stage.toLngLat,
    stage,
    troops: stage.troops.map((list) => list.map((troop) => troopAt(stage, troop, day))),
  };
};

// ---- what the layers read --------------------------------------------------------------

// A point a troop, and one a side: where its troops are on average, with how
// many they are, for a view from too far off to tell them apart. `colorOf(name)`
// gives a css colour; `labelOf` shortens a named formation's name to what fits
// under a counter.
export const frontTroopFeatures = (shown, colorOf, { labelOf = (name) => name } = {}) => {
  const features = [];
  for (const drawing of shown) {
    if (!drawing) continue;
    const { toLngLat } = drawing;
    drawing.troops.forEach((list, side) => {
      let count = 0;
      let x = 0;
      let y = 0;
      let strength = 0;
      list.forEach((troop, index) => {
        if (!troop) return;
        count += 1;
        x += troop.x;
        y += troop.y;
        strength += troop.strength;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: toLngLat(troop.x, troop.y) },
          properties: {
            what: "troop",
            battlefield: drawing.name,
            side,
            index,
            owner: troop.owner,
            rgb: colorOf(troop.owner),
            kind: troop.kind,
            glyph: TROOP_KIND_GLYPH[troop.kind] ?? "I",
            strength: Math.round(troop.strength),
            state: troop.state,
            named: troop.named,
            moving: troop.moving,
            label: troop.label ? labelOf(troop.label) : "",
          },
        });
      });
      if (!count) return;
      const owner = drawing.sides[side]?.[0] ?? "";
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: toLngLat(x / count, y / count) },
        properties: {
          what: "side",
          battlefield: drawing.name,
          side,
          owner,
          rgb: colorOf(owner),
          count,
          strength: Math.round(strength / count),
        },
      });
    });
  }
  return features.length ? { type: "FeatureCollection", features } : EMPTY;
};

// ---- the way a troop came, as an arrow ---------------------------------------------

// How many days of a troop's way count as just gone. Its arrow is drawn along
// that much of the way behind it, and what it walked before is a faint line,
// so that a month of fighting does not bury the map in arrows while every way
// can still be followed back to where it began.
export const ARROW_FRESH_DAYS = 6;
// The width an arrow begins at, as a part of its full width, and the head's
// length and half-width in half-widths of the arrow.
const ARROW_TAIL = 0.3;
const ARROW_HEAD_LENGTH = 3.2;
const ARROW_HEAD_HALF = 2.3;

// One arrow as a ring of [x, y] in the frame's cell units: the way a troop
// came (frontAt's `way`), thin where it walked long ago, widening over the
// last days of it, with a head at where the troop is on `day`. `halfWidth` is
// half the arrow's full width, in cells. null for a way too short to draw.
export const arrowRing = (way, day, halfWidth) => {
  // The way without the points that stand on the one before.
  const xs = [];
  const ys = [];
  const days = [];
  for (let index = 0; index < way.xs.length; index += 1) {
    const last = xs.length - 1;
    if (last >= 0 && Math.abs(way.xs[index] - xs[last]) < 1e-6 && Math.abs(way.ys[index] - ys[last]) < 1e-6) {
      days[last] = way.days[index];
      continue;
    }
    xs.push(way.xs[index]);
    ys.push(way.ys[index]);
    days.push(way.days[index]);
  }
  const count = xs.length;
  if (count < 2 || !(halfWidth > 0)) return null;
  const along = [0];
  for (let index = 1; index < count; index += 1) along.push(along[index - 1] + Math.hypot(xs[index] - xs[index - 1], ys[index] - ys[index - 1]));
  const total = along[count - 1];
  if (!(total > halfWidth * 0.6)) return null;

  // An arrow keeps its proportions: one on a way too short for its head is
  // the same arrow smaller, and grows to its full width as the way lengthens.
  const fit = Math.min(1, (total * 0.7) / (ARROW_HEAD_LENGTH * halfWidth));
  const half = halfWidth * fit;
  const headLength = ARROW_HEAD_LENGTH * half;
  const headHalf = ARROW_HEAD_HALF * half;
  const neck = total - headLength;
  const widthOn = (when) => {
    let fresh = (when - (day - ARROW_FRESH_DAYS)) / ARROW_FRESH_DAYS;
    if (fresh < 0) fresh = 0;
    else if (fresh > 1) fresh = 1;
    return half * (ARROW_TAIL + (1 - ARROW_TAIL) * fresh * fresh * (3 - 2 * fresh));
  };
  const left = [];
  const right = [];
  const put = (x, y, tx, ty, width) => {
    const length = Math.hypot(tx, ty) || 1;
    const nx = -ty / length;
    const ny = tx / length;
    left.push([x + nx * width, y + ny * width]);
    right.push([x - nx * width, y - ny * width]);
  };
  let segment = 1;
  for (let index = 0; index < count && along[index] < neck; index += 1) {
    const before = Math.max(0, index - 1);
    const after = Math.min(count - 1, index + 1);
    put(xs[index], ys[index], xs[after] - xs[before], ys[after] - ys[before], widthOn(days[index]));
    segment = index + 1;
  }
  // Where the head begins, on the leg that crosses it.
  const leg = along[segment] - along[segment - 1];
  const part = leg > 0 ? Math.max(0, Math.min(1, (neck - along[segment - 1]) / leg)) : 0;
  const neckX = xs[segment - 1] + (xs[segment] - xs[segment - 1]) * part;
  const neckY = ys[segment - 1] + (ys[segment] - ys[segment - 1]) * part;
  const tipX = xs[count - 1];
  const tipY = ys[count - 1];
  let headX = tipX - neckX;
  let headY = tipY - neckY;
  const headSpan = Math.hypot(headX, headY);
  if (!(headSpan > 1e-9)) return null;
  headX /= headSpan;
  headY /= headSpan;
  put(neckX, neckY, headX, headY, Math.min(widthOn(days[segment - 1] + (days[segment] - days[segment - 1]) * part), headHalf * 0.6));
  const ring = [
    ...left,
    [neckX - headY * headHalf, neckY + headX * headHalf],
    [tipX, tipY],
    [neckX + headY * headHalf, neckY - headX * headHalf],
    ...right.reverse(),
  ];
  ring.push(ring[0]);
  return ring;
};

// The day a troop last moved: the day of the last point of its way that is
// not where the point before it is.
const latestMove = (way) => {
  for (let index = way.days.length - 1; index > 0; index -= 1) {
    if (Math.abs(way.xs[index] - way.xs[index - 1]) > 1e-6 || Math.abs(way.ys[index] - way.ys[index - 1]) > 1e-6) return way.days[index];
  }
  return way.days[0];
};

// ---- troops going one way together, as one arrow -------------------------------------

// A front may be hundreds of troops thick, and an arrow each would be a
// thicket. Troops of a side that go the same way close together are drawn as
// one arrow along the middle of their ways, the broader for the more of them
// there are. How close counts as together is given in cells and comes from
// how wide an arrow is on screen, so it depends on the zoom: from far off a
// whole offensive is a few broad arrows, and close up each column has its own.

// Where every troop is at every half day of the run, worked out once.
const STEPS_PER_DAY = 2;
const STILL = 0.02;
const tableOf = (stage) => {
  if (stage.table) return stage.table;
  const steps = Math.max(0, Math.round((stage.end - stage.start) * STEPS_PER_DAY));
  const sides = stage.troops.map((list) => list.map((troop) => {
    const { curve } = troop;
    const count = curve.days.length;
    if (count < 2) return null;
    const xs = new Float32Array(steps + 1);
    const ys = new Float32Array(steps + 1);
    const moved = new Uint8Array(steps + 1);
    let point = 1;
    let moves = 0;
    let far = 0;
    for (let step = 0; step <= steps; step += 1) {
      const day = stage.start + step / STEPS_PER_DAY;
      while (point < count - 1 && curve.days[point] < day) point += 1;
      if (day <= curve.days[0]) {
        xs[step] = curve.xs[0];
        ys[step] = curve.ys[0];
      } else if (day >= curve.days[count - 1]) {
        xs[step] = curve.xs[count - 1];
        ys[step] = curve.ys[count - 1];
      } else {
        const leg = curve.days[point] - curve.days[point - 1];
        const along = leg > 0 ? (day - curve.days[point - 1]) / leg : 1;
        xs[step] = curve.xs[point - 1] + (curve.xs[point] - curve.xs[point - 1]) * along;
        ys[step] = curve.ys[point - 1] + (curve.ys[point] - curve.ys[point - 1]) * along;
      }
      if (step > 0) {
        const gone = Math.hypot(xs[step] - xs[step - 1], ys[step] - ys[step - 1]);
        if (gone > STILL) {
          moved[step] = 1;
          moves += 1;
          far += gone;
        }
      }
    }
    return moves > 0 ? { xs, ys, moved, moves, far } : null;
  }));
  stage.table = { steps, sides };
  stage.groups = new Map();
  return stage.table;
};

// Which troops share an arrow, for troops counted as together within `reach`
// cells: [{ side, members }], two or more in each. The troop that goes
// furthest leads, and those that move when it moves and keep within reach of
// it join it; then the next furthest of those left, and so on. Joining is to
// the leader only, never through a chain of neighbours, so a broad front is
// several arrows side by side and not one down its middle.
export const arrowGroupsOf = (stage, reach) => {
  const table = tableOf(stage);
  const key = Math.round(reach * 16);
  const known = stage.groups.get(key);
  if (known) return known;
  const groups = [];
  table.sides.forEach((list, side) => {
    const movers = [];
    list.forEach((entry, index) => {
      if (entry) movers.push(index);
    });
    movers.sort((a, b) => list[b].far - list[a].far || a - b);
    const taken = new Set();
    for (const leader of movers) {
      if (taken.has(leader)) continue;
      const lead = list[leader];
      const members = [leader];
      for (const other of movers) {
        if (other === leader || taken.has(other)) continue;
        const entry = list[other];
        let together = 0;
        let sum = 0;
        let worst = 0;
        for (let step = 1; step <= table.steps; step += 1) {
          if (!lead.moved[step] || !entry.moved[step]) continue;
          const apart = Math.hypot(lead.xs[step] - entry.xs[step], lead.ys[step] - entry.ys[step]);
          together += 1;
          sum += apart;
          if (apart > worst) worst = apart;
          if (worst > reach * 1.7) break;
        }
        if (together >= Math.max(2, 0.5 * Math.min(lead.moves, entry.moves)) && worst <= reach * 1.7 && sum / together <= reach) members.push(other);
      }
      if (members.length < 2) continue;
      for (const member of members) taken.add(member);
      groups.push({ side, members });
    }
  });
  stage.groups.set(key, groups);
  return groups;
};

// The way a group has come by `day`: the middle of its members' ways, from
// just before the first of them set off.
const groupWay = (stage, group, day) => {
  const table = tableOf(stage);
  const entries = group.members.map((member) => table.sides[group.side][member]);
  let first = table.steps;
  for (const entry of entries) {
    for (let step = 1; step <= table.steps; step += 1) {
      if (entry.moved[step]) {
        if (step - 1 < first) first = step - 1;
        break;
      }
    }
  }
  const upTo = Math.min(table.steps, (day - stage.start) * STEPS_PER_DAY);
  if (!(upTo > first)) return null;
  const whole = Math.floor(upTo);
  const xs = [];
  const ys = [];
  const days = [];
  const middleAt = (step, part) => {
    let x = 0;
    let y = 0;
    for (const entry of entries) {
      const next = Math.min(table.steps, step + 1);
      x += entry.xs[step] + (entry.xs[next] - entry.xs[step]) * part;
      y += entry.ys[step] + (entry.ys[next] - entry.ys[step]) * part;
    }
    xs.push(x / entries.length);
    ys.push(y / entries.length);
    days.push(stage.start + (step + part) / STEPS_PER_DAY);
  };
  for (let step = first; step <= whole; step += 1) middleAt(step, 0);
  if (upTo > whole) middleAt(whole, upTo - whole);
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys), days: Float64Array.from(days) };
};

// How much broader than one troop's arrow a group's is, and how near (in
// half-widths of an arrow) two troops must keep to share one.
const groupBreadth = (count) => Math.min(3.4, 1 + 0.45 * Math.sqrt(count - 1));
export const ARROW_MERGE_REACH = 11;

// The ways the troops have come so far this run, as arrows: one for troops
// going the same way together, one each for the rest. `colorsOf(name)` gives
// an arrow's colours for whose troops they are, as { top, side } (css
// colours: its face, and the darker edge that gives it depth);
// `halfWidthOf(drawing)` half the full width of one troop's arrow in that
// battlefield's cells; `day` the day each drawing is of (left out, each arrow
// is drawn for the day its troop reached). A way is written out as two things:
// an arrow along its last few days, and a line (`past`) along what was walked
// before them. `troops` is how many share it.
export const frontArrowFeatures = (shown, colorsOf, { day = null, halfWidthOf = () => 0.5 } = {}) => {
  const features = [];
  shown.forEach((drawing, at) => {
    if (!drawing) return;
    const { toLngLat, stage } = drawing;
    const halfWidth = halfWidthOf(drawing);
    const now = Array.isArray(day) ? day[at] : day;
    const put = (way, when, breadth, properties) => {
      // Where the last few days of the way begin: it is cut in two there.
      const since = when - ARROW_FRESH_DAYS;
      const count = way.days.length;
      let first = 0;
      while (first + 1 < count && way.days[first + 1] <= since) first += 1;
      let past = null;
      let recent = way;
      if (way.days[0] < since) {
        if (way.days[count - 1] <= since) {
          past = way;
          recent = null;
        } else {
          const span = way.days[first + 1] - way.days[first];
          const part = span > 0 ? (since - way.days[first]) / span : 0;
          const cutX = way.xs[first] + (way.xs[first + 1] - way.xs[first]) * part;
          const cutY = way.ys[first] + (way.ys[first + 1] - way.ys[first]) * part;
          past = { xs: [...way.xs.subarray(0, first + 1), cutX], ys: [...way.ys.subarray(0, first + 1), cutY] };
          recent = {
            xs: Float64Array.of(cutX, ...way.xs.subarray(first + 1)),
            ys: Float64Array.of(cutY, ...way.ys.subarray(first + 1)),
            days: Float64Array.of(since, ...way.days.subarray(first + 1)),
          };
        }
      }
      if (past) {
        const line = [];
        for (let index = 0; index < past.xs.length; index += 1) {
          const last = line.length - 1;
          if (last >= 0 && Math.abs(past.xs[index] - past.xs[index - 1]) < 1e-6 && Math.abs(past.ys[index] - past.ys[index - 1]) < 1e-6) continue;
          line.push(toLngLat(past.xs[index], past.ys[index]));
        }
        if (line.length >= 2) {
          features.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { battlefield: drawing.name, ...properties, past: true } });
        }
      }
      const ring = recent ? arrowRing(recent, when, halfWidth * breadth) : null;
      if (!ring) return;
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring.map(([x, y]) => toLngLat(x, y))] },
        properties: { battlefield: drawing.name, ...properties, past: false },
      });
    };
    // Those that share an arrow, on the day this drawing is of.
    const grouped = [new Set(), new Set()];
    if (stage && now !== null && now !== undefined) {
      for (const group of arrowGroupsOf(stage, halfWidth * ARROW_MERGE_REACH)) {
        const present = group.members.filter((member) => drawing.troops[group.side][member]);
        if (present.length < 2) continue;
        const way = groupWay(stage, group, now);
        if (!way) continue;
        for (const member of group.members) grouped[group.side].add(member);
        const lead = drawing.troops[group.side][present[0]];
        const colours = colorsOf(lead.owner);
        put(way, now, groupBreadth(present.length), {
          side: group.side,
          index: group.members[0],
          troops: present.length,
          rgb: colours.top,
          dark: colours.side,
          moving: present.some((member) => drawing.troops[group.side][member].moving),
        });
      }
    }
    drawing.troops.forEach((list, side) => list.forEach((troop, index) => {
      if (!troop?.way || grouped[side].has(index)) return;
      const colours = colorsOf(troop.owner);
      put(troop.way, now ?? troop.way.days[troop.way.days.length - 1], 1, { side, index, troops: 1, rgb: colours.top, dark: colours.side, moving: troop.moving });
    }));
  });
  return features.length ? { type: "FeatureCollection", features } : EMPTY;
};

// A side's colour as its arrows are drawn in: the same hue, made strong and
// neither dark nor pale. A country's own colour is chosen to fill land, and an
// arrow in it would not show on ground painted that colour.
export const frontArrowRgb = ([red, green, blue]) => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const most = Math.max(r, g, b);
  const least = Math.min(r, g, b);
  const spread = most - least;
  let lightness = (most + least) / 2;
  if (spread < 0.04) {
    // No hue to speak of: a grey stays grey, only lighter.
    const grey = Math.round(255 * Math.max(0.7, lightness));
    return [grey, grey, grey];
  }
  let hue;
  if (most === r) hue = ((g - b) / spread + 6) % 6;
  else if (most === g) hue = (b - r) / spread + 2;
  else hue = (r - g) / spread + 4;
  const saturation = Math.max(0.55, spread / (1 - Math.abs(2 * lightness - 1)));
  lightness = Math.min(0.62, Math.max(0.52, lightness));
  const chroma = (1 - Math.abs(2 * lightness - 1)) * Math.min(1, saturation);
  const second = chroma * (1 - Math.abs((hue % 2) - 1));
  const base = lightness - chroma / 2;
  const [r1, g1, b1] = hue < 1 ? [chroma, second, 0] : hue < 2 ? [second, chroma, 0] : hue < 3 ? [0, chroma, second]
    : hue < 4 ? [0, second, chroma] : hue < 5 ? [second, 0, chroma] : [chroma, 0, second];
  return [Math.round((r1 + base) * 255), Math.round((g1 + base) * 255), Math.round((b1 + base) * 255)];
};
