/*! Open Historia — battlefields and fronts: a network as a side's staff (experiment): tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/mind/mind.test.js
//
// "Let's experiment with training an RNN or other type of NN to learn military
// strategy so it powers the game engine for AI countries. It should factor in
// needing to defend its own territory."

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runFronts } from "../engine.js";
import { normalizeBattlefield } from "../record.js";
import { frontInput, syntheticMap } from "../syntheticMap.js";
import { FEATURE_COUNT, FEATURE_NAMES, MIND_ACTIONS, SEEN_COUNT, countGround, groundOf, homeTableOf, staffFeatures } from "./features.js";
import { blankState, packWeights, paramCount, readWeights, step } from "./net.js";
import { MIND_OUTPUTS, MIND_SHAPE, createStaffPolicy } from "./policy.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Weights from a seed, for tests: nothing trained.
const weightsOf = (seed, spread = 0.5, shape = MIND_SHAPE) => {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
  return Float64Array.from({ length: paramCount(shape) }, () => next() * 2 * spread);
};

test("the network: its weights are counted, a step is the same step twice, and its memory changes what it says", () => {
  const shape = { inputs: 3, hidden: 2, outputs: 2 };
  assert.equal(paramCount(shape), 2 * 2 * (3 + 2 + 1) + 2 * (2 + 3 + 1));
  assert.equal(paramCount(MIND_SHAPE), 2 * MIND_SHAPE.hidden * (FEATURE_COUNT + MIND_SHAPE.hidden + 1) + MIND_OUTPUTS * (MIND_SHAPE.hidden + FEATURE_COUNT + 1));
  const params = weightsOf(3, 0.8, shape);
  const x = Float64Array.from([1, 0.5, -0.25]);
  const first = step(shape, params, blankState(shape), x);
  assert.deepEqual(step(shape, params, blankState(shape), x), first);
  assert.equal(first.state.length, 2);
  assert.equal(first.out.length, 2);
  for (const value of first.state) assert.ok(value >= -1 && value <= 1, "a memory stays within bounds");
  // The same thing seen a second time, with a memory of the first, is not answered the same.
  const second = step(shape, params, first.state, x);
  assert.notDeepEqual(Array.from(second.out), Array.from(first.out));
  // All zeros: nothing remembered, nothing said.
  const nothing = step(shape, new Float64Array(paramCount(shape)), blankState(shape), x);
  assert.deepEqual([Array.from(nothing.state), Array.from(nothing.out)], [[0, 0], [0, 0]]);
});

test("weights are kept rounded, and a file this build cannot read is no weights", () => {
  const params = weightsOf(9);
  const packed = packWeights(MIND_SHAPE, params, { prior: 1.5, gen: 12 });
  assert.deepEqual([packed.shape, packed.prior, packed.gen, packed.params.length], [{ ...MIND_SHAPE }, 1.5, 12, paramCount(MIND_SHAPE)]);
  const read = readWeights(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual([read.shape, read.prior, read.drafts], [{ ...MIND_SHAPE }, 1.5, false]);
  for (let at = 0; at < params.length; at += 1) assert.ok(Math.abs(read.params[at] - params[at]) <= 5e-6);
  assert.equal(readWeights({ ...packed, drafts: true }).drafts, true);
  assert.equal(readWeights({ ...packed, params: packed.params.slice(1) }), null, "the wrong number of weights");
  assert.equal(readWeights({ ...packed, params: packed.params.map((value, at) => (at === 3 ? "x" : value)) }), null);
  assert.equal(readWeights({ shape: { inputs: 0, hidden: 2, outputs: 2 }, params: [] }), null);
  assert.equal(readWeights(null), null);
});

// An even sheet: Aland in the west and Borduria in the east, at war.
const legend = { A: "Aland", B: "Borduria", "~": null };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "mind" });
const war = (world, extra = {}) => frontInput(world, { arenas: new Map(), staff: true, troops: 1, days: 30, strengthOf: () => 4, ...extra });

test("what a staff is shown: numbers in range, its own home ground by whose it lawfully is, and what the scripted staff would do", () => {
  const world = sheet();
  const seen = [];
  runFronts(war(world, {
    staffPolicy: (battle, side, context, run) => {
      const look = staffFeatures(battle, side, context, run, null);
      seen.push({ side, look, ground: groundOf(battle, side, run), homes: homeTableOf(battle, run), holders: battle.field.holders });
      return undefined;
    },
  }));
  assert.ok(seen.length >= 2, "both sides were asked");
  assert.equal(FEATURE_NAMES.length, FEATURE_COUNT);
  for (const { look, side } of seen) {
    assert.equal(look.x.length, FEATURE_COUNT);
    look.x.forEach((value, at) => assert.ok(Number.isFinite(value) && value >= -1 && value <= 1, `${FEATURE_NAMES[at]} = ${value}`));
    assert.equal(look.x[0], 1);
    assert.ok(look.staff >= 0 && look.staff < MIND_ACTIONS.length);
    assert.equal(look.x.slice(24).reduce((sum, value) => sum + value, 0), 1, "one word of the scripted staff's is marked");
    assert.equal(look.seen.length, SEEN_COUNT);
    assert.ok(side === 0 || side === 1);
  }
  // On the first day nobody has lost anything, and each side's home is half the sheet's land.
  const [first] = seen;
  assert.deepEqual(first.ground, { lost: 0, taken: 0 });
  const homeCells = [0, 1].map((side) => first.homes.filter((home) => home === side).length);
  assert.ok(homeCells[0] > 0 && Math.abs(homeCells[0] - homeCells[1]) <= homeCells[0] * 0.05, String(homeCells));
  // Counted by hand: a strip of the first side's home held by the other is ground lost to it, and taken by the other.
  const holders = Uint8Array.from(first.holders);
  let moved = 0;
  for (let cell = 0; cell < holders.length && moved < 50; cell += 1) {
    if (first.homes[cell] === 0 && holders[cell] === 0) {
      holders[cell] = 1;
      moved += 1;
    }
  }
  assert.equal(countGround(holders, first.homes, 0).lost, 50 / homeCells[0]);
  assert.equal(countGround(holders, first.homes, 1).taken, 50 / homeCells[0]);
  assert.deepEqual(countGround(null, first.homes, 0), { lost: 0, taken: 0 });
});

test("a run handed a staff of its own asks it for every side nobody plays, and one that says nothing leaves the engine's staff in place", () => {
  const plain = runFronts(war(sheet()));
  // Asked, and answering nothing: the run is the run it was.
  let asked = 0;
  const silent = runFronts(war(sheet(), { staffPolicy: () => { asked += 1; return undefined; } }));
  assert.ok(asked >= 2);
  assert.deepEqual(silent.battlefields, plain.battlefields);
  assert.deepEqual(silent.flips, plain.flips);
  // A side a person plays is that person's: nobody is asked for it.
  const sides = new Set();
  runFronts(war(sheet(), { players: ["Aland"], staffPolicy: (battle, side) => { sides.add(battle.sides[side][0]); return undefined; } }));
  assert.deepEqual([...sides], ["Borduria"]);
  // What it says is what the side stands under, as the staff's own order.
  const told = runFronts(war(sheet(), { staffPolicy: (battle, side) => (battle.sides[side][0] === "Borduria" ? { order: "dig in", sector: "all" } : { order: "advance", sector: "all" }) }));
  const [record] = told.battlefields;
  const standing = record.orders.filter((order) => !order.chosen).map((order) => [record.sides[order.s][0], order.order, order.sector, order.mark]);
  assert.deepEqual(standing.sort(), [["Aland", "advance", "all", "staff"], ["Borduria", "dig in", "all", "staff"]]);
  // With every side left to its orders (the engine's own tests of other things), nobody is asked.
  let quiet = 0;
  runFronts(war(sheet(), { staff: false, staffPolicy: () => { quiet += 1; return undefined; } }));
  assert.equal(quiet, 0);
});

test("a network is a staff: it decides the same twice, says one of four things, and remembers from one month to the next", () => {
  const policy = () => createStaffPolicy({ shape: MIND_SHAPE, params: weightsOf(21, 0.6) });
  const said = [];
  const spy = (inner) => (battle, side, context, run) => {
    const decided = inner(battle, side, context, run);
    said.push(decided);
    return decided;
  };
  const world = sheet();
  const first = runFronts(war(world, { staffPolicy: spy(policy()) }));
  assert.ok(said.length >= 2);
  for (const decided of said) {
    assert.ok(["advance", "hold", "dig in"].includes(decided.order), decided.order);
    assert.ok(decided.action >= 0 && decided.action < MIND_ACTIONS.length);
    assert.equal(decided.draft, false, "it calls nobody up unless its weights were trained to");
    if (decided.order !== "advance") assert.equal(decided.sector, "all");
  }
  // The same war with the same weights is the same war.
  assert.deepEqual(runFronts(war(sheet(), { staffPolicy: policy() })).battlefields, first.battlefields);
  // Its memory is kept with the battlefield: a list a side, the network's own and what it saw last.
  const [record] = first.battlefields;
  assert.deepEqual(record.mind.map((list) => list.length), [MIND_SHAPE.hidden + SEEN_COUNT, MIND_SHAPE.hidden + SEEN_COUNT]);
  const kept = normalizeBattlefield(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(kept.mind, record.mind, "and survives a save");
  // The next month begins from it: a network that had forgotten would not decide the same.
  const month = (battlefields) => {
    const later = sheet();
    for (const flip of first.flips) if (flip.kind === "control") later.controller.set(flip.regionId, flip.to);
    return runFronts(war(later, { battlefields, fromDate: record.asOf, staffPolicy: policy() })).battlefields[0];
  };
  const remembered = month([record]);
  const forgotten = month([{ ...record, mind: undefined }]);
  assert.notDeepEqual(remembered.mind, forgotten.mind);
  // A battlefield no network was ever asked about keeps nothing of the kind.
  assert.equal(Object.hasOwn(runFronts(war(sheet())).battlefields[0], "mind"), false);
  assert.equal(Object.hasOwn(normalizeBattlefield(JSON.parse(JSON.stringify(runFronts(war(sheet())).battlefields[0]))), "mind"), false);
});

test("with the scripted staff's own word weighed in, a network that knows nothing decides as the scripted staff does", () => {
  const plain = runFronts(war(sheet()));
  const nothing = createStaffPolicy({ shape: MIND_SHAPE, params: new Float64Array(paramCount(MIND_SHAPE)), prior: 1.5 });
  const led = runFronts(war(sheet(), { staffPolicy: nothing }));
  const orders = (result) => result.battlefields[0].orders.map(({ s, order, sector, mark }) => [s, order, sector, mark]);
  assert.deepEqual(orders(led), orders(plain));
  assert.deepEqual(led.flips, plain.flips);
  // Weights of the wrong shape are no staff at all: the engine's own decides.
  const wrong = createStaffPolicy({ shape: { inputs: 3, hidden: 2, outputs: 2 }, params: new Float64Array(30) });
  assert.deepEqual(runFronts(war(sheet(), { staffPolicy: wrong })).battlefields, plain.battlefields);
});

test("a network whose weights were trained to may call up fresh formations, and one refused says nothing of it", () => {
  // Weights that always say "draft": the second of the two last outputs has the larger bias.
  const params = new Float64Array(paramCount(MIND_SHAPE));
  params[params.length - 1] = 1;
  const people = { peopleOf: () => 4e6 };
  const count = (result, side) => result.battlefields[0].troops[side].length;
  const plain = runFronts(war(sheet(), people));
  const drafting = runFronts(war(sheet(), { ...people, staffPolicy: createStaffPolicy({ shape: MIND_SHAPE, params, prior: 1.5, drafts: true }) }));
  const quiet = runFronts(war(sheet(), { ...people, staffPolicy: createStaffPolicy({ shape: MIND_SHAPE, params, prior: 1.5 }) }));
  assert.ok(count(drafting, 0) > count(plain, 0) && count(drafting, 1) > count(plain, 1), "both sides were brought more troops");
  assert.equal(count(quiet, 0), count(plain, 0), "not without leave");
  const charged = (result) => result.manpower.reduce((sum, entry) => sum + entry.drawn, 0);
  assert.ok(charged(drafting) > charged(plain), "and their countries were charged the men");
  assert.deepEqual(drafting.notes.filter((note) => String(note.kind).startsWith("reinforce")), [], "a draft it could not have is not a note on the turn");
});

test("the game uses a trained staff only in the lab, only when its switch is on, and only when one is shipped", async () => {
  const root = path.join(here, "../../..");
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").split("\r\n").join("\n");
  const gate = read("Game/AI/frontsGate.js");
  assert.ok(gate.includes("export const STRATEGY_NET_KEY = \"oh:strategyNet\";"));
  assert.ok(gate.includes("return globalThis.localStorage?.getItem(STRATEGY_NET_KEY) === \"1\";"), "off unless whoever is at the keyboard turns it on");
  // The turn hands it to the engine for the forecast and for the apply alike, so the two are one run.
  const apply = read("Game/AI/frontApply.js");
  assert.ok(apply.includes("...(strategyNetOn() && trainedStaffPolicy() ? { staffPolicy: trainedStaffPolicy() } : {}),"));
  assert.equal(apply.split("...turnRunInput({").length - 1, 2, "the run before the story and the run that applies it");
  const turn = read("Game/AI/frontTurn.js");
  assert.ok(turn.includes("...(typeof staffPolicy === \"function\" ? { staffPolicy } : {}),"));
  // No scenario and no setting can ask for it.
  assert.equal(read("../server/gameFeatures.js").includes("strategyNet"), false);
  // What is shipped is read through the same door a file of weights is: none, or a staff.
  const { trainedStaffInfo, trainedStaffPolicy } = await import("./trained.js");
  const { TRAINED_STAFF } = await import("./weights.js");
  if (TRAINED_STAFF === null) {
    assert.equal(trainedStaffPolicy(), null);
    assert.equal(trainedStaffInfo(), null);
  } else {
    assert.equal(typeof trainedStaffPolicy(), "function");
    assert.deepEqual(TRAINED_STAFF.shape, { ...MIND_SHAPE }, "trained for the network this build has");
    assert.equal(TRAINED_STAFF.drafts, false, "a staff that calls up troops by itself is not shipped: the scripted staff never does");
    assert.equal(trainedStaffInfo().run, TRAINED_STAFF.run);
    // And it leads a war without a hitch.
    const led = runFronts(war(sheet(), { staffPolicy: trainedStaffPolicy() }));
    assert.equal(led.battlefields.length, 1);
    assert.deepEqual(led.battlefields[0].mind.map((list) => list.length), [MIND_SHAPE.hidden + SEEN_COUNT, MIND_SHAPE.hidden + SEEN_COUNT]);
  }
});

test("the network decides with the engine's own arithmetic: nothing that differs between machines", () => {
  const forbidden = ["Math.random", "Math.sin", "Math.cos", "Math.tan", "Math.atan", "Math.exp", "Math.pow", "Math.log", "Math.hypot", "Math.tanh", "**", "Date.now", "new Date", "performance.now"];
  for (const name of ["net.js", "features.js", "policy.js"]) {
    const source = fs.readFileSync(path.join(here, name), "utf8").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    for (const word of forbidden) assert.equal(source.includes(word), false, `${word} in mind/${name}`);
  }
});
