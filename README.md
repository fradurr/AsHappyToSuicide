# The Value of Happiness

A world map that sets the World Happiness Report's life evaluation against the
WHO's suicide mortality rate, and shows how far a country moves once the second
figure is counted in.

## Status

| | |
|---|---|
| `scripts/build-data.js` | done, with tests |
| `src/iso-lookup.js` | done |
| `public/geo/countries-110m.json` | committed (Natural Earth 1:110m) |
| map, zoom and pan, country panel | done |
| intro screen and method page | done |
| `public/data/countries.json` | **done**: 142 countries, real data |
| visual identity | placeholder, to be redone |

### The data in place

142 countries are shown. The life evaluation comes from the World Happiness
Report 2026 (a three-year average over 2023–2025), mortality from the WHO's
Global Health Estimates for 2021.

**Happiness value** is not a published measure. It is the composite built by
this project out of those two figures; the name and the arithmetic are both
ours, and both are set out on the method page.

**Israel is left out on purpose.** Its figures exist and the join finds them;
showing them is withheld on political and humanitarian grounds, in response to
the genocide in Gaza. The exclusion happens before the percentiles are computed,
so no country's position is shaped by a figure the map refuses to show. It is an
editorial decision, stated on the method page, in the country's own panel, and
in `meta.excluded` inside the published JSON.

Four countries have a life evaluation but no WHO figure — Hong Kong, Palestine,
Taiwan and Kosovo — and 51 have a WHO figure but are not in the WHR. Five more
have both but cannot be drawn at 1:110m: Singapore, Malta, Bahrain, Mauritius
and Comoros. The full account is in `data/build-report.json`.

### Sample data

`npm run placeholder` writes `public/data/countries.placeholder.json`:
**invented numbers**, useful only for seeing the map work when the real sources
are absent. The site falls back to it and carries a full-width black banner
saying so. It is not in the repository, and it must never be published.

## Seeing the site on your computer

You need [Node.js](https://nodejs.org) 22 or newer. Once:

```
git clone https://github.com/fradurr/AsHappyToSuicide.git
cd AsHappyToSuicide
git checkout claude/happiness-suicide-index-map-bkbh8x
npm install
```

Then, any time:

```
npm run dev
```

and open <http://localhost:5173>. The server keeps watching: save a file and the
page updates itself. Ctrl+C stops it.

To see the site exactly as it will be once published — minified, no development
helpers — use instead:

```
npm run build && npm run preview
```

## Publishing it

A workflow publishes to GitHub Pages on every push. It needs one manual step,
once:

> repository on GitHub → **Settings** → **Pages** → *Build and deployment* →
> **Source: GitHub Actions**

From then on every push runs the tests, builds the site and publishes it at
`https://fradurr.github.io/AsHappyToSuicide/`. Progress shows in the **Actions**
tab, and from there you can also publish by hand with *Run workflow*.

The site's `base` is set by the workflow from the repository name. Without it
the site would look for its own files at the root of the domain and come up
blank.

**Before publishing for real**, see the note on sample data above: a public site
showing invented suicide figures does harm, banner or no banner.

## Commands

```
npm install
npm run build:data          # joins the sources and writes public/data/countries.json
npm test                    # 35 tests on the join, the percentiles and the failures
npm run dev                 # Vite development server
npm run build               # static build of the site
npm run preview             # serve the build locally
npm run templates           # two empty tables to fill in by hand
npm run placeholder         # FAKE data, only to see the map work
```

`build:data` and `build` are deliberately separate: the sources change once a
year, the site far more often. The generated JSON is committed, so deploying
downloads nothing.

Options for `build:data`:

```
npm run build:data -- --offline        # never download: use only data/sources/
npm run build:data -- --refresh        # re-download even if the files are there
npm run build:data -- --weight 0.4     # a different weight for the suicide part
```

The full detail of the join lands in `data/build-report.json`: who was left out,
why, and how every source name was resolved. Worth re-reading whenever the
sources are updated.

## The sources

Neither source is committed. Two routes, both described in
[`data/sources/README.md`](./data/sources/README.md):

1. **The official files.** `build:data` tries to download them and, failing
   that, says exactly what to fetch and where to put it.
2. **Tables filled in by hand.** `npm run templates` writes
   `data/templates/life-evaluation.csv` and `data/templates/suicide.csv`, one
   row per country with the ISO3 code and name already in place: only one
   column is left to fill.

The second route is not merely more convenient: an explicit ISO3 code removes
the name-matching problem, which is the most likely way to break the join.

Either way an empty cell means "no figure for this country" and it stays blank,
while a filled but unreadable cell stops the build and names the row.

## Citing the sources

Our World in Data asks to be cited in this form, and the archive link pins the
snapshot these figures came from:

> “Data Page: Suicide rate”, part of the following publication: Esteban
> Ortiz-Ospina and Max Roser (2016) — “Global Health”. Data adapted from World
> Health Organization. Retrieved from
> <https://archive.ourworldindata.org/20260826-190237/grapher/death-rate-from-suicides-gho.html>
> [online resource] (archived on August 26, 2026).

The upstream source behind it:

> Global Health Estimates 2021: Deaths by Cause, Age, Sex, by Country and by
> Region, 2000–2021. Geneva, World Health Organization; 2024.

And for wellbeing:

> World Happiness Report 2026, Data for Figure 2.1.

All three travel inside `public/data/countries.json`, under `meta.citations`, so
the numbers cannot circulate without their provenance. They are also printed on
the site's method page.

## The formula

Both variables become percentiles within the sample of countries that have
*both* figures:

```
p_life    = percentile(life evaluation)   // higher is better
p_suicide = percentile(−suicide rate)     // lower is better
value     = (1 − w) × p_life + w × p_suicide        w = 0.25
```

At `w = 0` the value reproduces the World Happiness Report ranking exactly —
there is a test for it, and it is the most direct way to check the pipeline is
not inventing anything.

The calculation lives in the build script. The front end receives finished
numbers.

## Notes

- The join happens on ISO 3166-1 alpha-3. If a source name finds no code, the
  build **stops**: a silently broken join is the most likely way to publish a
  wrong map.
- Countries with no data stay blank on the map rather than disappearing.
- Suicide data is not equally reliable everywhere, the 25% weight is an
  arbitrary choice, and the two sources cover different years. All three are
  stated on the method page.
