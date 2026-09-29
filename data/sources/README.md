# Sources

`build-data.js` looks here for the two input files. Neither is committed: they
are either downloaded or filled in.

## Two routes

### A. The official files

| file | contents | where to get it |
|---|---|---|
| `whr-figure-2.1.xlsx` | life evaluation: Cantril ladder score, three-year average | [worldhappiness.report/data-sharing](https://worldhappiness.report/data-sharing/) → *Data for Figure 2.1* |
| `who-suicide-rate.csv` | age-standardised suicide rate, per 100,000 | [Our World in Data](https://ourworldindata.org/grapher/death-rate-from-suicides-gho) → *Download* → *Full data (CSV)* |

If the automatic download does not start — the WHR URL changes with every
edition, and some networks block both hosts — fetch them by hand, save them here
under those names and run `npm run build:data -- --offline`.

### B. Tables filled in by hand

```
npm run templates
```

writes `data/templates/life-evaluation.csv` and `data/templates/suicide.csv`: one row
for every country the map can draw, **with the ISO3 code and the name already
in place**. Only the last column is left to fill.

Then copy them here as `life-evaluation.csv` and `suicide.csv` and run
`npm run build:data -- --offline`.

The advantage is not convenience: an explicit ISO3 code **removes the
name-matching problem entirely**, and that is the most likely way to break the
join.

## Accepted file names

| source | one of these |
|---|---|
| life evaluation | `whr-figure-2.1.xlsx`, `whr-figure-2.1.csv`, `life-evaluation.csv`, `life-evaluation.xlsx` |
| suicide | `who-suicide-rate.csv`, `who-suicide-rate.xlsx`, `suicide.csv`, `suicide.xlsx` |

## What a table has to contain

**Life evaluation** — a score column (`Ladder score`, `life_evaluation`,
`score`) and one identifying the country: preferably the code (`iso3`, `Code`),
otherwise the name (`Country name`, `country`).

The older spellings `wellbeing.csv` and a `wellbeing` column are still accepted,
so a table filled in before the rename does not have to be redone.

**Suicide** — a column of ISO3 codes (`Code`, `iso3`) and one of values (`rate`,
`value`). `Entity` and `Year` are optional: they only matter for the Our World
in Data export, which carries several years.

For both:

- **empty cell = a country with no figure.** Legitimate: it stays blank on the
  map.
- **filled but unreadable = an error.** The build stops and names the row.
- a comma decimal separator is accepted (`6,32`);
- a life evaluation outside 0–10, or a rate outside 0–200 per 100,000, stops the
  build: almost always a wrong column or a typo.

## Where the numbers have to come from

From the official sources above. A table filled in from memory, or assembled
from scattered sources, produces a map that *looks* checkable and is not — the
exact opposite of what this project claims to do. If the two sources cover
different years, that has to be stated on the method page.

## Why the GHE estimates and not the Mortality Database

The WHO's Global Health Estimates already correct for under-reporting and
ill-defined causes of death, so they compare across countries. The raw Mortality
Database figures do not.
