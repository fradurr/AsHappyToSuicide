/**
 * retino.js — texture a punti al posto della scala di colore.
 *
 * L'intensita' non e' resa da una tinta ma da un retino: piu' inchiostro, piu'
 * la grandezza rappresentata e' alta. E' la logica della stampa in bianco e
 * nero, e regge senza colore.
 *
 * Le due scelte che contano, ed entrambe nascono da una misura e non da un
 * gusto: il passo del reticolo e' un numero INTERO di pixel ed e' lo stesso a
 * ogni livello; quello che cambia da un livello all'altro e' il diametro del
 * punto.
 *
 * Perche' il passo e' intero e costante
 * -------------------------------------
 * La prima versione faceva il contrario: punto di misura fissa e passo
 * variabile, che e' la lettura intuitiva di "piu' fitto". Misurando la
 * luminanza dei livelli davvero rasterizzati si vedeva pero' che i gradini non
 * erano monotoni: passi frazionari (7,93 px, 6,66 px, 5,86 px...) cadono ogni
 * volta in una fase diversa rispetto alla griglia dei pixel, e il rasterizzatore
 * ne restituisce quantita' d'inchiostro che non seguono la progressione. Su uno
 * schermo a densita' singola due livelli adiacenti arrivavano a distare 3 punti
 * di luminanza su 255, cioe' a non distinguersi.
 *
 * Un passo intero cade sempre in fase, a densita' 1x come a 2x come a 3x. La
 * quantita' d'inchiostro diventa prevedibile, e i gradini si possono rendere
 * esattamente uniformi.
 *
 * Perche' i gradini sono uniformi in copertura
 * --------------------------------------------
 * Le classi dividono la scala dei dati in intervalli uguali. Se i toni non
 * fossero altrettanto uniformi, la mappa mentirebbe sulle proporzioni: salti
 * di tono grandi dove i dati saltano poco, e viceversa.
 */

import { select } from 'd3-selection';

/**
 * Sette livelli. Oltre le sette classi la lettura di una mappa tematica
 * peggiora comunque, e qui ogni classe in piu' stringe il gradino di tono
 * avvicinandolo alla soglia sotto cui due livelli non si distinguono.
 */
export const LIVELLI = 7;

/**
 * Passo del reticolo, in px schermo. Intero, e costante a ogni scala di zoom:
 * la trama non cambia mai misura.
 *
 * Cinque e non quattro. A passo 4 la misura della luminanza rasterizzata dice
 * che su schermo 1x gli ultimi due livelli si staccano di 1,4 su 255: punti da
 * 2,77 e 2,99 px dentro una cella da 4 px arrotondano alla stessa quantita' di
 * inchiostro. A passo 5 la cella ha abbastanza spazio perche' i due diametri
 * restino distinti, e lo stacco sale a 21.
 */
const PASSO = 5;

/** Copertura d'inchiostro agli estremi della scala. */
const COPERTURA_MIN = 0.06;
const COPERTURA_MAX = 0.46;

/**
 * Il vuoto minimo fra i bordi di due punti vicini, in px.
 *
 * Sotto il pixel quel vuoto non viene disegnato: i punti si saldano, il livello
 * piu' fitto diventa campitura piena e smette di distinguersi da quello sotto.
 * Non e' un parametro da regolare, e' il limite che COPERTURA_MAX rispetta —
 * c'e' un test che lo verifica.
 */
export const GAP_MINIMO = 1;

/**
 * Un punto per piastrella, centrato: reticolo quadrato.
 * Un reticolo sfalsato sarebbe meno meccanico a vedersi, ma lo sfalsamento cade
 * a meta' passo e quindi su mezzo pixel, rimettendo in gioco proprio l'aliasing
 * che il passo intero elimina.
 *
 * copertura = pi * r^2 / passo^2   ->   r = passo * sqrt(copertura / pi)
 */
export function livelli() {
  const out = [];
  for (let i = 0; i < LIVELLI; i += 1) {
    const t = LIVELLI === 1 ? 0 : i / (LIVELLI - 1);
    const copertura = COPERTURA_MIN + (COPERTURA_MAX - COPERTURA_MIN) * t;
    const raggio = PASSO * Math.sqrt(copertura / Math.PI);
    out.push({ i, passo: PASSO, raggio, copertura, vuoto: PASSO - 2 * raggio });
  }
  return out;
}

/**
 * Da frazione 0-1 a livello di retino. 0 = il piu' chiaro, 1 = il piu' scuro.
 * Sta a chi chiama decidere quale grandezza normalizzare: il modulo non sa cosa
 * rappresenta il retino, e non deve saperlo.
 */
export function livelloPerFrazione(t) {
  const f = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  return Math.min(LIVELLI - 1, Math.max(0, Math.round(f * (LIVELLI - 1))));
}

export const idRetino = (i) => `retino-${i}`;

/** Esportate per i test: il vincolo vive qui, non nei numeri scritti a mano. */
export const vincoli = { PASSO, GAP_MINIMO, COPERTURA_MIN, COPERTURA_MAX };

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
    .each(function punto(d) {
      select(this)
        .selectAll('circle')
        .data([d])
        .join('circle')
        .attr('cx', d.passo / 2)
        .attr('cy', d.passo / 2)
        .attr('r', d.raggio)
        .attr('fill', inchiostro);
    });
  return ls;
}
