const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { isDriveFolderUrl, updateDriveFolderData } = require('./manage-drive-folders');

test('isDriveFolderUrl only accepts HTTPS Google Drive folder links', () => {
  assert.equal(isDriveFolderUrl('https://drive.google.com/drive/folders/root123'), true);
  assert.equal(isDriveFolderUrl('https://drive.google.com/open?id=root123'), true);
  assert.equal(isDriveFolderUrl('http://drive.google.com/drive/folders/root123'), false);
  assert.equal(isDriveFolderUrl('https://example.com/drive/folders/root123'), false);
});

test('updateDriveFolderData saves Drive links and preserves itinerary fields', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'travelapp-drive-'));
  const dataDir = path.join(tempDir, 'data');
  const configPath = path.join(tempDir, 'drive-config.json');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'country.json'), JSON.stringify([
    { id: 'spain', pais: 'España', spotifyUrl: 'https://spotify.test' }
  ]));
  fs.writeFileSync(path.join(dataDir, 'spain.json'), JSON.stringify({
    id: 'spain',
    pais: 'España',
    ciudades: [{ nombre: 'Barcelona' }]
  }));

  try {
    const result = updateDriveFolderData({
      rootFolderUrl: 'https://drive.google.com/drive/folders/root123',
      countryLinks: { spain: 'https://drive.google.com/drive/folders/spain123' },
      dataDir,
      configPath
    });
    const countryList = JSON.parse(fs.readFileSync(path.join(dataDir, 'country.json'), 'utf8'));
    const spainData = JSON.parse(fs.readFileSync(path.join(dataDir, 'spain.json'), 'utf8'));

    assert.deepEqual(result.updatedCountries, ['spain']);
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).rootFolderUrl, 'https://drive.google.com/drive/folders/root123');
    assert.equal(countryList[0].driveFolderUrl, 'https://drive.google.com/drive/folders/spain123');
    assert.equal(spainData.driveFolderUrl, 'https://drive.google.com/drive/folders/spain123');
    assert.deepEqual(spainData.ciudades, [{ nombre: 'Barcelona' }]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});