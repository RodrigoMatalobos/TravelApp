const test = require('node:test');
const assert = require('node:assert/strict');
const { SHEET_SCHEMAS, snapshotFromValues, makeWritePlan } = require('../vault-sync');

function packingRecord(overrides = {}) {
  return {
    id: 'item-1',
    nombre: 'Adaptador',
    cantidad: '2',
    nota: '',
    estado: 'pendiente',
    asignado_a: '',
    created_at: '2026-10-10T10:00:00.000Z',
    updated_at: '2026-10-10T10:00:00.000Z',
    updated_by: 'Ana',
    ...overrides
  };
}

function valuesFor(record) {
  return SHEET_SCHEMAS.Valija.map(header => record[header] || '');
}

test('a new item initializes an empty sheet with header row and data row', () => {
  const baseline = snapshotFromValues('Valija', []);
  const remote = snapshotFromValues('Valija', []);
  const plan = makeWritePlan([packingRecord()], baseline, remote, 'Ana', '2026-10-10T11:00:00.000Z');

  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.updates[0].rowNumber, 1);
  assert.deepEqual(plan.updates[0].values, SHEET_SCHEMAS.Valija);
  assert.equal(plan.updates[1].rowNumber, 2);
  assert.equal(plan.updates[1].values[0], 'item-1');
});

test('editing an unchanged remote row creates a targeted row update', () => {
  const original = packingRecord();
  const values = [SHEET_SCHEMAS.Valija, valuesFor(original)];
  const baseline = snapshotFromValues('Valija', values);
  const remote = snapshotFromValues('Valija', values);
  const changed = packingRecord({ estado: 'listo' });
  const plan = makeWritePlan([changed], baseline, remote, 'Ana', '2026-10-10T11:00:00.000Z');

  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].rowNumber, 2);
  assert.equal(plan.updates[0].values[4], 'listo');
  assert.equal(plan.updates[0].values[8], 'Ana');
});

test('simultaneous edits to the same row stop the save and report a conflict', () => {
  const original = packingRecord();
  const baseline = snapshotFromValues('Valija', [SHEET_SCHEMAS.Valija, valuesFor(original)]);
  const changedRemotely = packingRecord({ nota: 'Lo agregó Luis', updated_at: '2026-10-10T10:30:00.000Z', updated_by: 'Luis' });
  const remote = snapshotFromValues('Valija', [SHEET_SCHEMAS.Valija, valuesFor(changedRemotely)]);
  const changedLocally = packingRecord({ estado: 'listo' });
  const plan = makeWritePlan([changedLocally], baseline, remote, 'Ana');

  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].id, 'item-1');
  assert.deepEqual(plan.updates, []);
});

test('editing a different row does not conflict with another remote edit', () => {
  const original = packingRecord();
  const baseline = snapshotFromValues('Valija', [SHEET_SCHEMAS.Valija, valuesFor(original)]);
  const remote = snapshotFromValues('Valija', [SHEET_SCHEMAS.Valija, valuesFor(original)]);
  const newItem = packingRecord({ id: 'item-2', nombre: 'Pasaporte' });
  const plan = makeWritePlan([original, newItem], baseline, remote, 'Ana');

  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].rowNumber, 3);
});
