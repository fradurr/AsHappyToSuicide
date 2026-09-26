#!/usr/bin/env node
/**
 * build-data.js — builds public/data/countries.json
 *
 * Pipeline:
 *   1. load the two sources (WHR wellbeing, WHO/GHE suicide mortality)
 *   2. normalise both onto ISO 3166-1 alpha-3
 *   3. keep only the countries that have *both* figures
 *   4. turn both variables into percentiles within that sample
 *   5. combine the percentiles into the happiness value
 *   6. write the JSON the front end reads without doing any further maths
 *
 * The calculation lives here, not in the browser: the map receives finished
 * numbers.
 *
 * Usage:
 *   node scripts/build-data.js               # use local copies, download if missing
 *   node scripts/build-data.js --refresh     # re-download even if already present
 *   node scripts/build-data.js --offline     # never download, fail if a file is missing
 *   node scripts/build-data.js --weight 0.3  # a different weight for the suicide part
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ExcelJS from 'exceljs';
import countries from 'i18n-iso-countries';

import {
  WHR_NAME_TO_ISO3,
  INTENTIONALLY_UNMAPPED,
  GEO_NAME_TO_ISO3,
  normalizeName,
} from '../src/iso-lookup.js';

const require = createRequire(import.meta.url);
countries.registerLocale(require('i18n-iso-countries/langs/en.json'));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The paths can be overridden by environment variables: the tests need it, to
// run the whole pipeline over fake sources without touching the real files.
const fromEnv = (name, fallback) => (process.env[name] ? path.resolve(process.env[name]) : fallback);

const SOURCES_DIR = fromEnv('BUILD_SOURCES_DIR', path.join(ROOT, 'data', 'sources'));
const OUT_DIR = fromEnv('BUILD_OUT_DIR', path.join(ROOT, 'public', 'data'));
const GEO_FILE = fromEnv('BUILD_GEO_FILE', path.join(ROOT, 'public', 'geo', 'countries-110m.json'));
const OUT_FILE = path.join(OUT_DIR, 'countries.json');
const GEO_ISO_FILE = path.join(OUT_DIR, 'geo-iso.json');
const REPORT_FILE = fromEnv('BUILD_REPORT_FILE', path.join(ROOT, 'data', 'build-report.json'));

// ---------------------------------------------------------------------------
// Source configuration
// ---------------------------------------------------------------------------

const SOURCES = {
  wellbeing: {
    label: 'World Happiness Report — Data for Figure 2.1',
    // The "Data Sharing" page on worldhappiness.report distributes this file.
    // The URL changes with every edition: if the download fails, fetch it by
    // hand and save it under one of the names below in data/sources/.
    url: 'https://happiness-report.s3.amazonaws.com/2025/Data+for+Figure+2.1+(2025).xlsx',
    file: 'whr-figure-2.1.xlsx',
    // Il file scaricato ha il primo nome; gli altri servono a chi compila la
    // tabella a mano partendo da data/templates/.
    accepts: ['whr-figure-2.1.xlsx', 'whr-figure-2.1.csv', 'wellbeing.csv', 'wellbeing.xlsx'],
    page: 'https://worldhappiness.report/data-sharing/',
    edition: 2025,
    years: '2022-2024',
  },
  suicide: {
    label: 'WHO Global Health Estimates — age-standardised suicide rate',
    url: 'https://ourworldindata.org/grapher/death-rate-from-suicides-gho.csv?v=1&csvType=full&useColumnShortNames=false',
    file: 'who-suicide-rate.csv',
    accepts: ['who-suicide-rate.csv', 'who-suicide-rate.xlsx', 'suicide.csv', 'suicide.xlsx'],
    page: 'https://ourworldindata.org/grapher/death-rate-from-suicides-gho',
    source: 'WHO GHE 2021',
  },
};

const DEFAULT_WEIGHT = 0.25;

/** A readable path: relative to the project root when it sits inside it. */
function rel(p) {
  const r = path.relative(ROOT, p);
  return r.startsWith('..') ? p : r;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { refresh: false, offline: false, weight: DEFAULT_WEIGHT };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--refresh') args.refresh = true;
    else if (a === '--offline') args.offline = true;
    else if (a === '--weight') {
      const raw = argv[i + 1];
      i += 1;
      const w = Number(raw);
      if (!Number.isFinite(w) || w < 0 || w > 1) {
        fail(`--weight needs a number between 0 and 1, got: ${raw}`);
      }
      args.weight = w;
    } else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      fail(`Unrecognised argument: ${a}`);
    }
  }
  return args;
}

