import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPendingVaultChanges,
  loadPendingVaultChanges,
  mergePendingVaultRecords,
  savePendingVaultChanges
} from '../frontend/vault-offline.mjs';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };
}

test('savePendingVaultChanges guarda y recupera cambios locales sin conexión', () => {
  const storage = createMemoryStorage();
  const records = [{ id: 'g1', descripcion: 'Café', importe_minor_units: '450' }];

  assert.equal(savePendingVaultChanges('Gastos', records, storage), true);
  const loaded = loadPendingVaultChanges('Gastos', storage);
  assert.equal(loaded.tab, 'Gastos');
  assert.deepEqual(loaded.records, records);

  clearPendingVaultChanges('Gastos', storage);
  assert.equal(loadPendingVaultChanges('Gastos', storage), null);
});

test('mergePendingVaultRecords combina cambios pendientes sobre registros remotos sin duplicar IDs', () => {
  const remote = [
    { id: 'c1', nombre: 'Adaptador', estado: 'pendiente' },
    { id: 'c2', nombre: 'Guantes', estado: 'pendiente' }
  ];
  const pending = {
    savedAt: '2026-11-20T21:30:00.000Z',
    records: [
      { id: 'c2', nombre: 'Guantes térmicos', estado: 'comprado' },
      { id: 'c3', nombre: 'Medias', estado: 'pendiente' }
    ]
  };

  const merged = mergePendingVaultRecords(remote, pending);
  assert.equal(merged.hasPending, true);
  assert.deepEqual(merged.records.map(item => item.id), ['c1', 'c2', 'c3']);
  assert.equal(merged.records[1].nombre, 'Guantes térmicos');
  assert.equal(merged.records[1].estado, 'comprado');
});
