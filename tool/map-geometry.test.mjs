import test from 'node:test';
import assert from 'node:assert/strict';
import { greatCircleCoordinates } from '../frontend/map-geometry.mjs';
import { itinerarySource } from '../frontend/itinerary-source.mjs';

test('el mapa calcula líneas geodésicas finitas para toda la ruta, incluso desde Buenos Aires', () => {
  const { stops } = itinerarySource.route;
  const segments = stops.slice(0, -1).map((start, index) => {
    const end = stops[index + 1];
    return greatCircleCoordinates(
      { lat: start.latitude, lon: start.longitude },
      { lat: end.latitude, lon: end.longitude }
    );
  });

  assert.ok(segments.every(segment => segment.length >= 2));
  assert.ok(segments.flat(2).every(Number.isFinite));
  assert.deepEqual(segments[0][0], [stops[0].latitude, stops[0].longitude]);
  assert.deepEqual(segments[0].at(-1), [stops[1].latitude, stops[1].longitude]);
});
