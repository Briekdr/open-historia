// Run: node --test src/runtime/fronts/movement.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { decodeTracks, decodeTroops } from "./codec.js";
import { CONTROL_RADIUS_MAX_KM, HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL } from "./constants.js";
import { createFrontRun, runFronts } from "./engine.js";
import { normalizeBattlefield } from "./record.js";
import { replayOf } from "./replay.js";
import { applyFlips, frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn, readBattlefield } from "./testKit.js";

const legend = {
  A: "Aland",
  B: "Borduria",
  C: "Cisland",
  M: { owner: "Borduria", typeId: "peaks" },
  S: { owner: "Borduria", typeId: "marsh" },
  "~": null,
};
const regionTypes = [{ id: "peaks", passable: false, pathfindingSpeed: 1 }, { id: "marsh", passable: true, pathfindingSpeed: 0.3 }];
const steady = { even: true, wander: 0 };
const plain = (options = {}) => syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1, ...options });
const standing = (side, word, extra = {}) => ({ s: side, sector: "all", order: word, since: "2024-02-20", ...extra });
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));

// A run a day at a time: each side's troops as they stood after each day, day 0 first.
const watchRun = (input) => {
  const days = [];
  const result = runFronts({ ...input, watch: ({ day, troops, holders, painters, homes, when }) => {
    days[day] = {
      troops: troops.map((list) => list.map(({ x, y, strength, state, hx, hy }) => ({ x, y, strength, state, hx, hy }))),
      holders: Uint8Array.from(holders),
      painters: Uint8Array.from(painters),
      homes: Uint8Array.from(homes),
      when: Float32Array.from(when),
    };
  } });
  return { days, result };
};
const kmOf = (frame, cells) => cells * frame.km;

// ---- shapes of attack ------------------------------------------------------------

test("a spearhead outruns its flanks", () => {
  const world = plain({ cities: [{ name: "Brod", lng: 23.5, lat: 50 }] });
  const record = battlefieldOn(world, {
    troops: [row(20.9, 49, 51, 10), row(21.1, 49, 51, 6, { strength: 60 })],
    orders: [standing(0, "spearhead", { sector: "centre", objective: "city: Brod" })],
  });
  const before = readBattlefield(record, world);
  const after = readBattlefield(runFronts(frontInput(world, { battlefields: [record], days: 8, steering: steady })).battlefields[0], world);
  const gained = (lat) => (after.lineAt(lat).at(-1) - before.lineAt(lat).at(-1)) * 71.5;
  assert.ok(gained(50) > 40, `the point of the spear went ${gained(50)} km`);
  assert.equal(gained(49.2), 0, "the southern flank stood");
  assert.equal(gained(50.8), 0, "and the northern");
  // The weight of the side has gathered behind the point.
  const near = after.troops[0].filter((troop) => Math.abs(troop.lat - 50) < 0.3).length;
  assert.ok(near >= 4, `${near} of ten within 33 km of the axis, where three stood`);
});

