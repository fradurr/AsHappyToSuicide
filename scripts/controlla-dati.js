#!/usr/bin/env node
/**
 * controlla-dati.js — avverte prima di una build fatta su dati finti.
 *
 * Gira automaticamente prima di `npm run build`. Non blocca: fermare la build
 * impedirebbe di pubblicare una versione di prova, che e' legittimo volere.
 * Ma un sito che mostra numeri inventati sui suicidi senza che chi lo pubblica
 * se ne ricordi e' il modo piu' facile di fare un danno, quindi l'avviso e'
 * rumoroso e compare anche nei log di GitHub Actions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const veri = path.join(ROOT, 'public', 'data', 'countries.json');
const finti = path.join(ROOT, 'public', 'data', 'countries.placeholder.json');

if (fs.existsSync(veri)) {
  const meta = JSON.parse(fs.readFileSync(veri, 'utf8')).meta ?? {};
  console.log(`\n  ✓ dati reali: ${meta.countriesWithData ?? '?'} paesi, generati il ${meta.generated ?? '?'}\n`);
  if (fs.existsSync(finti)) {
    console.log('  ⚠ c\'e\' ancora public/data/countries.placeholder.json: puoi cancellarlo.\n');
  }
} else if (fs.existsSync(finti)) {
  console.log(`
  ┌──────────────────────────────────────────────────────────────────┐
  │  ATTENZIONE: build sui DATI DI ESEMPIO                           │
  │                                                                  │
  │  public/data/countries.json non esiste, quindi il sito usera'    │
  │  numeri inventati. Sul sito compare una fascia nera che lo dice, │
  │  ma resta una pubblicazione di dati falsi sui suicidi.           │
  │                                                                  │
  │  Per i dati veri:  npm run templates                             │
  │                    (compila, poi) npm run build:data -- --offline│
  └──────────────────────────────────────────────────────────────────┘
`);
} else {
  console.log('\n  ⚠ nessun dato in public/data/: la mappa uscira tutta vuota.\n');
}
