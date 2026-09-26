/**
 * main.js — the map, zoom and pan, and the country panel.
 *
 * The front end does no maths: it reads a JSON that the build script has
 * already computed, and for each polygon looks up its ISO3 code. Found, and it
 * gets a tone; not found, and it stays empty.
 *
 * No colour. The subject is deaths, and a colour ramp would turn countries into
 * red and green cells, which reads as a report card. The scale is flat grey:
 * darker where suicide mortality is higher. So the map shows the deaths, and
 * the happiness value lives in the panel.
 */

// Literata: a serif drawn for reading on screen. Bookerly, the Kindle typeface,
// belongs to Amazon and has no web licence. Self-hosted through an npm package
// rather than a CDN, so the site makes no third-party requests.
import './font.css';

import { geoEqualEarth, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom } from 'd3-zoom';
import { feature } from 'topojson-client';

import { fillFor, tones, LEVELS } from './scale.js';

const BORDER_WIDTH = 0.35;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

/** The top of the scale rounds up to this, so the legend reads cleanly. */
const SCALE_STEP = 5;

/**
 * Every data file is requested relative to this base.
 *
 * On GitHub Pages the site does not sit at the root of the domain but inside a
 * folder named after the repository. A path starting with "/" would point at
 * the root and 404 everywhere except locally; Vite fills BASE_URL in at build
 * time with the right base.
 */
const BASE = import.meta.env.BASE_URL;

const fmt = (n, digits = 1) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Vite answers any unknown path with index.html, so a missing data file arrives
 * as a 200 with an HTML content type. Without this check the error would be an
 * inscrutable JSON.parse failure instead of "the file is not there".
 */
