import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { percentileRanks, competitionRanks, parseCsv } from '../scripts/build-data.js';
import { writeWhrXlsx, writeSuicideCsv } from './make-fixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-data.js');

// --- statistics -------------------------------------------------------------

test('percentileRanks: the minimum is 0 and the maximum is 100', () => {
  assert.deepEqual(percentileRanks([5, 1, 3]), [100, 0, 50]);
});

test('percentileRanks: ties get the same percentile', () => {
  const p = percentileRanks([2, 2, 1, 4]);
  assert.equal(p[0], p[1]);
  assert.equal(p[2], 0);
  assert.equal(p[3], 100);
});

test('percentileRanks: degenerate cases', () => {
  assert.deepEqual(percentileRanks([]), []);
  assert.deepEqual(percentileRanks([7]), [50]);
  // All equal: nobody is better, everyone sits mid-scale.
  assert.deepEqual(percentileRanks([3, 3, 3]), [50, 50, 50]);
});

test('percentileRanks: negating the values flips the scale', () => {
  const rates = [4, 12, 28];
  assert.deepEqual(percentileRanks(rates.map((r) => -r)), [100, 50, 0]);
});

test('competitionRanks: 1 goes to the highest value, ties share a rank', () => {
  assert.deepEqual(competitionRanks([10, 30, 20]), [3, 1, 2]);
  assert.deepEqual(competitionRanks([5, 5, 1]), [1, 1, 3]);
});

test('a tie does not depend on floating-point noise', () => {
  // Two values equal on paper can differ in the last bit.
  const a = 70.83333333333333;
  const b = a + 1e-13;
  assert.notEqual(a, b, 'the case only means something if the floats differ');
  assert.deepEqual(competitionRanks([100, a, b, 10]), [1, 2, 2, 4]);
  assert.deepEqual(percentileRanks([10, a, b, 100]), [0, 50, 50, 100]);
});

test('a real difference is not swallowed by the tolerance', () => {
  // 0.05 of a point is visible in the published JSON: two ranks, not one.
  assert.deepEqual(competitionRanks([70.9, 70.85]), [1, 2]);
});

// --- CSV --------------------------------------------------------------------

test('parseCsv: commas and quotes inside fields', () => {
  const rows = parseCsv('a,"b,c",d\n1,"he said ""hi""",3\n');
  assert.deepEqual(rows[0], ['a', 'b,c', 'd']);
  assert.deepEqual(rows[1], ['1', 'he said "hi"', '3']);
});

test('parseCsv: a newline inside a quoted field, and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x\ny",2\r\n');
  assert.deepEqual(rows[1], ['x\ny', '2']);
});

// --- the whole pipeline -----------------------------------------------------

function runBuild(dir, extraArgs = []) {
  return execFileSync(process.execPath, [SCRIPT, '--offline', ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      BUILD_SOURCES_DIR: path.join(dir, 'sources'),
      BUILD_OUT_DIR: path.join(dir, 'out'),
      BUILD_REPORT_FILE: path.join(dir, 'report.json'),
    },
  });
}

async function scenario(whrRows, suicideRows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whr-test-'));
  await writeWhrXlsx(path.join(dir, 'sources', 'whr-figure-2.1.xlsx'), whrRows);
  writeSuicideCsv(path.join(dir, 'sources', 'who-suicide-rate.csv'), suicideRows);
  return dir;
}

const WHR_SAMPLE = [
  { name: 'Finland', whr: 7.74 },
  { name: 'Denmark', whr: 7.52 },
  { name: 'South Korea', whr: 6.04 },
  { name: 'Italy', whr: 6.32 },
  { name: 'Turkiye', whr: 4.72 },
  { name: 'Congo (Kinshasa)', whr: 4.02 },
  { name: 'Congo (Brazzaville)', whr: 5.22 },
  { name: 'North Cyprus', whr: 5.98 }, // no ISO code: excluded on purpose
];

