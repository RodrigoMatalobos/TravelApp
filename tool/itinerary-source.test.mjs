import test from 'node:test';
import assert from 'node:assert/strict';

test('el módulo fuente de Vite expone los seis itinerarios y la ruta', async () => {
  const { itinerarySource } = await import('../frontend/itinerary-source.mjs');

  assert.deepEqual(Object.keys(itinerarySource.countries), ['spain', 'finland', 'sweden', 'belgium', 'germany', 'czech']);
  assert.equal(itinerarySource.countries.germany.pais, 'Alemania');
  assert.equal(itinerarySource.route.stops.length, 15);
});
