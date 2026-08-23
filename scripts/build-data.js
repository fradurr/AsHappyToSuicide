#!/usr/bin/env node
/**
 * build-data.js — costruisce public/data/countries.json
 *
 * Pipeline:
 *   1. carica le due fonti (benessere WHR, mortalita' per suicidio OMS/GHE)
 *   2. le normalizza su ISO 3166-1 alpha-3
 *   3. tiene solo i paesi che hanno *entrambi* i dati
 *   4. converte le due variabili in percentile dentro quel campione
 *   5. combina i percentili nell'indice corretto
 *   6. scrive il JSON che il frontend legge senza fare altri calcoli
 *
 * Il calcolo sta qui, non nel browser: la mappa riceve numeri gia' pronti.
 *
 * Uso:
 *   node scripts/build-data.js               # usa le copie locali, scarica se mancano
 *   node scripts/build-data.js --refresh     # riscarica le fonti anche se gia' presenti
 *   node scripts/build-data.js --offline     # non scarica nulla, fallisce se manca un file
 *   node scripts/build-data.js --weight 0.3  # peso diverso per la componente suicidi
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
countries.registerLocale(require('i18n-iso-countries/langs/it.json'));
countries.registerLocale(require('i18n-iso-countries/langs/en.json'));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// I percorsi sono sovrascrivibili da variabili d'ambiente: serve ai test, che
// fanno girare la pipeline intera su fonti finte senza toccare i file veri.
const fromEnv = (name, fallback) => (process.env[name] ? path.resolve(process.env[name]) : fallback);

const SOURCES_DIR = fromEnv('BUILD_SOURCES_DIR', path.join(ROOT, 'data', 'sources'));
const OUT_DIR = fromEnv('BUILD_OUT_DIR', path.join(ROOT, 'public', 'data'));
const GEO_FILE = fromEnv('BUILD_GEO_FILE', path.join(ROOT, 'public', 'geo', 'countries-110m.json'));
const OUT_FILE = path.join(OUT_DIR, 'countries.json');
const GEO_ISO_FILE = path.join(OUT_DIR, 'geo-iso.json');
const REPORT_FILE = fromEnv('BUILD_REPORT_FILE', path.join(ROOT, 'data', 'build-report.json'));

// ---------------------------------------------------------------------------
// Configurazione delle fonti
// ---------------------------------------------------------------------------

const SOURCES = {
  wellbeing: {
    label: 'World Happiness Report — Data for Figure 2.1',
    // La pagina "Data Sharing" di worldhappiness.report distribuisce questo file.
    // L'URL cambia a ogni edizione: se il download fallisce, scaricarlo a mano
    // e salvarlo con il nome qui sotto in data/sources/.
    url: 'https://happiness-report.s3.amazonaws.com/2025/Data+for+Figure+2.1+(2025).xlsx',
    file: 'whr-figure-2.1.xlsx',
    // Il file scaricato ha il primo nome; gli altri servono a chi compila la
    // tabella a mano partendo da data/templates/.
    nomiAccettati: ['whr-figure-2.1.xlsx', 'whr-figure-2.1.csv', 'benessere.csv', 'benessere.xlsx'],
    page: 'https://worldhappiness.report/data-sharing/',
    edition: 2025,
    years: '2022-2024',
  },
  suicide: {
    label: 'OMS Global Health Estimates 2021 — tasso di suicidio standardizzato per eta',
    url: 'https://ourworldindata.org/grapher/death-rate-from-suicides-gho.csv?v=1&csvType=full&useColumnShortNames=false',
    file: 'who-suicide-rate.csv',
    nomiAccettati: ['who-suicide-rate.csv', 'who-suicide-rate.xlsx', 'suicidi.csv', 'suicidi.xlsx'],
    page: 'https://ourworldindata.org/grapher/death-rate-from-suicides-gho',
    source: 'WHO GHE 2021',
  },
};

const DEFAULT_WEIGHT = 0.25;

/** Percorso leggibile: relativo alla radice del progetto quando ci sta dentro. */
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
        fail(`--weight richiede un numero fra 0 e 1, ricevuto: ${raw}`);
      }
      args.weight = w;
    } else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      fail(`Argomento non riconosciuto: ${a}`);
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
// Caricamento delle fonti (copia locale, altrimenti download)
// ---------------------------------------------------------------------------

