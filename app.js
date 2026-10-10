let currentViewState = { level: 'paises', paisId: null };
let homeMode = 'globe';
let homeCountries = [];
let disposeGlobe = null;
let focusedGlobeLocation = null;

if ('serviceWorker' in navigator) {
  let reloadingAfterUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingAfterUpdate) return;
    reloadingAfterUpdate = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('sw.js?v=1.0.11', { updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(err => console.error('Service Worker error:', err));
}

document.addEventListener('DOMContentLoaded', () => {
  const backButton = document.getElementById('btnBack');
  if (backButton) {
    backButton.addEventListener('click', handleBack);
  }
  showPaisesView();
});

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

function getJson(url) {
  return fetch(url).then(res => {
    if (!res.ok) {
      throw new Error(`No se pudo cargar ${url} (${res.status})`);
    }
    return res.json();
  });
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

// Nivel 1: Cargar la lista de países
function showPaisesView() {
  currentViewState = { level: 'paises', paisId: null };
  updateHeader('🌍 Elegí un Destino', false);

  const container = document.getElementById('app');
  if (!container) return;
  container.innerHTML = '<p class="text-center text-slate-400 text-sm">Cargando países...</p>';

  getJson('data/country.json')
    .then(paises => {
      if (!Array.isArray(paises) || !paises.length) {
        renderEmptyState('No hay países disponibles para mostrar.');
        return;
      }

      homeCountries = paises;
      renderHomeView();
    })
    .catch(err => {
      handleFetchError('No se pudo cargar la lista de países. Revisa que exista data/country.json.', 'data/country.json');
    });
}

// Nivel 2: Cargar dinámicamente el JSON del país seleccionado
function showCiudadesView(paisId) {
  const canonicalPaisId = normalizeCountryId(paisId);
  currentViewState = { level: 'ciudades', paisId: canonicalPaisId };

  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'p-4 max-w-md mx-auto space-y-4';
  container.innerHTML = '<p class="text-center text-slate-400 text-sm py-8">Cargando itinerario...</p>';

  getJson(`data/${canonicalPaisId}.json`)
    .then(pais => {
      if (!pais || !pais.pais) {
        renderEmptyState('El país solicitado no tiene información disponible.');
        return;
      }

      if (pais.id) {
        pais.id = normalizeCountryId(pais.id);
      }

      updateHeader(`${pais.flag || ''} ${pais.pais}`.trim(), true);
      container.innerHTML = '';

      if (pais.spotifyUrl) {
        const spotifyBtn = document.createElement('a');
        spotifyBtn.href = pais.spotifyUrl;
        spotifyBtn.target = '_blank';
        spotifyBtn.rel = 'noopener noreferrer';
        spotifyBtn.className = 'w-full bg-emerald-600 hover:bg-emerald-500 text-white p-3 rounded-xl flex items-center justify-between text-xs font-bold active:scale-95 transition-all shadow-md mb-4';
        spotifyBtn.innerHTML = `
          <span class="flex items-center gap-2">🎧 Playlist de ${escapeHtml(pais.pais)}</span>
          <span>Abrir Spotify ➔</span>
        `;
        container.appendChild(spotifyBtn);
      }

      if (pais.driveFolderUrl) {
        const driveBtn = document.createElement('a');
        driveBtn.href = pais.driveFolderUrl;
        driveBtn.target = '_blank';
        driveBtn.rel = 'noopener noreferrer';
        driveBtn.className = 'w-full bg-blue-700 hover:bg-blue-600 text-white p-3 rounded-xl flex items-center justify-between text-xs font-bold active:scale-95 transition-all shadow-md mb-4';
        driveBtn.innerHTML = `
          <span class="flex items-center gap-2">🎟️ Tickets de ${escapeHtml(pais.pais)}</span>
          <span>Abrir Drive ➔</span>
        `;
        container.appendChild(driveBtn);
      }

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

      const servicios = pais.servicios || {};
      const divider = document.createElement('hr');
      divider.className = 'border-slate-800 my-4';
      container.appendChild(divider);

      const serviciosBlock = document.createElement('div');
      serviciosBlock.className = 'grid grid-cols-1 gap-2';
      serviciosBlock.innerHTML = `
        <a href="${escapeHtml(servicios.consulados || '#')}" target="_blank" rel="noopener noreferrer" class="bg-slate-800/80 border border-slate-700/60 p-3 rounded-xl flex items-center justify-between text-xs text-slate-200">
          <span class="flex items-center gap-2">🏛️ Consulado / Comisaría</span>
          <span class="text-blue-400 font-medium">Maps ➔</span>
        </a>
        <a href="${escapeHtml(servicios.farmacias || '#')}" target="_blank" rel="noopener noreferrer" class="bg-slate-800/80 border border-slate-700/60 p-3 rounded-xl flex items-center justify-between text-xs text-slate-200">
          <span class="flex items-center gap-2">⚕️ Farmacias cercanas</span>
          <span class="text-blue-400 font-medium">Maps ➔</span>
        </a>
        <a href="${escapeHtml(servicios.lavanderias || '#')}" target="_blank" rel="noopener noreferrer" class="bg-slate-800/80 border border-slate-700/60 p-3 rounded-xl flex items-center justify-between text-xs text-slate-200">
          <span class="flex items-center gap-2">🧺 Lavanderías</span>
          <span class="text-blue-400 font-medium">Maps ➔</span>
        </a>
      `;
      container.appendChild(serviciosBlock);
    })
    .catch(err => {
      handleFetchError('No se pudo cargar el itinerario del país.', `data/${paisId}.json`);
    });
}

// Nivel 3: Vista de Detalle de Ciudad
function showDetalleCiudadView(pais, ciudadIndex, paisIdOverride) {
  if (!pais || !Array.isArray(pais.ciudades) || !pais.ciudades[ciudadIndex]) {
    renderEmptyState('La ciudad seleccionada no existe.');
    return;
  }

  const ciudad = pais.ciudades[ciudadIndex];
  const statePaisId = normalizeCountryId(paisIdOverride || pais.id || currentViewState.paisId);
  currentViewState = { level: 'detalle', paisId: statePaisId };
  updateHeader(ciudad.nombre || 'Detalle', true);

  const container = document.getElementById('app');
  if (!container) return;
  container.className = 'p-4 max-w-md mx-auto space-y-4';

  const actividades = normalizeActivities(ciudad.actividades);
  const gastronomia = normalizeActivities(ciudad.gastronomia);

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
          ${ciudad.hotelUrl ? `
            <a href="${escapeHtml(ciudad.hotelUrl)}" target="_blank" rel="noopener noreferrer" class="bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-all">
              🏨 Booking
            </a>` : ''}
          ${ciudad.voucherEsUrl ? `
            <a href="${escapeHtml(ciudad.voucherEsUrl)}" target="_blank" rel="noopener noreferrer" class="bg-slate-700 hover:bg-slate-600 text-white text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-all">
              📄 Voucher ES
            </a>` : ''}
          ${ciudad.voucherLocalUrl ? `
            <a href="${escapeHtml(ciudad.voucherLocalUrl)}" target="_blank" rel="noopener noreferrer" class="bg-slate-700 hover:bg-slate-600 text-white text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-all">
              📄 Voucher original
            </a>` : ''}
        </div>
      </div>

      <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-700/50 space-y-1">
        <h4 class="text-xs font-bold text-slate-300">🚌 ¿Cómo llego al hotel?</h4>
        <p class="text-xs text-slate-400 leading-relaxed">${escapeHtml(ciudad.comoLlegar || 'No hay información de llegada disponible.')}</p>
      </div>

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
}

function handleBack() {
  if (currentViewState.level === 'detalle') {
    showCiudadesView(currentViewState.paisId);
  } else if (currentViewState.level === 'ciudades') {
    showPaisesView();
  }
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
  disposeGlobe?.();
  disposeGlobe = null;
  focusedGlobeLocation = null;

  if (homeMode === 'list') {
    container.className = 'p-4 max-w-md mx-auto space-y-4';
    container.innerHTML = '';
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
    <div id="home-switch-slot" class="absolute right-4 top-4 z-20"></div>
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
  container.querySelector('#home-switch-slot').appendChild(createHomeSwitch());

  function showDestination(location) {
    focusedGlobeLocation = location;
    const toast = container.querySelector('#destination-toast');
    const openButton = container.querySelector('#destination-open');
    container.querySelector('#destination-country').textContent = `${location.flag || ''} ${location.countryName}`;
    container.querySelector('#destination-title').textContent = location.name;
    const stage = location.stage ? ` · ${location.stage}` : '';
    container.querySelector('#destination-date').textContent = `Etapa ${location.routeIndex + 1} de ${location.routeLength}${stage}`;
    if (location.countryId) {
      openButton.classList.remove('hidden');
      openButton.onclick = async () => {
        try {
          const country = await getJson(`data/${location.countryId}.json`);
          const cities = Array.isArray(country.ciudades) ? country.ciudades : [];
          const hasSelectedCity = location.openMode === 'detail'
            && Number.isInteger(location.cityIndex)
            && cities[location.cityIndex];
          const cityIndex = hasSelectedCity ? location.cityIndex : cities.length === 1 ? 0 : null;

          if (cityIndex !== null && cities[cityIndex]) {
            showDetalleCiudadView(country, cityIndex, location.countryId);
          } else {
            showCiudadesView(location.countryId);
          }
        } catch {
          handleFetchError('No se pudo cargar el itinerario de este destino.', `data/${location.countryId}.json`);
        }
      };
    } else {
      openButton.classList.add('hidden');
    }
    toast.classList.remove('animate-[toast-in_.25s_ease-out]');
    requestAnimationFrame(() => toast.classList.add('animate-[toast-in_.25s_ease-out]'));
  }

  Promise.all([import('./globe.js'), getJson('data/map-locations.json')])
    .then(([{ mountTravelGlobe }, route]) => {
      if (!container.isConnected || homeMode !== 'globe') return;
      const canvasContainer = container.querySelector('#globe-scene');
      if (!canvasContainer) return;
      const locations = (Array.isArray(route.stops) ? route.stops : []).map((stop, index, stops) => ({
        ...stop,
        lat: stop.latitude,
        lon: stop.longitude,
        routeIndex: index,
        routeLength: stops.length
      }));
      disposeGlobe = mountTravelGlobe(
        canvasContainer,
        locations,
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