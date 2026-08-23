/**
 * main.js — mappa coropletica, zoom/pan, pannello a due livelli.
 *
 * Il frontend non fa matematica: legge un JSON gia' calcolato e per ogni
 * poligono cerca il suo ISO3. Trovato -> colore. Non trovato -> grigio.
 */

import { geoEqualEarth, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom } from 'd3-zoom';
import { scaleLinear } from 'd3-scale';
import { feature } from 'topojson-client';

const SPESSORE_CONFINE = 0.3;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

// Scala divergente segnaposto: rosso profondo -> neutro -> verde-teal.
const colore = scaleLinear()
  .domain([0, 50, 100])
  .range(['#8e1b22', '#e9e4da', '#12655e'])
  .clamp(true);

const fmt = (n, d = 1) => n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Vite risponde con l'index.html a qualsiasi percorso sconosciuto, quindi un
 * file dati mancante arriva come 200 con content-type html. Senza questo
 * controllo l'errore sarebbe un JSON.parse incomprensibile invece di
 * "il file non c'e'".
 */
async function caricaJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const tipo = res.headers.get('content-type') || '';
  if (!tipo.includes('json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function caricaDati() {
  const veri = await caricaJson('/data/countries.json');
  if (veri) return veri;
  const finti = await caricaJson('/data/countries.placeholder.json');
  if (finti) return finti;
  return null;
}

// ---------------------------------------------------------------------------

const el = {
  svg: select('#mappa'),
  scena: document.querySelector('.scena'),
  pannello: document.getElementById('pannello'),
  paese: document.getElementById('paese'),
  indiceBtn: document.getElementById('indice-btn'),
  indice: document.getElementById('indice'),
  dettagli: document.getElementById('dettagli'),
  whr: document.getElementById('whr'),
  suicidi: document.getElementById('suicidi'),
  posizioni: document.getElementById('posizioni'),
  senzaDati: document.getElementById('senza-dati'),
  chiudi: document.getElementById('chiudi'),
  avviso: document.getElementById('avviso'),
};

async function avvia() {
  const [topo, geoIso, dati] = await Promise.all([
    caricaJson('/geo/countries-110m.json'),
    caricaJson('/data/geo-iso.json'),
    caricaDati(),
  ]);

  if (!topo) {
    document.body.innerHTML = '<p style="padding:24px">Geometrie non caricate: manca public/geo/countries-110m.json</p>';
    return;
  }

  if (dati?.meta?.placeholder) {
    el.avviso.hidden = false;
    el.avviso.textContent =
      'DATI DI ESEMPIO — i numeri sono inventati e non hanno alcun rapporto con il benessere o la mortalità reali.';
  }

  // L'Antartide si esclude: e' una massa enorme, nessuna fonte le attribuisce
  // un dato, e in Equal Earth occupa tutta la fascia bassa senza dire niente.
  const ESCLUSI = new Set(['010']);
  const paesi = feature(topo, topo.objects.countries).features.filter(
    (f) => !ESCLUSI.has(String(f.id)),
  );
  const byId = geoIso?.byId ?? {};
  const byName = geoIso?.byName ?? {};
  const valori = dati?.countries ?? {};

  const iso3Di = (f) => byId[String(f.id)] ?? byName[f.properties?.name] ?? null;

  const proiezione = geoEqualEarth();
  const percorso = geoPath(proiezione);

  const gZoom = el.svg.append('g').attr('class', 'zoom-layer');
  const selPaesi = gZoom
    .selectAll('path')
    .data(paesi)
    .join('path')
    .attr('class', (f) => (valori[iso3Di(f)] ? 'paese ha-dati' : 'paese'))
    // Stile inline e non attributo: un attributo di presentazione perde
    // contro qualsiasi regola CSS, e il grigio di .paese vincerebbe sempre.
    .style('fill', (f) => {
      const v = valori[iso3Di(f)];
      return v ? colore(v.index) : null; // null -> resta il grigio del CSS
    })
    .attr('stroke-width', SPESSORE_CONFINE)
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (f) => {
      const iso3 = iso3Di(f);
      const v = valori[iso3];
      const nome = v?.name ?? f.properties?.name ?? 'senza nome';
      return v ? `${nome}, indice ${fmt(v.index)}` : `${nome}, dati non disponibili`;
    })
    .on('click', (ev, f) => seleziona(f))
    .on('keydown', (ev, f) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        seleziona(f);
      }
    });

  // --- dimensione e proiezione ---------------------------------------------
  function ridimensiona() {
    const { width, height } = el.scena.getBoundingClientRect();
    el.svg.attr('viewBox', `0 0 ${width} ${height}`);
    proiezione.fitExtent(
      [
        [8, 8],
        [width - 8, height - 8],
      ],
      { type: 'Sphere' },
    );
    selPaesi.attr('d', percorso);
  }
  ridimensiona();
  new ResizeObserver(ridimensiona).observe(el.scena);

  // --- zoom e pan -----------------------------------------------------------
  const comportamentoZoom = zoom()
    .scaleExtent([ZOOM_MIN, ZOOM_MAX])
    .on('zoom', (ev) => {
      gZoom.attr('transform', ev.transform);
      // Senza questo i confini a zoom alto sembrano muri.
      selPaesi.attr('stroke-width', SPESSORE_CONFINE / ev.transform.k);
    });
  el.svg.call(comportamentoZoom);

  // --- selezione ------------------------------------------------------------
  function seleziona(f) {
    const iso3 = iso3Di(f);
    const v = valori[iso3];
    const nome = v?.name ?? f.properties?.name ?? '—';

    selPaesi.classed('selezionato', (d) => d === f);

    el.paese.textContent = nome;

    // Ogni nuova selezione riporta il pannello al livello 1: l'apertura deve
    // restare un gesto, non diventare una preferenza permanente.
    chiudiDettagli();

    if (v) {
      el.indiceBtn.hidden = false;
      el.senzaDati.hidden = true;
      el.indice.textContent = fmt(v.index);
      el.whr.textContent = fmt(v.whr, 2);
      el.suicidi.textContent = fmt(v.suicide);

      const delta = v.rankDelta ?? v.rankWhr - v.rank;
      const verso =
        delta === 0
          ? 'Stessa posizione nelle due classifiche.'
          : delta > 0
            ? `Sale di <strong>${delta}</strong> ${delta === 1 ? 'posizione' : 'posizioni'} quando i suicidi entrano nel conto.`
            : `Scende di <strong>${Math.abs(delta)}</strong> ${Math.abs(delta) === 1 ? 'posizione' : 'posizioni'} quando i suicidi entrano nel conto.`;
      el.posizioni.innerHTML =
        `Posizione con l'indice corretto: <strong>${v.rank}</strong>. ` +
        `Con il solo punteggio di benessere: <strong>${v.rankWhr}</strong>. ${verso}`;
    } else {
      el.indiceBtn.hidden = true;
      el.senzaDati.hidden = false;
      el.senzaDati.textContent = 'Dati non disponibili per questo paese.';
    }

    apri();
  }

  el.svg.on('click', (ev) => {
    if (ev.target.tagName !== 'path') chiudi();
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') chiudi();
  });

  el.chiudi.addEventListener('click', chiudi);

  el.indiceBtn.addEventListener('click', () => {
    const aperto = el.indiceBtn.getAttribute('aria-expanded') === 'true';
    if (aperto) chiudiDettagli();
    else {
      el.indiceBtn.setAttribute('aria-expanded', 'true');
      el.dettagli.hidden = false;
    }
  });

  function chiudiDettagli() {
    el.indiceBtn.setAttribute('aria-expanded', 'false');
    el.dettagli.hidden = true;
  }

  function apri() {
    el.pannello.inert = false;
    document.body.classList.add('pannello-aperto');
  }

  function chiudi() {
    document.body.classList.remove('pannello-aperto');
    // Chiuso il pannello e' fuori schermo ma resterebbe raggiungibile da
    // tastiera e dallo screen reader: inert lo toglie di mezzo davvero.
    el.pannello.inert = true;
    selPaesi.classed('selezionato', false);
  }
  el.pannello.inert = true;
}

avvia();
