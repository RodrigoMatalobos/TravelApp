const WEATHER_CACHE_PREFIX = 'travelapp-weather-v1:';
const WEATHER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const memoryCache = new Map();

function normalizedText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseTravelDate(value) {
  const match = String(value || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date.toISOString().slice(0, 10);
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function cityDateRange(cityDates) {
  const values = String(cityDates || '').match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) || [];
  const start = parseTravelDate(values[0]);
  const end = parseTravelDate(values[1] || values[0]);
  if (!start || !end || end < start) return null;
  return { start, end };
}

function stopMatchScore(stop, city) {
  const stopName = normalizedText(stop.name);
  if (!stopName) return 0;
  const cityName = normalizedText(city.nombre);
  const hotel = normalizedText(city.hotel);
  const address = normalizedText(city.direccionHotel);
  const destination = normalizedText(city.supermercadosDestino);
  let score = 0;
  if (cityName.includes(stopName)) score += 5;
  if (hotel.includes(stopName)) score += 10;
  if (address.includes(stopName)) score += 5;
  if (destination.includes(stopName)) score += 4;
  return score;
}

export function selectCountryDestination(country, routeStops = [], date = new Date()) {
  const cities = Array.isArray(country?.ciudades) ? country.ciudades : [];
  if (!cities.length) return null;

  const today = localDateKey(date);
  let cityIndex = cities.findIndex(city => {
    const range = cityDateRange(city.fechas);
    return range && range.start <= today && today <= range.end;
  });
  const isTravelDate = cityIndex >= 0;
  if (!isTravelDate) cityIndex = 0;

  const city = cities[cityIndex];
  const matchingStops = routeStops
    .filter(stop => stop.countryId === country.id && Number(stop.cityIndex) === cityIndex)
    .sort((first, second) => Number(first.order || 0) - Number(second.order || 0));
  const stop = matchingStops
    .map(candidate => ({ candidate, score: stopMatchScore(candidate, city) }))
    .sort((first, second) => second.score - first.score)[0]?.candidate;

  if (!stop || !Number.isFinite(Number(stop.latitude)) || !Number.isFinite(Number(stop.longitude))) {
    return {
      countryId: country.id,
      cityIndex,
      cityName: city.nombre || country.pais || '',
      isTravelDate,
      latitude: null,
      longitude: null,
      timeZone: ''
    };
  }

  return {
    countryId: country.id,
    cityIndex,
    cityName: stop.name || city.nombre || country.pais || '',
    isTravelDate,
    latitude: Number(stop.latitude),
    longitude: Number(stop.longitude),
    timeZone: ''
  };
}

function storageOrNull(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function weatherCacheKey(latitude, longitude) {
  return `${WEATHER_CACHE_PREFIX}${Number(latitude).toFixed(3)}:${Number(longitude).toFixed(3)}`;
}

function readCache(key, storage) {
  try {
    const value = storage?.getItem(key);
    if (value) {
      const parsed = JSON.parse(value);
      const hasConditions = Number.isFinite(parsed?.storedAt) && parsed?.conditions?.timeZone;
      if (hasConditions || Number.isFinite(parsed?.lastAttemptAt)) return parsed;
    }
  } catch {
    // Continue with the in-memory cache if persistent storage is unavailable.
  }
  return memoryCache.get(key) || null;
}

function writeCache(key, cache, storage) {
  memoryCache.set(key, cache);
  try {
    storage?.setItem(key, JSON.stringify(cache));
  } catch {
    // Keep the response in memory if persistent storage is unavailable.
  }
}

function validWeatherResponse(payload) {
  const current = payload?.current;
  return Number.isFinite(Number(current?.temperature_2m))
    && Number.isFinite(Number(current?.weather_code))
    && typeof payload?.timezone === 'string'
    && payload.timezone.length > 0;
}

function validateLocation(location, fetchImpl) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    throw new Error('No hay coordenadas válidas para consultar el clima.');
  }
  if (fetchImpl !== undefined && typeof fetchImpl !== 'function') {
    throw new Error('El navegador no permite consultar el clima.');
  }
  return { latitude, longitude };
}

export function getCachedCurrentConditions(location, { storage, now = Date.now() } = {}) {
  const { latitude, longitude } = validateLocation(location);
  const cached = readCache(weatherCacheKey(latitude, longitude), storageOrNull(storage));
  if (!cached?.conditions) return null;
  return {
    ...cached.conditions,
    stale: now - cached.storedAt >= WEATHER_CACHE_TTL_MS
  };
}

export async function fetchCurrentConditions(
  location,
  { fetchImpl = globalThis.fetch, storage, now = Date.now(), timeoutMs = 8000 } = {}
) {
  const { latitude, longitude } = validateLocation(location, fetchImpl);

  const cacheKey = weatherCacheKey(latitude, longitude);
  const currentStorage = storageOrNull(storage);
  const cached = readCache(cacheKey, currentStorage);
  if (cached && now - cached.storedAt < WEATHER_CACHE_TTL_MS) {
    return { ...cached.conditions, stale: false };
  }
  const lastAttemptAt = Number(cached?.lastAttemptAt ?? cached?.storedAt ?? 0);
  if (cached && now - lastAttemptAt < WEATHER_CACHE_TTL_MS) {
    if (cached.conditions) return { ...cached.conditions, stale: true };
    throw new Error('No hay datos de clima guardados y se mantiene el último intento de consulta.');
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('current', 'temperature_2m,weather_code');
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('timezone', 'auto');

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  writeCache(cacheKey, { ...cached, lastAttemptAt: now }, currentStorage);
  try {
    const response = await fetchImpl(url.toString(), controller ? { signal: controller.signal } : undefined);
    if (!response?.ok) throw new Error(`El servicio de clima respondió ${response?.status || 'sin estado'}.`);
    const payload = await response.json();
    if (!validWeatherResponse(payload)) throw new Error('El servicio de clima devolvió datos incompletos.');
    const conditions = {
      temperatureC: Number(payload.current.temperature_2m),
      weatherCode: Number(payload.current.weather_code),
      observedAt: String(payload.current.time || ''),
      timeZone: payload.timezone,
      stale: false
    };
    writeCache(cacheKey, { storedAt: now, lastAttemptAt: now, conditions }, currentStorage);
    return conditions;
  } catch (error) {
    writeCache(cacheKey, { ...cached, lastAttemptAt: now }, currentStorage);
    if (cached?.conditions) return { ...cached.conditions, stale: true };
    if (error?.name === 'AbortError') {
      throw new Error('La consulta del clima superó el tiempo de espera.', { cause: error });
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function formatLocalTime(timeZone, date = new Date()) {
  if (!timeZone) return '--:--';
  try {
    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone
    }).format(date);
  } catch {
    return '--:--';
  }
}

export function weatherPresentation(code) {
  const weatherCode = Number(code);
  if (weatherCode === 0) return { icon: '☼', label: 'Despejado' };
  if (weatherCode === 1 || weatherCode === 2) return { icon: '◐', label: 'Parcialmente nublado' };
  if (weatherCode === 3) return { icon: '☁', label: 'Nublado' };
  if (weatherCode === 45 || weatherCode === 48) return { icon: '≋', label: 'Niebla' };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) {
    return { icon: '☂', label: 'Lluvia' };
  }
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return { icon: '❄', label: 'Nieve' };
  if ([95, 96, 99].includes(weatherCode)) return { icon: 'ϟ', label: 'Tormenta' };
  return { icon: '·', label: 'Clima actual' };
}
