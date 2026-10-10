// Run: node --test src/runtime/fronts/dynamics.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { CONTROL_RADIUS_KM, HOLDER_SIDE_A, HOLDER_SIDE_B, LINK_RADII, PATCH_MAX_KM2 } from "./constants.js";
import { createFrontRun, runFronts } from "./engine.js";
import { takeCapsule } from "./field.js";
import { applyFlips, frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn, disc, kmPerDegree, readBattlefield, settleWorld } from "./testKit.js";

const legend = { A: "Aland", B: "Borduria", N: "Neutralia", M: { owner: "Borduria", typeId: "peaks" }, "~": null };
const regionTypes = [{ id: "peaks", passable: false, pathfindingSpeed: 1 }];
// What every troop draws is set aside, and the wander with it: a test that
// measures one thing at a time needs troops that are all alike.
const steady = { even: true, wander: 0 };

// Aland a strip in the west, Borduria wide in the east: room to advance into.
const plain = (options = {}) => syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1, ...options });
const standing = (side, word, extra = {}) => ({ s: side, sector: "all", order: word, since: "2024-02-20", ...extra });

// Troops in a row along a meridian, `count` of them between two latitudes.
const row = (lng, south, north, count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count, ...extra }));

// A run a day at a time: the result as it stood after each day, day 0 first.
const dayByDay = (input) => {
  const run = createFrontRun(input);
  const seen = [run.snapshot()];
  for (let day = 1; day <= input.days; day += 1) {
    run.advance(1);
    seen.push(run.snapshot());
  }
  return seen;
};

const eastmost = (seen, lat) => seen.lineAt(lat).at(-1);

test("a straight advance through ground nobody defends covers pace times days, at any latitude and on a flat sheet", () => {
  for (const [label, options] of [
    ["30 north", { north: 31 }],
    ["50 north", { north: 51 }],
    ["65 north", { north: 66, layout: ["ABBBBBBBB", "ABBBBBBBB"] }],
    ["a flat sheet", { north: 51, flat: true, scale: 60 }],
  ]) {
    const world = plain(options);
    const middle = options.north - 1;
    const troops = [row(20.9, middle - 0.75, middle + 0.75, 9), []];
    const record = battlefieldOn(world, { troops, orders: [standing(0, "advance")] });
    const input = (days) => frontInput(world, { battlefields: [record], days, steering: steady });
    const early = readBattlefield(runFronts(input(2)).battlefields[0], world);
    const late = readBattlefield(runFronts(input(7)).battlefields[0], world);
    const frame = record.frame;
    // Infantry in the modern era advances 30 km a day when nothing is in its way.
    for (const lat of [middle - 0.2, middle, middle + 0.2]) {
      const gainedKm = (eastmost(late, lat) - eastmost(early, lat)) * kmPerDegree(frame, lat);
      assert.ok(Math.abs(gainedKm - 150) <= frame.km / 8, `${label}, at ${lat}: ${gainedKm.toFixed(2)} km in five days, on ${frame.km} km cells`);
    }
    // And the troops went straight: the middle one is within a degree or so of the latitude it set off
    // from (equal marches east from a meridian do not end on a meridian, so the front leans a little).
    assert.ok(Math.abs(late.troops[0][4].lat - troops[0][4].lat) < 0.06, `${label}: straight along the normal (${late.troops[0][4].lat} from ${troops[0][4].lat})`);
    assert.equal(late.troops[0][4].state, 1, "advancing");
  }
});

// A border only 55 km long, between two seas: the troops of a short line stand close together.
const neck = (options = {}) => syntheticMap({ layout: ["~~~~~~", "ABBBBB", "~~~~~~"], legend, west: 20, north: 50.75, step: 1, stepLat: 0.5, ...options });

// How far a point is from a path of troop positions, in cells.
const offPath = (path, x, y) => {
  let best = Infinity;
  for (let index = 0; index + 1 < path.length; index += 1) {
    const [ax, ay] = path[index];
    const sx = path[index + 1][0] - ax;
    const sy = path[index + 1][1] - ay;
    const length = sx * sx + sy * sy;
    const along = length > 0 ? Math.max(0, Math.min(1, ((x - ax) * sx + (y - ay) * sy) / length)) : 0;
    best = Math.min(best, Math.hypot(x - ax - sx * along, y - ay - sy * along));
  }
  return best;
};

