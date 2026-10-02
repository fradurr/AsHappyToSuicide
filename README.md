# The Value of Happiness

A world map of a measure that counts suicide into wellbeing instead of leaving
it out.

**[fradurr.github.io/AsHappyToSuicide](https://fradurr.github.io/AsHappyToSuicide/)**

## Why

The World Happiness Report ranks countries on a single question, put to a
sample of their residents: on a scale from 0 to 10, where does your life stand
today? It calls the answer a *life evaluation*. It is a useful measure, but it
cannot account for the people who chose to end that life.

Several countries at the top of that ranking carry some of the highest suicide
rates in the world. This map puts that tension in view rather than leaving it
outside the frame. None of it says the report is wrong: it offers a second
reading, with the calculation shown in full so anyone can check it.

## Happiness value

Not a measure anyone publishes. It is the composite built here out of those two
figures — the name and the arithmetic are both this project's.

## The formula

The two quantities cannot be compared as they are: one runs from 0 to 10, the
other counts deaths per 100,000. Both become percentiles within the group of
countries that have both figures, where 100 is the best in the group and 0 the
worst.

```
p_life    = percentile(life evaluation)   // higher is better
p_suicide = percentile(−suicide rate)     // lower is better

value     = (1 − w) × p_life + w × p_suicide        w = 0.25
```

Suicide mortality carries a quarter of the weight. At `w = 0` the result is the
World Happiness Report ranking exactly.

Percentiles rather than a min–max scale, which a single outlier would crush. And
not a ratio of the two, which would send a country with very few suicides to the
top by arithmetic alone, regardless of how it feels to live there.

The sample is 142 countries. One state is left out on purpose, before the
percentiles are computed; the method page on the site says which, and why.

## Sources

**Life evaluation** — World Happiness Report 2026, data behind Figure 2.1. A
three-year average covering 2023–2025.

**Suicide mortality** — age-standardised rates for 2021, from the World Health
Organization's Global Health Estimates, via Our World in Data, which asks to be
cited in this form:

> “Data Page: Suicide rate”, part of the following publication: Esteban
> Ortiz-Ospina and Max Roser (2016) — “Global Health”. Data adapted from World
> Health Organization. Retrieved from
> <https://archive.ourworldindata.org/20260826-190237/grapher/death-rate-from-suicides-gho.html>
> [online resource] (archived on August 26, 2026).

> Global Health Estimates 2021: Deaths by Cause, Age, Sex, by Country and by
> Region, 2000–2021. Geneva, World Health Organization; 2024.

Both citations travel inside `public/data/countries.json` under
`meta.citations`, so the numbers cannot circulate without their provenance.

## Licence

The code is under the MIT licence ([`LICENSE`](./LICENSE)). The writing and the
design are under CC BY 4.0 ([`LICENSE-CONTENT`](./LICENSE-CONTENT)).

The figures are under neither: they belong to the World Happiness Report and to
the WHO, under their own terms.
