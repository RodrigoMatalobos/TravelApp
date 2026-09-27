#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const projectDir = path.resolve(__dirname, '..');
const defaultDataDir = path.join(projectDir, 'data');
const defaultConfigPath = path.join(__dirname, 'drive-config.json');

function isDriveFolderUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'drive.google.com'
      && (/\/folders\/[^/]+/.test(url.pathname) || url.searchParams.has('id'));
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function updateDriveFolderData({ rootFolderUrl, countryLinks, dataDir = defaultDataDir, configPath = defaultConfigPath }) {
  const countryListPath = path.join(dataDir, 'country.json');
  const countryList = readJson(countryListPath);
  if (!Array.isArray(countryList)) {
    throw new Error('data/country.json debe contener una lista de países.');
  }

  if (rootFolderUrl && !isDriveFolderUrl(rootFolderUrl)) {
    throw new Error('El enlace raíz debe ser una URL HTTPS de una carpeta de Google Drive.');
  }

  const knownCountryIds = new Set(countryList.map((country) => country.id));
  Object.entries(countryLinks).forEach(([countryId, folderUrl]) => {
    if (!knownCountryIds.has(countryId)) {
      throw new Error(`País desconocido en la configuración: ${countryId}`);
    }
    if (folderUrl && !isDriveFolderUrl(folderUrl)) {
      throw new Error(`El enlace de Drive de ${countryId} no es una URL válida de carpeta.`);
    }
  });

  const updatedList = countryList.map((country) => (
    Object.hasOwn(countryLinks, country.id)
      ? { ...country, driveFolderUrl: countryLinks[country.id] || '' }
      : country
  ));
  const detailFiles = Object.entries(countryLinks).map(([countryId, folderUrl]) => {
    const filePath = path.join(dataDir, `${countryId}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`No existe el archivo de datos del país: ${filePath}`);
    }
    return [filePath, { ...readJson(filePath), driveFolderUrl: folderUrl || '' }];
  });

  const config = fs.existsSync(configPath) ? readJson(configPath) : {};
  config.rootFolderUrl = rootFolderUrl;
  writeJson(configPath, config);
  writeJson(countryListPath, updatedList);
  detailFiles.forEach(([filePath, country]) => writeJson(filePath, country));

  return { updatedCountries: Object.keys(countryLinks), rootFolderUrl };
}

function createPrompt() {
  const interfaceIO = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (question) => new Promise((resolve) => interfaceIO.question(question, resolve)),
    close: () => interfaceIO.close()
  };
}

async function main() {
  const prompt = createPrompt();

  try {
    const countryList = readJson(path.join(defaultDataDir, 'country.json'));
    const previousConfig = fs.existsSync(defaultConfigPath) ? readJson(defaultConfigPath) : {};
    const previousRoot = previousConfig.rootFolderUrl || '';

    console.log('Configuración de carpetas de tickets de Google Drive');
    console.log('Pegá enlaces compartidos HTTPS de carpetas. Enter conserva el valor actual; - lo borra.');
    const rootAnswer = (await prompt.ask(`Carpeta raíz${previousRoot ? ` (${previousRoot})` : ''}: `)).trim();
    const rootFolderUrl = rootAnswer === '-' ? '' : rootAnswer || previousRoot;
    if (rootFolderUrl && !isDriveFolderUrl(rootFolderUrl)) {
      throw new Error('El enlace raíz no parece una carpeta válida de Google Drive.');
    }

    const countryLinks = {};
    for (const country of countryList) {
      const currentUrl = country.driveFolderUrl || '';
      const answer = (await prompt.ask(`${country.pais}${currentUrl ? ` (${currentUrl})` : ''}: `)).trim();
      if (answer === '-') {
        countryLinks[country.id] = '';
      } else if (answer) {
        if (!isDriveFolderUrl(answer)) {
          throw new Error(`El enlace de ${country.pais} no parece una carpeta válida de Google Drive.`);
        }
        countryLinks[country.id] = answer;
      }
    }

    console.log(`\nSe actualizarán ${Object.keys(countryLinks).length} enlaces de país.`);
    const confirmation = (await prompt.ask('Escribí SI para guardar los cambios en data/: ')).trim();
    if (confirmation !== 'SI') {
      console.log('Cambios cancelados; no se modificaron los JSON.');
      return;
    }

    const result = updateDriveFolderData({ rootFolderUrl, countryLinks });
    console.log(`Configuración guardada. Países actualizados: ${result.updatedCountries.join(', ') || 'ninguno'}.`);
  } finally {
    prompt.close();
  }
}

module.exports = { isDriveFolderUrl, updateDriveFolderData };

if (require.main === module) {
  main().catch((error) => {
    console.error('No se pudo actualizar la configuración de Drive:', error.message);
    process.exitCode = 1;
  });
}