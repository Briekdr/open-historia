/*! Open Historia — a country's weight in a land war © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A country's weight in a land war: the points of strength the engine sizes
// its troops by (runtime/fronts/constants.js TROOPS_PER_STRENGTH: a dozen
// counters a point, a great power bringing about 24 points and a small state
// one or two). Its people where its sheet counts them, by the square root, so
// that a country of a billion is not a hundred times one of ten million on the
// same front: 144 million is 24. Otherwise the land it holds, on the same
// scale: the few hundred regions the largest countries of the built-in map
// hold come to about 24, a country of three or four regions to two or three.
// (Most countries of most games have no sheet, so this is the common case. It
// used to start every country at four points and add two for the root of its
// regions, from when only the ratio of two sides counted: by the engine's
// count that stood a state of one region seventy counters.)
//
// It lives here, and not with the turn that uses it (Game/AI/frontTurn.js,
// which hands it on under the same name), so that the Stats pane's ranking can
// show the same figure without loading the turn.
//
// Pure, and loads in plain Node.

//   funding   what its economy does to that (runtime/militaryFunding.js fundingFactor): 1 where it is not known
export const countryWeight = ({ population = 0, regions = 0, funding = 1 } = {}) => {
  const people = Number(population);
  const paid = Number.isFinite(Number(funding)) && Number(funding) > 0 ? Number(funding) : 1;
  if (Number.isFinite(people) && people > 0) return Math.max(1, 2 * Math.sqrt(people / 1e6) * paid);
  return Math.max(1, 1.3 * Math.sqrt(Math.max(0, Number(regions) || 0)));
};
