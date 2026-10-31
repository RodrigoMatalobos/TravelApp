import {
  canManageTicketFiles,
  chooseLocalFolder,
  filesForCity,
  getTicketFiles,
  saveLocalFolderFiles,
  ticketButtonLabel
} from './ticket-files.mjs';
import routeCatalog from './route-catalog.mjs';

let currentViewState = { level: 'paises', paisId: null };
let homeMode = 'list';
let homeCountries = [];
let disposeGlobe = null;
let focusedGlobeLocation = null;
let signedInUser = null;
let activeMember = null;
let downloadedTicketFiles = [];
let ticketImportContext = null;
let ticketImportDismissTimer = null;
let itinerarySyncPromise = null;
let itinerarySyncError = '';
let authCallbackSequence = 0;
let viewSequence = 0;

if ('serviceWorker' in navigator && import.meta.env.DEV) {
  navigator.serviceWorker.getRegistrations()
    .then(registrations => registrations.forEach(registration => registration.unregister()))
    .catch(error => console.warn('No se pudo limpiar el service worker local:', error));
} else if ('serviceWorker' in navigator) {
  let reloadingAfterUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingAfterUpdate) return;
    reloadingAfterUpdate = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('sw.js?v=1.0.25', { updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(err => console.error('Service Worker error:', err));
}

document.addEventListener('DOMContentLoaded', () => {
  window.history.replaceState(
    { ...(window.history.state || {}), travelAppView: currentViewState },
    '',
    window.location.href
  );
  window.addEventListener('popstate', event => {
    restoreAppView(event.state?.travelAppView);
  });

  const backButton = document.getElementById('btnBack');
  if (backButton) {
    backButton.addEventListener('click', handleBack);
  }
  document.getElementById('btnVaultMenu')?.addEventListener('click', () => setVaultMenuOpen(true));
  document.querySelectorAll('[data-menu-close]').forEach(button => {
    button.addEventListener('click', () => setVaultMenuOpen(false));
  });
  document.querySelectorAll('[data-vault-page]').forEach(button => {
    button.addEventListener('click', () => {
      setVaultMenuOpen(false);
      showVaultListView(button.dataset.vaultPage);
    });
  });
  document.querySelector('[data-admin-access]')?.addEventListener('click', () => {
    setVaultMenuOpen(false);
    showAccessAdminView();
  });
  document.querySelector('[data-download-ticket-files]')?.addEventListener('click', event => {
    setVaultMenuOpen(false);
    startTicketFolderDownload(event.currentTarget);
  });
  document.getElementById('ticketImportDismiss')?.addEventListener('click', () => setTicketImportStatus({ visible: false }));
  document.querySelector('[data-sign-out]')?.addEventListener('click', () => {
    setVaultMenuOpen(false);
    window.TravelFirebase.signOut();
  });
  document.querySelector('[data-refresh-data]')?.addEventListener('click', async () => {
    setVaultMenuOpen(false);
    setTopLoading(true);
    try {
      await window.TravelFirestore.refreshItineraryNow();
      if (currentViewState.level === 'paises') showPaisesView();
      else if (currentViewState.paisId) showCiudadesView(currentViewState.paisId);
      else showPaisesView();
    } catch (error) {
      console.error('No se pudieron actualizar los datos:', error);
    } finally {
      setTopLoading(false);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setVaultMenuOpen(false);
  });
  updateVaultNavigation();
  initializeFirebaseAccess();
});

function disposeHomeGlobe() {
  disposeGlobe?.();
  disposeGlobe = null;
  focusedGlobeLocation = null;
}

function ensureItineraryDataSynced() {
  if (!itinerarySyncPromise) {
    itinerarySyncPromise = import('./itinerary-source.mjs')
      .then(({ itinerarySource }) => window.TravelFirestore.syncItineraryData(itinerarySource))
      .catch(error => {
        itinerarySyncPromise = null;
        throw error;
      });
  }
  return itinerarySyncPromise;
}

function syncWarningMarkup(extraClass = '') {
  if (!itinerarySyncError) return '';
  return `<div class="rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-100 ${extraClass}" role="status">${escapeHtml(itinerarySyncError)}</div>`;
}

// Barra fina de carga superior: solo aparece mientras se habla con Firebase.
let loadingCounter = 0;
function setTopLoading(active) {
  loadingCounter = Math.max(0, loadingCounter + (active ? 1 : -1));
  document.getElementById('topProgress')?.classList.toggle('hidden', loadingCounter === 0);
}

// Compara una única vez lo mostrado contra Firebase; si cambió, redibuja Home.
function scheduleItineraryRevalidation() {
  window.TravelFirestore.revalidateItinerary()
    .then(changed => {
      if (changed.length && currentViewState.level === 'paises') showPaisesView();
    })
    .catch(() => {});
}

function renderSignIn(message = '') {
  disposeHomeGlobe();
  updateHeader('🌍 Plan de Viaje', false);
  updateVaultNavigation();
  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'flex min-h-[calc(100svh-64px)] max-w-md mx-auto items-center justify-center p-4';
  container.innerHTML = `
    <section class="rounded-xl border border-slate-700 bg-slate-800 p-5 text-center">
      <h2 class="text-lg font-semibold text-white">Acceso al viaje</h2>
      <p class="mt-2 text-sm text-slate-300">Iniciá sesión con Google para ver el itinerario y las listas compartidas.</p>
      <button id="firebase-sign-in" type="button" class="mt-5 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500">Acceso</button>
      <p id="firebase-auth-message" class="mt-3 text-sm text-red-300" role="status">${escapeHtml(message)}</p>
    </section>
  `;
  container.querySelector('#firebase-sign-in')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await window.TravelFirebase.signIn();
      renderCheckingAccess('Verificando permisos…');
    } catch (error) {
      const status = container.querySelector('#firebase-auth-message');
      if (status) status.textContent = error.message || 'No se pudo iniciar sesión.';
      button.disabled = false;
    }
  });
}