async function ensureSource(key, { refresh, offline }) {
  const src = SOURCES[key];
  const dest = path.join(SOURCES_DIR, src.file);

  const presente = (src.nomiAccettati ?? [src.file])
    .map((n) => path.join(SOURCES_DIR, n))
    .find((p) => fs.existsSync(p));

  if (presente && !refresh) return presente;

  if (offline) {
    fail(
      `Manca la copia locale di: ${src.label}`,
      [
        `  attesa in ${rel(SOURCES_DIR)}, con uno di questi nomi:`,
        ...(src.nomiAccettati ?? [src.file]).map((n) => `    ${n}`),
        '',
        `  scaricala da: ${src.page}`,
        '  oppure compila la tabella in data/templates/ (npm run templates)',
        '  (modalita --offline: nessun download automatico)',
      ].join('\n'),
    );
  }

  process.stdout.write(`  ↓ ${src.label}\n    ${src.url}\n`);
  let res;
  try {
    res = await fetch(src.url, { redirect: 'follow' });
  } catch (err) {
    fail(
      `Download fallito: ${src.label}`,
      [
        `  ${err.message}`,
        '',
        '  L\'host non e raggiungibile da questa rete. Scarica il file a mano da:',
        `    ${src.page}`,
        `  e salvalo come: ${rel(dest)}`,
        '  poi rilancia con: npm run build:data -- --offline',
      ].join('\n'),
    );
  }
  if (!res.ok) {
    fail(
      `Download fallito: ${src.label} (HTTP ${res.status})`,
      [
        `  ${src.url}`,
        '',
        '  L\'URL cambia a ogni edizione, e alcune reti bloccano questi host.',
        '  Scarica il file a mano da:',
        `    ${src.page}`,
        `  e salvalo come: ${rel(dest)}`,
        '  poi rilancia con: npm run build:data -- --offline',
      ].join('\n'),
    );
  }
  fs.mkdirSync(SOURCES_DIR, { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// ---------------------------------------------------------------------------
// Parser CSV (RFC 4180: virgolette, virgole e a capo dentro i campi)
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
// Fonte 1: benessere (WHR)
// ---------------------------------------------------------------------------

/** Riduce una cella ExcelJS a testo: formule, rich text e hyperlink inclusi. */
function cellText(v) {
  if (v == null) return v;
  if (typeof v !== 'object') return v;
  if ('result' in v) return v.result;
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return v.text;
  return v;
}

/** Riconosce la colonna del punteggio Cantril, la cui intestazione cambia fra edizioni. */
function findWellbeingColumns(header) {
  const norm = header.map((h) => normalizeName(h ?? ''));
  // Grafie del WHR (cambiano fra edizioni) piu' quelle di data/templates/.
  const countryIdx = norm.findIndex(
    (h) => h === 'country name' || h === 'country' || h === 'country or region' || h === 'paese' || h === 'nome',
  );
  const scoreIdx = norm.findIndex(
    (h) =>
      h === 'ladder score' ||
      h === 'happiness score' ||
      h === 'score' ||
      h === 'life ladder' ||
      h === 'benessere' ||
      h === 'punteggio' ||
      h === 'cantril' ||
      h.startsWith('ladder score'),
  );
  const iso3Idx = norm.findIndex((h) => h === 'iso3' || h === 'code' || h === 'codice' || h === 'iso');
  return { countryIdx, scoreIdx, iso3Idx, header };
}

/** Legge un CSV o un xlsx come righe grezze. Le due fonti passano di qui. */
async function leggiTabella(file, etichetta) {
  const ext = path.extname(file).toLowerCase();

  if (ext === '.csv' || ext === '.tsv') {
    return parseCsv(fs.readFileSync(file, 'utf8'));
  }
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    if (!ws) fail(`Il file ${rel(file)} non contiene fogli.`);
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const values = [];
      for (let c = 1; c <= ws.columnCount; c += 1) values.push(cellText(r.getCell(c).value));
      rows.push(values);
    });
    return rows;
  }
  return fail(
    `Formato non supportato per la fonte ${etichetta}: ${ext || '(nessuna estensione)'}`,
    '  Formati accettati: .xlsx, .csv. Un vecchio .xls va riesportato in .xlsx o .csv.',
  );
}

