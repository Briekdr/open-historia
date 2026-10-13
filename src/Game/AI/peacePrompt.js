/*! Open Historia — what a time skip is told of war weariness, peace and alliances © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game itself keeps how weary of war each country is, brings a defender's
// allies into its war, makes peace on terms and collects reparations
// (warAndPeace.js). The skip is told what the game has done and will do, so
// that the story tells it and does not do it a second time or the other way.
//
// It stands after the [Fronts] and [Seas] blocks in the skip's live records.
// In a world at peace with no alliance in it, it is nothing. Every name
// carries no id.
//
// Pure, and loads in plain Node.

import { describeBonds } from "../../runtime/alliances.js";
import { describeReparation, describeTerms, normalizePeaceOffers, normalizePeaceTreaties, normalizeReparations } from "../../runtime/peaceTerms.js";
import { normalizeWarWeariness, wearinessWord } from "../../runtime/warWeariness.js";
import { normalizeCallsToArms } from "../../runtime/alliances.js";

export const PEACE_BLOCK_HEADING = "[War Weariness, Peace and Alliances]";
export const PEACE_BLOCK_MAX = 2600;
export const WEARY_TOLD_FROM = 20;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

const ALLIANCE_RULE = "Alliances bind, and the game acts on them. When a war begins, the country it was begun against is joined, as the period ends and by the game itself, by those bound to defend it: the other parties of an active alliance or mutual defence agreement, the guarantor of a guarantee, and the full members of a security alliance or defence pact it belongs to. Write no join for them. An ally that will not come breaks the treaty: tell that in an event and end or suspend the agreement in the same answer, and the game takes it off the breaker's reputation. A country a person plays is asked by the game and answers for itself.";
const WEARY_RULE = "The game keeps how weary of its war each country is, from 0 (fresh) to 100 (spent): it rises with time, the men called up, ground lost and a blockade. Tell it at home, the more the higher: shortages, strikes, desertion, a government pressed to end the war. Its armies recover more slowly for it; the game does that.";
const PEACE_RULE = "A war can end on terms, and the game makes them: who keeps the ground (each side what it holds, or the old borders) and whether one side pays reparations. It makes peace between two countries nobody plays when one is spent and the other will take what it offers, and has a weary or beaten country offer a player peace, which the player answers. When an event of yours ends a war, say its terms in the event.";

// The block; "" when the world gives it nothing to say.
//   world     the world as the skip begins
//   game      the game (its round says which peaces are new)
//   players   the countries people play
export const buildPeaceBlock = ({ world = {}, game = {}, players = [], max = PEACE_BLOCK_MAX } = {}) => {
  const round = Math.max(0, Math.round(Number(game?.round) || 0));
  const wars = list(world?.wars).filter((war) => fold(war?.status || "active") === "active");
  const fighting = [...new Set(wars.flatMap((war) => [...list(war.sideA), ...list(war.sideB)]).map(clean).filter(Boolean))];
  const human = list(players).map(clean).filter(Boolean);
  const bonds = describeBonds(world, [...fighting, ...human], { most: 8 });
  // (A peace made since the last period was told: at the end of the last turn, or by a player's answer since.)
  const treaties = normalizePeaceTreaties(world?.peaceTreaties).filter((treaty) => treaty.round >= round);
  const offers = normalizePeaceOffers(world?.peaceOffers).filter((offer) => offer.status === "open");
  const calls = normalizeCallsToArms(world?.callsToArms).filter((call) => call.status === "open");
  const owed = normalizeReparations(world?.reparations);
  const weary = normalizeWarWeariness(world?.warWeariness).filter((entry) => entry.value >= WEARY_TOLD_FROM).sort((a, b) => b.value - a.value || a.country.localeCompare(b.country));
  if (wars.length === 0 && bonds.length === 0 && treaties.length === 0 && owed.length === 0 && weary.length === 0) return "";

  const lines = [PEACE_BLOCK_HEADING];
  if (bonds.length > 0 || wars.length > 0) lines.push(ALLIANCE_RULE);
  if (wars.length > 0 || weary.length > 0) lines.push(WEARY_RULE);
  if (wars.length > 0 || treaties.length > 0) lines.push(PEACE_RULE);
  const room = () => max - lines.join("\n").length;
  const section = (title, rows) => {
    if (rows.length === 0 || room() < title.length + 40) return;
    lines.push(title);
    for (const row of rows) {
      const line = `- ${row}`;
      if (line.length + 1 > room()) break;
      lines.push(line);
    }
  };
  section("Peace made by the game or a player since the last period (the war is already ended in the ledger: tell each early in this answer as an event, write no warUpdates for it, and tell no fighting in that war after it):", treaties.map((treaty) => `${treaty.title || treaty.warId}: ${treaty.from} and ${treaty.to} made peace on ${treaty.date}; ${describeTerms(treaty.terms)}.`));
  section("Offers of peace that wait for a player's answer (the answer is theirs: write none, and the war goes on meanwhile):", offers.map((offer) => `${offer.from} has offered ${offer.to} peace: ${describeTerms(offer.terms)}.`));
  section("Calls to arms that wait for a player's answer (theirs to give):", calls.map((call) => `${call.ally} is called on to defend ${call.defender} against ${call.attackers.join(" and ") || "its attacker"}${call.via.title ? `, under ${call.via.title}` : ""}.`));
  section("Reparations being paid (the game moves the money; tell what paying them does to the country):", owed.map((entry) => `${describeReparation(entry)}.`));
  section("Bound to defend:", bonds.map((line) => `${line}.`));
  section("War weariness:", weary.slice(0, 12).map((entry) => `${entry.country} ${Math.round(entry.value)}, ${wearinessWord(entry.value)}`));
  return lines.join("\n");
};
