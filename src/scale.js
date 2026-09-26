/**
 * scale.js — the grey scale the map uses for suicide mortality.
 *
 * No colour. The subject is deaths, and a colour ramp would turn countries into
 * red and green cells, which reads as a report card.
 *
 * The signal is a flat tone: one solid grey per class. Over it sits a dot grid,
 * identical at every level — paper grain, not information. It carries nothing,
 * and there is nothing in it to read.
 *
 * Why the grain is this faint and this fine
 * -----------------------------------------
 * An earlier version carried the value itself in the density of the dots, the
 * way halftone printing does. It survived measurement, but on screen a texture
 * that shifts density under the eye is tiring: you read the shimmer before the
 * data. Here the dots never change, and they sit close enough to the tone
 * beneath them to register as surface rather than pattern.
 */

import { select } from 'd3-selection';

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

/**
 * Grid pitch, in screen px. An integer, so the lattice falls in phase with the
 * pixel grid at 1x, 2x and 3x alike and the grain renders evenly.
 */
const PITCH = 3;

/** Dot radius. Small enough that the grain is felt rather than looked at. */
const DOT = 0.5;

/**
 * How much darker the dot is than the tone it sits on, in RGB levels.
 *
 * Subtracted rather than mixed towards the dark end: mixing would make the dot
 * match the fill on the last class, and the grain would vanish exactly where
 * the tone is fullest. Subtracting keeps it constant across the scale. Twelve
 * levels out of 255 is below the threshold where a texture becomes something
 * you look at.
 */
const DOT_DARKER = 12;

const lerp = (a, b, t) => a + (b - a) * t;
const css = ([r, g, b]) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
const darken = (c, amount) => c.map((v) => Math.max(0, v - amount));

/** The seven tones, lightest to darkest, each with its grain colour. */
export function tones() {
  const out = [];
  for (let i = 0; i < LEVELS; i += 1) {
    const t = LEVELS === 1 ? 0 : i / (LEVELS - 1);
    const base = LIGHT.map((c, k) => lerp(c, DARK[k], t));
    out.push({ i, fill: css(base), dot: css(darken(base, DOT_DARKER)), pitch: PITCH, radius: DOT });
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

/** The flat tone for a fraction, with no grain over it. */
export const fillFor = (fraction) => tones()[levelFor(fraction)].fill;

/**
 * A pattern id. The prefix matters because the map and the legend are two
 * separate <svg> elements on the same page: with the same id the document would
 * hold two copies, and which one a url(#id) points at is defined nowhere.
 */
export const patternId = (i, prefix = 'tone') => `${prefix}-${i}`;

/** Exported for the tests: the constraints live here, not in hand-written numbers. */
export const bounds = { LIGHT, DARK, PITCH, DOT, DOT_DARKER };

/**
 * Writes the <pattern> elements into a <defs>: a full-bleed rect plus one dot
 * per tile. The flat fill lives inside the pattern rather than on the path, so
 * tone and grain stay one thing and whoever draws only has to pick an id.
 */
export function createPatterns(defs, prefix = 'tone') {
  const ls = tones();
  defs
    .selectAll('pattern')
    .data(ls)
    .join('pattern')
    .attr('id', (d) => patternId(d.i, prefix))
    .attr('patternUnits', 'userSpaceOnUse')
    .attr('width', (d) => d.pitch)
    .attr('height', (d) => d.pitch)
    .each(function draw(d) {
      const p = select(this);
      p.selectAll('rect')
        .data([d])
        .join('rect')
        .attr('width', d.pitch)
        .attr('height', d.pitch)
        .attr('fill', d.fill);
      p.selectAll('circle')
        .data([d])
        .join('circle')
        .attr('cx', d.pitch / 2)
        .attr('cy', d.pitch / 2)
        .attr('r', d.radius)
        .attr('fill', d.dot);
    });
  return ls;
}