function fail(message, detail) {
  console.error(`\n✗ ${message}`);
  if (detail) console.error(detail);
  console.error('');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Loading the sources (local copy, otherwise download)
// ---------------------------------------------------------------------------

async function ensureSource(key, { refresh, offline }) {
  const src = SOURCES[key];
  const dest = path.join(SOURCES_DIR, src.file);

  const present = (src.accepts ?? [src.file])
    .map((n) => path.join(SOURCES_DIR, n))
    .find((p) => fs.existsSync(p));

  if (present && !refresh) return present;

  if (offline) {
    fail(
      `No local copy of: ${src.label}`,
      [
        `  expected in ${rel(SOURCES_DIR)}, under one of these names:`,
        ...(src.accepts ?? [src.file]).map((n) => `    ${n}`),
        '',
        `  download it from: ${src.page}`,
        '  or fill in the table in data/templates/ (npm run templates)',
        '  (--offline mode: no automatic download)',
      ].join('\n'),
    );
  }

  process.stdout.write(`  ↓ ${src.label}\n    ${src.url}\n`);
  let res;
  try {
    res = await fetch(src.url, { redirect: 'follow' });
  } catch (err) {
    fail(
      `Download failed: ${src.label}`,
      [
        `  ${err.message}`,
        '',
        '  The host is unreachable from this network. Download the file by hand from:',
        `    ${src.page}`,
        `  and save it as: ${rel(dest)}`,
        '  then run again with: npm run build:data -- --offline',
      ].join('\n'),
    );
  }
  if (!res.ok) {
    fail(
      `Download failed: ${src.label} (HTTP ${res.status})`,
      [
        `  ${src.url}`,
        '',
        '  The URL changes with every edition, and some networks block these hosts.',
        '  Download the file by hand from:',
        `    ${src.page}`,
        `  and save it as: ${rel(dest)}`,
        '  then run again with: npm run build:data -- --offline',
      ].join('\n'),
    );
  }
  fs.mkdirSync(SOURCES_DIR, { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// ---------------------------------------------------------------------------
// CSV parser (RFC 4180: quotes, commas and newlines inside fields)
// ---------------------------------------------------------------------------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

// ---------------------------------------------------------------------------
// Source 1: wellbeing (WHR)
// ---------------------------------------------------------------------------

/** Reduces an ExcelJS cell to text: formulas, rich text and hyperlinks included. */
function cellText(v) {
  if (v == null) return v;
  if (typeof v !== 'object') return v;
  if ('result' in v) return v.result;
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return v.text;
  return v;
}

/** Finds the Cantril score column, whose header changes between editions. */
function findWellbeingColumns(header) {
  const norm = header.map((h) => normalizeName(h ?? ''));
  // WHR spellings (which change between editions) plus the ones used by
  // data/templates/.
  const countryIdx = norm.findIndex(
    (h) => h === 'country name' || h === 'country' || h === 'country or region' || h === 'name',
  );
  const scoreIdx = norm.findIndex(
    (h) =>
      h === 'ladder score' ||
      h === 'happiness score' ||
      h === 'score' ||
      h === 'life ladder' ||
      h === 'wellbeing' ||
      h === 'cantril' ||
      h.startsWith('ladder score'),
  );
  const iso3Idx = norm.findIndex((h) => h === 'iso3' || h === 'code' || h === 'iso');
  return { countryIdx, scoreIdx, iso3Idx, header };
}

/** Reads a CSV or an xlsx as raw rows. Both sources go through here. */
async function readTable(file, label) {
  const ext = path.extname(file).toLowerCase();

  if (ext === '.csv' || ext === '.tsv') {
    return parseCsv(fs.readFileSync(file, 'utf8'));
  }
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    if (!ws) fail(`The file ${rel(file)} contains no sheets.`);
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const values = [];
      for (let c = 1; c <= ws.columnCount; c += 1) values.push(cellText(r.getCell(c).value));
      rows.push(values);
    });
    return rows;
  }
  return fail(
    `Unsupported format for the ${label} source: ${ext || '(no extension)'}`,
    '  Accepted: .xlsx, .csv. An old .xls has to be re-exported as .xlsx or .csv.',
  );
}

async function readWellbeing(file) {
  const rows = await readTable(file, 'wellbeing');
  if (!rows.length) fail(`The wellbeing source is empty: ${rel(file)}`);

  // Some editions put a title or a blank row above the headers, so the header
  // row is searched for rather than assumed to be the first.
  let headerRow = -1;
  let countryIdx = -1;
  let scoreIdx = -1;
  let iso3Idx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const found = findWellbeingColumns(rows[i].map((v) => (v == null ? '' : String(v))));
    // Code plus score is enough: the country name becomes optional once the
    // table already carries the ISO3.
    if (found.scoreIdx !== -1 && (found.countryIdx !== -1 || found.iso3Idx !== -1)) {
      headerRow = i;
      countryIdx = found.countryIdx;
      scoreIdx = found.scoreIdx;
      iso3Idx = found.iso3Idx;
      break;
    }
  }
  if (headerRow === -1) {
    fail(
      'Cannot find the columns in the wellbeing source.',
      [
        `  file: ${rel(file)}`,
        `  first row: ${rows[0].filter(Boolean).join(' | ')}`,
        '  it needs a score column (e.g. "Ladder score" or "wellbeing") and one',
        '  identifying the country: the ISO3 code ("iso3" or "Code"), or the',
        '  name ("Country name" or "country").',
        '  Generate a ready-made template with: npm run templates',
      ].join('\n'),
    );
  }

  const out = [];
  const rejected = [];
  for (const [n, r] of rows.slice(headerRow + 1).entries()) {
    const line = headerRow + n + 2; // the row number as a spreadsheet shows it
    const name = countryIdx === -1 || r[countryIdx] == null ? '' : String(r[countryIdx]).trim();
    const iso3 = iso3Idx === -1 || r[iso3Idx] == null ? '' : String(r[iso3Idx]).trim().toUpperCase();
    const grezzo = r[scoreIdx];
    if (!name && !iso3) continue;

    // An empty cell means a country with no figure, which is fine. A filled
    // cell that is not a number is a mistake in the table, and gets reported
    // rather than skipped.
    const blank = grezzo == null || String(grezzo).trim() === '';
    if (blank) continue;
    const score = Number(String(grezzo).replace(',', '.'));
    if (!Number.isFinite(score)) {
      rejected.push(`row ${line}: "${iso3 || name}" has score "${grezzo}", which is not a number`);
      continue;
    }
    if (score < 0 || score > 10) {
      rejected.push(`row ${line}: "${iso3 || name}" has score ${score}, outside the 0–10 scale`);
      continue;
    }
    out.push({ name, iso3, score });
  }

  if (rejected.length) {
    fail(
      `Invalid values in the wellbeing source: ${rel(file)}`,
      `${rejected.map((r) => `    - ${r}`).join('\n')}\n\n  Leave the cell empty when there is no figure; an unreadable value is reported, not ignored.`,
    );
  }
  if (!out.length) fail(`No valid rows in the wellbeing source: ${rel(file)}`);
  return out;
}

