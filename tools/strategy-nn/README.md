# A trained staff for countries nobody plays (experiment)

Lab only. Branch `experiment/strategy-nn` of the private lab. Nothing here is in the public game.

The owner asked, on 2026-10-13:

> separately in the lab lets experiment with training an rnn or other type of nn to learn military stratagy so it powers the game engine for ai countries. it should factor in needing to defend its own territory

and then, for how it is trained:

> train the ais against each other and which ever wins advances. add penalties for losing city territory, for losing troops, and for losing land, have the models train across various different country combos, add bonuses for taking enemy cities, encompassing, taking troops, and taking land

## What was built

**The thing it replaces.** A side of a battlefield that nobody plays has a *staff* (`src/runtime/fronts/staff.js`): a few written rules, looked at every ten days, that have it dig in, hold, attack the stretch of line where it is strongest, or advance along the whole line, by how strong it is against its enemy and whether it began the war.

**The network** (`src/runtime/fronts/mind/`). A small recurrent network that is asked the same question at the same moments and may give the same four answers.

- `net.js`: a gated recurrent unit of 12 units with a straight path from input to output, 1,230 weights. Its gates are clipped lines, not exponentials, so it uses only `+ - * /` and comparisons like the rest of the engine: the same weights decide the same thing on every machine, which a multiplayer host needs.
- `features.js`: the 28 numbers it is shown. The odds along the line and on its best and worst stretch; each side's troops, strength, reserves, supply, and how many are cut off or dug in; **how much of its own home ground the enemy holds, how much of the enemy's it holds, and how both moved since it last looked**; whether it began the war; how long the war has run; how its countries stand on their other fronts; and what the scripted staff would say. Home ground is read by who is *sovereign* there, so ground lost long ago is still known to be its own.
- `policy.js`: turns the network into a staff. Its memory is kept on the battlefield (`mind`, saved with the record), so it remembers from one turn of the game to the next.
- The engine asks it through one hook (`engine.js reviewStaff`, `input.staffPolicy`). Without one, nothing changes.

**The arena** (`arena.mjs`). Wars for two staffs to fight each other in, drawn from a seed:

- two to four countries side by side, each a small state, a middling one or a great power, with a capital and up to three towns;
- one against one, two against one, one against two, two against two, or one against one with a neighbour looking on;
- an age from 1200 to 2024, four to six months, fought by the game's own front engine a month at a time.

**What is rewarded and charged**, each as a share:

| | weight |
|---|---|
| land taken | +1.0 |
| land lost | −1.5 |
| cities taken (a capital counts three, a large town two) | +0.6 |
| cities lost | −0.9 |
| enemy troops lost | +0.4 |
| own troops lost | −0.5 |
| encompassing: the largest share of the enemy's troops cut off at once, and each pocket that gave up | +0.5 |

Losing counts for more than taking, because the owner asked that it weigh defending its own territory. The weights are a first guess and nobody has tuned them.

**The league** (`league.mjs`). Twelve networks. Each round they are drawn into pairs and each pair fights a match: five wars drawn afresh from every combination above, each fought twice with the teams exchanged. Whichever did better advances; the loser is replaced by a child of one that advanced (a copy with some weights nudged, now and then a mixture of two). Four networks a round are drawn against a gatekeeper in place of another network (the scripted staff, the habit of always advancing, or a past champion) and advance only if they beat it. Every ten rounds the networks with the longest runs of wins are tried on sixteen wars kept aside, and the best becomes the champion.

## What happened

### 1. One network against the scripted staff (the first attempt)

Before the league, a single network was trained by an evolution strategy against the scripted staff and a few plain habits, with a simpler reward (ground taken, less twice the home ground lost). It learned one thing in five generations and nothing after: **always advance**. On 240 wars it had not seen it told its side to advance 100% of the time and scored exactly what the habit of always advancing scores (`runs/first/evaluation.json`). A second run that began from "always advance" and had only to learn when not to did not improve on it in twenty generations (`runs/lean/log.jsonl`).

### 2. The league (the owner's design)

Forty minutes, 237 rounds, 1,425 networks (`runs/league/log.jsonl`). The champion, on 150 wars the league never saw, each fought twice with the teams exchanged (`runs/league/evaluation.json`):

