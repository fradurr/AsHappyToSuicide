/**
 * main.js — the map, zoom and pan, and the country panel.
 *
 * The front end does no maths: it reads a JSON that the build script has
 * already computed, and for each polygon looks up its ISO3 code. Found, and it
 * gets a tone; not found, and it stays empty.
 *
 * No colour. The subject is deaths, and a colour ramp would turn countries into
 * red and green cells, which reads as a report card. The scale is flat grey,
 * darker the higher the happiness value, under a dot grain that is the same
 * everywhere. The map therefore carries the composite — the two sources already
 * weighed against each other — and the panel opens it back up into its parts.
 */

// Literata: a serif drawn for reading on screen. Bookerly, the Kindle typeface,
// belongs to Amazon and has no web licence. Self-hosted through an npm package
// rather than a CDN, so the site makes no third-party requests.
import './font.css';

import { geoEqualEarth, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
// Imported for the side effect: it is what puts .transition() on a selection,
// and d3-zoom's own transform interpolator behind it.
import 'd3-transition';
import { zoom, zoomIdentity, zoomTransform } from 'd3-zoom';
import { feature } from 'topojson-client';

import { createPatterns, createHatch, patternId, levelFor, tones, HATCH_ID, LEVELS } from './scale.js';

const BORDER_WIDTH = 0.35;

/**
 * The mark on a selected country: a hairline running inside its border, set in
 * from it by a margin. Both figures are what is seen on screen at any zoom;
 * `insetOutline` explains how they are drawn.
 */
const OUTLINE_GAP = 1;
const OUTLINE_LINE = 0.7;

/**
 * The smallest a thing can be on screen and still be found by a finger, in px.
 *
 * At world zoom Israel is 4.7px wide on a laptop and 1.2px on a phone. The
 * band around it is not a fixed halo but whatever is left of this number once
 * the shape itself is measured: wide when the shape is a sliver, nothing at
 * all once the shape is big enough to hit. It never takes from a neighbour
 * except where no click could have been accurate anyway.
 */
const MIN_TARGET = 22;

const ZOOM_MIN = 1;
/**
 * Far enough in to read a city-state. The geometry is the 110m world atlas, so
 * past about 20 the coastlines show their own corners — the limit is the
 * source, not the viewer.
 */
const ZOOM_MAX = 40;

/**
 * Selecting a country brings the map to it: close enough to see the shape the
 * panel is talking about, not so close that a small one fills the screen.
 */
const FOCUS_MAX = 18;
const FOCUS_FILL = 0.55;
const FOCUS_MS = 620;

/**
 * The scale runs the full 0–100 of the happiness value, and not the observed
 * range.
 *
 * Nothing needs capping here. The value is built from percentiles, so it spreads
 * itself evenly across the classes — which is exactly what the raw mortality
 * rate would not do: there, two countries far above everyone else took half the
 * scale and left 135 of 143 crowded into the first three tones.
 *
 * Keeping the ends at 0 and 100 also makes the legend and the panel agree: the
 * number shown for a country is on the same scale the legend describes.
 */
const VALUE_MAX = 100;

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

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Country names come from our own build, but they are still data going into
// markup: escaping them costs nothing and removes the question.
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

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
  withheld: document.getElementById('withheld'),
  stripValue: document.getElementById('strip-value'),
  placeValue: document.getElementById('place-value'),
  stripWellbeing: document.getElementById('strip-wellbeing'),
  stripSuicide: document.getElementById('strip-suicide'),
  placeWellbeing: document.getElementById('place-wellbeing'),
  placeSuicide: document.getElementById('place-suicide'),
  closePanel: document.getElementById('close-panel'),
  notice: document.getElementById('notice'),
  intro: document.getElementById('intro'),
  enter: document.getElementById('enter'),
  readMore: document.getElementById('read-more'),
  method: document.getElementById('method'),
  methodClose: document.getElementById('method-close'),
  compareBtn: document.getElementById('compare'),
  compareDialog: document.getElementById('compare-dialog'),
  compareClose: document.getElementById('compare-close'),
  compareSub: document.getElementById('compare-sub'),
  compareScroll: document.getElementById('compare-scroll'),
  compareGrid: document.getElementById('compare-grid'),
  compareLinks: document.getElementById('compare-links'),
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
  const withheld = data?.meta?.excluded ?? {};
  const total = Object.keys(values).length;

  const iso3Of = (f) => byId[String(f.id)] ?? byName[f.properties?.name] ?? null;

  const fractionOf = (value) => Math.min(1, Math.max(0, value / VALUE_MAX));

  /**
   * What a country is painted with. Null is the paper itself: no data, no
   * grain, nothing claimed.
   *
   * A withheld state is ruled over rather than left empty. Empty is what a
   * country with no figures looks like, and these figures exist.
   */
  const paintOf = (f) => {
    const iso3 = iso3Of(f);
    if (withheld[iso3]) return `url(#${HATCH_ID})`;
    const v = values[iso3];
    return v ? `url(#${patternId(levelFor(fractionOf(v.index)))})` : null;
  };

  const projection = geoEqualEarth();
  const path = geoPath(projection);

  const defs = el.svg.append('defs');
  createPatterns(defs);
  createHatch(defs);
  drawLegend();

  const gZoom = el.svg.append('g').attr('class', 'zoom-layer');
  const paths = gZoom
    .selectAll('path')
    .data(countries)
    .join('path')
    .attr('class', (f) => {
      const iso3 = iso3Of(f);
      if (withheld[iso3]) return 'country withheld';
      return values[iso3] ? 'country has-data' : 'country';
    })
    // Inline style rather than attribute: a presentation attribute loses against
    // any CSS rule, and the background of .country would always win.
    .style('fill', (f) => paintOf(f))
    .attr('stroke-width', BORDER_WIDTH)
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (f) => {
      const iso3 = iso3Of(f);
      const v = values[iso3];
      const name = v?.name ?? f.properties?.name ?? 'unnamed';
      if (withheld[iso3]) return `${name}, figures deliberately withheld`;
      return v
        ? `${name}, happiness value ${fmt(v.index)} out of 100, from a life evaluation of ${fmt(v.whr, 2)} and suicide mortality of ${fmt(v.suicide)} per 100,000`
        : `${name}, no data available`;
    })
    .on('click', (ev, f) => selectCountry(f))
    .on('keydown', (ev, f) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        selectCountry(f);
      }
    })
    // Keyboard focus is marked the same way the selection is, and only when the
    // browser judges the focus visible: a mouse click would otherwise leave a
    // ring behind on the country it just opened.
    .on('focus', (ev, f) => {
      if (ev.target.matches(':focus-visible')) focusOutline.show(f);
    })
    .on('blur', () => focusOutline.hide());


  /**
   * The mark on a selected country: a hairline inside the border, set in from
   * it, never on it.
   *
   * A stroke straddles the line it is drawn on, so an outline on the border
   * itself puts half of its weight on the neighbour. On a map where every
   * border is shared that is not cosmetic: the marked country thickens its
   * edge over whoever it touches, and the border stops being where the
   * geometry says it is.
   *
   * Three passes, all clipped to the country so that nothing can land outside
   * it. An ink band from the edge inwards, then the country's own fill painted
   * back over the outer part of that band — what is left of the ink is a line
   * floating a margin's width inside. Last the border is drawn again at its
   * normal weight, because the second pass has just covered its inner half.
   */
  function insetOutline(id) {
    const clip = defs.append('clipPath').attr('id', id).append('path');
    const g = gZoom.append('g').attr('pointer-events', 'none');
    const inside = g.append('g').attr('clip-path', `url(#${id})`);
    const line = inside.append('path').attr('class', 'outline-line');
    const gap = inside.append('path').attr('class', 'outline-gap');
    const edge = g.append('path').attr('class', 'outline-edge');
    let current = null;

    const paint = (f) => {
      const d = path(f);
      clip.attr('d', d);
      line.attr('d', d);
      gap.attr('d', d).style('stroke', paintOf(f) ?? 'var(--paper)');
      edge.attr('d', d).classed('faint', !values[iso3Of(f)] && !withheld[iso3Of(f)]);
    };

    return {
      show(f) {
        current = f;
        paint(f);
      },
      hide() {
        current = null;
        [clip, line, gap, edge].forEach((n) => n.attr('d', null));
      },
      // The projection changes with the window, the strokes with the zoom.
      redraw() {
        if (current) paint(current);
      },
      width(k) {
        line.attr('stroke-width', (2 * (OUTLINE_GAP + OUTLINE_LINE)) / k);
        gap.attr('stroke-width', (2 * OUTLINE_GAP) / k);
        edge.attr('stroke-width', BORDER_WIDTH / k);
      },
    };
  }

  // A left-out state must win the hit test inside its own borders. Its
  // neighbours are drawn after it in the TopoJSON, so without raising it a
  // click near the border lands on one of them — and on this particular state,
  // answering "no data available" instead of the note would be its own kind of
  // statement.
  paths.filter((f) => withheld[iso3Of(f)]).raise();

  // Appended after the countries, so they are never painted over. Selection and
  // keyboard focus get one each: tabbing away from the selected country must
  // not rub its outline out.
  const selectionOutline = insetOutline('outline-selected');
  const focusOutline = insetOutline('outline-focus');
  const outlines = [selectionOutline, focusOutline];
  outlines.forEach((o) => o.width(1));

  /**
   * A band of nothing around a withheld state, wide enough to be hit.
   *
   * Raising the state above its neighbours was not enough: at world zoom its
   * own outline is a few pixels across, and the click goes to whoever it
   * borders. This path paints nothing and only catches the pointer. It is
   * above everything, so within its reach the silence wins — which is the
   * point: better to answer with the statement than with Jordan's figures.
   *
   * The hit band alone is deliberate. Any other country this small is simply
   * out of reach until you zoom, and that is a limit of the map, not a claim
   * about the country.
   */
  const withheldHits = gZoom
    .selectAll('path.withheld-hit')
    .data(countries.filter((f) => withheld[iso3Of(f)]))
    .join('path')
    .attr('class', 'withheld-hit')
    .attr('aria-hidden', 'true')
    .on('click', (ev, f) => selectCountry(f));

  function sizeWithheldHits(k) {
    withheldHits.attr('stroke-width', function width() {
      const bb = this.getBBox();
      // The narrow side is the one that decides whether you can hit it.
      const narrow = Math.min(bb.width, bb.height) * k;
      return Math.max(0, MIN_TARGET - narrow) / k;
    });
  }

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
    withheldHits.attr('d', path);
    // The shapes change size with the window, and so does what is left to add.
    sizeWithheldHits(zoomTransform(el.svg.node()).k);
    outlines.forEach((o) => o.redraw());
  }
  resize();
  new ResizeObserver(resize).observe(el.stage);

  // --- zoom and pan ---------------------------------------------------------
  const zoomer = zoom()
    .scaleExtent([ZOOM_MIN, ZOOM_MAX])
    .on('zoom', (ev) => {
      const { k } = ev.transform;
      gZoom.attr('transform', ev.transform);
      // Without this the borders look like walls at high zoom.
      paths.attr('stroke-width', BORDER_WIDTH / k);
      sizeWithheldHits(k);
      outlines.forEach((o) => o.width(k));
      // Patterns live in the path's user space, so without a correction the
      // zoom would blow the grain up along with the geography. Paper grain
      // does not zoom: counter-scaling keeps it the same size on screen.
      defs.selectAll('pattern').attr('patternTransform', `scale(${1 / k})`);
    });
  el.svg.call(zoomer);

  /**
   * The part of the stage the panel is not covering, in the map's own
   * coordinates — which is where a selected country has to end up.
   *
   * On a wide screen the panel takes a column on the right and the map slides
   * left to meet it, so the visible band sits `--shift` further along than the
   * screen says. On a narrow one the panel is a sheet from the bottom and the
   * map does not move.
   */
  function viewBox() {
    const stage = el.stage.getBoundingClientRect();
    const panel = el.panel.getBoundingClientRect();
    if (matchMedia('(max-width: 720px)').matches) {
      return { x0: 0, y0: 0, x1: stage.width, y1: Math.max(160, stage.height - panel.height) };
    }
    const shift = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shift')) || 0;
    return { x0: shift, y0: 0, x1: stage.width - panel.width + shift, y1: stage.height };
  }

  /** Brings the map to a country, into the part of it that can still be seen. */
  function focusOn(f) {
    const [[x0, y0], [x1, y1]] = path.bounds(f);
    const w = Math.max(1e-6, x1 - x0);
    const h = Math.max(1e-6, y1 - y0);
    const box = viewBox();
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    if (bw <= 0 || bh <= 0) return;

    const k = Math.max(ZOOM_MIN, Math.min(FOCUS_MAX, FOCUS_FILL * Math.min(bw / w, bh / h)));
    const t = zoomIdentity
      .translate((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)
      .scale(k)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.svg.call(zoomer.transform, t);
      return;
    }
    el.svg.transition().duration(FOCUS_MS).call(zoomer.transform, t);
  }

  // --- selection ------------------------------------------------------------
  let selected = null;

  function selectCountry(f) {
    const iso3 = iso3Of(f);
    const v = values[iso3];
    paths.classed('selected', (d) => d === f);
    selectionOutline.show(f);
    selected = v ? iso3 : null;
    el.country.textContent = v?.name ?? f.properties?.name ?? '—';

    // Three states the panel can be in, and only one of them is shown at a time.
    const isWithheld = Boolean(withheld[iso3]);
    el.withheld.hidden = !isWithheld;
    el.valueBlock.hidden = isWithheld || !v;
    el.details.hidden = isWithheld || !v;
    el.noData.hidden = isWithheld || Boolean(v);

    if (isWithheld) {
      open();
      focusOn(f);
      return;
    }

    if (v) {
      el.value.textContent = fmt(v.index);
      el.wellbeing.textContent = fmt(v.whr, 2);
      el.suicide.textContent = fmt(v.suicide);

      // Where the country sits among the others, on each figure on its own.
      //
      // The two components are placed by rank: "27th highest of 142" is the
      // question their strip answers, and a rank spreads evenly where a skewed
      // rate would bunch every notch at one end.
      //
      // The happiness value is placed by the value instead. Its strip carries
      // the same seven tones as the map, so the notch has to fall in the band
      // the country is actually drawn in — by rank it would sometimes land one
      // band off, and the panel would quietly contradict the map.
      drawPlace(el.stripValue, el.placeValue, {
        rank: v.rank,
        total,
        at: fractionOf(v.index),
      });
      drawPlace(el.stripWellbeing, el.placeWellbeing, { rank: v.rankWhr, total });
      drawPlace(el.stripSuicide, el.placeSuicide, { rank: v.rankSuicide, total });

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
        `By life evaluation alone: <strong>${v.rankWhr}</strong>. ${movement}`;
    } else {
      el.noData.textContent = 'No data available for this country.';
    }

    open();
    // After the panel, so that the space it leaves is what the map aims at.
    focusOn(f);
  }

  el.svg.on('click', (ev) => {
    if (ev.target.tagName !== 'path') close();
  });

  window.addEventListener('keydown', (ev) => {
    // While a dialog is open, Esc belongs to it: otherwise one key would close
    // the dialog and the panel underneath it at the same time.
    if (ev.key === 'Escape' && !el.method?.open && !el.compareDialog?.open) close();
  });

  el.closePanel.addEventListener('click', close);

  function open() {
    el.panel.inert = false;
    document.body.classList.add('panel-open');
  }

  // --- the three rankings, side by side -------------------------------------

  /**
   * The order of the columns is the argument: you start from the life
   * evaluation, you hold it against the suicide rate, and the happiness value
   * is what comes out. The two dashed lines are those two steps.
   *
   * The lists are there to be read, not clicked through. Half of what they
   * carry is deaths, and a ranking that invites you to poke at it starts to
   * read as a leaderboard. The map stays the way in.
   */
  const RANKINGS = [
    {
      key: 'rankWhr',
      title: 'Life evaluation',
      unit: '0\u201310, highest first',
      figure: (c) => fmt(c.whr, 2),
    },
    {
      key: 'rankSuicide',
      title: 'Suicide mortality',
      unit: 'per 100,000, highest first',
      figure: (c) => fmt(c.suicide),
    },
    {
      key: 'rank',
      title: 'Happiness value',
      unit: '0\u2013100, highest first',
      figure: (c) => fmt(c.index),
      primary: true,
    },
  ];

  const ranked = Object.entries(values).map(([iso3, v]) => ({ iso3, ...v }));
  let compareBuilt = false;

  // Three columns of 142 rows, built once and on demand: someone who never
  // opens the comparison never pays for it.
  function buildCompare() {
    if (compareBuilt || !el.compareGrid) return;

    // Each head carries the selected country's own row, pinned. Three ranks far
    // apart do not fit on one screen — Finland is 1st, 13th and 27th — so the
    // lists alone would answer the question only after a scroll.
    const heads = RANKINGS.map(
      (r) =>
        `<div${r.primary ? ' class="is-primary"' : ''}>` +
        `<h3>${r.title}</h3><p class="compare-unit">${r.unit}</p>` +
        `<p class="compare-mark"></p></div>`,
    ).join('');

    const columns = RANKINGS.map((r) => {
      const rows = [...ranked]
        .sort((a, b) => a[r.key] - b[r.key])
        .map(
          (c) =>
            `<li data-iso="${c.iso3}"><span class="rank">${c[r.key]}</span>` +
            `<span class="name">${esc(c.name)}</span>` +
            `<span class="figure">${r.figure(c)}</span></li>`,
        )
        .join('');
      return (
        `<section class="compare-col${r.primary ? ' is-primary' : ''}">` +
        `<ol class="compare-list">${rows}</ol></section>`
      );
    }).join('');

    // Appended rather than assigned: the overlay the connectors are drawn on is
    // already in there.
    el.compareGrid.insertAdjacentHTML('beforeend', `<div class="compare-heads">${heads}</div>${columns}`);
    compareBuilt = true;
  }

  function markCompare(iso3) {
    const v = values[iso3];
    el.compareGrid.querySelectorAll('li.is-current').forEach((li) => li.classList.remove('is-current'));
    if (!v) return;

    el.compareGrid
      .querySelectorAll(`li[data-iso="${iso3}"]`)
      .forEach((li) => li.classList.add('is-current'));

    el.compareGrid.querySelectorAll('.compare-mark').forEach((node, i) => {
      const r = RANKINGS[i];
      node.innerHTML =
        `<span class="rank">${v[r.key]}</span>` +
        `<span class="name">${esc(v.name)}</span>` +
        `<span class="figure">${r.figure(v)}</span>`;
    });

    const delta = v.rankDelta ?? v.rankWhr - v.rank;
    const places = Math.abs(delta) === 1 ? 'place' : 'places';
    el.compareSub.textContent =
      delta === 0
        ? `${v.name} holds its position once suicides are counted. ${total} countries in each column.`
        : delta > 0
          ? `${v.name} rises ${delta} ${places} once suicides are counted. ${total} countries in each column.`
          : `${v.name} falls ${Math.abs(delta)} ${places} once suicides are counted. ${total} countries in each column.`;
  }

  /** Brings the three marked rows into view, centred on the span between them. */
  function scrollToMarks() {
    const rows = [...el.compareGrid.querySelectorAll('li.is-current')];
    if (!rows.length) return;
    const top = el.compareGrid.getBoundingClientRect().top;
    const ys = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top - top + b.height / 2;
    });
    const middle = (Math.min(...ys) + Math.max(...ys)) / 2;
    el.compareScroll.scrollTop = Math.max(0, middle - el.compareScroll.clientHeight / 2);
  }

  /**
   * The line joining the same country across the three columns.
   *
   * Drawn in the coordinates of the grid, which is the scrolled content: the
   * line then travels with the rows and needs nothing on scroll.
   */
  function drawLinks() {
    if (!el.compareLinks) return;
    const w = el.compareGrid.offsetWidth;
    const h = el.compareGrid.offsetHeight;
    el.compareLinks.setAttribute('width', w);
    el.compareLinks.setAttribute('height', h);
    el.compareLinks.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const rows = [...el.compareGrid.querySelectorAll('li.is-current')];
    if (rows.length < 2) {
      el.compareLinks.innerHTML = '';
      return;
    }
    const box = el.compareGrid.getBoundingClientRect();
    // Document order is column order.
    const pts = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return { left: b.left - box.left, right: b.right - box.left, y: b.top - box.top + b.height / 2 };
    });
    let d = '';
    for (let i = 0; i < pts.length - 1; i += 1) {
      d += `M${pts[i].right} ${pts[i].y}L${pts[i + 1].left} ${pts[i + 1].y}`;
    }
    el.compareLinks.innerHTML = `<path class="link" d="${d}" />`;
  }

  el.compareBtn?.addEventListener('click', () => {
    if (!selected) return;
    buildCompare();
    markCompare(selected);
    el.compareDialog.showModal();
    // After the dialog has been laid out: before that every row measures zero.
    requestAnimationFrame(() => {
      scrollToMarks();
      drawLinks();
    });
  });

  el.compareClose?.addEventListener('click', () => el.compareDialog?.close());
  el.compareDialog?.addEventListener('click', (ev) => {
    if (ev.target === el.compareDialog) el.compareDialog.close();
  });
  // The columns change width with the window, and the connectors are in pixels.
  if (el.compareGrid) new ResizeObserver(drawLinks).observe(el.compareGrid);

  function close() {
    document.body.classList.remove('panel-open');
    selectionOutline.hide();
    selected = null;
    // Closed, the panel is off screen but would still be reachable by keyboard
    // and screen reader: inert actually takes it out of the way.
    el.panel.inert = true;
    paths.classed('selected', false);
  }
  el.panel.inert = true;
}

