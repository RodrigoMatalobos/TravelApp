import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageTicketFiles,
  filesForCity,
  filesForCountry,
  findCityIndex,
  folderMatchesCountry,
  normalizeSelectedFolderFiles
} from '../frontend/ticket-files.mjs';

test('only enabled admin members can manage local ticket files', () => {
  assert.equal(canManageTicketFiles({ enabled: true, role: 'admin' }), true);
  assert.equal(canManageTicketFiles({ enabled: true, role: 'member' }), false);
  assert.equal(canManageTicketFiles({ enabled: false, role: 'admin' }), false);
  assert.equal(canManageTicketFiles(null), false);
});

const country = {
  id: 'finland',
  pais: 'Finlandia',
  ciudades: [
    { id: 'city-01', nombre: 'Helsinki (Ida)' },
    { id: 'city-02', nombre: 'Helsinki (Vuelta)' },
    { id: 'city-03', nombre: 'Inari' }
  ]
};

test('country folders match both English folder names and localized country names', () => {
  assert.equal(folderMatchesCountry('Finland', country), true);
  assert.equal(folderMatchesCountry('Finlandia', country), true);
  assert.equal(folderMatchesCountry('Sweden', country), false);
});

test('city folder suffixes map to itinerary direction names', () => {
  assert.equal(findCityIndex('Helsinki 1', country.ciudades), 0);
  assert.equal(findCityIndex('Helsinki 2', country.ciudades), 1);
  assert.equal(findCityIndex('Inari Ida', country.ciudades), 2);
});

test('ticket files are grouped under the matching country and city', () => {
  const files = [
    { id: 'root', relativePath: 'Finland/root-ticket.pdf' },
    { id: 'ida', relativePath: 'Finland/Helsinki 1/Hotel AX-es.pdf' },
    { id: 'return', relativePath: 'Finland/Helsinki 2/Hotel AX-fn.pdf' },
    { id: 'inari', relativePath: 'Finland/Inari Ida/Inari-es.pdf' },
    { id: 'other', relativePath: 'Sweden/Stockholm/ticket.pdf' }
  ];

  assert.deepEqual(filesForCountry(files, country).map(file => file.id), ['root']);
  assert.deepEqual(filesForCity(files, country, country.ciudades[0]).map(file => file.id), ['ida']);
  assert.deepEqual(filesForCity(files, country, country.ciudades[1]).map(file => file.id), ['return']);
  assert.deepEqual(filesForCity(files, country, country.ciudades[2]).map(file => file.id), ['inari']);
});

test('local folder selection removes the selected root and preserves country/city paths', () => {
  const sourceFile = {
    name: 'Hotel AX-es.pdf',
    type: 'application/pdf',
    size: 2048,
    lastModified: 1792231200000,
    webkitRelativePath: 'TravelApp/Finland/Helsinki 1/Hotel AX-es.pdf'
  };
  const [file] = normalizeSelectedFolderFiles([sourceFile]);

  assert.equal(file.id, 'Finland/Helsinki 1/Hotel AX-es.pdf');
  assert.equal(file.relativePath, 'Finland/Helsinki 1/Hotel AX-es.pdf');
  assert.equal(file.name, sourceFile.name);
  assert.equal(file.mimeType, 'application/pdf');
  assert.equal(file.blob, sourceFile);
});

test('local folder selection rejects files without preserved folder structure', () => {
  assert.throws(
    () => normalizeSelectedFolderFiles([{ name: 'ticket.pdf' }]),
    /no conservó las carpetas/
  );
});