test("a blitz gains nothing while it masses, and then more than an even advance", () => {
  const world = plain();
  const troops = [row(20.9, 49, 51, 12), row(21.1, 49, 51, 12, { dig: 0.5 })];
  const start = (word, sector) => battlefieldOn(world, { troops, orders: [standing(0, word, { sector }), standing(1, "hold")] });
  const even = runFronts(frontInput(world, { battlefields: [start("advance", "all")], days: 24, steering: steady })).battlefields[0];
  const blitz = watchRun(frontInput(world, { battlefields: [start("blitz", "north")], days: 24, steering: steady }));
  const held = (holders) => holders.reduce((count, holder) => count + (holder === HOLDER_SIDE_A ? 1 : 0), 0);
  const base = held(blitz.days[0].holders);
  // The mass gathers for days before anyone steps off...
  const firstGain = blitz.days.findIndex((day) => held(day.holders) > base);
  assert.ok(firstGain >= 4, `the first ground was taken on day ${firstGain}`);
  for (let day = 1; day < firstGain; day += 1) assert.deepEqual(blitz.days[day].holders, blitz.days[0].holders);
  // ...and the sector's share of the side's troops rises day by day, not at a stroke.
  const frame = even.frame;
  const inNorth = (day) => blitz.days[day].troops[0].filter((troop) => troop.y > (frame.rows * 2) / 3).length;
  assert.equal(inNorth(0), 4);
  assert.ok(inNorth(1) <= 5, "no jump on the first day");
  assert.ok(inNorth(2) >= inNorth(1) && inNorth(3) >= inNorth(2) && inNorth(firstGain) >= 6, `north sector: ${[0, 1, 2, 3, 4, 5, firstGain].map(inNorth)}`);
  // An even advance at these odds takes nothing at all; the blitz breaks in.
  assert.equal(readBattlefield(even, world).held[0], base, "the even advance took nothing");
  assert.ok(held(blitz.days[24].holders) > base + 150, `the blitz took ${held(blitz.days[24].holders) - base} cells`);
  for (let index = 0; index < blitz.days[24].holders.length; index += 1) {
    if (blitz.days[24].holders[index] !== blitz.days[0].holders[index]) assert.ok(Math.floor(index / frame.cols) > frame.rows / 2, "and all of it in the north");
  }
});

// ---- a troop does not walk in a straight line -------------------------------------

test("with nothing to steer by a troop walks straight; with its own wander, no two walk alike, and the same run walks the same", () => {
  const world = plain();
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 8), []], orders: [standing(0, "advance")] });
  const bearings = (steering) => {
    const { days } = watchRun(frontInput(world, { battlefields: [record], days: 6, steering }));
    return days[6].troops[0].map((troop, index) => {
      const from = days[0].troops[0][index];
      return (troop.y - from.y) / (troop.x - from.x);
    });
  };
  // Even ground, nobody in reach, no town, the wander set aside: along the normal.
  for (const slope of bearings(steady).slice(2, 6)) assert.ok(Math.abs(slope) < 0.03, `straight (${slope})`);
  const wandering = bearings({ even: true });
  for (let index = 3; index < 6; index += 1) assert.ok(Math.abs(wandering[index] - wandering[index - 1]) > 0.005, `neighbours on different bearings (${wandering})`);
  assert.deepEqual(bearings({ even: true }), wandering);
});

