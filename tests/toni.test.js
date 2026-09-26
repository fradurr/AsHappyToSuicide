import test from 'node:test';
import assert from 'node:assert/strict';

import { toni, livelloPerFrazione, idTono, vincoli, LIVELLI } from '../src/toni.js';

/** "rgb(222 216 205)" -> [222, 216, 205] */
const canali = (s) => s.match(/\d+/g).map(Number);
/** Luminanza percepita, per confrontare due toni come li vede l'occhio. */
const luminanza = (s) => {
  const [r, g, b] = canali(s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test('la scala va dal chiaro allo scuro senza tornare indietro', () => {
  const ls = toni();
  assert.equal(ls.length, LIVELLI);
  for (let i = 1; i < ls.length; i += 1) {
    assert.ok(
      luminanza(ls[i].tono) < luminanza(ls[i - 1].tono),
      `livello ${i}: deve essere piu' scuro del precedente`,
    );
  }
});

test('ogni classe si stacca dalla precedente abbastanza da vedersi', () => {
  const ls = toni();
  const stacchi = ls.slice(1).map((t, i) => luminanza(ls[i].tono) - luminanza(t.tono));
  // Un tono pieno non ha nulla da rasterizzare: lo stacco misurato qui e' lo
  // stesso che arriva a schermo, a qualunque densita' di pixel. Era il problema
  // della versione a retino, dove la resa dipendeva dall'aliasing.
  for (const [i, s] of stacchi.entries()) {
    assert.ok(s > 10, `classi ${i} e ${i + 1} troppo vicine: ${s.toFixed(1)} su 255`);
  }
});

test('il primo tono e piu scuro della carta, o si confonde coi paesi vuoti', () => {
  // La carta e' #efebe4; i paesi senza dati restano di quel colore.
  const carta = 0.2126 * 0xef + 0.7152 * 0xeb + 0.0722 * 0xe4;
  assert.ok(carta - luminanza(toni()[0].tono) > 10, 'il primo tono sparisce sul fondo');
});

test("l'ultimo tono non arriva al nero, o i confini spariscono", () => {
  // I confini sono tracciati in inchiostro (#26241f): serve stacco anche li'.
  const inchiostro = 0.2126 * 0x26 + 0.7152 * 0x24 + 0.0722 * 0x1f;
  assert.ok(luminanza(toni().at(-1).tono) - inchiostro > 10);
});

test('la griglia e grana, non informazione: stesso passo e stesso punto ovunque', () => {
  const ls = toni();
  assert.equal(new Set(ls.map((t) => t.passo)).size, 1);
  assert.equal(new Set(ls.map((t) => t.raggio)).size, 1);
  assert.ok(Number.isInteger(vincoli.PASSO), 'passo intero: cade in fase coi pixel');
});

test('il punto della griglia resta visibile su tutta la scala, estremi inclusi', () => {
  for (const t of toni()) {
    const d = luminanza(t.tono) - luminanza(t.punto);
    // Sul livello piu' scuro una mescolanza verso l'estremo darebbe zero: e' il
    // motivo per cui il punto si ottiene sottraendo, non mescolando.
    assert.ok(d > 5, `livello ${t.i}: la grana sparisce (stacco ${d.toFixed(1)})`);
    assert.ok(d < 40, `livello ${t.i}: la grana si fa notare troppo (${d.toFixed(1)})`);
  }
});

test('livelloPerFrazione copre la scala e regge i valori fuori campo', () => {
  assert.equal(livelloPerFrazione(0), 0);
  assert.equal(livelloPerFrazione(1), LIVELLI - 1);
  assert.equal(livelloPerFrazione(0.5), Math.round(0.5 * (LIVELLI - 1)));
  assert.equal(livelloPerFrazione(3), LIVELLI - 1);
  assert.equal(livelloPerFrazione(-1), 0);
  for (const brutto of [NaN, undefined, null, 'x']) {
    assert.equal(livelloPerFrazione(brutto), 0, `${brutto} deve cadere sul tono piu' chiaro`);
  }
});

test('ogni livello ha un id di pattern distinto, e i prefissi non si scontrano', () => {
  assert.equal(new Set(toni().map((t) => idTono(t.i))).size, LIVELLI);
  // Mappa e legenda sono due <svg> nella stessa pagina: id uguali renderebbero
  // indefinito a quale pattern punta un url(#id).
  const mappa = toni().map((t) => idTono(t.i, 'tono'));
  const legenda = toni().map((t) => idTono(t.i, 'legenda'));
  assert.equal(new Set([...mappa, ...legenda]).size, LIVELLI * 2);
});
