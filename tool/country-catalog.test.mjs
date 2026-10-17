import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRY_CATALOG, mergeCountryCatalog } from '../frontend/country-catalog.mjs';

test('the home catalog includes all six countries when Firestore has only three', () => {
  const storedCountries = [
    { id: 'finland', pais: 'Finlandia', spotifyUrl: 'stored-playlist' },
    { id: 'sweden', pais: 'Suecia' },
    { id: 'belgium', pais: 'Bélgica' }
  ];
  const countries = mergeCountryCatalog(storedCountries, { germany: 'germany-image' });

  assert.deepEqual(countries.map(country => country.id), COUNTRY_CATALOG.map(country => country.id));
  assert.equal(countries.find(country => country.id === 'germany').pais, 'Alemania');
  assert.equal(countries.find(country => country.id === 'germany').bgImage, 'germany-image');
  assert.equal(countries.find(country => country.id === 'germany').spotifyUrl, COUNTRY_CATALOG[4].spotifyUrl);
  assert.equal(countries.find(country => country.id === 'finland').spotifyUrl, 'stored-playlist');
});

test('countries added to Firestore later are appended to the home catalog', () => {
  const countries = mergeCountryCatalog([{ id: 'france', pais: 'Francia' }]);

  assert.equal(countries.at(-1).id, 'france');
});