test("a column bends round a strongpoint, toward a town, and through the gap in bad ground", () => {
  // Three strong defenders dug in together, in front of the middle of the line.
  const world = plain();
  const clump = [{ lng: 21.16, lat: 50.02 }, { lng: 21.2, lat: 50.08 }, { lng: 21.24, lat: 49.98 }].map((place) => ({ ...place, dig: 1 }));
  const blocked = battlefieldOn(world, { troops: [row(20.9, 49, 51, 9), clump], orders: [standing(0, "advance"), standing(1, "dig in")] });
  const { days } = watchRun(frontInput(world, { battlefields: [blocked], days: 9, steering: steady }));
  const frame = blocked.frame;
  const radius = CONTROL_RADIUS_MAX_KM / frame.km;
  const strong = days[0].troops[1].reduce((sum, troop) => [sum[0] + troop.x / 3, sum[1] + troop.y / 3], [0, 0]);
  // The attacker that faces it, the fifth of nine, is held up in front of it,
  // and so is the one beside it that the strongpoint reaches...
  for (let day = 0; day <= 6; day += 1) assert.ok(days[day].troops[0][4].x < strong[0] - 2, `held up on day ${day}`);
  // ...while the line either side of them goes round, wide of the strongpoint,
  // and closes in again behind it.
  const bowOf = (path) => {
    const [ax, ay] = [path[0].x, path[0].y];
    const [bx, by] = [path.at(-1).x, path.at(-1).y];
    return Math.max(...path.map((troop) => Math.abs((troop.x - ax) * (by - ay) - (troop.y - ay) * (bx - ax)) / Math.hypot(bx - ax, by - ay)));
  };
  for (const index of [2, 3, 6, 7]) {
    const path = days.map((day) => day.troops[0][index]);
    const passing = path.find((troop) => troop.x >= strong[0]);
    assert.ok(passing && Math.abs(passing.y - strong[1]) >= radius, `troop ${index} passed ${kmOf(frame, Math.abs((passing ?? path[0]).y - strong[1]))} km to the side of it`);
    for (let day = 0; day <= 6; day += 1) assert.ok(Math.hypot(path[day].x - strong[0], path[day].y - strong[1]) > radius, "and none went through it");
  }
  for (const index of [2, 6]) {
    const path = days.map((day) => day.troops[0][index]);
    assert.ok(bowOf(path) >= radius / 2, `the path of troop ${index} is no straight line: it bows ${kmOf(frame, bowOf(path))} km from its chord`);
    assert.ok(Math.abs(path.at(-1).y - strong[1]) < Math.abs(path[0].y - strong[1]), "it has closed in behind the strongpoint");
  }

  // A town 20 km off the axis and 60 km ahead: the path bends toward it.
  const town = [{ name: "Brod", lng: 21.84, lat: 50.18 }];
  const drawn = plain({ cities: town });
  const lone = battlefieldOn(drawn, { troops: [[{ lng: 20.9, lat: 50 }], []], orders: [standing(0, "advance")] });
  const toTown = watchRun(frontInput(drawn, { battlefields: [lone], days: 5, steering: steady })).days;
  const [townX, townY] = readBattlefield(lone, drawn).place.toCell(21.84, 50.18);
  let nearest = Infinity;
  for (let day = 1; day < toTown.length; day += 1) {
    const from = toTown[day - 1].troops[0][0];
    const to = toTown[day].troops[0][0];
    const along = Math.max(0, Math.min(1, ((townX - from.x) * (to.x - from.x) + (townY - from.y) * (to.y - from.y)) / ((to.x - from.x) ** 2 + (to.y - from.y) ** 2)));
    nearest = Math.min(nearest, Math.hypot(townX - from.x - (to.x - from.x) * along, townY - from.y - (to.y - from.y) * along));
  }
  assert.ok(nearest < Math.abs(townY - toTown[0].troops[0][0].y) - 0.5, "nearer than a straight walk would have taken it");

  // A belt of marsh across the way with one gap in it: the gap takes more than its share.
  const marsh = syntheticMap({ layout: ["ABSBBB", "ABSBBB", "ABBBBB", "ABSBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.5 });
  const wet = battlefieldOn(marsh, { troops: [row(20.9, 49, 51, 12), []], orders: [standing(0, "advance")], regionTypes });
  const crossing = watchRun(frontInput(marsh, { battlefields: [wet], days: 7, steering: steady, regionTypes }));
  const seen = readBattlefield(crossing.result.battlefields[0], marsh, { regionTypes });
  const through = seen.troops[0].filter((troop) => troop.lng > 23.05);
  const byGap = through.filter((troop) => troop.lat > 49.5 && troop.lat < 50);
  assert.ok(through.length >= 2 && byGap.length / through.length > 0.25, `${byGap.length} of the ${through.length} that are through came by the gap, a quarter of the width`);
});

test("no step ends in a wall, no march ends on the other side's ground, and a heading turns by degrees", () => {
  const world = syntheticMap({ layout: ["ABMBBB", "ABBBMB", "ABMBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.5, cities: [{ name: "Brod", lng: 24.5, lat: 50.2 }] });
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 12), row(21.1, 49, 51, 7, { strength: 50 })], orders: [standing(0, "advance"), standing(1, "fall back")], regionTypes, pool: [200, 200] });
  const { days } = watchRun(frontInput(world, { battlefields: [record], days: 14, regionTypes }));
  const { cols, rows } = record.frame;
  let moves = 0;
  days.forEach((day, at) => {
    day.troops.forEach((list, side) => list.forEach((troop, index) => {
      if (!(troop.strength > 0)) return;
      assert.ok(troop.x >= 0 && troop.y >= 0 && troop.x < cols && troop.y < rows, "on the frame");
      const cell = Math.floor(troop.y) * cols + Math.floor(troop.x);
      assert.notEqual(day.holders[cell], HOLDER_WALL, `day ${at}: a troop stands in a wall`);
      // On its own ground, or in the cell the line runs through beside it.
      const beside = [cell, cell - 1, cell + 1, cell - cols, cell + cols].some((other) => day.holders[other] === side);
      assert.ok(beside, `day ${at}: troop ${index} of side ${side} is on the other side's ground`);
      const before = at > 1 ? days[at - 1].troops[side][index] : null;
      const earlier = at > 1 ? days[at - 2].troops[side][index] : null;
      if (side !== 0 || !before || !earlier || troop.state !== 1) return;
      const now = [troop.x - before.x, troop.y - before.y];
      const then = [before.x - earlier.x, before.y - earlier.y];
      const lengths = Math.hypot(...now) * Math.hypot(...then);
      if (Math.hypot(...now) < 1 || Math.hypot(...then) < 1) return;
      moves += 1;
      // The heading it keeps turns by no more than 45 degrees a day.
      const kept = before.hx * troop.hx + before.hy * troop.hy;
      if (before.hx !== 0 || before.hy !== 0) assert.ok(kept >= 0.7 - 1e-9, `day ${at}: a heading turned by more than 45 degrees (cosine ${kept})`);
      // Sliding along a wall it may give a little of its way back; it never turns round.
      assert.ok((now[0] * then[0] + now[1] * then[1]) / lengths > -0.2, `day ${at}: troop ${index} came back on itself`);
    }));
  });
  assert.ok(moves > 40, `${moves} moves were checked`);
});

// ---- individuals, not a rank ---------------------------------------------------------

test("troops do not stand evenly spaced, at one depth, or advance in lockstep", () => {
  // A border 450 km long, and two states that each field thirty counters.
  const world = syntheticMap({ layout: ["ABBBB", "ABBBB", "ABBBB", "ABBBB"], legend, west: 20, north: 52, step: 1.4, stepLat: 1 });
  const thirty = () => 2.5;
  const opened = runFronts(frontInput(world, { days: 0, strengthOf: thirty }));
  const seen = readBattlefield(opened.battlefields[0], world);
  for (const side of [0, 1]) {
    const list = seen.troops[side].slice().sort((a, b) => a.y - b.y);
    assert.ok(list.length >= 28 && list.length <= 32, `${list.length} counters`);
    const gaps = list.slice(1).map((troop, index) => troop.y - list[index].y);
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    assert.ok(Math.max(...gaps) >= 1.5 * Math.min(...gaps), "the widest gap is half as wide again as the narrowest");
    assert.ok(Math.min(...gaps) >= 0.3 * mean, `and no two crowd each other (${Math.min(...gaps)} against a mean of ${mean})`);
    const border = seen.place.toCell(21.4, 50)[0];
    const depths = list.map((troop) => Math.abs(troop.x - border));
    assert.ok(Math.max(...depths) >= 2 * Math.min(...depths), `the furthest back stands twice as far back as the nearest (${Math.min(...depths)} to ${Math.max(...depths)} cells)`);
  }
  assert.deepEqual(runFronts(frontInput(world, { days: 0, strengthOf: thirty })).battlefields[0].troops, opened.battlefields[0].troops, "the same input stands them in the same places");
  assert.notDeepEqual(runFronts(frontInput(world, { days: 0, strengthOf: thirty, seed: "other" })).battlefields[0].troops, opened.battlefields[0].troops);

  // Ten days of advance against a weak, even defence: no lockstep.
  const fought = watchRun(frontInput(world, { days: 10, strengthOf: (name) => (name === "Aland" ? 6 : 2), moments: [{ day: 0, type: "order", battlefield: "Aland - Borduria front", side: "Aland", order: "advance", sector: "all" }] }));
  const advance = fought.days[10].troops[0].map((troop, index) => troop.x - fought.days[0].troops[0][index].x).filter((gone, index) => fought.days[10].troops[0][index].strength > 0);
  const mean = advance.reduce((sum, gone) => sum + gone, 0) / advance.length;
  assert.ok(mean > 20, `they advanced ${mean} cells on average`);
  assert.ok((Math.max(...advance) - Math.min(...advance)) / mean >= 0.25, `from ${Math.min(...advance)} to ${Math.max(...advance)} cells`);
});

test("a troop under an attack order never comes back on itself, and one whose attack is over stays where it stands", () => {
  const world = plain({ cities: [{ name: "Brod", lng: 23.4, lat: 50.4 }] });
  const troops = [row(20.9, 49, 51, 11), [...row(21.1, 49, 51, 5, { strength: 60 }), { lng: 21.8, lat: 50.03, dig: 1 }, { lng: 21.85, lat: 49.97, dig: 1 }]];
  const record = battlefieldOn(world, { troops, orders: [standing(0, "advance")], pool: [300, 100] });
  // The strongpoint it goes round is cut off and holds out for ten days: the
  // attack is called off once that is over.
  const moments = [{ day: 22, type: "order", battlefield: "The front", side: "Aland", order: "hold", sector: "all" }];
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], days: 28, moments }));
  let checked = 0;
  for (let index = 0; index < troops[0].length; index += 1) {
    for (let day = 2; day <= 22; day += 1) {
      const now = [days[day].troops[0][index].x - days[day - 1].troops[0][index].x, days[day].troops[0][index].y - days[day - 1].troops[0][index].y];
      const then = [days[day - 1].troops[0][index].x - days[day - 2].troops[0][index].x, days[day - 1].troops[0][index].y - days[day - 2].troops[0][index].y];
      if (Math.hypot(...now) <= 0.05 || Math.hypot(...then) <= 0.05) continue;
      checked += 1;
      assert.ok(now[0] * then[0] + now[1] * then[1] >= 0, `troop ${index} doubled back on day ${day}`);
    }
    // After the attack is called off nobody walks back into a row.
    for (let day = 24; day <= 28; day += 1) {
      const moved = Math.hypot(days[day].troops[0][index].x - days[23].troops[0][index].x, days[day].troops[0][index].y - days[23].troops[0][index].y);
      assert.ok(moved <= 0.1, `troop ${index} moved ${moved} cells after its attack was over`);
    }
  }
  assert.ok(checked > 60);
  // The path the map is given has no sharp turn in it and never crosses itself.
  const tracks = replayOf(runFronts(frontInput(world, { battlefields: [record], days: 12 })).battlefields[0]).tracks[0];
  assert.equal(tracks.length, troops[0].length);
  const crosses = (a, b, c, d) => {
    const turn = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
  };
  for (const track of tracks) {
    for (let at = 2; at < track.length; at += 1) {
      const one = [track[at - 1].x - track[at - 2].x, track[at - 1].y - track[at - 2].y];
      const two = [track[at].x - track[at - 1].x, track[at].y - track[at - 1].y];
      if (Math.hypot(...one) > 0.2 && Math.hypot(...two) > 0.2) assert.ok(one[0] * two[0] + one[1] * two[1] >= 0, "a turn sharper than a right angle");
      for (let other = 1; other < at - 1; other += 1) assert.equal(crosses(track[other - 1], track[other], track[at - 1], track[at]), false, "a path that crosses itself");
    }
  }
  assert.equal(result.battlefields[0].orders[0].order, "hold");
});

