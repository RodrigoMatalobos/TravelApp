const SHARED_PLAYLIST = { nombre: 'Europa 2026', url: 'https://open.spotify.com/playlist/4RnXEi2McMcnsT3vInD03n' };

export const COUNTRY_CATALOG = Object.freeze([
  { id: 'spain', pais: 'España', flag: '🇪🇸', playlists: [SHARED_PLAYLIST] },
  { id: 'finland', pais: 'Finlandia', flag: '🇫🇮', playlists: [SHARED_PLAYLIST] },
  { id: 'sweden', pais: 'Suecia', flag: '🇸🇪', playlists: [SHARED_PLAYLIST] },
  { id: 'belgium', pais: 'Bélgica', flag: '🇧🇪', playlists: [SHARED_PLAYLIST] },
  {
    id: 'germany',
    pais: 'Alemania',
    flag: '🇩🇪',
    spotifyUrl: 'https://open.spotify.com/playlist/65Pm1szZCEc6uFMEXx2oqW',
    playlists: [
      { nombre: 'Alemania', url: 'https://open.spotify.com/playlist/65Pm1szZCEc6uFMEXx2oqW' },
      SHARED_PLAYLIST
    ]
  },
  { id: 'czech', pais: 'República Checa', flag: '🇨🇿', playlists: [SHARED_PLAYLIST] }
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
      playlists: (Array.isArray(stored.playlists) && stored.playlists.length)
        ? stored.playlists
        : (country.playlists || []),
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