async function readWellbeing(file) {
  const rows = await leggiTabella(file, 'benessere');
  if (!rows.length) fail(`La fonte benessere e' vuota: ${rel(file)}`);

  // Alcune edizioni mettono un titolo o una riga vuota prima delle intestazioni,
  // quindi cerco la riga di intestazione invece di dare per scontato che sia la prima.
  let headerRow = -1;
  let countryIdx = -1;
  let scoreIdx = -1;
  let iso3Idx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const found = findWellbeingColumns(rows[i].map((v) => (v == null ? '' : String(v))));
    // Basta la coppia codice+punteggio: il nome del paese diventa facoltativo
    // quando la tabella porta gia' l'ISO3.
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
      'Non riesco a individuare le colonne nella fonte benessere.',
      [
        `  file: ${rel(file)}`,
        `  prima riga: ${rows[0].filter(Boolean).join(' | ')}`,
        '  serve una colonna col punteggio (es. "Ladder score" o "benessere") e',
        '  una col paese: il codice ISO3 ("iso3" o "Code") oppure il nome',
        '  ("Country name" o "paese").',
        '  Il modello pronto lo generi con: npm run templates',
      ].join('\n'),
    );
  }

  const out = [];
  const scartate = [];
  for (const [n, r] of rows.slice(headerRow + 1).entries()) {
    const riga = headerRow + n + 2; // numero di riga come lo vede un foglio di calcolo
    const name = countryIdx === -1 || r[countryIdx] == null ? '' : String(r[countryIdx]).trim();
    const iso3 = iso3Idx === -1 || r[iso3Idx] == null ? '' : String(r[iso3Idx]).trim().toUpperCase();
    const grezzo = r[scoreIdx];
    if (!name && !iso3) continue;

    // Cella vuota = paese senza dato, e va bene. Cella piena ma non numerica =
    // errore di compilazione, e va detto invece che ignorato.
    const vuota = grezzo == null || String(grezzo).trim() === '';
    if (vuota) continue;
    const score = Number(String(grezzo).replace(',', '.'));
    if (!Number.isFinite(score)) {
      scartate.push(`riga ${riga}: "${iso3 || name}" ha punteggio "${grezzo}", che non e' un numero`);
      continue;
    }
    if (score < 0 || score > 10) {
      scartate.push(`riga ${riga}: "${iso3 || name}" ha punteggio ${score}, fuori dalla scala 0-10`);
      continue;
    }
    out.push({ name, iso3, score });
  }

  if (scartate.length) {
    fail(
      `Valori non validi nella fonte benessere: ${rel(file)}`,
      `${scartate.map((r) => `    - ${r}`).join('\n')}\n\n  Lascia la cella vuota se il dato non c'e'; un valore illeggibile viene segnalato, non ignorato.`,
    );
  }
  if (!out.length) fail(`Nessuna riga valida nella fonte benessere: ${rel(file)}`);
  return out;
}

// ---------------------------------------------------------------------------
// Fonte 2: mortalita' per suicidio (OMS GHE via Our World in Data)
// ---------------------------------------------------------------------------