// ---- flanking ------------------------------------------------------------------------

test("a defender holds worse against two directions at once, and works are no help from behind", () => {
  // A strip of Borduria 107 km wide between two lands of Aland's, and one
  // defender in it, standing behind the western edge and facing it.
  const world = syntheticMap({ layout: ["~~~~~~~~", "AABBBAA~", "~~~~~~~~"], legend, west: 20, north: 51, step: 0.5, stepLat: 1 });
  const fight = (attackers, extra = {}, days = 6) => {
    const record = battlefieldOn(world, { troops: [attackers, [{ lng: 21.2, lat: 50, ...extra }]], orders: [standing(0, "advance"), standing(1, "hold")] });
    const result = runFronts(frontInput(world, { battlefields: [record], days, steering: steady }));
    return readBattlefield(result.battlefields[0], world);
  };
  const untouched = readBattlefield(battlefieldOn(world), world);
  const west = { lng: 20.93, lat: 50 };
  const east = { lng: 22.57, lat: 50 };
  // One attacker in front of it gets nowhere in six days. With another coming
  // at it from behind, the same attacker breaks in, and the defender comes off
  // worse than against either of them alone.
  const front = fight([west]);
  const behind = fight([east]);
  const both = fight([west, east]);
  const [startX] = untouched.place.toCell(20.93, 50);
  assert.ok(Math.abs(front.troops[0][0].x - startX) < 0.1, "alone in front of it: no step forward");
  assert.equal(front.held[1], untouched.held[1], "and no ground");
  assert.ok(both.troops[0][0].x > startX + 0.5, `with another behind the defender it broke in: ${both.troops[0][0].x - startX} cells`);
  assert.ok(both.troops[1][0].x > front.troops[1][0].x, "and the defender gave way");
  assert.ok(both.troops[1][0].strength < Math.min(front.troops[1][0].strength, behind.troops[1][0].strength) - 2, `the defender: ${both.troops[1][0].strength} left, against ${front.troops[1][0].strength} and ${behind.troops[1][0].strength}`);

  // Works dug facing the enemy count against the front...
  const dugFront = fight([west], { dig: 1 }, 10);
  const openFront = fight([west], {}, 10);
  assert.ok(dugFront.troops[1][0].strength > openFront.troops[1][0].strength, "a dug-in defender comes off better against its front");
  assert.ok(dugFront.troops[0][0].strength < openFront.troops[0][0].strength, "and the attacker worse");
  // ...and for nothing against an attacker coming from behind.
  const dug = fight([east], { dig: 1 }, 2);
  const open = fight([east], {}, 2);
  assert.deepEqual(dug.holders, open.holders, "dug in or not, the same ground is lost to an attack from behind");
  assert.ok(dug.held[1] < untouched.held[1], "and ground was lost");
});

