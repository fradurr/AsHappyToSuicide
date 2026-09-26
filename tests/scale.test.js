import test from 'node:test';
import assert from 'node:assert/strict';

import { tones, levelFor, fillFor, patternId, bounds, LEVELS } from '../src/scale.js';

/** "rgb(222 216 205)" -> [222, 216, 205] */
const channels = (s) => s.match(/\d+/g).map(Number);
/** Perceived luminance, to compare two tones the way an eye would. */
const luminance = (s) => {
  const [r, g, b] = channels(s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test('the scale runs light to dark without turning back', () => {
  const ls = tones();
  assert.equal(ls.length, LEVELS);
  for (let i = 1; i < ls.length; i += 1) {
    assert.ok(
      luminance(ls[i].fill) < luminance(ls[i - 1].fill),
      `level ${i} must be darker than the one before it`,
    );
  }
});

test('each class separates from the previous one enough to be seen', () => {
  const ls = tones();
  const steps = ls.slice(1).map((t, i) => luminance(ls[i].fill) - luminance(t.fill));
  // A flat fill has nothing to rasterise, so the gap measured here is the gap
  // that reaches the screen, at any pixel density. That was the weak point of
  // the dot-screen version, where the rendering depended on aliasing.
  for (const [i, s] of steps.entries()) {
    assert.ok(s > 10, `classes ${i} and ${i + 1} are too close: ${s.toFixed(1)} of 255`);
  }
});

test('the first tone is darker than the paper, or it blends into empty countries', () => {
  // Paper is #efebe4; countries without data keep that colour.
  const paper = 0.2126 * 0xef + 0.7152 * 0xeb + 0.0722 * 0xe4;
  assert.ok(paper - luminance(tones()[0].fill) > 10, 'the first tone disappears into the background');
});

test('the last tone stops short of black, or the borders disappear', () => {
  // Borders are drawn in ink (#26241f), so they need contrast there too.
  const ink = 0.2126 * 0x26 + 0.7152 * 0x24 + 0.0722 * 0x1f;
  assert.ok(luminance(tones().at(-1).fill) - ink > 10);
});

test('the declared ends are the ends actually produced', () => {
  const ls = tones();
  assert.deepEqual(channels(ls[0].fill), bounds.LIGHT);
  assert.deepEqual(channels(ls.at(-1).fill), bounds.DARK);
});

test('levelFor spans the scale and survives values out of range', () => {
  assert.equal(levelFor(0), 0);
  assert.equal(levelFor(1), LEVELS - 1);
  assert.equal(levelFor(0.5), Math.round(0.5 * (LEVELS - 1)));
  // A rate past the top of the scale saturates instead of running off the array.
  assert.equal(levelFor(3), LEVELS - 1);
  assert.equal(levelFor(-1), 0);
  for (const bad of [NaN, undefined, null, 'x']) {
    assert.equal(levelFor(bad), 0, `${bad} must fall on the lightest tone`);
  }
});

test('the grain is grain, not information: same pitch and same dot everywhere', () => {
  const ls = tones();
  assert.equal(new Set(ls.map((t) => t.pitch)).size, 1);
  assert.equal(new Set(ls.map((t) => t.radius)).size, 1);
  assert.ok(Number.isInteger(bounds.PITCH), 'an integer pitch falls in phase with the pixels');
});

test('the dot stays visible across the scale, both ends included', () => {
  for (const t of tones()) {
    const d = luminance(t.fill) - luminance(t.dot);
    // Mixing towards the dark end would give zero on the last class: that is
    // why the dot is obtained by subtracting instead.
    assert.ok(d > 3, `level ${t.i}: the grain disappears (gap ${d.toFixed(1)})`);
    assert.ok(d < 25, `level ${t.i}: the grain draws too much attention (${d.toFixed(1)})`);
  }
});

test('pattern ids are distinct, and the prefixes do not collide', () => {
  const map = tones().map((t) => patternId(t.i, 'tone'));
  const legend = tones().map((t) => patternId(t.i, 'legend'));
  assert.equal(new Set([...map, ...legend]).size, LEVELS * 2);
});

test('fillFor returns a usable colour for every fraction', () => {
  for (const f of [0, 0.25, 0.5, 0.75, 1, -3, 9, NaN]) {
    assert.match(fillFor(f), /^rgb\(\d+ \d+ \d+\)$/);
  }
  assert.equal(fillFor(0), tones()[0].fill);
  assert.equal(fillFor(1), tones().at(-1).fill);
});
