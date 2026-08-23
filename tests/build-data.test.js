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

// --- statistica -------------------------------------------------------------

test('percentileRanks: il minimo vale 0 e il massimo 100', () => {
  assert.deepEqual(percentileRanks([5, 1, 3]), [100, 0, 50]);
});

test('percentileRanks: i pari merito ricevono lo stesso percentile', () => {
  const p = percentileRanks([2, 2, 1, 4]);
  assert.equal(p[0], p[1]);
  assert.equal(p[2], 0);
  assert.equal(p[3], 100);
});

test('percentileRanks: casi degeneri', () => {
  assert.deepEqual(percentileRanks([]), []);
  assert.deepEqual(percentileRanks([7]), [50]);
  // Tutti uguali: nessuno e' migliore, tutti a meta' scala.
  assert.deepEqual(percentileRanks([3, 3, 3]), [50, 50, 50]);
});

test('percentileRanks: negare i valori inverte la scala', () => {
  const rates = [4, 12, 28];
  assert.deepEqual(percentileRanks(rates.map((r) => -r)), [100, 50, 0]);
});

test('competitionRanks: 1 al valore piu alto, pari merito condiviso', () => {
  assert.deepEqual(competitionRanks([10, 30, 20]), [3, 1, 2]);
  assert.deepEqual(competitionRanks([5, 5, 1]), [1, 1, 3]);
});

// --- CSV --------------------------------------------------------------------

test('parseCsv: virgole e virgolette dentro i campi', () => {
  const rows = parseCsv('a,"b,c",d\n1,"he said ""hi""",3\n');
  assert.deepEqual(rows[0], ['a', 'b,c', 'd']);
  assert.deepEqual(rows[1], ['1', 'he said "hi"', '3']);
});

test('parseCsv: a capo dentro un campo quotato e CRLF', () => {
  const rows = parseCsv('a,b\r\n"x\ny",2\r\n');
  assert.deepEqual(rows[1], ['x\ny', '2']);
});

// --- pipeline completa ------------------------------------------------------

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
  { name: 'North Cyprus', whr: 5.98 }, // senza codice ISO: escluso di proposito
];

const SUICIDE_SAMPLE = [
  { entity: 'Finland', code: 'FIN', rate: 15.3 },
  { entity: 'Denmark', code: 'DNK', rate: 9.4 },
  { entity: 'South Korea', code: 'KOR', rate: 28.6 },
  { entity: 'Italy', code: 'ITA', rate: 4.3 },
  { entity: 'Turkiye', code: 'TUR', rate: 2.6 },
  { entity: 'Democratic Republic of Congo', code: 'COD', rate: 6.4 },
  { entity: 'Congo', code: 'COG', rate: 5.1 },
  { entity: 'Brazil', code: 'BRA', rate: 6.9 }, // solo OMS: non e' nel WHR finto
];

