/**
 * retino.js — texture a punti al posto della scala di colore.
 *
 * L'intensita' non e' resa da una tinta ma dalla fittezza di un reticolo di
 * punti: piu' i punti sono ravvicinati, piu' l'area "pesa". E' la logica dei
 * retini della stampa in bianco e nero, e regge senza colore.
 *
 * Due scelte che contano:
 *
 * 1. Il punto ha SEMPRE lo stesso diametro. Cambia solo la spaziatura. Far
 *    variare anche la dimensione darebbe due segnali sovrapposti e una texture
 *    che a meta' scala sembra fatta di puntini diversi invece che piu' fitti.
 *
 * 2. I passi sono calibrati sulla *copertura d'inchiostro* (la frazione di area
 *    coperta dai punti), non sulla spaziatura. La copertura va come 1/passo^2,
 *    quindi spaziature in progressione lineare darebbero gradini percettivi
 *    tutti sbagliati: fra 9 e 8 px l'occhio non vede quasi niente, fra 4 e 3 px
 *    vede un salto enorme. Si fissano i gradini di copertura e si ricava la
 *    spaziatura, non il contrario.
 */

import { select } from 'd3-selection';

export const LIVELLI = 9;

/** Raggio del punto, in px schermo. Costante per tutti i livelli. */
const RAGGIO = 0.8;

/** Copertura d'inchiostro agli estremi della scala. */
const COPERTURA_MIN = 0.05;
const COPERTURA_MAX = 0.4;

/**
 * Ogni livello e' una piastrella quadrata con due punti in diagonale: un
 * reticolo a mattoncino invece che a scacchiera, piu' uniforme a occhio e con
 * meno moire' quando la mappa e' in movimento.
 *
 * copertura = 2 * pi * r^2 / passo^2   ->   passo = r * sqrt(2 * pi / copertura)
 */
export function livelli() {
  const out = [];
  for (let i = 0; i < LIVELLI; i += 1) {
    const t = LIVELLI === 1 ? 0 : i / (LIVELLI - 1);
    const copertura = COPERTURA_MIN + (COPERTURA_MAX - COPERTURA_MIN) * t;
    const passo = RAGGIO * Math.sqrt((2 * Math.PI) / copertura);
    out.push({ i, passo, raggio: RAGGIO, copertura });
  }
  return out;
}

/**
 * Da valore 0-100 a livello di retino.
 * `invertito` serve perche' sulla mappa il retino piu' fitto sta dove l'indice
 * e' piu' basso: piu' inchiostro dove la situazione e' peggiore.
 */
export function livelloPer(valore, { invertito = false } = {}) {
  const v = Math.max(0, Math.min(100, Number(valore)));
  const norm = invertito ? (100 - v) / 100 : v / 100;
  return Math.min(LIVELLI - 1, Math.max(0, Math.round(norm * (LIVELLI - 1))));
}

export const idRetino = (i) => `retino-${i}`;

/** Scrive i <pattern> dentro un <defs>. Ritorna la lista dei livelli. */
export function creaRetini(defs, inchiostro) {
  const ls = livelli();
  defs
    .selectAll('pattern')
    .data(ls)
    .join('pattern')
    .attr('id', (d) => idRetino(d.i))
    .attr('class', 'retino')
    .attr('patternUnits', 'userSpaceOnUse')
    .attr('width', (d) => d.passo)
    .attr('height', (d) => d.passo)
    .each(function punti(d) {
      select(this)
        .selectAll('circle')
        .data([
          [d.passo * 0.25, d.passo * 0.25],
          [d.passo * 0.75, d.passo * 0.75],
        ])
        .join('circle')
        .attr('cx', (c) => c[0])
        .attr('cy', (c) => c[1])
        .attr('r', d.raggio)
        .attr('fill', inchiostro);
    });
  return ls;
}