test("the ground changes hands only where a troop walked", () => {
  const world = neck({ cities: [{ name: "Brod", lng: 23.5, lat: 50.1 }] });
  const record = battlefieldOn(world, { troops: [[{ lng: 20.9, lat: 50 }], []], orders: [standing(0, "spearhead", { objective: "city: Brod" })] });
  const before = readBattlefield(record, world);
  const days = dayByDay(frontInput(world, { battlefields: [record], days: 4, steering: steady }));
  const after = readBattlefield(days[4].battlefields[0], world);
  const path = days.map((day) => readBattlefield(day.battlefields[0], world).troops[0][0]).map((troop) => [troop.x, troop.y]);
  const { toCell, kmAt } = after.place;
  // It went at the city, 30 km a day.
  const walkedKm = Math.hypot(path[4][0] - path[0][0], path[4][1] - path[0][1]) * kmAt(path[4][1]);
  assert.ok(Math.abs(walkedKm - 120) < 4, `${walkedKm} km in four days`);
  const [cityX, cityY] = toCell(23.5, 50.1);
  assert.ok(Math.hypot(cityX - path[4][0], cityY - path[4][1]) < Math.hypot(cityX - path[0][0], cityY - path[0][1]) - 28, "toward its objective");
  assert.ok(path[4][1] > path[0][1], "which lies a little north of it");

  const radius = CONTROL_RADIUS_KM[0] / kmAt(path[0][1]);
  let taken = 0;
  let same = 0;
  for (let index = 0; index < after.holders.length; index += 1) {
    const distance = offPath(path, (index % after.frame.cols) + 0.5, Math.floor(index / after.frame.cols) + 0.5);
    if (after.holders[index] !== before.holders[index]) {
      taken += 1;
      assert.equal(after.holders[index], HOLDER_SIDE_A);
      assert.ok(distance <= radius + 0.3, `a cell ${distance.toFixed(2)} cells from its path changed hands (its radius is ${radius.toFixed(2)})`);
    } else if (before.holders[index] === HOLDER_SIDE_B) assert.ok(distance >= radius - 0.3, `a cell ${distance.toFixed(2)} cells from its path did not`);
    // Away from where it walked the field is the same to the last bit.
    if (distance > radius + 5 && before.field.play[index]) {
      assert.ok(Object.is(after.field.phi[index], before.field.phi[index]), `cell ${index}`);
      same += 1;
    }
  }
  assert.ok(taken > 100 && same > 200, `${taken} cells taken, ${same} far from it untouched`);
});

test("two troops advancing within the link distance leave nothing between their paths; further apart they leave a strip", () => {
  const linkKm = LINK_RADII * CONTROL_RADIUS_KM[0];
  // On a short border two troops stand 27 km apart; on a long one, 110.
  const run = (world, lats) => {
    const record = battlefieldOn(world, { troops: [lats.map((lat) => ({ lng: 20.9, lat })), []], orders: [standing(0, "advance")] });
    return readBattlefield(runFronts(frontInput(world, { battlefields: [record], days: 3, steering: steady })).battlefields[0], world);
  };
  const near = run(neck(), [49.875, 50.125]);
  const far = run(plain(), [49.5, 50.5]);
  const apartKm = (seen) => Math.abs(seen.troops[0][0].y - seen.troops[0][1].y) * seen.frame.km;
  assert.ok(apartKm(near) < linkKm && apartKm(far) > linkKm, `${apartKm(near)} and ${apartKm(far)} km apart, against ${linkKm}`);
  // Half way between them, half way along the advance.
  const probe = (seen) => {
    const front = Math.min(...seen.troops[0].map((troop) => troop.lng));
    return seen.holderAt((21 + front) / 2, 50);
  };
  assert.equal(probe(near), HOLDER_SIDE_A, "shoulder to shoulder they sweep one strip");
  assert.equal(probe(far), HOLDER_SIDE_B, "apart, each sweeps only its own corridor");
  for (const seen of [near, far]) {
    for (const troop of seen.troops[0]) {
      assert.ok(troop.lng > 21.9, `each advanced (${troop.lng})`);
      assert.equal(seen.holderAt(troop.lng - 0.1, troop.lat), HOLDER_SIDE_A, "and its own way is its side's");
    }
  }
});

