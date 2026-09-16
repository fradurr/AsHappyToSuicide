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

/**
 * Raggio del punto, in px schermo. Costante per tutti i livelli, e costante a
 * ogni scala di zoom: il punto non cresce mai.
 *
 * La misura e' un compromesso voluto. Piu' piccolo darebbe un tono piu' liscio
 * da lontano, ma sotto il pixel i punti sfarfallano quando la mappa si muove e
 * zoomando non si distinguerebbero comunque. A questa misura una nazione
 * piccola nella vista mondiale si legge come grigio, e la stessa nazione
 * ingrandita mostra che quel grigio e' un reticolo di pallini.
 */
const RAGGIO = 0.8;

/**
 * Copertura d'inchiostro agli estremi della scala.
 * Il minimo e' alto abbastanza da leggersi come grigio chiaro e non come punti
 * sparsi — serve a simulare una sfumatura continua, e serve anche a non
 * confondere il livello piu' chiaro con i paesi vuoti, che di punti non ne
 * hanno nessuno.
 */
const COPERTURA_MIN = 0.12;
const COPERTURA_MAX = 0.62;

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
 * Da frazione 0-1 a livello di retino. 0 = il piu' rado, 1 = il piu' fitto.
 * Sta a chi chiama decidere quale grandezza normalizzare: il modulo non sa
 * cosa rappresenta il retino, e non deve saperlo.
 */
export function livelloPerFrazione(t) {
  const f = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  return Math.min(LIVELLI - 1, Math.max(0, Math.round(f * (LIVELLI - 1))));
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
