#!/usr/bin/env node
/**
 * make-placeholder.js — generates FAKE data so the map can be looked at.
 *
 * Only useful until the two real sources are in data/sources/. The numbers come
 * from a deterministic generator: they bear no relation to the wellbeing or the
 * mortality of any country.
 *
 * Hence:
 *   - the file is called countries.placeholder.json, never countries.json;
 *   - meta.placeholder is true, and the front end puts a standing banner on it.
 *
 * Replace it with `npm run build:data` as soon as the real sources exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import countries from 'i18n-iso-countries';
import { readGeometryIso3, percentileRanks, competitionRanks } from './build-data.js';

const require = createRequire(import.meta.url);
countries.registerLocale(require('i18n-iso-countries/langs/en.json'));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const WEIGHT = 0.25;

/** Deterministic PRNG: the same ISO3 always yields the same fake number. */
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const geo = readGeometryIso3();
const iso3s = [...geo.drawable].sort();

// About one country in seven is left uncovered, so the empty state shows.
const rows = [];
for (const iso3 of iso3s) {
  const rand = seeded(iso3);
  const roll = rand();
  const missingWhr = roll < 0.07;
  const missingSuicide = roll >= 0.07 && roll < 0.14;
  if (missingWhr || missingSuicide) continue;
  rows.push({
    iso3,
    whr: 2.5 + rand() * 5.5, // 2.5 - 8.0, the real Cantril range
    suicide: 1.5 + rand() * 26, // 1.5 - 27.5 per 100,000
  });
}

const pWell = percentileRanks(rows.map((r) => r.whr));
const pSui = percentileRanks(rows.map((r) => -r.suicide));
rows.forEach((r, i) => {
  r.index = (1 - WEIGHT) * pWell[i] + WEIGHT * pSui[i];
});
const ranks = competitionRanks(rows.map((r) => r.index));
const ranksWhr = competitionRanks(rows.map((r) => r.whr));
rows.forEach((r, i) => {
  r.rank = ranks[i];
  r.rankWhr = ranksWhr[i];
  r.rankDelta = ranksWhr[i] - ranks[i];
});

const round = (x, d) => Number(x.toFixed(d));
const out = {
  meta: {
    placeholder: true,
    warning: 'INVENTED DATA. No relation to real wellbeing or mortality.',
    weight: WEIGHT,
    countriesWithData: rows.length,
    generated: new Date().toISOString().slice(0, 10),
  },
  countries: {},
};
for (const r of [...rows].sort((a, b) => a.rank - b.rank)) {
  out.countries[r.iso3] = {
    name: countries.getName(r.iso3, 'en') ?? r.iso3,
    index: round(r.index, 1),
    whr: round(r.whr, 2),
    suicide: round(r.suicide, 1),
    rank: r.rank,
    rankWhr: r.rankWhr,
    rankDelta: r.rankDelta,
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'countries.placeholder.json'), `${JSON.stringify(out, null, 2)}\n`);
// This one is real, though: it derives only from the geometry and ISO codes.
fs.writeFileSync(
  path.join(OUT_DIR, 'geo-iso.json'),
  `${JSON.stringify({ byId: geo.byId, byName: geo.byName }, null, 2)}\n`,
);

console.log(`placeholder: ${rows.length} countries with fake data, ${iso3s.length - rows.length} left blank`);
console.log(`geo-iso.json: ${Object.keys(geo.byId).length} by id + ${Object.keys(geo.byName).length} by name`);