test("an attack at worse than 1.15 to 1 gains nothing, and both sides pay for it", () => {
  const world = plain();
  const troops = [row(20.9, 49, 51, 4), row(21.1, 49, 51, 9, { dig: 0.5 })];
  const record = battlefieldOn(world, { troops, orders: [standing(0, "advance"), standing(1, "hold")] });
  const result = runFronts(frontInput(world, { battlefields: [record], days: 30, steering: steady }));
  const [after] = result.battlefields;
  assert.deepEqual(after.field, record.field, "the line did not move");
  const seen = readBattlefield(after, world);
  const before = readBattlefield(record, world);
  seen.troops[0].forEach((troop, index) => {
    assert.ok(Math.abs(troop.x - before.troops[0][index].x) < 0.07 && Math.abs(troop.y - before.troops[0][index].y) < 0.07, "the attackers did not move");
    assert.ok(troop.strength < 80, `and paid for the failed assault (${troop.strength})`);
  });
  for (const troop of seen.troops[1]) assert.ok(troop.strength < 100 && troop.strength > 90, `so did the troops that stopped them, less (${troop.strength})`);
  assert.deepEqual(result.flips, []);
  assert.equal(result.stats.steps > 0, true, "they tried every day");
});

test("a defender in the way is pushed back with the attacker, and is still in front of it", () => {
  const world = plain();
  const troops = [row(20.92, 49, 51, 9), [{ lng: 21.08, lat: 50, strength: 35 }]];
  const record = battlefieldOn(world, { troops, orders: [standing(0, "advance")] });
  const days = dayByDay(frontInput(world, { battlefields: [record], days: 5, steering: steady }));
  const first = readBattlefield(days[0].battlefields[0], world);
  const last = readBattlefield(days[5].battlefields[0], world);
  const [defender] = last.troops[1];
  assert.ok(defender.strength > 0, "it lives");
  assert.ok(defender.strength < first.troops[1][0].strength, "giving way cost it");
  assert.ok(defender.lng > first.troops[1][0].lng + 0.3, `it was pushed back (${first.troops[1][0].lng} to ${defender.lng})`);
  // The attacker that faced it is the fifth of the nine.
  for (const day of days.slice(1)) {
    const seen = readBattlefield(day.battlefields[0], world);
    assert.ok(seen.troops[1][0].lng > seen.troops[0][4].lng, "and it is still in front of the attacker that pushed it, every day");
  }
  assert.equal(last.holderAt(defender.lng, defender.lat), HOLDER_SIDE_B, "on its own side's ground");
  assert.ok(eastmost(last, 50) > eastmost(first, 50) + 0.3, "while the line went forward");
});

test("under fall back the line does not move until the other side walks in, and then it follows them", () => {
  const world = plain();
  const troops = [row(20.9, 49.6, 50.4, 6), row(21.1, 49.6, 50.4, 6)];
  // Aland is dug in and stays; Borduria falls back.
  const unpursued = battlefieldOn(world, { troops, orders: [standing(0, "dig in"), standing(1, "fall back")] });
  const left = runFronts(frontInput(world, { battlefields: [unpursued], days: 5, steering: steady })).battlefields[0];
  assert.deepEqual(left.field, unpursued.field, "nobody walked in: the line is where it was");
  const gone = readBattlefield(left, world);
  for (const troop of gone.troops[1]) assert.ok(troop.lng > 21.6, `the side falling back has gone back (${troop.lng})`);
  for (const troop of gone.troops[0]) assert.ok(troop.lng < 21, "the side dug in has stayed");
  // Aland merely holding goes after them, and the line goes with it.
  const pursued = battlefieldOn(world, { troops, orders: [standing(0, "hold"), standing(1, "fall back")] });
  const days = dayByDay(frontInput(world, { battlefields: [pursued], days: 5, steering: steady }));
  const after = readBattlefield(days[5].battlefields[0], world);
  assert.ok(eastmost(after, 50) > 21.8, `the line followed (${eastmost(after, 50)})`);
  for (const troop of after.troops[0]) assert.ok(troop.lng > 21.5 && troop.state === 1, "the pursuers walked in");
  const lines = days.map((day) => eastmost(readBattlefield(day.battlefields[0], world), 50));
  for (let day = 1; day < lines.length; day += 1) assert.ok(lines[day] >= lines[day - 1], "and it never came back");
});

