#!/usr/bin/env node
/**
 * make-templates.js — scrive due tabelle vuote da compilare a mano.
 *
 * Ogni riga porta gia' il codice ISO3 e il nome del paese: chi compila deve
 * solo riempire l'ultima colonna. Cosi' il join non dipende piu' dalla grafia
 * dei nomi, che e' l'unica cosa che oggi puo' far fallire il build.
 *
 * Le righe sono tutti i paesi che la mappa sa disegnare. Lasciare vuota una
 * cella e' legittimo: quel paese resta grigio.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import countries from 'i18n-iso-countries';
import { readGeometryIso3 } from './build-data.js';

const require = createRequire(import.meta.url);
countries.registerLocale(require('i18n-iso-countries/langs/it.json'));
countries.registerLocale(require('i18n-iso-countries/langs/en.json'));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'templates');

const geo = readGeometryIso3();

// L'Antartide e' esclusa dalla mappa, quindi non ha senso chiederne il dato.
const ESCLUSI = new Set(['ATA']);

const righe = [...geo.drawable]
  .filter((iso3) => !ESCLUSI.has(iso3))
  .map((iso3) => ({
    iso3,
    it: countries.getName(iso3, 'it') ?? '',
    en: countries.getName(iso3, 'en') ?? '',
  }))
  .sort((a, b) => (a.it || a.iso3).localeCompare(b.it || b.iso3, 'it'));

/** Un campo che contiene virgole o virgolette va quotato, o rompe il CSV. */
const q = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function scrivi(nomeFile, intestazioneValore, note) {
  const lines = [`iso3,paese,paese_en,${intestazioneValore}`];
  for (const r of righe) lines.push([q(r.iso3), q(r.it), q(r.en), ''].join(','));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, nomeFile), `${lines.join('\n')}\n`);
  console.log(`  ${path.join('data/templates', nomeFile)}  — ${righe.length} righe — ${note}`);
}

console.log('\nTabelle da compilare:');
scrivi('benessere.csv', 'benessere', 'punteggio Cantril, scala 0-10');
scrivi('suicidi.csv', 'tasso', 'morti per 100.000, standardizzato per eta');
console.log(`
Compila l'ultima colonna e salva i due file in data/sources/ con questi nomi:
  data/sources/whr-figure-2.1.xlsx   (oppure .csv)
  data/sources/who-suicide-rate.csv

Le celle lasciate vuote sono paesi senza dato: restano grigi sulla mappa.
Poi: npm run build:data -- --offline
`);
