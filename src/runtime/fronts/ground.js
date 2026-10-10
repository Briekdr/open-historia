/*! Open Historia — battlefields and fronts: how far it is over the ground © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A troop that is not on the line still has to know where the line is: how far
// off the other side's ground lies and which way, how far the ground it is to
// close on, how far its own side's supplied ground when it is cut off. Those
// are distances over the whole frame, and they are worked out here, once for
// each change of the ground, as whole numbers: a 3-4 chamfer, two passes over
// the cells, which is near enough to round and the same on every machine.
//
// A distance is kept in THIRDS of a cell (so a step along a row is 3 and a
// step on the diagonal 4); `cellsOf` reads one in cells.

import { FAR_CELLS, HOLDER_SIDE_A, HOLDER_SIDE_B } from "./constants.js";
import { readField } from "./field.js";

export const FAR_THIRDS = 1 << 28;

// How far each cell is from the nearest source cell, into `out` (an Int32Array).
export const distanceFrom = (cols, rows, isSource, out) => {
  const size = cols * rows;
  for (let cell = 0; cell < size; cell += 1) out[cell] = isSource(cell) ? 0 : FAR_THIRDS;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = row * cols + col;
      let best = out[cell];
      if (col > 0 && out[cell - 1] + 3 < best) best = out[cell - 1] + 3;
      if (row > 0) {
        if (out[cell - cols] + 3 < best) best = out[cell - cols] + 3;
        if (col > 0 && out[cell - cols - 1] + 4 < best) best = out[cell - cols - 1] + 4;
        if (col < cols - 1 && out[cell - cols + 1] + 4 < best) best = out[cell - cols + 1] + 4;
      }
      out[cell] = best;
    }
  }
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      const cell = row * cols + col;
      let best = out[cell];
      if (col < cols - 1 && out[cell + 1] + 3 < best) best = out[cell + 1] + 3;
      if (row < rows - 1) {
        if (out[cell + cols] + 3 < best) best = out[cell + cols] + 3;
        if (col < cols - 1 && out[cell + cols + 1] + 4 < best) best = out[cell + cols + 1] + 4;
        if (col > 0 && out[cell + cols - 1] + 4 < best) best = out[cell + cols - 1] + 4;
      }
      out[cell] = best;
    }
  }
  return out;
};

// The same, keeping for each cell WHICH source is nearest it: `labels` holds a
// number for every source cell and -1 for the rest; `outLabel` takes the
// number of the nearest.
export const nearestOf = (cols, rows, labels, out, outLabel) => {
  const size = cols * rows;
  for (let cell = 0; cell < size; cell += 1) {
    out[cell] = labels[cell] >= 0 ? 0 : FAR_THIRDS;
    outLabel[cell] = labels[cell];
  }
  const take = (cell, from, cost) => {
    if (out[from] + cost < out[cell]) {
      out[cell] = out[from] + cost;
      outLabel[cell] = outLabel[from];
    }
  };
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = row * cols + col;
      if (col > 0) take(cell, cell - 1, 3);
      if (row > 0) {
        take(cell, cell - cols, 3);
        if (col > 0) take(cell, cell - cols - 1, 4);
        if (col < cols - 1) take(cell, cell - cols + 1, 4);
      }
    }
  }
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      const cell = row * cols + col;
      if (col < cols - 1) take(cell, cell + 1, 3);
      if (row < rows - 1) {
        take(cell, cell + cols, 3);
        if (col < cols - 1) take(cell, cell + cols + 1, 4);
        if (col > 0) take(cell, cell + cols - 1, 4);
      }
    }
  }
};

// How far each cell is from each side's ground: battle.toSide[side]. Worked
// out again only when ground has changed hands.
export const measure = (battle) => {
  const { field } = battle;
  if (battle.measuredFor === field && battle.measured === field.turns) return battle.toSide;
  if (battle.measuredFor !== field) battle.toSide = [new Int32Array(field.size), new Int32Array(field.size)];
  for (const side of [HOLDER_SIDE_A, HOLDER_SIDE_B]) distanceFrom(field.cols, field.rows, (cell) => field.holders[cell] === side, battle.toSide[side]);
  battle.measuredFor = field;
  battle.measured = field.turns;
  return battle.toSide;
};

export const cellAt = (field, x, y) => (x >= 0 && y >= 0 && x < field.cols && y < field.rows ? Math.floor(y) * field.cols + Math.floor(x) : -1);

// One of these distances at a point, in cells; the frame's edge stands for
// what lies beyond it.
export const cellsOf = (field, grid, x, y) => {
  const col = x < 0 ? 0 : x >= field.cols ? field.cols - 1 : Math.floor(x);
  const row = y < 0 ? 0 : y >= field.rows ? field.rows - 1 : Math.floor(y);
  return grid[row * field.cols + col] / 3;
};

// The way such a distance falls away fastest from a point, as a unit vector
// through `out`; false where it is level.
export const downhill = (field, grid, x, y, out) => {
  const dx = cellsOf(field, grid, x - 1.5, y) - cellsOf(field, grid, x + 1.5, y);
  const dy = cellsOf(field, grid, x, y - 1.5) - cellsOf(field, grid, x, y + 1.5);
  const length = Math.sqrt(dx * dx + dy * dy);
  out[0] = length > 0 ? dx / length : 0;
  out[1] = length > 0 ? dy / length : 0;
  return length > 0;
};

// How far a troop of a side stands from the other side's ground, in cells: 0
// when it is on it. Near the line this is read off the field itself, which
// knows where inside a cell the line runs; further off, off the chamfer.
export const awayOf = (battle, side, x, y) => {
  const { field } = battle;
  const cell = cellAt(field, x, y);
  if (cell < 0 || field.holders[cell] !== side) return 0;
  const near = Math.abs(readField(field, x, y));
  return near < FAR_CELLS - 1 ? near : battle.toSide[1 - side][cell] / 3;
};

// The cheapest way over ground in play from one cell to another, by what the
// ground costs to cross: a list of cells from the first to the last, or null
// when there is no way. Cells are settled in order of cost and, at equal cost,
// of index, so the same ground always gives the same way.
export const cheapestWay = (battle, from, to) => {
  const { field, arena } = battle;
  const { cols, rows, size, play } = field;
  if (from < 0 || to < 0 || !play[from] || !play[to]) return null;
  const cost = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const heap = [from];
  cost[from] = 0;
  const before = (a, b) => cost[a] < cost[b] || (cost[a] === cost[b] && a < b);
  const settled = new Uint8Array(size);
  while (heap.length > 0) {
    const index = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        const right = left + 1;
        let least = at;
        if (left < heap.length && before(heap[left], heap[least])) least = left;
        if (right < heap.length && before(heap[right], heap[least])) least = right;
        if (least === at) break;
        [heap[at], heap[least]] = [heap[least], heap[at]];
        at = least;
      }
    }
    if (settled[index]) continue;
    settled[index] = 1;
    if (index === to) break;
    const col = index % cols;
    const row = (index - col) / cols;
    for (let dy = -1; dy <= 1; dy += 1) {
      const y = row + dy;
      if (y < 0 || y >= rows) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = col + dx;
        const next = y * cols + x;
        if ((dx === 0 && dy === 0) || x < 0 || x >= cols || !play[next] || settled[next]) continue;
        const step = (dx !== 0 && dy !== 0 ? 1.4142135623730951 : 1) * (0.5 / arena.speed[index] + 0.5 / arena.speed[next]);
        if (!(cost[index] + step < cost[next])) continue;
        cost[next] = cost[index] + step;
        parent[next] = index;
        heap.push(next);
        for (let at = heap.length - 1; at > 0;) {
          const up = (at - 1) >> 1;
          if (!before(heap[at], heap[up])) break;
          [heap[at], heap[up]] = [heap[up], heap[at]];
          at = up;
        }
      }
    }
  }
  if (!settled[to]) return null;
  const way = [];
  for (let index = to; index >= 0; index = parent[index]) way.push(index);
  return way.reverse();
};