async function readSuicide(file) {
  const rows = await leggiTabella(file, 'suicidi');
  if (!rows.length) fail(`La fonte suicidi e' vuota: ${rel(file)}`);

  const header = rows[0].map((h) => (h == null ? '' : String(h).trim()));
  const trova = (...nomi) => header.findIndex((h) => nomi.includes(normalizeName(h)));
  const entityIdx = trova('entity', 'paese', 'country', 'nome');
  const codeIdx = trova('code', 'iso3', 'codice', 'iso');
  const yearIdx = trova('year', 'anno');

  // La colonna del valore: prima si cerca per nome, perche' e' l'unico modo
  // sicuro. Solo se non si trova si ricade sull'ultima colonna non riconosciuta
  // — l'export OWID mette li' il valore, sotto un'intestazione lunghissima che
  // cambia fra versioni. "La prima non riconosciuta" sarebbe sbagliato: una
  // tabella con due colonne di nomi (paese, paese_en) beccherebbe il nome.
  const NOMI_NON_VALORE = new Set([
    'entity', 'paese', 'country', 'nome', 'paese_en', 'country name', 'nome_en',
    'code', 'iso3', 'codice', 'iso', 'year', 'anno',
  ]);
  let valueIdx = trova('tasso', 'valore', 'rate', 'value', 'suicidi', 'suicide rate');
  if (valueIdx === -1) {
    for (let i = header.length - 1; i >= 0; i -= 1) {
      if (i === entityIdx || i === codeIdx || i === yearIdx) continue;
      if (NOMI_NON_VALORE.has(normalizeName(header[i]))) continue;
      valueIdx = i;
      break;
    }
  }

  // Entity e Year sono facoltativi: una tabella compilata a mano puo' avere
  // solo codice e valore. Codice e valore invece servono sempre.
  if (codeIdx === -1 || valueIdx === -1) {
    fail(
      'Intestazioni inattese nella fonte suicidi.',
      [
        `  file: ${rel(file)}`,
        `  trovate: ${header.join(' | ')}`,
        '  servono almeno una colonna di codici ISO3 (Code / iso3) e una di valori.',
        '  Entity e Year sono facoltativi.',
      ].join('\n'),
    );
  }

  const byIso = new Map();
  let aggregatesDropped = 0;
  let latestYear = -Infinity;

  const scartate = [];
  for (const [n, r] of rows.slice(1).entries()) {
    const riga = n + 2;
    const code = String(r[codeIdx] ?? '').trim().toUpperCase();
    // Senza colonna Year sono tutte righe dello stesso anno, ignoto.
    const year = yearIdx === -1 ? 0 : Number(r[yearIdx]);
    const grezzo = r[valueIdx];
    // Codice vuoto = aggregato regionale ("World", "Europe", gruppi di reddito).
    if (!code) {
      aggregatesDropped += 1;
      continue;
    }
    if (!/^[A-Z]{3}$/.test(code)) {
      // OWID usa pseudo-codici tipo OWID_WRL per gli aggregati.
      aggregatesDropped += 1;
      continue;
    }
    const vuota = grezzo == null || String(grezzo).trim() === '';
    if (vuota) continue;
    const rate = Number(String(grezzo).replace(',', '.'));
    if (!Number.isFinite(rate)) {
      scartate.push(`riga ${riga}: "${code}" ha tasso "${grezzo}", che non e' un numero`);
      continue;
    }
    if (rate < 0 || rate > 200) {
      scartate.push(`riga ${riga}: "${code}" ha tasso ${rate} per 100.000, fuori da ogni intervallo plausibile`);
      continue;
    }
    if (!Number.isFinite(year)) continue;
    if (year > latestYear) latestYear = year;
    const prev = byIso.get(code);
    if (!prev || year > prev.year) byIso.set(code, { iso3: code, entity: String(r[entityIdx] ?? '').trim(), year, rate });
  }

  if (scartate.length) {
    fail(
      `Valori non validi nella fonte suicidi: ${rel(file)}`,
      `${scartate.map((r) => `    - ${r}`).join('\n')}\n\n  Lascia la cella vuota se il dato non c'e'.`,
    );
  }

  if (!byIso.size) fail(`Nessuna riga valida nella fonte suicidi: ${rel(file)}`);

  // Tengo solo l'anno piu' recente disponibile, uguale per tutti: mescolare anni
  // diversi renderebbe i paesi non confrontabili fra loro.
  const kept = new Map();
  const staleYear = [];
  for (const [iso3, rec] of byIso) {
    if (rec.year === latestYear) kept.set(iso3, rec);
    else staleYear.push({ iso3, name: rec.entity, year: rec.year });
  }

  // Senza colonna Year non c'e' un anno da dichiarare: meglio null che uno zero
  // che finirebbe nei metadati del sito come se fosse una data.
  const year = yearIdx === -1 ? null : latestYear;
  return { byIso: kept, year, aggregatesDropped, staleYear };
}

