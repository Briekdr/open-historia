// Run: node --test src/runtime/fronts/replay.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { decodeLines, decodeTracks, encodeLines } from "./codec.js";
import {
  MAX_REPLAY_CHARS,
  MAX_REPLAY_LINES,
  MAX_TRACK_POINTS,
  TRACK_TOLERANCE,
  createReplayRecorder,
  normalizeReplay,
  replayBetween,
  replayDayOn,
  replayOf,
  replayWindowOf,
  stillReplay,
  trackAt,
} from "./replay.js";

const lineAt = (col) => [{ closed: false, points: [[col, 0], [col, 40]], flags: [1, 1] }];
const troop = (x, y, strength = 80, state = 0) => ({ x, y, strength, state });

test("a run is kept as the days its line changed and each troop's path", () => {
  const recorder = createReplayRecorder();
  const still = lineAt(30);
  // Days 0 to 3 nothing moves; days 4 to 6 the line goes east a cell a day and
  // one troop goes with it; then it stands until day 10.
  for (let day = 0; day <= 10; day += 1) {
    const pushed = Math.max(0, Math.min(3, day - 3));
    const strands = pushed === 0 ? still : lineAt(30 + pushed);
    recorder.record(day, strands, [
      [troop(29 + pushed, 10, 80, pushed > 0 && day <= 6 ? 1 : 0), troop(29, 20)],
      [troop(32 + pushed, 10, 70)],
    ]);
  }
  const replay = recorder.finish({ date: "2024-03-01", days: 10 });
  assert.equal(replay.d, "2024-03-01");
  assert.equal(replay.n, 10);
  assert.equal(replay.s, 0);
  assert.deepEqual(replay.k, [0, 4, 5, 6]);
  assert.deepEqual(replay.h, [0, 3, 4, 5], "the line stood until day 3, and moved a day at a time");
  assert.deepEqual(decodeLines(replay.l[3])[0].points[0], [33, 0]);

  const [sideA, sideB] = [decodeTracks(replay.t[0]), decodeTracks(replay.t[1])];
  assert.equal(sideA.length, 2);
  assert.equal(sideB.length, 1);
  assert.deepEqual(sideA[1], [{ day: 0, x: 29, y: 20, strength: 80, state: 0 }], "a troop that never moved is one point");
  const moved = sideA[0];
  assert.deepEqual(moved.map((sample) => sample.day), [0, 3, 6, 10], "where it waited, where it set off, where it stopped, and that it held there");
  assert.equal(moved[2].x, 32);
  assert.equal(moved[2].state, 1, "what it was doing on the way");
  assert.equal(moved[3].state, 0);
  assert.equal(trackAt(moved, 5).state, 1);
  assert.equal(trackAt(moved, 8).state, 0);
  // Where it was is right on every day, not only at the points kept.
  for (let day = 0; day <= 10; day += 1) {
    const at = trackAt(moved, day);
    assert.ok(Math.abs(at.x - (29 + Math.max(0, Math.min(3, day - 3)))) <= TRACK_TOLERANCE + 1 / 16, `day ${day}`);
  }
  assert.equal(trackAt(moved, 4.5).moving, true);
  assert.equal(trackAt(moved, 2).moving, false);
  assert.equal(trackAt(moved, 9).moving, false);
});

test("a path keeps its bends, and a troop is where it was when it was", () => {
  const recorder = createReplayRecorder();
  const strands = lineAt(10);
  // East for ten days, then north for ten: a corner, not a diagonal.
  for (let day = 0; day <= 20; day += 1) {
    recorder.record(day, strands, [[troop(10 + Math.min(day, 10), 10 + Math.max(0, day - 10))], []]);
  }
  const [path] = decodeTracks(recorder.finish({ days: 20 }).t[0]);
  assert.deepEqual(path.map((sample) => [sample.day, sample.x, sample.y]), [[0, 10, 10], [10, 20, 10], [20, 20, 20]]);

  // A troop that waits and then runs is not shown ambling the whole way.
  const waiting = createReplayRecorder();
  for (let day = 0; day <= 20; day += 1) waiting.record(day, strands, [[troop(day < 15 ? 10 : 10 + (day - 15) * 2, 10)], []]);
  const [late] = decodeTracks(waiting.finish({ days: 20 }).t[0]);
  assert.deepEqual(late.map((sample) => sample.day), [0, 15, 20]);
  assert.equal(trackAt(late, 14).x, 10);
});

