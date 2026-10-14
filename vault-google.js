(function () {
  'use strict';

  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const VAULT_STORAGE_KEY = 'travelapp.vault.files.v1';
  const GOOGLE_SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';
  let tokenClient = null;
  let currentAccessToken = '';
  let tokenExpiresAt = 0;
  let pickerReady = null;

  function getConfig() {
    return window.GOOGLE_VAULT_CONFIG || {};
  }

  function isConfigured() {
    const config = getConfig();
    return Boolean(config.clientId && config.apiKey && config.appId);
  }

  async function prepare() {
    if (!isConfigured()) throw new Error('Falta completar google-vault-config.js.');
    await loadGoogleLibraries();
  }

  function loadScript(src, id) {
    const existing = document.getElementById(id);
    if (existing?.dataset.loaded === 'true') return Promise.resolve();
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error('No se pudo cargar la biblioteca de Google.'));
      document.head.appendChild(script);
    });
  }

  async function loadGoogleLibraries() {
    await Promise.all([
      loadScript('https://accounts.google.com/gsi/client', 'google-identity-services'),
      loadScript('https://apis.google.com/js/api.js', 'google-api-client')
    ]);
    if (pickerReady) return pickerReady;

    pickerReady = new Promise((resolve, reject) => {
      window.gapi.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('Google Picker no pudo inicializarse.'))
      });
    });
    await pickerReady;
  }

  function requestAccessToken(promptValue = 'select_account') {
    if (!isConfigured()) {
      return Promise.reject(new Error('Falta configurar clientId, apiKey y appId en google-vault-config.js.'));
    }

    return loadGoogleLibraries().then(() => new Promise((resolve, reject) => {
      if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: getConfig().clientId,
          scope: DRIVE_FILE_SCOPE,
          callback: response => {
            if (response.error) {
              reject(new Error(response.error_description || response.error));
              return;
            }
            currentAccessToken = response.access_token;
            tokenExpiresAt = Date.now() + (Number(response.expires_in || 0) * 1000);
            resolve(currentAccessToken);
          },
          error_callback: error => reject(new Error(error.message || 'No se pudo autorizar Google.'))
        });
      }

      if (currentAccessToken && Date.now() < tokenExpiresAt - 60000) {
        resolve(currentAccessToken);
        return;
      }

      tokenClient.requestAccessToken({ prompt: promptValue });
    }));
  }

  async function getAccessToken() {
    if (currentAccessToken && Date.now() < tokenExpiresAt - 60000) return currentAccessToken;
    return requestAccessToken('select_account');
  }

  function hasAccessToken() {
    return Boolean(currentAccessToken && Date.now() < tokenExpiresAt - 60000);
  }

  async function ensurePicker() {
    await loadGoogleLibraries();
    if (!currentAccessToken || Date.now() >= tokenExpiresAt - 60000) {
      await getAccessToken();
    }
  }

  async function pickDriveFile({ mimeType, title }) {
    await ensurePicker();
    const config = getConfig();

    return new Promise((resolve, reject) => {
      const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
        .setIncludeFolders(false)
        .setMimeTypes(mimeType);
      const picker = new window.google.picker.PickerBuilder()
        .setAppId(config.appId)
        .setDeveloperKey(config.apiKey)
        .setOAuthToken(currentAccessToken)
        .setTitle(title)
        .addView(view)
        .setCallback(data => {
          if (data.action === window.google.picker.Action.CANCEL) {
            resolve(null);
          } else if (data.action === window.google.picker.Action.PICKED) {
            resolve(data.docs[0]);
          }
        })
        .build();
      picker.setVisible(true);
    });
  }

  function saveSelectedFiles(files) {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(files));
  }

  function getSelectedFiles() {
    try {
      const files = JSON.parse(localStorage.getItem(VAULT_STORAGE_KEY) || 'null');
      return files && files.manifestId && files.spreadsheetId ? files : null;
    } catch {
      return null;
    }
  }

  async function selectVaultFiles() {
    const manifest = await pickDriveFile({
      mimeType: 'application/json',
      title: 'Seleccioná el archivo privado vault.json'
    });
    if (!manifest) return null;

    const manifestData = await getDriveJson(manifest.id);
    if (!manifestData || manifestData.schemaVersion !== 1 || !manifestData.spreadsheetId) {
      throw new Error('El vault.json debe tener schemaVersion 1 y spreadsheetId.');
    }

    const spreadsheet = await pickDriveFile({
      mimeType: GOOGLE_SHEETS_MIME,
      title: 'Seleccioná la planilla compartida del viaje'
    });
    if (!spreadsheet) return null;
    if (spreadsheet.id !== manifestData.spreadsheetId) {
      throw new Error('La planilla elegida no coincide con spreadsheetId dentro de vault.json.');
    }

    const selected = {
      manifestId: manifest.id,
      manifestName: manifest.name,
      spreadsheetId: spreadsheet.id,
      spreadsheetName: spreadsheet.name,
      sheets: manifestData.sheets
    };
    saveSelectedFiles(selected);
    return selected;
  }

  async function googleFetch(url, options = {}) {
    const accessToken = await getAccessToken();
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });

    if (response.status === 401) {
      currentAccessToken = '';
      tokenExpiresAt = 0;
      throw new Error('La sesión de Google venció. Tocá Conectar Google para autorizar nuevamente.');
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google respondió ${response.status}: ${detail.slice(0, 240)}`);
    }
    return response;
  }

  async function getDriveJson(fileId) {
    const response = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
    return response.json();
  }

  function getRangeForSheet(sheetName) {
    const safeName = String(sheetName).replace(/'/g, "''");
    return `'${safeName}'!A1:Z`;
  }

  function columnName(columnIndex) {
    let number = columnIndex + 1;
    let name = '';
    while (number > 0) {
      const remainder = (number - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      number = Math.floor((number - 1) / 26);
    }
    return name;
  }

  async function readSheetRows(spreadsheetId, sheetName) {
    const range = encodeURIComponent(getRangeForSheet(sheetName));
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`;
    const response = await googleFetch(url);
    const payload = await response.json();
    return Array.isArray(payload.values) ? payload.values : [];
  }

  async function writeSheetRows(spreadsheetId, updates) {
    if (!updates.length) return;
    const data = updates.map(update => ({
      range: `'${String(update.sheetName).replace(/'/g, "''")}'!A${update.rowNumber}:${columnName(update.values.length - 1)}${update.rowNumber}`,
      values: [update.values]
    }));
    const response = await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data })
      }
    );
    return response.json();
  }

  async function getCurrentUserEmail() {
    const response = await googleFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
    const payload = await response.json();
    return payload.user?.emailAddress || '';
  }

  function disconnect() {
    currentAccessToken = '';
    tokenExpiresAt = 0;
  }

  window.GoogleVault = Object.freeze({
    DRIVE_FILE_SCOPE,
    GOOGLE_SHEETS_MIME,
    isConfigured,
    prepare,
    requestAccessToken,
    getAccessToken,
    hasAccessToken,
    pickDriveFile,
    getSelectedFiles,
    selectVaultFiles,
    readSheetRows,
    writeSheetRows,
    getCurrentUserEmail,
    disconnect
  });
})();
