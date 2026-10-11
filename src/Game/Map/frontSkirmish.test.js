// Run: node --test src/Game/Map/frontSkirmish.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { PAINT_OWN_A, PAINT_OWN_B, PAINT_WALL } from "../../runtime/fronts/codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL } from "../../runtime/fronts/constants.js";
import { frontViewOf, normalizeBattlefield } from "../../runtime/fronts/record.js";
import { createReplayRecorder } from "../../runtime/fronts/replay.js";
import { frontAt, stageOf } from "./frontGeometry.js";
import { createPaintPlayer } from "./frontPaint.js";
import { createSkirmish, skirmishAt } from "./frontSkirmish.js";

const COLS = 40;
const ROWS = 30;
const frame = { lng0: 30, lat0: 46, cell: 0.1, cols: COLS, rows: ROWS, km: 8 };
const sides = [["Russia", "Belarus"], ["Ukraine"]];
const at = (col, row) => row * COLS + col;

// Side A holds west of column 22 and side B east of it; their home ground
// meets at column 20, so A has taken two columns. The two southern rows are sea.
const ground = () => {
  const holders = new Uint8Array(COLS * ROWS);
  const painters = new Uint8Array(COLS * ROWS);
  const homes = new Uint8Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      holders[at(col, row)] = row < 2 ? HOLDER_WALL : col < 22 ? HOLDER_SIDE_A : HOLDER_SIDE_B;
      homes[at(col, row)] = row < 2 ? 2 : col < 20 ? 0 : 1;
    }
  }
  return { holders, painters, homes };
};

// Two of side A stand at the front; a third stands far back, a fourth is dug
// in at the front and a fifth is cut off there. Side B has one at the front
// facing the first of them, one whose strength is gone facing the second, and
// one dug in a little way behind its line.
const troopsA = [
  { x: 21.2, y: 10.5, strength: 80, state: "holding" },
  { x: 21.4, y: 20.5, strength: 80, state: "holding" },
  { x: 8.5, y: 15.5, strength: 80, state: "holding" },
  { x: 21.3, y: 15.5, strength: 80, state: "dug in" },
  { x: 21.3, y: 25.5, strength: 80, state: "encircled" },
];
const troopsB = [
  { x: 22.8, y: 10.5, strength: 70, state: "holding" },
  { x: 22.8, y: 20.5, strength: 0, state: "holding" },
  { x: 23.6, y: 15.5, strength: 70, state: "dug in" },
];
const battlefield = () => {
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  for (let day = 0; day <= 3; day += 1) recorder.record(day, [troopsA, troopsB], ground());
  return frontViewOf(normalizeBattlefield({
    name: "Eastern Ukraine",
    sides,
    frame,
    troops: ["", ""],
    replay: recorder.finish({ date: "2024-03-01", days: 3 }),
  }));
};
const atRest = () => {
  const view = battlefield();
  const player = createPaintPlayer(view);
  player.seek(3);
  const drawing = frontAt(stageOf(view), 3);
  return { view, player, drawing, skirmish: createSkirmish(drawing, player) };
};
// Every tenth of a second of two minutes, from a moment after it got going.
const moments = Array.from({ length: 1200 }, (_, index) => 100 + index / 10);

test("troops skirmish only where the two sides stand against each other, and not one that is dug in, cut off or gone", () => {
  const { skirmish } = atRest();
  // The second of side A has nobody in front of it (the one that was is gone,
  // and the nearest other is forty km off): it stands. The first has. One
  // that is dug in does not push, but it is somebody to push at.
  assert.deepEqual(skirmish.fighters.map((fighter) => [fighter.side, fighter.index]), [[0, 0], [1, 0]]);
  // Each faces the other side's ground: east for side A here, west for side B.
  assert.ok(skirmish.fighters.filter((fighter) => fighter.side === 0).every((fighter) => fighter.dx > 0.9));
  assert.ok(skirmish.fighters.filter((fighter) => fighter.side === 1).every((fighter) => fighter.dx < -0.9));
  // A battlefield where nobody stands near the other side has none, and that is not an error.
  const recorder = createReplayRecorder({ sides, cols: COLS, rows: ROWS });
  recorder.record(0, [[troopsA[2]], []], ground());
  recorder.record(1, [[troopsA[2]], []], ground());
  const quiet = frontViewOf(normalizeBattlefield({ name: "Quiet", sides, frame, troops: ["", ""], replay: recorder.finish({ days: 1 }) }));
  const player = createPaintPlayer(quiet);
  player.seek(1);
  assert.equal(createSkirmish(frontAt(stageOf(quiet), 1), player), null);
  assert.deepEqual(skirmishAt(null, 12).moves, []);
});

test("a troop pushes forward a little and comes back, and both sides take their turn", () => {
  const { skirmish } = atRest();
  skirmishAt(skirmish, 0);
  const seen = [new Set(), new Set()];
  const furthest = new Map();
  let together = 0;
  for (const seconds of moments) {
    const { moves } = skirmishAt(skirmish, seconds);
    for (const move of moves) {
      const fighter = skirmish.fighters.find((entry) => entry.side === move.side && entry.index === move.index);
      assert.ok(fighter, "only a troop that skirmishes is moved");
      seen[move.side].add(move.index);
      const gone = Math.hypot(move.x - fighter.x, move.y - fighter.y);
      furthest.set(`${move.side}:${move.index}`, Math.max(furthest.get(`${move.side}:${move.index}`) ?? 0, gone));
      // Forward, never back from where it stands: toward the other side's ground.
      assert.ok((move.x - fighter.x) * fighter.dx + (move.y - fighter.y) * fighter.dy > -1e-6);
      assert.ok(move.push > 0 && move.push <= 1);
    }
    // The two that face each other across the front are never both well out at once.
    if (moves.some((move) => move.side === 0 && move.index === 0 && move.push > 0.2) && moves.some((move) => move.side === 1 && move.index === 0 && move.push > 0.2)) together += 1;
  }
  assert.deepEqual([[...seen[0]].sort(), [...seen[1]].sort()], [[0], [0]], "each of them, of both sides, in two minutes");
  assert.equal(together, 0, "first one side and then the other");
  for (const [key, gone] of furthest) {
    // To the edge of the other side's ground and a few km on: under two cells here, never a march.
    assert.ok(gone > 0.4 && gone < 2.2, `${key} went ${gone.toFixed(2)} cells`);
  }
});

