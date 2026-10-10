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
//                  places, what moved, pockets, standing orders and the sector
//                  words that fit it.
//
// THE PERIOD IS FOUGHT FIRST. Before the skip is asked for anything the engine
// is run over the days it covers, under the orders that already stand
// (frontApply.js forecastTurnFronts), and the block is given what came of it
// as `period`: the battlefields as the period LEAVES them, and what happened
// on which date. The story is then written knowing how the war went, and its
// events tell it; the orders it writes are for the period after. What a
// battlefield went through BEFORE the period that was never told that way (the
// first days of a war that began in the last answer, or a game saved before
// any of this) is told with it, once: the record says whether its last run was
// told (brief.told, frontTurn.js). A turn with
// nothing to fight beforehand (no battlefield being fought, a calendar the
// game cannot count days on) is told the battlefields as they stand, with the
// rules as they were before any of that: the engine then runs after it.
//
// It is held to FRONTS_BLOCK_MAX characters whatever the world holds: the
// battlefields the turn is most likely to be about are told in full, the rest
// in a line each, and what still does not fit is counted. Every name carries
// its kind where it could be two things, and nothing in it is an id.
//
// Pure, and loads in plain Node.

import { describeBattlefield, describeSince } from "../../runtime/fronts/brief.js";
import { foldBattlefieldName, normalizeBattlefields } from "../../runtime/fronts/record.js";
import { FRONT_ORDERS_FIELD } from "./nativeFrontLedger.js";

export const FRONTS_BLOCK_MAX = 7600;
export const FRONTS_BLOCK_HEADING = "[Fronts]";
// The most of what happened on one battlefield in a period that is told by date.
export const PERIOD_NEWS_MOST = 9;
export const PERIOD_TEXT_MAX = 560;

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();

// How a line of orders is written: the same whichever way the period is fought.
const ORDER_LINES = [
  `Orders go in ${FRONT_ORDERS_FIELD}, one line each:`,
  "battlefield~side~order~sector~eventNumbers~objective~result~effort",
  "- battlefield: a name from the list below. A war begun in this answer has none yet: name its battlefield yourself in its first order. A border with no war is `border: A / B`, the two countries by their exact names, with dig in or hold: troops are sent to fortify it and attack nothing.",
  "- side: the country or group being ordered, by its exact name.",
  "- order: advance | blitz | spearhead | flank | encircle | assault | hold | dig in | fall back | land. An assault sends the troops it takes straight at its objective, which it must have: `city: X`, `structure: X` or `unit: X`. A landing's objective says where.",
  "  An advance moves the whole stretch forward as a line, and a blitz the same, faster, after some days of massing. A spearhead (a wedge), a flank (a column round one side) and an encirclement (two columns that shut a place in and besiege it) are made by the troops nearest their objective, and the rest of the stretch stays as it was. Troops told to hold give ground rather than be cut off; troops told to dig in stand where they are, stronger, and can be shut in for it.",
  "- sector: all, a sector word listed for that battlefield, or a place on its line.",
];

// The engine runs AFTER the answer: an order is carried out in this period.
const FRONT_RULES = [
  FRONTS_BLOCK_HEADING,
  "Land war is fought on battlefields: one opens by itself wherever the two sides of a war hold land that touches, and there the game raises the troops, moves them and decides who holds the ground. You give the orders and tell the story. On the battlefields below this replaces what the instructions above say of moving formations and taking regions: write no unitOps for their sides' land forces and no regionControlOps for their regions. Fleets, air wings, garrisons, bases and land forces away from every battlefield move as before.",
  ...ORDER_LINES,
  "- eventNumbers: the events of this answer that tell of it, counted from 1, with commas between; blank means from the first day.",
  "- objective (a place with its kind: `city: Kharkiv`), result (breakthrough | captured | repulsed | stalemate | collapse | surrender: what the story itself decides, on that event's date) and effort (token | limited | major | total) may be left off.",
  "Eastern Ukraine~Russia~spearhead~north~2,3~city: Kharkiv~~major",
  "Eastern Ukraine~Russia~~south~5~city: Mariupol~captured",
  "An order stands until another replaces it: write a line only for what changes, and an empty string when nothing does. An event of this answer in which a side on a battlefield attacks, presses on, breaks through, digs in, holds fast or falls back is such a change: the line that orders it is owed, with that event's number, and a formation moved in unitOps does not stand in for it. How far an advance gets is worked out by the game and told to you here next period, so an event says a named place fell only when a line gives it as the objective with the result captured.",
].join("\n");

