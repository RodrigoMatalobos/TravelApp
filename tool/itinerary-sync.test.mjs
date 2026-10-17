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
  assert.equal(snapshot.routeStops.length, 15);
  assert.ok(snapshot.routeStops.some(stop => stop.id === 'berlin' && stop.data.countryId === 'germany'));
  assert.ok(snapshot.routeStops.some(stop => stop.id === 'dresde' && stop.data.name === 'Dresde'));
  assert.ok(snapshot.routeStops.some(stop => stop.id === 'praga-vuelta' && stop.data.cityIndex === 2));
  assert.ok(snapshot.activities.length > 0);
});

test('la comparación detecta campos heredados y evita escrituras repetidas', () => {
  const desired = [{ id: 'germany', data: { id: 'germany', pais: 'Alemania', order: 4 } }];
  const existing = [{ id: 'germany', data: { id: 'germany', pais: 'Alemania', order: 4, voucherEsUrl: 'old' } }];

  assert.equal(documentsEqual(existing[0].data, desired[0].data), false);
  assert.deepEqual(diffDocuments(existing, desired).upserts.map(item => item.id), ['germany']);
  assert.deepEqual(diffDocuments(desired, desired).upserts, []);
});
