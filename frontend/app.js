import {
  canManageTicketFiles,
  chooseLocalFolder,
  filesForCity,
  getTicketFiles,
  saveLocalFolderFiles,
  ticketButtonLabel
} from './ticket-files.mjs';
import { activityDateLabel } from './itinerary-dates.mjs';
import {
  activityDateKey,
  activityMarkerKey,
  completeImportantActivityReminder,
  getActivityMarkers,
  getDueImportantActivities,
  toggleActivityMarker
} from './activity-markers.mjs';
import {
  fetchCurrentConditions,
  formatLocalTime,
  getCachedCurrentConditions,
  localDateKey,
  selectCityLocation,
  selectCountryDestination,
  weatherPresentation
} from './destination-conditions.mjs';
import routeCatalog from './route-catalog.mjs';

let currentViewState = { level: 'paises', paisId: null };
let homeMode = 'list';
let homeCountries = [];
let mapController = null;
let signedInUser = null;
let activeMember = null;
let downloadedTicketFiles = [];
let ticketImportContext = null;
let ticketImportDismissTimer = null;
let itinerarySyncPromise = null;
let itinerarySyncError = '';
let authCallbackSequence = 0;
let viewSequence = 0;
let homeConditionRequestSequence = 0;
let homeConditionClockTimer = null;
let cityConditionsTimer = null;
let homeConditionTimeZones = new Map();
let homeConditionsDate = '';

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

  navigator.serviceWorker.register('sw.js?v=1.0.34', { updateViaCache: 'none' })
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

function disposeHomeMap() {
  mapController?.dispose();
  mapController = null;
  document.body.classList.remove('map-mode');
  if (screen.orientation?.unlock) {
    try {
      screen.orientation.unlock();
    } catch (error) {
      console.warn('No se pudo restaurar la orientación de la pantalla:', error);
    }
  }
}

async function enterMapMode() {
  setVaultMenuOpen(false);
  if (screen.orientation?.lock) {
    try {
      await screen.orientation.lock('landscape');
    } catch (error) {
      console.warn('El dispositivo no permite bloquear la pantalla en horizontal:', error);
    }
  }
}

