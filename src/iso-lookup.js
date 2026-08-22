/**
 * Tabella di conversione: nome del paese nel World Happiness Report -> ISO 3166-1 alpha-3.
 *
 * Il WHR pubblica i paesi solo per nome, in inglese, senza codice. Le grafie non
 * seguono nessuno standard e cambiano tra un'edizione e l'altra ("Czech Republic"
 * diventa "Czechia", "Turkey" diventa "Turkiye"). Questa tabella e' l'unico punto
 * in cui quelle grafie vengono riconciliate.
 *
 * Regole:
 *   - una voce qui vince sempre sulla risoluzione automatica;
 *   - i nomi che coincidono gia' con la denominazione ISO inglese (Italy, France,
 *     Finland...) non hanno bisogno di una voce: li risolve `resolveIso3`;
 *   - `null` significa "entita' senza codice ISO 3166-1, esclusa di proposito":
 *     e' una decisione esplicita, non una dimenticanza.
 *
 * Se un nome non viene risolto ne' qui ne' automaticamente, lo script di build
 * si ferma con un errore. Un join rotto in silenzio e' il modo piu' probabile di
 * pubblicare una mappa sbagliata.
 */

export const WHR_NAME_TO_ISO3 = {
  // --- Casi citati esplicitamente nel brief ---------------------------------
  'Taiwan Province of China': 'TWN',
  'Hong Kong S.A.R. of China': 'HKG',
  'State of Palestine': 'PSE',
  Turkiye: 'TUR',
  Czechia: 'CZE',
  'Congo (Brazzaville)': 'COG',
  'Congo (Kinshasa)': 'COD',
  Kosovo: 'XKX', // codice non ufficiale (user-assigned), assente da world-atlas

  // --- Varianti storiche degli stessi paesi, per reggere edizioni diverse ----
  Taiwan: 'TWN',
  'Hong Kong S.A.R., China': 'HKG',
  'Hong Kong': 'HKG',
  'Palestinian Territories': 'PSE',
  Palestine: 'PSE',
  'Türkiye': 'TUR',
  Turkey: 'TUR',
  'Czech Republic': 'CZE',
  'Republic of the Congo': 'COG',
  'Democratic Republic of the Congo': 'COD',
  'Congo, Rep.': 'COG',
  'Congo, Dem. Rep.': 'COD',

  // --- Nomi brevi/colloquiali usati dal WHR ---------------------------------
  Bolivia: 'BOL',
  Brunei: 'BRN',
  'Cape Verde': 'CPV',
  'Cabo Verde': 'CPV',
  'Ivory Coast': 'CIV',
  "Cote d'Ivoire": 'CIV',
  'Côte d’Ivoire': 'CIV',
  Iran: 'IRN',
  Laos: 'LAO',
  Macedonia: 'MKD',
  'North Macedonia': 'MKD',
  Moldova: 'MDA',
  Russia: 'RUS',
  'South Korea': 'KOR',
  'North Korea': 'PRK',
  Syria: 'SYR',
  Tanzania: 'TZA',
  Venezuela: 'VEN',
  Vietnam: 'VNM',
  Swaziland: 'SWZ',
  Eswatini: 'SWZ',
  'Eswatini, Kingdom of': 'SWZ',
  Gambia: 'GMB',
  'The Gambia': 'GMB',
  Micronesia: 'FSM',
  'Micronesia (Fed. States of)': 'FSM',
  'United States': 'USA',
  'United Kingdom': 'GBR',
  'United Arab Emirates': 'ARE',
  'Dominican Republic': 'DOM',
  'Central African Republic': 'CAF',
  'South Sudan': 'SSD',
  Myanmar: 'MMR',
  Burma: 'MMR',

  // --- Entita' senza codice ISO 3166-1: escluse di proposito ----------------
  // Compaiono in alcune edizioni del WHR ma non esistono ne' in ISO 3166-1 ne'
  // nelle stime OMS, quindi non potrebbero mai avere dati completi.
  'North Cyprus': null,
  'Northern Cyprus': null,
  'Somaliland region': null,
  'Somaliland Region': null,
  Somaliland: null,
};

/** Nomi che il WHR usa e che vanno tenuti fuori dal join senza far fallire il build. */
export const INTENTIONALLY_UNMAPPED = new Set(
  Object.entries(WHR_NAME_TO_ISO3)
    .filter(([, iso3]) => iso3 === null)
    .map(([name]) => name),
);

/**
 * Feature di world-atlas prive di `id` numerico, identificate per nome.
 * A 1:110m sono tre: N. Cyprus, Somaliland, Kosovo. Solo il Kosovo ha un codice
 * (non ufficiale) e compare nel WHR.
 */
export const GEO_NAME_TO_ISO3 = {
  Kosovo: 'XKX',
};

/** Normalizza una grafia per il confronto: spazi, apostrofi tipografici, accenti. */
export function normalizeName(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
