export const COUNTRY_CATALOG = Object.freeze([
  { id: 'spain', pais: 'España', flag: '🇪🇸' },
  { id: 'finland', pais: 'Finlandia', flag: '🇫🇮' },
  { id: 'sweden', pais: 'Suecia', flag: '🇸🇪' },
  { id: 'belgium', pais: 'Bélgica', flag: '🇧🇪' },
  {
    id: 'germany',
    pais: 'Alemania',
    flag: '🇩🇪',
    spotifyUrl: 'https://open.spotify.com/playlist/65Pm1szZCEc6uFMEXx2oqW'
  },
  { id: 'czech', pais: 'República Checa', flag: '🇨🇿' }
]);

export function mergeCountryCatalog(storedCountries, countryImages = {}) {
  const storedById = new Map(storedCountries.map(country => [country.id, country]));
  const catalogIds = new Set(COUNTRY_CATALOG.map(country => country.id));
  const catalogCountries = COUNTRY_CATALOG.map((country, order) => {
    const stored = storedById.get(country.id) || {};
    return {
      ...country,
      ...stored,
      id: country.id,
      pais: stored.pais || country.pais,
      flag: stored.flag || country.flag,
      spotifyUrl: country.spotifyUrl || stored.spotifyUrl || '',
      bgImage: countryImages[country.id] || stored.bgImage || '',
      order
    };
  });
  const additionalCountries = storedCountries
    .filter(country => !catalogIds.has(country.id))
    .map(country => ({
      ...country,
      bgImage: countryImages[country.id] || country.bgImage || ''
    }));

  return [...catalogCountries, ...additionalCountries];
}