// ---------------------------------------------------------------------------
// Source 2: suicide mortality (WHO GHE via Our World in Data)
// ---------------------------------------------------------------------------

async function readSuicide(file) {
  const rows = await readTable(file, 'suicide');
  if (!rows.length) fail(`The suicide source is empty: ${rel(file)}`);

  const header = rows[0].map((h) => (h == null ? '' : String(h).trim()));
  const find = (...names) => header.findIndex((h) => names.includes(normalizeName(h)));
  const entityIdx = find('entity', 'country', 'name');
  const codeIdx = find('code', 'iso3', 'iso');
  const yearIdx = find('year');

  // The value column: looked up by name first, because that is the only safe
  // way. Only when that fails does it fall back to the LAST unrecognised column
  // — the OWID export puts the value there, under a very long header that
  // changes between versions. "The first unrecognised" would be wrong: a table
  // with two name columns would pick up a name.
  const NOT_VALUE = new Set([
    'entity', 'country', 'name', 'country name', 'code', 'iso3', 'iso', 'year',
  ]);
  let valueIdx = find('rate', 'value', 'suicide rate');
  if (valueIdx === -1) {
    for (let i = header.length - 1; i >= 0; i -= 1) {
      if (i === entityIdx || i === codeIdx || i === yearIdx) continue;
      if (NOT_VALUE.has(normalizeName(header[i]))) continue;
      valueIdx = i;
      break;
    }
  }

  // Entity and Year are optional: a hand-filled table may carry only the code
  // and the value. Code and value are always required.
  if (codeIdx === -1 || valueIdx === -1) {
    fail(
      'Unexpected headers in the suicide source.',
      [
        `  file: ${rel(file)}`,
        `  found: ${header.join(' | ')}`,
        '  it needs at least a column of ISO3 codes (Code / iso3) and one of values.',
        '  Entity and Year are optional.',
      ].join('\n'),
    );
  }

  const byIso = new Map();
  let aggregatesDropped = 0;
  let latestYear = -Infinity;

  const rejected = [];
  for (const [n, r] of rows.slice(1).entries()) {
    const line = n + 2;
    const code = String(r[codeIdx] ?? '').trim().toUpperCase();
    // With no Year column every row belongs to the same, unknown year.
    const year = yearIdx === -1 ? 0 : Number(r[yearIdx]);
    const grezzo = r[valueIdx];
    // An empty code means a regional aggregate ("World", "Europe", income groups).
    if (!code) {
      aggregatesDropped += 1;
      continue;
    }
    if (!/^[A-Z]{3}$/.test(code)) {
      // OWID uses pseudo-codes such as OWID_WRL for aggregates.
      aggregatesDropped += 1;
      continue;
    }
    const blank = grezzo == null || String(grezzo).trim() === '';
    if (blank) continue;
    const rate = Number(String(grezzo).replace(',', '.'));
    if (!Number.isFinite(rate)) {
      rejected.push(`row ${line}: "${code}" has rate "${grezzo}", which is not a number`);
      continue;
    }
    if (rate < 0 || rate > 200) {
      rejected.push(`row ${line}: "${code}" has rate ${rate} per 100,000, outside any plausible range`);
      continue;
    }
    if (!Number.isFinite(year)) continue;
    if (year > latestYear) latestYear = year;
    const prev = byIso.get(code);
    if (!prev || year > prev.year) byIso.set(code, { iso3: code, entity: String(r[entityIdx] ?? '').trim(), year, rate });
  }

  if (rejected.length) {
    fail(
      `Invalid values in the suicide source: ${rel(file)}`,
      `${rejected.map((r) => `    - ${r}`).join('\n')}\n\n  Leave the cell empty when there is no figure.`,
    );
  }

  if (!byIso.size) fail(`No valid rows in the suicide source: ${rel(file)}`);

  // Only the most recent year available is kept, the same for everyone: mixing
  // years would make the countries not comparable with each other.
  const kept = new Map();
  const staleYear = [];
  for (const [iso3, rec] of byIso) {
    if (rec.year === latestYear) kept.set(iso3, rec);
    else staleYear.push({ iso3, name: rec.entity, year: rec.year });
  }

  // With no Year column there is no year to declare: null is better than a
  // zero, which would end up in the site metadata looking like a date.
  const year = yearIdx === -1 ? null : latestYear;
  return { byIso: kept, year, aggregatesDropped, staleYear };
}

