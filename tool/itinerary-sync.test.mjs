import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildActivityDocument,
  buildCityDocument,
  buildCityRouteStop,
  buildItinerarySnapshot,
  buildPlaylistDocuments,
  diffDocuments,
  documentsEqual,
  INITIAL_COUNTRY_IDS,
  planCityDeletion
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
  assert.equal(snapshot.routeStops.length, 29);
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

test('la instantánea sincroniza supermercados y direcciones para las 13 estadías', () => {
  const snapshot = buildItinerarySnapshot({ countries, route });
  const citiesWithSupermarkets = snapshot.cities.filter(city => city.data.supermercados.length > 0);

  assert.equal(citiesWithSupermarkets.length, 13);
  assert.equal(citiesWithSupermarkets.reduce((total, city) => total + city.data.supermercados.length, 0), 27);
  const barcelona = snapshot.cities.find(city => city.countryId === 'spain' && city.data.nombre === 'Barcelona (Ida)');
  assert.equal(barcelona.data.supermercadosDestino, 'Barcelona 1 (Sants-Montjuïc)');
  assert.equal(barcelona.data.direccionHotel, 'Torns 3, 08028 Barcelona, España');
  assert.equal(barcelona.data.supermercados[0].nombre, 'Lidl (Gran Via de les Corts Catalanes, 159)');
  assert.match(barcelona.data.supermercados[0].mapa, /^https:\/\/maps\.google\.com\//);
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

test('buildPlaylistDocuments valida y permite reemplazar o quitar todos los banners', () => {
  assert.deepEqual(buildPlaylistDocuments([
    { nombre: 'Europa', url: 'https://open.spotify.com/playlist/abc123' },
    { nombre: '', url: '' }
  ]), [{ nombre: 'Europa', url: 'https://open.spotify.com/playlist/abc123' }]);
  assert.deepEqual(buildPlaylistDocuments([]), []);
  assert.throws(
    () => buildPlaylistDocuments([{ nombre: 'No segura', url: 'http://open.spotify.com/playlist/abc123' }]),
    /HTTPS de open\.spotify\.com/
  );
  assert.throws(
    () => buildPlaylistDocuments([{ nombre: 'URL inválida', url: 'https://example.com/playlist' }]),
    /HTTPS de open\.spotify\.com/
  );
});

test('la instantánea conserva las webs oficiales de lugares gastronómicos', () => {
  const snapshot = buildItinerarySnapshot({ countries, route });
  const cafeLouvre = snapshot.activities.find(activity => activity.data.nombre.startsWith('Café Louvre'));

  assert.equal(cafeLouvre.data.website, 'https://www.cafelouvre.cz/');
});

test('la comparación detecta campos heredados y evita escrituras repetidas', () => {
  const desired = [{ id: 'germany', data: { id: 'germany', pais: 'Alemania', order: 4 } }];
  const existing = [{ id: 'germany', data: { id: 'germany', pais: 'Alemania', order: 4, voucherEsUrl: 'old' } }];

  assert.equal(documentsEqual(existing[0].data, desired[0].data), false);
  assert.deepEqual(diffDocuments(existing, desired).upserts.map(item => item.id), ['germany']);
  assert.deepEqual(diffDocuments(desired, desired).upserts, []);
});

test('buildActivityDocument valida nombre, día y enlaces de Maps', () => {
  const activity = buildActivityDocument({
    nombre: 'Museo del Prado',
    dia: '2',
    category: 'actividad',
    mapa: 'https://maps.google.com/?q=Museo+del+Prado',
    nota: 'Entrar temprano',
    order: 5
  });
  assert.equal(activity.nombre, 'Museo del Prado');
  assert.equal(activity.dia, 2);
  assert.equal(activity.mapa, 'https://maps.google.com/?q=Museo+del+Prado');
  assert.equal(activity.nota, 'Entrar temprano');
  assert.throws(() => buildActivityDocument({ nombre: '' }), /obligatorio/i);
  assert.throws(() => buildActivityDocument({ nombre: 'Algo', mapa: 'ftp://invalido' }), /Google Maps/i);
});

test('buildCityDocument y buildCityRouteStop generan ciudad y parada de mapa válidas', () => {
  const city = buildCityDocument({ id: 'city-04-milan', nombre: 'Milán', fechas: '10/01/2027 – 12/01/2027', order: 3 });
  const stop = buildCityRouteStop({
    id: 'italy-milan-1',
    name: city.nombre,
    countryId: 'italy',
    countryName: 'Italia',
    flag: '🇮🇹',
    cityIndex: 3,
    latitude: 45.4642,
    longitude: 9.19,
    order: 29
  });
  assert.equal(city.nombre, 'Milán');
  assert.equal(stop.hasItinerary, true);
  assert.equal(stop.cityIndex, 3);
  assert.equal(stop.latitude, 45.4642);
  assert.throws(() => buildCityRouteStop({ name: 'Sin coords', latitude: NaN, longitude: 9 }), /coordenadas válidas/i);
});

test('planCityDeletion removes linked stops and reindexes later cities and route stops', () => {
  const plan = planCityDeletion({
    countryId: 'spain',
    cityId: 'city-02',
    cityIndex: 1,
    cities: [
      { id: 'city-01', data: { nombre: 'Barcelona', order: 0 } },
      { id: 'city-02', data: { nombre: 'Madrid', order: 1 } },
      { id: 'city-03', data: { nombre: 'Sevilla', order: 2 } }
    ],
    routeStops: [
      { id: 'barcelona', data: { countryId: 'spain', cityIndex: 0, order: 1 } },
      { id: 'madrid-arrival', data: { countryId: 'spain', cityIndex: 1, order: 2 } },
      { id: 'madrid-return', data: { countryId: 'spain', cityIndex: 1, order: 3 } },
      { id: 'seville', data: { countryId: 'spain', cityIndex: 2, order: 4 } },
      { id: 'flight', data: { order: 0 } }
    ]
  });

  assert.deepEqual(plan.cityUpdates, [
    { id: 'city-03', data: { nombre: 'Sevilla', order: 1 } }
  ]);
  assert.deepEqual(plan.routeStopsToDelete.map(stop => stop.id), ['madrid-arrival', 'madrid-return']);
  assert.deepEqual(plan.routeStopUpdates, [
    { id: 'seville', data: { countryId: 'spain', cityIndex: 1, order: 2 } },
  ]);
  assert.throws(() => planCityDeletion({
    countryId: 'spain',
    cityId: 'missing',
    cityIndex: 0,
    cities: []
  }), /ya no existe/i);
});
