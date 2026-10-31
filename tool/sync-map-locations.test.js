const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findMissingCities,
  findStaleStops,
  buildMapStop,
  parseCoordinate
} = require('./sync-map-locations');

const countries = [
  {
    id: 'germany',
    pais: 'Alemania',
    flag: '🇩🇪',
    ciudades: [{ nombre: 'Colonia' }, { nombre: 'Dresden' }, { nombre: 'Berlín' }]
  }
];

test('findMissingCities compara ciudades por país e índice', () => {
  const missing = findMissingCities(countries, [
    { countryId: 'germany', cityIndex: 0 },
    { countryId: 'germany', cityIndex: 2 }
  ]);

  assert.deepEqual(missing.map(item => [item.city.nombre, item.cityIndex]), [['Dresden', 1]]);
});

test('findStaleStops detecta índices que todavía no existen en los datos', () => {
  const stale = findStaleStops(countries, [
    { countryId: 'germany', cityIndex: 2 },
    { countryId: 'germany', cityIndex: 4 },
    { countryId: 'germany', cityIndex: 1, name: 'Berlín' }
  ]);

  assert.deepEqual(stale.map(stop => stop.cityIndex), [4, 1]);
});

test('buildMapStop genera ids estables y conserva coordenadas y ciudad', () => {
  const stop = buildMapStop({
    country: countries[0],
    city: countries[0].ciudades[1],
    cityIndex: 1,
    latitude: 51.0504,
    longitude: 13.7373,
    stage: 'Ida',
    existingIds: new Set(['germany-dresden'])
  });

  assert.equal(stop.id, 'germany-dresden-2');
  assert.equal(stop.name, 'Dresden');
  assert.equal(stop.hasItinerary, true);
  assert.equal(stop.cityIndex, 1);
  assert.equal(stop.stage, 'Ida');
});

test('parseCoordinate valida rangos y no acepta campos vacíos', () => {
  assert.equal(parseCoordinate('-34,6037', -90, 90), -34.6037);
  assert.equal(parseCoordinate('', -90, 90), null);
  assert.equal(parseCoordinate('91', -90, 90), null);
});
