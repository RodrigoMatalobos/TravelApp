(function (root) {
  'use strict';

  const SHEET_SCHEMAS = Object.freeze({
    Valija: ['id', 'nombre', 'cantidad', 'nota', 'estado', 'asignado_a', 'created_at', 'updated_at', 'updated_by'],
    Compras: ['id', 'nombre', 'cantidad', 'nota', 'estado', 'asignado_a', 'created_at', 'updated_at', 'updated_by'],
    Gastos: ['id', 'fecha', 'descripcion', 'categoria', 'importe_minor_units', 'moneda', 'pagado_por', 'participantes', 'estado', 'created_at', 'updated_at', 'updated_by']
  });

  function normalizeValue(value) {
    return String(value ?? '').trim();
  }

  function snapshotFromValues(sheetName, values) {
    const schema = SHEET_SCHEMAS[sheetName];
    if (!schema) throw new Error(`Pestaña de Vault desconocida: ${sheetName}`);
    const rows = Array.isArray(values) ? values : [];
    if (!rows.length) {
      return { sheetName, headers: schema, values: [], records: [], byId: new Map(), needsHeaders: true };
    }

    const headers = rows[0].map(normalizeValue);
    const matches = schema.every((field, index) => headers[index] === field);
    if (!matches) {
      throw new Error(`La pestaña ${sheetName} debe iniciar con estas columnas: ${schema.join(', ')}`);
    }

    const records = [];
    const byId = new Map();
    rows.slice(1).forEach((row, index) => {
      const valuesForRow = schema.map((_, columnIndex) => normalizeValue(row[columnIndex]));
      if (!valuesForRow.some(Boolean)) return;
      const record = Object.fromEntries(schema.map((header, columnIndex) => [header, valuesForRow[columnIndex]]));
      if (!record.id) return;
      const entry = { record, rowNumber: index + 2, signature: JSON.stringify(valuesForRow) };
      records.push(record);
      byId.set(record.id, entry);
    });

    return { sheetName, headers, values: rows, records, byId, needsHeaders: false };
  }

  function recordValues(record, schema) {
    return schema.map(header => normalizeValue(record[header]));
  }

  function findConflicts(localRecords, baseline, remote) {
    const conflicts = [];
    localRecords.forEach(localRecord => {
      const id = normalizeValue(localRecord.id);
      const original = baseline.byId.get(id);
      const remoteEntry = remote.byId.get(id);
      const localSignature = JSON.stringify(recordValues(localRecord, baseline.headers));
      const isChanged = !original || localSignature !== original.signature;
      if (!isChanged) return;

      if (!original && remoteEntry) {
        conflicts.push({ id, localRecord, remoteRecord: remoteEntry.record, remoteEntry, reason: 'new-id-exists' });
      } else if (original && (!remoteEntry || remoteEntry.signature !== original.signature)) {
        conflicts.push({ id, localRecord, remoteRecord: remoteEntry?.record || null, remoteEntry: remoteEntry || null, reason: 'remote-changed' });
      }
    });
    return conflicts;
  }

  function makeWritePlan(localRecords, baseline, remote, actorName, now = new Date().toISOString()) {
    const conflicts = findConflicts(localRecords, baseline, remote);
    if (conflicts.length) return { conflicts, updates: [] };

    const updates = [];
    let nextRowNumber = remote.values.length + (remote.needsHeaders ? 2 : 1);
    const schema = SHEET_SCHEMAS[baseline.sheetName];

    localRecords.forEach(localRecord => {
      const id = normalizeValue(localRecord.id);
      const original = baseline.byId.get(id);
      const currentRemote = remote.byId.get(id);
      const values = recordValues(localRecord, schema);
      const before = original?.signature;
      if (before && JSON.stringify(values) === before) return;

      const updatedRecord = { ...localRecord, updated_at: now, updated_by: actorName };
      const rowValues = recordValues(updatedRecord, schema);
      updates.push({ rowNumber: currentRemote?.rowNumber || nextRowNumber++, values: rowValues });
    });

    if (remote.needsHeaders && updates.length) {
      updates.unshift({ rowNumber: 1, values: schema });
    }
    return { conflicts: [], updates };
  }

  const api = Object.freeze({ SHEET_SCHEMAS, snapshotFromValues, findConflicts, makeWritePlan });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VaultSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
