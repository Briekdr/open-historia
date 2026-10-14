/*! Open Historia — the map's weather and ice, drawn as tiles © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The small pictures the map repeats over an area to say what is there
// (fill-pattern): ice with cracks in it, water that can freeze, and each kind
// of weather over a battlefield, and the chip a battlefield's weather is
// written on. Each is drawn here pixel by pixel in flat colours, with no fade
// anywhere, and wraps at its edges, so the tiles meet without a seam.
//
// A weather picture is drawn at a STEP of its drift: rain falls aslant, snow
// drifts down, a blizzard is driven across, fog creeps and the heat's shimmer
// runs along its lines, each by moving the same marks a few pixels a step. The
// map sets the weather going by handing it the next step
// (FrontWeatherLayers.jsx); the same step is always the same picture, and a
// state that lies on the ground (mud, frost) does not move.
//
// The map draws at one pixel to a pixel (World.jsx pixelRatio), so these are
// added at a pixel ratio of 1: a line a pixel wide stays one.
//
// Pure: { width, height, data } a picture, as map.addImage takes it.

export const WEATHER_TILE = 64;
export const ICE_TILE = 128;
export const ICE_HINT_TILE = 32;
export const CHIP_TILE = 24;

export const ICE_IMAGE = "oh-ice";
export const ICE_HINT_IMAGE = "oh-ice-hint";
export const WEATHER_CHIP_IMAGE = "oh-weather-chip";
export const weatherImageId = (state) => `oh-weather-${state}`;

// How far a weather picture moves from one step to the next, in pixels,
// [across, down]: rain falls the way its streaks lean, a storm's faster; snow
// drifts down and a blizzard is driven across; fog creeps, and the heat's
// shimmer runs along its lines. Mud and frost lie on the ground and keep still.
export const WEATHER_DRIFT = Object.freeze({
  rain: Object.freeze([-1, 3]),
  storm: Object.freeze([-2, 5]),
  snow: Object.freeze([0, 1]),
  blizzard: Object.freeze([4, 1]),
  fog: Object.freeze([1, 0]),
  heat: Object.freeze([1, 0]),
});
export const WEATHER_DRAWN = Object.freeze(["rain", "storm", "snow", "blizzard", "fog", "mud", "heat", "frost"]);

const picture = (width, height = width) => ({ width, height, data: new Uint8Array(width * height * 4) });
const wrap = (value, size) => ((value % size) + size) % size;

// One pixel set to a colour, wherever it falls: off one edge is on the other.
const plot = (image, x, y, colour) => {
  const at = (wrap(Math.round(y), image.height) * image.width + wrap(Math.round(x), image.width)) * 4;
  image.data[at] = colour[0];
  image.data[at + 1] = colour[1];
  image.data[at + 2] = colour[2];
  image.data[at + 3] = colour[3];
};

// A line a pixel wide (Bresenham's), wrapping as plot does.
const line = (image, fromX, fromY, toX, toY, colour) => {
  let x = Math.round(fromX);
  let y = Math.round(fromY);
  const endX = Math.round(toX);
  const endY = Math.round(toY);
  const dx = Math.abs(endX - x);
  const dy = -Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = dx + dy;
  for (let guard = 0; guard < 4096; guard += 1) {
    plot(image, x, y, colour);
    if (x === endX && y === endY) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += stepX;
    }
    if (twice <= dx) {
      error += dx;
      y += stepY;
    }
  }
};

// A filled ellipse round (x, y), wrapping.
const blot = (image, x, y, radiusX, radiusY, colour) => {
  for (let dy = -Math.ceil(radiusY); dy <= Math.ceil(radiusY); dy += 1) {
    for (let dx = -Math.ceil(radiusX); dx <= Math.ceil(radiusX); dx += 1) {
      if ((dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1) plot(image, x + dx, y + dy, colour);
    }
  }
};

// The same marks every time: a small seeded generator (mulberry32), so a
// picture is the same on every map and in every test.
const marks = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const RAIN = [198, 218, 240, 220];
const STORM_RAIN = [178, 198, 226, 235];
const FLAKE = [250, 252, 255, 240];
const DRIVEN = [236, 242, 250, 210];
const FOG = [208, 213, 220, 120];
const MUD = [112, 80, 46, 205];
const MUD_DARK = [86, 60, 34, 225];
const SHIMMER = [255, 230, 176, 170];
const FROST = [226, 240, 255, 235];

// Each weather's marks, drawn moved by (shiftX, shiftY).
const DRAW = {
  // Streaks leaning the way the rain falls.
  rain: (image, shiftX, shiftY) => {
    const next = marks(11);
    for (let count = 0; count < 12; count += 1) {
      const x = next() * WEATHER_TILE + shiftX;
      const y = next() * WEATHER_TILE + shiftY;
      const length = 7 + Math.floor(next() * 4);
      line(image, x, y, x - length / 3, y + length, RAIN);
    }
  },
  // More of them, longer and closer.
  storm: (image, shiftX, shiftY) => {
    const next = marks(23);
    for (let count = 0; count < 26; count += 1) {
      const x = next() * WEATHER_TILE + shiftX;
      const y = next() * WEATHER_TILE + shiftY;
      const length = 11 + Math.floor(next() * 4);
      line(image, x, y, x - length / 3, y + length, STORM_RAIN);
    }
  },
  // Flakes: a dot with four arms, or a single dot.
  snow: (image, shiftX, shiftY) => {
    const next = marks(37);
    for (let count = 0; count < 16; count += 1) {
      const x = Math.round(next() * WEATHER_TILE + shiftX);
      const y = Math.round(next() * WEATHER_TILE + shiftY);
      plot(image, x, y, FLAKE);
      if (next() < 0.6) {
        plot(image, x - 1, y, FLAKE);
        plot(image, x + 1, y, FLAKE);
        plot(image, x, y - 1, FLAKE);
        plot(image, x, y + 1, FLAKE);
      }
    }
  },
  // Many flakes, and streaks of it driven across.
  blizzard: (image, shiftX, shiftY) => {
    const next = marks(41);
    for (let count = 0; count < 34; count += 1) {
      const x = Math.round(next() * WEATHER_TILE + shiftX);
      const y = Math.round(next() * WEATHER_TILE + shiftY);
      plot(image, x, y, FLAKE);
      plot(image, x + 1, y, FLAKE);
    }
    for (let count = 0; count < 9; count += 1) {
      const x = next() * WEATHER_TILE + shiftX;
      const y = next() * WEATHER_TILE + shiftY;
      line(image, x, y, x + 9, y + 2, DRIVEN);
    }
  },
  // Long low banks, two pixels deep.
  fog: (image, shiftX, shiftY) => {
    const next = marks(53);
    for (let count = 0; count < 8; count += 1) {
      const x = next() * WEATHER_TILE + shiftX;
      const y = Math.round(next() * WEATHER_TILE + shiftY);
      const length = 18 + Math.floor(next() * 18);
      line(image, x, y, x + length, y, FOG);
      line(image, x + 3, y + 1, x + length - 3, y + 1, FOG);
    }
  },
  // Brown blotches, and specks between them.
  mud: (image, shiftX, shiftY) => {
    const next = marks(67);
    for (let count = 0; count < 9; count += 1) {
      blot(image, next() * WEATHER_TILE + shiftX, next() * WEATHER_TILE + shiftY, 3.5 + next() * 3.5, 2.5 + next() * 2, MUD);
    }
    for (let count = 0; count < 12; count += 1) plot(image, next() * WEATHER_TILE + shiftX, next() * WEATHER_TILE + shiftY, MUD_DARK);
  },
  // Thin wavering lines across it, as air shimmers over hot ground.
  heat: (image, shiftX, shiftY) => {
    for (let band = 0; band < 4; band += 1) {
      const middle = 8 + band * 16 + shiftY;
      for (let x = 0; x < WEATHER_TILE; x += 1) {
        // (Two whole waves across a tile, and breaks in the line a quarter of
        // a tile apart, so the lines meet at its edges.)
        const lift = Math.round(2 * Math.sin(((x + band * 7) * 4 * Math.PI) / WEATHER_TILE));
        if ((x + band * 5) % 16 < 12) plot(image, x + shiftX, middle + lift, SHIMMER);
      }
    }
  },
  // An icy speckle.
  frost: (image, shiftX, shiftY) => {
    const next = marks(79);
    for (let count = 0; count < 46; count += 1) {
      const x = Math.round(next() * WEATHER_TILE + shiftX);
      const y = Math.round(next() * WEATHER_TILE + shiftY);
      plot(image, x, y, FROST);
      if (next() < 0.25) {
        plot(image, x + 1, y + 1, FROST);
        plot(image, x - 1, y + 1, FROST);
      }
    }
  },
};

// A weather's picture at a step of its drift, or null for weather that draws
// nothing (clear) or that is not weather.
export const weatherPattern = (state, step = 0) => {
  const draw = Object.hasOwn(DRAW, state) ? DRAW[state] : null;
  if (!draw) return null;
  const image = picture(WEATHER_TILE);
  const [across, down] = WEATHER_DRIFT[state] ?? [0, 0];
  const at = Math.max(0, Math.floor(Number(step) || 0));
  draw(image, across * at, down * at);
  return image;
};

// Whether a weather's picture moves from step to step.
export const weatherDrifts = (state) => Object.hasOwn(WEATHER_DRIFT, state);

const ICE = [214, 233, 247, 238];
const CRACK = [118, 154, 188, 255];
const GLINT = [248, 252, 255, 255];

// Ice: pale blue-white, with dark cracks running across it and branching,
// and a few bright glints.
export const icePattern = () => {
  const image = picture(ICE_TILE);
  for (let at = 0; at < image.data.length; at += 4) image.data.set(ICE, at);
  const next = marks(97);
  for (let crack = 0; crack < 7; crack += 1) {
    let x = next() * ICE_TILE;
    let y = next() * ICE_TILE;
    let heading = next() * 2 * Math.PI;
    const legs = 5 + Math.floor(next() * 4);
    for (let leg = 0; leg < legs; leg += 1) {
      const length = 6 + next() * 10;
      heading += (next() - 0.5) * 1.2;
      const toX = x + Math.cos(heading) * length;
      const toY = y + Math.sin(heading) * length;
      line(image, x, y, toX, toY, CRACK);
      if (next() < 0.35) {
        const side = heading + (next() < 0.5 ? -1 : 1) * (0.6 + next() * 0.6);
        const reach = 4 + next() * 6;
        line(image, toX, toY, toX + Math.cos(side) * reach, toY + Math.sin(side) * reach, CRACK);
      }
      x = toX;
      y = toY;
    }
  }
  for (let glint = 0; glint < 12; glint += 1) {
    const x = next() * ICE_TILE;
    const y = next() * ICE_TILE;
    line(image, x, y, x + 2 + Math.floor(next() * 3), y, GLINT);
  }
  return image;
};

const HINT = [206, 230, 248, 220];

// Water that can freeze: short pale dashes, as of floes, staggered row by row.
export const iceHintPattern = () => {
  const image = picture(ICE_HINT_TILE);
  [[3, 6], [19, 6], [11, 22], [27, 22]].forEach(([x, y]) => line(image, x, y, x + 4, y, HINT));
  return image;
};

const CHIP_FILL = [14, 17, 22, 228];
const CHIP_EDGE = [232, 238, 245, 72];
const CHIP_RADIUS = 7;

// The chip a battlefield's season and weather are written on: a dark rounded
// box with a faint light edge, stretched to its text (icon-text-fit) by its
// middle, so the corners keep their shape.
export const chipPicture = () => {
  const image = picture(CHIP_TILE);
  const inside = (x, y, inset) => {
    const left = inset;
    const right = CHIP_TILE - inset;
    const radius = CHIP_RADIUS - inset;
    const cx = Math.min(Math.max(x, left + radius), right - radius);
    const cy = Math.min(Math.max(y, left + radius), right - radius);
    return x >= left && x <= right && y >= left && y <= right && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius * radius;
  };
  for (let y = 0; y < CHIP_TILE; y += 1) {
    for (let x = 0; x < CHIP_TILE; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (!inside(px, py, 0.5)) continue;
      image.data.set(inside(px, py, 1.5) ? CHIP_FILL : CHIP_EDGE, (y * CHIP_TILE + x) * 4);
    }
  }
  return image;
};
// How the chip stretches (map.addImage's options): by its middle, the text set inside it.
export const CHIP_STRETCH = Object.freeze({
  stretchX: [[CHIP_RADIUS, CHIP_TILE - CHIP_RADIUS]],
  stretchY: [[CHIP_RADIUS, CHIP_TILE - CHIP_RADIUS]],
  content: [5, 4, CHIP_TILE - 5, CHIP_TILE - 4],
});