function ensureItineraryDataSynced() {
  if (!itinerarySyncPromise) {
    itinerarySyncPromise = import('./itinerary-source.mjs')
      .then(({ itinerarySource }) => window.TravelFirestore.ensureInitialSeed(itinerarySource))
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
  disposeHomeMap();
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
  disposeHomeMap();
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
  disposeHomeMap();
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
      return { id: '', nombre: item, mapa: '', nota: '' };
    }
    return {
      id: item?.id || '',
      category: item?.category || 'actividad',
      dia: Number.isFinite(Number(item?.dia)) ? Number(item.dia) : null,
      nombre: item?.nombre || '',
      mapa: item?.mapa || '',
      nota: item?.nota || '',
      website: item?.website || '',
      order: item?.order ?? 0
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

function activityMarkerMarkup(item, markerContext) {
  if (!markerContext?.userId || !markerContext.countryId || !markerContext.cityId) return '';
  let key;
  let markers;
  try {
    key = activityMarkerKey({
      ...markerContext,
      activityId: item.id,
      name: item.nombre,
      day: item.dia,
      order: item.order
    });
    markers = getActivityMarkers(key);
  } catch (error) {
    console.error('No se pudieron cargar las marcas de esta actividad:', error);
    return '';
  }
  const date = activityDateKey(markerContext.cityDates, item.dia) || '';
  const dataAttributes = `
    data-activity-marker-key="${escapeHtml(key)}"
    data-reminder-title="${escapeHtml(item.nombre)}"
    data-reminder-country="${escapeHtml(markerContext.countryName)}"
    data-reminder-city="${escapeHtml(markerContext.cityName)}"
    data-reminder-date="${escapeHtml(date)}"`;
  return `
    <span class="flex shrink-0 items-center gap-1">
      <button type="button" data-activity-marker="favorite"${dataAttributes}
        aria-label="${markers.favorite ? 'Quitar de favoritos' : 'Marcar como favorita'}"
        aria-pressed="${markers.favorite}"
        title="${markers.favorite ? 'Quitar de favoritos' : 'Marcar como favorita'}"
        class="grid h-8 w-8 place-items-center rounded-md border ${markers.favorite ? 'border-amber-500/60 bg-amber-950/50 text-amber-300' : 'border-slate-700 bg-slate-800 text-slate-400'} hover:bg-slate-700">${markers.favorite ? '★' : '☆'}</button>
      <button type="button" data-activity-marker="important"${dataAttributes}
        aria-label="${markers.important ? 'Quitar marca de importante' : 'Marcar como importante'}"
        aria-pressed="${markers.important}"
        title="${markers.important ? 'Quitar marca de importante' : 'Marcar como importante'}"
        class="grid h-8 w-8 place-items-center rounded-md border ${markers.important ? 'border-rose-500/60 bg-rose-950/50 text-rose-300' : 'border-slate-700 bg-slate-800 text-slate-400'} hover:bg-slate-700">!</button>
    </span>`;
}

function renderGroupedActivities(activities, emptyMessage, cityDates = '', showDateHeaders = true, editContext = null, editMode = false, markerContext = null) {
  const isAdmin = activeMember?.role === 'admin' && Boolean(editContext) && editMode;
  if (!activities.length) {
    return `<div class="text-xs text-slate-400">${emptyMessage}</div>`;
  }

  return groupActivitiesByDay(activities).map(([day, items]) => `
    <div class="space-y-1.5">
      ${showDateHeaders ? `<h5 class="text-[11px] font-bold uppercase tracking-wide text-blue-400 pt-2">${day === 'general' ? 'Fechas flexibles' : escapeHtml(activityDateLabel(cityDates, day))}</h5>` : ''}
      ${items.map(item => `
        <div data-activity-id="${escapeHtml(item.id || '')}" class="bg-slate-900/40 p-3 rounded-xl border border-slate-700/30 flex justify-between items-start gap-3 text-sm leading-relaxed transition-colors duration-300">
          <div class="flex-1 min-w-0">
            <span class="text-slate-300 block">${escapeHtml(item.nombre)}</span>
            ${item.nota ? `<p class="mt-1 text-xs text-slate-400">${escapeHtml(item.nota)}</p>` : ''}
            <div class="mt-2 flex items-center justify-between gap-2">
              ${activityMarkerMarkup(item, markerContext)}
              <span class="flex shrink-0 items-center gap-1.5">${/^https?:\/\//i.test(item.website) ? `
                <a href="${escapeHtml(item.website)}" target="_blank" rel="noopener noreferrer" class="whitespace-nowrap text-emerald-300 font-medium hover:underline text-xs bg-slate-800 px-2.5 py-1.5 rounded-md border border-slate-700">
                  🌐 Web
                </a>` : ''}${/^https?:\/\//i.test(item.mapa) ? `
                <a href="${escapeHtml(item.mapa)}" target="_blank" rel="noopener noreferrer" class="shrink-0 whitespace-nowrap text-blue-400 font-medium hover:underline text-xs flex items-center gap-1 bg-slate-800 px-2.5 py-1.5 rounded-md border border-slate-700">
                  📍 Maps
                </a>` : ''}${isAdmin && item.id ? `
                <button type="button" data-edit-activity="${escapeHtml(item.id)}" data-city-id="${escapeHtml(editContext.cityId)}" class="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-700" aria-label="Editar actividad">✏️</button>
                <button type="button" data-delete-activity="${escapeHtml(item.id)}" data-city-id="${escapeHtml(editContext.cityId)}" class="rounded-md border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-xs text-red-200 hover:bg-red-900/50" aria-label="Eliminar actividad">🗑️</button>` : ''}</span>
            </div>
          </div>
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
  disposeHomeMap();
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
    .catch(error => {
      setTopLoading(false);
      if (requestId !== viewSequence) return;
      console.error('No se pudo cargar la lista de países:', error);
      handleFetchError('No se pudo cargar la lista de países desde Firebase.', 'countries');
    });
}

// Nivel 2: Cargar dinámicamente el JSON del país seleccionado
function showCiudadesView(paisId, recordHistory = true) {
  const requestId = ++viewSequence;
  disposeHomeMap();
  ticketImportContext = null;
  const canonicalPaisId = normalizeCountryId(paisId);
  setCurrentViewState({ level: 'ciudades', paisId: canonicalPaisId }, recordHistory);

  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'p-4 max-w-md mx-auto space-y-4';
  container.innerHTML = '<p class="text-center text-slate-400 text-sm py-8">Cargando itinerario...</p>';
  setTopLoading(true);

  Promise.all([
    window.TravelFirestore.loadCountry(canonicalPaisId),
    window.TravelFirestore.loadRouteStops().catch(error => {
      console.warn('No se pudieron cargar las paradas para las opciones de ciudad:', error);
      return [];
    })
  ])
    .then(([pais, routeStops]) => {
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
      const isAdminUser = activeMember?.role === 'admin';
      if (isAdminUser) {
        const editPlaylistsButton = document.createElement('button');
        editPlaylistsButton.type = 'button';
        editPlaylistsButton.className = 'w-full rounded-xl border border-dashed border-emerald-500/60 bg-emerald-950/30 p-3 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/40';
        editPlaylistsButton.textContent = '+';
        editPlaylistsButton.setAttribute('aria-label', 'Agregar o editar banners de Spotify');
        editPlaylistsButton.addEventListener('click', () => openSpotifyPlaylistsEditor(pais, canonicalPaisId));
        container.appendChild(editPlaylistsButton);
      }
      if (playlists.length || isAdminUser) {
        const spotifyDivider = document.createElement('hr');
        spotifyDivider.className = 'border-slate-700';
        container.appendChild(spotifyDivider);
      }

      const ciudades = Array.isArray(pais.ciudades) ? pais.ciudades : [];
      if (!ciudades.length) {
        renderEmptyState('No hay ciudades cargadas para este país.');
        return;
      }

      const ciudadesSection = document.createElement('div');
      ciudadesSection.className = 'space-y-3';

      ciudades.forEach((c, index) => {
        const cityCard = document.createElement('div');
        cityCard.className = 'relative';
        const cityButton = document.createElement('button');
        cityButton.type = 'button';
        cityButton.className = `w-full bg-slate-800 border border-slate-700 p-4 ${activeMember?.role === 'admin' && c.id ? 'pr-14' : ''} rounded-xl text-left hover:bg-slate-700 transition-all flex justify-between items-center gap-3 active:scale-98 shadow-sm`;
        cityButton.addEventListener('click', () => showDetalleCiudadView(pais, index, canonicalPaisId));
        cityButton.innerHTML = `
          <div class="min-w-0">
            <h3 class="font-bold text-base text-white">${escapeHtml(c.nombre || 'Ciudad sin nombre')}</h3>
            <p class="text-xs text-blue-400 font-medium mt-0.5">${escapeHtml(c.fechas || '')}</p>
          </div>
          <span data-city-conditions="${index}" class="flex shrink-0 flex-col items-end gap-0.5 text-xs font-semibold text-slate-200">
            <span data-city-clock class="tabular-nums">--:--</span>
            <span data-city-weather>— °C</span>
          </span>
        `;
        cityCard.appendChild(cityButton);

        if (activeMember?.role === 'admin' && c.id) {
          const menuWrapper = document.createElement('div');
          menuWrapper.className = 'absolute right-1 top-1/2 z-10 -translate-y-1/2';
          menuWrapper.innerHTML = `
            <button type="button" aria-label="Opciones de ${escapeHtml(c.nombre || 'ciudad')}" aria-expanded="false" class="city-options-toggle h-10 w-8 rounded-lg text-2xl font-bold leading-none text-slate-200 hover:bg-slate-600">⋮</button>
            <div class="city-options-menu absolute right-0 top-full hidden min-w-40 overflow-hidden rounded-lg border border-slate-600 bg-slate-900 py-1 shadow-xl">
              <button type="button" data-edit-city class="block w-full px-3 py-2 text-left text-xs text-slate-100 hover:bg-slate-800">✏️ Editar datos</button>
              <button type="button" data-delete-city class="block w-full px-3 py-2 text-left text-xs text-red-200 hover:bg-red-950/60">🗑️ Eliminar ciudad</button>
            </div>
          `;
          const menuToggle = menuWrapper.querySelector('.city-options-toggle');
          const menu = menuWrapper.querySelector('.city-options-menu');
          menuToggle.addEventListener('click', event => {
            event.stopPropagation();
            const isOpen = !menu.classList.contains('hidden');
            menu.classList.toggle('hidden', isOpen);
            menuToggle.setAttribute('aria-expanded', String(!isOpen));
          });
          menuWrapper.querySelector('[data-edit-city]').addEventListener('click', () => {
            menu.classList.add('hidden');
            menuToggle.setAttribute('aria-expanded', 'false');
            const mapLocation = routeStops.find(stop =>
              stop.countryId === canonicalPaisId && Number(stop.cityIndex) === index);
            openCityEditorModal(pais, canonicalPaisId, index, c, mapLocation || null);
          });
          menuWrapper.querySelector('[data-delete-city]').addEventListener('click', async event => {
            menu.classList.add('hidden');
            menuToggle.setAttribute('aria-expanded', 'false');
            if (!window.confirm(
              `¿Eliminar ${c.nombre || 'esta ciudad'}? También se eliminarán sus actividades y sus paradas vinculadas del mapamundi.`
            )) return;
            const button = event.currentTarget;
            button.disabled = true;
            try {
              await window.TravelFirestore.deleteCityAndRouteStops({
                countryId: canonicalPaisId,
                cityId: c.id,
                cityIndex: index
              });
              showCiudadesView(canonicalPaisId, false);
            } catch (error) {
              button.disabled = false;
              window.alert(error.message || 'No se pudo eliminar la ciudad.');
            }
          });
          cityCard.appendChild(menuWrapper);
        }

        ciudadesSection.appendChild(cityCard);
      });
      if (activeMember?.role === 'admin') {
        const addCityBtn = document.createElement('button');
        addCityBtn.type = 'button';
        addCityBtn.className = 'w-full rounded-xl border border-dashed border-emerald-500/60 bg-emerald-950/30 p-3 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/40';
        addCityBtn.textContent = '+ Agregar ciudad (y ubicar en el mapa)';
        addCityBtn.addEventListener('click', () => openCityCreatorModal(pais, canonicalPaisId));
        ciudadesSection.appendChild(addCityBtn);
      }
      container.appendChild(ciudadesSection);

      const countrySections = document.createElement('section');
      countrySections.className = 'grid grid-cols-2 gap-2';
      countrySections.innerHTML = `
        <button type="button" data-country-section="actividades" class="rounded-xl border border-blue-800/60 bg-blue-950/40 p-3 text-left text-sm font-semibold text-blue-100 hover:bg-blue-900/50">🚶 Actividades</button>
        <button type="button" data-country-section="gastronomia" class="rounded-xl border border-amber-800/60 bg-amber-950/30 p-3 text-left text-sm font-semibold text-amber-100 hover:bg-amber-900/40">🍽️ Gastronomía</button>
        <button type="button" data-country-section="supermercados" class="col-span-2 rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-3 text-left text-sm font-semibold text-emerald-100 hover:bg-emerald-900/40">🛒 Supermercados</button>
      `;
      countrySections.querySelectorAll('[data-country-section]').forEach(button => {
        button.addEventListener('click', () => showCountrySectionView(pais, canonicalPaisId, button.dataset.countrySection));
      });
      container.appendChild(countrySections);

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
        loadCityConditions(container, pais, routeStops, () =>
          requestId === viewSequence && currentViewState.level === 'ciudades');
    })
    .catch(error => {
      setTopLoading(false);
      if (requestId !== viewSequence) return;
      console.error('No se pudo cargar el itinerario del país:', error);
      handleFetchError('No se pudo cargar el itinerario del país desde Firebase.', canonicalPaisId);
    });
}

function showCountrySectionView(pais, paisId, sectionId, recordHistory = true, options = {}) {
  const sections = {
    actividades: {
      label: 'Actividades',
      property: 'actividades',
      category: 'actividad',
      emptyMessage: 'No hay actividades cargadas para esta ciudad.'
    },
    gastronomia: {
      label: 'Gastronomía',
      property: 'gastronomia',
      category: 'gastronomia',
      emptyMessage: 'Todavía no hay lugares de gastronomía cargados.'
    },
    supermercados: {
      label: 'Supermercados',
      property: 'supermercados',
      category: null,
      emptyMessage: 'No hay supermercados cargados para esta estadía.'
    }
  };
  const section = sections[sectionId];
  if (!section || !Array.isArray(pais?.ciudades)) {
    showCiudadesView(paisId, false);
    return;
  }

  viewSequence += 1;
  disposeHomeMap();
  ticketImportContext = null;
  setCurrentViewState({ level: 'seccion', paisId, sectionId }, recordHistory);
  updateHeader(`${pais.flag || ''} ${section.label} · ${pais.pais}`.trim(), true);

  const container = document.getElementById('app');
  if (!container) return;
  const isAdmin = activeMember?.role === 'admin' && Boolean(section.category);
  const editMode = isAdmin && options.editMode === true;
  container.className = 'p-4 max-w-md mx-auto space-y-4';
  container.innerHTML = `
    <div class="flex items-center justify-between gap-3 border-b border-slate-800 pb-2">
      <p class="text-xs text-slate-400">${escapeHtml(section.label)} por ciudad</p>
      ${isAdmin ? `<button type="button" id="toggle-activity-edit-mode" aria-label="${editMode ? 'Salir del modo edición' : 'Activar modo edición'}" aria-pressed="${editMode}" class="grid h-10 w-10 shrink-0 place-items-center rounded-lg border ${editMode ? 'border-emerald-500 bg-emerald-950/50 text-emerald-300' : 'border-slate-600 bg-slate-800 text-slate-200'} text-xl hover:bg-slate-700" title="${editMode ? 'Terminar edición' : 'Editar lugares'}">✏️</button>` : ''}
    </div>
    ${pais.ciudades.map(city => {
    const editContext = section.category ? { cityId: city.id, category: section.category } : null;
    const markerContext = sectionId === 'actividades'
      ? {
        userId: signedInUser?.uid,
        countryId: paisId,
        countryName: pais.pais,
        cityId: city.id,
        cityName: city.nombre,
        cityDates: city.fechas
      }
      : null;
    return `
      <section class="space-y-2">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h2 class="text-base font-bold text-white">${escapeHtml(city.nombre || 'Ciudad sin nombre')}</h2>
            ${sectionId === 'supermercados' && city.supermercadosDestino ? `<p class="text-xs text-emerald-300">${escapeHtml(city.supermercadosDestino)}</p>` : ''}
            <p class="text-xs text-slate-400">${escapeHtml(city.fechas || '')}</p>
          </div>
          ${editMode && city.id ? `<button type="button" data-add-activity="${escapeHtml(city.id)}" class="shrink-0 rounded-lg border border-emerald-500/50 bg-emerald-950/40 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/50">+ Agregar</button>` : ''}
        </div>
        ${sectionId === 'supermercados' && city.direccionHotel ? `<p class="text-xs text-slate-400">Hotel: ${escapeHtml(city.direccionHotel)}</p>` : ''}
        <div class="space-y-2">${renderGroupedActivities(
          normalizeActivities(city[section.property]),
          section.emptyMessage,
          city.fechas,
          sectionId !== 'supermercados',
          editContext,
          editMode,
          markerContext
        )}</div>
      </section>
    `;
  }).join('')}
  `;

  container.querySelectorAll('[data-activity-marker]').forEach(button => {
    button.addEventListener('click', () => {
      const markerType = button.dataset.activityMarker;
      try {
        const updated = toggleActivityMarker(
          button.dataset.activityMarkerKey,
          markerType,
          {
            title: button.dataset.reminderTitle,
            country: button.dataset.reminderCountry,
            city: button.dataset.reminderCity,
            date: button.dataset.reminderDate
          }
        );
        const isActive = updated[markerType];
        button.setAttribute('aria-pressed', String(isActive));
        if (markerType === 'favorite') {
          button.textContent = isActive ? '★' : '☆';
          button.setAttribute('aria-label', isActive ? 'Quitar de favoritos' : 'Marcar como favorita');
          button.title = isActive ? 'Quitar de favoritos' : 'Marcar como favorita';
          button.classList.remove('border-amber-500/60', 'bg-amber-950/50', 'text-amber-300');
          button.classList.remove('border-slate-700', 'bg-slate-800', 'text-slate-400');
          button.classList.add(...(isActive
            ? ['border-amber-500/60', 'bg-amber-950/50', 'text-amber-300']
            : ['border-slate-700', 'bg-slate-800', 'text-slate-400']));
        } else {
          button.setAttribute('aria-label', isActive ? 'Quitar marca de importante' : 'Marcar como importante');
          button.title = isActive ? 'Quitar marca de importante' : 'Marcar como importante';
          button.classList.remove('border-rose-500/60', 'bg-rose-950/50', 'text-rose-300');
          button.classList.remove('border-slate-700', 'bg-slate-800', 'text-slate-400');
          button.classList.add(...(isActive
            ? ['border-rose-500/60', 'bg-rose-950/50', 'text-rose-300']
            : ['border-slate-700', 'bg-slate-800', 'text-slate-400']));
        }
      } catch (error) {
        console.error('No se pudo guardar la marca de la actividad:', error);
        window.alert(error.message || 'No se pudo guardar la marca en este dispositivo.');
      }
    });
  });

  if (isAdmin) {
    container.querySelector('#toggle-activity-edit-mode')?.addEventListener('click', () => {
      showCountrySectionView(pais, paisId, sectionId, false, {
        ...options,
        editMode: !editMode
      });
    });
    container.querySelectorAll('[data-add-activity]').forEach(button => {
      button.addEventListener('click', () => {
        const city = pais.ciudades.find(item => item.id === button.dataset.addActivity);
        if (city) {
          openActivityEditorModal({
            countryId: paisId,
            city,
            category: section.category,
            onSaved: async () => {
              const updated = await window.TravelFirestore.loadCountry(paisId);
              if (updated) showCountrySectionView(updated, paisId, sectionId, false, { editMode });
            }
          });
        }
      });
    });

    container.querySelectorAll('[data-edit-activity]').forEach(button => {
      button.addEventListener('click', () => {
        const city = pais.ciudades.find(item => item.id === button.dataset.cityId);
        const activity = normalizeActivities(city?.[section.property]).find(item => item.id === button.dataset.editActivity);
        if (city && activity) {
          openActivityEditorModal({
            countryId: paisId,
            city,
            category: section.category,
            activity,
            onSaved: async () => {
              const updated = await window.TravelFirestore.loadCountry(paisId);
              if (updated) showCountrySectionView(updated, paisId, sectionId, false, { editMode });
            }
          });
        }
      });
    });

    container.querySelectorAll('[data-delete-activity]').forEach(button => {
      button.addEventListener('click', async () => {
        if (!window.confirm('¿Eliminar esta actividad del itinerario?')) return;
        button.disabled = true;
        try {
          await window.TravelFirestore.deleteActivity(paisId, button.dataset.cityId, button.dataset.deleteActivity);
          const updated = await window.TravelFirestore.loadCountry(paisId);
          if (updated) showCountrySectionView(updated, paisId, sectionId, false, { editMode });
        } catch (error) {
          button.disabled = false;
          window.alert(error.message || 'No se pudo eliminar la actividad.');
        }
      });
    });
  }

  if (options.focusActivityId) {
    const target = Array.from(container.querySelectorAll('[data-activity-id]'))
      .find(element => element.dataset.activityId === options.focusActivityId);
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('ring-2', 'ring-emerald-400', 'bg-emerald-950/50');
        setTimeout(() => {
          target.classList.remove('ring-2', 'ring-emerald-400', 'bg-emerald-950/50');
        }, 2500);
      });
    }
  }
}

function openActivityEditorModal({ countryId, city, category, activity = null, onSaved }) {
  const existingModal = document.getElementById('admin-editor-modal');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.id = 'admin-editor-modal';
  overlay.className = 'fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 class="text-base font-semibold text-white">${activity ? 'Editar actividad' : 'Nueva actividad'} · ${escapeHtml(city.nombre || '')}</h3>
        <button type="button" data-modal-close class="h-8 w-8 rounded-lg text-lg text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
      </div>
      <form id="activity-editor-form" class="space-y-3">
        <label class="block text-xs text-slate-300">Nombre o descripción
          <input name="nombre" required maxlength="240" value="${escapeHtml(activity?.nombre || '')}" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="text-xs text-slate-300">Día (opcional)
            <input name="dia" type="number" min="1" step="1" value="${activity?.dia ? escapeHtml(String(activity.dia)) : ''}" placeholder="Flexible" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">
          </label>
          <label class="text-xs text-slate-300">Categoría
            <select name="category" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">
              <option value="actividad" ${(activity?.category || category) === 'actividad' ? 'selected' : ''}>Actividad</option>
              <option value="gastronomia" ${(activity?.category || category) === 'gastronomia' ? 'selected' : ''}>Gastronomía</option>
            </select>
          </label>
        </div>
        <label class="block text-xs text-slate-300">Enlace de Google Maps (opcional)
          <input name="mapa" type="url" placeholder="https://maps.google.com/?q=..." value="${escapeHtml(activity?.mapa || '')}" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">
        </label>
        <label class="block text-xs text-slate-300">Nota (opcional)
          <input name="nota" maxlength="200" value="${escapeHtml(activity?.nota || '')}" placeholder="Horario, reserva, detalle…" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">
        </label>
        <label class="block text-xs text-slate-300">Web oficial (opcional)
          <input name="website" type="url" placeholder="https://..." value="${escapeHtml(activity?.website || '')}" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">
        </label>
        <p id="activity-editor-error" class="text-xs text-red-300" role="status"></p>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" data-modal-close class="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancelar</button>
          <button type="submit" class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500">Guardar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-modal-close]').forEach(btn => btn.addEventListener('click', () => overlay.remove()));

  const form = overlay.querySelector('#activity-editor-form');
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const errorEl = overlay.querySelector('#activity-editor-error');
    const data = new FormData(form);
    const existingCount = (city.actividades?.length || 0) + (city.gastronomia?.length || 0);
    submitBtn.disabled = true;
    errorEl.textContent = '';
    try {
      await window.TravelFirestore.saveActivity(countryId, city.id, {
        id: activity?.id || undefined,
        nombre: data.get('nombre'),
        dia: data.get('dia'),
        category: data.get('category'),
        mapa: data.get('mapa'),
        nota: data.get('nota'),
        website: data.get('website'),
        order: activity?.order ?? existingCount
      });
      overlay.remove();
      if (onSaved) await onSaved();
    } catch (error) {
      errorEl.textContent = error.message || 'No se pudo guardar la actividad.';
      submitBtn.disabled = false;
    }
  });
}

function createSpotifyPlaylistRow(playlist = {}) {
  const row = document.createElement('div');
  row.className = 'grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-slate-700 bg-slate-800/60 p-2';
  row.innerHTML = `
    <div class="space-y-2">
      <label class="block text-[11px] text-slate-300">Texto del banner
        <input name="nombre" maxlength="80" value="${escapeHtml(playlist.nombre || '')}" placeholder="Ej. Playlist de Alemania" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white">
      </label>
      <label class="block text-[11px] text-slate-300">Enlace de Spotify
        <input name="url" type="url" maxlength="500" value="${escapeHtml(playlist.url || '')}" placeholder="https://open.spotify.com/playlist/..." class="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white">
      </label>
    </div>
    <button type="button" data-remove-playlist aria-label="Quitar banner" title="Quitar banner" class="h-9 w-9 self-start rounded-md text-lg text-red-300 hover:bg-red-950/50">×</button>
  `;
  return row;
}

function openSpotifyPlaylistsEditor(country, countryId) {
  if (activeMember?.role !== 'admin') return;
  const existingModal = document.getElementById('admin-editor-modal');
  if (existingModal) existingModal.remove();

  const overlay = document.createElement('div');
  overlay.id = 'admin-editor-modal';
  overlay.className = 'fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:items-center';
  overlay.innerHTML = `
    <div class="w-full max-w-md space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 class="text-base font-semibold text-white">Banners de Spotify · ${escapeHtml(country.pais || '')}</h3>
        <button type="button" data-modal-close aria-label="Cerrar" class="h-8 w-8 rounded-lg text-lg text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
      </div>
      <form id="spotify-playlists-form" class="space-y-3">
        <div id="spotify-playlist-rows" class="max-h-[55vh] space-y-2 overflow-y-auto"></div>
        <button type="button" data-add-playlist class="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800">+ Agregar banner</button>
        <p id="spotify-playlists-error" class="text-xs text-red-300" role="status"></p>
        <div class="flex justify-end gap-2">
          <button type="button" data-modal-close class="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancelar</button>
          <button type="submit" class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500">Guardar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-modal-close]').forEach(button => {
    button.addEventListener('click', () => overlay.remove());
  });

  const rows = overlay.querySelector('#spotify-playlist-rows');
  const sourcePlaylists = Array.isArray(country.playlists)
    ? country.playlists
    : (country.spotifyUrl ? [{ nombre: `Playlist de ${country.pais}`, url: country.spotifyUrl }] : []);
  sourcePlaylists.forEach(playlist => rows.appendChild(createSpotifyPlaylistRow(playlist)));
  if (!sourcePlaylists.length) rows.appendChild(createSpotifyPlaylistRow());
  rows.addEventListener('click', event => {
    const removeButton = event.target.closest('[data-remove-playlist]');
    if (removeButton) removeButton.closest('.grid').remove();
  });
  overlay.querySelector('[data-add-playlist]').addEventListener('click', () => {
    rows.appendChild(createSpotifyPlaylistRow());
    rows.lastElementChild.querySelector('input[name="nombre"]').focus();
  });

  const form = overlay.querySelector('#spotify-playlists-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    const errorElement = overlay.querySelector('#spotify-playlists-error');
    const playlists = Array.from(rows.children).map(row => ({
      nombre: row.querySelector('input[name="nombre"]').value,
      url: row.querySelector('input[name="url"]').value
    }));
    submitButton.disabled = true;
    errorElement.textContent = '';
    try {
      await window.TravelFirestore.saveCountryPlaylists(countryId, playlists);
      const updatedCountry = await window.TravelFirestore.loadCountry(countryId);
      overlay.remove();
      if (updatedCountry) showCiudadesView(countryId, false);
    } catch (error) {
      errorElement.textContent = error.message || 'No se pudieron guardar los banners.';
      submitButton.disabled = false;
    }
  });
}

async function openCityCreatorModal(country, canonicalPaisId) {
  return openCityEditorModal(country, canonicalPaisId, country.ciudades.length);
}

async function openCityEditorModal(country, canonicalPaisId, cityIndex, existingCity = null, mapLocation = null) {
  const existingModal = document.getElementById('admin-editor-modal');
  if (existingModal) existingModal.remove();

  const isEditing = Boolean(existingCity);
  const initialLatitude = Number(mapLocation?.latitude ?? mapLocation?.lat);
  const initialLongitude = Number(mapLocation?.longitude ?? mapLocation?.lon);
  const hasInitialCoordinates = Number.isFinite(initialLatitude) && Number.isFinite(initialLongitude);
  const overlay = document.createElement('div');
  overlay.id = 'admin-editor-modal';
  overlay.className = 'fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 class="text-base font-semibold text-white">${isEditing ? 'Editar ciudad' : 'Nueva ciudad'} en ${escapeHtml(country.pais || '')}</h3>
        <button type="button" data-modal-close class="h-8 w-8 rounded-lg text-lg text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
      </div>
      <form id="city-creator-form" class="space-y-3">
        <label class="block text-xs text-slate-300">Nombre de la ciudad
          <input name="nombre" required maxlength="100" value="${escapeHtml(existingCity?.nombre || '')}" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">
        </label>
        <label class="block text-xs text-slate-300">Fechas
          <input name="fechas" maxlength="80" value="${escapeHtml(existingCity?.fechas || '')}" placeholder="Ej: 10/01/2027 – 12/01/2027" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">
        </label>
        <label class="block text-xs text-slate-300">Hotel (opcional)
          <input name="hotel" maxlength="120" value="${escapeHtml(existingCity?.hotel || '')}" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">
        </label>
        <label class="block text-xs text-slate-300">Enlace Maps del hotel (opcional)
          <input name="mapaHotelLink" type="url" value="${escapeHtml(existingCity?.mapaHotelLink || '')}" placeholder="https://maps.google.com/..." class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">
        </label>
        <label class="block text-xs text-slate-300">Cómo llegar (opcional)
          <textarea name="comoLlegar" rows="2" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white">${escapeHtml(existingCity?.comoLlegar || '')}</textarea>
        </label>
        <div class="space-y-1.5">
          <p class="text-xs font-medium text-slate-300">Ubicación en el mapamundi (tocá el mapa para marcarla)</p>
          <div id="city-picker-map" class="h-44 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-800"></div>
          <p id="city-picker-coords" class="text-[11px] text-slate-400">${hasInitialCoordinates ? `Ubicación actual: ${initialLatitude.toFixed(4)}, ${initialLongitude.toFixed(4)}` : 'Sin ubicación seleccionada todavía.'}</p>
          <input type="hidden" name="latitude" value="${hasInitialCoordinates ? initialLatitude : ''}">
          <input type="hidden" name="longitude" value="${hasInitialCoordinates ? initialLongitude : ''}">
        </div>
        <p id="city-creator-error" class="text-xs text-red-300" role="status"></p>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" data-modal-close class="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancelar</button>
          <button type="submit" class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500">${isEditing ? 'Guardar cambios' : 'Crear ciudad'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  let pickerMap = null;
  const closeModal = () => {
    pickerMap?.remove();
    overlay.remove();
  };
  overlay.querySelectorAll('[data-modal-close]').forEach(btn => btn.addEventListener('click', closeModal));

  try {
    const L = await import('leaflet');
    await import('leaflet/dist/leaflet.css');
    const mapEl = overlay.querySelector('#city-picker-map');
    if (mapEl && overlay.isConnected) {
      pickerMap = L.map(mapEl, { zoomControl: true }).setView(
        hasInitialCoordinates ? [initialLatitude, initialLongitude] : [50, 12],
        hasInitialCoordinates ? 9 : 4
      );
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
      }).addTo(pickerMap);
      let marker = hasInitialCoordinates
        ? L.circleMarker([initialLatitude, initialLongitude], { radius: 8, color: '#38a9ff', fillColor: '#38a9ff', fillOpacity: 0.9 }).addTo(pickerMap)
        : null;
      pickerMap.on('click', event => {
        const { lat, lng } = event.latlng;
        overlay.querySelector('input[name="latitude"]').value = lat.toFixed(5);
        overlay.querySelector('input[name="longitude"]').value = lng.toFixed(5);
        overlay.querySelector('#city-picker-coords').textContent = `Ubicación marcada: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        if (marker) marker.setLatLng([lat, lng]);
        else marker = L.circleMarker([lat, lng], { radius: 8, color: '#38a9ff', fillColor: '#38a9ff', fillOpacity: 0.9 }).addTo(pickerMap);
      });
      setTimeout(() => pickerMap?.invalidateSize(), 150);
    }
  } catch (error) {
    console.warn('No se pudo inicializar el selector de mapa:', error);
  }

  const form = overlay.querySelector('#city-creator-form');
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const errorEl = overlay.querySelector('#city-creator-error');
    const data = new FormData(form);
    const latValue = data.get('latitude');
    const lonValue = data.get('longitude');
    submitBtn.disabled = true;
    errorEl.textContent = '';
    try {
      if (!isEditing && (latValue === '' || lonValue === '')) {
        throw new Error('Marcá la ubicación de la ciudad tocando el mapa.');
      }
      const cityData = {
        nombre: data.get('nombre'),
        fechas: data.get('fechas'),
        hotel: data.get('hotel'),
        mapaHotelLink: data.get('mapaHotelLink'),
        comoLlegar: data.get('comoLlegar')
      };
      const stopData = (latValue !== '' && lonValue !== '') ? {
        latitude: Number(latValue),
        longitude: Number(lonValue),
        countryName: country.pais || '',
        flag: country.flag || '',
        stage: data.get('fechas') || ''
      } : null;
      if (isEditing) {
        await window.TravelFirestore.updateCityWithRouteStop({
          countryId: canonicalPaisId,
          cityId: existingCity.id,
          cityIndex,
          cityData,
          stopData
        });
      } else {
        await window.TravelFirestore.addCityWithRouteStop({
          countryId: canonicalPaisId,
          countryName: country.pais || '',
          flag: country.flag || '',
          cityData,
          stopData
        });
      }
      closeModal();
      showCiudadesView(canonicalPaisId, false);
    } catch (error) {
      errorEl.textContent = error.message || 'No se pudo crear la ciudad.';
      submitBtn.disabled = false;
    }
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
  disposeHomeMap();
  setCurrentViewState({ level: 'detalle', paisId: statePaisId, ciudadIndex }, recordHistory);
  updateHeader(ciudad.nombre || 'Detalle', true);

  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'p-4 max-w-md mx-auto space-y-4';

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
  } else if (currentViewState.level === 'seccion') {
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
  if (view.level === 'seccion') {
    const requestId = ++viewSequence;
    setTopLoading(true);
    try {
      const country = await window.TravelFirestore.loadCountry(view.paisId);
      if (requestId !== viewSequence) return;
      if (!country) {
        showCiudadesView(view.paisId, false);
        return;
      }
      showCountrySectionView(country, view.paisId, view.sectionId, false);
    } catch (error) {
      if (requestId === viewSequence) {
        console.error('No se pudo restaurar el apartado anterior:', error);
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

  disposeHomeMap();
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
  const button = document.createElement('button');
  const enteringMap = homeMode === 'list';
  button.type = 'button';
  button.className = 'rounded-xl border border-white/20 bg-[#142d33]/95 px-4 py-2.5 text-sm font-bold text-white shadow-lg backdrop-blur transition-colors hover:bg-[#24434b]';
  button.setAttribute('aria-label', enteringMap ? 'Abrir mapa de Europa' : 'Volver a la lista de destinos');
  button.textContent = enteringMap ? '🗺️ Mapa' : '☷ Lista';
  button.addEventListener('click', async () => {
    if (enteringMap) {
      await enterMapMode();
      homeMode = 'map';
    } else {
      homeMode = 'list';
    }
    renderHomeView();
  });
  return button;
}

function createShoppingShortcut() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rounded-xl border border-white/20 bg-[#142d33]/95 px-4 py-2.5 text-sm font-bold text-white shadow-lg backdrop-blur transition-colors hover:bg-[#24434b]';
  button.setAttribute('aria-label', 'Abrir lista de compras');
  button.textContent = '🛒 Compras';
  button.addEventListener('click', () => showVaultListView('Compras'));
  return button;
}

function updateHomeClocks() {
  const now = new Date();
  document.querySelectorAll('[data-country-clock]').forEach(element => {
    const timeZone = homeConditionTimeZones.get(element.dataset.countryClock);
    element.textContent = formatLocalTime(timeZone, now);
  });
}

function findHomeCountryCard(countryId) {
  return Array.from(document.querySelectorAll('[data-country-card]'))
    .find(card => card.dataset.countryCard === countryId);
}

function applyConditions(clock, weatherLabel, cityName, conditions) {
  const presentation = weatherPresentation(conditions.weatherCode);
  const degrees = Math.round(conditions.temperatureC);
  weatherLabel.textContent = `${presentation.icon} ${degrees} °C`;
  weatherLabel.title = `${presentation.label} en ${cityName}${conditions.stale ? ' · dato guardado en caché' : ''}`;
  weatherLabel.setAttribute('aria-label', `${presentation.label}, ${degrees} grados Celsius en ${cityName}`);
  clock.dataset.timeZone = conditions.timeZone;
  clock.textContent = formatLocalTime(conditions.timeZone);
  clock.title = `Hora local de ${cityName}`;
}

function showHomeConditions(countryId, destination, conditions) {
  const card = findHomeCountryCard(countryId);
  if (!card || !destination || !conditions) return;
  homeConditionTimeZones.set(countryId, conditions.timeZone);
  applyConditions(
    card.querySelector('[data-country-clock]'),
    card.querySelector('[data-country-weather]'),
    destination.cityName,
    conditions
  );
}

function loadCityConditions(container, country, routeStops, isCurrentView) {
  if (cityConditionsTimer) clearInterval(cityConditionsTimer);
  cityConditionsTimer = null;

  container.querySelectorAll('[data-city-conditions]').forEach(element => {
    const clock = element.querySelector('[data-city-clock]');
    const weatherLabel = element.querySelector('[data-city-weather]');
    const location = selectCityLocation(country, Number(element.dataset.cityConditions), routeStops);
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
      weatherLabel.title = 'Esta ciudad todavía no tiene ubicación en el mapa.';
      return;
    }
    try {
      const cached = getCachedCurrentConditions(location);
      if (cached) applyConditions(clock, weatherLabel, location.cityName, cached);
    } catch (error) {
      console.warn(`No se pudo leer el clima guardado de ${location.cityName}:`, error);
    }
    fetchCurrentConditions(location)
      .then(conditions => {
        if (isCurrentView()) applyConditions(clock, weatherLabel, location.cityName, conditions);
      })
      .catch(error => {
        weatherLabel.title = error?.message || 'No se pudo consultar el clima.';
        console.warn(`No se pudo cargar hora y clima de ${location.cityName}:`, error);
      });
  });

  cityConditionsTimer = setInterval(() => {
    if (!isCurrentView()) {
      clearInterval(cityConditionsTimer);
      cityConditionsTimer = null;
      return;
    }
    container.querySelectorAll('[data-city-clock][data-time-zone]').forEach(clock => {
      clock.textContent = formatLocalTime(clock.dataset.timeZone);
    });
  }, 60 * 1000);
}

function createImportantActivitiesBanner() {
  let reminders;
  try {
    reminders = getDueImportantActivities(localDateKey());
  } catch (error) {
    console.error('No se pudieron cargar los recordatorios importantes locales:', error);
    return null;
  }
  if (!reminders.length) return null;

  const banner = document.createElement('section');
  banner.className = 'rounded-xl border border-rose-500/40 bg-rose-950/40 p-3';
  banner.setAttribute('aria-live', 'polite');
  const heading = document.createElement('h2');
  heading.className = 'text-xs font-bold uppercase tracking-wide text-rose-200';
  heading.textContent = 'Actividades importantes pendientes';
  banner.appendChild(heading);
  const list = document.createElement('div');
  list.className = 'mt-2 space-y-2';
  reminders.forEach(reminder => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-3 rounded-lg bg-slate-950/30 px-2.5 py-2';
    const label = document.createElement('p');
    label.className = 'min-w-0 flex-1 text-xs text-slate-100';
    label.textContent = `${reminder.title}${reminder.city ? ` · ${reminder.city}` : ''}${reminder.country ? `, ${reminder.country}` : ''}`;
    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.className = 'shrink-0 rounded-md border border-rose-300/30 px-2.5 py-1.5 text-[11px] font-semibold text-rose-100 hover:bg-rose-900/50';
    doneButton.textContent = '✓ Listo';
    doneButton.setAttribute('aria-label', `Marcar como lista: ${reminder.title}`);
    doneButton.addEventListener('click', () => {
      try {
        completeImportantActivityReminder(reminder.key);
        row.remove();
        if (!list.children.length) banner.remove();
      } catch (error) {
        console.error('No se pudo completar el recordatorio local:', error);
        window.alert(error.message || 'No se pudo actualizar el recordatorio.');
      }
    });
    row.append(label, doneButton);
    list.appendChild(row);
  });
  banner.appendChild(list);
  return banner;
}

async function loadHomeConditions() {
  const requestId = ++homeConditionRequestSequence;
  const screenSequence = viewSequence;
  const now = new Date();
  homeConditionsDate = localDateKey(now);
  const isCurrentHome = () => requestId === homeConditionRequestSequence
    && screenSequence === viewSequence
    && currentViewState.level === 'paises'
    && homeMode === 'list';

  if (homeConditionClockTimer) clearInterval(homeConditionClockTimer);
  homeConditionTimeZones = new Map();
  try {
    const [routeStopsResult, countryResults] = await Promise.all([
      window.TravelFirestore.loadRouteStops()
        .then(stops => stops.length
          ? ({ stops, error: null })
          : ({
            stops: routeCatalog.stops,
            error: new Error('Firestore no devolvió paradas del itinerario.')
          }))
        .catch(error => ({ stops: routeCatalog.stops, error })),
      Promise.all(homeCountries.map(async country => {
        try {
          const cities = await window.TravelFirestore.loadCountryCities(country.id);
          return { ...country, ciudades: cities, error: null };
        } catch (error) {
          return { ...country, ciudades: [], error };
        }
      }))
    ]);
    if (!isCurrentHome()) return;
    if (routeStopsResult.error) {
      console.warn('No se pudieron cargar las coordenadas actuales del itinerario; se usa el catálogo local:', routeStopsResult.error);
    }

    const destinations = countryResults.map(country => ({
      country,
      destination: country.error
        ? null
        : selectCountryDestination(country, routeStopsResult.stops, now)
    }));

    destinations.forEach(({ country, destination }) => {
      const card = findHomeCountryCard(country.id);
      if (!card) return;
      const cityLabel = card.querySelector('[data-country-destination]');
      const weatherLabel = card.querySelector('[data-country-weather]');
      if (!destination) {
        cityLabel.textContent = 'Ubicación no disponible';
        weatherLabel.textContent = '— °C';
        weatherLabel.title = country.error?.message || 'No se pudo cargar el itinerario de este país.';
        return;
      }
      cityLabel.textContent = destination.cityName;
      cityLabel.title = destination.isTravelDate
        ? `Destino según las fechas del itinerario: ${destination.cityName}`
        : `Fuera de las fechas del viaje; se muestra la primera ciudad: ${destination.cityName}`;
      if (!Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)) {
        weatherLabel.textContent = '— °C';
        weatherLabel.title = `No hay coordenadas de mapa para ${destination.cityName}.`;
        return;
      }
      try {
        const cached = getCachedCurrentConditions(destination);
        if (cached) showHomeConditions(country.id, destination, cached);
      } catch (error) {
        console.warn(`No se pudo leer el clima guardado de ${destination.cityName}:`, error);
      }
    });

    const weatherResults = await Promise.all(destinations.map(async ({ country, destination }) => {
      if (!destination || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)) {
        return { countryId: country.id, destination, conditions: null, error: country.error || null };
      }
      try {
        const conditions = await fetchCurrentConditions(destination);
        return { countryId: country.id, destination, conditions, error: null };
      } catch (error) {
        return { countryId: country.id, destination, conditions: null, error };
      }
    }));
    if (!isCurrentHome()) return;

    weatherResults.forEach(({ countryId, destination, conditions, error }) => {
      const card = findHomeCountryCard(countryId);
      if (!card || !destination) return;
      const weatherLabel = card.querySelector('[data-country-weather]');
      if (conditions) {
        showHomeConditions(countryId, destination, conditions);
      } else {
        weatherLabel.textContent = '— °C';
        weatherLabel.title = error?.message || 'No se pudo consultar el clima.';
        if (error) console.warn(`No se pudo cargar hora y clima de ${destination.cityName}:`, error);
      }
    });

    homeConditionClockTimer = setInterval(() => {
      if (!isCurrentHome()) {
        clearInterval(homeConditionClockTimer);
        homeConditionClockTimer = null;
        return;
      }
      if (localDateKey() !== homeConditionsDate) {
        loadHomeConditions();
        return;
      }
      updateHomeClocks();
    }, 60 * 1000);
    updateHomeClocks();
  } catch (error) {
    if (isCurrentHome()) {
      console.error('No se pudieron cargar los datos de hora y clima de los destinos:', error);
      document.querySelectorAll('[data-country-weather]').forEach(element => {
        element.textContent = '— °C';
        element.title = error.message || 'No se pudieron cargar las condiciones actuales.';
      });
    }
  }
}

function renderHomeView() {
  const container = document.getElementById('app');
  if (!container) return;
  if (homeMode === 'list') {
    disposeHomeMap();
  } else {
    homeConditionRequestSequence += 1;
    if (homeConditionClockTimer) {
      clearInterval(homeConditionClockTimer);
      homeConditionClockTimer = null;
    }
    mapController?.dispose();
    mapController = null;
  }

  if (homeMode === 'list') {
    container.className = 'p-4 max-w-md mx-auto space-y-4';
    container.style.height = '';
    container.innerHTML = syncWarningMarkup();
    const mapButton = document.createElement('div');
    mapButton.className = 'flex justify-end gap-2';
    mapButton.appendChild(createHomeSwitch());
    mapButton.appendChild(createShoppingShortcut());
    container.appendChild(mapButton);
    const importantActivitiesBanner = createImportantActivitiesBanner();
    if (importantActivitiesBanner) container.appendChild(importantActivitiesBanner);
    homeCountries.forEach(country => {
      const card = document.createElement('button');
      card.type = 'button';
      card.dataset.countryCard = country.id;
      card.className = 'relative block h-32 w-full overflow-hidden rounded-xl border border-slate-700 text-left shadow-lg transition-transform active:scale-[.98]';
      card.onclick = () => showCiudadesView(country.id);
      card.innerHTML = `
        <img src="${escapeHtml(country.bgImage || '')}" class="absolute inset-0 h-full w-full object-cover brightness-50" alt="">
        <span class="absolute inset-0 flex items-end justify-between gap-3 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent p-4">
          <span class="min-w-0">
            <span class="block text-xl font-bold text-white">${escapeHtml(country.flag || '')} ${escapeHtml(country.pais || 'Sin nombre')}</span>
            <span data-country-destination class="mt-1 block truncate text-[11px] text-slate-200">Cargando ciudad…</span>
          </span>
          <span class="flex shrink-0 flex-col items-end gap-1 text-xs font-semibold text-white">
            <span data-country-clock="${escapeHtml(country.id)}" class="tabular-nums">--:--</span>
            <span data-country-weather aria-label="Clima actual">— °C</span>
          </span>
        </span>
      `;
      container.appendChild(card);
    });
    loadHomeConditions();
    return;
  }

  document.body.classList.add('map-mode');
  container.className = 'travel-map-screen relative isolate overflow-hidden bg-[#09191e]';
  container.style.height = '';
  container.innerHTML = `
    <div id="map-scene" class="travel-map absolute inset-0 z-0" role="application" aria-label="Mapa interactivo de Europa"></div>
    <div id="map-switch-slot" class="absolute left-3 top-3 z-[1000]"></div>
    <section id="map-destination-toast" class="absolute bottom-4 left-4 right-4 z-[1000] hidden flex-col gap-2.5 rounded-xl border border-white/15 bg-[#12272deF] p-3 text-white shadow-2xl backdrop-blur-md" aria-live="polite">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p id="map-destination-country" class="text-[10px] font-bold uppercase tracking-[.16em] text-[#e7a66e]"></p>
          <h2 id="map-destination-title" class="mt-1 truncate text-base font-semibold"></h2>
          <p id="map-destination-stage" class="mt-0.5 truncate text-xs text-slate-300"></p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button id="map-destination-open" type="button" class="hidden rounded-lg bg-[#e7a66e] px-3 py-2 text-xs font-bold text-[#172328] transition-colors hover:bg-[#f2bd8f]">Ir al itinerario</button>
          <button id="map-destination-close" type="button" class="grid h-9 w-9 place-items-center rounded-lg text-lg text-slate-200 hover:bg-white/10" aria-label="Cerrar destino">×</button>
        </div>
      </div>
      <div id="map-destination-activities" class="hidden max-h-36 space-y-1 overflow-y-auto border-t border-white/10 pt-2"></div>
    </section>
  `;
  const mapActions = document.createElement('div');
  mapActions.className = 'flex gap-2';
  mapActions.appendChild(createHomeSwitch());
  mapActions.appendChild(createShoppingShortcut());
  container.querySelector('#map-switch-slot').appendChild(mapActions);

  let selectedMapLocation = null;
  let mapSelectionToken = 0;
  const destinationToast = container.querySelector('#map-destination-toast');
  const itineraryButton = container.querySelector('#map-destination-open');
  const activitiesBox = container.querySelector('#map-destination-activities');

  async function showMapDestination(location) {
    const token = ++mapSelectionToken;
    selectedMapLocation = location;
    if (!location) {
      destinationToast.classList.add('hidden');
      destinationToast.classList.remove('flex');
      activitiesBox.classList.add('hidden');
      activitiesBox.innerHTML = '';
      return;
    }
    container.querySelector('#map-destination-country').textContent = location.hasItinerary
      ? `${location.flag || ''} ${location.countryName || ''}`.trim()
      : '';
    container.querySelector('#map-destination-title').textContent = location.name || 'Parada del recorrido';
    container.querySelector('#map-destination-stage').textContent = location.hasItinerary
      ? location.stage || ''
      : '';
    itineraryButton.classList.toggle('hidden', !(location.hasItinerary && location.countryId));
    destinationToast.classList.remove('hidden');
    destinationToast.classList.add('flex');

    if (!(location.hasItinerary && location.countryId)) {
      activitiesBox.classList.add('hidden');
      activitiesBox.innerHTML = '';
      return;
    }

    activitiesBox.classList.remove('hidden');
    activitiesBox.innerHTML = '<p class="text-[11px] text-slate-300">Cargando actividades…</p>';
    try {
      const country = await window.TravelFirestore.loadCountry(location.countryId);
      if (token !== mapSelectionToken || !container.isConnected) return;
      const cities = Array.isArray(country?.ciudades) ? country.ciudades : [];
      const cityIndex = Number.isInteger(location.cityIndex) && cities[location.cityIndex]
        ? location.cityIndex
        : (cities.length === 1 ? 0 : null);
      const city = cityIndex !== null ? cities[cityIndex] : null;
      const items = [
        ...normalizeActivities(city?.actividades).map(item => ({ ...item, category: 'actividad' })),
        ...normalizeActivities(city?.gastronomia).map(item => ({ ...item, category: 'gastronomia' }))
      ];
      if (!items.length) {
        activitiesBox.innerHTML = '<p class="text-[11px] text-slate-400">No hay actividades cargadas para esta ciudad.</p>';
        return;
      }
      activitiesBox.innerHTML = items.map((item, idx) => `
        <button type="button" data-map-activity-idx="${idx}" class="flex w-full items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-left text-xs text-slate-100 hover:bg-white/15">
          <span class="min-w-0 truncate">${item.category === 'gastronomia' ? '🍽️' : '🚶'} ${escapeHtml(item.nombre)}</span>
          <span class="shrink-0 text-[10px] text-[#e7a66e]">Ver ➔</span>
        </button>
      `).join('');
      activitiesBox.querySelectorAll('[data-map-activity-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          const item = items[Number(btn.dataset.mapActivityIdx)];
          if (!item) return;
          const sectionId = item.category === 'gastronomia' ? 'gastronomia' : 'actividades';
          showCountrySectionView(country, location.countryId, sectionId, true, { focusActivityId: item.id });
        });
      });
    } catch {
      if (token === mapSelectionToken) {
        activitiesBox.innerHTML = '<p class="text-[11px] text-slate-400">No se pudieron cargar las actividades.</p>';
      }
    }
  }
  itineraryButton.addEventListener('click', () => {
    if (selectedMapLocation) openMapItinerary(selectedMapLocation);
  });
  container.querySelector('#map-destination-close').addEventListener('click', () => showMapDestination(null));

  Promise.all([
    import('./map.js'),
    window.TravelFirestore.loadRouteStops().catch(() => [])
  ])
    .then(([{ mountTravelMap }, firestoreStops]) => {
      if (!container.isConnected || homeMode !== 'map') return;
      const mapContainer = container.querySelector('#map-scene');
      if (!mapContainer) return;
      const sourceStops = Array.isArray(firestoreStops) && firestoreStops.length
        ? firestoreStops
        : routeCatalog.stops;
      const metadataById = new Map(routeCatalog.stops.map(stop => [stop.id, stop]));
      const locations = sourceStops.map((stop, index, stops) => {
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
      mapController = mountTravelMap(
        mapContainer,
        locations,
        routeCatalog.animatedTrips,
        routeCatalog.celebrationDates,
        () => {},
        showMapDestination
      );
    })
    .catch(error => {
      console.error('No se pudo cargar el mapa:', error);
      const notice = document.createElement('p');
      notice.className = 'travel-map-tile-error';
      notice.textContent = `Error al cargar el mapa: ${error.message || 'falló la inicialización'}. Volvé a Lista e intentá nuevamente.`;
      container.appendChild(notice);
    });
}

async function openMapItinerary(location) {
  if (!location.hasItinerary || !location.countryId) return;
  try {
    const country = await window.TravelFirestore.loadCountry(location.countryId);
    if (!country) {
      renderEmptyState('El itinerario de este destino todavía no está disponible.');
      return;
    }
    const cities = Array.isArray(country.ciudades) ? country.ciudades : [];
    const cityIndex = Number.isInteger(location.cityIndex) && cities[location.cityIndex]
      ? location.cityIndex
      : cities.length === 1 ? 0 : null;
    if (cityIndex !== null && cities[cityIndex]) {
      showDetalleCiudadView(country, cityIndex, location.countryId);
    } else {
      showCiudadesView(location.countryId);
    }
  } catch {
    handleFetchError('No se pudo cargar el itinerario de este destino.', `frontend/data/${location.countryId}.json`);
  }
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
  disposeHomeMap();
  container.className = 'p-4 max-w-2xl mx-auto space-y-4';
  window.TravelVault.render(container, vaultPage, updateVaultNavigation);
}