test("a troop raised during the run starts there, and one that falls ends there", () => {
  const recorder = createReplayRecorder();
  const strands = lineAt(10);
  for (let day = 0; day <= 8; day += 1) {
    const side = [troop(5, 5, day >= 4 ? 0 : 80 - day * 20)];
    if (day >= 3) side.push(troop(6, 6 + (day - 3), 60));
    recorder.record(day, strands, [side, []]);
  }
  const [fallen, raised] = decodeTracks(recorder.finish({ days: 8 }).t[0]);
  assert.equal(fallen.at(-1).day, 4);
  assert.equal(fallen.at(-1).strength, 0);
  assert.equal(trackAt(fallen, 8).strength, 0);
  assert.equal(raised[0].day, 3);
  assert.equal(trackAt(raised, 2), null, "not there before it was raised");
  assert.equal(trackAt(raised, 8).y, 11);
});

test("a battlefield that opens during the run begins its replay that day", () => {
  const recorder = createReplayRecorder();
  for (let day = 12; day <= 15; day += 1) recorder.record(day, lineAt(20 + (day - 12)), [[troop(19, 5)], [troop(22, 5)]]);
  const replay = recorder.finish({ date: "1939-09-01", days: 30 });
  assert.equal(replay.s, 12);
  assert.equal(replay.n, 30);
  assert.deepEqual(replay.k, [12, 13, 14, 15]);
  assert.equal(decodeTracks(replay.t[0])[0][0].day, 12);
});

test("too many lines are thinned, and the gaps they leave are moved across from when the movement began", () => {
  const recorder = createReplayRecorder();
  const days = 200;
  for (let day = 0; day <= days; day += 1) recorder.record(day, lineAt(10 + day * 0.5), [[], []]);
  const replay = recorder.finish({ days });
  assert.ok(replay.k.length <= MAX_REPLAY_LINES);
  assert.equal(replay.k[0], 0);
  assert.equal(replay.k.at(-1), days);
  for (let index = 1; index < replay.k.length; index += 1) {
    assert.ok(replay.k[index] > replay.k[index - 1]);
    assert.equal(replay.h[index], replay.k[index - 1], "it moved every day, so each gap is moved across whole");
  }
  assert.deepEqual(decodeLines(replay.l.at(-1))[0].points[0], [110, 0]);
});

test("a replay too big to save loses lines before it loses paths", () => {
  const recorder = createReplayRecorder();
  // A long, crooked line that changes every day.
  const crooked = (shift) => [{
    closed: false,
    points: Array.from({ length: 700 }, (_, index) => [20 + ((index * 7 + shift) % 13), index * 0.3]),
    flags: Array.from({ length: 700 }, () => 1),
  }];
  for (let day = 0; day <= 60; day += 1) recorder.record(day, crooked(day), [[troop(10 + day, 10)], []]);
  const replay = recorder.finish({ days: 60 });
  const size = replay.l.reduce((sum, text) => sum + text.length, 0) + replay.t[0].length + replay.t[1].length;
  assert.ok(size <= MAX_REPLAY_CHARS, `${size} characters`);
  assert.ok(replay.k.length >= 2);
  assert.equal(replay.k.at(-1), 60);
  assert.equal(decodeTracks(replay.t[0])[0].at(-1).x, 70);
});

test("a path with more turns than can be kept is kept coarser, ends and all", () => {
  const recorder = createReplayRecorder();
  const strands = lineAt(10);
  for (let day = 0; day <= 300; day += 1) recorder.record(day, strands, [[troop(20 + (day % 2) * 3, 10 + day * 0.2)], []]);
  const [path] = decodeTracks(recorder.finish({ days: 300 }).t[0]);
  assert.ok(path.length <= MAX_TRACK_POINTS);
  assert.equal(path[0].day, 0);
  assert.equal(path.at(-1).day, 300);
});

test("the same run gives the same replay", () => {
  const run = () => {
    const recorder = createReplayRecorder();
    for (let day = 0; day <= 30; day += 1) {
      recorder.record(day, lineAt(10 + day * 0.37), [
        Array.from({ length: 20 }, (_, index) => troop(8 + day * 0.31 + index * 0.01, 2 * index + (day % 7) * 0.2, 90 - day, day % 3 === 0 ? 1 : 0)),
        Array.from({ length: 12 }, (_, index) => troop(13 + day * 0.4, 3 * index, 70)),
      ]);
    }
    return JSON.stringify(recorder.finish({ date: "1914-08-01", days: 30 }));
  };
  assert.equal(run(), run());
});

