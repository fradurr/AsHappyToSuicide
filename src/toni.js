/**
 * toni.js — la scala di grigi con cui la mappa rappresenta la mortalita'.
 *
 * Niente colore: il tema parla di morti, e una scala cromatica trasformerebbe
 * i paesi in caselle rosse e verdi, cioe' in una pagella.
 *
 * Il segnale e' il TONO: un grigio pieno, uno per classe. Sopra ogni tono c'e'
 * una griglia di punti finissima, uguale per tutti i livelli: e' grana di
 * carta, non informazione. Non varia col dato e non va letta.
 *
 * Com'era prima, e perche' e' cambiato
 * ------------------------------------
 * La prima versione affidava il dato alla fittezza dei punti, come un retino
 * tipografico. Funzionava sulla carta e reggeva la misura, ma a schermo una
 * texture che cambia densita' sotto gli occhi e' faticosa da guardare: si
 * legge il brulichio prima del dato. Un tono pieno si legge e basta, e in piu'
 * non ha nulla da rasterizzare: niente aliasing, niente livelli che collassano
 * su schermi a densita' diversa. La griglia resta, ma smette di lavorare.
 */

import { select } from 'd3-selection';

/**
 * Sette classi. Oltre le sette la lettura di una mappa tematica peggiora:
 * diventano troppe per tenerle a mente guardando la legenda.
 */
export const LIVELLI = 7;

/**
 * Gli estremi della scala, in grigi caldi coerenti con la carta.
 *
 * Il piu' chiaro e' scelto apertamente piu' scuro del fondo: i paesi senza dati
 * restano color carta, e un primo livello troppo tenue si confonderebbe con
 * loro. Il piu' scuro si ferma prima del nero, perche' i confini sono tracciati
 * in inchiostro e su un fondo nero sparirebbero.
 */
const CHIARO = [222, 216, 205];
const SCURO = [75, 70, 64];

/** Passo della griglia, in px schermo. Intero: cade in fase con i pixel. */
const PASSO = 5;

/** Raggio del punto della griglia. Piccolo: deve sentirsi, non vedersi. */
const RAGGIO = 0.7;

/**
 * Di quanto il punto e' piu' scuro del tono su cui sta, in livelli RGB.
 *
 * E' una sottrazione e non una mescolanza verso l'estremo scuro: mescolando,
 * sull'ultima classe il punto coinciderebbe col fondo e la grana sparirebbe
 * proprio dove il tono e' piu' pieno. Sottraendo, la grana resta la stessa su
 * tutta la scala. Venti livelli su 255 sono sotto la soglia della texture
 * "vista": si sente, non si guarda.
 */
const SCURIMENTO_GRIGLIA = 20;

const lerp = (a, b, t) => a + (b - a) * t;
const rgb = ([r, g, b]) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;

/** Mescola due colori: 0 = tutto il primo, 1 = tutto il secondo. */
const mescola = (a, b, t) => a.map((c, i) => lerp(c, b[i], t));

const scurisci = (c, quanto) => c.map((v) => Math.max(0, v - quanto));

/** I sette toni, dal piu' chiaro al piu' scuro, con il punto della griglia. */
export function toni() {
  const out = [];
  for (let i = 0; i < LIVELLI; i += 1) {
    const t = LIVELLI === 1 ? 0 : i / (LIVELLI - 1);
    const base = mescola(CHIARO, SCURO, t);
    out.push({
      i,
      tono: rgb(base),
      // Il punto e' lo stesso tono, piu' scuro di una quantita' fissa.
      punto: rgb(scurisci(base, SCURIMENTO_GRIGLIA)),
      passo: PASSO,
      raggio: RAGGIO,
    });
  }
  return out;
}

/**
 * Da frazione 0-1 a classe. 0 = il piu' chiaro, 1 = il piu' scuro.
 * Sta a chi chiama decidere quale grandezza normalizzare: il modulo non sa cosa
 * rappresenta la scala, e non deve saperlo.
 */
export function livelloPerFrazione(t) {
  const f = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  return Math.min(LIVELLI - 1, Math.max(0, Math.round(f * (LIVELLI - 1))));
}

/**
 * L'id di un pattern. Il prefisso serve perche' mappa e legenda sono due <svg>
 * distinti nella stessa pagina: con lo stesso id il documento ne conterrebbe due
 * copie, e a quale delle due punti un url(#id) non e' definito da nessuna parte.
 */
export const idTono = (i, prefisso = 'tono') => `${prefisso}-${i}`;

/** Esportate per i test: i vincoli vivono qui, non nei numeri scritti a mano. */
export const vincoli = { PASSO, RAGGIO, CHIARO, SCURO, SCURIMENTO_GRIGLIA };

/**
 * Scrive i <pattern> dentro un <defs>: fondo pieno piu' un punto per piastrella.
 * Il fondo sta dentro al pattern invece che sul path perche' cosi' tono e grana
 * restano una cosa sola, e chi disegna deve solo scegliere l'id.
 */
export function creaToni(defs, prefisso = 'tono') {
  const ls = toni();
  defs
    .selectAll('pattern')
    .data(ls)
    .join('pattern')
    .attr('id', (d) => idTono(d.i, prefisso))
    .attr('class', 'tono')
    .attr('patternUnits', 'userSpaceOnUse')
    .attr('width', (d) => d.passo)
    .attr('height', (d) => d.passo)
    .each(function disegna(d) {
      const p = select(this);
      p.selectAll('rect')
        .data([d])
        .join('rect')
        .attr('width', d.passo)
        .attr('height', d.passo)
        .attr('fill', d.tono);
      p.selectAll('circle')
        .data([d])
        .join('circle')
        .attr('cx', d.passo / 2)
        .attr('cy', d.passo / 2)
        .attr('r', d.raggio)
        .attr('fill', d.punto);
    });
  return ls;
}
