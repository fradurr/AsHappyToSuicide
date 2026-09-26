# Indice di felicità corretto per i suicidi

Mappa mondiale che affianca al punteggio di benessere del World Happiness Report il
tasso di mortalità per suicidio dell'OMS, e mostra di quante posizioni si sposta un
paese quando la seconda variabile entra nel conto.

Il brief completo è in [`BRIEF-mappa-felicita.md`](./BRIEF-mappa-felicita.md).

## Stato

| | |
|---|---|
| `scripts/build-data.js` | fatto, con test |
| `src/iso-lookup.js` | fatto |
| `public/geo/countries-110m.json` | committato (Natural Earth 1:110m) |
| mappa, zoom/pan, pannello a due livelli | fatto |
| `public/data/countries.json` | **da generare**: servono le due fonti |
| identità visiva | segnaposto, da rifare |
| pagina «Metodo» | da fare |

### Dati di esempio

Finché le fonti vere non sono in `data/sources/`, il sito ripiega su
`public/data/countries.placeholder.json`: **numeri inventati**, generati da
`npm run placeholder`, che servono solo a poter guardare la mappa funzionare.
Quando ci sono, il sito ci mette sopra un avviso giallo a tutta larghezza.

**Prima di pubblicare quel file va cancellato.** È l'unica cosa nel repo che
potrebbe far sembrare reali dei numeri che non lo sono.

## Vedere il sito sul proprio computer

Serve [Node.js](https://nodejs.org) 22 o superiore. Una volta sola:

```
git clone https://github.com/fradurr/AsHappyToSuicide.git
cd AsHappyToSuicide
git checkout claude/happiness-suicide-index-map-bkbh8x
npm install
```

Poi, ogni volta:

```
npm run dev
```

e si apre <http://localhost:5173>. Il server resta in ascolto: salvando un file
la pagina si aggiorna da sola. Si ferma con Ctrl+C.

Per vedere il sito esattamente come sarà una volta pubblicato — file compressi,
nessun aiuto dello sviluppo — si usa invece:

```
npm run build && npm run preview
```

## Pubblicarlo

C'è un workflow che pubblica su GitHub Pages a ogni push. Perché funzioni serve
un passaggio a mano, una volta sola:

> repository su GitHub → **Settings** → **Pages** → *Build and deployment* →
> **Source: GitHub Actions**

Da quel momento ogni push fa girare i test, costruisce il sito e lo pubblica su
`https://fradurr.github.io/AsHappyToSuicide/`. L'avanzamento si vede nella
scheda **Actions**; da lì si può anche lanciare la pubblicazione a mano, senza
fare un push, con *Run workflow*.

Il `base` del sito viene impostato dal workflow sul nome del repository. Senza,
il sito cercherebbe i propri file nella radice del dominio e resterebbe bianco.

**Prima di pubblicare davvero**, vedi la nota sui dati di esempio qui sotto: un
sito pubblico che mostra numeri inventati sui suicidi è un danno, anche con la
fascia di avviso.

## Comandi

```
npm install
npm run build:data          # unisce le fonti e scrive public/data/countries.json
npm test                    # 32 test sul join, sui percentili e sui fallimenti
npm run dev                 # server di sviluppo Vite
npm run build               # build statica del sito
npm run placeholder         # dati FINTI, solo per vedere la mappa girare
npm run templates           # due tabelle vuote da compilare a mano
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

Le due fonti non sono committate. Due strade, entrambe descritte in
[`data/sources/README.md`](./data/sources/README.md):

1. **I file ufficiali.** `build:data` prova a scaricarli e, se non ci riesce, dice
   esattamente cosa scaricare e dove metterlo.
2. **Tabelle compilate a mano.** `npm run templates` genera due CSV con una riga per
   paese, codice ISO3 e nome già dentro: resta da riempire una colonna.

La seconda strada non è solo più comoda: il codice ISO3 esplicito elimina il problema
della corrispondenza dei nomi, che è il modo più probabile di rompere il join.

In entrambi i casi una cella vuota significa "paese senza dato" e resta grigio, mentre
una cella piena ma illeggibile ferma il build indicando la riga.

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