test("nothing is kept: every troop is back in its place again and again, and so is the ground", () => {
  const { skirmish } = atRest();
  skirmishAt(skirmish, 0);
  const home = new Map(skirmish.fighters.map((fighter) => [`${fighter.side}:${fighter.index}`, 0]));
  let empty = 0;
  let longestOut = 0;
  const out = new Map();
  for (const seconds of moments) {
    const act = skirmishAt(skirmish, seconds);
    const moving = new Set(act.moves.map((move) => `${move.side}:${move.index}`));
    for (const key of home.keys()) {
      if (moving.has(key)) {
        out.set(key, (out.get(key) ?? 0) + 0.1);
        longestOut = Math.max(longestOut, out.get(key));
      } else {
        out.set(key, 0);
        home.set(key, home.get(key) + 1);
      }
    }
    if (act.moves.length === 0) {
      empty += 1;
      assert.equal(act.cells.length, 0, "with every troop in its place no ground is changing hands");
    }
  }
  assert.ok(empty > 0, "there are moments when nothing is out of its place");
  for (const [key, count] of home) assert.ok(count > moments.length / 3, `${key} is in its place most of the time`);
  assert.ok(longestOut < 5, `no push lasts long: ${longestOut.toFixed(1)} s`);
});

test("the ground under a push turns the pusher's colour: only the other side's ground, never sea, and back to its own where it had been taken", () => {
  const { skirmish, player } = atRest();
  skirmishAt(skirmish, 0);
  const states = new Map();
  let most = 0;
  for (const seconds of moments) {
    const act = skirmishAt(skirmish, seconds);
    for (let index = 0; index < act.cells.length; index += 1) {
      const cell = act.cells[index];
      const col = cell % COLS;
      const row = (cell - col) / COLS;
      assert.ok(row >= 2, "never the sea");
      assert.ok(act.turned[index] > 0 && act.turned[index] <= 1);
      most = Math.max(most, act.turned[index]);
      const pushers = act.moves.filter((move) => Math.hypot(move.x - col - 0.5, move.y - row - 0.5) < 3).map((move) => move.side);
      assert.ok(pushers.length > 0, "only round a troop that is pushing");
      // Side A pushes onto side B's ground (east of column 22) and the other way about.
      assert.ok(col >= 22 ? pushers.includes(0) : pushers.includes(1));
      states.set(`${col >= 22 ? "east" : col >= 20 ? "taken" : "west"}:${act.states[index]}`, true);
    }
  }
  assert.ok(most > 0.9, "a push at its furthest turns the ground under it all the way");
  // East of the line is Ukraine's own: Russia's push paints it Russia's (state 1), Belarus's Belarus's (2).
  // The two columns Russia had taken go back to Ukraine's own under Ukraine's push; further west is not reached.
  assert.deepEqual([...states.keys()].sort(), [`east:1`, `taken:${PAINT_OWN_B}`].sort());
  assert.ok(![...states.keys()].some((key) => key.endsWith(`:${PAINT_OWN_A}`) || key.endsWith(`:${PAINT_WALL}`)));
  // Laid over the ground and taken off again, the ground is exactly as it stood.
  const before = Uint8Array.from(player.state);
  const act = moments.map((seconds) => skirmishAt(skirmish, seconds)).find((entry) => entry.cells.length > 0);
  const changed = player.sway(act.cells, act.states, act.turned);
  assert.ok(changed.length > 0);
  assert.notDeepEqual(player.state, before);
  const restored = player.sway(new Int32Array(0), new Uint8Array(0), new Float32Array(0));
  assert.ok(restored.length > 0, "what goes back is redrawn too");
  assert.deepEqual(player.state, before);
  assert.deepEqual(player.sway(new Int32Array(0), new Uint8Array(0), new Float32Array(0)), [], "and then there is nothing to redraw");
});

test("the same moment always looks the same, and it eases in when a battlefield comes to rest", () => {
  const first = atRest().skirmish;
  const second = atRest().skirmish;
  skirmishAt(first, 0);
  skirmishAt(second, 0);
  for (const seconds of [100, 103.7, 151.2]) {
    const a = skirmishAt(first, seconds);
    const b = skirmishAt(second, seconds);
    assert.deepEqual(a.moves, b.moves);
    assert.deepEqual([...a.cells], [...b.cells]);
  }
  // Just come to rest: nothing has moved yet, and what moves in the first
  // second moves less than it will once the skirmishing has got going.
  const going = moments.find((seconds) => skirmishAt(first, seconds + 0.4).moves.some((move) => move.push > 0.5));
  const fresh = atRest().skirmish;
  assert.deepEqual(skirmishAt(fresh, going).moves, []);
  const settled = skirmishAt(first, going + 0.4).moves;
  const starting = skirmishAt(fresh, going + 0.4).moves;
  assert.ok(starting.length > 0 && starting.length <= settled.length);
  for (const move of starting) {
    const full = settled.find((entry) => entry.side === move.side && entry.index === move.index);
    assert.ok(full && move.push < full.push * 0.5, "a part of the push it will be");
  }
});
