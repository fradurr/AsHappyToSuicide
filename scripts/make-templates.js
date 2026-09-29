#!/usr/bin/env node
/**
 * make-templates.js — writes two empty tables to fill in by hand.
 *
 * Every row already carries the ISO3 code and the country name, so whoever
 * fills them in only has to complete the last column. That way the join no
 * longer depends on how a source spells country names, which is the one thing
 * most likely to break it.
 *
 * The rows are every country the map can draw. Leaving a cell empty is
 * legitimate: that country simply stays blank.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import countries from 'i18n-iso-countries';
import { readGeometryIso3 } from './build-data.js';

const require = createRequire(import.meta.url);
countries.registerLocale(require('i18n-iso-countries/langs/en.json'));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'templates');

const geo = readGeometryIso3();

// Antarctica is left off the map, so asking for its figures makes no sense.
const EXCLUDED = new Set(['ATA']);

const rows = [...geo.drawable]
  .filter((iso3) => !EXCLUDED.has(iso3))
  .map((iso3) => ({ iso3, name: countries.getName(iso3, 'en') ?? '' }))
  .sort((a, b) => (a.name || a.iso3).localeCompare(b.name || b.iso3, 'en'));

/** A field holding commas or quotes has to be quoted, or it breaks the CSV. */
const q = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function write(fileName, valueHeader, note) {
  const lines = [`iso3,country,${valueHeader}`];
  for (const r of rows) lines.push([q(r.iso3), q(r.name), ''].join(','));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, fileName), `${lines.join('\n')}\n`);
  console.log(`  ${path.join('data/templates', fileName)}  — ${rows.length} rows — ${note}`);
}

console.log('\nTables to fill in:');
write('life-evaluation.csv', 'life_evaluation', 'Cantril ladder score, 0–10');
write('suicide.csv', 'rate', 'deaths per 100,000, age-standardised');
console.log(`
Fill in the last column and save both files in data/sources/ under these names:
  data/sources/life-evaluation.csv
  data/sources/suicide.csv

Cells left empty are countries with no figure: they stay blank on the map.
Then run: npm run build:data -- --offline
`);
