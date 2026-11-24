const STORAGE_KEY = 'travelapp-activity-markers-v1';

function getStorage(storage) {
  if (storage !== undefined) {
    if (!storage) throw new Error('El almacenamiento local no está disponible.');
    return storage;
  }
  try {
    if (!globalThis.localStorage) throw new Error('El almacenamiento local no está disponible.');
    return globalThis.localStorage;
  } catch (error) {
    throw new Error(`No se pudo acceder al almacenamiento local: ${error.message}`, { cause: error });
  }
}

function readMarkers(storage) {
  const store = getStorage(storage);
  let serialized;
  try {
    serialized = store.getItem(STORAGE_KEY);
  } catch (error) {
    throw new Error(`No se pudieron leer las marcas locales: ${error.message}`, { cause: error });
  }
  if (!serialized) return {};
  try {
    const parsed = JSON.parse(serialized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn('Se ignoraron marcas locales con formato inválido:', error);
    return {};
  }
}

function writeMarkers(markers, storage) {
  try {
    getStorage(storage).setItem(STORAGE_KEY, JSON.stringify(markers));
  } catch (error) {
    throw new Error(`No se pudieron guardar las marcas locales: ${error.message}`, { cause: error });
  }
}

function validDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function activityDateKey(cityDates, day) {
  const dayNumber = Number(day);
  if (!Number.isInteger(dayNumber) || dayNumber < 1) return null;
  const match = String(cityDates || '').match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const startDay = Number(dayText);
  const startMonth = Number(monthText);
  const year = Number(yearText);
  if (!validDateParts(year, startMonth, startDay)) return null;
  const date = new Date(Date.UTC(year, startMonth - 1, startDay + dayNumber - 1));
  return date.toISOString().slice(0, 10);
}

export function activityMarkerKey({
  userId = '',
  countryId = '',
  cityId = '',
  activityId = '',
  name = '',
  day = '',
  order = ''
} = {}) {
  if (!userId || !countryId || !cityId) {
    throw new Error('Faltan datos para identificar la marca de la actividad.');
  }
  const activityKey = activityId || `legacy:${order}:${day}:${name}`;
  return JSON.stringify([userId, countryId, cityId, activityKey]);
}

export function getActivityMarkers(key, storage) {
  if (!key) throw new Error('Falta el identificador de la actividad.');
  const markers = readMarkers(storage);
  const entry = markers[key];
  return {
    favorite: entry?.favorite === true,
    important: entry?.important === true,
    reminder: entry?.reminder && typeof entry.reminder === 'object'
      ? { ...entry.reminder }
      : null
  };
}

export function toggleActivityMarker(key, type, reminderDetails = {}, storage) {
  if (!key) throw new Error('Falta el identificador de la actividad.');
  if (type !== 'favorite' && type !== 'important') {
    throw new Error('La marca debe ser favorita o importante.');
  }

  const markers = readMarkers(storage);
  const entry = markers[key] && typeof markers[key] === 'object' ? markers[key] : {};
  const updated = {
    favorite: entry.favorite === true,
    important: entry.important === true,
    reminder: entry.reminder && typeof entry.reminder === 'object' ? { ...entry.reminder } : null
  };
  updated[type] = !updated[type];

  if (type === 'important') {
    updated.reminder = updated.important
      ? {
        title: String(reminderDetails.title || ''),
        country: String(reminderDetails.country || ''),
        city: String(reminderDetails.city || ''),
        date: String(reminderDetails.date || '')
      }
      : null;
  }

  if (updated.favorite || updated.important) markers[key] = updated;
  else delete markers[key];
  writeMarkers(markers, storage);
  return updated;
}

export function getDueImportantActivities(today, storage) {
  const markers = readMarkers(storage);
  return Object.entries(markers)
    .filter(([, entry]) => entry?.important === true
      && entry?.reminder?.date
      && entry.reminder.date <= today
      && entry.reminder.completed !== true)
    .map(([key, entry]) => ({ key, ...entry.reminder }))
    .sort((first, second) => first.date.localeCompare(second.date)
      || first.country.localeCompare(second.country)
      || first.city.localeCompare(second.city)
      || first.title.localeCompare(second.title));
}

export function completeImportantActivityReminder(key, storage) {
  if (!key) throw new Error('Falta el identificador del recordatorio.');
  const markers = readMarkers(storage);
  const entry = markers[key];
  if (entry?.important !== true || !entry.reminder) return false;
  markers[key] = {
    ...entry,
    reminder: { ...entry.reminder, completed: true }
  };
  writeMarkers(markers, storage);
  return true;
}