// ---------------------------------------------------------------------------
// Risoluzione dei nomi WHR su ISO3
// ---------------------------------------------------------------------------

const NORMALIZED_OVERRIDES = new Map(
  Object.entries(WHR_NAME_TO_ISO3).map(([name, iso3]) => [normalizeName(name), iso3]),
);
const NORMALIZED_SKIP = new Set([...INTENTIONALLY_UNMAPPED].map(normalizeName));

function resolveIso3(whrName) {
  const key = normalizeName(whrName);
  if (NORMALIZED_OVERRIDES.has(key)) {
    return { iso3: NORMALIZED_OVERRIDES.get(key), via: 'tabella' };
  }
  // I nomi che coincidono con la denominazione ISO inglese si risolvono da soli.
  const auto = countries.getAlpha3Code(whrName, 'en');
  if (auto) return { iso3: auto, via: 'ISO en' };
  return { iso3: undefined, via: null };
}

// ---------------------------------------------------------------------------
// Statistica: percentili
// ---------------------------------------------------------------------------

/**
 * Due indici composti da percentili diversi possono essere matematicamente
 * uguali e differire lo stesso nell'ultimo bit: 0.75*83.33 + 0.25*33.33 e
 * 0.75*66.67 + 0.25*83.33 valgono entrambi 70.8333..., ma non in IEEE 754.
 * Senza tolleranza il pari merito diventa un ordine inventato dall'aritmetica.
 */
const EPS = 1e-9;
const sameValue = (a, b) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Percentile per rango sul campione dato: 100 = valore piu' alto, 0 = piu' basso.
 * I pari merito ricevono il rango medio, quindi due paesi identici hanno lo
 * stesso percentile. Con un solo elemento il percentile e' 50 (non c'e' scala).
 *
 * Si usa il percentile e non il min-max perche' il min-max e' schiacciato dagli
 * outlier: un paese con un tasso di suicidio molto sopra la media comprimerebbe
 * tutti gli altri in una fascia strettissima, rendendo la mappa illeggibile.
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
    const avgRank = (i + j) / 2; // rango medio a base 0 fra i pari merito
    const pct = (avgRank / (n - 1)) * 100;
    for (let k = i; k <= j; k += 1) out[order[k].i] = pct;
    i = j + 1;
  }
  return out;
}

/** Ranghi 1..n dal valore piu' alto al piu' basso; pari merito -> stesso rango. */
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
// Geometrie: quali paesi la mappa e' in grado di disegnare
// ---------------------------------------------------------------------------

