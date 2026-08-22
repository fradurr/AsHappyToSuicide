# Fonti

`build-data.js` cerca qui i due file di partenza. Se ci sono, li usa; se mancano,
prova a scaricarli. Non sono committati: si rigenerano.

| file | contenuto | dove prenderlo |
|---|---|---|
| `whr-figure-2.1.xlsx` | punteggio Cantril, media a tre anni | [worldhappiness.report/data-sharing](https://worldhappiness.report/data-sharing/) → *Data for Figure 2.1* |
| `who-suicide-rate.csv` | tasso di suicidio standardizzato per eta, per 100.000 | [Our World in Data](https://ourworldindata.org/grapher/death-rate-from-suicides-gho) → *Download* → *Full data (CSV)* |

## Se il download automatico non funziona

L'URL del file WHR cambia a ogni edizione, e alcune reti bloccano entrambi gli
host. In quel caso scarica i due file a mano, salvali qui con i nomi della
tabella, e lancia:

```
npm run build:data -- --offline
```

Il formato atteso:

- **benessere**: prima riga di intestazione, una colonna col nome del paese
  (`Country name`) e una col punteggio (`Ladder score`). Accettati `.xlsx` e `.csv`;
  un vecchio `.xls` va riesportato.
- **suicidi**: CSV con le colonne `Entity`, `Code`, `Year` e una colonna di valori.
  Le righe senza `Code` sono aggregati regionali e vengono scartate.

## Perche' le stime GHE e non il Mortality Database

Le Global Health Estimates dell'OMS sono gia' corrette per sotto-notifica e per
cause di morte mal definite, quindi sono confrontabili fra paesi. I dati grezzi
del WHO Mortality Database non lo sono.
