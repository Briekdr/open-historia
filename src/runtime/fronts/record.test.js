// Run: node --test src/runtime/fronts/record.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { encodeMask, encodeTroops } from "./codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL, MAX_BATTLEFIELDS, MAX_CLOSED_BATTLEFIELDS, MAX_ORDERS_PER_SIDE, MAX_TROOPS_PER_SIDE } from "./constants.js";
import { createFrame, projectorOf } from "./frame.js";
import {
  battlefieldSideOf,
  battlefieldsAsSeen,
  battlefieldsAtDay,
  findBattlefield,
  frontViewOf,
  holderAt,
  isOpenBattlefield,
  normalizeBattlefield,
  normalizeBattlefields,
} from "./record.js";
import { createReplayRecorder } from "./replay.js";

const frame = createFrame({ west: 30, south: 46, east: 40, north: 52 });
const maskOf = (lineCol) => {
  const holders = new Uint8Array(frame.cols * frame.rows);
  for (let index = 0; index < holders.length; index += 1) holders[index] = index % frame.cols < lineCol ? HOLDER_SIDE_A : HOLDER_SIDE_B;
  return encodeMask(holders);
};
const troopsAt = (col) => [
  [{ x: col - 1, y: 5, strength: 80, kind: 0, owner: 0, named: true }],
  [{ x: col + 1, y: 5, strength: 60, kind: 1, owner: 0 }],
];
// A run of 31 days from the first of March: the line goes east from column 30
// to column 40, a third of a cell a day, and the troops go with it.
const groundAt = (lineCol) => {
  const size = frame.cols * frame.rows;
  const holders = new Uint8Array(size);
  const homes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    holders[index] = index % frame.cols < lineCol ? HOLDER_SIDE_A : HOLDER_SIDE_B;
    homes[index] = index % frame.cols < 30 ? 0 : 1;
  }
  return { holders, painters: new Uint8Array(size), homes };
};
const replayOfRun = ({ from = 30, to = 40, days = 31, date = "2024-03-01", opens = 0, closes = days } = {}) => {
  const recorder = createReplayRecorder({ sides: [["Russia", "Belarus"], ["Ukraine"]], cols: frame.cols, rows: frame.rows });
  for (let day = opens; day <= closes; day += 1) {
    const col = from + ((to - from) * day) / days;
    recorder.record(day, troopsAt(col), groundAt(Math.floor(col)));
  }
  return recorder.finish({ date, days });
};
const battlefield = (overrides = {}) => ({
  v: 1,
  name: "Eastern Ukraine",
  warId: "war-1",
  status: "active",
  sides: [["Russia", "Belarus"], ["Ukraine"]],
  openedDate: "2024-03-01",
  asOf: "2024-04-01",
  frame,
  field: { mask: maskOf(40), band: "", key: "abc" },
  troops: troopsAt(40).map(encodeTroops),
  named: [{ s: 0, i: 0, name: "1st Guards Tank Army", unitId: "unit-1" }],
  pool: [120, 60],
  base: [400, 200],
  quality: [1, 1.1],
  effort: ["major", "total"],
  orders: [{ s: 0, sector: "north", order: "advance", objective: "city: Kharkiv", since: "2024-03-05", by: "Russia" }],
  replay: replayOfRun(),
  held: "",
  contested: [["region-7", 0]],
  brief: { km: 600 },
  log: [{ d: "2024-03-20", k: "city", s: 0, at: "city: Izium" }],
  ...overrides,
});

test("a record the engine wrote passes through whole, and a second pass is the same object", () => {
  const list = normalizeBattlefields([battlefield()]);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], battlefield());
  assert.equal(normalizeBattlefields(list), list);
  const raw = [battlefield()];
  assert.equal(normalizeBattlefields(raw), normalizeBattlefields(raw), "one copy for one saved list");
  assert.deepEqual(normalizeBattlefields(null), []);
  assert.deepEqual(normalizeBattlefields({}), []);
});

