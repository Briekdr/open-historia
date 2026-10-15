/*! Open Historia — wars meant to end one way: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/warOutcomes.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { applyWarUpdates, splitWarStartNote } from "../Game/AI/nativeWarLedger.js";
import { compactWarSettings, withWarOutcome, withoutWarOutcome } from "../Game/GameUI/scenarioWarSettings.js";
import { labStaffPolicy } from "./fronts/mind/trained.js";
import { meantLoserOf, normalizeWarOutcomes } from "./warOutcomes.js";
import { normalizeWarSettings, warSettingsOf } from "./warSettings.js";

const sides = [["Germany", "Austria"], ["Poland"]];

test("the side a war is meant to lose: by the war's record first, then by the scenario's outcomes", () => {
  const war = { id: "w", sideA: ["Germany", "Austria"], sideB: ["Poland"], meantWinner: "sideA" };
  assert.equal(meantLoserOf({ war, sides }), 1);
  assert.equal(meantLoserOf({ war: { ...war, meantWinner: "sideB" }, sides }), 0);
  // A battle whose sides are listed the other way round is read by its names.
  assert.equal(meantLoserOf({ war, sides: [["Poland"], ["Germany"]] }), 0);
  // The scenario's: in any war between the two.
  assert.equal(meantLoserOf({ war: { ...war, meantWinner: undefined }, sides, outcomes: [{ winner: "Poland", loser: "Austria" }] }), 0);
  assert.equal(meantLoserOf({ sides, outcomes: [{ winner: "germany", loser: "POLAND" }] }), 1);
  // Nothing said, or said of countries not on it: neither.
  assert.equal(meantLoserOf({ war: { ...war, meantWinner: "" }, sides }), -1);
  assert.equal(meantLoserOf({ sides, outcomes: [{ winner: "France", loser: "Poland" }] }), -1);
  assert.deepEqual(normalizeWarOutcomes([{ winner: "A", loser: "B" }, { winner: "a", loser: "b" }, { winner: "C", loser: "c" }, { winner: "", loser: "D" }]), [{ winner: "A", loser: "B" }]);
});

test("a scenario keeps its outcomes with its war settings, and only where it has some", () => {
  assert.equal(normalizeWarSettings({ mechanics: {} }).outcomes, undefined);
  assert.deepEqual(normalizeWarSettings({ outcomes: [{ winner: "Germany", loser: "Poland" }] }).outcomes, [{ winner: "Germany", loser: "Poland" }]);
  assert.deepEqual(warSettingsOf({ warSettings: { outcomes: [{ winner: "Germany", loser: "Poland" }] } }).outcomes, [{ winner: "Germany", loser: "Poland" }]);
  // The Scenario Editor's form: added, taken off, and nothing at all once there is nothing.
  const one = withWarOutcome(null, "Germany", "Poland");
  assert.deepEqual(one.outcomes, [{ winner: "Germany", loser: "Poland" }]);
  assert.deepEqual(withWarOutcome(one, "Japan", "China").outcomes.map((rule) => rule.winner), ["Germany", "Japan"]);
  assert.equal(withoutWarOutcome(one, 0), null);
  assert.equal(compactWarSettings({ mechanics: {} }), null);
});

test("the story says which side it means to prevail as it opens a war: Favoured, after the war's name", () => {
  assert.deepEqual(splitWarStartNote("Title: The September Campaign; Favoured: Germany; Danzig and the corridor"), { title: "The September Campaign", favoured: "Germany", cause: "Danzig and the corridor" });
  assert.deepEqual(splitWarStartNote("Title: The Winter War; Soviet demands"), { title: "The Winter War", cause: "Soviet demands" });
  const opened = (note) => applyWarUpdates({
    world: { wars: [] },
    updates: [{ id: "war-1", op: "start", actors: ["Germany"], opponents: ["Poland"], eventIndexes: [0], note }],
    events: [{ id: "e1", date: "1939-09-01", title: "Germany invades Poland", combatants: ["Germany", "Poland"], warId: "war-1", kind: "military" }],
    stopDate: "1939-09-30",
    round: 1,
  }).wars[0];
  assert.equal(opened("Title: The September Campaign; Favoured: Poland; Danzig").meantWinner, "sideB");
  assert.equal(opened("Title: The September Campaign; Danzig").meantWinner, undefined);
  // A polity that is not in the war is no side of it.
  assert.equal(opened("Title: The September Campaign; Favoured: France; Danzig").meantWinner, undefined);
});

test("in a war meant to end one way, the side meant to lose is led by the plainer commander", () => {
  const war = { id: "war-1", sideA: ["Germany"], sideB: ["Poland"], meantWinner: "sideA" };
  const policy = labStaffPolicy({ wars: [war] });
  assert.equal(typeof policy, "function");
  assert.equal(policy.often, true);
  const battle = { warId: "war-1", sides: [["Germany"], ["Poland"]], daysRun: 1 };
  assert.deepEqual([0, 1].map((side) => policy.commanderFor(battle, side)), ["trained", "plainer"]);
  assert.deepEqual([0, 1].map((side) => policy.commanderFor({ ...battle, sides: [["Poland"], ["Germany"]] }, side)), ["plainer", "trained"]);
  // Another war's battle, and a scenario's outcome for it.
  const other = { warId: "war-2", sides: [["Japan"], ["China"]] };
  assert.deepEqual([0, 1].map((side) => policy.commanderFor(other, side)), ["trained", "trained"]);
  assert.deepEqual([0, 1].map((side) => labStaffPolicy({ outcomes: [{ winner: "China", loser: "Japan" }] }).commanderFor(other, side)), ["plainer", "trained"]);
  // Without a run either orders nothing.
  assert.deepEqual([0, 1].map((side) => policy(battle, side, {}, null)), [undefined, undefined]);
  // With nothing meant, it is the trained staff itself.
  assert.equal(labStaffPolicy({ wars: [{ ...war, meantWinner: undefined }] }), labStaffPolicy());
});
