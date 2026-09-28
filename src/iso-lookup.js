/**
 * Lookup table: World Happiness Report country name -> ISO 3166-1 alpha-3.
 *
 * The WHR publishes countries by name only, with no code. The spellings follow
 * no standard and change between editions ("Czech Republic" becomes "Czechia",
 * "Turkey" becomes "Turkiye"). This table is the single place where those
 * spellings are reconciled.
 *
 * Rules:
 *   - an entry here always beats automatic resolution;
 *   - names that already match the ISO English denomination (Italy, France,
 *     Finland...) need no entry: `resolveIso3` handles them;
 *   - `null` means "entity with no ISO 3166-1 code, excluded on purpose": an
 *     explicit decision, not an oversight.
 *
 * If a name resolves neither here nor automatically, the build script stops
 * with an error. A silently broken join is the most likely way to publish a
 * wrong map.
 */

export const WHR_NAME_TO_ISO3 = {
  // --- Cases named explicitly in the brief ----------------------------------
  'Taiwan Province of China': 'TWN',
  'Hong Kong S.A.R. of China': 'HKG',
  'State of Palestine': 'PSE',
  Turkiye: 'TUR',
  Czechia: 'CZE',
  'Congo (Brazzaville)': 'COG',
  'Congo (Kinshasa)': 'COD',
  Kosovo: 'XKX', // unofficial (user-assigned) code, absent from world-atlas

  // --- Older spellings of the same countries, to survive past editions ------
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

  // --- WHR 2026 spellings ---------------------------------------------------
  // "Congo" on its own is Brazzaville, and "DR Congo" is Kinshasa. The bare
  // name does resolve to COG by itself, but it is pinned here on purpose: this
  // is the one pair where getting it wrong would look perfectly fine on the
  // map, and it should not depend on a library's name list staying put.
  Congo: 'COG',
  'DR Congo': 'COD',
  'Viet Nam': 'VNM',
  'Republic of Moldova': 'MDA',
  'Hong Kong SAR of China': 'HKG',
  'Lao PDR': 'LAO',

  // --- Short or colloquial names the WHR uses -------------------------------
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

  // --- Entities with no ISO 3166-1 code: excluded on purpose ----------------
  // They appear in some WHR editions but exist neither in ISO 3166-1 nor in the
  // WHO estimates, so they could never have complete data.
  'North Cyprus': null,
  'Northern Cyprus': null,
  'Somaliland region': null,
  'Somaliland Region': null,
  Somaliland: null,
};

/** Names the WHR uses that stay out of the join without failing the build. */
export const INTENTIONALLY_UNMAPPED = new Set(
  Object.entries(WHR_NAME_TO_ISO3)
    .filter(([, iso3]) => iso3 === null)
    .map(([name]) => name),
);

/**
 * world-atlas features with no numeric `id`, identified by name instead.
 * At 1:110m there are three: N. Cyprus, Somaliland, Kosovo. Only Kosovo has a
 * code (unofficial) and appears in the WHR.
 */
export const GEO_NAME_TO_ISO3 = {
  Kosovo: 'XKX',
};

/** Normalises a spelling for comparison: spaces, typographic quotes, accents. */
export function normalizeName(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