test("a saved replay is held to its shape, and passes through whole a second time", () => {
  const recorder = createReplayRecorder();
  for (let day = 0; day <= 5; day += 1) recorder.record(day, lineAt(10 + day), [[troop(9 + day, 5)], [troop(12 + day, 5)]]);
  const saved = JSON.parse(JSON.stringify(recorder.finish({ date: "2024-03-01", days: 5 })));
  const replay = normalizeReplay(saved);
  assert.deepEqual(replay, saved);
  assert.equal(normalizeReplay(replay), replay);

  assert.equal(normalizeReplay(null), null);
  assert.equal(normalizeReplay({ l: [] }), null);
  assert.equal(normalizeReplay({ l: ["not packed!"], k: [0], h: [0] }), null);
  const odd = normalizeReplay({
    d: "  2024-03-01 ",
    n: 9,
    s: 40,
    k: [0, 6, 4, 30],
    h: [0, -3, 0, 2],
    l: [saved.l[0], saved.l[1], saved.l[2], saved.l[3]],
    t: ["A;B", 7],
    until: 99,
  });
  assert.equal(odd.d, "2024-03-01");
  assert.equal(odd.s, 9);
  assert.deepEqual(odd.k, [0, 6, 9], "days out of order are left out, and none is past the run's end");
  assert.deepEqual(odd.h, [0, 0, 6]);
  assert.equal(odd.l.length, 3);
  assert.deepEqual(odd.t, ["A;B", ""]);
  assert.equal(odd.until, 9);
  assert.equal(odd.from, 9);
  assert.ok(normalizeReplay({ l: Array.from({ length: MAX_REPLAY_LINES + 9 }, () => saved.l[0]), k: [], h: [] }).l.length <= MAX_REPLAY_LINES);
});

test("a replay is read once, and a copy made to be shown part of the way shares the reading", () => {
  const recorder = createReplayRecorder();
  for (let day = 0; day <= 5; day += 1) recorder.record(day, lineAt(10 + day), [[troop(9 + day, 5)], []]);
  const battlefield = { replay: normalizeReplay(recorder.finish({ date: "2024-03-01", days: 5 })) };
  const read = replayOf(battlefield);
  assert.equal(read.days, 5);
  assert.equal(read.keys.length, 6);
  assert.deepEqual(read.keys[2], { day: 2, hold: 1, lines: decodeLines(encodeLines(lineAt(12))) });
  assert.equal(read.tracks[0].length, 1);
  assert.equal(replayOf(battlefield), read);
  assert.equal(replayWindowOf(battlefield), null);

  const part = { replay: replayBetween(battlefield.replay, 1, 3) };
  assert.equal(replayOf(part), read);
  assert.deepEqual(replayWindowOf(part), { from: 1, until: 3 });
  assert.equal(normalizeReplay(part.replay), part.replay);
  assert.deepEqual(replayWindowOf({ replay: replayBetween(battlefield.replay, 4, 99) }), { from: 4, until: 5 });
  assert.equal(replayOf({}), null);
  assert.equal(replayOf({ replay: null }), null);
});

test("a date is placed in the run, on any calendar the game reads", () => {
  const replay = { d: "2024-03-01", n: 30, s: 0, k: [0], h: [0], l: ["AAAAAA"], t: ["", ""] };
  assert.equal(replayDayOn(replay, "2024-03-01"), 0);
  assert.equal(replayDayOn(replay, "2024-03-16"), 15);
  assert.equal(replayDayOn(replay, "2024-12-01"), 30);
  assert.equal(replayDayOn(replay, "2023-01-01"), 0);
  assert.equal(replayDayOn(replay, ""), null);
  assert.equal(replayDayOn(replay, "the third age"), null);
  assert.equal(replayDayOn(null, "2024-03-01"), null);
  assert.equal(replayDayOn({ ...replay, d: "-0219-03-01" }, "-0219-03-11"), 10);
});

test("a replay with nothing left to play is the last line and where every troop ended", () => {
  const recorder = createReplayRecorder();
  for (let day = 0; day <= 9; day += 1) {
    recorder.record(day, lineAt(10 + day), [[troop(9 + day, 5), troop(4, 4, day >= 5 ? 0 : 50)], [troop(12 + day, 5, 70)]]);
  }
  const replay = normalizeReplay(recorder.finish({ date: "2024-03-01", days: 9 }));
  const still = stillReplay(replay);
  assert.equal(still.n, 0);
  assert.deepEqual(still.k, [0]);
  assert.equal(still.l[0], replay.l.at(-1));
  const [moved, fallen] = decodeTracks(still.t[0]);
  assert.deepEqual(moved, [{ day: 0, x: 18, y: 5, strength: 80, state: 0 }]);
  assert.equal(fallen[0].strength, 0, "the fallen keep their place in the list");
  assert.ok(JSON.stringify(still).length < JSON.stringify(replay).length / 3);
  assert.equal(normalizeReplay(still), still);
  assert.equal(stillReplay(null), null);
});
