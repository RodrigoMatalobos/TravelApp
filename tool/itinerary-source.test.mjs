import test from 'node:test';
import assert from 'node:assert/strict';

test('el módulo fuente de Vite expone los seis itinerarios y la ruta', async () => {
  const { itinerarySource } = await import('../frontend/itinerary-source.mjs');

  assert.deepEqual(Object.keys(itinerarySource.countries), ['spain', 'finland', 'sweden', 'belgium', 'germany', 'czech']);
  assert.equal(itinerarySource.countries.germany.pais, 'Alemania');
  assert.equal(itinerarySource.route.stops.length, 29);
  assert.equal(itinerarySource.route.stops.some(stop => stop.name === 'Montserrat'), false);
});

test('la gastronomía del documento se carga por ciudad con enlaces de Maps', async () => {
  const { itinerarySource } = await import('../frontend/itinerary-source.mjs');

  Object.values(itinerarySource.countries).forEach(country => {
    country.ciudades.forEach(city => {
      assert.ok(city.gastronomia.length > 0, `${country.pais} · ${city.nombre} debe tener gastronomía`);
      city.gastronomia.forEach(item => {
        assert.ok(item.nombre);
        assert.match(item.mapa, /^https:\/\/maps\.google\.com\//);
      });
    });
  });
  const barcelonaActivities = itinerarySource.countries.spain.ciudades
    .flatMap(city => city.actividades)
    .map(activity => activity.nombre);
  assert.equal(barcelonaActivities.some(name => /montserrat/i.test(name)), false);
  assert.ok(barcelonaActivities.length >= 10);
  assert.ok(itinerarySource.countries.finland.ciudades[1].gastronomia.some(item => /Kaffeost/i.test(item.nombre)));
  assert.ok(itinerarySource.countries.belgium.ciudades[0].gastronomia.some(item => /Dulle Griet/i.test(item.nombre)));
  assert.ok(itinerarySource.countries.germany.ciudades[1].gastronomia.some(item => /Watzke/i.test(item.nombre)));
  assert.ok(itinerarySource.countries.czech.ciudades[0].gastronomia.some(item => /Pilsner Urquell/i.test(item.nombre)));
  ['Café Louvre', "Pork's", 'Kolacherie'].forEach(name => {
    assert.ok(itinerarySource.countries.czech.ciudades[0].gastronomia.some(item => item.nombre.includes(name)));
    assert.ok(itinerarySource.countries.czech.ciudades[2].gastronomia.some(item => item.nombre.includes(name)));
  });
});

test('los supermercados incluyen las 13 estadías, direcciones y enlaces de Maps', async () => {
  const { itinerarySource } = await import('../frontend/itinerary-source.mjs');
  const cities = Object.values(itinerarySource.countries).flatMap(country => country.ciudades);
  const citiesWithSupermarkets = cities.filter(city => city.supermercados?.length);

  assert.equal(citiesWithSupermarkets.length, 13);
  assert.equal(citiesWithSupermarkets.reduce((total, city) => total + city.supermercados.length, 0), 27);
  citiesWithSupermarkets.forEach(city => {
    assert.ok(city.supermercadosDestino);
    assert.ok(city.direccionHotel);
    city.supermercados.forEach(item => {
      assert.ok(item.nombre);
      assert.match(item.mapa, /^https:\/\/maps\.google\.com\//);
    });
  });
  assert.equal(itinerarySource.countries.czech.ciudades[0].gastronomia[0].website, 'https://www.cafelouvre.cz/');
});

test('los vehículos del mapa solo se programan para los trayectos y fechas del viaje', async () => {
  const { itinerarySource } = await import('../frontend/itinerary-source.mjs');
  const { stops, animatedTrips, celebrationDates } = itinerarySource.route;
  const stopIndexes = new Map(stops.map((stop, index) => [stop.id, index]));

  assert.deepEqual(animatedTrips.map(({ date, from, to, type }) => [date, from, to, type]), [
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
    '2026-12-19',
    '2026-12-24',
    '2026-12-25',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02'
  ]);
});
