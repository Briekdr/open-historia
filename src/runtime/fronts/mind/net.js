/*! Open Historia — battlefields and fronts: a small recurrent network (experiment) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// EXPERIMENT, in the lab only. "Let's experiment with training an RNN or
// other type of NN to learn military strategy so it powers the game engine
// for AI countries."
//
// The network a side's staff can be (policy.js): a gated recurrent unit with
// a straight path from what it sees to what it says, small enough to be
// trained by trying sets of weights against the engine itself (tools/
// strategy-nn/). Its memory is carried from one look at the front to the next.
//
//   z   = gate(Wz · [x, h] + bz)            how much of its memory to rewrite
//   c   = squash(Wc · [x, h] + bc)          what it would write
//   h'  = (1 - z) * h + z * c
//   out = Wo · h' + Wx · x + bo
//
// THE ENGINE'S RULE HOLDS HERE: only + - * / and comparisons. A gate is a
// clipped line and so is a squash, not an exponential, so the same weights
// decide the same thing on every machine (a multiplayer host and whoever
// checks it must agree).
//
// Pure, and loads in plain Node.

// The parameters lie in one flat array, in this order:
//   Wz [hidden x (inputs + hidden)]   bz [hidden]
//   Wc [hidden x (inputs + hidden)]   bc [hidden]
//   Wo [outputs x hidden]   Wx [outputs x inputs]   bo [outputs]
export const paramCount = ({ inputs, hidden, outputs }) => 2 * hidden * (inputs + hidden + 1) + outputs * (hidden + inputs + 1);

const gate = (value) => (value <= -2 ? 0 : value >= 2 ? 1 : 0.25 * value + 0.5);
const squash = (value) => (value <= -1 ? -1 : value >= 1 ? 1 : value);

// A memory with nothing in it.
export const blankState = (shape) => new Float64Array(shape.hidden);

// One look.
//   shape    { inputs, hidden, outputs }
//   params   the weights, paramCount(shape) of them
//   state    its memory, shape.hidden long (blankState to begin with)
//   x        what it sees, shape.inputs long
// Returns { state, out }: its memory afterwards and what it says (new arrays).
export const step = (shape, params, state, x) => {
  const { inputs, hidden, outputs } = shape;
  const wide = inputs + hidden;
  const next = new Float64Array(hidden);
  const wc = hidden * wide + hidden;
  for (let unit = 0; unit < hidden; unit += 1) {
    let z = params[hidden * wide + unit];
    let c = params[wc + hidden * wide + unit];
    const rowZ = unit * wide;
    const rowC = wc + unit * wide;
    for (let at = 0; at < inputs; at += 1) {
      z += params[rowZ + at] * x[at];
      c += params[rowC + at] * x[at];
    }
    for (let at = 0; at < hidden; at += 1) {
      z += params[rowZ + inputs + at] * state[at];
      c += params[rowC + inputs + at] * state[at];
    }
    const open = gate(z);
    next[unit] = (1 - open) * state[unit] + open * squash(c);
  }
  const wo = 2 * wc;
  const wx = wo + outputs * hidden;
  const bo = wx + outputs * inputs;
  const out = new Float64Array(outputs);
  for (let unit = 0; unit < outputs; unit += 1) {
    let sum = params[bo + unit];
    for (let at = 0; at < hidden; at += 1) sum += params[wo + unit * hidden + at] * next[at];
    for (let at = 0; at < inputs; at += 1) sum += params[wx + unit * inputs + at] * x[at];
    out[unit] = sum;
  }
  return { state: next, out };
};

// Weights as they are kept in a file, and read back: rounded, so a file is the
// same wherever it was written.
export const packWeights = (shape, params, extra = {}) => ({
  shape: { inputs: shape.inputs, hidden: shape.hidden, outputs: shape.outputs },
  ...extra,
  params: Array.from(params, (value) => Math.round(value * 1e5) / 1e5),
});

export const readWeights = (packed) => {
  const shape = packed?.shape;
  if (!shape || !(shape.inputs > 0) || !(shape.hidden > 0) || !(shape.outputs > 0)) return null;
  const params = Float64Array.from(Array.isArray(packed.params) ? packed.params : []);
  if (params.length !== paramCount(shape)) return null;
  for (const value of params) if (!Number.isFinite(value)) return null;
  return { shape: { inputs: shape.inputs, hidden: shape.hidden, outputs: shape.outputs }, params, prior: Number(packed.prior) > 0 ? Number(packed.prior) : 0, drafts: packed.drafts === true };
};