// ---------------------------------------------------------------------------
// Resolving WHR names onto ISO3
// ---------------------------------------------------------------------------

const NORMALIZED_OVERRIDES = new Map(
  Object.entries(WHR_NAME_TO_ISO3).map(([name, iso3]) => [normalizeName(name), iso3]),
);
const NORMALIZED_SKIP = new Set([...INTENTIONALLY_UNMAPPED].map(normalizeName));

function resolveIso3(whrName) {
  const key = normalizeName(whrName);
  if (NORMALIZED_OVERRIDES.has(key)) {
    return { iso3: NORMALIZED_OVERRIDES.get(key), via: 'lookup table' };
  }
  // Names that match the ISO English denomination resolve by themselves.
  const auto = countries.getAlpha3Code(whrName, 'en');
  if (auto) return { iso3: auto, via: 'ISO name' };
  return { iso3: undefined, via: null };
}

// ---------------------------------------------------------------------------
// Statistics: percentiles
// ---------------------------------------------------------------------------

/**
 * Two values built from different percentiles can be mathematically equal and
 * still differ in the last bit: 0.75*83.33 + 0.25*33.33 and 0.75*66.67 +
 * 0.25*83.33 both come to 70.8333..., but not in IEEE 754. Without a tolerance,
 * a tie turns into an ordering invented by the arithmetic.
 */
