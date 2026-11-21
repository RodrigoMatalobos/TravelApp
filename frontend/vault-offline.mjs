const PENDING_PREFIX = 'travelapp.vault.pending.v1:';

export function getPendingVaultKey(tab) {
  return `${PENDING_PREFIX}${String(tab || '').toLowerCase()}`;
}

export function loadPendingVaultChanges(tab, storage = globalThis.localStorage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(getPendingVaultKey(tab));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.records)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingVaultChanges(tab, records, storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    const payload = {
      tab,
      savedAt: new Date().toISOString(),
      records: Array.isArray(records) ? records : []
    };
    storage.setItem(getPendingVaultKey(tab), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingVaultChanges(tab, storage = globalThis.localStorage) {
  if (!storage) return;
  try {
    storage.removeItem(getPendingVaultKey(tab));
  } catch {
    // Ignorado si no hay almacenamiento disponible.
  }
}

export function mergePendingVaultRecords(remoteRecords = [], pendingPayload = null) {
  if (!pendingPayload || !Array.isArray(pendingPayload.records)) {
    return { records: remoteRecords, hasPending: false };
  }
  const byId = new Map(remoteRecords.map(record => [record.id, { ...record }]));
  pendingPayload.records.forEach(record => {
    if (record?.id) {
      byId.set(record.id, { ...record });
    }
  });
  return {
    records: Array.from(byId.values()),
    hasPending: true,
    savedAt: pendingPayload.savedAt || ''
  };
}

export function isOfflineError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'unavailable'
    || code === 'failed-precondition'
    || message.includes('offline')
    || message.includes('network')
    || message.includes('tardó demasiado');
}