const SUICIDE_SAMPLE = [
  { entity: 'Finland', code: 'FIN', rate: 15.3 },
  { entity: 'Denmark', code: 'DNK', rate: 9.4 },
  { entity: 'South Korea', code: 'KOR', rate: 28.6 },
  { entity: 'Italy', code: 'ITA', rate: 4.3 },
  { entity: 'Turkiye', code: 'TUR', rate: 2.6 },
  { entity: 'Democratic Republic of Congo', code: 'COD', rate: 6.4 },
  { entity: 'Congo', code: 'COG', rate: 5.1 },
  { entity: 'Brazil', code: 'BRA', rate: 6.9 }, // WHO only: not in the fake WHR
];

test('pipeline: joins the sources and writes the expected JSON', async () => {
  const dir = await scenario(WHR_SAMPLE, SUICIDE_SAMPLE);
  const stdout = runBuild(dir);

  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));
  assert.deepEqual(Object.keys(out.countries).sort(), [
    'COD', 'COG', 'DNK', 'FIN', 'ITA', 'KOR', 'TUR',
  ]);

  assert.equal(out.meta.countriesWithData, 7);
  assert.equal(out.meta.weight, 0.25);
  assert.equal(out.meta.suicideYear, 2021);

  // The two Congos must not be swapped: it is the easiest mistake to make.
  assert.equal(out.countries.COD.whr, 4.02);
  assert.equal(out.countries.COG.whr, 5.22);
  assert.equal(out.countries.COD.suicide, 6.4);
  assert.equal(out.countries.COG.suicide, 5.1);

  // Names come from the ISO code, not from how the WHR spells them.
  assert.equal(out.countries.ITA.name, 'Italy');
  assert.equal(out.countries.TUR.name, 'Türkiye');

  for (const c of Object.values(out.countries)) {
    for (const k of ['name', 'index', 'whr', 'suicide', 'rank', 'rankWhr', 'rankDelta']) {
      assert.ok(c[k] !== undefined, `${k} is missing`);
    }
    assert.ok(c.index >= 0 && c.index <= 100);
    assert.equal(c.rankDelta, c.rankWhr - c.rank);
  }

  // South Korea, the highest rate in the sample, loses places.
  assert.ok(out.countries.KOR.rank > out.countries.KOR.rankWhr);
  assert.equal(out.countries.KOR.rankDelta, -1);
  // Türkiye, the lowest rate, gains them.
  assert.ok(out.countries.TUR.rank < out.countries.TUR.rankWhr);

  // Mathematically equal values must share a rank: Denmark and Italy both come
  // to 70.83 and differ only in the last bit.
  assert.equal(out.countries.DNK.index, out.countries.ITA.index);
  assert.equal(out.countries.DNK.rank, out.countries.ITA.rank);
  // A shared rank consumes the next position.
  assert.equal(out.countries.COG.rank, out.countries.DNK.rank + 2);

  assert.match(stdout, /countries with complete data\s+7/);
  assert.match(stdout, /North Cyprus/);

  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  assert.deepEqual(report.suicideOnly.map((c) => c.iso3), ['BRA']);
  assert.deepEqual(report.skippedNoIsoCode, ['North Cyprus']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pipeline: at w = 0 the value reproduces the WHR ranking exactly', async () => {
  const dir = await scenario(WHR_SAMPLE, SUICIDE_SAMPLE);
  runBuild(dir, ['--weight', '0']);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));
  for (const [iso3, c] of Object.entries(out.countries)) {
    assert.equal(c.rank, c.rankWhr, `${iso3} moves at w = 0`);
    assert.equal(c.rankDelta, 0);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pipeline: an unmappable WHR name stops the build', async () => {
  const dir = await scenario([...WHR_SAMPLE, { name: 'Freedonia', whr: 5.0 }], SUICIDE_SAMPLE);
  assert.throws(
    () => runBuild(dir),
    (err) => {
      assert.equal(err.status, 1);
      const text = String(err.stderr);
      assert.match(text, /WHR -> ISO3 join incomplete/);
      assert.match(text, /"Freedonia"/);
      assert.match(text, /src\/iso-lookup\.js/);
      return true;
    },
  );
  // Nothing is written when the join is broken.
  assert.equal(fs.existsSync(path.join(dir, 'out', 'countries.json')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pipeline: two WHR names on the same ISO3 stop the build', async () => {
  const dir = await scenario(
    [...WHR_SAMPLE, { name: 'Turkey', whr: 4.7 }], // same country, older spelling
    SUICIDE_SAMPLE,
  );
  assert.throws(
    () => runBuild(dir),
    (err) => {
      assert.match(String(err.stderr), /same ISO3/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pipeline: --offline does not download and names the missing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whr-test-'));
  assert.throws(
    () => runBuild(dir),
    (err) => {
      assert.match(String(err.stderr), /No local copy of/);
      assert.match(String(err.stderr), /worldhappiness\.report/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- geometry ---------------------------------------------------------------

test('geo-iso.json covers the geometry, Kosovo included by name', async () => {
  const dir = await scenario(WHR_SAMPLE, SUICIDE_SAMPLE);
  runBuild(dir);
  const geo = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'geo-iso.json'), 'utf8'));
  assert.equal(geo.byId['380'], 'ITA');
  assert.equal(geo.byId['246'], 'FIN');
  assert.equal(geo.byName.Kosovo, 'XKX');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('xlsx: the headers are found even under a title row', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whr-test-'));
  await writeWhrXlsx(path.join(dir, 'sources', 'whr-figure-2.1.xlsx'), WHR_SAMPLE, {
    leadingRows: 2,
  });
  writeSuicideCsv(path.join(dir, 'sources', 'who-suicide-rate.csv'), SUICIDE_SAMPLE);
  runBuild(dir);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));
  assert.equal(out.meta.countriesWithData, 7);
  assert.equal(out.countries.ITA.whr, 6.32);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- hand-filled tables (the offline route) ---------------------------------

function writeCsv(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

async function csvScenario(wellbeingCsv, suicideCsv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whr-test-'));
  writeCsv(path.join(dir, 'sources', 'wellbeing.csv'), wellbeingCsv);
  writeCsv(path.join(dir, 'sources', 'suicide.csv'), suicideCsv);
  return dir;
}

const WELLBEING_CSV = `iso3,country,wellbeing
FIN,Finland,7.74
DNK,Denmark,7.52
ITA,Italy,6.32
KOR,South Korea,6.04
TUR,Türkiye,4.72
COD,Democratic Republic of the Congo,4.02
COG,Republic of the Congo,5.22
NOR,Norway,
`;

const SUICIDE_CSV = `iso3,country,rate
FIN,Finland,15.3
DNK,Denmark,9.4
ITA,Italy,4.3
KOR,South Korea,28.6
TUR,Türkiye,2.6
COD,Democratic Republic of the Congo,6.4
COG,Republic of the Congo,5.1
NOR,Norway,11.2
`;

test('offline: two tables with ISO3 join without going through names', async () => {
  const dir = await csvScenario(WELLBEING_CSV, SUICIDE_CSV);
  runBuild(dir);

  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));
  assert.deepEqual(Object.keys(out.countries).sort(), [
    'COD', 'COG', 'DNK', 'FIN', 'ITA', 'KOR', 'TUR',
  ]);
  // Norway has the rate but an empty wellbeing cell: it stays out.
  assert.equal(out.countries.NOR, undefined);
  assert.equal(out.countries.COD.whr, 4.02);
  assert.equal(out.countries.COG.whr, 5.22);

  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  // No name went through the lookup table: the code was enough.
  assert.ok(report.join.every((j) => j.via === 'code in the table'));
  assert.deepEqual(report.suicideOnly.map((c) => c.iso3), ['NOR']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline: a non-numeric cell stops the build and names the row', async () => {
  const broken = WELLBEING_CSV.replace('ITA,Italy,6.32', 'ITA,Italy,six point three');
  const dir = await csvScenario(broken, SUICIDE_CSV);
  assert.throws(
    () => runBuild(dir),
    (err) => {
      const t = String(err.stderr);
      assert.match(t, /Invalid values in the wellbeing source/);
      assert.match(t, /row 4/);
      assert.match(t, /ITA/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline: a score outside the 0-10 scale stops the build', async () => {
  const broken = WELLBEING_CSV.replace('ITA,Italy,6.32', 'ITA,Italy,63.2');
  const dir = await csvScenario(broken, SUICIDE_CSV);
  assert.throws(
    () => runBuild(dir),
    (err) => {
      assert.match(String(err.stderr), /outside the 0–10 scale/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline: an implausible suicide rate stops the build', async () => {
  const broken = SUICIDE_CSV.replace('ITA,Italy,4.3', 'ITA,Italy,430');
  const dir = await csvScenario(WELLBEING_CSV, broken);
  assert.throws(
    () => runBuild(dir),
    (err) => {
      assert.match(String(err.stderr), /outside any plausible range/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline: a comma decimal separator is accepted', async () => {
  const commas = WELLBEING_CSV.replace('ITA,Italy,6.32', 'ITA,Italy,"6,32"');
  const dir = await csvScenario(commas, SUICIDE_CSV);
  runBuild(dir);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));
  assert.equal(out.countries.ITA.whr, 6.32);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline: a malformed ISO3 code stops the build', async () => {
  const broken = WELLBEING_CSV.replace('ITA,Italy,6.32', 'ITALY,Italy,6.32');
  const dir = await csvScenario(broken, SUICIDE_CSV);
  assert.throws(
    () => runBuild(dir),
    (err) => {
      const t = String(err.stderr);
      assert.match(t, /WHR -> ISO3 join incomplete/);
      assert.match(t, /malformed code/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the generated tables are fillable as they are', async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-templates.js')], { cwd: ROOT });
  const csv = fs.readFileSync(path.join(ROOT, 'data', 'templates', 'wellbeing.csv'), 'utf8');
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], ['iso3', 'country', 'wellbeing']);
  assert.ok(rows.length > 150, 'every drawable country should be there');
  for (const r of rows.slice(1)) {
    assert.match(r[0], /^[A-Z]{3}$/);
    assert.equal(r[2], '');
  }
  assert.ok(rows.some((r) => r[0] === 'ITA' && r[1] === 'Italy'));
  assert.ok(!rows.some((r) => r[0] === 'ATA'), 'Antarctica is off the map and off the tables');
});

test('offline: the generated tables, filled in, make it all the way to the JSON', async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-templates.js')], { cwd: ROOT });

  // Filled in the way a person would: some cells left empty.
  const fill = (name, base) => {
    const rows = parseCsv(fs.readFileSync(path.join(ROOT, 'data', 'templates', name), 'utf8'));
    const out = [rows[0].join(',')];
    rows.slice(1).forEach((r, i) => {
      r[2] = i % 5 === 0 ? '' : String(base + (i % 17) * 0.13);
      out.push(r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','));
    });
    return `${out.join('\n')}\n`;
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whr-test-'));
  writeCsv(path.join(dir, 'sources', 'wellbeing.csv'), fill('wellbeing.csv', 4));
  writeCsv(path.join(dir, 'sources', 'suicide.csv'), fill('suicide.csv', 6));

  const stdout = runBuild(dir);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));

  assert.ok(out.meta.countriesWithData > 100);
  // With no Year column there is no year to declare: null, not zero.
  assert.equal(out.meta.suicideYear, null);

  for (const c of Object.values(out.countries)) {
    assert.equal(typeof c.suicide, 'number');
    assert.ok(c.whr >= 0 && c.whr <= 10, `wellbeing out of scale: ${c.whr}`);
  }

  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  assert.ok(report.join.every((j) => j.via === 'code in the table'));
  assert.match(stdout, /ISO3 code already in the table/);
  fs.rmSync(dir, { recursive: true, force: true });
});
