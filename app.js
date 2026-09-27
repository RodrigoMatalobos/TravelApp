let currentViewState = { level: 'paises', paisId: null };

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.error(err));
}

document.addEventListener('DOMContentLoaded', () => {
  showPaisesView();
  document.getElementById('btnBack').addEventListener('click', handleBack);
});

// Nivel 1: Cargar la lista de países
function showPaisesView() {
  currentViewState = { level: 'paises', paisId: null };
  updateHeader('🌍 Elegí un Destino', false);

  const container = document.getElementById('app');
  container.innerHTML = '<p class="text-center text-slate-400 text-sm">Cargando países...</p>';

  fetch('data/country.json')
    .then(res => res.json())
    .then(paises => {
      container.innerHTML = '';
      paises.forEach(p => {
        const card = document.createElement('div');
        card.className = 'relative h-32 rounded-2xl overflow-hidden shadow-lg cursor-pointer active:scale-95 transition-all border border-slate-700 mb-3';
        card.onclick = () => showCiudadesView(p.id);

        card.innerHTML = `
          <img src="${p.bgImage}" class="absolute inset-0 w-full h-full object-cover brightness-50">
          <div class="absolute inset-0 p-4 flex items-end bg-gradient-to-t from-slate-950/80 to-transparent">
            <h2 class="text-xl font-bold text-white flex items-center gap-2">
              <span>${p.flag}</span> ${p.pais}
            </h2>
          </div>
        `;
        container.appendChild(card);
      });
    });
}

// Nivel 2: Cargar dinámicamente el JSON del país seleccionado
function showCiudadesView(paisId) {
  currentViewState = { level: 'ciudades', paisId: paisId };
  
  const container = document.getElementById('app');
  container.innerHTML = '<p class="text-center text-slate-400 text-sm">Cargando itinerario...</p>';

  fetch(`data/${paisId}.json`)
    .then(res => res.json())
    .then(pais => {
      updateHeader(`${pais.flag} ${pais.pais}`, true);
      container.innerHTML = '';

      // Lista de Ciudades
      const ciudadesSection = document.createElement('div');
      ciudadesSection.className = 'space-y-3';
      
      pais.ciudades.forEach((c, index) => {
        const btn = document.createElement('button');
        btn.className = 'w-full bg-slate-800 border border-slate-700 p-4 rounded-xl text-left hover:bg-slate-700 transition-all flex justify-between items-center active:scale-98 shadow-sm';
        btn.onclick = () => showDetalleCiudadView(pais, index);
        btn.innerHTML = `
          <div>
            <h3 class="font-bold text-base text-white">${c.nombre}</h3>
            <p class="text-xs text-blue-400 font-medium mt-0.5">${c.fechas}</p>
          </div>
          <span class="text-slate-400 text-lg">➔</span>
        `;
        ciudadesSection.appendChild(btn);
      });
      container.appendChild(ciudadesSection);

      // Bloques de Servicios (Consulado, Farmacias, Lavanderías)
      const divider = document.createElement('hr');
      divider.className = 'border-slate-800 my-4';
      container.appendChild(divider);

      const serviciosBlock = document.createElement('div');
      serviciosBlock.className = 'grid grid-cols-1 gap-2';
      serviciosBlock.innerHTML = `
        <a href="${pais.servicios.consulados}" target="_blank" class="bg-slate-800/80 border border-slate-700/60 p-3 rounded-xl flex items-center justify-between text-xs text-slate-200">
          <span class="flex items-center gap-2">🏛️ Consulado / Comisaría</span>
          <span class="text-blue-400 font-medium">Maps ➔</span>
        </a>
        <a href="${pais.servicios.farmacias}" target="_blank" class="bg-slate-800/80 border border-slate-700/60 p-3 rounded-xl flex items-center justify-between text-xs text-slate-200">
          <span class="flex items-center gap-2">⚕️ Farmacias cercanas</span>
          <span class="text-blue-400 font-medium">Maps ➔</span>
        </a>
        <a href="${pais.servicios.lavanderias}" target="_blank" class="bg-slate-800/80 border border-slate-700/60 p-3 rounded-xl flex items-center justify-between text-xs text-slate-200">
          <span class="flex items-center gap-2">🧺 Lavanderías</span>
          <span class="text-blue-400 font-medium">Maps ➔</span>
        </a>
      `;
      container.appendChild(serviciosBlock);
    });
}

// Nivel 3: Vista de Detalle de Ciudad
function showDetalleCiudadView(pais, ciudadIndex) {
  const ciudad = pais.ciudades[ciudadIndex];
  currentViewState = { level: 'detalle', paisId: pais.id };
  updateHeader(ciudad.nombre, true);

  const container = document.getElementById('app');
  container.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4 space-y-4 shadow-md text-slate-100">
      
      <!-- Hotel y Fechas -->
      <div>
        <span class="text-xs font-semibold text-blue-400 bg-blue-950/60 border border-blue-800/50 px-2.5 py-1 rounded-full">${ciudad.fechas}</span>
        <h2 class="text-lg font-bold mt-2 text-white">🏨 ${ciudad.hotel}</h2>
        
        <!-- Acciones del Hotel -->
        <div class="flex gap-2 mt-2">
          ${ciudad.mapaHotelLink ? `
            <a href="${ciudad.mapaHotelLink}" target="_blank" class="bg-slate-700 hover:bg-slate-600 text-white text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-all">
              📍 Ubicación
            </a>` : ''}
          ${ciudad.hotelUrl ? `
            <a href="${ciudad.hotelUrl}" target="_blank" class="bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-all">
              🏨 Booking
            </a>` : ''}
        </div>
      </div>

      <!-- Cómo Llegar -->
      <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-700/50 space-y-1">
        <h4 class="text-xs font-bold text-slate-300">🚌 ¿Cómo llego al hotel?</h4>
        <p class="text-xs text-slate-400 leading-relaxed">${ciudad.comoLlegar}</p>
      </div>

      <!-- Actividades -->
      <div class="space-y-2">
        <h4 class="text-xs font-bold text-slate-300">🚶 Actividades</h4>
        <div class="space-y-1.5">
          ${ciudad.actividades.map(act => `
            <div class="bg-slate-900/40 p-2.5 rounded-xl border border-slate-700/30 flex justify-between items-center text-xs">
              <span class="text-slate-300">${act.nombre}</span>${act.mapa ? `
                <a href="${act.mapa}" target="_blank" class="text-blue-400 font-medium hover:underline text-[11px] flex items-center gap-1 bg-slate-800 px-2 py-1 rounded-md border border-slate-700">
                  📍 Maps
                </a>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Gastronomía -->
      <div class="space-y-2">
        <h4 class="text-xs font-bold text-slate-300">🍽️ Gastronomía</h4>
        <div class="space-y-1.5">
          ${ciudad.gastronomia.map(g => `
            <div class="bg-slate-900/40 p-2.5 rounded-xl border border-slate-700/30 flex justify-between items-center text-xs">
              <span class="text-slate-300">${g.nombre}</span>${g.mapa ? `
                <a href="${g.mapa}" target="_blank" class="text-blue-400 font-medium hover:underline text-[11px] flex items-center gap-1 bg-slate-800 px-2 py-1 rounded-md border border-slate-700">
                  📍 Maps
                </a>` : ''}
            </div>
          `).join('')}
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
  document.getElementById('headerTitle').innerText = title;
  const btn = document.getElementById('btnBack');
  if (showBackBtn) btn.classList.remove('hidden');
  else btn.classList.add('hidden');
}