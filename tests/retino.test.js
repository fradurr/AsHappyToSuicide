import test from 'node:test';
import assert from 'node:assert/strict';

import { livelli, livelloPerFrazione, idRetino, vincoli, LIVELLI } from '../src/retino.js';

test('il vuoto fra due punti resta visibile a ogni livello', () => {
  // E' il vincolo che tiene distinguibile il livello piu' fitto da quello sotto
  // anche sugli schermi a densita' singola: sotto il pixel il vuoto non viene
  // disegnato, i punti si saldano e i due livelli collassano nello stesso nero.
  for (const l of livelli()) {
    assert.ok(
      l.vuoto >= vincoli.GAP_MINIMO - 1e-9,
      `livello ${l.i}: vuoto ${l.vuoto.toFixed(2)}px sotto il minimo di ${vincoli.GAP_MINIMO}px`,
    );
  }
});

test('la copertura cresce in modo monotono e a passi uguali', () => {
  const ls = livelli();
  const salti = ls.slice(1).map((l, i) => l.copertura - ls[i].copertura);
  for (const s of salti) assert.ok(s > 0, 'la copertura deve sempre crescere');
  const max = Math.max(...salti);
  const min = Math.min(...salti);
  assert.ok(max - min < 1e-9, 'i gradini devono essere uniformi');
  // Sotto i tre punti percentuali due livelli adiacenti non si distinguono.
  assert.ok(min > 0.03, `salto troppo piccolo: ${(min * 100).toFixed(1)} punti`);
});

test('il passo e un intero, uguale a ogni livello', () => {
  // E' il punto chiave: un passo frazionario cade in fase diversa rispetto alla
  // griglia dei pixel a ogni livello, e i toni rasterizzati smettono di seguire
  // la progressione. Un passo intero e' in fase a 1x, 2x e 3x.
  assert.ok(Number.isInteger(vincoli.PASSO), 'il passo deve essere intero');
  const passi = new Set(livelli().map((l) => l.passo));
  assert.equal(passi.size, 1);
  assert.ok(Number.isInteger([...passi][0]));
});

test('il punto cresce in modo monotono', () => {
  const ls = livelli();
  for (let i = 1; i < ls.length; i += 1) {
    assert.ok(ls[i].raggio > ls[i - 1].raggio, `livello ${i}: il punto deve crescere`);
  }
});

test('il livello piu scuro resta staccato da quello sotto', () => {
  const ls = livelli();
  const ultimo = ls.at(-1);
  const penultimo = ls.at(-2);
  // Se il piu' scuro saturasse, i due collasserebbero nello stesso nero.
  assert.ok(ultimo.vuoto >= vincoli.GAP_MINIMO - 1e-9, 'il piu scuro satura');
  assert.ok(ultimo.copertura - penultimo.copertura > 0.03);
  assert.ok(ultimo.copertura < 0.55, 'oltre questa copertura il reticolo si chiude');
});

test('livelloPerFrazione copre la scala e regge i valori fuori campo', () => {
  assert.equal(livelloPerFrazione(0), 0);
  assert.equal(livelloPerFrazione(1), LIVELLI - 1);
  assert.equal(livelloPerFrazione(0.5), Math.round(0.5 * (LIVELLI - 1)));
  // Un tasso oltre il massimo della scala satura invece di uscire dall'array.
  assert.equal(livelloPerFrazione(3), LIVELLI - 1);
  assert.equal(livelloPerFrazione(-1), 0);
  for (const brutto of [NaN, undefined, null, 'x']) {
    assert.equal(livelloPerFrazione(brutto), 0, `${brutto} deve cadere sul livello piu' rado`);
  }
});

test('ogni livello ha un id di pattern distinto', () => {
  const ids = new Set(livelli().map((l) => idRetino(l.i)));
  assert.equal(ids.size, LIVELLI);
});
