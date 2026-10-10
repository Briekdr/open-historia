/*! Open Historia — battlefields and fronts: the line, measured and drawn © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The field's contour is the line as the engine knows it: a vertex on every
// crossing between two cells. Two things are made from it here.
//
// The MEASURED line is what the rest of the engine plans by: how far along the
// line each vertex is, in kilometres, and which way the line faces there. The
// normal always points from side A's ground toward side B's.
//
// The DRAWN line is what the map is given: the same strands with their corners
// rounded and the vertices nothing turns on left out, each stretch marked as
// quiet, moved or being pushed. Side A's ground stays on the left of every
// strand's direction of travel, as the contour has it: rounding and thinning
// keep the order of the vertices, and the map colours each side by that rule.

import { HOLDER_SIDE_A, LINE_MOVED, LINE_PUSHED_BY_A, LINE_PUSHED_BY_B, LINE_QUIET, LINE_SIMPLIFY_CELLS } from "./constants.js";
import { projectorOf } from "./frame.js";

// The line with distances along it.
//
//   line {
//     contour, count
//     km        how far along the line a vertex is, running on from strand to strand
//     nx, ny    the unit normal there, from side A's ground toward side B's
//     strand    which strand a vertex is on
//     total     the length of the whole line, in kilometres
//   }
export const measureLine = (field, contour) => {
  if (contour.measured) return contour.measured;
  const { kmAt } = projectorOf(field.arena.frame);
  const count = contour.x.length;
  const km = new Float64Array(count);
  const nx = new Float64Array(count);
  const ny = new Float64Array(count);
  const strand = new Int32Array(count);
  let total = 0;
  for (let index = 0; index < contour.strands.length; index += 1) {
    const { first, count: length, closed } = contour.strands[index];
    const segments = closed ? length : length - 1;
    for (let step = 0; step < length; step += 1) strand[first + step] = index;
    for (let step = 0; step < segments; step += 1) {
      const from = first + step;
      const to = first + ((step + 1) % length);
      const dx = contour.x[to] - contour.x[from];
      const dy = contour.y[to] - contour.y[from];
      const cells = Math.sqrt(dx * dx + dy * dy);
      km[from] = total;
      total += cells * kmAt((contour.y[from] + contour.y[to]) / 2);
      // The line's normal is its direction turned to the right: side A is on its left.
      if (cells > 0) {
        nx[from] += dy / cells;
        ny[from] -= dx / cells;
        nx[to] += dy / cells;
        ny[to] -= dx / cells;
      }
    }
    if (!closed && length > 0) km[first + length - 1] = total;
  }
  for (let vertex = 0; vertex < count; vertex += 1) {
    const length = Math.sqrt(nx[vertex] * nx[vertex] + ny[vertex] * ny[vertex]);
    if (length > 0) {
      nx[vertex] /= length;
      ny[vertex] /= length;
    }
  }
  contour.measured = { contour, count, km, nx, ny, strand, total };
  return contour.measured;
};

// How each vertex of the contour is to be marked.
//   quiet(cellA, cellB)   whether the two cells either side of a vertex are each
//                         held by the side that controls their own region: the
//                         line still lies on the border there
//   swept                 a pair, a side each: the day each cell last had ground
//                         swept near it, and `day` the day to mark
export const flagLine = (field, contour, quiet, swept, day) => {
  const count = contour.x.length;
  const flags = new Uint8Array(count);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const cellA = contour.cellA[vertex];
    const cellB = contour.cellB[vertex];
    if (cellA < 0) {
      flags[vertex] = 255;
      continue;
    }
    const byA = swept !== null && (swept[0][cellA] === day || swept[0][cellB] === day);
    const byB = swept !== null && (swept[1][cellA] === day || swept[1][cellB] === day);
    flags[vertex] = byA ? LINE_PUSHED_BY_A : byB ? LINE_PUSHED_BY_B : quiet(cellA, cellB) ? LINE_QUIET : LINE_MOVED;
  }
  // Where a strand meets a wall it is marked as the stretch that leads to it.
  for (const { first, count: length } of contour.strands) {
    for (let step = 0; step < length; step += 1) {
      if (flags[first + step] !== 255) continue;
      const before = step > 0 ? flags[first + step - 1] : 255;
      flags[first + step] = before !== 255 ? before : LINE_MOVED;
    }
    for (let step = length - 2; step >= 0; step -= 1) {
      if (contour.cellA[first + step] < 0 && contour.cellA[first + step + 1] >= 0) flags[first + step] = flags[first + step + 1];
    }
  }
  return flags;
};

// One pass of corner cutting: every stretch gives a point a quarter and three
// quarters of the way along it, each marked as the end it is nearer. An open
// strand keeps its two ends where they are.
const cutCorners = (points, flags, closed) => {
  const count = points.length / 2;
  if (count < 3) return { points, flags };
  const nextPoints = [];
  const nextFlags = [];
  const segments = closed ? count : count - 1;
  if (!closed) {
    nextPoints.push(points[0], points[1]);
    nextFlags.push(flags[0]);
  }
  for (let index = 0; index < segments; index += 1) {
    const other = (index + 1) % count;
    const ax = points[index * 2];
    const ay = points[index * 2 + 1];
    const bx = points[other * 2];
    const by = points[other * 2 + 1];
    nextPoints.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
    nextFlags.push(flags[index], flags[other]);
  }
  if (!closed) {
    nextPoints.push(points[count * 2 - 2], points[count * 2 - 1]);
    nextFlags.push(flags[count - 1]);
  }
  return { points: nextPoints, flags: nextFlags };
};

// Marks the vertices to keep between two that are kept: the one farthest from
// the straight stretch between them, if it is farther than the tolerance, and
// so on either side of it.
const thin = (points, keep, from, to) => {
  const spans = [from, to];
  while (spans.length > 0) {
    const last = spans.pop();
    const first = spans.pop();
    if (last - first < 2) continue;
    const ax = points[first * 2];
    const ay = points[first * 2 + 1];
    const bx = points[last * 2] - ax;
    const by = points[last * 2 + 1] - ay;
    const length = bx * bx + by * by;
    let worst = 0;
    let at = -1;
    for (let index = first + 1; index < last; index += 1) {
      const px = points[index * 2] - ax;
      const py = points[index * 2 + 1] - ay;
      let along = length > 0 ? (px * bx + py * by) / length : 0;
      along = along < 0 ? 0 : along > 1 ? 1 : along;
      const ox = px - bx * along;
      const oy = py - by * along;
      const off = ox * ox + oy * oy;
      if (off > worst) {
        worst = off;
        at = index;
      }
    }
    if (at < 0 || worst <= LINE_SIMPLIFY_CELLS * LINE_SIMPLIFY_CELLS) continue;
    keep[at] = 1;
    spans.push(first, at, at, last);
  }
};

// The line as the map is to draw it: [{ closed, points: [[x, y]], flags }], a
// strand of the contour each, in the contour's order and direction.
export const drawLine = (contour, flags) => {
  const drawn = [];
  for (const { first, count, closed } of contour.strands) {
    let points = [];
    let marks = [];
    for (let step = 0; step < count; step += 1) {
      points.push(contour.x[first + step], contour.y[first + step]);
      marks.push(flags[first + step]);
    }
    for (let pass = 0; pass < 2; pass += 1) ({ points, flags: marks } = cutCorners(points, marks, closed));
    // A closed strand is thinned as an open one that ends where it begins.
    if (closed) {
      points.push(points[0], points[1]);
      marks.push(marks[0]);
    }
    const length = marks.length;
    const keep = new Uint8Array(length);
    keep[0] = 1;
    keep[length - 1] = 1;
    // A vertex where the marking changes is kept, so no stretch is marked wrongly.
    let from = 0;
    for (let index = 1; index < length; index += 1) {
      if (index < length - 1 && marks[index] === marks[index + 1] && marks[index] === marks[index - 1]) continue;
      keep[index] = 1;
      thin(points, keep, from, index);
      from = index;
    }
    const strand = { closed, points: [], flags: [] };
    const last = closed ? length - 1 : length;
    for (let index = 0; index < last; index += 1) {
      if (!keep[index]) continue;
      strand.points.push([points[index * 2], points[index * 2 + 1]]);
      strand.flags.push(marks[index]);
    }
    if (strand.points.length >= (closed ? 3 : 2)) drawn.push(strand);
  }
  return drawn;
};

// Whether two drawings of the line would be the same drawing: the same
// contour, marked the same.
export const sameFlags = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
};

// The side of the line a vertex's own cell is on, for whoever plans by it.
export const ownCellAt = (contour, vertex, side) => (side === HOLDER_SIDE_A ? contour.cellA[vertex] : contour.cellB[vertex]);