test('pipeline: unisce le fonti e scrive il JSON atteso', async () => {
  const dir = await scenario(WHR_SAMPLE, SUICIDE_SAMPLE);
  const stdout = runBuild(dir);

  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));
  const isos = Object.keys(out.countries).sort();
  assert.deepEqual(isos, ['COD', 'COG', 'DNK', 'FIN', 'ITA', 'KOR', 'TUR']);

  assert.equal(out.meta.countriesWithData, 7);
  assert.equal(out.meta.weight, 0.25);
  assert.equal(out.meta.suicideYear, 2021);

  // I due Congo non vanno invertiti: e' l'errore piu' facile da commettere.
  assert.equal(out.countries.COD.whr, 4.02);
  assert.equal(out.countries.COG.whr, 5.22);
  assert.equal(out.countries.COD.suicide, 6.4);
  assert.equal(out.countries.COG.suicide, 5.1);

  // Nomi in italiano dal codice ISO, non dalla grafia WHR.
  assert.equal(out.countries.ITA.name, 'Italia');
  assert.equal(out.countries.TUR.name, 'Turchia');

  // Ogni paese ha tutto quello che serve ai due livelli del pannello.
  for (const c of Object.values(out.countries)) {
    for (const k of ['name', 'index', 'whr', 'suicide', 'rank', 'rankWhr', 'rankDelta']) {
      assert.ok(c[k] !== undefined, `manca ${k}`);
    }
    assert.ok(c.index >= 0 && c.index <= 100);
    assert.equal(c.rankDelta, c.rankWhr - c.rank);
  }

  // La Corea del Sud, col tasso piu' alto del campione, perde posizioni.
  assert.ok(out.countries.KOR.rank > out.countries.KOR.rankWhr);
  assert.equal(out.countries.KOR.rankDelta, -1);
  // La Turchia, col tasso piu' basso, ne guadagna.
  assert.ok(out.countries.TUR.rank < out.countries.TUR.rankWhr);

  // Indici matematicamente uguali devono condividere il rango: Danimarca e
  // Italia valgono entrambe 70.83 e differiscono solo nell'ultimo bit.
  assert.equal(out.countries.DNK.index, out.countries.ITA.index);
  assert.equal(out.countries.DNK.rank, out.countries.ITA.rank);
  // Il pari merito consuma la posizione successiva.
  assert.equal(out.countries.COG.rank, out.countries.DNK.rank + 2);

  assert.match(stdout, /paesi con dati completi\s+7/);
  assert.match(stdout, /North Cyprus/);

  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  assert.deepEqual(report.suicideOnly.map((c) => c.iso3), ['BRA']);
  assert.deepEqual(report.skippedNoIsoCode, ['North Cyprus']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pipeline: con w = 0 l indice riproduce esattamente la classifica WHR', async () => {
  const dir = await scenario(WHR_SAMPLE, SUICIDE_SAMPLE);
  runBuild(dir, ['--weight', '0']);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));
  for (const [iso3, c] of Object.entries(out.countries)) {
    assert.equal(c.rank, c.rankWhr, `${iso3} si sposta con w = 0`);
    assert.equal(c.rankDelta, 0);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pipeline: un nome WHR non mappabile fa fallire il build', async () => {
  const dir = await scenario(
    [...WHR_SAMPLE, { name: 'Freedonia', whr: 5.0 }],
    SUICIDE_SAMPLE,
  );
  assert.throws(
    () => runBuild(dir),
    (err) => {
      assert.equal(err.status, 1);
      const text = String(err.stderr);
      assert.match(text, /Join WHR -> ISO3 incompleto/);
      assert.match(text, /"Freedonia"/);
      assert.match(text, /src\/iso-lookup\.js/);
      return true;
    },
  );
  // Nessun output scritto quando il join e' rotto.
  assert.equal(fs.existsSync(path.join(dir, 'out', 'countries.json')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pipeline: due nomi WHR sullo stesso ISO3 fanno fallire il build', async () => {
  const dir = await scenario(
    [...WHR_SAMPLE, { name: 'Turkey', whr: 4.7 }], // stesso paese, grafia vecchia
    SUICIDE_SAMPLE,
  );
  assert.throws(
    () => runBuild(dir),
    (err) => {
      assert.match(String(err.stderr), /stesso ISO3/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pipeline: --offline non scarica e dice quale file manca', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whr-test-'));
  assert.throws(
    () => runBuild(dir),
    (err) => {
      assert.match(String(err.stderr), /Manca la copia locale/);
      assert.match(String(err.stderr), /worldhappiness\.report/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- geometrie --------------------------------------------------------------

test('geo-iso.json copre le geometrie, Kosovo incluso per nome', async () => {
  const dir = await scenario(WHR_SAMPLE, SUICIDE_SAMPLE);
  runBuild(dir);
  const geo = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'geo-iso.json'), 'utf8'));
  assert.equal(geo.byId['380'], 'ITA');
  assert.equal(geo.byId['246'], 'FIN');
  assert.equal(geo.byName.Kosovo, 'XKX');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('il pari merito non dipende dal rumore in virgola mobile', () => {
  // Due indici uguali sulla carta possono differire nell'ultimo bit.
  const a = 70.83333333333333;
  const b = a + 1e-13;
  assert.notEqual(a, b, 'il caso ha senso solo se i due float differiscono');
  assert.deepEqual(competitionRanks([100, a, b, 10]), [1, 2, 2, 4]);
  assert.deepEqual(percentileRanks([10, a, b, 100]), [0, 50, 50, 100]);
});

test('una differenza reale non viene assorbita dalla tolleranza', () => {
  // 0.05 punti di indice sono visibili nel JSON pubblicato: restano due ranghi.
  assert.deepEqual(competitionRanks([70.9, 70.85]), [1, 2]);
});

test('xlsx: le intestazioni vengono trovate anche sotto una riga di titolo', async () => {
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

// --- tabelle compilate a mano (percorso offline) ----------------------------

function scriviCsv(file, testo) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, testo);
}

async function scenarioCsv(benessereCsv, suicidiCsv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whr-test-'));
  scriviCsv(path.join(dir, 'sources', 'whr-figure-2.1.csv'), benessereCsv);
  scriviCsv(path.join(dir, 'sources', 'who-suicide-rate.csv'), suicidiCsv);
  return dir;
}

const BENESSERE_CSV = `iso3,paese,paese_en,benessere
FIN,Finlandia,Finland,7.74
DNK,Danimarca,Denmark,7.52
ITA,Italia,Italy,6.32
KOR,Corea del Sud,South Korea,6.04
TUR,Turchia,Türkiye,4.72
COD,Repubblica Democratica del Congo,DR Congo,4.02
COG,Repubblica del Congo,Congo,5.22
NOR,Norvegia,Norway,
`;

const SUICIDI_CSV = `iso3,paese,tasso
FIN,Finlandia,15.3
DNK,Danimarca,9.4
ITA,Italia,4.3
KOR,Corea del Sud,28.6
TUR,Turchia,2.6
COD,Repubblica Democratica del Congo,6.4
COG,Repubblica del Congo,5.1
NOR,Norvegia,11.2
`;

test('offline: due tabelle con ISO3 si uniscono senza passare dai nomi', async () => {
  const dir = await scenarioCsv(BENESSERE_CSV, SUICIDI_CSV);
  runBuild(dir);

  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));
  assert.deepEqual(Object.keys(out.countries).sort(), ['COD', 'COG', 'DNK', 'FIN', 'ITA', 'KOR', 'TUR']);
  // La Norvegia ha il tasso ma la cella del benessere e' vuota: resta fuori.
  assert.equal(out.countries.NOR, undefined);
  assert.equal(out.countries.COD.whr, 4.02);
  assert.equal(out.countries.COG.whr, 5.22);

  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  // Nessun nome e' passato dalla tabella di conversione: il codice basta.
  assert.ok(report.join.every((j) => j.via === 'codice nella tabella'));
  assert.deepEqual(report.suicideOnly.map((c) => c.iso3), ['NOR']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline: una cella non numerica ferma il build e dice quale riga', async () => {
  const rotto = BENESSERE_CSV.replace('ITA,Italia,Italy,6.32', 'ITA,Italia,Italy,sei virgola tre');
  const dir = await scenarioCsv(rotto, SUICIDI_CSV);
  assert.throws(
    () => runBuild(dir),
    (err) => {
      const t = String(err.stderr);
      assert.match(t, /Valori non validi nella fonte benessere/);
      assert.match(t, /riga 4/);
      assert.match(t, /ITA/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline: un punteggio fuori dalla scala 0-10 ferma il build', async () => {
  const rotto = BENESSERE_CSV.replace('ITA,Italia,Italy,6.32', 'ITA,Italia,Italy,63.2');
  const dir = await scenarioCsv(rotto, SUICIDI_CSV);
  assert.throws(
    () => runBuild(dir),
    (err) => {
      assert.match(String(err.stderr), /fuori dalla scala 0-10/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline: un tasso di suicidio implausibile ferma il build', async () => {
  const rotto = SUICIDI_CSV.replace('ITA,Italia,4.3', 'ITA,Italia,430');
  const dir = await scenarioCsv(BENESSERE_CSV, rotto);
  assert.throws(
    () => runBuild(dir),
    (err) => {
      assert.match(String(err.stderr), /fuori da ogni intervallo plausibile/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline: la virgola decimale italiana viene accettata', async () => {
  const virgole = BENESSERE_CSV.replace('ITA,Italia,Italy,6.32', 'ITA,Italia,Italy,"6,32"');
  const dir = await scenarioCsv(virgole, SUICIDI_CSV);
  runBuild(dir);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));
  assert.equal(out.countries.ITA.whr, 6.32);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline: un codice ISO3 malformato ferma il build', async () => {
  const rotto = BENESSERE_CSV.replace('ITA,Italia,Italy,6.32', 'ITALIA,Italia,Italy,6.32');
  const dir = await scenarioCsv(rotto, SUICIDI_CSV);
  assert.throws(
    () => runBuild(dir),
    (err) => {
      const t = String(err.stderr);
      assert.match(t, /Join WHR -> ISO3 incompleto/);
      assert.match(t, /codice malformato/);
      return true;
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('le tabelle generate sono compilabili cosi come sono', async () => {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-templates.js')], { cwd: ROOT });
  const csv = fs.readFileSync(path.join(ROOT, 'data', 'templates', 'benessere.csv'), 'utf8');
  const righe = parseCsv(csv);
  assert.deepEqual(righe[0], ['iso3', 'paese', 'paese_en', 'benessere']);
  assert.ok(righe.length > 150, 'devono esserci tutti i paesi disegnabili');
  // Ogni riga ha un codice valido e la colonna del valore vuota.
  for (const r of righe.slice(1)) {
    assert.match(r[0], /^[A-Z]{3}$/);
    assert.equal(r[3], '');
  }
  assert.ok(righe.some((r) => r[0] === 'ITA' && r[1] === 'Italia'));
  assert.ok(!righe.some((r) => r[0] === 'ATA'), 'Antartide esclusa dalla mappa e dalle tabelle');
});

test('offline: le tabelle generate, compilate, arrivano fino al JSON', async () => {
  const { execFileSync: exec } = await import('node:child_process');
  exec(process.execPath, [path.join(ROOT, 'scripts', 'make-templates.js')], { cwd: ROOT });

  // Compilo i due modelli come farebbe una persona: qualche cella lasciata vuota.
  const compila = (nome, base) => {
    const righe = parseCsv(fs.readFileSync(path.join(ROOT, 'data', 'templates', nome), 'utf8'));
    const out = [righe[0].join(',')];
    righe.slice(1).forEach((r, i) => {
      r[3] = i % 5 === 0 ? '' : String(base + (i % 17) * 0.13);
      out.push(r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','));
    });
    return `${out.join('\n')}\n`;
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whr-test-'));
  scriviCsv(path.join(dir, 'sources', 'benessere.csv'), compila('benessere.csv', 4));
  scriviCsv(path.join(dir, 'sources', 'suicidi.csv'), compila('suicidi.csv', 6));

  const stdout = runBuild(dir);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'countries.json'), 'utf8'));

  assert.ok(out.meta.countriesWithData > 100);
  // Senza colonna Year non si dichiara un anno: null, non zero.
  assert.equal(out.meta.suicideYear, null);

  // Il valore deve venire dalla colonna giusta: con due colonne di nomi
  // (paese, paese_en) un riconoscimento ingenuo prenderebbe il nome inglese.
  for (const c of Object.values(out.countries)) {
    assert.equal(typeof c.suicide, 'number');
    assert.ok(c.whr >= 0 && c.whr <= 10, `benessere fuori scala: ${c.whr}`);
  }

  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  assert.ok(report.join.every((j) => j.via === 'codice nella tabella'));
  assert.match(stdout, /codice ISO3 gia nella tabella/);
  fs.rmSync(dir, { recursive: true, force: true });
});
