const DATABASE_NAME = 'travelapp-ticket-files';
const STORE_NAME = 'files';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const GOOGLE_EXPORTS = new Map([
  ['application/vnd.google-apps.document', 'application/pdf'],
  ['application/vnd.google-apps.spreadsheet', 'application/pdf'],
  ['application/vnd.google-apps.presentation', 'application/pdf']
]);
const RETRYABLE_DRIVE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_DRIVE_ATTEMPTS = 4;
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

let databasePromise;
let pickerPromise;

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
  return normalizeFolderName(value)
    .replace(/(^| )(ida|salida|outbound|vuelta|regreso|return|1|2)( |$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findCityIndex(folderName, cities = []) {
  const folderBase = cityBase(folderName);
  if (!folderBase) return -1;
  const candidates = cities
    .map((city, index) => ({ city, index }))
    .filter(({ city }) => cityBase(city?.nombre) === folderBase);
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
    if (!folderMatchesCountry(parts[0], country)) return false;
    if (parts.length === 2) return true;
    return findCityIndex(parts[1], country.ciudades) === -1;
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

async function replaceTicketFiles(files) {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    files.forEach(file => store.put(file));
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

function loadPickerApi() {
  if (pickerPromise) return pickerPromise;
  pickerPromise = new Promise((resolve, reject) => {
    const initializePicker = () => {
      if (!window.gapi?.load) {
        reject(new Error('No se pudo cargar el selector de Google Drive.'));
        return;
      }
      window.gapi.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('No se pudo cargar el selector de Google Drive.'))
      });
    };

    if (window.gapi?.load) {
      initializePicker();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = initializePicker;
    script.onerror = () => reject(new Error('No se pudo conectar con el selector de Google Drive.'));
    document.head.appendChild(script);
  });
  return pickerPromise;
}

export async function chooseDriveFolder({ accessToken, apiKey, projectNumber }) {
  await loadPickerApi();
  if (!window.google?.picker || !apiKey || !projectNumber) {
    throw new Error('Falta configurar Google Picker y habilitar Google Drive API en el proyecto.');
  }

  return new Promise((resolve, reject) => {
    const pickerApi = window.google.picker;
    const folderView = new pickerApi.DocsView(pickerApi.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      .setMimeTypes(FOLDER_MIME_TYPE);
    const picker = new pickerApi.PickerBuilder()
      .addView(folderView)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setAppId(projectNumber)
      .setOrigin(window.location.origin)
      .setTitle('Seleccioná la carpeta de tickets')
      .setCallback(data => {
        if (data.action === pickerApi.Action.CANCEL) resolve(null);
        if (data.action === pickerApi.Action.PICKED) {
          const folder = data.docs?.[0];
          if (!folder?.id) {
            reject(new Error('No se pudo identificar la carpeta seleccionada.'));
          } else {
            resolve({ id: folder.id, name: folder.name || 'TravelApp' });
          }
        }
      })
      .build();
    picker.setVisible(true);
  });
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function driveRequest(url, accessToken, action, fetcher = fetch, pause = wait) {
  for (let attempt = 0; attempt < MAX_DRIVE_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetcher(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    } catch (error) {
      if (attempt === MAX_DRIVE_ATTEMPTS - 1) {
        throw new Error(`${action}: no se pudo conectar con Google Drive (${error.message}).`);
      }
      await pause(500 * (2 ** attempt));
      continue;
    }

    if (response.ok) return response;

    let details = '';
    try {
      const payload = await response.json();
      details = payload.error?.message || payload.error?.status || '';
    } catch {
      details = '';
    }

    if (RETRYABLE_DRIVE_STATUSES.has(response.status) && attempt < MAX_DRIVE_ATTEMPTS - 1) {
      const retryAfter = Number(response.headers?.get('Retry-After'));
      await pause(Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10000)
        : 500 * (2 ** attempt));
      continue;
    }

    const status = `Google Drive respondió ${response.status}`;
    throw new Error(`${action}: ${status}${details ? ` (${details})` : ''}.`);
  }
}

async function listFolderContents(folderId, accessToken) {
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,shortcutDetails(targetId,targetMimeType))',
      pageSize: '1000',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await driveRequest(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      accessToken,
      'No se pudo listar el contenido de una carpeta'
    );
    const result = await response.json();
    files.push(...(result.files || []));
    pageToken = result.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function downloadDriveFile(file, accessToken) {
  const targetId = file.shortcutDetails?.targetId || file.id;
  const mimeType = file.shortcutDetails?.targetMimeType || file.mimeType;
  const googleExportType = GOOGLE_EXPORTS.get(mimeType);
  const endpoint = googleExportType
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(targetId)}/export?mimeType=${encodeURIComponent(googleExportType)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(targetId)}?alt=media`;
  const response = await driveRequest(endpoint, accessToken, `No se pudo descargar "${file.name}"`);
  const blob = await response.blob();
  const name = googleExportType && !/\.pdf$/i.test(file.name) ? `${file.name}.pdf` : file.name;
  return { id: file.id, name, mimeType: blob.type || googleExportType || mimeType, blob };
}

export async function downloadDriveFolder({ folder, accessToken, onProgress = () => {} }) {
  const downloadedFiles = [];

  async function collect(folderId, parentPath) {
    const children = await listFolderContents(folderId, accessToken);
    for (const child of children) {
      const childId = child.shortcutDetails?.targetId || child.id;
      const childMimeType = child.shortcutDetails?.targetMimeType || child.mimeType;
      const relativePath = [...parentPath, child.name].join('/');
      if (childMimeType === FOLDER_MIME_TYPE) {
        await collect(childId, [...parentPath, child.name]);
        continue;
      }

      const file = await downloadDriveFile(child, accessToken);
      downloadedFiles.push({
        ...file,
        relativePath,
        modifiedTime: child.modifiedTime || '',
        downloadedAt: Date.now()
      });
      onProgress(downloadedFiles.length, child.name);
    }
  }

  await collect(folder.id, []);
  if (!downloadedFiles.length) throw new Error('La carpeta seleccionada no contiene archivos descargables.');
  await globalThis.navigator?.storage?.persist?.();
  await replaceTicketFiles(downloadedFiles);
  return downloadedFiles.length;
}