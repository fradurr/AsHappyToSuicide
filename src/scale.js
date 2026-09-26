/**
 * scale.js — the grey scale the map uses for suicide mortality.
 *
 * No colour. The subject is deaths, and a colour ramp would turn countries into
 * red and green cells, which reads as a report card.
 *
 * The signal is a flat tone: one solid grey per class, set straight on the
 * path's `fill`. Nothing is layered on top.
 *
 * What this replaced, and why
 * ---------------------------
 * Earlier versions carried the value in the density of a dot screen, the way
 * halftone printing does. It held up on paper and it survived measurement, but
 * on screen a texture that shifts density under the eye is tiring: you read the
 * shimmer before the data. A flat tone just reads. It is also the lightest
 * thing a choropleth can be — a fill attribute, no <pattern>, no <defs>, no
 * counter-scaling on zoom, nothing to rasterise.
 */

/**
 * Seven classes. Past seven, a thematic map gets harder to read: too many
 * shades to hold in mind while glancing back at the legend.
 */
export const LEVELS = 7;

/**
 * The ends of the scale, in warm greys that sit with the paper.
 *
 * The lightest is deliberately darker than the background: countries without
 * data stay paper-coloured, and a first class too faint would blend into them.
 * The darkest stops short of black, because borders are drawn in ink and would
 * disappear against it.
 */
const LIGHT = [222, 216, 205];
const DARK = [75, 70, 64];

const lerp = (a, b, t) => a + (b - a) * t;
const css = ([r, g, b]) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;

/** The seven tones, lightest to darkest. */
export function tones() {
  const out = [];
  for (let i = 0; i < LEVELS; i += 1) {
    const t = LEVELS === 1 ? 0 : i / (LEVELS - 1);
    out.push({ i, fill: css(LIGHT.map((c, k) => lerp(c, DARK[k], t))) });
  }
  return out;
}

/**
 * Fraction 0–1 to class. 0 is the lightest, 1 the darkest.
 * The caller decides which quantity to normalise: this module does not know
 * what the scale represents, and should not.
 */
export function levelFor(fraction) {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  return Math.min(LEVELS - 1, Math.max(0, Math.round(f * (LEVELS - 1))));
}

/** The fill for a fraction, ready for a `fill` attribute. */
export const fillFor = (fraction) => tones()[levelFor(fraction)].fill;

/** Exported for the tests: the constraints live here, not in hand-written numbers. */
export const bounds = { LIGHT, DARK };