// The engine ran BEFORE the answer: the period is told, and an order is for the next.
const FOUGHT_RULES = [
  FRONTS_BLOCK_HEADING,
  "Land war is fought on battlefields: one opens by itself wherever the two sides of a war hold land that touches, and there the game raises the troops, moves them and decides who holds the ground. It has ALREADY fought this period on every battlefield told in full below: what a battlefield's account says happened, happened, on the dates it gives. You tell that story, and give the orders for what comes next. On the battlefields below this replaces what the instructions above say of moving formations and taking regions: write no unitOps for their sides' land forces and no regionControlOps for their regions (the game changes the map itself, on the dates of the fighting). Fleets, air wings, garrisons, bases and land forces away from every battlefield move as before.",
  "Tell the war. A battlefield where ground changed hands is among the first things this period is about, whoever is fighting on it: give it at least three events of this answer (two, where the answer has fewer than six), each on a date from its account and saying what the account says: the places that fell and to whom, the troops cut off or lost, how far the line went and where it stands now, and then what that did to the countries fighting and how others answered. Where an account also says what happened before this period and was not yet told, tell that too, early in the answer, as what the fighting had come to by then. A war that is only mentioned in passing has not been told. Nothing in any event goes against an account: a place it does not say fell did not fall, and a side it shows giving ground was not advancing.",
  ...ORDER_LINES,
  "- eventNumbers: the events of this answer in which the order is given, counted from 1, with commas between; may be blank.",
  "- objective (a place with its kind: `city: Kharkiv`), result (breakthrough | captured | repulsed | stalemate | collapse | surrender) and effort (token | limited | major | total) may be left off. A result is the story itself deciding what no account says (a garrison surrenders, an army collapses): it takes effect as the period ends.",
  "Eastern Ukraine~Russia~spearhead~north~2,3~city: Kharkiv~~major",
  "Eastern Ukraine~Ukraine~dig in~south~5",
  "An order written here is for what comes NEXT: it is put to the troops as this period ends and carried out in the one after, whose account you are given then. So, having told how the period went, decide what each side nobody plays does next (presses on, strikes somewhere else, digs in, falls back) and write its line; a side with no line goes on under its standing orders, shown below, and an empty string means nothing changes. Only on a battlefield that first opens in this answer (a war begun here) is an order carried out from its event's date: of that fighting say only that it began, since its account comes next period. An event of this answer that ends a war, or halts it with a ceasefire, stops its battlefield on that date: tell nothing its account says happened after it.",
].join("\n");