test("a flank sends its troops round one side of the defenders, and none through them", () => {
  const cities = [{ name: "Brod", lng: 22.0, lat: 50 }];
  const world = plain({ cities });
  const clump = [{ lng: 21.9, lat: 50.05 }, { lng: 21.95, lat: 49.95 }, { lng: 22.0, lat: 50.1 }, { lng: 22.05, lat: 50 }].map((place) => ({ ...place, dig: 1 }));
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 12), clump], orders: [standing(1, "dig in")] });
  // Told in other words, it is the same order.
  const moments = [{ day: 0, type: "order", battlefield: "The front", side: "Aland", order: "outflank", sector: "all", objective: "city: Brod" }];
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], days: 12, moments, steering: steady }));
  assert.equal(result.battlefields[0].orders.find((order) => order.s === 0).order, "flank");
  assert.deepEqual(result.notes, []);
  const frame = record.frame;
  const [townX, townY] = readBattlefield(record, world).place.toCell(22.0, 50);
  const radius = CONTROL_RADIUS_MAX_KM / frame.km;
  const movers = days[12].troops[0].map((troop, index) => ({ index, gone: troop.x - days[0].troops[0][index].x })).filter((troop) => troop.gone > 4);
  assert.ok(movers.length >= 2, `${movers.length} troops went round`);
  const sides = new Set();
  for (const { index } of movers) {
    for (let day = 0; day < days.length; day += 1) {
      const troop = days[day].troops[0][index];
      assert.ok(Math.hypot(troop.x - townX, troop.y - townY) > radius, "none went through the defenders");
      const before = day > 0 ? days[day - 1].troops[0][index] : troop;
      // The day it came level with them: which side of them it was on.
      if (before.x < townX && troop.x >= townX) sides.add(Math.sign(before.y + ((troop.y - before.y) * (townX - before.x)) / (troop.x - before.x) - townY));
    }
  }
  assert.equal(sides.size, 1, "and all on one side of them");
});

