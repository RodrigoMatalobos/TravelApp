export const INITIAL_COUNTRY_IDS = Object.freeze(['spain', 'finland', 'sweden', 'belgium', 'germany', 'czech']);
export const LEGACY_COUNTRY_IDS = Object.freeze(['espana', 'finlandia', 'suecia', 'belgica', 'alemania', 'rep_checa']);

const SERVICE_LABELS = Object.freeze({
  consulados: 'Consulados',
  farmacias: 'Farmacias',
  lavanderias: 'Lavanderías',
  supermercados: 'Supermercados'
});

function text(value) {
  return String(value || '').trim();
}

// Una playlist es { nombre, url }. Se admiten N listas por país.
// También se acepta el campo viejo `spotifyUrl` (string) y se convierte a lista.
export function normalizePlaylists(source) {
  const fromList = Array.isArray(source?.playlists) ? source.playlists : [];
  const normalized = fromList
    .map(item => ({ nombre: text(item?.nombre) || 'Playlist', url: text(item?.url) }))
    .filter(item => item.url);
  const legacyUrl = text(source?.spotifyUrl);
  if (legacyUrl && !normalized.some(item => item.url === legacyUrl)) {
    normalized.unshift({ nombre: 'Playlist del viaje', url: legacyUrl });
  }
  return normalized;
}

// Un transporte es { tipo, descripcion, fecha, salida, llegada }.
// "tipo" puede ser: vuelo, tren, bus, ferry u otro texto libre.
function normalizeTransportes(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => ({
    tipo: text(item?.tipo) || 'transporte',
    descripcion: text(item?.descripcion),
    fecha: text(item?.fecha),
    salida: text(item?.salida),
    llegada: text(item?.llegada)
  })).filter(item => item.descripcion);
}

function mapActivity(activity, category, order) {
  const value = typeof activity === 'string' ? { nombre: activity } : activity || {};
  return {
    category,
    dia: Number.isFinite(Number(value.dia)) ? Number(value.dia) : null,
    nombre: text(value.nombre),
    mapa: text(value.mapa),
    order
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stableValue(value[key])])
    );
  }
  return value;
}

export function documentsEqual(existing, desired) {
  return JSON.stringify(stableValue(existing || {})) === JSON.stringify(stableValue(desired || {}));
}

export function diffDocuments(existingDocs, desiredDocs) {
  const keyOf = item => item.key || item.id;
  const existingByKey = new Map(existingDocs.map(item => [keyOf(item), item.data]));
  const desiredKeys = new Set(desiredDocs.map(keyOf));

  return {
    upserts: desiredDocs.filter(item => !existingByKey.has(keyOf(item)) || !documentsEqual(existingByKey.get(keyOf(item)), item.data)),
    deletes: existingDocs.filter(item => !desiredKeys.has(keyOf(item)))
  };
}

function validateSource(countries, route) {
  const missing = INITIAL_COUNTRY_IDS.filter(countryId => !countries[countryId]);
  if (missing.length) {
    throw new Error(`Faltan itinerarios locales: ${missing.join(', ')}.`);
  }

  INITIAL_COUNTRY_IDS.forEach(countryId => {
    const source = countries[countryId];
    if (source.id !== countryId) {
      throw new Error(`El archivo ${countryId}.json tiene id "${source.id}".`);
    }
    if (!Array.isArray(source.ciudades) || !source.ciudades.length) {
      throw new Error(`El país ${countryId} no tiene ciudades cargadas.`);
    }
  });

  if (!Array.isArray(route?.stops) || !route.stops.length) {
    throw new Error('map-locations.json debe tener una lista de paradas.');
  }
}

