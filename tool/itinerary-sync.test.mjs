import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildItinerarySnapshot,
  diffDocuments,
  documentsEqual,
  INITIAL_COUNTRY_IDS
} from '../frontend/itinerary-sync.mjs';

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

const countries = Object.fromEntries(INITIAL_COUNTRY_IDS.map(id => [
  id,
  readJson(`../frontend/data/${id}.json`)
]));
const route = readJson('../frontend/data/map-locations.json');

test('los itinerarios fuente usan IDs canónicos y cubren los seis países', () => {
  assert.deepEqual(Object.keys(countries), INITIAL_COUNTRY_IDS);
  INITIAL_COUNTRY_IDS.forEach(countryId => {
    assert.equal(countries[countryId].id, countryId);
    assert.ok(countries[countryId].ciudades.length > 0);
  });
});

test('la instantánea incluye Alemania, todas las paradas y referencias válidas', () => {
  const snapshot = buildItinerarySnapshot({ countries, route });

  assert.equal(snapshot.countries.length, 6);
  assert.ok(snapshot.countries.some(country => country.id === 'germany'));
  assert.equal(snapshot.routeStops.length, 31);
  assert.ok(snapshot.routeStops.some(stop => stop.id === 'berlin' && stop.data.countryId === 'germany'));
  assert.ok(snapshot.routeStops.some(stop => stop.id === 'dresde' && stop.data.name === 'Dresde'));
  assert.ok(snapshot.routeStops.some(stop => stop.id === 'praga-vuelta' && stop.data.cityIndex === 2));
  ['girona', 'gante', 'aquisgran', 'bastei', 'pilsen', 'loket'].forEach(stopId => {
    assert.ok(snapshot.routeStops.some(stop => stop.id === stopId), `falta la parada ${stopId}`);
  });
  ['barcelona-girona-regreso', 'bruselas-regreso', 'colonia-regreso', 'dresde-regreso', 'praga-regreso-pilsen', 'karlovy-vary-regreso']
    .forEach(stopId => assert.ok(snapshot.routeStops.some(stop => stop.id === stopId), `falta el regreso ${stopId}`));
  assert.equal(snapshot.routeStops.find(stop => stop.id === 'barcelona-ida').data.hasItinerary, true);
  assert.equal(snapshot.routeStops.find(stop => stop.id === 'girona').data.hasItinerary, false);
  assert.equal(snapshot.routeStops.find(stop => stop.id === 'girona').data.countryId, undefined);
  assert.ok(snapshot.activities.length > 0);
});

test('la instantánea expone playlists múltiples y transportes con fecha y horarios', () => {
  const snapshot = buildItinerarySnapshot({ countries, route });
  const germany = snapshot.countries.find(country => country.id === 'germany');
  const colonia = snapshot.cities.find(city => city.countryId === 'germany' && city.data.nombre === 'Colonia');

  assert.ok(Array.isArray(germany.data.playlists));
  assert.ok(germany.data.playlists.length >= 2);
  assert.ok(germany.data.playlists.every(playlist => playlist.url));
  assert.ok(Array.isArray(colonia.data.transportes));
  assert.equal(colonia.data.transportes[0].fecha, '22/12/2026');
  assert.equal(colonia.data.transportes[0].salida, '12:25');
});

test('una playlist sin URL se descarta y el campo viejo spotifyUrl sigue funcionando', () => {
  const snapshot = buildItinerarySnapshot({
    countries: Object.fromEntries(INITIAL_COUNTRY_IDS.map(id => [id, {
      ...countries[id],
      playlists: id === 'sweden' ? [{ nombre: 'Sin URL', url: '' }] : countries[id].playlists,
      spotifyUrl: id === 'sweden' ? 'https://spotify.test/suecia' : countries[id].spotifyUrl
    }])),
    route
  });
  const sweden = snapshot.countries.find(country => country.id === 'sweden');

  assert.deepEqual(sweden.data.playlists, [{ nombre: 'Playlist del viaje', url: 'https://spotify.test/suecia' }]);
});

test('la comparación detecta campos heredados y evita escrituras repetidas', () => {
  const desired = [{ id: 'germany', data: { id: 'germany', pais: 'Alemania', order: 4 } }];
  const existing = [{ id: 'germany', data: { id: 'germany', pais: 'Alemania', order: 4, voucherEsUrl: 'old' } }];

  assert.equal(documentsEqual(existing[0].data, desired[0].data), false);
  assert.deepEqual(diffDocuments(existing, desired).upserts.map(item => item.id), ['germany']);
  assert.deepEqual(diffDocuments(desired, desired).upserts, []);
});