// ---- what the map is handed ------------------------------------------------------------

test("taken ground is painted for the member whose troops took it, and the map is handed sound ground every day", () => {
  const world = syntheticMap({ layout: ["ABBBBB", "CBBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1 });
  const sides = [["Aland", "Cisland"], ["Borduria"]];
  // Aland's troops in the north, Cisland's in the south.
  const troops = [[...row(20.9, 49, 50, 5, { owner: 1 }), ...row(20.9, 50, 51, 5, { owner: 0 })], row(21.1, 49, 51, 3, { strength: 40 })];
  const record = battlefieldOn(world, { sides, troops, orders: [standing(0, "advance")] });
  const wars = [{ id: "war-1", status: "active", sideA: sides[0], sideB: sides[1] }];
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], wars, days: 6, steering: steady }));
  const { cols, rows } = record.frame;
  const last = days[6];
  let north = 0;
  let south = 0;
  for (let index = 0; index < last.holders.length; index += 1) {
    assert.ok([HOLDER_SIDE_A, HOLDER_SIDE_B, HOLDER_WALL].includes(last.holders[index]));
    if (last.holders[index] === HOLDER_WALL) continue;
    assert.ok(last.painters[index] < sides[last.holders[index]].length, "a painter is one of the side's own members");
    if (last.holders[index] !== HOLDER_SIDE_A || days[0].holders[index] === HOLDER_SIDE_A) continue;
    const row = Math.floor(index / cols);
    // Away from where the two meet, each took its own.
    if (row > rows * 0.62) {
      assert.equal(last.painters[index], 0, "taken in the north: Aland's");
      north += 1;
    } else if (row < rows * 0.38) {
      assert.equal(last.painters[index], 1, "taken in the south: Cisland's");
      south += 1;
    }
  }
  assert.ok(north > 100 && south > 100);
  // Whose home each cell is does not move with the line.
  for (const day of days) assert.deepEqual(day.homes, days[0].homes);
  assert.ok(days[0].homes.includes(0) && days[0].homes.includes(1) && days[0].homes.includes(2));
  // A cell that changed hands did so at some part of that day.
  for (let day = 1; day < days.length; day += 1) {
    let changed = 0;
    for (let index = 0; index < days[day].holders.length; index += 1) {
      if (days[day].holders[index] === days[day - 1].holders[index]) continue;
      changed += 1;
      assert.ok(days[day].when[index] >= 0 && days[day].when[index] <= 1, `when: ${days[day].when[index]}`);
    }
    assert.ok(changed > 0);
  }
  const early = days[3].when.filter((value, index) => days[3].holders[index] !== days[2].holders[index]);
  assert.ok(Math.min(...early) < 0.5 && Math.max(...early) > 0.5, "spread over the day, as the troops walked");

  // The record keeps a replay of it, and no line.
  const [saved] = result.battlefields;
  assert.equal(saved.frames, undefined);
  assert.deepEqual(saved.replay.names, ["Aland", "Cisland", "Borduria"]);
  assert.deepEqual(normalizeBattlefield(saved), saved);
  const replay = replayOf(saved);
  assert.equal(replay.days, 6);
  // Painted in the replay as the engine painted it: Cisland's ground in the south is state 2.
  const ground = Uint8Array.from(replay.paint.began);
  replay.paint.cells.forEach((cell, index) => { ground[cell] = replay.paint.states[index]; });
  const probe = Math.floor(rows * 0.2) * cols + Math.floor(readBattlefield(record, world).place.toCell(21.5, 50)[0]);
  assert.equal(last.holders[probe], HOLDER_SIDE_A);
  assert.equal(ground[probe], 2);
  // One path a troop, ending where the record has it.
  for (const side of [0, 1]) {
    const tracks = decodeTracks(saved.replay.t[side]);
    const list = decodeTroops(saved.troops[side]);
    assert.equal(tracks.length, list.length);
    list.forEach((troop, index) => {
      if (!(troop.strength > 0)) return;
      const end = tracks[index].at(-1);
      assert.ok(Math.abs(end.x - troop.x) <= 1 / 16 && Math.abs(end.y - troop.y) <= 1 / 16);
    });
  }
  assert.ok(applyFlips(world, result.flips));
});