function renderCheckingAccess(message = 'Verificando permisos…') {
  updateHeader('Verificando acceso', false);
  updateVaultNavigation();
  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'p-4 max-w-md mx-auto';
  container.innerHTML = `<p class="py-8 text-center text-sm text-slate-300">${escapeHtml(message)}</p>`;
}

function renderPendingAccess(user, error = '') {
  disposeHomeGlobe();
  updateHeader('Acceso pendiente', false);
  updateVaultNavigation();
  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'p-4 max-w-md mx-auto space-y-4';
  container.innerHTML = `
    <section class="rounded-xl border border-amber-500/40 bg-amber-950/30 p-5">
      <h2 class="text-lg font-semibold text-amber-100">Cuenta pendiente de habilitación</h2>
      <p class="mt-2 text-sm text-amber-100/80">Tu solicitud quedó registrada. El administrador del viaje debe habilitar esta cuenta antes de que pueda ver los datos.</p>
      <dl class="mt-4 space-y-2 text-xs text-amber-50">
        <div><dt class="font-semibold">Cuenta</dt><dd>${escapeHtml(user.email || '')}</dd></div>
        <div><dt class="font-semibold">UID</dt><dd class="break-all">${escapeHtml(user.uid)}</dd></div>
      </dl>
      ${error ? `<p class="mt-3 text-sm text-red-300">${escapeHtml(error)}</p>` : ''}
      <button id="firebase-sign-out" type="button" class="mt-5 rounded-lg border border-amber-100/40 px-4 py-2 text-sm text-amber-50 hover:bg-amber-100/10">Cerrar sesión</button>
    </section>
  `;
  container.querySelector('#firebase-sign-out')?.addEventListener('click', () => window.TravelFirebase.signOut());
}

function renderTicketDownloadPrompt(message = '') {
  if (!canManageTicketFiles(activeMember)) return showPaisesView();
  disposeHomeGlobe();
  updateHeader('Archivos del viaje', false);
  updateVaultNavigation();
  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'flex min-h-[calc(100svh-64px)] max-w-md mx-auto items-center justify-center p-4';
  container.innerHTML = `
    <section class="w-full rounded-xl border border-slate-700 bg-slate-800 p-5 text-center">
      <h2 class="text-lg font-semibold text-white">Archivos del viaje</h2>
      <p class="mt-2 text-sm text-slate-300">Elegí la carpeta TravelApp desde Mis archivos. En el teléfono también podés elegir archivos sueltos de Descargas si abriste antes su ciudad en el itinerario.</p>
      ${message ? `<p class="mt-3 text-sm text-amber-200" role="status">${escapeHtml(message)}</p>` : ''}
      <button id="download-ticket-folder" type="button" class="mt-5 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500">Cargar archivos</button>
      <button id="skip-ticket-download" type="button" class="mt-2 w-full rounded-lg border border-slate-600 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/5">Ahora no</button>
    </section>
  `;
  container.querySelector('#download-ticket-folder')?.addEventListener('click', event => {
    startTicketFolderDownload(event.currentTarget);
  });
  container.querySelector('#skip-ticket-download')?.addEventListener('click', () => {
    updateVaultNavigation();
    showPaisesView();
  });
}

