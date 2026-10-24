const DATABASE_NAME = 'travelapp-ticket-files';
const STORE_NAME = 'files';
const COUNTRY_ALIASES = {
  alemania: 'germany',
  belgica: 'belgium',
  czechia: 'czech',
  'czech republic': 'czech',
  espana: 'spain',
  finlandia: 'finland',
  'republica checa': 'czech',
  suecia: 'sweden'
};
const CITY_ALIASES = {
  brussels: 'bruselas',
  bruxelles: 'bruselas',
  stockholm: 'estocolmo'
};

let databasePromise;

export function normalizeFolderName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function canManageTicketFiles(member) {
  return member?.enabled === true && member.role === 'admin';
}

export function normalizeSelectedFolderFiles(files, { fallbackPath = '' } = {}) {
  return Array.from(files || []).map(file => {
    const parts = String(file.webkitRelativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length < 2) {
      if (!fallbackPath) {
        throw new Error('El teléfono no conservó las carpetas. Abrí la ciudad del itinerario y elegí sus archivos desde Descargas.');
      }
      const relativePath = `${fallbackPath}/${file.name}`;
      return {
        id: relativePath,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        blob: file,
        relativePath,
        modifiedTime: file.lastModified ? new Date(file.lastModified).toISOString() : '',
        downloadedAt: Date.now()
      };
    }

    const relativePath = parts.slice(1).join('/');
    return {
      id: relativePath,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      blob: file,
      relativePath,
      modifiedTime: file.lastModified ? new Date(file.lastModified).toISOString() : '',
      downloadedAt: Date.now()
    };
  });
}

export function ticketButtonLabel(file, files) {
  const match = String(file.name || '').match(/^(.*?)[ _-]([a-z]{2})\.pdf$/i);
  if (!match) return file.name;

  const [, baseName, language] = match;
  if (language.toLowerCase() === 'es') return 'Voucher ES';

  const normalizedBase = normalizeFolderName(baseName);
  const hasSpanishVersion = files.some(candidate => {
    const candidateMatch = String(candidate.name || '').match(/^(.*?)[ _-]([a-z]{2})\.pdf$/i);
    return candidateMatch
      && candidateMatch[2].toLowerCase() === 'es'
      && normalizeFolderName(candidateMatch[1]) === normalizedBase;
  });

  return hasSpanishVersion ? 'Voucher original' : file.name;
}

function countryKey(value) {
  const normalized = normalizeFolderName(value);
  return COUNTRY_ALIASES[normalized] || normalized;
}

export function folderMatchesCountry(folderName, country) {
  const folderKey = countryKey(folderName);
  return [country?.id, country?.pais]
    .filter(Boolean)
    .some(name => countryKey(name) === folderKey);
}

function tripStage(value) {
  const normalized = normalizeFolderName(value);
  if (/(^| )(ida|salida|outbound|1)( |$)/.test(normalized)) return 'ida';
  if (/(^| )(vuelta|regreso|return|2)( |$)/.test(normalized)) return 'vuelta';
  return '';
}

function cityBase(value) {
  const base = normalizeFolderName(value)
    .replace(/(^| )(ida|salida|outbound|vuelta|regreso|return|1|2)( |$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CITY_ALIASES[base] || base;
}

export function findCityIndex(folderName, cities = []) {
  const folderBase = cityBase(folderName);
  if (!folderBase) return -1;
  const namedCities = cities
    .map((city, index) => ({ city, index }))
    .map(entry => ({ ...entry, base: cityBase(entry.city?.nombre) }));
  const exactCandidates = namedCities.filter(({ base }) => base === folderBase);
  if (exactCandidates.length === 1) return exactCandidates[0].index;

  const candidates = exactCandidates.length
    ? exactCandidates
    : namedCities.filter(({ base }) => base.startsWith(`${folderBase} `));
  if (candidates.length === 1) return candidates[0].index;

  const stage = tripStage(folderName);
  const staged = candidates.filter(({ city }) => tripStage(city?.nombre) === stage);
  return staged.length === 1 ? staged[0].index : -1;
}

function pathParts(file) {
  return String(file.relativePath || '').split('/').filter(Boolean);
}

export function filesForCountry(files, country) {
  return files.filter(file => {
    const parts = pathParts(file);
    return folderMatchesCountry(parts[0], country) && parts.length === 2;
  });
}

export function filesForCity(files, country, city) {
  const cityIndex = (country.ciudades || []).findIndex(item => item.id === city.id);
  if (cityIndex < 0) return [];
  return files.filter(file => {
    const parts = pathParts(file);
    return folderMatchesCountry(parts[0], country)
      && parts.length > 2
      && findCityIndex(parts[1], country.ciudades) === cityIndex;
  });
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('Este navegador no permite guardar archivos sin conexión.'));
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento local.'));
  });
  return databasePromise;
}

export async function getTicketFiles() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('No se pudieron leer los archivos locales.'));
  });
}

async function replaceTicketFiles(files, onProgress = () => {}, { merge = false } = {}) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    if (!merge) store.clear();
    files.forEach((file, index) => {
      const request = store.put(file);
      request.onsuccess = () => onProgress(index + 1, file.name, files.length);
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('No se pudieron guardar los archivos en el teléfono.'));
    transaction.onabort = () => reject(transaction.error || new Error('No se pudieron guardar los archivos en el teléfono.'));
  }).catch(error => {
    if (error?.name === 'QuotaExceededError') {
      throw new Error('No hay espacio local suficiente para guardar esta carpeta.');
    }
    throw error;
  });
}

export function chooseLocalFolder() {
  return new Promise((resolve, reject) => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.setAttribute('webkitdirectory', '');
    picker.setAttribute('directory', '');
    picker.style.position = 'fixed';
    picker.style.left = '-10000px';
    const finish = files => {
      picker.remove();
      resolve(Array.from(files || []));
    };
    picker.addEventListener('change', () => finish(picker.files), { once: true });
    picker.addEventListener('cancel', () => finish([]), { once: true });
    document.body.appendChild(picker);
    picker.click();
  });
}

export async function saveLocalFolderFiles(files, { onProgress = () => {}, fallbackPath = '' } = {}) {
  const downloadedFiles = normalizeSelectedFolderFiles(files, { fallbackPath });
  if (!downloadedFiles.length) throw new Error('La carpeta seleccionada no contiene archivos.');
  await globalThis.navigator?.storage?.persist?.();
  await replaceTicketFiles(downloadedFiles, onProgress, { merge: Boolean(fallbackPath) });
  return downloadedFiles.length;
}