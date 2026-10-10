/*! Open Historia — battlefields on the map: the ground troops have taken, as paint © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// There is no front line on the map. A troop takes the ground around the way
// it walks, and that ground is drawn in its country's colour: the front is
// where the colours meet. A battlefield's replay keeps the painted ground as
// its run began and every cell that changed afterwards with its time
// (runtime/fronts/replay.js). This plays that to any moment of the run and
// turns it into pixels, a few to a cell, for a picture laid over the
// battlefield's frame (FrontLayers.jsx). Pure, and loads in plain Node.
//
// A cell is taken at one moment, but its colour GROWS into it over the part of
// a day after, and the picture is drawn finer than the cells with the edge
// placed between them by how far each is the one side's or the other's. So the
// colour spreads round a troop as it goes instead of arriving a square at a
// time, and an edge that runs aslant across the cells is drawn as a slant.

import { PAINT_OWN_A, PAINT_OWN_B, PAINT_TICKS_PER_DAY, PAINT_WALL } from "../../runtime/fronts/codec.js";

// How long, in days, a cell takes to fill once it is taken.
export const FILL_DAYS = 0.75;
// How wide the soft step across the edge of the colour is, as a part of the
// way from all one side's to all the other's.
const EDGE_HALF_WIDTH = 0.1;
const LONG_AGO = -1e6;

const isPaint = (value) => value !== PAINT_OWN_A && value !== PAINT_OWN_B && value !== PAINT_WALL;

// The painted ground of a battlefield (record.js frontViewOf), to be played:
//
//   state[cell]   what the cell is now: a side's own ground, painted in a
//                 name (1 + its index in `names`), or wall
//   since[cell]   the day it became so
//   was[cell]     what it was before that
//   bounds        the cells that are painted at any time in the run, as
//                 { minCol, maxCol, minRow, maxRow }, or null when none is
//   sideOf(state) which side a state is the ground of: 0 or 1
export const createPaintPlayer = (view) => {
  const { cols, rows } = view.frame;
  const paint = view.replay?.paint ?? null;
  const size = cols * rows;
  const state = new Uint8Array(size);
  const since = new Float32Array(size);
  const was = new Uint8Array(size);
  // The names are side 0's members and then side 1's.
  const firstOfB = (view.sides?.[0]?.length ?? 0) + 1;
  let applied = 0;
  let day = -Infinity;

  let bounds = null;
  const reach = (cell) => {
    const col = cell % cols;
    const row = (cell - col) / cols;
    if (!bounds) bounds = { minCol: col, maxCol: col, minRow: row, maxRow: row };
    else {
      if (col < bounds.minCol) bounds.minCol = col;
      if (col > bounds.maxCol) bounds.maxCol = col;
      if (row < bounds.minRow) bounds.minRow = row;
      if (row > bounds.maxRow) bounds.maxRow = row;
    }
  };
  if (paint) {
    const began = paint.began;
    for (let cell = 0; cell < size && cell < began.length; cell += 1) if (isPaint(began[cell])) reach(cell);
    for (let index = 0; index < paint.cells.length; index += 1) if (paint.cells[index] < size) reach(paint.cells[index]);
  }

  const reset = () => {
    if (paint) state.set(paint.began.subarray(0, size));
    else state.fill(PAINT_WALL);
    was.set(state);
    since.fill(LONG_AGO);
    applied = 0;
  };
  reset();

  return {
    cols,
    rows,
    names: paint?.names ?? [],
    state,
    since,
    was,
    sideOf: (value) => (value === PAINT_OWN_A ? 0 : value === PAINT_OWN_B ? 1 : value < firstOfB ? 0 : 1),
    get bounds() { return bounds; },
    get day() { return day; },
    // Brings the ground to a day of the run (a fraction of a day is fine).
    seek(to) {
      if (!paint) return;
      if (to < day) reset();
      day = to;
      const tick = to * PAINT_TICKS_PER_DAY;
      while (applied < paint.cells.length && paint.ticks[applied] <= tick) {
        const cell = paint.cells[applied];
        if (cell < size) {
          was[cell] = state[cell];
          state[cell] = paint.states[applied];
          since[cell] = paint.ticks[applied] / PAINT_TICKS_PER_DAY;
        }
        applied += 1;
      }
    },
  };
};

// How many pixels to a cell: enough for a smooth edge, and no more than a
// picture about a thousand pixels across.
export const paintScaleFor = (cols, rows) => Math.max(2, Math.min(6, Math.floor(1024 / Math.max(cols, rows, 1))));

// The painted ground at the player's day, written into `target.data` (RGBA,
// `target.width` by `target.height`, north up, `target.scale` pixels a cell).
// `palette` holds four bytes a state: its colour, and how solid it is drawn.
// `target.rowOf[y]`, when given, is where in the frame (in rows from its south
// edge) the middle of pixel row y lies, for a frame whose rows are not evenly
// spaced on the map; left out, they are. Returns the pixels written, as
// { x, y, width, height }, or null when nothing is painted in this run.
//
// Every cell of land is one side's or the other's, or on its way from one to
// the other, and the edge of the colour is drawn where that crosses half-way.
// So paint ends against the other side's ground in a smooth edge, but against
// its own side's home ground it does not end at all: it runs on a little way
// over that ground, which is the same colour, and leaves no sliver of the
// other side's colour along the old border.
export const paintPixels = (player, palette, target) => {
  const { cols, rows, state, since, was, bounds, day, sideOf } = player;
  if (!bounds) return null;
  const { data, width, height, scale, rowOf } = target;
  const size = cols * rows;

  const minCol = Math.max(0, bounds.minCol - 1);
  const maxCol = Math.min(cols - 1, bounds.maxCol + 1);
  const minRow = Math.max(0, bounds.minRow - 1);
  const maxRow = Math.min(rows - 1, bounds.maxRow + 1);
  if (!target.share || target.share.length !== size) {
    // How far each cell is side 0's (1) and not side 1's (0); the same evened
    // out; the colour it is painted in, if any; and how full of it it is.
    target.share = new Float32Array(size);
    target.even = new Float32Array(size);
    target.tint = new Uint8Array(size);
    target.full = new Float32Array(size);
  }
  const { share, even, tint, full } = target;
  // One cell further out than is drawn, so the evening out has what lies
  // beside the outermost cells to go by.
  const fromCol = Math.max(0, minCol - 1);
  const toCol = Math.min(cols - 1, maxCol + 1);
  const fromRow = Math.max(0, minRow - 1);
  const toRow = Math.min(rows - 1, maxRow + 1);
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let col = fromCol; col <= toCol; col += 1) {
      const cell = row * cols + col;
      const now = state[cell];
      if (now === PAINT_WALL) {
        tint[cell] = PAINT_WALL;
        full[cell] = 0;
        share[cell] = 0;
        continue;
      }
      const before = was[cell];
      const part = (day - since[cell]) / FILL_DAYS;
      // How far the change to what it is now has got: all the way, unless it
      // changed sides a moment ago.
      const turned = before !== PAINT_WALL && sideOf(before) !== sideOf(now) && part < 1 ? Math.max(0, part) : 1;
      share[cell] = sideOf(now) === 0 ? turned : 1 - turned;
      if (isPaint(now)) {
        tint[cell] = now;
        full[cell] = turned;
      } else if (isPaint(before) && turned < 1) {
        // Taken back: the colour it was painted in drains out of it.
        tint[cell] = before;
        full[cell] = 1 - turned;
      } else {
        tint[cell] = 0;
        full[cell] = 0;
      }
    }
  }
  // Each cell evened out with the eight round it, so that an edge that runs
  // aslant across the cells is drawn as a slant and not as a stair. Sea has no
  // say: a cell beside it is evened out with the land round it only, and the
  // colour runs full to the coast.
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let col = fromCol; col <= toCol; col += 1) {
      const cell = row * cols + col;
      if (tint[cell] === PAINT_WALL) {
        even[cell] = 0;
        continue;
      }
      let sum = share[cell] * 4;
      let weight = 4;
      for (let dy = -1; dy <= 1; dy += 1) {
        const r = row + dy;
        if (r < fromRow || r > toRow) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const c = col + dx;
          if ((dx === 0 && dy === 0) || c < fromCol || c > toCol) continue;
          const other = r * cols + c;
          if (tint[other] === PAINT_WALL) continue;
          const part = dx === 0 || dy === 0 ? 2 : 1;
          sum += share[other] * part;
          weight += part;
        }
      }
      even[cell] = sum / weight;
    }
  }

  const x0 = minCol * scale;
  const x1 = Math.min(width, (maxCol + 1) * scale);
  // Pixel rows run from the north; the frame's rows from the south. Where the
  // rows are not evenly spaced there is no telling which pixel rows they
  // fill without asking each, so all are drawn.
  const y0 = rowOf ? 0 : Math.max(0, height - (maxRow + 1) * scale);
  const y1 = rowOf ? height : Math.min(height, height - minRow * scale);
  const low = 0.5 - EDGE_HALF_WIDTH;
  const span = EDGE_HALF_WIDTH * 2;
  for (let y = y0; y < y1; y += 1) {
    const v = rowOf ? rowOf[y] : rows - (y + 0.5) / scale;
    const ownRow = Math.floor(v);
    const at = y * width * 4;
    if (ownRow < minRow || ownRow > maxRow) {
      for (let x = x0; x < x1; x += 1) data[at + x * 4 + 3] = 0;
      continue;
    }
    // The two rows of cells whose middles the pixel lies between.
    const rowA = Math.max(fromRow, Math.min(toRow, Math.floor(v - 0.5)));
    const rowB = Math.max(fromRow, Math.min(toRow, rowA + 1));
    const fv = Math.max(0, Math.min(1, v - 0.5 - rowA));
    for (let x = x0; x < x1; x += 1) {
      const u = (x + 0.5) / scale;
      const ownCol = Math.floor(u);
      const pixel = at + x * 4;
      const own = ownRow * cols + ownCol;
      // Sea, and land that is nobody's in this war, is never painted.
      if (tint[own] === PAINT_WALL) {
        data[pixel + 3] = 0;
        continue;
      }
      const colA = Math.max(fromCol, Math.min(toCol, Math.floor(u - 0.5)));
      const colB = Math.max(fromCol, Math.min(toCol, colA + 1));
      const fu = Math.max(0, Math.min(1, u - 0.5 - colA));
      const c00 = rowA * cols + colA;
      const c10 = rowA * cols + colB;
      const c01 = rowB * cols + colA;
      const c11 = rowB * cols + colB;
      // The colour is that of the fullest painted cell of the four round the
      // pixel, its own first. With none of them painted there is no paint here.
      let best = full[own] > 0 ? own : -1;
      let most = best >= 0 ? full[own] : 0;
      if (full[c00] > most) { best = c00; most = full[c00]; }
      if (full[c10] > most) { best = c10; most = full[c10]; }
      if (full[c01] > most) { best = c01; most = full[c01]; }
      if (full[c11] > most) { best = c11; most = full[c11]; }
      if (best < 0) {
        data[pixel + 3] = 0;
        continue;
      }
      // A neighbour that is sea says nothing: the colour runs to the coast
      // as it stands in the pixel's own cell.
      const e00 = tint[c00] === PAINT_WALL ? even[own] : even[c00];
      const e10 = tint[c10] === PAINT_WALL ? even[own] : even[c10];
      const e01 = tint[c01] === PAINT_WALL ? even[own] : even[c01];
      const e11 = tint[c11] === PAINT_WALL ? even[own] : even[c11];
      const sideZero = (e00 * (1 - fu) + e10 * fu) * (1 - fv) + (e01 * (1 - fu) + e11 * fu) * fv;
      const colourState = tint[best];
      const value = sideOf(colourState) === 0 ? sideZero : 1 - sideZero;
      if (value <= low) {
        data[pixel + 3] = 0;
        continue;
      }
      let solid = (value - low) / span;
      if (solid > 1) solid = 1;
      // A smooth step, so the edge is neither a stair nor a blur.
      solid = solid * solid * (3 - 2 * solid);
      const colour = colourState * 4;
      data[pixel] = palette[colour];
      data[pixel + 1] = palette[colour + 1];
      data[pixel + 2] = palette[colour + 2];
      data[pixel + 3] = Math.round(palette[colour + 3] * solid);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};
