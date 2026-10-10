// Run: node --test src/runtime/fronts/record.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { encodeLines, encodeMask, encodeTroops } from "./codec.js";
import { HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL, MAX_BATTLEFIELDS, MAX_CLOSED_BATTLEFIELDS, MAX_FRAMES, MAX_ORDERS_PER_SIDE, MAX_TROOPS_PER_SIDE } from "./constants.js";
import { createFrame, projectorOf } from "./frame.js";
import {
  battlefieldSideOf,
  battlefieldsAsSeen,
  findBattlefield,
  frontViewAt,
  holderAt,
  isOpenBattlefield,
  normalizeBattlefield,
  normalizeBattlefields,
} from "./record.js";

const frame = createFrame({ west: 30, south: 46, east: 40, north: 52 });
const maskOf = (lineCol) => {
  const holders = new Uint8Array(frame.cols * frame.rows);
  for (let index = 0; index < holders.length; index += 1) holders[index] = index % frame.cols < lineCol ? HOLDER_SIDE_A : HOLDER_SIDE_B;
  return encodeMask(holders);
};
const moment = (d, col) => ({
  d,
  l: encodeLines([{ closed: false, points: [[col, 0], [col, frame.rows]], flags: [1, 1] }]),
  t: [encodeTroops([{ x: col - 1, y: 5, strength: 80, kind: 0, owner: 0 }]), encodeTroops([{ x: col + 1, y: 5, strength: 60, kind: 1, owner: 0 }])],
});
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
  troops: moment("2024-04-01", 40).t,
  named: [{ s: 0, i: 0, name: "1st Guards Tank Army", unitId: "unit-1" }],
  pool: [120, 60],
  base: [400, 200],
  quality: [1, 1.1],
  effort: ["major", "total"],
  orders: [{ s: 0, sector: "north", order: "advance", objective: "city: Kharkiv", since: "2024-03-05", by: "Russia" }],
  frames: [moment("2024-03-01", 30), moment("2024-03-15", 35), moment("2024-04-01", 40)],
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
    frames: Array.from({ length: MAX_FRAMES + 3 }, (_, index) => moment(`2024-03-${String(index + 1).padStart(2, "0")}`, 30 + index)),
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
  assert.equal(record.frames.length, MAX_FRAMES);
  assert.equal(record.frames[0].d, "2024-03-01", "the state the run began from is kept");
  assert.equal(record.frames.at(-1).d, `2024-03-${String(MAX_FRAMES + 3).padStart(2, "0")}`);
  assert.deepEqual(record.contested, [["region-1", 1]]);
  assert.deepEqual(record.brief, {});
  assert.deepEqual(record.log, [{ d: "2024-03-21", k: "pocket", at: "city: Kupiansk" }]);
});

test("a closed battlefield keeps its last moments and loses its field", () => {
  const record = normalizeBattlefield(battlefield({ status: "closed", closedDate: "2024-06-01" }));
  assert.equal(record.field, undefined);
  assert.equal(record.closedDate, "2024-06-01");
  assert.equal(record.frames.length, 3);
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

test("the view as of a date is the last moment at or before it", () => {
  const list = normalizeBattlefields([battlefield()]);
  const lineColumn = (view) => view.lines[0].points[0][0];
  assert.equal(lineColumn(frontViewAt(list)[0]), 40);
  assert.equal(frontViewAt(list)[0].newest, true);
  assert.equal(lineColumn(frontViewAt(list, "2024-03-01")[0]), 30);
  assert.equal(lineColumn(frontViewAt(list, "2024-03-14")[0]), 30);
  assert.equal(lineColumn(frontViewAt(list, "2024-03-15")[0]), 35);
  assert.equal(lineColumn(frontViewAt(list, "2024-12-31")[0]), 40);
  assert.equal(lineColumn(frontViewAt(list, "2024-01-01")[0]), 30, "before the run: how it stood when the run began");
  assert.equal(lineColumn(frontViewAt(list, "the third age")[0]), 40, "a date the calendar cannot read");
  const view = frontViewAt(list, "2024-03-15")[0];
  assert.equal(view.date, "2024-03-15");
  assert.equal(view.troops[0][0].x, 34);
  assert.equal(view.troops[1][0].kind, 1);
  assert.equal(frontViewAt(list, "2024-03-15")[0], view, "decoded once");
  // The same on a BC calendar, where the text of a date does not sort.
  const ancient = normalizeBattlefields([battlefield({ frames: [moment("-0219-03-01", 30), moment("-0218-01-10", 36)] })]);
  assert.equal(lineColumn(frontViewAt(ancient, "-0219-12-31")[0]), 30);
  assert.equal(lineColumn(frontViewAt(ancient, "-0218-02-01")[0]), 36);
  assert.deepEqual(frontViewAt(normalizeBattlefields([battlefield({ frames: [] })])), []);
});

test("the list as it was seen on a date stops at that date", () => {
  const list = normalizeBattlefields([battlefield()]);
  const seen = battlefieldsAsSeen(list, "2024-03-16");
  assert.equal(seen[0].frames.length, 2);
  assert.deepEqual(seen[0].contested, []);
  assert.equal(frontViewAt(seen)[0].lines[0].points[0][0], 35);
  assert.equal(battlefieldsAsSeen(list, "2024-04-02")[0], list[0], "at the end it is the record itself");
  assert.equal(battlefieldsAsSeen(list, null), list);
  assert.equal(normalizeBattlefields(seen), seen);
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