async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  if (!(res.headers.get('content-type') || '').includes('json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function loadData() {
  return (
    (await loadJson(`${BASE}data/countries.json`)) ??
    (await loadJson(`${BASE}data/countries.placeholder.json`))
  );
}

// ---------------------------------------------------------------------------

const el = {
  svg: select('#map'),
  stage: document.querySelector('.stage'),
  panel: document.getElementById('panel'),
  country: document.getElementById('country'),
  valueBlock: document.getElementById('value-block'),
  value: document.getElementById('value'),
  details: document.getElementById('details'),
  wellbeing: document.getElementById('wellbeing'),
  suicide: document.getElementById('suicide'),
  ranks: document.getElementById('ranks'),
  noData: document.getElementById('no-data'),
  closePanel: document.getElementById('close-panel'),
  notice: document.getElementById('notice'),
  intro: document.getElementById('intro'),
  enter: document.getElementById('enter'),
  readMore: document.getElementById('read-more'),
  method: document.getElementById('method'),
  methodClose: document.getElementById('method-close'),
};

/**
 * Intro screen and method text.
 *
 * Wired up outside `start()` because they have to work even if loading the data
 * fails: someone arriving on the site is entitled to know what it is about
 * either way, and the helpline numbers at the end of the method must not depend
 * on a fetch having succeeded.
 */
function wireIntroAndMethod() {
  el.enter?.addEventListener('click', () => {
    el.intro.classList.add('gone');
    // Taken out of the flow only once the transition ends, or it would vanish.
    const done = () => {
      el.intro.hidden = true;
      el.intro.removeEventListener('transitionend', done);
    };
    el.intro.addEventListener('transitionend', done);
    // With transitions off, transitionend never fires.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
    el.readMore?.focus();
  });

  // <dialog> brings the focus trap, Esc to close and focus restoration with it:
  // hand-rolling those would only be worse.
  el.readMore?.addEventListener('click', () => el.method?.showModal());
  el.methodClose?.addEventListener('click', () => el.method?.close());
  el.method?.addEventListener('click', (ev) => {
    // A click on the backdrop: the target is the dialog itself only outside the
    // content box.
    if (ev.target === el.method) el.method.close();
  });
}

wireIntroAndMethod();

async function start() {
  const [topo, geoIso, data] = await Promise.all([
    loadJson(`${BASE}geo/countries-110m.json`),
    loadJson(`${BASE}data/geo-iso.json`),
    loadData(),
  ]);

  if (!topo) {
    document.body.innerHTML =
      '<p style="padding:24px">Geometry failed to load: public/geo/countries-110m.json is missing.</p>';
    return;
  }

  if (data?.meta?.placeholder) {
    el.notice.hidden = false;
    el.notice.textContent =
      'SAMPLE DATA — these numbers are invented and bear no relation to real wellbeing or mortality.';
  }

  // Antarctica is left out: a huge mass, no source assigns it a value, and in
  // Equal Earth it takes up the whole bottom band while saying nothing.
  const EXCLUDED = new Set(['010']);
  const countries = feature(topo, topo.objects.countries).features.filter(
    (f) => !EXCLUDED.has(String(f.id)),
  );
  const byId = geoIso?.byId ?? {};
  const byName = geoIso?.byName ?? {};
  const values = data?.countries ?? {};

  const iso3Of = (f) => byId[String(f.id)] ?? byName[f.properties?.name] ?? null;

  // The scale starts at zero: for a mortality rate, starting the axis at the
  // lowest observed value would inflate differences between countries that are
  // all near the bottom.
  const rates = Object.values(values)
    .map((v) => v.suicide)
    .filter((x) => Number.isFinite(x));
  const maxRate = rates.length
    ? Math.ceil(Math.max(...rates) / SCALE_STEP) * SCALE_STEP
    : SCALE_STEP;
  const fractionOf = (rate) => (maxRate > 0 ? rate / maxRate : 0);

  const projection = geoEqualEarth();
  const path = geoPath(projection);

  drawLegend(maxRate);

  const gZoom = el.svg.append('g').attr('class', 'zoom-layer');
  const paths = gZoom
    .selectAll('path')
    .data(countries)
    .join('path')
    .attr('class', (f) => (values[iso3Of(f)] ? 'country has-data' : 'country'))
    // Inline style rather than attribute: a presentation attribute loses against
    // any CSS rule, and the background of .country would always win.
    .style('fill', (f) => {
      const v = values[iso3Of(f)];
      return v ? fillFor(fractionOf(v.suicide)) : null; // no data -> paper
    })
    .attr('stroke-width', BORDER_WIDTH)
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (f) => {
      const v = values[iso3Of(f)];
      const name = v?.name ?? f.properties?.name ?? 'unnamed';
      return v
        ? `${name}, suicide mortality ${fmt(v.suicide)} per 100,000, happiness value ${fmt(v.index)} out of 100`
        : `${name}, no data available`;
    })
    .on('click', (ev, f) => selectCountry(f))
    .on('keydown', (ev, f) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        selectCountry(f);
      }
    });

  // --- size and projection --------------------------------------------------
  function resize() {
    const { width, height } = el.stage.getBoundingClientRect();
    el.svg.attr('viewBox', `0 0 ${width} ${height}`);
    projection.fitExtent(
      [
        [8, 8],
        [width - 8, height - 8],
      ],
      { type: 'Sphere' },
    );
    paths.attr('d', path);
  }
  resize();
  new ResizeObserver(resize).observe(el.stage);

  // --- zoom and pan ---------------------------------------------------------
  el.svg.call(
    zoom()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .on('zoom', (ev) => {
        gZoom.attr('transform', ev.transform);
        // Without this the borders look like walls at high zoom.
        paths.attr('stroke-width', BORDER_WIDTH / ev.transform.k);
      }),
  );

  // --- selection ------------------------------------------------------------
  function selectCountry(f) {
    const v = values[iso3Of(f)];
    paths.classed('selected', (d) => d === f);
    el.country.textContent = v?.name ?? f.properties?.name ?? '—';

    if (v) {
      el.valueBlock.hidden = false;
      el.details.hidden = false;
      el.noData.hidden = true;
      el.value.textContent = fmt(v.index);
      el.wellbeing.textContent = fmt(v.whr, 2);
      el.suicide.textContent = fmt(v.suicide);

      const delta = v.rankDelta ?? v.rankWhr - v.rank;
      const places = (n) => (Math.abs(n) === 1 ? 'place' : 'places');
      const movement =
        delta === 0
          ? 'The same position in both rankings.'
          : delta > 0
            ? `Rises <strong>${delta}</strong> ${places(delta)} once suicides are counted.`
            : `Falls <strong>${Math.abs(delta)}</strong> ${places(delta)} once suicides are counted.`;
      el.ranks.innerHTML =
        `Position by happiness value: <strong>${v.rank}</strong>. ` +
        `By the wellbeing score alone: <strong>${v.rankWhr}</strong>. ${movement}`;
    } else {
      el.valueBlock.hidden = true;
      el.details.hidden = true;
      el.noData.hidden = false;
      el.noData.textContent = 'No data available for this country.';
    }

    open();
  }

  el.svg.on('click', (ev) => {
    if (ev.target.tagName !== 'path') close();
  });

  window.addEventListener('keydown', (ev) => {
    // While the method dialog is open, Esc belongs to it: otherwise one key
    // would close both.
    if (ev.key === 'Escape' && !el.method?.open) close();
  });

  el.closePanel.addEventListener('click', close);

  function open() {
    el.panel.inert = false;
    document.body.classList.add('panel-open');
  }

  function close() {
    document.body.classList.remove('panel-open');
    // Closed, the panel is off screen but would still be reachable by keyboard
    // and screen reader: inert actually takes it out of the way.
    el.panel.inert = true;
    paths.classed('selected', false);
  }
  el.panel.inert = true;
}

/** The legend swatches: plain rectangles, the same flat fills as the map. */
function drawLegend(maxRate) {
  const svg = select('#legend-scale');
  if (svg.empty()) return;

  const ends = document.querySelectorAll('.legend-ends span');
  if (ends.length === 2) {
    ends[0].textContent = '0';
    ends[1].textContent = String(maxRate);
  }

  const SIDE = 22;
  const GAP = 2;
  const width = LEVELS * SIDE + (LEVELS - 1) * GAP;
  svg.attr('width', width).attr('height', SIDE).attr('viewBox', `0 0 ${width} ${SIDE}`);

  // Left to right: few deaths (light) -> many deaths (dark).
  svg
    .selectAll('rect')
    .data(tones())
    .join('rect')
    .attr('x', (d) => d.i * (SIDE + GAP))
    .attr('y', 0)
    .attr('width', SIDE)
    .attr('height', SIDE)
    .attr('fill', (d) => d.fill);
}

start();
