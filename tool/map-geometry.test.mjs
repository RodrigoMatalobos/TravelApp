import test from 'node:test';
import assert from 'node:assert/strict';
import { greatCircleCoordinates, routeSegmentType } from '../frontend/map-geometry.mjs';
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

test('los tramos de excursiones sin itinerario se marcan verdes sin colorear la salida desde Argentina', () => {
  const { stops } = itinerarySource.route;
  const excursionSegments = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const start = stops[index];
    const end = stops[index + 1];
    if ((!start.hasItinerary && start.countryName !== 'Argentina')
      || (!end.hasItinerary && end.countryName !== 'Argentina')) {
      excursionSegments.push(routeSegmentType(start, end));
    }
  }

  assert.ok(excursionSegments.length > 0);
  assert.ok(excursionSegments.every(type => type === 'stop'));
  assert.equal(routeSegmentType(stops[0], stops[1]), 'official');
});