test("a wall stops the line, and is never anybody's", () => {
  // A range no unit can cross lies across Borduria, with a gap of sea-level ground south of it.
  const world = syntheticMap({ layout: ["ABMBBB", "ABMBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 0.5 });
  const troops = [row(20.9, 49.6, 50.9, 8), []];
  const record = battlefieldOn(world, { troops, orders: [standing(0, "advance")], regionTypes });
  const result = runFronts(frontInput(world, { battlefields: [record], days: 9, steering: steady, regionTypes }));
  const seen = readBattlefield(result.battlefields[0], world, { regionTypes });
  for (const lat of [50.2, 50.6, 50.9]) {
    for (const lng of [22.1, 22.5, 22.9]) assert.equal(seen.holderAt(lng, lat), 2, "the range is a wall still");
    assert.equal(seen.holderAt(21.9, lat), HOLDER_SIDE_A, "the advance reached its foot");
    assert.equal(seen.holderAt(23.3, lat), HOLDER_SIDE_B, "and did not get behind it there");
  }
  assert.equal(seen.holderAt(22.5, 49.7), HOLDER_SIDE_A, "south of the range the way was open");
  for (const troop of seen.troops[0]) {
    assert.notEqual(seen.holderAt(troop.lng, troop.lat), 2, "no troop stands in the wall");
  }
});

test("a small enclosed patch is filled the day the ring closes; a large one is a pocket that holds ten days", () => {
  const world = plain({ cities: [{ name: "Brod", lng: 23.0, lat: 50.0 }] });
  const pocketOf = (radiusKm, manned) => {
    const record = battlefieldOn(world, {
      troops: [manned ? [{ lng: 23.0, lat: 50.0 }, { lng: 23.05, lat: 50.05 }] : [], row(21.1, 49.5, 50.5, 3)],
      // Ground of Aland's deep in Borduria, joined to nothing of its own.
      carve: (field, toCell) => disc(field, HOLDER_SIDE_A, ...toCell(23.0, 50.0), radiusKm / 4),
    });
    return dayByDay(frontInput(world, { battlefields: [record], days: 12, steering: steady }));
  };
  const cellKm2 = 16;
  const small = pocketOf(18, true);
  assert.ok(Math.PI * 18 * 18 < PATCH_MAX_KM2);
  const filled = readBattlefield(small[1].battlefields[0], world);
  assert.equal(filled.holderAt(23.0, 50.0), HOLDER_SIDE_B, "the patch is the other side's at the end of the first day");
  assert.ok(filled.troops[0].every((troop) => troop.strength === 0), "whoever stood in it is gone");
  assert.deepEqual(small[1].battlefields[0].log, [
    { d: "2024-03-02", k: "overrun", at: "city: Brod", s: 0 },
    { d: "2024-03-02", k: "city", at: "city: Brod", s: 1 },
  ], "said once, not once a troop; and the town in it is the other side's again");
  assert.deepEqual(small[1].battlefields[0].brief.pockets, []);

  const large = pocketOf(28, true);
  assert.ok(Math.PI * 28 * 28 > PATCH_MAX_KM2 + 8 * cellKm2);
  for (let day = 0; day <= 9; day += 1) {
    const seen = readBattlefield(large[day].battlefields[0], world);
    assert.equal(seen.holderAt(23.0, 50.0), HOLDER_SIDE_A, `still held on day ${day}`);
    if (day === 0) continue;
    assert.deepEqual(large[day].battlefields[0].brief.pockets, [{ s: 0, at: "city: Brod", days: day }]);
    for (const troop of seen.troops[0]) {
      assert.equal(troop.state, 2, "encircled");
      assert.ok(Math.abs(troop.strength - (100 - 4 * day)) < 2.5, `wasting away: ${troop.strength} on day ${day}`);
    }
  }
  const fallen = readBattlefield(large[10].battlefields[0], world);
  assert.equal(fallen.holderAt(23.0, 50.0), HOLDER_SIDE_B, "it surrenders on the tenth day and its ground changes hands");
  assert.ok(fallen.troops[0].every((troop) => troop.strength === 0));
  assert.deepEqual(large[10].battlefields[0].log, [{ d: "2024-03-11", k: "pocket", at: "city: Brod", s: 0 }, { d: "2024-03-11", k: "city", at: "city: Brod", s: 1 }]);
  // With nobody in it a pocket gives up at once.
  const empty = pocketOf(28, false);
  assert.equal(readBattlefield(empty[1].battlefields[0], world).holderAt(23.0, 50.0), HOLDER_SIDE_B);
  assert.equal(readBattlefield(empty[0].battlefields[0], world).holderAt(23.0, 50.0), HOLDER_SIDE_A);
});

test("supply is by home ground: a peninsula apart is fed, defenders ringed on their own soil are not", () => {
  // Borduria has a peninsula of its own joined to its mainland only by sea.
  const world = syntheticMap({ layout: ["ABBBB~B", "ABBBB~B", "ABBBB~~"], legend, west: 20, north: 51, step: 1, stepLat: 0.5, cities: [{ name: "Brod", lng: 22.5, lat: 50.2 }] });
  const quiet = battlefieldOn(world, { troops: [row(20.9, 49.6, 50.9, 4), row(21.1, 49.6, 50.9, 4)] });
  const after = runFronts(frontInput(world, { battlefields: [quiet], days: 20, steering: steady })).battlefields[0];
  assert.equal(readBattlefield(after, world).holderAt(26.5, 50.5), HOLDER_SIDE_B, "nothing touched the peninsula, and it stands");
  assert.deepEqual(after.brief.pockets, []);
  assert.deepEqual(after.log, []);

  // Aland has driven a ring round a piece of Borduria's own country, with defenders in it.
  const ringed = settleWorld(world, battlefieldOn(world, {
    troops: [[], [{ lng: 22.5, lat: 50.2 }, { lng: 22.55, lat: 50.25 }, { lng: 24.5, lat: 50.2 }]],
    carve: (field, toCell) => {
      const [x, y] = toCell(22.5, 50.2);
      for (let step = 0; step < 16; step += 1) {
        // A ring of discs 14 cells from its middle: ground of Aland's all the way round.
        const angle = [[1, 0], [0.924, 0.383], [0.707, 0.707], [0.383, 0.924], [0, 1], [-0.383, 0.924], [-0.707, 0.707], [-0.924, 0.383], [-1, 0], [-0.924, -0.383], [-0.707, -0.707], [-0.383, -0.924], [0, -1], [0.383, -0.924], [0.707, -0.707], [0.924, -0.383]][step];
        disc(field, HOLDER_SIDE_A, x + angle[0] * 14, y + angle[1] * 14, 3.5);
      }
      // ...joined to its own country by the way it came.
      const [homeX] = toCell(20.9, 50.2);
      takeCapsule(field, HOLDER_SIDE_A, homeX, y, x - 14, y, 3.5, 3.5);
    },
  }));
  const days = dayByDay(frontInput(world, { battlefields: [ringed], days: 11, steering: steady }));
  const first = readBattlefield(days[1].battlefields[0], world);
  assert.equal(first.holderAt(22.5, 50.2), HOLDER_SIDE_B);
  assert.deepEqual(days[1].battlefields[0].brief.pockets.map(({ s, days: stood }) => [s, stood]), [[1, 1]], "a pocket from the day the ring is closed, on its own soil");
  assert.equal(first.troops[1][0].state, 2, "the defenders in it are encircled");
  assert.equal(first.troops[1][2].state, 0, "the ones outside are not");
  const end = readBattlefield(days[11].battlefields[0], world);
  assert.equal(end.holderAt(22.5, 50.2), HOLDER_SIDE_A, "and it gives up in its time");
  assert.equal(end.holderAt(24.5, 50.2), HOLDER_SIDE_B);
});