function buildRouteStops(route, countries) {
  const seenIds = new Set();
  return route.stops.map((stop, order) => {
    const id = text(stop.id);
    if (!id) throw new Error(`La parada ${order + 1} no tiene id.`);
    if (seenIds.has(id)) throw new Error(`La parada ${id} está duplicada.`);
    seenIds.add(id);

    const latitude = Number(stop.latitude);
    const longitude = Number(stop.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(`La parada ${id} no tiene coordenadas válidas.`);
    }

    const countryId = text(stop.countryId);
    const data = {
      id,
      name: text(stop.name),
      countryName: text(stop.countryName),
      flag: text(stop.flag),
      latitude,
      longitude,
      order
    };
    if (text(stop.stage)) data.stage = text(stop.stage);

    if (countryId) {
      const country = countries[countryId];
      if (!country) throw new Error(`La parada ${id} apunta al país desconocido ${countryId}.`);
      const cityIndex = Number(stop.cityIndex);
      if (!Number.isInteger(cityIndex) || !country.ciudades[cityIndex]) {
        throw new Error(`La parada ${id} apunta a una ciudad inexistente de ${countryId}.`);
      }
      data.countryId = countryId;
      data.cityIndex = cityIndex;
      if (text(stop.openMode)) data.openMode = text(stop.openMode);
    }

    return { id, data };
  });
}

export function buildItinerarySnapshot({ countries = {}, route = {}, countryImages = {} }) {
  validateSource(countries, route);
  const routeStops = buildRouteStops(route, countries);
  const firstRoutePosition = new Map();
  routeStops.forEach((stop, index) => {
    if (stop.data.countryId && !firstRoutePosition.has(stop.data.countryId)) {
      firstRoutePosition.set(stop.data.countryId, index);
    }
  });
  const countryIds = [...INITIAL_COUNTRY_IDS].sort((first, second) =>
    (firstRoutePosition.get(first) ?? Number.MAX_SAFE_INTEGER) - (firstRoutePosition.get(second) ?? Number.MAX_SAFE_INTEGER));

  const snapshot = {
    countries: [],
    cities: [],
    activities: [],
    services: [],
    routeStops,
    legacyCountryIds: [...LEGACY_COUNTRY_IDS]
  };

  countryIds.forEach((countryId, countryIndex) => {
    const source = countries[countryId];
    const playlists = normalizePlaylists(source);
    snapshot.countries.push({
      id: countryId,
      data: {
        id: countryId,
        pais: text(source.pais) || countryId,
        flag: text(source.flag),
        playlists,
        spotifyUrl: playlists[0]?.url || '',
        bgImage: countryImages[countryId] || text(source.bgImage),
        order: countryIndex
      }
    });

    source.ciudades.forEach((city, cityIndex) => {
      const cityId = `city-${String(cityIndex + 1).padStart(2, '0')}`;
      snapshot.cities.push({
        id: cityId,
        countryId,
        data: {
          id: cityId,
          nombre: text(city.nombre),
          fechas: text(city.fechas),
          hotel: text(city.hotel),
          mapaHotelLink: text(city.mapaHotelLink),
          comoLlegar: text(city.comoLlegar),
          transportes: normalizeTransportes(city.transportes),
          transportePublico: text(city.transportePublico),
          guardaequipaje: text(city.guardaequipaje),
          mapaGastroLink: text(city.mapaGastroLink),
          order: cityIndex
        }
      });

      [
        ...((Array.isArray(city.actividades) ? city.actividades : []).map(item => ['actividad', item])),
        ...((Array.isArray(city.gastronomia) ? city.gastronomia : []).map(item => ['gastronomia', item]))
      ].forEach(([category, activity], activityIndex) => {
        const id = `activity-${String(activityIndex + 1).padStart(3, '0')}`;
        snapshot.activities.push({
          id,
          key: `${countryId}/${cityId}/${id}`,
          countryId,
          cityId,
          data: mapActivity(activity, category, activityIndex)
        });
      });
    });

    Object.entries(source.servicios || {}).forEach(([category, url], order) => {
      snapshot.services.push({
        id: category,
        countryId,
        data: {
          category,
          label: SERVICE_LABELS[category] || category,
          url: text(url),
          order
        }
      });
    });
  });

  return snapshot;
}
