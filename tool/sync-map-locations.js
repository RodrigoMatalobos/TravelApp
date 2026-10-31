#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'frontend', 'data');
const routePath = path.join(dataDir, 'map-locations.json');

function normalizeCityName(value) {
  return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function getStopKey(countryId, cityIndex) {
  return `${countryId}:${cityIndex}`;
}

function findMissingCities(countries, routeStops) {
  const represented = new Set(routeStops
    .filter(stop => stop.countryId && Number.isInteger(stop.cityIndex))
    .map(stop => getStopKey(stop.countryId, stop.cityIndex)));

  return countries.flatMap(country => (
    Array.isArray(country.ciudades)
      ? country.ciudades.flatMap((city, cityIndex) => (
        represented.has(getStopKey(country.id, cityIndex))
          ? []
          : [{ country, city, cityIndex }]
      ))
      : []
  ));
}

function findStaleStops(countries, routeStops) {
  const countryById = new Map(countries.map(country => [country.id, country]));
  return routeStops.filter(stop => {
    if (!stop.countryId || !Number.isInteger(stop.cityIndex)) return false;
    const country = countryById.get(stop.countryId);
    return !country || !Array.isArray(country.ciudades)
      || stop.cityIndex < 0
      || stop.cityIndex >= country.ciudades.length
      || !normalizeCityName(country.ciudades[stop.cityIndex].nombre)
        .startsWith(normalizeCityName(stop.name));
  });
}

function slugify(value) {
  return normalizeCityName(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'destino';
}

function makeStopId(countryId, cityName, existingIds) {
  const baseId = `${countryId}-${slugify(cityName)}`;
  let id = baseId;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function buildMapStop({ country, city, cityIndex, latitude, longitude, stage, existingIds }) {
  const stop = {
    id: makeStopId(country.id, city.nombre, existingIds),
    name: city.nombre,
    hasItinerary: true,
    countryId: country.id,
    countryName: country.pais,
    flag: country.flag || '',
    cityIndex,
    latitude,
    longitude
  };
  if (stage) stop.stage = stage;
  return stop;
}

function loadCountries() {
  const countryList = JSON.parse(fs.readFileSync(path.join(dataDir, 'country.json'), 'utf8'));
  if (!Array.isArray(countryList)) {
    throw new Error('frontend/data/country.json debe contener una lista de países.');
  }

  return countryList.map(country => {
    const detailPath = path.join(dataDir, `${country.id}.json`);
    if (!fs.existsSync(detailPath)) {
      throw new Error(`Falta el archivo de datos para ${country.pais}: ${detailPath}`);
    }
    const details = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
    if (!Array.isArray(details.ciudades)) {
      throw new Error(`${detailPath} todavía no tiene una lista ciudades completa.`);
    }
    return { ...country, ciudades: details.ciudades };
  });
}

function promptLine(interfaceIO, question) {
  return new Promise(resolve => interfaceIO.question(question, resolve));
}

function parseCoordinate(answer, min, max) {
  const input = String(answer).trim();
  if (!input) return null;
  const value = Number(input.replace(',', '.'));
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

async function main(argv = process.argv.slice(2)) {
  const checkOnly = argv.includes('--check');
  const countries = loadCountries();
  const route = JSON.parse(fs.readFileSync(routePath, 'utf8'));
  if (!Array.isArray(route.stops)) {
    throw new Error('frontend/data/map-locations.json debe tener una lista stops.');
  }

  const staleStops = findStaleStops(countries, route.stops);
  const missingCities = findMissingCities(countries, route.stops);

  if (staleStops.length) {
    console.error('Hay paradas que todavía no coinciden con ciudades completas en sus JSON:');
    staleStops.forEach(stop => console.error(`- ${stop.countryId}: ${stop.name} (índice ${stop.cityIndex})`));
    process.exitCode = 1;
    return;
  }

  if (!missingCities.length) {
    console.log('Todas las ciudades actuales ya tienen una parada en el mapa.');
    return;
  }

  console.log(`Ciudades nuevas para agregar al mapa: ${missingCities.length}`);
  missingCities.forEach(({ country, city, cityIndex }) => {
    console.log(`- ${country.pais}: ${city.nombre} (ciudad ${cityIndex + 1})`);
  });

  if (checkOnly) {
    process.exitCode = 1;
    return;
  }

  const interfaceIO = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pendingStops = [];
  const existingIds = new Set(route.stops.map(stop => stop.id));

  try {
    for (const missing of missingCities) {
      let latitude = null;
      while (latitude === null) {
        latitude = parseCoordinate(await promptLine(interfaceIO, `Latitud de ${missing.city.nombre}: `), -90, 90);
        if (latitude === null) console.log('Ingresá una latitud decimal entre -90 y 90.');
      }

      let longitude = null;
      while (longitude === null) {
        longitude = parseCoordinate(await promptLine(interfaceIO, `Longitud de ${missing.city.nombre}: `), -180, 180);
        if (longitude === null) console.log('Ingresá una longitud decimal entre -180 y 180.');
      }

      const stage = (await promptLine(interfaceIO, 'Etiqueta opcional de la etapa (Enter para omitir): ')).trim();
      const returnIndex = route.stops.findIndex(stop => stop.stage === 'Regreso' || stop.type === 'return');
      const defaultPosition = (returnIndex === -1 ? route.stops.length : returnIndex) + pendingStops.length;
      const positionAnswer = (await promptLine(
        interfaceIO,
        `Posición antes de la parada N (1-${defaultPosition + 1}, Enter para insertar antes del regreso): `
      )).trim();
      const position = positionAnswer ? Number(positionAnswer) : defaultPosition + 1;
      if (!Number.isInteger(position) || position < 1 || position > defaultPosition + 1) {
        throw new Error('La posición ingresada está fuera del recorrido.');
      }

      const stop = buildMapStop({ ...missing, latitude, longitude, stage, existingIds });
      existingIds.add(stop.id);
      pendingStops.push({ stop, position: position - 1 });
    }

    const confirmation = (await promptLine(interfaceIO, 'Escribí SI para guardar las paradas nuevas en frontend/data/map-locations.json: ')).trim();
    if (confirmation !== 'SI') {
      console.log('Cancelado; no se modificó el mapa.');
      return;
    }

    pendingStops.forEach(({ stop, position }) => {
      route.stops.splice(Math.min(position, route.stops.length), 0, stop);
    });
    fs.writeFileSync(routePath, `${JSON.stringify(route, null, 2)}\n`, 'utf8');
    console.log(`Se agregaron ${pendingStops.length} paradas al recorrido.`);
  } finally {
    interfaceIO.close();
  }
}

module.exports = {
  normalizeCityName,
  findMissingCities,
  findStaleStops,
  slugify,
  makeStopId,
  buildMapStop,
  parseCoordinate
};

if (require.main === module) {
  main().catch(error => {
    console.error('No se pudo sincronizar el mapa:', error.message);
    process.exitCode = 1;
  });
}