export function readGeometryIso3() {
  if (!fs.existsSync(GEO_FILE)) {
    fail(
      `Manca il file delle geometrie: ${rel(GEO_FILE)}`,
      '  Copialo da node_modules/world-atlas/countries-110m.json',
    );
  }
  const topo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
  const geometries = topo?.objects?.countries?.geometries;
  if (!Array.isArray(geometries)) {
    fail(`Struttura inattesa in ${rel(GEO_FILE)}: manca objects.countries.geometries`);
  }

  const byId = {};
  const byName = {};
  const unmapped = [];

  for (const f of geometries) {
    const name = f.properties?.name ?? '(senza nome)';
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

  console.log('\nFonti');
  const wellbeingFile = await ensureSource('wellbeing', args);
  const suicideFile = await ensureSource('suicide', args);
  console.log(`  ✓ benessere: ${path.relative(ROOT, wellbeingFile)}`);
  console.log(`  ✓ suicidi:   ${path.relative(ROOT, suicideFile)}`);

  const wellbeingRows = await readWellbeing(wellbeingFile);
  const suicide = await readSuicide(suicideFile);
  const geo = readGeometryIso3();

  // --- Join: nomi WHR -> ISO3 ---------------------------------------------
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

    // Un ISO3 scritto nella tabella vale piu' di qualsiasi ricerca sul nome:
    // e' esplicito, e toglie di mezzo il problema delle grafie.
    let iso3;
    let via;
    if (row.iso3) {
      if (!/^[A-Z]{3}$/.test(row.iso3)) {
        unresolved.push(`${row.iso3} (codice malformato${row.name ? `, riga "${row.name}"` : ''})`);
        continue;
      }
      iso3 = row.iso3;
      via = 'codice nella tabella';
    } else {
      ({ iso3, via } = resolveIso3(row.name));
      if (!iso3) {
        unresolved.push(row.name);
        continue;
      }
    }
    joinMap.push({ whrName: row.name || iso3, iso3, via });
    if (wellbeingByIso.has(iso3)) {
      duplicates.push(`${row.name || iso3} -> ${iso3} (gia' assegnato a "${wellbeingByIso.get(iso3).name || iso3}")`);
      continue;
    }
    wellbeingByIso.set(iso3, { ...row, iso3 });
  }

  // Fallimento rumoroso: un nome non risolto significa un paese perso in silenzio.
  if (unresolved.length || duplicates.length) {
    const lines = [];
    if (unresolved.length) {
      lines.push('  Nomi WHR senza corrispondenza ISO3:');
      for (const n of unresolved) lines.push(`    - ${JSON.stringify(n)}`);
      lines.push('');
      lines.push('  Aggiungili a src/iso-lookup.js (valore null se l\'entita non ha un codice ISO).');
    }
    if (duplicates.length) {
      if (lines.length) lines.push('');
      lines.push('  Due nomi WHR risolti sullo stesso ISO3:');
      for (const d of duplicates) lines.push(`    - ${d}`);
    }
    fail('Join WHR -> ISO3 incompleto.', lines.join('\n'));
  }

  // --- Campione con dati completi -----------------------------------------
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
    fail(`Solo ${complete.length} paesi con dati completi: impossibile calcolare i percentili.`);
  }

  // --- Indice --------------------------------------------------------------
  const pWellbeing = percentileRanks(complete.map((c) => c.whr));
  // Il segno meno inverte la scala: un tasso piu' basso da' un percentile piu' alto.
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
    // Positivo = il paese sale quando i suicidi entrano nel conto.
    c.rankDelta = ranksWhr[i] - ranks[i];
  });

  // --- Output --------------------------------------------------------------
  const out = { meta: {}, countries: {} };
  for (const c of [...complete].sort((a, b) => a.rank - b.rank)) {
    out.countries[c.iso3] = {
      name: countries.getName(c.iso3, 'it') ?? c.whrName,
      nameEn: countries.getName(c.iso3, 'en') ?? c.whrName,
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
      'Indice composito: percentili di benessere e di mortalita per suicidio, ' +
      'calcolati dentro il campione dei paesi che hanno entrambi i dati.',
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
    // Il join per esteso: serve a controllare a mano che nessun nome sia finito
    // sul paese sbagliato. "tabella" = risolto da src/iso-lookup.js.
    join: joinMap.sort((a, b) => a.iso3.localeCompare(b.iso3)),
  };
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

  printReport({ report, complete, suicide, geo, w });
}