test("one list of troops a side for a whole record: the fallen keep their places until the next run begins", () => {
  const world = plain();
  const units = [
    { id: "unit-7", name: "7th Rifles", type: "infantry", ownerCode: "Aland", strength: 90, lng: 20.8, lat: 50.4 },
    { id: "unit-8", name: "8th Lancers", type: "armor", ownerCode: "Borduria", strength: 20, lng: 21.15, lat: 50 },
  ];
  // Borduria's few are overrun, and one of them is a named formation; both sides are sent more.
  const record = battlefieldOn(world, { troops: [row(20.9, 49, 51, 12), row(21.1, 49.6, 50.4, 3, { strength: 25 })], orders: [standing(0, "advance")] });
  const moments = [
    { day: 3, type: "reinforce", owner: "Aland", strength: 80, kind: "infantry", lng: 20.7, lat: 49.5 },
    { day: 4, type: "reinforce", owner: "Borduria", name: "9th Guards", unitId: "unit-9", strength: 100, kind: "armor", lng: 24.5, lat: 50.5 },
  ];
  const { days, result } = watchRun(frontInput(world, { battlefields: [record], units, days: 10, moments, steering: steady }));
  const [saved] = result.battlefields;
  const lists = saved.troops.map(decodeTroops);
  assert.equal(lists[0].length, 14, "twelve, a formation taken in, and one sent");
  assert.equal(lists[1].length, 5);
  assert.ok(lists[1].some((troop) => troop.strength === 0), "the fallen are still in the saved list");
  // A list only ever grows at its end: every index of an earlier day means the same troop later.
  for (let day = 1; day < days.length; day += 1) {
    for (const side of [0, 1]) assert.ok(days[day].troops[side].length >= days[day - 1].troops[side].length);
  }
  assert.equal(days[2].troops[0].length, 13);
  assert.equal(days[3].troops[0].length, 14);
  for (const entry of saved.named) {
    assert.equal(lists[entry.s][entry.i].named, true, `${entry.name} is where the record says`);
    assert.equal(decodeTracks(saved.replay.t[entry.s]).length, lists[entry.s].length);
  }
  assert.deepEqual(saved.named.map((entry) => entry.unitId), ["unit-7", "unit-8", "unit-9"]);
  // The named formation that fell is struck off the world's list when the run is saved.
  const lancers = saved.named.find((entry) => entry.unitId === "unit-8");
  assert.equal(lists[1][lancers.i].strength, 0);
  assert.deepEqual(result.unitChanges, [
    { unitId: "unit-7", committedTo: "The front" },
    { unitId: "unit-8", committedTo: "The front" },
    { unitId: "unit-9", committedTo: "The front" },
    { unitId: "unit-8", committedTo: "", remove: true },
  ]);

  // The next run begins by dropping the fallen: its lists are in its own order from the first day.
  applyFlips(world, result.flips);
  const next = watchRun(frontInput(world, { battlefields: result.battlefields, days: 0, fromDate: "2024-03-11", steering: steady }));
  const began = next.days[0].troops;
  assert.ok(began[0].every((troop) => troop.strength > 0) && began[1].every((troop) => troop.strength > 0), "no fallen troop in the first day of the next run");
  const after = next.result.battlefields[0];
  assert.deepEqual(after.named.map((entry) => entry.unitId), ["unit-7", "unit-9"]);
  const before = (unitId) => lists[saved.named.find((entry) => entry.unitId === unitId).s][saved.named.find((entry) => entry.unitId === unitId).i];
  for (const entry of after.named) {
    const troop = began[entry.s][entry.i];
    const was = before(entry.unitId);
    assert.ok(Math.abs(troop.x - was.x) < 1e-9 && Math.abs(troop.y - was.y) < 1e-9, `${entry.name} is the same formation, at the same place`);
    assert.equal(decodeTroops(after.troops[entry.s])[entry.i].named, true);
  }
  assert.deepEqual(next.result.unitChanges, []);
});