async function startTicketFolderDownload(button) {
  if (!canManageTicketFiles(activeMember)) return showPaisesView();
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Cargar archivos';
  setTicketImportStatus({ message: 'Esperando selección de archivos…', current: 0, total: 0 });
  try {
    const files = await chooseLocalFolder();
    if (!files.length) {
      setTicketImportStatus({ message: 'No se seleccionaron archivos.', variant: 'complete' });
      return;
    }

    const fallbackPath = ticketImportContext
      ? `${ticketImportContext.country.id || ticketImportContext.country.pais}/${ticketImportContext.country.ciudades[ticketImportContext.cityIndex].nombre}`
      : '';
    setTicketImportStatus({ message: `Guardando ${files.length} archivos…`, current: 0, total: files.length });
    await saveLocalFolderFiles(files, {
      fallbackPath,
      onProgress: (count, name, total) => setTicketImportStatus({
        message: `Guardando ${name} (${count}/${total})…`,
        current: count,
        total
      })
    });
    downloadedTicketFiles = await getTicketFiles();
    updateVaultNavigation();
    setTicketImportStatus({
      message: `${files.length} archivos guardados en este dispositivo.`,
      current: files.length,
      total: files.length,
      variant: 'complete'
    });
    if (ticketImportContext) {
      showDetalleCiudadView(ticketImportContext.country, ticketImportContext.cityIndex, ticketImportContext.country.id);
    } else {
      showPaisesView();
    }
  } catch (error) {
    setTicketImportStatus({ message: error.message || 'No se pudieron cargar los archivos.', variant: 'error' });
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function setTicketImportStatus({ message = '', current = 0, total = 0, variant = 'loading', visible = true } = {}) {
  const panel = document.getElementById('ticketImportStatus');
  const label = document.getElementById('ticketImportMessage');
  const track = document.getElementById('ticketImportTrack');
  const bar = document.getElementById('ticketImportBar');
  if (!panel || !label || !track || !bar) return;
  clearTimeout(ticketImportDismissTimer);
  panel.classList.toggle('hidden', !visible);
  label.textContent = message;
  track.classList.toggle('hidden', !visible || !message || variant === 'error');
  bar.classList.remove('animate-[top-loading_1s_ease-in-out_infinite]');
  if (visible && variant === 'loading' && total === 0) {
    bar.style.width = '35%';
    bar.classList.add('animate-[top-loading_1s_ease-in-out_infinite]');
    track.removeAttribute('aria-valuenow');
    track.setAttribute('aria-label', 'Esperando selección de archivos');
  } else if (total > 0) {
    const percentage = Math.round((current / total) * 100);
    bar.style.width = `${percentage}%`;
    track.setAttribute('aria-valuenow', String(current));
    track.setAttribute('aria-valuemax', String(total));
    track.setAttribute('aria-label', 'Progreso de guardado de archivos');
  }
  if (visible && variant !== 'loading') {
    ticketImportDismissTimer = setTimeout(() => setTicketImportStatus({ visible: false }), 5000);
  }
}

function initializeFirebaseAccess() {
  const container = document.getElementById('app');
  if (container) container.innerHTML = '<p class="py-8 text-center text-sm text-slate-300">Verificando acceso…</p>';
  if (!window.TravelFirebase || !window.TravelFirestore) {
    renderSignIn('No se pudo inicializar Firebase. Revisá la configuración local y recargá la página.');
    return;
  }

  window.TravelFirebase.onAuthStateChanged(window.TravelFirebase.auth, async user => {
    const callbackId = ++authCallbackSequence;
    const isCurrentAuthState = () => callbackId === authCallbackSequence && signedInUser?.uid === user?.uid;
    signedInUser = user;
    activeMember = null;
    downloadedTicketFiles = [];
    ticketImportContext = null;
    itinerarySyncError = '';
    viewSequence += 1;
    updateVaultNavigation();

    if (!user) {
      itinerarySyncPromise = null;
      renderSignIn();
      return;
    }

    renderCheckingAccess('Verificando permisos…');
    try {
      const member = await window.TravelFirestore.getMember(user.uid);
      if (!isCurrentAuthState()) return;
      if (!member?.enabled) {
        await window.TravelFirestore.submitAccessRequest(user);
        if (isCurrentAuthState()) renderPendingAccess(user);
        return;
      }

      activeMember = member;
      if (member.role === 'admin') {
        renderCheckingAccess('Actualizando itinerario…');
        try {
          const result = await ensureItineraryDataSynced();
          if (!isCurrentAuthState()) return;
          if (result.writeCount) {
            console.info(`Itinerario sincronizado: ${result.writeCount} cambios, ${result.routeStops} paradas.`);
          }
        } catch (error) {
          if (!isCurrentAuthState()) return;
          console.error('No se pudo sincronizar el itinerario local:', error);
          itinerarySyncError = 'No se pudo actualizar Firebase con el itinerario local. Se mostrarán los datos disponibles.';
        }
      }

      if (canManageTicketFiles(member)) {
        try {
          downloadedTicketFiles = await getTicketFiles();
        } catch (error) {
          console.warn('No se pudieron leer los archivos locales:', error);
          downloadedTicketFiles = [];
        }
        if (!isCurrentAuthState()) return;
        updateVaultNavigation();
        if (downloadedTicketFiles.length) showPaisesView();
        else renderTicketDownloadPrompt();
        scheduleItineraryRevalidation();
        return;
      }

      downloadedTicketFiles = [];
      if (!isCurrentAuthState()) return;
      updateVaultNavigation();
      showPaisesView();
      scheduleItineraryRevalidation();
    } catch (error) {
      if (isCurrentAuthState()) {
        renderPendingAccess(user, error.message || 'No se pudo verificar la autorización.');
      }
    }
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderEmptyState(message) {
  const container = document.getElementById('app');
  if (!container) return;
  container.innerHTML = `<div class="text-center text-slate-300 bg-slate-800 border border-slate-700 rounded-xl p-4">${message}</div>`;
}

function handleFetchError(message, url = '') {
  console.error(message, url);
  renderEmptyState(message);
}

function normalizeActivities(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (typeof item === 'string') {
      return { nombre: item, mapa: '' };
    }
    return {
      dia: Number.isFinite(Number(item?.dia)) ? Number(item.dia) : null,
      nombre: item?.nombre || '',
      mapa: item?.mapa || ''
    };
  }).filter(item => item.nombre);
}

function groupActivitiesByDay(activities) {
  const groups = new Map();

  activities.forEach(activity => {
    let day = activity.dia;
    let name = activity.nombre;
    const legacyDay = name.match(/^Día\s+(\d+)\s*:\s*/i);

    if (!day && legacyDay) {
      day = Number(legacyDay[1]);
      name = name.slice(legacyDay[0].length).trim();
    }

    const key = day > 0 ? day : 'general';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...activity, dia: day, nombre: name });
  });

  return Array.from(groups.entries()).sort(([first], [second]) => {
    if (first === 'general') return 1;
    if (second === 'general') return -1;
    return first - second;
  });
}

function renderGroupedActivities(activities, emptyMessage) {
  if (!activities.length) {
    return `<div class="text-xs text-slate-400">${emptyMessage}</div>`;
  }

  return groupActivitiesByDay(activities).map(([day, items]) => `
    <div class="space-y-1.5">
      ${day === 'general' ? '' : `<h5 class="text-[11px] font-bold uppercase tracking-wide text-blue-400 pt-2">Día ${day}</h5>`}
      ${items.map(item => `
        <div class="bg-slate-900/40 p-3 rounded-xl border border-slate-700/30 flex justify-between items-start gap-3 text-sm leading-relaxed">
          <span class="text-slate-300 flex-1 min-w-0">${escapeHtml(item.nombre)}</span>${item.mapa ? `
            <a href="${escapeHtml(item.mapa)}" target="_blank" rel="noopener noreferrer" class="shrink-0 whitespace-nowrap text-blue-400 font-medium hover:underline text-xs flex items-center gap-1 bg-slate-800 px-2.5 py-1.5 rounded-md border border-slate-700">
              📍 Maps
            </a>` : ''}
        </div>
      `).join('')}
    </div>
  `).join('');
}

function normalizeCountryId(rawId) {
  const value = String(rawId || '').trim().toLowerCase();
  const aliases = {
    espana: 'spain',
    'españa': 'spain',
    finlandia: 'finland',
    suecia: 'sweden',
    belgica: 'belgium',
    alemania: 'germany',
    'república checa': 'czech',
    'republica checa': 'czech',
    'czech republic': 'czech'
  };

  return aliases[value] || value;
}

function appendTicketFiles(container, files, title) {
  if (!container || !canManageTicketFiles(activeMember) || !files.length) return;
  const section = document.createElement('section');
  section.className = 'mt-3 space-y-2';
  section.innerHTML = `<h4 class="text-xs font-bold text-slate-300">${escapeHtml(title)}</h4>`;
  const list = document.createElement('div');
  list.className = 'flex flex-wrap gap-2';
  files.forEach(file => {
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(file.blob);
    const canPreview = file.mimeType === 'application/pdf' || file.mimeType?.startsWith('image/');
    const label = ticketButtonLabel(file, files);
    link.href = objectUrl;
    link.className = 'inline-flex max-w-full items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-white transition-colors hover:bg-slate-600 active:scale-95';
    link.rel = 'noopener noreferrer';
    link.title = file.name;
    link.setAttribute('aria-label', label);
    if (canPreview) link.target = '_blank';
    else link.download = file.name;
    link.innerHTML = `<span class="min-w-0 break-words">📄 ${escapeHtml(label)}</span>`;
    list.appendChild(link);
  });
  section.appendChild(list);
  container.appendChild(section);
}

// Nivel 1: Cargar la lista de países
function setCurrentViewState(nextState, recordHistory = true) {
  const isSameView = Object.keys(nextState).every(key => currentViewState[key] === nextState[key])
    && Object.keys(currentViewState).every(key => nextState[key] === currentViewState[key]);
  if (!isSameView && recordHistory) {
    window.history.pushState(
      { ...(window.history.state || {}), travelAppView: nextState },
      '',
      window.location.href
    );
  }
  currentViewState = nextState;
}

function showPaisesView(recordHistory = true) {
  const requestId = ++viewSequence;
  disposeHomeGlobe();
  ticketImportContext = null;
  setCurrentViewState({ level: 'paises', paisId: null }, recordHistory);
  updateHeader('🌍 Elegí un Destino', false);

  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'p-4 max-w-md mx-auto space-y-4';
  container.innerHTML = '<p class="text-center text-slate-400 text-sm">Cargando países...</p>';
  setTopLoading(true);

  window.TravelFirestore.loadCountries()
    .then(paises => {
      setTopLoading(false);
      if (requestId !== viewSequence) return;
      if (!Array.isArray(paises) || !paises.length) {
        renderEmptyState('No se pudieron cargar los destinos.');
        return;
      }

      homeCountries = paises;
      renderHomeView();
    })
    .catch(err => {
      setTopLoading(false);
      if (requestId !== viewSequence) return;
      handleFetchError('No se pudo cargar la lista de países desde Firebase.', 'countries');
    });
}

// Nivel 2: Cargar dinámicamente el JSON del país seleccionado
function showCiudadesView(paisId, recordHistory = true) {
  const requestId = ++viewSequence;
  disposeHomeGlobe();
  ticketImportContext = null;
  const canonicalPaisId = normalizeCountryId(paisId);
  setCurrentViewState({ level: 'ciudades', paisId: canonicalPaisId }, recordHistory);

  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'p-4 max-w-md mx-auto space-y-4';
  container.innerHTML = '<p class="text-center text-slate-400 text-sm py-8">Cargando itinerario...</p>';
  setTopLoading(true);

  window.TravelFirestore.loadCountry(canonicalPaisId)
    .then(pais => {
      setTopLoading(false);
      if (requestId !== viewSequence) return;
      if (!pais || !pais.pais) {
        const selectedCountry = homeCountries.find(country => country.id === canonicalPaisId);
        renderEmptyState(`El itinerario de ${escapeHtml(selectedCountry?.pais || 'este país')} todavía no está cargado.`);
        return;
      }

      if (pais.id) {
        pais.id = normalizeCountryId(pais.id);
      }

      updateHeader(`${pais.flag || ''} ${pais.pais}`.trim(), true);
      container.innerHTML = '';

      // Un país puede tener N playlists de Spotify (campo `playlists` en el JSON).
      // Si todavía existe el campo viejo `spotifyUrl`, se usa como única lista.
      const playlists = (Array.isArray(pais.playlists) && pais.playlists.length)
        ? pais.playlists
        : (pais.spotifyUrl ? [{ nombre: `Playlist de ${pais.pais}`, url: pais.spotifyUrl }] : []);
      playlists.forEach(playlist => {
        const spotifyBtn = document.createElement('a');
        spotifyBtn.href = playlist.url;
        spotifyBtn.target = '_blank';
        spotifyBtn.rel = 'noopener noreferrer';
        spotifyBtn.className = 'w-full bg-emerald-600 hover:bg-emerald-500 text-white p-3 rounded-xl flex items-center justify-between text-xs font-bold active:scale-95 transition-all shadow-md mb-4';
        spotifyBtn.innerHTML = `
          <span class="flex items-center gap-2">🎧 ${escapeHtml(playlist.nombre || `Playlist de ${pais.pais}`)}</span>
          <span>Abrir Spotify ➔</span>
        `;
        container.appendChild(spotifyBtn);
      });

      const ciudades = Array.isArray(pais.ciudades) ? pais.ciudades : [];
      if (!ciudades.length) {
        renderEmptyState('No hay ciudades cargadas para este país.');
        return;
      }

      const ciudadesSection = document.createElement('div');
      ciudadesSection.className = 'space-y-3';

      ciudades.forEach((c, index) => {
        const btn = document.createElement('button');
        btn.className = 'w-full bg-slate-800 border border-slate-700 p-4 rounded-xl text-left hover:bg-slate-700 transition-all flex justify-between items-center active:scale-98 shadow-sm';
        btn.onclick = () => showDetalleCiudadView(pais, index, canonicalPaisId);
        btn.innerHTML = `
          <div>
            <h3 class="font-bold text-base text-white">${escapeHtml(c.nombre || 'Ciudad sin nombre')}</h3>
            <p class="text-xs text-blue-400 font-medium mt-0.5">${escapeHtml(c.fechas || '')}</p>
          </div>
          <span class="text-slate-400 text-lg">➔</span>
        `;
        ciudadesSection.appendChild(btn);
      });
      container.appendChild(ciudadesSection);

      const additionalData = (pais.datosAdicionales || []).filter(item => /^https:\/\//i.test(item.url || ''));
      if (additionalData.length) {
        const divider = document.createElement('hr');
        divider.className = 'border-slate-800 my-4';
        container.appendChild(divider);

        const additionalBlock = document.createElement('div');
        additionalBlock.className = 'grid grid-cols-1 gap-2';
        additionalBlock.innerHTML = additionalData.map(item => `
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="bg-slate-800/80 border border-slate-700/60 p-3 rounded-xl flex items-center justify-between gap-3 text-xs text-slate-200">
            <span class="min-w-0 break-words">${escapeHtml(item.label || item.category || 'Dato adicional')}</span>
            <span class="shrink-0 text-blue-400 font-medium">Abrir ➔</span>
          </a>
        `).join('');
        container.appendChild(additionalBlock);
      }
    })
    .catch(err => {
      setTopLoading(false);
      if (requestId !== viewSequence) return;
      handleFetchError('No se pudo cargar el itinerario del país desde Firebase.', canonicalPaisId);
    });
}

// Nivel 3: Vista de Detalle de Ciudad
function showDetalleCiudadView(pais, ciudadIndex, paisIdOverride, recordHistory = true) {
  if (!pais || !Array.isArray(pais.ciudades) || !pais.ciudades[ciudadIndex]) {
    renderEmptyState('La ciudad seleccionada no existe.');
    return;
  }

  const ciudad = pais.ciudades[ciudadIndex];
  const statePaisId = normalizeCountryId(paisIdOverride || pais.id || currentViewState.paisId);
  ticketImportContext = { country: pais, cityIndex: ciudadIndex };
  viewSequence += 1;
  disposeHomeGlobe();
  setCurrentViewState({ level: 'detalle', paisId: statePaisId, ciudadIndex }, recordHistory);
  updateHeader(ciudad.nombre || 'Detalle', true);

  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'p-4 max-w-md mx-auto space-y-4';

  const actividades = normalizeActivities(ciudad.actividades);
  const gastronomia = normalizeActivities(ciudad.gastronomia);

  // Transportes de la ciudad (vuelos, trenes, buses, ferrys) con fecha y horarios.
  const transportes = Array.isArray(ciudad.transportes) ? ciudad.transportes : [];
  const transportIcon = { vuelo: '✈️', tren: '🚆', bus: '🚌', ferry: '⛴️' };
  const transportesHtml = transportes.length ? `
    <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-700/50 space-y-1.5">
      <h4 class="text-xs font-bold text-slate-300">🧭 Transportes</h4>
      ${transportes.map(item => `
        <div class="flex items-start justify-between gap-2 text-xs">
          <span class="min-w-0 text-slate-300">${transportIcon[item.tipo] || '🎫'} ${escapeHtml(item.descripcion)}</span>
          <span class="shrink-0 text-right text-emerald-300">${escapeHtml(item.fecha || '')}${item.salida ? ` · ${escapeHtml(item.salida)}` : ''}${item.llegada ? ` → ${escapeHtml(item.llegada)}` : ''}</span>
        </div>`).join('')}
    </div>` : '';
  const transportePublicoHtml = ciudad.transportePublico ? `
    <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-700/50 space-y-1">
      <h4 class="text-xs font-bold text-slate-300">🎫 Transporte público</h4>
      <p class="text-xs text-slate-400 leading-relaxed">${escapeHtml(ciudad.transportePublico)}</p>
    </div>` : '';
  const guardaequipajeHtml = ciudad.guardaequipaje ? `
    <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-700/50 space-y-1">
      <h4 class="text-xs font-bold text-slate-300">🧳 Dónde dejar la valija</h4>
      <p class="text-xs text-slate-400 leading-relaxed">${escapeHtml(ciudad.guardaequipaje)}</p>
    </div>` : '';

  container.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4 space-y-4 shadow-md text-slate-100">
      <div>
        <span class="text-xs font-semibold text-blue-400 bg-blue-950/60 border border-blue-800/50 px-2.5 py-1 rounded-full">${escapeHtml(ciudad.fechas || '')}</span>
        <h2 class="text-lg font-bold mt-2 text-white">🏨 ${escapeHtml(ciudad.hotel || 'Hotel sin nombre')}</h2>

        <div class="flex gap-2 mt-2">
          ${ciudad.mapaHotelLink ? `
            <a href="${escapeHtml(ciudad.mapaHotelLink)}" target="_blank" rel="noopener noreferrer" class="bg-slate-700 hover:bg-slate-600 text-white text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-all">
              📍 Ubicación
            </a>` : ''}
        </div>
        <div id="city-ticket-slot"></div>
      </div>

      <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-700/50 space-y-1">
        <h4 class="text-xs font-bold text-slate-300">🚌 ¿Cómo llego al hotel?</h4>
        <p class="text-xs text-slate-400 leading-relaxed">${escapeHtml(ciudad.comoLlegar || 'No hay información de llegada disponible.')}</p>
      </div>

      ${transportesHtml}
      ${transportePublicoHtml}
      ${guardaequipajeHtml}

      <div class="space-y-2">
        <h4 class="text-xs font-bold text-slate-300">🚶 Actividades</h4>
        <div class="space-y-1.5">
          ${renderGroupedActivities(actividades, 'No hay actividades disponibles.')}
        </div>
      </div>

      <div class="space-y-2">
        <h4 class="text-xs font-bold text-slate-300">🍽️ Gastronomía</h4>
        <div class="space-y-1.5">
          ${renderGroupedActivities(gastronomia, 'No hay gastronomía disponible.')}
        </div>
      </div>
    </div>
  `;
  appendTicketFiles(
    container.querySelector('#city-ticket-slot'),
    filesForCity(downloadedTicketFiles, pais, ciudad),
    'Tickets y vouchers'
  );
}

function handleBack() {
  if (currentViewState.level === 'paises') return;
  if (window.history.state?.travelAppView) {
    window.history.back();
  } else if (currentViewState.level === 'detalle') {
    showCiudadesView(currentViewState.paisId, false);
  } else {
    showPaisesView(false);
  }
}

async function restoreAppView(view) {
  if (!view || view.level === 'paises') {
    showPaisesView(false);
    return;
  }
  if (view.level === 'ciudades') {
    showCiudadesView(view.paisId, false);
    return;
  }
  if (view.level === 'detalle') {
    const requestId = ++viewSequence;
    setTopLoading(true);
    try {
      const country = await window.TravelFirestore.loadCountry(view.paisId);
      if (requestId !== viewSequence) return;
      if (!country) {
        showCiudadesView(view.paisId, false);
        return;
      }
      showDetalleCiudadView(country, view.ciudadIndex, view.paisId, false);
    } catch (error) {
      if (requestId === viewSequence) {
        console.error('No se pudo restaurar el detalle anterior:', error);
        showCiudadesView(view.paisId, false);
      }
    } finally {
      setTopLoading(false);
    }
    return;
  }
  if (view.level === 'vault') {
    showVaultListView(view.vaultPage, false);
    return;
  }
  if (view.level === 'admin') {
    showAccessAdminView(false);
    return;
  }
  showPaisesView(false);
}

async function showAccessAdminView(recordHistory = true) {
  if (activeMember?.role !== 'admin') return showPaisesView(recordHistory);

  disposeHomeGlobe();
  setCurrentViewState({ level: 'admin', paisId: null }, recordHistory);
  updateHeader('Administrar accesos', true);
  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'p-4 max-w-2xl mx-auto space-y-4';
  container.innerHTML = '<p class="py-8 text-center text-sm text-slate-300">Cargando usuarios…</p>';

  try {
    const [requests, members] = await Promise.all([
      window.TravelFirestore.listAccessRequests(),
      window.TravelFirestore.listMembers()
    ]);
    const pending = requests.filter(request => request.status === 'pending');
    container.innerHTML = `
      <section class="space-y-3">
        <h2 class="text-base font-semibold text-white">Solicitudes pendientes</h2>
        ${pending.length ? `<ul class="divide-y divide-slate-700 rounded-lg border border-slate-700 bg-slate-800/60">${pending.map(request => `
          <li class="flex items-center justify-between gap-3 p-3">
            <div class="min-w-0"><p class="truncate text-sm text-white">${escapeHtml(request.email || request.displayName || request.uid)}</p><p class="truncate text-[11px] text-slate-400">${escapeHtml(request.uid)}</p></div>
            <button type="button" data-approve-uid="${escapeHtml(request.uid)}" class="shrink-0 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500">Habilitar</button>
          </li>`).join('')}</ul>` : '<p class="rounded-lg border border-slate-700 p-3 text-sm text-slate-400">No hay solicitudes nuevas.</p>'}
      </section>
      <section class="space-y-3">
        <h2 class="text-base font-semibold text-white">Miembros</h2>
        ${members.length ? `<ul class="divide-y divide-slate-700 rounded-lg border border-slate-700 bg-slate-800/60">${members.map(member => `
          <li class="flex items-center justify-between gap-3 p-3">
            <div class="min-w-0"><p class="truncate text-sm text-white">${escapeHtml(member.email || member.displayName || member.uid)}</p><p class="text-[11px] text-slate-400">${escapeHtml(member.role || 'member')}</p></div>
            <button type="button" data-toggle-member="${escapeHtml(member.uid)}" ${member.uid === signedInUser?.uid ? 'disabled title="No podés deshabilitar tu propia cuenta"' : ''} class="shrink-0 rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">${member.enabled ? 'Deshabilitar' : 'Habilitar'}</button>
          </li>`).join('')}</ul>` : '<p class="rounded-lg border border-slate-700 p-3 text-sm text-slate-400">Todavía no hay miembros.</p>'}
      </section>
      <p id="access-admin-status" class="text-sm text-red-300" role="status"></p>
    `;

    container.querySelectorAll('[data-approve-uid]').forEach(button => {
      button.addEventListener('click', async () => {
        const request = pending.find(item => item.uid === button.dataset.approveUid);
        if (!request) return;
        button.disabled = true;
        try {
          await window.TravelFirestore.approveAccessRequest(request);
          showAccessAdminView();
        } catch (error) {
          container.querySelector('#access-admin-status').textContent = error.message || 'No se pudo habilitar la cuenta.';
          button.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-toggle-member]').forEach(button => {
      button.addEventListener('click', async () => {
        const member = members.find(item => item.uid === button.dataset.toggleMember);
        if (!member || member.uid === signedInUser?.uid) return;
        button.disabled = true;
        try {
          await window.TravelFirestore.setMemberAccess({ ...member, enabled: !member.enabled });
          showAccessAdminView();
        } catch (error) {
          container.querySelector('#access-admin-status').textContent = error.message || 'No se pudo actualizar la cuenta.';
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    renderEmptyState(error.message || 'No se pudieron cargar los accesos.');
  }
}

function setVaultMenuOpen(open) {
  const menu = document.getElementById('vaultMenu');
  const button = document.getElementById('btnVaultMenu');
  if (!menu || !button) return;
  menu.classList.toggle('hidden', !open);
  menu.setAttribute('aria-hidden', String(!open));
  button.setAttribute('aria-expanded', String(open));
}

function updateVaultNavigation() {
  const enabled = Boolean(activeMember?.enabled);
  const canManageFiles = canManageTicketFiles(activeMember);
  document.getElementById('btnVaultMenu')?.classList.toggle('hidden', !enabled);
  document.querySelector('[data-sign-out]')?.classList.toggle('hidden', !signedInUser);
  document.querySelector('[data-refresh-data]')?.classList.toggle('hidden', !enabled);
  document.querySelector('[data-admin-access]')?.classList.toggle('hidden', !enabled || activeMember?.role !== 'admin');
  document.querySelector('[data-download-ticket-files]')?.classList.toggle(
    'hidden',
    !canManageFiles
  );
}

function createHomeSwitch() {
  const switcher = document.createElement('div');
  switcher.className = 'inline-flex items-center gap-1 rounded-full border border-white/15 bg-[#142d33]/90 p-1 shadow-lg backdrop-blur';
  switcher.setAttribute('aria-label', 'Vista de destinos');
  switcher.innerHTML = `
    <button type="button" data-home-mode="globe" class="rounded-full px-4 py-2 text-xs font-semibold transition-colors">🌐 Globo</button>
    <button type="button" data-home-mode="list" class="rounded-full px-4 py-2 text-xs font-semibold transition-colors">☷ Lista</button>
  `;
  switcher.querySelectorAll('button').forEach(button => {
    const active = button.dataset.homeMode === homeMode;
    button.classList.add(...(active ? ['bg-[#e7a66e]', 'text-[#18252a]'] : ['text-slate-200', 'hover:bg-white/10']));
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => {
      homeMode = button.dataset.homeMode;
      renderHomeView();
    });
  });
  return switcher;
}

function renderHomeView() {
  const container = document.getElementById('app');
  if (!container) return;
  disposeHomeGlobe();

  if (homeMode === 'list') {
    container.className = 'p-4 max-w-md mx-auto space-y-4';
    container.innerHTML = syncWarningMarkup();
    container.appendChild(createHomeSwitch());
    homeCountries.forEach(country => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'relative block h-32 w-full overflow-hidden rounded-xl border border-slate-700 text-left shadow-lg transition-transform active:scale-[.98]';
      card.onclick = () => showCiudadesView(country.id);
      card.innerHTML = `
        <img src="${escapeHtml(country.bgImage || '')}" class="absolute inset-0 h-full w-full object-cover brightness-50" alt="">
        <span class="absolute inset-0 flex items-end bg-gradient-to-t from-slate-950/80 to-transparent p-4">
          <span class="text-xl font-bold text-white">${escapeHtml(country.flag || '')} ${escapeHtml(country.pais || 'Sin nombre')}</span>
        </span>
      `;
      container.appendChild(card);
    });
    return;
  }

  container.className = 'relative isolate h-[calc(100svh-64px)] min-h-[520px] w-full overflow-hidden bg-[#09191e]';
  container.innerHTML = `
    <div id="globe-scene" class="absolute inset-0"></div>
    <div class="pointer-events-none absolute left-5 top-5 z-10 max-w-[55%]">
      <p class="text-[10px] font-bold uppercase tracking-[.18em] text-[#9dbfba]">Ruta del viaje</p>
      <h2 class="mt-1 text-lg font-semibold text-white md:text-xl">Europa <span class="text-[#e7a66e]">2026</span></h2>
      <p class="mt-1 text-[9px] text-slate-400">NASA Blue Marble</p>
    </div>
    <p class="pointer-events-none absolute left-5 top-[68px] z-10 text-[9px] text-slate-200">
      <span class="text-sky-400">●</span> Con itinerario
      <span class="ml-2 text-emerald-400">●</span> Solo parada
    </p>
    <div id="home-switch-slot" class="absolute right-4 top-4 z-20"></div>
    <details class="absolute left-3 top-[100px] z-20 max-h-[60svh] w-[min(15rem,68vw)] overflow-hidden rounded-xl border border-white/15 bg-[#10252be8] text-white shadow-xl backdrop-blur-md" aria-label="Orden del recorrido">
      <summary id="route-sequence-title" class="cursor-pointer list-none px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#f3b77f]">Recorrido · cargando</summary>
      <ol id="route-sequence-list" class="max-h-[52svh] space-y-1 overflow-y-auto border-t border-white/10 p-2 text-[10px]">
        <li class="px-2 py-2 text-slate-300">Cargando las paradas…</li>
      </ol>
    </details>
    ${syncWarningMarkup('absolute left-4 top-24 z-20 max-w-md')}
    <section id="destination-toast" class="absolute bottom-5 left-4 right-4 z-20 mx-auto max-w-md rounded-xl border border-white/15 bg-[#12272dcc] p-4 text-white shadow-2xl backdrop-blur-md" aria-live="polite">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p id="destination-country" class="text-[10px] font-bold uppercase tracking-[.16em] text-[#e7a66e]">Tu recorrido</p>
          <h3 id="destination-title" class="mt-1 text-lg font-semibold">Tocá un destino</h3>
          <p id="destination-date" class="mt-1 text-xs text-slate-300">Girá el globo y elegí una parada.</p>
        </div>
        <button id="destination-open" type="button" class="hidden shrink-0 rounded-lg bg-[#e7a66e] px-3 py-2 text-xs font-bold text-[#172328] transition-colors hover:bg-[#f2bd8f]">Ver itinerario <span aria-hidden="true">→</span></button>
      </div>
    </section>
    <p class="pointer-events-none absolute bottom-[126px] left-0 right-0 z-10 text-center text-[10px] text-slate-300/75">Arrastr&aacute; para girar · pellizc&aacute; para acercar</p>
  `;
  const homeControls = container.querySelector('#home-switch-slot');
  homeControls.classList.add('flex', 'flex-col', 'items-end', 'gap-2');
  homeControls.appendChild(createHomeSwitch());

  function showDestination(location) {
    focusedGlobeLocation = location;
    const toast = container.querySelector('#destination-toast');
    const openButton = container.querySelector('#destination-open');
    container.querySelectorAll('[data-route-stop]').forEach(button => {
      const active = button.dataset.routeStop === location.id;
      button.classList.toggle('bg-[#e7a66e]/20', active);
      button.classList.toggle('border-[#e7a66e]/50', active);
      button.setAttribute('aria-current', active ? 'step' : 'false');
    });
    container.querySelector('#destination-country').textContent = location.hasItinerary
      ? `${location.flag || ''} ${location.countryName || ''}`.trim()
      : '';
    container.querySelector('#destination-title').textContent = location.name;
    const stage = location.stage ? ` · ${location.stage}` : '';
    container.querySelector('#destination-date').textContent = location.hasItinerary
      ? `Etapa ${location.routeIndex + 1} de ${location.routeLength}${stage}`
      : '';
    if (location.hasItinerary && location.countryId) {
      openButton.classList.remove('hidden');
      openButton.onclick = async () => {
        try {
          const country = await window.TravelFirestore.loadCountry(location.countryId);
          if (!country) {
            renderEmptyState('El itinerario de este destino todavía no está disponible.');
            return;
          }
          const cities = Array.isArray(country.ciudades) ? country.ciudades : [];
          const hasSelectedCity = location.hasItinerary
            && Number.isInteger(location.cityIndex)
            && cities[location.cityIndex];
          const cityIndex = hasSelectedCity ? location.cityIndex : cities.length === 1 ? 0 : null;

          if (cityIndex !== null && cities[cityIndex]) {
            showDetalleCiudadView(country, cityIndex, location.countryId);
          } else {
            showCiudadesView(location.countryId);
          }
        } catch {
          handleFetchError('No se pudo cargar el itinerario de este destino.', `frontend/data/${location.countryId}.json`);
        }
      };
    } else {
      openButton.classList.add('hidden');
    }
    toast.classList.remove('animate-[toast-in_.25s_ease-out]');
    requestAnimationFrame(() => toast.classList.add('animate-[toast-in_.25s_ease-out]'));
  }

  Promise.all([import('./globe.js'), window.TravelFirestore.loadRouteStops()])
    .then(([{ mountTravelGlobe }, route]) => {
      if (!container.isConnected || homeMode !== 'globe') return;
      const canvasContainer = container.querySelector('#globe-scene');
      if (!canvasContainer) return;
      const metadataById = new Map(routeCatalog.stops.map(stop => [stop.id, stop]));
      const locations = (Array.isArray(route) ? route : []).map((stop, index, stops) => {
        const sourceStop = metadataById.get(stop.id);
        return {
          ...stop,
          hasItinerary: sourceStop
            ? sourceStop.hasItinerary === true
            : stop.hasItinerary === true,
          lat: stop.latitude,
          lon: stop.longitude,
          routeIndex: index,
          routeLength: stops.length
        };
      });
      const routeList = container.querySelector('#route-sequence-list');
      const routeTitle = container.querySelector('#route-sequence-title');
      if (routeTitle) routeTitle.textContent = `Recorrido · ${locations.length} paradas`;
      if (routeList) {
        routeList.replaceChildren();
        locations.forEach(location => {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.routeStop = location.id;
          button.className = 'flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:bg-white/10';
          button.setAttribute('aria-label', `Parada ${location.routeIndex + 1}: ${location.name}, ${location.countryName}${location.stage ? `, ${location.stage}` : ''}`);
          const markerColor = location.hasItinerary
            ? 'border-sky-400/70 bg-sky-500/20 text-sky-100'
            : 'border-emerald-400/70 bg-emerald-500/20 text-emerald-100';
          button.innerHTML = `
            <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[9px] font-bold ${markerColor}">${location.routeIndex + 1}</span>
            <span class="min-w-0">
              <span class="block truncate font-semibold">${escapeHtml(location.flag || '')} ${escapeHtml(location.name || 'Parada')}</span>
              <span class="block truncate text-[9px] text-slate-400">${escapeHtml(location.stage || location.countryName || '')}</span>
            </span>`;
          button.addEventListener('click', () => showDestination(location));
          item.appendChild(button);
          routeList.appendChild(item);
        });
      }
      disposeGlobe = mountTravelGlobe(
        canvasContainer,
        locations,
        routeCatalog.animatedTrips,
        routeCatalog.celebrationDates,
        location => {
          if (location) showDestination(location);
          else if (!focusedGlobeLocation) {
            container.querySelector('#destination-country').textContent = 'Tu recorrido';
            container.querySelector('#destination-title').textContent = 'Tocá un destino';
            container.querySelector('#destination-date').textContent = 'Girá el globo y elegí una parada.';
            container.querySelector('#destination-open').classList.add('hidden');
          }
        },
        showDestination
      );
    })
    .catch(error => {
      console.error('No se pudo cargar el globo:', error);
      const title = container.querySelector('#destination-title');
      const detail = container.querySelector('#destination-date');
      if (title) title.textContent = 'Globo no disponible';
      if (detail) detail.textContent = 'Podés cambiar a Lista para ver tus destinos.';
    });
}

function updateHeader(title, showBackBtn) {
  const headerTitle = document.getElementById('headerTitle');
  const btn = document.getElementById('btnBack');
  if (headerTitle) headerTitle.innerText = title;
  if (btn) {
    if (showBackBtn) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
  }
}

function showVaultListView(page, recordHistory = true) {
  const validPages = ['Valija', 'Compras', 'Gastos'];
  const vaultPage = validPages.includes(page) ? page : 'Valija';
  const icons = { Valija: '🧳', Compras: '🛒', Gastos: '💶' };
  setCurrentViewState({ level: 'vault', paisId: null, vaultPage }, recordHistory);
  updateHeader(`${icons[vaultPage]} ${vaultPage}`, true);
  const container = document.getElementById('app');
  if (!container) return;
  disposeHomeGlobe();
  container.className = 'p-4 max-w-2xl mx-auto space-y-4';
  window.TravelVault.render(container, vaultPage, updateVaultNavigation);
}