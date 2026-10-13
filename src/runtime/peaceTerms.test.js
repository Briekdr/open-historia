/*! Open Historia — peace: offers, terms and reparations: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/peaceTerms.test.js
//
// "A peace offer the player accepts or declines, with war weariness." "Also
// have war weariness, wars that end with terms and reparations."

import test from "node:test";
import assert from "node:assert/strict";

import {
  PEACE_COOLDOWN_ROUNDS,
  PEACE_OFFER_GROUND_LOST,
  PEACE_OFFER_STANDS_ROUNDS,
  PEACE_OFFER_WEARINESS,
  PEACE_SETTLE_WEARINESS,
  REPARATIONS_SHARE_MOST,
  REPARATIONS_YEARS_LEAST,
  REPARATIONS_YEARS_MOST,
  TERRITORY_AS_HELD,
  TERRITORY_RESTORED,
  describeReparation,
  describeTerms,
  normalizePeaceOffers,
  normalizeReparations,
  normalizeTerms,
  openOffersFor,
  reparationsDue,
  reparationsOf,
  settledBetweenOthers,
  standingOf,
  termsOffered,
  termsWorth,
  withTurnPeaceOffers,
  wouldAccept,
} from "./peaceTerms.js";

const near = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} against ${expected}`);
const WAR = { id: "war-1", status: "active", sideA: ["Aland"], sideB: ["Borduria", "Cisland"] };

test("how a war stands for a country is what it holds of the enemy's less what the enemy holds of its own", () => {
  assert.equal(standingOf({ lost: 0, taken: 0 }), 0);
  assert.equal(standingOf({ lost: 0.4, taken: 0.1 }), 0.1 - 0.4);
  assert.equal(standingOf({ lost: 1, taken: 0 }), -1);
  assert.equal(standingOf({ lost: 0, taken: 9 }), 1);
  assert.equal(standingOf(), 0);
});

test("what a country offers goes by how it stands: the old borders when even, what it holds when ahead, land and money when beaten", () => {
  const offer = (standing, weariness = 60) => termsOffered({ offerer: "Borduria", receiver: "Aland", standing, weariness });
  assert.deepEqual(offer(0), { territory: TERRITORY_RESTORED, reparations: null }, "a white peace");
  assert.deepEqual(offer(0.05), { territory: TERRITORY_RESTORED, reparations: null });
  assert.deepEqual(offer(0.4), { territory: TERRITORY_AS_HELD, reparations: null }, "winning and weary: it keeps what it holds and asks nothing more");
  // Beaten: it cedes what it lost and pays, the more and the longer the worse it stands.
  const bad = offer(-0.3);
  const worse = offer(-0.9, 95);
  assert.equal(bad.territory, TERRITORY_AS_HELD);
  assert.deepEqual([bad.reparations.payer, bad.reparations.receiver], ["Borduria", "Aland"]);
  assert.ok(worse.reparations.share > bad.reparations.share && worse.reparations.years > bad.reparations.years);
  assert.ok(worse.reparations.share <= REPARATIONS_SHARE_MOST && worse.reparations.years <= REPARATIONS_YEARS_MOST);
  assert.ok(bad.reparations.years >= REPARATIONS_YEARS_LEAST);
  // Losing only a little, and fresh: it cedes the ground, and the sum is too small to write down.
  assert.deepEqual(termsOffered({ offerer: "Borduria", receiver: "Aland", standing: -0.1, weariness: 0 }), { territory: TERRITORY_AS_HELD, reparations: null });
  // Terms nobody can read are a white peace with nobody paying.
  assert.deepEqual(normalizeTerms({ territory: "everything", reparations: { payer: "A", receiver: "A", share: 0.02, years: 5 } }), { territory: TERRITORY_RESTORED, reparations: null });
  assert.deepEqual(normalizeTerms(null), { territory: TERRITORY_RESTORED, reparations: null });
});

test("terms are told in a line", () => {
  assert.equal(describeTerms({ territory: TERRITORY_RESTORED }), "every region goes back to whose it was before the war; nobody pays reparations");
  assert.equal(describeTerms({ territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.025, years: 6 } }), "each side keeps the ground it holds; Borduria pays Aland reparations of 2.5% of its economy a year for 6 years");
  assert.ok(describeTerms({ territory: TERRITORY_AS_HELD, reparations: { payer: "B", receiver: "A", share: 0.01, years: 1 } }).endsWith("for 1 year"));
});

test("a country nobody plays takes terms no worse than the war promises it, and the wearier it is the worse it takes", () => {
  const cede = { territory: TERRITORY_AS_HELD, reparations: null };
  const white = { territory: TERRITORY_RESTORED, reparations: null };
  // Winning and fresh: it will not hand back what it has taken, nor stop at it. It expects more.
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: 0.5, weariness: 0 }), false);
  assert.equal(wouldAccept({ terms: cede, country: "Borduria", standing: 0.5, weariness: 0 }), false);
  // Half-weary, it expects the war to end as it stands, and keeping what it holds will do.
  assert.equal(wouldAccept({ terms: cede, country: "Borduria", standing: 0.5, weariness: 50 }), true);
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: 0.5, weariness: 90 }), false, "however worn, it does not hand back half a country");
  // Only a little ahead and worn out: the old borders will do.
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: 0.1, weariness: 90 }), true);
  // Level and fresh, it does not want peace at all yet; level and weary, it does.
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: 0, weariness: 0 }), false);
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: 0, weariness: 50 }), true);
  // Losing: a white peace is a gift, and ceding what it lost is what the war promises anyway.
  assert.equal(wouldAccept({ terms: white, country: "Borduria", standing: -0.4, weariness: 20 }), true);
  assert.equal(wouldAccept({ terms: cede, country: "Borduria", standing: -0.4, weariness: 20 }), false, "fresh, it fights on rather than sign the ground away");
  assert.equal(wouldAccept({ terms: cede, country: "Borduria", standing: -0.4, weariness: 70 }), true, "spent, it signs");
  // Money counts: being paid makes terms better, paying makes them worse.
  const paid = { territory: TERRITORY_RESTORED, reparations: { payer: "Aland", receiver: "Borduria", share: 0.04, years: 12 } };
  assert.ok(termsWorth(paid, "Borduria", 0) > 0 && termsWorth(paid, "Aland", 0) < 0);
  assert.equal(termsWorth(paid, "Cisland", 0), 0, "nothing to a country it is not about");
  assert.equal(wouldAccept({ terms: paid, country: "Aland", standing: 0, weariness: 0 }), false);
  assert.equal(wouldAccept({ terms: paid, country: "Aland", standing: -0.6, weariness: 80 }), true);
});

const stand = (table) => (warId, name) => table[name] ?? { lost: 0, taken: 0 };
const weary = (table) => (name) => table[name] ?? 0;

test("a country nobody plays offers a person peace once it is weary enough or is losing its own ground", () => {
  const turn = (offers, extra = {}) => withTurnPeaceOffers(offers, { wars: [WAR], players: ["Aland"], wearinessOf: weary({ Borduria: PEACE_OFFER_WEARINESS }), groundOf: stand({}), round: 7, date: "1915-03-01", ...extra });
  const [offer] = turn([]);
  assert.deepEqual(offer, { id: "peace:war-1:borduria:7", warId: "war-1", from: "Borduria", to: "Aland", terms: { territory: TERRITORY_RESTORED, reparations: null }, date: "1915-03-01", round: 7, status: "open" });
  // Fresh and holding its own: nothing.
  assert.deepEqual(turn([], { wearinessOf: weary({ Borduria: PEACE_OFFER_WEARINESS - 1 }) }), []);
  // Fresh, but the player holds a third of its country: it offers, ceding the ground.
  const losing = turn([], { wearinessOf: weary({}), groundOf: stand({ Borduria: { lost: PEACE_OFFER_GROUND_LOST + 0.1, taken: 0 } }) });
  assert.deepEqual([losing.length, losing[0].terms.territory], [1, TERRITORY_AS_HELD]);
  assert.ok(losing[0].terms.reparations.share > 0);
  // Losing ground while taking as much is no reason to sue.
  assert.deepEqual(turn([], { wearinessOf: weary({}), groundOf: stand({ Borduria: { lost: 0.4, taken: 0.4 } }) }), []);
  // One offer at a time: while it stands, no second.
  assert.equal(turn([offer], { round: 8 }).length, 1);
  // The player is the one who is asked: nobody offers on the player's behalf, and a war between people is theirs to end.
  assert.deepEqual(turn([], { players: ["Borduria"], wearinessOf: weary({ Aland: 99 }) }).map((entry) => [entry.from, entry.to]), [["Aland", "Borduria"]]);
  assert.deepEqual(turn([], { players: ["Aland", "Borduria"] }), []);
  assert.deepEqual(turn([], { players: [] }), [], "(a war nobody plays in is settled between its sides: settledBetweenOthers)");
  assert.deepEqual(openOffersFor([offer], "aland").length, 1);
  assert.deepEqual(openOffersFor([offer], "Borduria"), []);
});

test("an offer declined is not made again for a few turns; one left unanswered lapses, and so does one whose war is over", () => {
  const base = { wars: [WAR], players: ["Aland"], wearinessOf: weary({ Borduria: 80 }), groundOf: stand({}), date: "1915-03-01" };
  const declined = [{ id: "peace:war-1:borduria:7", warId: "war-1", from: "Borduria", to: "Aland", terms: {}, round: 7, status: "declined", answeredRound: 8 }];
  assert.equal(withTurnPeaceOffers(declined, { ...base, round: 8 + PEACE_COOLDOWN_ROUNDS - 1 }).filter((offer) => offer.status === "open").length, 0);
  const again = withTurnPeaceOffers(declined, { ...base, round: 8 + PEACE_COOLDOWN_ROUNDS });
  assert.deepEqual(again.map((offer) => offer.status), ["declined", "open"]);
  const open = [{ id: "peace:war-1:borduria:7", warId: "war-1", from: "Borduria", to: "Aland", terms: {}, round: 7, status: "open" }];
  assert.equal(withTurnPeaceOffers(open, { ...base, round: 7 + PEACE_OFFER_STANDS_ROUNDS - 1 })[0].status, "open");
  // Unanswered too long: it lapses (and, weary as ever, its maker offers afresh).
  assert.deepEqual(withTurnPeaceOffers(open, { ...base, round: 7 + PEACE_OFFER_STANDS_ROUNDS }).map((offer) => offer.status), ["lapsed", "open"]);
  assert.deepEqual(withTurnPeaceOffers(open, { ...base, wars: [{ ...WAR, status: "ended" }], round: 8 }).map((offer) => offer.status), ["lapsed"]);
  // What the world keeps is checked: an offer with nobody in it is none.
  assert.deepEqual(normalizePeaceOffers([{ id: "x", warId: "w", from: "A", to: "A" }, { id: "", warId: "w", from: "A", to: "B" }, null]), []);
});

test("two countries nobody plays make peace between themselves when one is spent and the other will take what it offers", () => {
  const settle = (extra) => settledBetweenOthers({ wars: [WAR], players: [], wearinessOf: weary({}), groundOf: stand({}), ...extra });
  assert.deepEqual(settle({}), [], "both fresh and level: they fight on");
  // Borduria is nearly spent and offers the old borders; Aland, level and weary itself, takes them.
  assert.deepEqual(settle({ wearinessOf: weary({ Borduria: PEACE_SETTLE_WEARINESS - 1, Aland: 55 }) }), [], "not spent enough to sue");
  assert.deepEqual(settle({ wearinessOf: weary({ Borduria: 85, Aland: 20 }) }), [], "a fresh enemy would rather fight on");
  const white = settle({ wearinessOf: weary({ Borduria: 85, Aland: 55 }) });
  assert.deepEqual(white, [{ warId: "war-1", from: "Borduria", to: "Aland", terms: { territory: TERRITORY_RESTORED, reparations: null } }]);
  // Aland holds a third of Borduria: Borduria offers the ground and money. A fresh Aland wants more than that
  // and fights on; half-weary, it takes it.
  const beatenGround = stand({ Borduria: { lost: 0.35, taken: 0 }, Aland: { lost: 0, taken: 0.35 } });
  assert.deepEqual(settle({ groundOf: beatenGround }), []);
  const beaten = settle({ groundOf: beatenGround, wearinessOf: weary({ Aland: 50 }) });
  assert.deepEqual([beaten[0].from, beaten[0].to, beaten[0].terms.territory, beaten[0].terms.reparations.payer], ["Borduria", "Aland", TERRITORY_AS_HELD, "Borduria"]);
  // Whichever side is the one beaten is the one that sues.
  assert.deepEqual(settle({ wearinessOf: weary({ Borduria: 50 }), groundOf: stand({ Aland: { lost: 0.3, taken: 0 }, Borduria: { lost: 0, taken: 0.3 } }) }).map((entry) => entry.from), ["Aland"]);
  // A war a person is in is never settled for them.
  assert.deepEqual(settle({ players: ["Cisland"], wearinessOf: weary({ Borduria: 99, Aland: 99 }) }), []);
  assert.deepEqual(settle({ wars: [{ ...WAR, status: "ceasefire" }], wearinessOf: weary({ Borduria: 99 }) }), []);
});

test("reparations are paid a period at a time out of the payer's economy, until they have run their years", () => {
  const terms = { territory: TERRITORY_AS_HELD, reparations: { payer: "Borduria", receiver: "Aland", share: 0.02, years: 2 } };
  const begun = reparationsOf(terms, { warId: "war-1", date: "1916-01-01" });
  assert.deepEqual(begun, [{ id: "reparations:war-1:borduria:1916-01-01", warId: "war-1", payer: "Borduria", receiver: "Aland", share: 0.02, since: "1916-01-01", days: 730, paidDays: 0 }]);
  assert.deepEqual(reparationsOf({ territory: TERRITORY_RESTORED }), []);
  const gdpOf = (name) => (name === "Borduria" ? 1e11 : 0);
  const year = reparationsDue(begun, { days: 365, gdpOf });
  near(year.payments[0].amount, 2e9, "2% of its economy in a year");
  near(year.payments[0].share, 0.02);
  assert.deepEqual([year.payments[0].payer, year.payments[0].receiver, year.reparations[0].paidDays], ["Borduria", "Aland", 365]);
  // A month of it.
  near(reparationsDue(begun, { days: 30, gdpOf }).payments[0].amount, (1e11 * 0.02 * 30) / 365);
  // The last stretch pays only the days that are left, and then they are done.
  const last = reparationsDue(year.reparations, { days: 900, gdpOf });
  near(last.payments[0].share, 0.02);
  assert.deepEqual(last.reparations, []);
  assert.deepEqual(reparationsDue([], { days: 365, gdpOf }), { reparations: [], payments: [] });
  // A payer with no economy on its sheet pays in the story only: the days still count.
  const silent = reparationsDue(begun, { days: 100, gdpOf: () => 0 });
  assert.deepEqual([silent.payments, silent.reparations[0].paidDays], [[], 100]);
  assert.equal(describeReparation(begun[0]), "Borduria pays Aland 2% of its economy a year in reparations, for 2 more years");
  assert.equal(describeReparation(last.reparations[0]), "");
  assert.ok(describeReparation({ ...begun[0], paidDays: 700 }).endsWith("for 1 more month"));
  assert.deepEqual(normalizeReparations([{ ...begun[0], paidDays: 730 }, { id: "x", payer: "A", receiver: "A", share: 1, days: 9 }, null]), [], "paid off, or owed to oneself: not kept");
});