test("what could not be a battlefield is dropped, and the rest is held to its limits", () => {
  assert.equal(normalizeBattlefield(battlefield({ name: "  " })), null);
  assert.equal(normalizeBattlefield(battlefield({ sides: [["Russia"], []] })), null);
  assert.equal(normalizeBattlefield(battlefield({ frame: { cols: 5 } })), null);
  assert.equal(normalizeBattlefield("Eastern Ukraine"), null);

  const record = normalizeBattlefield(battlefield({
    status: "paused",
    sides: [["Russia", "russia", " Belarus "], ["Ukraine"]],
    troops: ["A".repeat(7 * (MAX_TROOPS_PER_SIDE + 5) + 3), "not packed!"],
    effort: ["all of it", "token"],
    quality: [-2, "x"],
    orders: [
      ...Array.from({ length: MAX_ORDERS_PER_SIDE + 3 }, () => ({ s: 0, sector: "", order: "Advance" })),
      { s: 1, order: "charge" },
      { s: 2, order: "hold" },
      { s: 1, order: "dig in", effort: "TOTAL" },
    ],
    replay: { m: "painted" },
    contested: [["region-1", 1], ["", 0], ["region-2", 5], "region-3"],
    brief: "none",
    log: [{ d: "2024-03-20", k: "City", at: "" }, { d: "2024-03-21", k: "pocket", at: "city: Kupiansk", s: 4 }],
  }));
  assert.equal(record.status, "active");
  assert.deepEqual(record.sides[0], ["Russia", "Belarus"]);
  assert.equal(record.troops[0].length, 7 * MAX_TROOPS_PER_SIDE);
  assert.equal(record.troops[1], "");
  assert.deepEqual(record.effort, ["major", "token"]);
  assert.deepEqual(record.quality, [1, 1]);
  assert.equal(record.orders.filter((order) => order.s === 0).length, MAX_ORDERS_PER_SIDE);
  assert.deepEqual(record.orders.at(-1), { s: 1, sector: "all", order: "dig in", since: "", effort: "total" });
  assert.equal(record.orders[0].order, "advance");
  assert.equal(record.replay, null, "a replay that cannot be read is none");
  assert.deepEqual(record.contested, [["region-1", 1]]);
  assert.deepEqual(record.brief, {});
  assert.deepEqual(record.log, [{ d: "2024-03-21", k: "pocket", at: "city: Kupiansk" }]);
});

test("a closed battlefield keeps its last run and loses its field", () => {
  const record = normalizeBattlefield(battlefield({ status: "closed", closedDate: "2024-06-01" }));
  assert.equal(record.field, undefined);
  assert.equal(record.closedDate, "2024-06-01");
  assert.equal(record.replay.n, 31);
  assert.equal(isOpenBattlefield(record), false);
  assert.equal(isOpenBattlefield(normalizeBattlefield(battlefield({ status: "frozen" }))), true);
  assert.equal(holderAt(record, 31, 49), HOLDER_WALL);
});

test("one record a name; the open ones are kept first, then the newest closed", () => {
  const many = [
    ...Array.from({ length: MAX_CLOSED_BATTLEFIELDS + 2 }, (_, index) => battlefield({ name: `Old ${index}`, status: "closed" })),
    ...Array.from({ length: MAX_BATTLEFIELDS + 2 }, (_, index) => battlefield({ name: `Front ${index}` })),
    battlefield({ name: "front 0", warId: "another" }),
  ];
  const list = normalizeBattlefields(many);
  assert.equal(list.filter(isOpenBattlefield).length, MAX_BATTLEFIELDS);
  assert.equal(list.filter((record) => record.status === "closed").length, MAX_CLOSED_BATTLEFIELDS);
  assert.equal(list[0].name, "Front 0");
  assert.equal(list[0].warId, "war-1", "the first of a name stands");
  assert.equal(list.at(-1).name, `Old ${MAX_CLOSED_BATTLEFIELDS + 1}`);
});

test("a battlefield and a side are found by exact name in any case", () => {
  const list = [battlefield()];
  assert.equal(findBattlefield(list, "eastern  ukraine")?.name, "Eastern Ukraine");
  assert.equal(findBattlefield(list, "Ukraine"), null);
  assert.equal(findBattlefield(list, ""), null);
  const record = findBattlefield(list, "Eastern Ukraine");
  assert.equal(battlefieldSideOf(record, "belarus"), 0);
  assert.equal(battlefieldSideOf(record, "Ukraine"), 1);
  assert.equal(battlefieldSideOf(record, "Ukrainian SSR"), -1);
  assert.equal(battlefieldSideOf(record, ""), -1);
});