/**
 * The position strip under one figure: the whole scale in the map's seven
 * tones, with a notch where this country falls.
 *
 * No icon and no symbol. Half of what this panel reports is deaths, and a mark
 * that reads as a rating would turn a number of people into a verdict.
 *
 * @param rank 1 is the highest value of the quantity above the strip.
 * @param at   Optional 0\u20131 position for the notch. Given, it overrides the
 *             rank: the happiness value uses it so the notch lands in the tone
 *             the country is drawn in on the map.
 */
function drawPlace(node, text, { rank, total, at, direction = 'highest' }) {
  if (!node || !Number.isFinite(rank) || total < 2) return;

  const svg = select(node);
  const W = 300;
  const H = 7;
  svg.attr('viewBox', `0 0 ${W} ${H + 6}`).attr('preserveAspectRatio', 'none');

  svg
    .selectAll('rect.band')
    .data(tones())
    .join('rect')
    .attr('class', 'band')
    .attr('x', (d) => (d.i * W) / LEVELS)
    .attr('y', 0)
    .attr('width', W / LEVELS + 0.5)
    .attr('height', H)
    .attr('fill', (d) => d.fill);

  // By rank unless told otherwise: a skewed quantity would bunch every notch at
  // one end and say nothing about where a country stands.
  //
  // Clamped by half the notch's width, or the first and last countries would
  // have half a triangle hanging outside the drawing.
  const pos = Number.isFinite(at) ? at : (total - rank) / (total - 1);
  const half = 4;
  const x = Math.min(W - half, Math.max(half, pos * W));
  svg
    .selectAll('polygon.notch')
    .data([x])
    .join('polygon')
    .attr('class', 'notch')
    .attr('points', (d) => `${d - 4},${H + 6} ${d + 4},${H + 6} ${d},${H + 0.5}`);

  text.innerHTML = `<b>${ordinal(rank)}</b> ${direction} of ${total}`;
}

/** The legend swatches: the same patterns as the map, under their own prefix. */
function drawLegend() {
  const svg = select('#legend-scale');
  if (svg.empty()) return;

  const SIDE = 22;
  const GAP = 2;
  const width = LEVELS * SIDE + (LEVELS - 1) * GAP;
  svg.attr('width', width).attr('height', SIDE).attr('viewBox', `0 0 ${width} ${SIDE}`);

  createPatterns(svg.append('defs'), 'legend');

  // Left to right: low value (light) -> high value (dark).
  //
  // The swatches live in their own <g> and are selected from there. A plain
  // svg.selectAll('rect') would also pick up the background rects inside the
  // <pattern> elements, which are descendants of the same <svg>: d3 would bind
  // the data onto those and the legend would come out empty.
  svg
    .append('g')
    .attr('class', 'swatches')
    .selectAll('rect')
    .data(tones())
    .join('rect')
    .attr('x', (d) => d.i * (SIDE + GAP))
    .attr('y', 0)
    .attr('width', SIDE)
    .attr('height', SIDE)
    .attr('fill', (d) => `url(#${patternId(d.i, 'legend')})`);
}

start();
