const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateFromCsv, parseCsv, parseItemList } = require('./generate-data');

test('parseCsv separa columnas correctamente con comillas', () => {
  const csv = 'country_id,city_name,activities\nspain,Barcelona,"A|https://a.com||B|https://b.com"\n';
  const rows = parseCsv(csv);
  assert.deepStrictEqual(rows[0], ['country_id', 'city_name', 'activities']);
  assert.strictEqual(rows[1][2], 'A|https://a.com||B|https://b.com');
});

test('parseItemList transforma texto con || en lista de objetos', () => {
  const items = parseItemList('Museo|https://m.com||Plaza|https://p.com');
  assert.deepStrictEqual(items, [
    { nombre: 'Museo', mapa: 'https://m.com' },
    { nombre: 'Plaza', mapa: 'https://p.com' }
  ]);
});

test('generateFromCsv genera country.json y un archivo por país', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'travelapp-'));
  const csvPath = path.join(tempDir, 'sample.csv');

  const csv = [
    'country_id,country_name,flag,spotify_url,bg_image,servicios_consulados,servicios_farmacias,servicios_lavanderias,city_name,city_dates,hotel_name,hotel_url,hotel_map,como_llegar,activities,gastronomia,drive_folder_url',
    'spain,España,🇪🇸,https://spotify.test,img/spain.jpg,https://maps.test,https://farmacia.test,https://lavanderia.test,Barcelona,30/11/2026 – 08/12/2026,Hotel Test,https://hotel.test,https://hotel.map.test,Metro test,"Museo|https://m.com||Plaza|https://p.com","Paella|https://paella.com",',
    'germany,Alemania,🇩🇪,https://spotify.de,img/germany.jpg,https://maps.de,https://farmacia.de,https://lavanderia.de,Berlín,01/01/2027 – 03/01/2027,Hotel Berlin,,https://hotel.berlin.map,Tren test,"Muro|https://muro.com","Bratwurst|https://brat.com",https://drive.google.com/drive/folders/germany'
  ].join('\n');

  fs.writeFileSync(csvPath, csv, 'utf8');

  const originalCwd = process.cwd();
  process.chdir(tempDir);

  try {
    const result = generateFromCsv(path.basename(csvPath), { outputDir: path.join(tempDir, 'tool-output') });
    assert.deepStrictEqual(result.generatedCountries, ['spain', 'germany']);

    const countryList = JSON.parse(fs.readFileSync(path.join(tempDir, 'tool-output', 'country.json'), 'utf8'));
    assert.strictEqual(countryList.length, 2);
    assert.strictEqual(countryList[1].driveFolderUrl, 'https://drive.google.com/drive/folders/germany');

    const spainData = JSON.parse(fs.readFileSync(path.join(tempDir, 'tool-output', 'spain.json'), 'utf8'));
    assert.strictEqual(spainData.ciudades[0].nombre, 'Barcelona');
    assert.strictEqual(spainData.ciudades[0].actividades[0].nombre, 'Museo');

    const germanyData = JSON.parse(fs.readFileSync(path.join(tempDir, 'tool-output', 'germany.json'), 'utf8'));
    assert.strictEqual(germanyData.driveFolderUrl, 'https://drive.google.com/drive/folders/germany');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
