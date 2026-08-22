# Indice di felicità corretto per i suicidi

Mappa mondiale che affianca al punteggio di benessere del World Happiness Report il
tasso di mortalità per suicidio dell'OMS, e mostra di quante posizioni si sposta un
paese quando la seconda variabile entra nel conto.

Il brief completo è in [`BRIEF-mappa-felicita.md`](./BRIEF-mappa-felicita.md).

## Stato

Fatto lo strato dati; il frontend non è ancora scritto (era il punto di fermata
concordato: prima si guarda la copertura, poi si disegna la mappa).

| | |
|---|---|
| `scripts/build-data.js` | fatto, con test |
| `src/iso-lookup.js` | fatto |
| `public/geo/countries-110m.json` | committato (Natural Earth 1:110m) |
| `public/data/countries.json` | **da generare**: servono le due fonti |
| mappa, pannello a due livelli, pagina metodo | da fare |

## Comandi

```
npm install
npm run build:data          # unisce le fonti e scrive public/data/countries.json
npm test                    # 16 test sul join, sui percentili e sui fallimenti
npm run dev                 # server di sviluppo Vite
npm run build               # build statica del sito
```

`build:data` e `build` sono separati di proposito: le fonti cambiano una volta
l'anno, il sito molte di piu'. Il JSON generato si committa, cosi' il deploy non ha
bisogno di scaricare niente.

Il dettaglio completo del join finisce in `data/build-report.json`: chi e' rimasto
fuori, per quale motivo, e come ogni nome del WHR e' stato risolto. Va riletto a ogni
aggiornamento delle fonti.

Opzioni di `build:data`:

```
npm run build:data -- --offline        # non scarica: usa solo le copie in data/sources/
npm run build:data -- --refresh        # riscarica le fonti anche se presenti
npm run build:data -- --weight 0.4     # peso diverso per la componente suicidi
```

## Le fonti

Le due fonti non sono committate. `build:data` prova a scaricarle e, se non ci riesce,
dice esattamente cosa scaricare e dove metterlo — vedi
[`data/sources/README.md`](./data/sources/README.md).

Se la rete blocca `worldhappiness.report` o `ourworldindata.org` (capita dietro proxy
aziendali e in ambienti CI con egress ristretto), l'unica strada è scaricare i due file
a mano e usare `--offline`.

## La formula

Entrambe le variabili diventano percentili dentro il campione dei paesi che hanno
*entrambi* i dati:

```
p_benessere = percentile(punteggio WHR)      // più alto è meglio
p_suicidi   = percentile(−tasso suicidi)     // più basso è meglio
indice      = (1 − w) × p_benessere + w × p_suicidi        w = 0.25
```

Con `w = 0` l'indice riproduce esattamente la classifica WHR — c'è un test che lo
verifica, ed è il modo più diretto per controllare che la pipeline non stia inventando
niente.

Il calcolo sta nello script di build. Il frontend riceve numeri già pronti.

## Note

- Il join avviene su ISO 3166-1 alpha-3. Se un nome del WHR non trova un codice, il
  build **si ferma**: un join rotto in silenzio è il modo più probabile di pubblicare
  una mappa sbagliata.
- I paesi senza dati restano grigi sulla mappa, non spariscono.
- I dati sui suicidi non sono ugualmente affidabili ovunque, il peso del 25% è una
  scelta arbitraria, e le due fonti coprono anni diversi. Vanno dichiarati nella pagina
  "Metodo" prima della pubblicazione.
