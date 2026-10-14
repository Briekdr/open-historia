import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VAULT_LEAVES, VAULT_TIMING } from "./vaultPlan.js";
import { DISC_SIZE, PLATE_SIZE, brushedDisc, brushedPlate, seeded, vaultMetal } from "./vaultMetal.js";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const door = read("./VaultDoor.jsx");
const app = read("../../App.jsx");

// A leaf's corners, as percentages of the screen.
const cornersOf = (shape) => [...shape.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map((match) => [Number(match[1]), Number(match[2])]);
const areaOf = (corners) => Math.abs(corners.reduce((sum, [x, y], index) => {
  const [nextX, nextY] = corners[(index + 1) % corners.length];
  return sum + x * nextY - nextX * y;
}, 0)) / 2;
const moveOf = (away) => /translate\((-?[\d.]+)%, (-?[\d.]+)%\)/.exec(away).slice(1).map(Number);

test("the door is three leaves that cover the whole screen and meet in its middle", () => {
  assert.deepEqual(VAULT_LEAVES.map((leaf) => leaf.name), ["top", "left", "right"]);
  // Together they are the screen, no more and no less: nothing of the menu
  // shows through a shut door.
  const total = VAULT_LEAVES.reduce((sum, leaf) => sum + areaOf(cornersOf(leaf.shape)), 0);
  assert.equal(total, 100 * 100);
  for (const leaf of VAULT_LEAVES) {
    assert.ok(cornersOf(leaf.shape).some(([x, y]) => x === 50 && y === 50), `${leaf.name} reaches the middle`);
  }
});

test("the top leaf is drawn up, and the two below are drawn down and outward", () => {
  const moves = Object.fromEntries(VAULT_LEAVES.map((leaf) => [leaf.name, moveOf(leaf.away)]));
  assert.equal(moves.top[0], 0);
  assert.ok(moves.top[1] < 0);
  assert.ok(moves.left[0] < 0 && moves.left[1] > 0);
  assert.ok(moves.right[0] > 0 && moves.right[1] > 0);
  // Mirror images of each other.
  assert.equal(moves.left[0], -moves.right[0]);
  assert.equal(moves.left[1], moves.right[1]);
});

test("each leaf goes far enough to be off the screen altogether", () => {
  for (const leaf of VAULT_LEAVES) {
    const [dx, dy] = moveOf(leaf.away);
    const moved = cornersOf(leaf.shape).map(([x, y]) => [x + dx, y + dy]);
    const off = moved.every(([x]) => x <= 0) || moved.every(([x]) => x >= 100) || moved.every(([, y]) => y <= 0) || moved.every(([, y]) => y >= 100);
    assert.ok(off, `${leaf.name} is clear of the screen when open`);
  }
});

test("it shakes before it is clicked, soon and then now and again", () => {
  assert.ok(VAULT_TIMING.firstShake <= 2000);
  assert.ok(VAULT_TIMING.shakeEvery > VAULT_TIMING.shake * 3);
  assert.match(door, /const shudder = \(\) => \{\s+setShaking\(true\);\s+soundsRef\.current\?\.rattle\(\);/);
  assert.match(door, /animation: shaking \? `oh-vault-shake \$\{VAULT_TIMING\.shake\}ms/);
});

test("clicked, the wheel turns, the bolts draw back, and only then do the leaves part: each with its sound", () => {
  const open = door.slice(door.indexOf("const open = () => {"), door.indexOf('if (stage === "gone") return null;'));
  const order = ["voice?.spin(", "voice?.unlock(), VAULT_TIMING.spin", "voice?.open(", 'setStage("gone")'];
  let from = open.indexOf('setStage("spinning")');
  assert.ok(from > 0);
  for (const step of order) {
    const at = open.indexOf(step, from);
    assert.ok(at > from, step);
    from = at;
  }
  // The leaves start when the bolts are back, and the door is gone when they have gone.
  assert.match(open, /\}, VAULT_TIMING\.spin \+ VAULT_TIMING\.bolts\);/);
  assert.match(open, /VAULT_TIMING\.spin \+ VAULT_TIMING\.bolts \+ VAULT_TIMING\.open \+ \d+\);/);
  // It is the mark that turns, more than once round.
  assert.match(door, /rotate\(\$\{turned && !still \? 540 : 0\}deg\)/);
});

test("the wheel is a button with a name, focused when the door appears, and clicked once", () => {
  assert.match(door, /<button\s+type="button"\s+className="oh-vault-knob"\s+aria-label="Open"\s+autoFocus\s+disabled=\{stage !== "closed"\}\s+onClick=\{open\}/);
  assert.match(door, /if \(stage !== "closed"\) return;/);
});

test("the mark is nearly the whole of the wheel", () => {
  const wheel = door.slice(door.indexOf("const Wheel = "), door.indexOf("// `onOpening`"));
  const rim = Number(/<circle r="(\d+)" fill=\{STEEL\.edge\} \/>/.exec(wheel)[1]);
  const mark = Number(/<clipPath id="oh-vault-hub"><circle r="(\d+)" \/><\/clipPath>/.exec(wheel)[1]);
  assert.ok(mark / rim >= 0.8, `the mark is ${mark} of a rim of ${rim}`);
});

test("with Reduce motion on nothing shakes, turns or slides: a click fades the door", () => {
  assert.match(door, /const still = useMemo\(\(\) => reduceMotionEnabled\(\), \[\]\);/);
  assert.match(door, /if \(stage !== "closed" \|\| still\) return undefined;/);
  assert.match(door, /if \(still\) \{[\s\S]+?voice\?\.unlock\(\);[\s\S]+?VAULT_TIMING\.fade\);\s+return;\s+\}/);
  assert.match(door, /transform: opening && !still \? leaf\.away : "translate\(0%, 0%\)"/);
});

test("the app shows the door once the startup screen is done, over the menu, and takes it away when it has opened", () => {
  assert.match(app, /\{isReady && doorShut && \(\s+<DoorFrame onFailed=\{doorGone\}>\s+<VaultDoor onOpening=\{letMusicIn\} onOpened=\{doorGone\} \/>/);
  // The menu is already there behind it.
  assert.ok(app.indexOf("{isReady && (\r\n      <UI") > 0 || app.indexOf("{isReady && (\n      <UI") > 0);
  // The menu's music waits behind the door and begins as it opens.
  assert.match(app, /useState\(\(\) => \{\s+holdMusicBehindDoor\(true\);\s+return true;\s+\}\)/);
  assert.match(app, /const letMusicIn = useCallback\(\(\) => holdMusicBehindDoor\(false\), \[\]\);/);
  // A door that cannot be drawn does not shut the menu in.
  assert.match(app, /componentDidCatch\(error\) \{[\s\S]+?this\.props\.onFailed\?\.\(\);/);
  assert.match(app, /const doorGone = useCallback\(\(\) => \{\s+holdMusicBehindDoor\(false\);\s+setDoorShut\(false\);/);
});

test("the same steel every time", () => {
  const first = seeded(5);
  const second = seeded(5);
  for (let i = 0; i < 20; i += 1) {
    const value = first();
    assert.equal(value, second());
    assert.ok(value >= 0 && value < 1);
  }
  assert.deepEqual(brushedDisc(24), brushedDisc(24));
  assert.deepEqual(brushedPlate(24), brushedPlate(24));
});

test("the steel is a dark, slightly blue picture with no holes in it", () => {
  for (const pixels of [brushedDisc(64), brushedPlate(64)]) {
    assert.equal(pixels.length, 64 * 64 * 4);
    let red = 0;
    let blue = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      assert.equal(pixels[at + 3], 255);
      assert.ok(pixels[at + 1] < 140, "never bright: the door sits in the grey of the interface");
      red += pixels[at];
      blue += pixels[at + 2];
    }
    assert.ok(blue > red);
  }
});

test("the round steel is brushed in circles", () => {
  const size = 128;
  const pixels = brushedDisc(size);
  const green = (x, y) => pixels[(y * size + x) * 4 + 1];
  // Along one ring the picture changes slowly; across the rings it changes at
  // every step. Compared a quarter of the way out, to the right of the middle.
  let along = 0;
  let across = 0;
  for (let step = 0; step < 20; step += 1) {
    const angle = (step / 20) * 0.3;
    const next = ((step + 1) / 20) * 0.3;
    const at = (a) => [Math.round(64 + Math.cos(a) * 40), Math.round(64 + Math.sin(a) * 40)];
    along += Math.abs(green(...at(angle)) - green(...at(next)));
    across += Math.abs(green(84 + step, 64) - green(85 + step, 64));
  }
  assert.ok(across > along, `across the rings ${across}, along one ${along}`);
});

test("the wall's steel is brushed straight across", () => {
  const size = 64;
  const pixels = brushedPlate(size);
  const green = (x, y) => pixels[(y * size + x) * 4 + 1];
  let along = 0;
  let across = 0;
  for (let step = 0; step < size - 1; step += 1) {
    along += Math.abs(green(step, 20) - green(step + 1, 20));
    across += Math.abs(green(20, step) - green(20, step + 1));
  }
  assert.ok(across > along);
});

test("where no picture can be made the door is drawn in its flat colours", () => {
  assert.ok(DISC_SIZE >= 512 && PLATE_SIZE >= 128);
  // node has no document.
  assert.deepEqual(vaultMetal(), { disc: null, plate: null });
  assert.match(door, /\{metal\.disc \? \(/);
  assert.match(door, /backgroundImage: metal\.plate \? `url\(\$\{metal\.plate\}\)` : "none"/);
});