| the network against | margin a war | standard error | better / level / worse |
|---|---|---|---|
| the scripted staff | **+1.84** | 0.31 | 75 / 2 / 73 |
| always advancing | **−0.27** | 0.20 | 27 / 95 / 28 |
| always holding | +7.28 | 0.19 | 150 / 0 / 0 |
| always digging in | +6.23 | 0.23 | 148 / 0 / 2 |
| *(always advancing against the scripted staff)* | *+1.97* | *0.32* | *72 / 0 / 78* |

It told its sides to advance 94% of the time and to hold 6%.

Against the scripted staff, by the kind of war:

| where | wars | margin a war | better / level / worse |
|---|---|---|---|
| one against one | 85 | +1.72 | 39 / 0 / 46 |
| two against one, or one against two | 51 | +1.09 | 26 / 2 / 23 |
| two against two | 14 | +5.29 | 10 / 0 / 4 |
| the team that began is much the weaker | 61 | +0.24 | 20 / 0 / 41 |
| about even | 47 | **+5.16** | 38 / 0 / 9 |
| the team that began is much the stronger | 42 | +0.44 | 17 / 2 / 23 |

## What it shows, and what it does not

1. **The league did not find a strategy.** Its champion is the habit of always advancing with a little noise in it. It is no better than that habit against the scripted staff (+1.84 against +1.97, well inside the error) and, if anything, slightly worse against the habit itself (−0.27, a little over one standard error). Nothing here is evidence that a learned staff beats the best plain habit.
2. **The scripted staff is too passive at even odds, and that is the real finding.** Almost the whole of the +1.8 comes from wars that are about even (+5.2 a war): the scripted staff holds, its enemy attacks, and it loses ground and towns it need not have. In lopsided wars attacking is a wash. With both sides scripted, an even war is often not fought at all (nobody attacks for the whole of it). This could be changed in `staff.js` by a few constants, with no network; nobody has been asked whether it should be, and it has not been done.
3. **Why nothing better was found**, as far as this can say: the four answers a staff may give are coarse (one order for the whole line, or for one stretch), and in this engine who is stronger decides most of a war whatever is ordered. In the arena as it stands, attacking costs the attacker little. The reward's seven parts all move together with winning ground, so they do not pull a staff toward anything subtler. And forty minutes on one machine is a small search.
4. **It does weigh its own territory, in the sense asked**: the network is shown its home ground lost and losing is charged more than taking is rewarded. But what the league converged on does not *use* that: it attacks whether or not it is losing ground.

## Trying it in a game

The champion is shipped in this branch (`src/runtime/fronts/mind/weights.js`) behind a switch that is off. In the lab build, in the browser's console:

```js
localStorage.setItem("oh:strategyNet", "1")   // on: sides nobody plays are led by the network
localStorage.removeItem("oh:strategyNet")     // off: the engine's scripted staff, as ever
```

There is no setting for it and no scenario can ask for it. With it on, expect countries nobody plays to attack nearly always. A side a person plays is never led by it, and an order the story gave a side still stands for 45 days, as with the scripted staff.

The network may also call up fresh formations by itself (a draft), which the scripted staff never does; that is off, and no shipped weights were trained with it, because a staff that can draft is not being compared with the scripted one like for like.

## Running it

```bash
node tools/strategy-nn/peek.mjs 1 8                                   # a look at eight wars
node tools/strategy-nn/league.mjs --name league --minutes 40 --workers 12
node tools/strategy-nn/evaluate.mjs --name league --wars 150 --workers 12
node tools/strategy-nn/export.mjs --name league                       # ship a champion behind the switch
node tools/strategy-nn/export.mjs --none                              # take it out again
node --test src/runtime/fronts/mind/mind.test.js
```

A war takes about half a second, so a round of the league is a few seconds on twelve workers.

## If it is taken further

- Fix the scripted staff's passivity at even odds first, and train against *that*: a league whose gatekeeper is easy to beat by attacking learns to attack.
- Give a staff more to decide: where to put its weight along the line, when to encircle, when to fall back, how much effort, when to draft. With four coarse answers there may be nothing to learn.
- Make attacking cost something in the arena when it fails (it barely does now), or the best habit will stay "always advance".
- Tune the reward. Its parts were chosen from the owner's list and never varied.
- Train for hours, not minutes, and keep more past champions as gatekeepers.
