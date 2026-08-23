# Fonti

`build-data.js` cerca qui i due file di partenza. Non sono committati: si
rigenerano o si ricompilano.

## Due strade

### A. I file ufficiali

| file | contenuto | dove prenderlo |
|---|---|---|
| `whr-figure-2.1.xlsx` | punteggio Cantril, media a tre anni | [worldhappiness.report/data-sharing](https://worldhappiness.report/data-sharing/) → *Data for Figure 2.1* |
| `who-suicide-rate.csv` | tasso di suicidio standardizzato per età, per 100.000 | [Our World in Data](https://ourworldindata.org/grapher/death-rate-from-suicides-gho) → *Download* → *Full data (CSV)* |

Se il download automatico non parte — l'URL del WHR cambia a ogni edizione, e
alcune reti bloccano entrambi gli host — scaricali a mano, salvali qui con
questi nomi e lancia `npm run build:data -- --offline`.

### B. Tabelle compilate a mano

```
npm run templates
```

Scrive `data/templates/benessere.csv` e `data/templates/suicidi.csv`: una riga
per ogni paese che la mappa sa disegnare, **con codice ISO3 e nome già dentro**.
Resta da riempire l'ultima colonna.

Poi copiali qui come `benessere.csv` e `suicidi.csv` e lancia
`npm run build:data -- --offline`.

Il vantaggio non è la comodità: è che il codice ISO3 esplicito **elimina del
tutto il problema della corrispondenza dei nomi**, che è il modo più probabile
di rompere il join.

## Nomi accettati

| fonte | uno di questi |
|---|---|
| benessere | `whr-figure-2.1.xlsx`, `whr-figure-2.1.csv`, `benessere.csv`, `benessere.xlsx` |
| suicidi | `who-suicide-rate.csv`, `who-suicide-rate.xlsx`, `suicidi.csv`, `suicidi.xlsx` |

## Cosa deve contenere una tabella

**Benessere** — una colonna col punteggio (`Ladder score`, `benessere`,
`punteggio`) e una che identifichi il paese: meglio il codice (`iso3`, `Code`),
in alternativa il nome (`Country name`, `paese`).

**Suicidi** — una colonna di codici ISO3 (`Code`, `iso3`) e una di valori
(`tasso`, `valore`, `rate`). `Entity` e `Year` sono facoltativi: servono solo
all'export di Our World in Data, che contiene più anni.

Valgono per entrambe:

- **cella vuota = paese senza dato.** Legittimo: resta grigio sulla mappa.
- **cella piena ma illeggibile = errore.** Il build si ferma e dice quale riga.
- la virgola decimale italiana va bene (`6,32`);
- il benessere fuori da 0–10 e un tasso fuori da 0–200 per 100.000 fermano il
  build: sono quasi sempre una colonna sbagliata o un errore di battitura.

## Da dove devono venire i numeri

Dalle fonti ufficiali sopra. Una tabella compilata a memoria o assemblata da
fonti diverse produce una mappa che *sembra* verificabile e non lo è — ed è
esattamente il contrario di quello che il progetto sostiene di fare. Se le due
fonti coprono anni diversi, va dichiarato nella pagina «Metodo».

## Perché le stime GHE e non il Mortality Database

Le Global Health Estimates dell'OMS sono già corrette per sotto-notifica e per
cause di morte mal definite, quindi sono confrontabili fra paesi. I dati grezzi
del WHO Mortality Database non lo sono.