const EPS = 1e-9;
const sameValue = (a, b) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Rank percentile over the given sample: 100 is the highest value, 0 the lowest.
 * Ties take the average rank, so two identical countries get the same
 * percentile. With a single element the percentile is 50 (there is no scale).
 *
 * Percentiles rather than min-max, because min-max is crushed by outliers: one
 * country far above the mean would squeeze all the others into a very narrow
 * band and make the map unreadable.
 */
export function percentileRanks(values) {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [50];

  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sameValue(order[j + 1].v, order[i].v)) j += 1;
    const avgRank = (i + j) / 2; // zero-based average rank among the tied
    const pct = (avgRank / (n - 1)) * 100;
    for (let k = i; k <= j; k += 1) out[order[k].i] = pct;
    i = j + 1;
  }
  return out;
}

/** Ranks 1..n from highest value to lowest; ties share a rank. */
export function competitionRanks(values) {
  const n = values.length;
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const out = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sameValue(order[j + 1].v, order[i].v)) j += 1;
    for (let k = i; k <= j; k += 1) out[order[k].i] = i + 1;
    i = j + 1;
  }
  return out;
}

const round = (x, digits) => Number(x.toFixed(digits));

// ---------------------------------------------------------------------------
// Geometry: which countries the map is able to draw
// ---------------------------------------------------------------------------

