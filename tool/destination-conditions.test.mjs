import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cityDateRange,
  fetchCurrentConditions,
  formatLocalTime,
  getCachedCurrentConditions,
  selectCountryDestination,
  weatherPresentation
} from '../frontend/destination-conditions.mjs';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: key => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value))
  };
}

const finland = {
  id: 'finland',
  pais: 'Finlandia',
  ciudades: [
    { nombre: 'Helsinki (Ida)', fechas: '08/12/2026 – 09/12/2026', hotel: 'Hotel AX' },
    { nombre: 'Inari y Rovaniemi (Laponia)', fechas: '10/12/2026 – 13/12/2026', hotel: 'Inari Camping Resort' }
  ]
};

const finlandStops = [
  { countryId: 'finland', cityIndex: 0, name: 'Helsinki', latitude: 60.1699, longitude: 24.9384, order: 4 },
  { countryId: 'finland', cityIndex: 1, name: 'Rovaniemi', latitude: 66.5039, longitude: 25.7294, order: 5 },
  { countryId: 'finland', cityIndex: 1, name: 'Inari', latitude: 68.906, longitude: 27.0288, order: 6 }
];

test('cityDateRange parses inclusive travel dates and rejects invalid ranges', () => {
  assert.deepEqual(cityDateRange('08/12/2026 – 09/12/2026'), {
    start: '2026-12-08',
    end: '2026-12-09'
  });
  assert.equal(cityDateRange('31/02/2026 – 02/03/2026'), null);
});

test('selectCountryDestination uses the city active on the date and prefers its hotel location', () => {
  const duringLaplandStay = selectCountryDestination(finland, finlandStops, new Date(2026, 11, 11, 12));
  assert.equal(duringLaplandStay.cityName, 'Inari');
  assert.equal(duringLaplandStay.latitude, 68.906);
  assert.equal(duringLaplandStay.isTravelDate, true);

  const outsideTrip = selectCountryDestination(finland, finlandStops, new Date(2026, 10, 25, 12));
  assert.equal(outsideTrip.cityName, 'Helsinki');
  assert.equal(outsideTrip.latitude, 60.1699);
  assert.equal(outsideTrip.isTravelDate, false);
});

test('fetchCurrentConditions reads Celsius weather and falls back to cached data offline', async () => {
  const storage = createMemoryStorage();
  const location = { latitude: 51.5074, longitude: -0.1278 };
  const fetchImpl = async url => {
    assert.match(url, /temperature_unit=celsius/);
    assert.match(url, /timezone=auto/);
    return {
      ok: true,
      json: async () => ({
        timezone: 'Europe/London',
        current: { temperature_2m: 12.4, weather_code: 3, time: '2026-11-24T11:00' }
      })
    };
  };
  const fresh = await fetchCurrentConditions(location, { fetchImpl, storage, now: 1000 });
  assert.equal(fresh.temperatureC, 12.4);
  assert.equal(fresh.timeZone, 'Europe/London');
  assert.equal(fresh.stale, false);

  const offline = await fetchCurrentConditions(location, {
    fetchImpl: async () => { throw new Error('offline'); },
    storage,
    now: 7 * 60 * 60 * 1000
  });
  assert.equal(offline.temperatureC, 12.4);
  assert.equal(offline.stale, true);
});

test('cached conditions display immediately and a failed refresh is throttled for six hours', async () => {
  const storage = createMemoryStorage();
  const location = { latitude: 48.8566, longitude: 2.3522 };
  let fetchCount = 0;
  await fetchCurrentConditions(location, {
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        json: async () => ({
          timezone: 'Europe/London',
          current: { temperature_2m: 12, weather_code: 0, time: '2026-11-24T11:00' }
        })
      };
    },
    storage,
    now: 1000
  });

  const cached = getCachedCurrentConditions(location, { storage, now: 7 * 60 * 60 * 1000 });
  assert.equal(cached.temperatureC, 12);
  assert.equal(cached.stale, true);

  const offlineFetch = async () => {
    fetchCount += 1;
    throw new Error('offline');
  };
  await fetchCurrentConditions(location, { fetchImpl: offlineFetch, storage, now: 7 * 60 * 60 * 1000 });
  const stale = await fetchCurrentConditions(location, {
    fetchImpl: offlineFetch,
    storage,
    now: 8 * 60 * 60 * 1000
  });
  assert.equal(stale.temperatureC, 12);
  assert.equal(stale.stale, true);
  assert.equal(fetchCount, 2);
});

test('formatLocalTime and weatherPresentation return accessible localized labels', () => {
  assert.match(formatLocalTime('Europe/Helsinki', new Date('2026-11-24T12:00:00Z')), /^\d{2}:\d{2}$/);
  assert.deepEqual(weatherPresentation(71), { icon: '❄', label: 'Nieve' });
  assert.deepEqual(weatherPresentation(95), { icon: 'ϟ', label: 'Tormenta' });
});
