import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageTicketFiles,
  filesForCity,
  filesForCountry,
  findCityIndex,
  folderMatchesCountry
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