export function readGeometryIso3() {
  if (!fs.existsSync(GEO_FILE)) {
    fail(
      `The geometry file is missing: ${rel(GEO_FILE)}`,
      '  Copy it from node_modules/world-atlas/countries-110m.json',
    );
  }
  const topo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
  const geometries = topo?.objects?.countries?.geometries;
  if (!Array.isArray(geometries)) {
    fail(`Unexpected structure in ${rel(GEO_FILE)}: objects.countries.geometries is missing`);
  }

  const byId = {};
  const byName = {};
  const unmapped = [];

  for (const f of geometries) {
    const name = f.properties?.name ?? '(unnamed)';
    if (f.id === undefined || f.id === null || String(f.id) === '-99') {
      const iso3 = GEO_NAME_TO_ISO3[name];
      if (iso3) byName[name] = iso3;
      else unmapped.push(name);
      continue;
    }
    const iso3 = countries.numericToAlpha3(String(f.id));
    if (iso3) byId[String(f.id)] = iso3;
    else unmapped.push(`${name} (id ${f.id})`);
  }

  const drawable = new Set([...Object.values(byId), ...Object.values(byName)]);
  return { byId, byName, drawable, unmapped, featureCount: geometries.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const w = args.weight;

  console.log('\nSources');
  const wellbeingFile = await ensureSource('wellbeing', args);
  const suicideFile = await ensureSource('suicide', args);
  console.log(`  ✓ wellbeing: ${path.relative(ROOT, wellbeingFile)}`);
  console.log(`  ✓ suicide:   ${path.relative(ROOT, suicideFile)}`);

  const wellbeingRows = await readWellbeing(wellbeingFile);
  const suicide = await readSuicide(suicideFile);
  const geo = readGeometryIso3();

  // --- Join: WHR names -> ISO3 --------------------------------------------
  const unresolved = [];
  const skipped = [];
  const duplicates = [];
  const joinMap = [];
  const wellbeingByIso = new Map();

  for (const row of wellbeingRows) {
    if (row.name && NORMALIZED_SKIP.has(normalizeName(row.name))) {
      skipped.push(row.name);
      continue;
    }

    // An ISO3 written in the table beats any name lookup: it is explicit, and
    // it removes the spelling problem entirely.
    let iso3;
    let via;
    if (row.iso3) {
      if (!/^[A-Z]{3}$/.test(row.iso3)) {
        unresolved.push(`${row.iso3} (malformed code${row.name ? `, row "${row.name}"` : ''})`);
        continue;
      }
      iso3 = row.iso3;
      via = 'code in the table';
    } else {
      ({ iso3, via } = resolveIso3(row.name));
      if (!iso3) {
        unresolved.push(row.name);
        continue;
      }
    }
    joinMap.push({ whrName: row.name || iso3, iso3, via });
    if (wellbeingByIso.has(iso3)) {
      duplicates.push(`${row.name || iso3} -> ${iso3} (already taken by "${wellbeingByIso.get(iso3).name || iso3}")`);
      continue;
    }
    wellbeingByIso.set(iso3, { ...row, iso3 });
  }

  // Loud failure: an unresolved name means a country silently lost.
  if (unresolved.length || duplicates.length) {
    const lines = [];
    if (unresolved.length) {
      lines.push('  WHR names with no ISO3 match:');
      for (const n of unresolved) lines.push(`    - ${JSON.stringify(n)}`);
      lines.push('');
      lines.push('  Add them to src/iso-lookup.js (use null when the entity has no ISO code).');
    }
    if (duplicates.length) {
      if (lines.length) lines.push('');
      lines.push('  Two WHR names resolved onto the same ISO3:');
      for (const d of duplicates) lines.push(`    - ${d}`);
    }
    fail('WHR -> ISO3 join incomplete.', lines.join('\n'));
  }

  // --- The sample with complete data ---------------------------------------
  const complete = [];
  const missingSuicide = [];

  for (const [iso3, rec] of wellbeingByIso) {
    const s = suicide.byIso.get(iso3);
    if (!s) {
      missingSuicide.push({ iso3, name: rec.name });
      continue;
    }
    complete.push({ iso3, whrName: rec.name, whr: rec.score, suicide: s.rate });
  }

  const missingWellbeing = [];
  for (const [iso3, rec] of suicide.byIso) {
    if (!wellbeingByIso.has(iso3)) missingWellbeing.push({ iso3, name: rec.entity });
  }

  if (complete.length < 2) {
    fail(`Only ${complete.length} countries have complete data: percentiles cannot be computed.`);
  }

  // --- The value -----------------------------------------------------------
  const pWellbeing = percentileRanks(complete.map((c) => c.whr));
  // The minus sign flips the scale: a lower rate yields a higher percentile.
  const pSuicide = percentileRanks(complete.map((c) => -c.suicide));

  complete.forEach((c, i) => {
    c.pWellbeing = pWellbeing[i];
    c.pSuicide = pSuicide[i];
    c.index = (1 - w) * pWellbeing[i] + w * pSuicide[i];
  });

  const ranks = competitionRanks(complete.map((c) => c.index));
  const ranksWhr = competitionRanks(complete.map((c) => c.whr));
  complete.forEach((c, i) => {
    c.rank = ranks[i];
    c.rankWhr = ranksWhr[i];
    // Positive means the country rises once suicides are counted.
    c.rankDelta = ranksWhr[i] - ranks[i];
  });

  // --- Output --------------------------------------------------------------
  const out = { meta: {}, countries: {} };
  for (const c of [...complete].sort((a, b) => a.rank - b.rank)) {
    out.countries[c.iso3] = {
      name: countries.getName(c.iso3, 'en') ?? c.whrName,
      index: round(c.index, 1),
      whr: round(c.whr, 2),
      suicide: round(c.suicide, 1),
      rank: c.rank,
      rankWhr: c.rankWhr,
      rankDelta: c.rankDelta,
    };
  }

  const withoutGeometry = complete.filter((c) => !geo.drawable.has(c.iso3)).map((c) => c.iso3);

  out.meta = {
    weight: w,
    whrEdition: SOURCES.wellbeing.edition,
    whrYears: SOURCES.wellbeing.years,
    suicideSource: SOURCES.suicide.source,
    suicideYear: suicide.year,
    generated: new Date().toISOString().slice(0, 10),
    countriesWithData: complete.length,
    note:
      'Composite value: percentiles of wellbeing and of suicide mortality, ' +
      'computed within the sample of countries that have both figures.',
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
  fs.writeFileSync(
    GEO_ISO_FILE,
    `${JSON.stringify({ byId: geo.byId, byName: geo.byName }, null, 2)}\n`,
  );

  const report = {
    generated: out.meta.generated,
    weight: w,
    suicideYear: suicide.year,
    whrRows: wellbeingRows.length,
    countriesWithData: complete.length,
    wellbeingOnly: missingSuicide.sort((a, b) => a.iso3.localeCompare(b.iso3)),
    suicideOnly: missingWellbeing.sort((a, b) => a.iso3.localeCompare(b.iso3)),
    skippedNoIsoCode: skipped,
    withDataWithoutGeometry: withoutGeometry,
    geometryFeatures: geo.featureCount,
    geometryWithoutIso3: geo.unmapped,
    suicideAggregateRowsDropped: suicide.aggregatesDropped,
    suicideOlderYearOnly: suicide.staleYear.sort((a, b) => a.iso3.localeCompare(b.iso3)),
    // The join in full: for checking by hand that no name landed on the wrong
    // country. "lookup table" means resolved through src/iso-lookup.js.
    join: joinMap.sort((a, b) => a.iso3.localeCompare(b.iso3)),
  };
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

  printReport({ report, complete, suicide, geo, w });
}

function printReport({ report, complete, suicide, geo, w }) {
  const line = (label, value) => console.log(`  ${label.padEnd(34)} ${value}`);

  console.log('\nCoverage');
  line('rows in the WHR source', report.whrRows);
  line(
    'countries in the WHO source',
    suicide.byIso.size + (suicide.year ? ` (year ${suicide.year})` : ' (year not declared)'),
  );
  line('countries with complete data', report.countriesWithData);
  line('wellbeing only (no WHO figure)', report.wellbeingOnly.length);
  line('suicide only (not in the WHR)', report.suicideOnly.length);
  line('entities with no ISO code', report.skippedNoIsoCode.length);

  const count = (via) => report.join.filter((j) => j.via === via).length;
  console.log('\nJoin');
  line('ISO3 code already in the table', count('code in the table'));
  line('resolved via src/iso-lookup.js', count('lookup table'));
  line('resolved via the ISO name', count('ISO name'));
  line('aggregate rows dropped', report.suicideAggregateRowsDropped);
  line('WHO figures only for older years', report.suicideOlderYearOnly.length);

  console.log('\nMap');
  line('features in the TopoJSON', geo.featureCount);
  line('features with no ISO3', geo.unmapped.length);
  line('have data but cannot be drawn', report.withDataWithoutGeometry.length);

  const show = (title, items, fmt) => {
    if (!items.length) return;
    console.log(`\n${title} (${items.length})`);
    console.log(`  ${items.map(fmt).join(', ')}`);
  };

  show('Wellbeing but no WHO figure', report.wellbeingOnly, (c) => `${c.iso3} ${c.name}`);
  show('WHO figure but not in the WHR', report.suicideOnly, (c) => `${c.iso3} ${c.name}`);
  show(
    `Dropped: WHO figure older than ${report.suicideYear ?? 'the most recent year'}`,
    report.suicideOlderYearOnly,
    (c) => `${c.iso3} (${c.year})`,
  );
  show('Excluded: no ISO 3166-1 code', report.skippedNoIsoCode, (n) => n);
  show(
    'Have data but are absent from the 1:110m geometry',
    report.withDataWithoutGeometry.map((iso3) => ({ iso3 })),
    (c) => c.iso3,
  );
  show('Features with no ISO3 (they stay blank)', geo.unmapped, (n) => n);

  const byValue = [...complete].sort((a, b) => a.rank - b.rank);
  const movers = [...complete]
    .sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta))
    .slice(0, 8);

  console.log(`\nTop 5 by happiness value (w = ${w})`);
  for (const c of byValue.slice(0, 5)) {
    console.log(
      `  ${String(c.rank).padStart(3)}. ${c.iso3}  value ${c.index.toFixed(1).padStart(5)}` +
        `   WHR ${c.whr.toFixed(2)} (pos. ${c.rankWhr})   suicide ${c.suicide.toFixed(1)}/100k`,
    );
  }

  console.log('\nLargest moves against the WHR ranking');
  for (const c of movers) {
    const sign = c.rankDelta > 0 ? '+' : '';
    console.log(
      `  ${c.iso3}  ${String(c.rankWhr).padStart(3)} -> ${String(c.rank).padStart(3)}` +
        `  (${sign}${c.rankDelta})   suicide ${c.suicide.toFixed(1)}/100k`,
    );
  }

  console.log(`\n✓ wrote public/data/countries.json (${report.countriesWithData} countries)`);
  console.log('✓ wrote public/data/geo-iso.json');
  console.log('✓ wrote data/build-report.json\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => fail('Unexpected error during the build.', `  ${err.stack || err.message}`));
}
