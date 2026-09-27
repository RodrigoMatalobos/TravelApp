let currentViewState = { level: 'paises', paisId: null };

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.error('Service Worker error:', err));
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

function analyzeBookingQr() {
  if (!('BarcodeDetector' in window)) {
    alert('Este navegador no permite analizar QR automáticamente. Descargá la imagen y escaneala con la cámara del teléfono.');
    return;
  }

  const resultWindow = window.open('', '_blank');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      resultWindow?.close();
      return;
    }

    try {
      const imageBitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const results = await detector.detect(imageBitmap);
      imageBitmap.close();

      if (!results.length || !results[0].rawValue) {
        throw new Error('No se encontró un QR en la imagen seleccionada.');
      }

      const targetUrl = new URL(results[0].rawValue);
      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        throw new Error('El QR no contiene un enlace web seguro.');
      }

      if (resultWindow) {
        resultWindow.location.href = targetUrl.href;
      } else {
        window.location.href = targetUrl.href;
      }
    } catch (error) {
      resultWindow?.close();
      alert(error.message || 'No se pudo analizar el QR.');
    } finally {
      fileInput.remove();
    }
  };
  document.body.appendChild(fileInput);
  fileInput.click();
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

      container.innerHTML = '';
      paises.forEach(p => {
        const card = document.createElement('div');
        card.className = 'relative h-32 rounded-2xl overflow-hidden shadow-lg cursor-pointer active:scale-95 transition-all border border-slate-700 mb-3';
        card.onclick = () => showCiudadesView(p.id);

        card.innerHTML = `
          <img src="${escapeHtml(p.bgImage || '')}" class="absolute inset-0 w-full h-full object-cover brightness-50" alt="${escapeHtml(p.pais || 'País')}">
          <div class="absolute inset-0 p-4 flex items-end bg-gradient-to-t from-slate-950/80 to-transparent">
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              <span>${escapeHtml(p.flag || '')}</span> ${escapeHtml(p.pais || 'Sin nombre')}
            </h2>
          </div>
        `;
        container.appendChild(card);
      });
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
          ${ciudad.hotelUrl && ciudad.qrUrl ? `
            <button type="button" onclick="analyzeBookingQr()" class="bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-all">
              🏨 Booking
            </button>` : ciudad.hotelUrl ? `
            <a href="${escapeHtml(ciudad.hotelUrl)}" target="_blank" rel="noopener noreferrer" class="bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-all">
              🏨 Booking
            </a>` : ''}
          ${ciudad.qrUrl ? `
            <a href="${escapeHtml(ciudad.qrUrl)}" target="_blank" rel="noopener noreferrer" class="bg-slate-700 hover:bg-slate-600 text-white text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-all">
              🔳 QR reserva
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

function updateHeader(title, showBackBtn) {
  const headerTitle = document.getElementById('headerTitle');
  const btn = document.getElementById('btnBack');
  if (headerTitle) headerTitle.innerText = title;
  if (btn) {
    if (showBackBtn) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
  }
}