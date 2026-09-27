#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const defaultDataDir = path.join(rootDir, 'data');
const defaultOutputDir = path.join(rootDir, 'tool', 'output');

function normalizeString(value) {
  return String(value ?? '').trim();
}

function parseArgs(argv) {
  const args = {
    input: null,
    outputDir: defaultOutputDir,
    inPlace: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output' || token === '--output-dir') {
      args.outputDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (token === '--in-place') {
      args.inPlace = true;
      args.outputDir = defaultDataDir;
    } else if (!args.input) {
      args.input = token;
    }
  }

  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      if (row.some((cell) => normalizeString(cell) !== '')) {
        rows.push(row);
      }
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => normalizeString(cell) !== '')) {
    rows.push(row);
  }

  return rows;
}

function parseRecordRows(rows) {
  if (!rows || rows.length < 2) {
    throw new Error('El CSV debe incluir cabecera y al menos una fila de datos.');
  }

  const headers = rows[0].map((header) => normalizeString(header));
  const records = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? '';
    });
    records.push(record);
  }

  return records;
}

function splitList(rawValue) {
  return normalizeString(rawValue)
    .split('||')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseItemList(rawValue) {
  return splitList(rawValue).map((item) => {
    const separatorIndex = item.indexOf('|');
    if (separatorIndex === -1) {
      return { nombre: item, mapa: '' };
    }

    const nombre = item.slice(0, separatorIndex).trim();
    const mapa = item.slice(separatorIndex + 1).trim();
    return { nombre, mapa };
  }).filter((item) => item.nombre);
}

function buildCity(record) {
  return {
    nombre: normalizeString(record.city_name),
    fechas: normalizeString(record.city_dates),
    hotel: normalizeString(record.hotel_name),
    hotelUrl: normalizeString(record.hotel_url),
    mapaHotelLink: normalizeString(record.hotel_map),
    comoLlegar: normalizeString(record.como_llegar),
    actividades: parseItemList(record.activities),
    gastronomia: parseItemList(record.gastronomia)
  };
}

function buildCountryObject(record) {
  return {
    id: normalizeString(record.country_id),
    pais: normalizeString(record.country_name),
    flag: normalizeString(record.flag),
    spotifyUrl: normalizeString(record.spotify_url),
    driveFolderUrl: normalizeString(record.drive_folder_url),
    bgImage: normalizeString(record.bg_image),
    servicios: {
      consulados: normalizeString(record.servicios_consulados),
      farmacias: normalizeString(record.servicios_farmacias),
      lavanderias: normalizeString(record.servicios_lavanderias)
    },
    ciudades: []
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function mergeCountryList(currentList, newList) {
  const map = new Map();
  currentList.forEach((item) => map.set(item.id, item));
  newList.forEach((item) => {
    const existing = map.get(item.id);
    if (existing) {
      map.set(item.id, {
        ...existing,
        ...item,
        driveFolderUrl: item.driveFolderUrl || existing.driveFolderUrl
      });
    } else {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values());
}

function mergeCountryFile(existingPath, country) {
  if (!fs.existsSync(existingPath)) {
    return country;
  }

  const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
  const merged = { ...existing };
  merged.id = country.id || merged.id;
  merged.pais = country.pais || merged.pais;
  merged.flag = country.flag || merged.flag;
  merged.spotifyUrl = country.spotifyUrl || merged.spotifyUrl;
  merged.driveFolderUrl = country.driveFolderUrl || merged.driveFolderUrl;
  merged.bgImage = country.bgImage || merged.bgImage;
  merged.servicios = { ...existing.servicios, ...country.servicios };
  merged.ciudades = Array.isArray(existing.ciudades) ? existing.ciudades.concat(country.ciudades || []) : country.ciudades || [];
  return merged;
}

function generateFromCsv(csvFilePath, options = {}) {
  const { outputDir = defaultOutputDir, inPlace = false } = options;
  const targetDir = inPlace ? defaultDataDir : outputDir;

  const inputPath = path.resolve(process.cwd(), csvFilePath);
  const sourceContent = fs.readFileSync(inputPath, 'utf8');
  const rows = parseCsv(sourceContent);
  const records = parseRecordRows(rows);

  if (!records.length) {
    throw new Error('No se encontraron filas de datos en el CSV.');
  }

  const grouped = new Map();
  records.forEach((record) => {
    const countryId = normalizeString(record.country_id);
    if (!countryId) {
      return;
    }

    if (!grouped.has(countryId)) {
      grouped.set(countryId, buildCountryObject(record));
    }

    const country = grouped.get(countryId);
    if (normalizeString(record.drive_folder_url)) {
      country.driveFolderUrl = normalizeString(record.drive_folder_url);
    }
    const city = buildCity(record);
    if (city.nombre) {
      country.ciudades.push(city);
    }
  });

  const countries = Array.from(grouped.values());
  if (!countries.length) {
    throw new Error('No se pudo crear ningún país a partir del CSV.');
  }

  ensureDir(targetDir);

  const countryList = countries.map((country) => ({
    id: country.id,
    pais: country.pais,
    flag: country.flag,
    spotifyUrl: country.spotifyUrl,
    driveFolderUrl: country.driveFolderUrl,
    bgImage: country.bgImage
  }));

  const existingCountryFile = path.join(targetDir, 'country.json');
  if (fs.existsSync(existingCountryFile)) {
    const currentList = JSON.parse(fs.readFileSync(existingCountryFile, 'utf8'));
    writeJson(existingCountryFile, mergeCountryList(currentList, countryList));
  } else {
    writeJson(existingCountryFile, countryList);
  }

  countries.forEach((country) => {
    const countryPath = path.join(targetDir, `${country.id}.json`);
    const mergedCountry = mergeCountryFile(countryPath, country);
    writeJson(countryPath, mergedCountry);
  });

  return {
    generatedCountries: countryList.map((country) => country.id),
    outputPath: targetDir,
    inPlace
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputArg = args.input || path.join(__dirname, 'templates', 'input-template.csv');
  const inputPath = path.resolve(process.cwd(), inputArg);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`No se encontró el archivo de entrada: ${inputPath}`);
  }

  const result = generateFromCsv(inputPath, {
    outputDir: args.outputDir,
    inPlace: args.inPlace
  });

  console.log(`JSON generado correctamente en ${result.outputPath}`);
  console.log(`Países creados: ${result.generatedCountries.join(', ')}`);
  if (result.inPlace) {
    console.log('Modo: escritura directa en data/ (sin sobrescribir por defecto).');
  } else {
    console.log(`Modo seguro: se generó en ${result.outputPath} sin tocar los archivos principales.`);
  }
}

module.exports = {
  normalizeString,
  parseCsv,
  parseRecordRows,
  parseItemList,
  generateFromCsv,
  buildCountryObject,
  buildCity,
  mergeCountryList,
  mergeCountryFile
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Error al generar los datos:', error.message);
    process.exit(1);
  }
}