test("what the map draws is the troops as they stand and the replay of the last run", () => {
  const record = normalizeBattlefields([battlefield()])[0];
  const view = frontViewOf(record);
  assert.equal(view.name, "Eastern Ukraine");
  assert.equal(view.status, "active");
  assert.equal(view.troops[0][0].named, true);
  assert.equal(view.troops[1][0].kind, 1);
  assert.deepEqual(view.named, [{ s: 0, i: 0, name: "1st Guards Tank Army", unitId: "unit-1" }]);
  assert.equal(view.replay.days, 31);
  assert.equal(view.replay.paint.began.length, frame.cols * frame.rows);
  assert.equal(view.replay.paint.began[35], 0, "as the run began, nothing was painted");
  assert.equal(view.replay.paint.cells.length, 10 * frame.rows, "ten columns taken, a cell at a time");
  assert.deepEqual(view.replay.paint.names, ["Russia", "Belarus", "Ukraine"]);
  assert.equal(view.replay.tracks[0][0].at(-1).x, 39);
  assert.equal(view.window, null, "as it stands: shown as it ended");
  assert.equal(frontViewOf(record), view, "read once");
  assert.equal(frontViewOf(normalizeBattlefield(battlefield({ replay: null }))).replay, null);
  assert.equal(frontViewOf(null), null);
});

test("the list as it stood on a day of the run is the same run, to be played to that day", () => {
  const list = normalizeBattlefields([battlefield()]);
  const seen = battlefieldsAtDay(list, 15, 10);
  assert.deepEqual(frontViewOf(seen[0]).window, { from: 10, until: 15 });
  assert.equal(frontViewOf(seen[0]).replay, frontViewOf(list[0]).replay, "the run is read once for every day of it shown");
  assert.deepEqual(seen[0].contested, [], "what describes only the end is left out");
  assert.equal(normalizeBattlefields(seen), seen);
  assert.deepEqual(frontViewOf(battlefieldsAtDay(list, 15)[0]).window, { from: 15, until: 15 });
  assert.deepEqual(frontViewOf(battlefieldsAtDay(list, 99, -4)[0]).window, { from: 0, until: 31 });
  assert.equal(battlefieldsAtDay(list, undefined), list);

  // One that opened on day 12 is not there before it; one that closed on day
  // 20 was still being fought over until then.
  const opened = normalizeBattlefields([battlefield({ replay: replayOfRun({ opens: 12 }) })]);
  assert.deepEqual(battlefieldsAtDay(opened, 11), []);
  assert.deepEqual(frontViewOf(battlefieldsAtDay(opened, 14, 5)[0]).window, { from: 12, until: 14 });
  const closed = normalizeBattlefields([battlefield({ status: "closed", closedDate: "2024-03-21", replay: replayOfRun({ closes: 20 }) })]);
  assert.equal(battlefieldsAtDay(closed, 19)[0].status, "active");
  assert.equal(battlefieldsAtDay(closed, 19)[0].closedDate, undefined);
  assert.equal(battlefieldsAtDay(closed, 20)[0].status, "closed");
  assert.equal(closed[0].status, "closed", "the record itself is not touched");
});

test("the list as it was seen on a date places the date in each battlefield's own run", () => {
  const list = normalizeBattlefields([battlefield(), battlefield({ name: "The South", replay: null })]);
  const seen = battlefieldsAsSeen(list, "2024-03-16");
  assert.deepEqual(frontViewOf(seen[0]).window, { from: 15, until: 15 });
  assert.equal(seen[1], list[1], "nothing to place a date in");
  assert.deepEqual(frontViewOf(battlefieldsAsSeen(list, "2024-12-31")[0]).window, { from: 31, until: 31 });
  assert.deepEqual(frontViewOf(battlefieldsAsSeen(list, "2024-01-01")[0]).window, { from: 0, until: 0 }, "before the run: how it stood when the run began");
  assert.equal(battlefieldsAsSeen(list, null), list);
  assert.equal(battlefieldsAsSeen(list, "the third age")[0], list[0], "a date the calendar cannot place");
  // The same on a BC calendar, where the text of a date does not sort.
  const ancient = normalizeBattlefields([battlefield({ replay: replayOfRun({ date: "-0219-03-01" }) })]);
  assert.deepEqual(frontViewOf(battlefieldsAsSeen(ancient, "-0219-03-11")[0]).window, { from: 10, until: 10 });
});

test("who holds a point is read from the saved mask", () => {
  const record = normalizeBattlefields([battlefield()])[0];
  const { toLngLat } = projectorOf(frame);
  const [westLng, lat] = toLngLat(10.5, 20.5);
  const [eastLng] = toLngLat(60.5, 20.5);
  assert.equal(holderAt(record, westLng, lat), HOLDER_SIDE_A);
  assert.equal(holderAt(record, eastLng, lat), HOLDER_SIDE_B);
  assert.equal(holderAt(record, 0, 0), HOLDER_WALL, "off the frame");
  assert.equal(holderAt(null, westLng, lat), HOLDER_WALL);
});
