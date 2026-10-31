import test from 'node:test';
import assert from 'node:assert/strict';

test('el módulo fuente de Vite expone los seis itinerarios y la ruta', async () => {
  const { itinerarySource } = await import('../frontend/itinerary-source.mjs');

  assert.deepEqual(Object.keys(itinerarySource.countries), ['spain', 'finland', 'sweden', 'belgium', 'germany', 'czech']);
  assert.equal(itinerarySource.countries.germany.pais, 'Alemania');
  assert.equal(itinerarySource.route.stops.length, 31);
});

test('los vehículos del mapa solo se programan para los trayectos y fechas del viaje', async () => {
  const { itinerarySource } = await import('../frontend/itinerary-source.mjs');
  const { stops, animatedTrips, celebrationDates } = itinerarySource.route;
  const stopIndexes = new Map(stops.map((stop, index) => [stop.id, index]));

  assert.deepEqual(animatedTrips.map(({ date, from, to, type }) => [date, from, to, type]), [
    ['2026-10-31', 'colonia-regreso', 'dresde', 'train'],
    ['2026-11-29', 'buenos-aires-salida', 'barcelona-ida', 'plane'],
    ['2026-12-08', 'barcelona-girona-regreso', 'helsinki-ida', 'plane'],
    ['2026-12-15', 'helsinki-vuelta', 'estocolmo', 'ship'],
    ['2026-12-19', 'estocolmo', 'bruselas', 'plane'],
    ['2026-12-22', 'bruselas-regreso', 'colonia', 'train'],
    ['2026-12-25', 'colonia-regreso', 'dresde', 'train'],
    ['2026-12-28', 'dresde-regreso', 'berlin', 'train'],
    ['2027-01-03', 'berlin', 'praga', 'train'],
    ['2027-01-06', 'praga-regreso-pilsen', 'karlovy-vary', 'bus'],
    ['2027-01-07', 'karlovy-vary-regreso', 'praga-vuelta', 'bus'],
    ['2027-01-08', 'praga-vuelta', 'barcelona-vuelta', 'plane']
  ]);
  animatedTrips.forEach(trip => {
    assert.equal(stopIndexes.get(trip.to), stopIndexes.get(trip.from) + 1);
  });
  assert.deepEqual(celebrationDates, [
    '2026-10-31',
    '2026-12-19',
    '2026-12-24',
    '2026-12-25',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02'
  ]);
});
