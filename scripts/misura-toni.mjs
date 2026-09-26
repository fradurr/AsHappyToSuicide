#!/usr/bin/env node
/**
 * misura-toni.mjs — verifica che le classi si distinguano davvero a schermo.
 *
 * I test in tests/toni.test.js confrontano i colori dichiarati. Questo script
 * misura invece quello che il browser disegna davvero, a densita' 1x e 2x.
 *
 * Con i toni pieni il controllo e' quasi una formalita': un colore pieno non ha
 * nulla da rasterizzare, quindi arriva a schermo com'e'. Serviva molto di piu'
 * nella versione precedente, che affidava il dato alla fittezza di un retino:
 * li' passi frazionari cadevano in fase diversa rispetto alla griglia dei pixel
 * e su 2x gli ultimi due livelli si staccavano di 2 punti di luminanza su 255.
 * Vale la pena tenerlo: se un giorno la grana venisse alzata o il passo
 * cambiato, e' qui che si vedrebbe tornare il problema.
 *
 * Serve Playwright, che non e' fra le dipendenze perche' non serve al sito:
 *     npm i -D playwright
 *     npm run build && npx vite preview --port 4177 &
 *     node scripts/misura-toni.mjs
 */

import { chromium } from 'playwright';

const URL = process.env.URL_ANTEPRIMA ?? 'http://127.0.0.1:4177/';
const LATO = 240;
/** Sotto questo stacco di luminanza due livelli non si distinguono a occhio. */
const STACCO_MINIMO = 5;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

let problemi = 0;

for (const dpr of [1, 2]) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: dpr,
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#mappa defs pattern').length > 0);

  const toni = await page.evaluate(async ({ lato, dprIn }) => {
    const patterns = [...document.querySelectorAll('#mappa defs pattern')];
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', lato);
    svg.setAttribute('height', lato * patterns.length);
    const defs = document.createElementNS(ns, 'defs');
    patterns.forEach((p) => defs.appendChild(p.cloneNode(true)));
    svg.appendChild(defs);
    patterns.forEach((p, i) => {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', 0);
      r.setAttribute('y', i * lato);
      r.setAttribute('width', lato);
      r.setAttribute('height', lato);
      r.setAttribute('fill', `url(#${p.id})`);
      svg.appendChild(r);
    });

    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    await new Promise((ok) => {
      img.onload = ok;
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
    });

    const c = document.createElement('canvas');
    c.width = lato * dprIn;
    c.height = lato * patterns.length * dprIn;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);

    return patterns.map((_, i) => {
      const d = ctx.getImageData(0, i * lato * dprIn, lato * dprIn, lato * dprIn).data;
      let somma = 0;
      for (let j = 0; j < d.length; j += 4) {
        somma += 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
      }
      return somma / (d.length / 4);
    });
  }, { lato: LATO, dprIn: dpr });

  console.log(`\nSchermo ${dpr}x — campioni ${LATO}x${LATO}`);
  toni.forEach((t, i) => {
    const stacco = i ? toni[i - 1] - t : null;
    const nota = stacco === null ? '' : stacco < STACCO_MINIMO ? '  <-- troppo vicino' : '';
    console.log(
      `  livello ${i} | luminanza ${t.toFixed(1).padStart(6)}` +
        ` | stacco ${stacco === null ? '    -' : stacco.toFixed(1).padStart(5)}${nota}`,
    );
  });

  const stacchi = toni.slice(1).map((t, i) => toni[i] - t);
  const minimo = Math.min(...stacchi);
  if (minimo < STACCO_MINIMO) {
    problemi += 1;
    console.log(`  ✗ stacco minimo ${minimo.toFixed(1)}, sotto la soglia di ${STACCO_MINIMO}`);
  } else {
    console.log(`  ✓ stacco minimo ${minimo.toFixed(1)}`);
  }
  await page.close();
}

await browser.close();
console.log('');
process.exit(problemi ? 1 : 0);
