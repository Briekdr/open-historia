/*! Open Historia — what a time skip is told of its battlefields © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A game that fights its land wars on battlefields (runtime/fronts/) asks its
// time skip for orders, not for moves: which side is to advance where, what is
// stormed, what is held. The skip's own template was written before any of
// that and is frozen in every campaign, so this block is added to the live
// records when the skip is asked (gameplay.js buildJumpLiveState):
//
//   the rules      how a line of frontOrders is written (nativeFrontLedger.js
//                  reads it), and the sentence that sets aside what the template
//                  says of moving formations and taking regions there;
//   the players    whose troops take orders only from the person playing them;
//   the list       every open battlefield as its brief words it (brief.js):
//                  sides, strengths, where each sector of the line lies in named
//                  places, what moved last turn, pockets, standing orders and
//                  the sector words that fit it.
//
// It is held to FRONTS_BLOCK_MAX characters whatever the world holds: the
// battlefields the turn is most likely to be about are told in full, the rest
// in a line each, and what still does not fit is counted. Every name carries
// its kind where it could be two things, and nothing in it is an id.
//
// Pure, and loads in plain Node.

import { describeBattlefield } from "../../runtime/fronts/brief.js";
import { normalizeBattlefields } from "../../runtime/fronts/record.js";
import { FRONT_ORDERS_FIELD } from "./nativeFrontLedger.js";

export const FRONTS_BLOCK_MAX = 6000;
export const FRONTS_BLOCK_HEADING = "[Fronts]";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

const FRONT_RULES = [
  FRONTS_BLOCK_HEADING,
  "Land war is fought on battlefields: one opens by itself wherever the two sides of a war hold land that touches, and there the game raises the troops, moves them and decides who holds the ground. You give the orders and tell the story. On the battlefields below this replaces what the instructions above say of moving formations and taking regions: write no unitOps for their sides' land forces and no regionControlOps for their regions. Fleets, air wings, garrisons, bases and land forces away from every battlefield move as before.",
  `Orders go in ${FRONT_ORDERS_FIELD}, one line each:`,
  "battlefield~side~order~sector~eventNumbers~objective~result~effort",
  "- battlefield: a name from the list below. A war begun in this answer has none yet: name its battlefield yourself in its first order. A border with no war is `border: A / B`, the two countries by their exact names, with dig in or hold: troops are sent to fortify it and attack nothing.",
  "- side: the country or group being ordered, by its exact name.",
  "- order: advance | blitz | spearhead | flank | encircle | assault | hold | dig in | fall back | land. An assault sends the troops it takes straight at its objective, which it must have: `city: X`, `structure: X` or `unit: X`. A landing's objective says where.",
  "- sector: all, a sector word listed for that battlefield, or a place on its line.",
  "- eventNumbers: the events of this answer that tell of it, counted from 1, with commas between; blank means from the first day.",
  "- objective (a place with its kind: `city: Kharkiv`), result (breakthrough | captured | repulsed | stalemate | collapse | surrender: what the story itself decides, on that event's date) and effort (token | limited | major | total) may be left off.",
  "Eastern Ukraine~Russia~spearhead~north~2,3~city: Kharkiv~~major",
  "Eastern Ukraine~Russia~~south~5~city: Mariupol~captured",
  "An order stands until another replaces it: write a line only for what changes, and an empty string when nothing does. How far an advance gets is worked out by the game and told to you here next period, so an event says a named place fell only when a line gives it as the objective with the result captured.",
].join("\n");

// The countries and groups people play: their troops are theirs to order.
const playerRule = (players) => {
  const names = asArray(players).map(clean).filter(Boolean);
  if (names.length === 0) return "";
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${who} ${names.length === 1 ? "is" : "are each"} played by a person: write no order for ${names.length === 1 ? "it" : "them"} of your own. `
    + "Where an event carries out one of that player's own orders, give that order here, resting on that event. "
    + "What came of a battle they are in may always be stated as a result, with the order field left empty.";
};

const isOpen = (record) => record?.status !== "closed";

// A battlefield there is no room to tell in full, in a line: its sides and the
// sector words that fit it, which is enough to order it by. And in the least
// there is: its name and who leads each side.
const shortLine = (record) => {
  const sectors = asArray(record?.brief?.sectors).map((sector) => clean(sector?.name)).filter(Boolean);
  const km = Number(record?.brief?.km);
  return `- ${record.name}: ${record.sides[0].join(", ")} against ${record.sides[1].join(", ")}`
    + `${Number.isFinite(km) && km > 0 ? `, line ${Math.round(km)} km` : ""}. `
    + `Sectors: ${sectors.length ? sectors.join(", ") : "all"}, or a place on the line.`;
};
const withAllies = (members) => (members.length > 1 ? `${members[0]} and ${members.length - 1} ${members.length === 2 ? "ally" : "allies"}` : members[0]);
const leastLine = (record) => `- ${record.name}: ${withAllies(record.sides[0])} against ${withAllies(record.sides[1])}.`;

// The battlefields a turn is most likely to be about come first: one a person
// fights on, then one being fought over before one that is frozen or only
// fortified, then the longer line.
const byWeight = (records, players) => {
  const human = new Set(asArray(players).map(fold).filter(Boolean));
  const playerIn = (record) => record.sides.some((members) => members.some((member) => human.has(fold(member))));
  return records
    .map((record, index) => ({
      record,
      index,
      player: playerIn(record) ? 0 : 1,
      fought: record.status === "active" ? 0 : 1,
      km: Number(record?.brief?.km) || 0,
    }))
    .sort((a, b) => a.player - b.player || a.fought - b.fought || b.km - a.km || a.index - b.index)
    .map((entry) => entry.record);
};

// The block for a world's battlefields, never longer than `max`.
//   battlefields   world.battlefields
//   players        the countries and groups people play, by name
export const buildFrontsBlock = ({ battlefields = [], players = [], max = FRONTS_BLOCK_MAX } = {}) => {
  const rule = playerRule(players);
  const head = [FRONT_RULES, rule].filter(Boolean).join("\n");
  const open = byWeight(normalizeBattlefields(battlefields).filter(isOpen), players);
  if (open.length === 0) {
    return `${head}\nNo battlefield is open now.`.slice(0, max);
  }

  const title = "Battlefields open now:";
  let room = max - head.length - title.length - 2;
  // Every battlefield that fits is named, in the least it can be; what does
  // not fit even so is counted. Then, in the same order, as many as there is
  // room for are told in full, and the room that leaves gives the others the
  // fuller line.
  const more = (count) => `(${count} more ${count === 1 ? "battlefield is" : "battlefields are"} open and not listed.)`;
  const lines = [];
  for (let index = 0; index < open.length; index += 1) {
    const line = leastLine(open[index]);
    const left = open.length - index - 1;
    const reserve = left > 0 ? more(left).length + 1 : 0;
    if (line.length + 1 + reserve > room) break;
    lines.push(line);
    room -= line.length + 1;
  }
  const unlisted = open.length - lines.length;
  if (unlisted > 0) room -= more(unlisted).length + 1;
  const told = lines.map(() => false);
  for (const wording of [describeBattlefield, shortLine]) {
    for (let index = 0; index < lines.length; index += 1) {
      if (told[index]) continue;
      const text = wording(open[index]);
      if (!text || text.length - lines[index].length > room) continue;
      room -= text.length - lines[index].length;
      lines[index] = text;
      told[index] = true;
    }
  }
  const block = [head, title, ...lines, ...(unlisted > 0 ? [more(unlisted)] : [])].join("\n");
  return block.length > max ? block.slice(0, max) : block;
};

// Who the engine is fielding in a war: the members of the sides of every
// battlefield a war is being fought on, or is frozen on by a ceasefire. A
// border that is only fortified, with no war on it, shows nobody's war.
export const battlefieldPowers = (battlefields) => {
  const names = [];
  const seen = new Set();
  for (const record of normalizeBattlefields(battlefields)) {
    if (record.status !== "active" && record.status !== "frozen") continue;
    for (const member of record.sides.flat()) {
      if (seen.has(fold(member))) continue;
      seen.add(fold(member));
      names.push(member);
    }
  }
  return names;
};