// The countries and groups people play: their troops are theirs to order.
const playerRule = (players, fought) => {
  const names = asArray(players).map(clean).filter(Boolean);
  if (names.length === 0) return "";
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const one = names.length === 1;
  return `${who} ${one ? "is" : "are each"} played by a person: write no order for ${one ? "it" : "them"} of your own. `
    + (fought
      ? `Where an event has that player's own order given to ${one ? "its" : "their"} troops, write the order here, resting on that event: it too is carried out next period, so the event tells of the order, not of what came of it. `
      : "Where an event carries out one of that player's own orders, give that order here, resting on that event. ")
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

// ---- a period that has been fought ---------------------------------------------------

// What a happening of the engine's log is in words: `who` leads the side it
// names, `at` is the place with its kind.
const NEWS_WORDS = {
  city: (who, at) => `${who} took ${at}`,
  taken: (who, at) => `${who} took ${at}`,
  destroyed: (who, at) => `${who} destroyed ${at}`,
  assault: (who, at) => `${who} was sent to storm ${at}`,
  overrun: (who, at) => `troops of ${who} were overrun near ${at}`,
  pocket: (who, at) => `troops of ${who} cut off near ${at} gave up`,
  siege: (who, at) => `troops of ${who} were shut in at ${at}`,
};
// Which of many is told: a capital, then a large town, then troops cut off or
// shut in, then what an assault took, then any other town, the larger first,
// then troops overrun. (A region that came wholly into a side's hands is not
// told by name here: there are dozens in a good month, and the brief above
// names the regions taken. They are counted.)
const LARGE_TOWN = 100000;
const newsWeight = (entry) => {
  const size = Math.min(9e8, Math.max(0, Number(entry.size) || 0));
  if (entry.k === "city") return entry.capital ? 6e9 : size >= LARGE_TOWN ? 4e9 + size : 2e9 + size;
  if (entry.k === "pocket" || entry.k === "siege") return 3e9;
  if (entry.k === "taken" || entry.k === "destroyed") return 2.5e9;
  if (entry.k === "overrun") return 1.5e9;
  return 5e8;
};

// The lines that tell a battlefield's period: what happened on which date, and
// how many formations each side began it with (the brief above them says how
// many are left). "" when nothing is known of it.
//   record   the battlefield as the period leaves it
//   before   the same battlefield as the period began, or null if it opened in it
//   news     what the run added to its log: [{ d, k, s, at, size?, capital? }]
export const describePeriod = ({ record, before = null, news = [], most = PERIOD_NEWS_MOST, max = PERIOD_TEXT_MAX } = {}) => {
  if (!record || record.status === "standing") return "";
  const lead = [record.sides?.[0]?.[0] ?? "", record.sides?.[1]?.[0] ?? ""];
  const sided = asArray(news).filter((entry) => entry && (entry.s === 0 || entry.s === 1) && clean(entry.at));
  const mine = sided.filter((entry) => NEWS_WORDS[entry.k]);
  // The regions that came wholly into each side's hands, counted once each.
  const whole = [0, 1].map((side) => new Set(sided.filter((entry) => entry.k === "whole" && entry.s === side).map((entry) => fold(entry.at))).size);
  const regions = whole.some((count) => count > 0)
    ? ` Regions that came wholly into a side's hands: ${[0, 1].filter((side) => whole[side] > 0).map((side) => `${lead[side]} ${whole[side]}`).join(", ")}.`
    : "";
  // The same thing said twice in a day is said once.
  const seen = new Set();
  const told = mine.filter((entry) => {
    const key = `${entry.d}|${entry.k}|${entry.s}|${fold(entry.at)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const lines = [];
  const began = asArray(before?.brief?.strength);
  if (began.length === 2 && began.every((side) => Number.isFinite(Number(side?.n)))) {
    lines.push(`  It began the period with ${lead[0]} at ${began[0].n} formations and ${lead[1]} at ${began[1].n}.`);
  }
  if (told.length === 0) {
    lines.push(`  This period, by date: no town changed hands and nobody was cut off.${regions}`);
    return lines.join("\n");
  }
  for (let count = Math.min(most, told.length); count >= 1; count -= 1) {
    const chosen = new Set(told.map((entry, index) => ({ entry, index })).sort((a, b) => newsWeight(b.entry) - newsWeight(a.entry) || a.index - b.index).slice(0, count).map((item) => item.index));
    const parts = told.filter((_, index) => chosen.has(index)).map((entry) => `${clean(entry.d)} ${NEWS_WORDS[entry.k](lead[entry.s], clean(entry.at))}`);
    const more = told.length - count;
    const text = `  This period, by date: ${parts.join("; ")}${more > 0 ? `; and ${more} more of the kind` : ""}.`;
    if (text.length + regions.length <= max || count === 1) {
      lines.push(text.length + regions.length <= max ? `${text}${regions}` : `${text.slice(0, Math.max(0, max - regions.length - 1)).trimEnd()}…${regions}`);
      break;
    }
  }
  return lines.join("\n");
};

// What a battlefield went through in its last run, when nobody was told it as
// it happened: what moved since that run began (brief.js describeSince, with
// more of its places named than the brief has room for), and the dated things
// of its log from then on. "" when it was told, or when nothing happened.
//   before   the battlefield as the period begins
export const UNTOLD_NAMES_MOST = 8;
export const describeUntold = (before) => {
  if (!before || before.status === "standing" || before.brief?.told === true) return "";
  const went = describeSince(before, { most: UNTOLD_NAMES_MOST });
  if (!went.moved) return "";
  const lines = [`  Before this period, and not yet told: since ${went.since}: ${went.text}`];
  const from = clean(before.brief?.since);
  const dated = describePeriod({ record: before, news: asArray(before.log).filter((entry) => !from || clean(entry?.d) >= from), most: 5, max: 340 });
  if (dated && !dated.includes("no town changed hands")) lines.push(dated.replace("  This period, by date: ", "  Of that, by date: "));
  return lines.join("\n");
};

// The block for a world's battlefields, never longer than `max`.
//   battlefields   world.battlefields
//   players        the countries and groups people play, by name
//   period         when the period was fought before the story is asked for:
//                  { fromDate, toDate, battlefields, news } — the battlefields
//                  as the period leaves them, and what it added to their logs.
//                  The list is then told as it stands at the period's END.
export const buildFrontsBlock = ({ battlefields = [], players = [], max = FRONTS_BLOCK_MAX, period = null } = {}) => {
  const began = normalizeBattlefields(battlefields);
  const fought = Boolean(period) && asArray(period.battlefields).length > 0;
  const rule = playerRule(players, fought);
  const head = [fought ? FOUGHT_RULES : FRONT_RULES, rule].filter(Boolean).join("\n");
  const records = fought ? normalizeBattlefields(period.battlefields) : began;
  const open = byWeight(records.filter(isOpen), players);
  // A battlefield that was open as the period began and that the period closed.
  const wasOpen = new Map(began.filter(isOpen).map((record) => [foldBattlefieldName(record.name), record]));
  const closed = fought ? records.filter((record) => !isOpen(record) && wasOpen.has(foldBattlefieldName(record.name))) : [];
  if (open.length === 0 && closed.length === 0) {
    return `${head}\nNo battlefield is open now.`.slice(0, max);
  }

  const title = fought
    ? `Battlefields, as the period from ${clean(period.fromDate)} to ${clean(period.toDate)} leaves them:`
    : "Battlefields open now:";
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
  const news = fought ? asArray(period.news) : [];
  // In full: the brief, and under it what the period did there by date.
  const inFull = (record) => {
    const text = describeBattlefield(record);
    if (!fought || record.status !== "active") return text;
    const name = foldBattlefieldName(record.name);
    const before = wasOpen.get(name) ?? null;
    const told = describePeriod({ record, before, news: news.filter((entry) => foldBattlefieldName(entry?.battlefield) === name) });
    return [text, describeUntold(before), told].filter(Boolean).join("\n");
  };
  const told = lines.map(() => false);
  for (const wording of [inFull, describeBattlefield, shortLine]) {
    for (let index = 0; index < lines.length; index += 1) {
      if (told[index]) continue;
      const text = wording(open[index]);
      if (!text || text.length - lines[index].length > room) continue;
      room -= text.length - lines[index].length;
      lines[index] = text;
      told[index] = true;
    }
  }
  // What the period closed: said in a line each while there is room.
  const ended = [];
  for (const record of closed) {
    const line = `- ${record.name}: the fighting there ended during the period (${clean(record.closedDate) || "by its end"}); it is closed.`;
    if (line.length + 1 > room) break;
    ended.push(line);
    room -= line.length + 1;
  }
  const block = [head, title, ...lines, ...ended, ...(unlisted > 0 ? [more(unlisted)] : [])].join("\n");
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