function printReport({ report, complete, suicide, geo, w }) {
  const line = (label, value) => console.log(`  ${label.padEnd(34)} ${value}`);

  console.log('\nCopertura');
  line('righe nella fonte WHR', report.whrRows);
  line('paesi nella fonte OMS', suicide.byIso.size + (suicide.year ? ` (anno ${suicide.year})` : ' (anno non dichiarato)'));
  line('paesi con dati completi', report.countriesWithData);
  line('solo benessere (manca OMS)', report.wellbeingOnly.length);
  line('solo suicidi (manca WHR)', report.suicideOnly.length);
  line('entita senza codice ISO', report.skippedNoIsoCode.length);

  const conta = (via) => report.join.filter((j) => j.via === via).length;
  console.log('\nJoin');
  line('codice ISO3 gia nella tabella', conta('codice nella tabella'));
  line('risolti da src/iso-lookup.js', conta('tabella'));
  line('risolti da nome ISO inglese', conta('ISO en'));
  line('righe aggregate scartate', report.suicideAggregateRowsDropped);
  line('OMS solo con anni precedenti', report.suicideOlderYearOnly.length);

  console.log('\nMappa');
  line('feature nel TopoJSON', geo.featureCount);
  line('feature senza ISO3', geo.unmapped.length);
  line('con dati ma non disegnabili', report.withDataWithoutGeometry.length);

  const show = (title, items, fmt) => {
    if (!items.length) return;
    console.log(`\n${title} (${items.length})`);
    console.log(`  ${items.map(fmt).join(', ')}`);
  };

  show('Con benessere ma senza dato OMS', report.wellbeingOnly, (c) => `${c.iso3} ${c.name}`);
  show('Con dato OMS ma non nel WHR', report.suicideOnly, (c) => `${c.iso3} ${c.name}`);
  show(
    `Scartati: dato OMS piu vecchio di ${report.suicideYear ?? "l'anno piu recente"}`,
    report.suicideOlderYearOnly,
    (c) => `${c.iso3} (${c.year})`,
  );
  show('Escluse: nessun codice ISO 3166-1', report.skippedNoIsoCode, (n) => n);
  show(
    'Con dati ma assenti dalle geometrie 1:110m',
    report.withDataWithoutGeometry.map((iso3) => ({ iso3 })),
    (c) => c.iso3,
  );
  show('Feature senza ISO3 (restano grigie)', geo.unmapped, (n) => n);

  const byIndex = [...complete].sort((a, b) => a.rank - b.rank);
  const movers = [...complete].sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta)).slice(0, 8);

  console.log(`\nPrimi 5 per indice corretto (w = ${w})`);
  for (const c of byIndex.slice(0, 5)) {
    console.log(
      `  ${String(c.rank).padStart(3)}. ${c.iso3}  indice ${c.index.toFixed(1).padStart(5)}` +
        `   WHR ${c.whr.toFixed(2)} (pos. ${c.rankWhr})   suicidi ${c.suicide.toFixed(1)}/100k`,
    );
  }

  console.log('\nSpostamenti maggiori rispetto alla classifica WHR');
  for (const c of movers) {
    const sign = c.rankDelta > 0 ? '+' : '';
    console.log(
      `  ${c.iso3}  ${String(c.rankWhr).padStart(3)} -> ${String(c.rank).padStart(3)}` +
        `  (${sign}${c.rankDelta})   suicidi ${c.suicide.toFixed(1)}/100k`,
    );
  }

  console.log(`\n✓ scritto public/data/countries.json (${report.countriesWithData} paesi)`);
  console.log('✓ scritto public/data/geo-iso.json');
  console.log('✓ scritto data/build-report.json\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => fail('Errore imprevisto durante il build.', `  ${err.stack || err.message}`));
}
