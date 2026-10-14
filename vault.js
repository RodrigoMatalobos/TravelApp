(function () {
  'use strict';

  const TABS = ['Valija', 'Compras', 'Gastos'];
  const TAB_LABELS = { Valija: 'Valija', Compras: 'Compras', Gastos: 'Gastos' };
  const DISPLAY_FIELDS = {
    Valija: [
      ['nombre', 'Artículo'],
      ['cantidad', 'Cantidad'],
      ['nota', 'Nota'],
      ['asignado_a', 'Para']
    ],
    Compras: [
      ['nombre', 'Qué comprar'],
      ['cantidad', 'Cantidad'],
      ['nota', 'Nota'],
      ['asignado_a', 'Para']
    ],
    Gastos: [
      ['descripcion', 'Gasto'],
      ['fecha', 'Fecha'],
      ['categoria', 'Categoría'],
      ['moneda', 'Moneda'],
      ['pagado_por', 'Pagó'],
      ['participantes', 'Se divide entre']
    ]
  };
  const ACTOR_KEY = 'travelapp.vault.actor.v1';
  let viewState = null;

  function escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `vault-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function emptyState() {
    return {
      container: null,
      tab: 'Valija',
      records: { Valija: [], Compras: [], Gastos: [] },
      baselines: {},
      conflicts: [],
      actor: window.TravelFirebase.auth.currentUser?.displayName || window.TravelFirebase.auth.currentUser?.email || '',
      authorized: Boolean(window.TravelFirebase.auth.currentUser),
      dirty: false,
      busy: false,
      status: '',
      statusKind: 'info'
    };
  }

  function setStatus(message, kind = 'info') {
    viewState.status = message;
    viewState.statusKind = kind;
  }

  function parseRecord(tab, record) {
    if (tab === 'Valija' || tab === 'Compras') {
      return { ...record, cantidad: record.cantidad || '1' };
    }
    return {
      ...record,
      importe_minor_units: record.importe_minor_units || '0',
      moneda: record.moneda || 'EUR',
      participantes: record.participantes || ''
    };
  }

  async function loadCurrentTab() {
    viewState.busy = true;
    const tab = viewState.tab;
    setStatus(`Descargando ${tab}…`);
    draw();

    try {
      const records = await window.TravelFirestore.loadVaultRecords(tab);
      viewState.baselines[tab] = new Map(records.map(record => [record.id, { ...record }]));
      viewState.records[tab] = records.map(parseRecord.bind(null, tab));
      viewState.conflicts = viewState.conflicts.filter(conflict => conflict.tab !== tab);
      viewState.dirty = false;
      viewState.lastSync = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setStatus(`${tab} actualizado desde Firestore ${viewState.lastSync}.`, 'success');
    } catch (error) {
      setStatus(error.message || `No se pudo descargar ${tab}.`, 'error');
    } finally {
      viewState.busy = false;
      draw();
    }
  }

  async function saveAll() {
    if (!viewState.authorized) {
      setStatus('Iniciá sesión con una cuenta habilitada.', 'error');
      draw();
      return;
    }

    viewState.busy = true;
    setStatus('Revisando cambios compartidos antes de guardar en Firebase…');
    draw();

    try {
      const tab = viewState.tab;
      const result = await window.TravelFirestore.saveVaultRecords(
        tab,
        viewState.records[tab],
        viewState.baselines[tab] || new Map(),
        window.TravelFirebase.auth.currentUser
      );

      if (result.conflicts.length) {
        viewState.conflicts = result.conflicts.map(conflict => ({ ...conflict, tab }));
        setStatus('Otra persona cambió algunas de estas filas. Elegí qué versión conservar antes de guardar.', 'warning');
        return;
      }

      await loadCurrentTab();
      viewState.dirty = false;
      setStatus(result.saved ? 'Cambios guardados y listas actualizadas.' : 'No había cambios pendientes.', 'success');
    } catch (error) {
      setStatus(error.message || 'No se pudieron guardar los cambios.', 'error');
    } finally {
      viewState.busy = false;
      draw();
    }
  }

  function resolveConflict(conflictIndex, choice) {
    const conflict = viewState.conflicts[conflictIndex];
    if (!conflict) return;
    const tab = conflict.tab;
    const localIndex = viewState.records[tab].findIndex(record => record.id === conflict.id);
    const remoteRecord = conflict.remoteRecord;

    if (choice === 'remote') {
      if (localIndex >= 0) {
        if (remoteRecord) viewState.records[tab][localIndex] = { ...remoteRecord };
        else viewState.records[tab].splice(localIndex, 1);
      } else if (remoteRecord) {
        viewState.records[tab].push({ ...remoteRecord });
      }
    }

    const baseline = viewState.baselines[tab] || new Map();
    if (remoteRecord) baseline.set(conflict.id, { ...remoteRecord });
    else baseline.delete(conflict.id);
    viewState.baselines[tab] = baseline;
    viewState.conflicts.splice(conflictIndex, 1);
    viewState.dirty = true;
    setStatus(viewState.conflicts.length
      ? 'Resolvé los demás conflictos para continuar.'
      : 'Conflictos resueltos. Revisá los listados y tocá Guardar nuevamente.', 'warning');
    draw();
  }

  function formatExpense(record) {
    const minorUnits = Number(record.importe_minor_units || 0);
    const currency = record.moneda || 'EUR';
    try {
      return new Intl.NumberFormat('es', { style: 'currency', currency }).format(minorUnits / 100);
    } catch {
      return `${(minorUnits / 100).toFixed(2)} ${currency}`;
    }
  }

  function renderListRows(tab) {
    const records = viewState.records[tab].filter(record => record.estado !== 'archivado' && record.estado !== 'anulado');
    if (!records.length) {
      return '<p class="py-8 text-center text-sm text-slate-400">Todavía no hay elementos en este listado.</p>';
    }

    return records.map(record => {
      const done = tab === 'Valija' ? record.estado === 'listo' : tab === 'Compras' ? record.estado === 'comprado' : false;
      const title = tab === 'Gastos' ? record.descripcion : record.nombre;
      const meta = tab === 'Gastos'
        ? `${formatExpense(record)} · ${escapeHtml(record.pagado_por || 'Sin pagador')} · ${escapeHtml(record.fecha || '')}`
        : `${escapeHtml(record.cantidad || '1')} ${escapeHtml(record.nota || '')} ${record.asignado_a ? `· ${escapeHtml(record.asignado_a)}` : ''}`;
      const checkControl = tab === 'Gastos' ? '' : `
        <input type="checkbox" data-action="toggle" data-id="${escapeHtml(record.id)}" ${done ? 'checked' : ''} class="mt-1 h-4 w-4 accent-emerald-500" aria-label="Marcar como ${tab === 'Valija' ? 'listo' : 'comprado'}">`;
      return `
        <li class="flex items-start gap-3 border-b border-slate-700/70 py-3 last:border-0">
          ${checkControl}
          <div class="min-w-0 flex-1">
            <p class="break-words text-sm font-medium ${done ? 'text-slate-500 line-through' : 'text-slate-100'}">${escapeHtml(title || 'Sin descripción')}</p>
            <p class="mt-1 break-words text-xs text-slate-400">${meta}</p>
          </div>
          <button type="button" data-action="archive" data-id="${escapeHtml(record.id)}" class="shrink-0 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Archivar">Archivar</button>
        </li>
      `;
    }).join('');
  }

  function renderConflict(conflict, index) {
    return `
      <li class="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3">
        <p class="text-sm font-semibold text-amber-100">${escapeHtml(conflict.localRecord.nombre || conflict.localRecord.descripcion || conflict.id)}</p>
        <p class="mt-1 text-xs text-amber-100/75">Otra persona guardó una versión distinta en Firebase. Elegí cuál conservar:</p>
        <div class="mt-3 flex gap-2">
          <button type="button" data-conflict="mine" data-index="${index}" class="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-950">Conservar mi versión</button>
          <button type="button" data-conflict="remote" data-index="${index}" class="rounded-md border border-amber-100/40 px-3 py-1.5 text-xs font-semibold text-amber-50">Usar la compartida</button>
        </div>
      </li>
    `;
  }

  function renderForm(tab) {
    if (tab === 'Gastos') {
      return `
        <form id="vault-add-form" class="grid grid-cols-2 gap-2">
          <label class="col-span-2 text-xs text-slate-300">Descripción<input name="descripcion" required maxlength="120" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"></label>
          <label class="text-xs text-slate-300">Importe<input name="importe" required inputmode="decimal" type="number" min="0.01" step="0.01" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"></label>
          <label class="text-xs text-slate-300">Moneda<input name="moneda" required value="EUR" maxlength="3" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm uppercase text-white"></label>
          <label class="text-xs text-slate-300">Fecha<input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"></label>
          <label class="text-xs text-slate-300">Categoría<input name="categoria" maxlength="40" placeholder="Transporte, comida…" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"></label>
          <label class="col-span-2 text-xs text-slate-300">Pagó<input name="pagado_por" required value="${escapeHtml(viewState.actor)}" maxlength="60" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"></label>
          <label class="col-span-2 text-xs text-slate-300">Participantes (separados por coma)<input name="participantes" placeholder="Los tres" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"></label>
          <button class="col-span-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500" type="submit">Agregar gasto</button>
        </form>
      `;
    }

    return `
      <form id="vault-add-form" class="grid grid-cols-2 gap-2">
        <label class="col-span-2 text-xs text-slate-300">${tab === 'Valija' ? 'Qué hay que llevar' : 'Qué hay que comprar'}<input name="nombre" required maxlength="120" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"></label>
        <label class="text-xs text-slate-300">Cantidad<input name="cantidad" type="number" min="1" step="1" value="1" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"></label>
        <label class="text-xs text-slate-300">Para<input name="asignado_a" maxlength="60" placeholder="Opcional" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"></label>
        <label class="col-span-2 text-xs text-slate-300">Nota<input name="nota" maxlength="200" placeholder="Opcional" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"></label>
        <button class="col-span-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500" type="submit">Agregar a ${tab === 'Valija' ? 'la valija' : 'compras'}</button>
      </form>
    `;
  }

  function draw() {
    const { container } = viewState;
    if (!container) return;
    const active = Boolean(viewState.authorized);
    const statusClass = viewState.statusKind === 'error'
      ? 'border-red-500/40 bg-red-950/40 text-red-100'
      : viewState.statusKind === 'success'
        ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-100'
        : viewState.statusKind === 'warning'
          ? 'border-amber-500/40 bg-amber-950/40 text-amber-100'
          : 'border-slate-600 bg-slate-800/80 text-slate-200';

    container.innerHTML = `
      <div class="mx-auto max-w-xl space-y-4">
        <section class="border-b border-slate-700 pb-4">
          <p class="text-[10px] font-bold uppercase tracking-[.16em] text-emerald-400">Espacio compartido</p>
          <h2 class="mt-1 text-xl font-semibold text-white">Vault del viaje</h2>
          <p class="mt-1 text-sm text-slate-400">Listas compartidas en Firestore para las cuentas habilitadas.</p>
        </section>

        <label class="block text-xs text-slate-300">Tu nombre para identificar cambios
          <input id="vault-actor" value="${escapeHtml(viewState.actor)}" maxlength="60" placeholder="Tu nombre" class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-white">
        </label>

        <div class="flex flex-wrap gap-2">
          ${active ? '<button id="vault-refresh" type="button" class="rounded-lg border border-slate-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Actualizar</button>' : ''}
        </div>

        ${viewState.status ? `<p class="rounded-lg border p-3 text-sm ${statusClass}" role="status">${escapeHtml(viewState.status)}</p>` : ''}

        ${active ? `
          <section class="space-y-4">
            <div class="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
              <h3 class="mb-3 text-sm font-semibold text-white">Agregar a ${viewState.tab}</h3>
              ${renderForm(viewState.tab)}
            </div>

            ${viewState.conflicts.length ? `
              <section class="space-y-2" aria-live="assertive">
                <h3 class="text-sm font-semibold text-amber-100">Cambios simultáneos</h3>
                <ul class="space-y-2">${viewState.conflicts.map(renderConflict).join('')}</ul>
              </section>` : ''}

            <section class="rounded-lg border border-slate-700 bg-slate-800/60 px-4">
              <div class="flex items-center justify-between border-b border-slate-700 py-3">
                <h3 class="text-sm font-semibold text-white">${viewState.tab}</h3>
                <button id="vault-save" type="button" ${viewState.busy || viewState.conflicts.length ? 'disabled' : ''} class="rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">Guardar</button>
              </div>
              <ul class="divide-y divide-slate-700/70">${renderListRows(viewState.tab)}</ul>
            </section>
            <p class="text-center text-[11px] text-slate-500">Los cambios se comparten al guardar. Última descarga: ${escapeHtml(viewState.lastSync || 'todavía no sincronizado')}.</p>
          </section>` : ''}
      </div>
    `;

    bindControls();
  }

  function bindControls() {
    const actorInput = viewState.container.querySelector('#vault-actor');
    actorInput?.addEventListener('change', () => {
      viewState.actor = actorInput.value.trim();
      localStorage.setItem(ACTOR_KEY, viewState.actor);
    });

    viewState.container.querySelector('#vault-refresh')?.addEventListener('click', async () => {
      if (viewState.dirty && !window.confirm('Actualizar reemplaza los cambios locales no guardados. ¿Continuar?')) return;
      await loadCurrentTab();
    });
    viewState.container.querySelector('#vault-save')?.addEventListener('click', saveAll);

    viewState.container.querySelector('#vault-add-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const now = new Date().toISOString();
      let record;
      if (viewState.tab === 'Gastos') {
        const amount = Math.round(Number(formData.get('importe')) * 100);
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          setStatus('Ingresá un importe mayor a cero.', 'error');
          draw();
          return;
        }
        record = {
          id: createId(),
          fecha: String(formData.get('fecha') || ''),
          descripcion: String(formData.get('descripcion') || '').trim(),
          categoria: String(formData.get('categoria') || '').trim(),
          importe_minor_units: String(amount),
          moneda: String(formData.get('moneda') || 'EUR').trim().toUpperCase(),
          pagado_por: String(formData.get('pagado_por') || viewState.actor).trim(),
          participantes: JSON.stringify(String(formData.get('participantes') || '').split(',').map(name => name.trim()).filter(Boolean)),
          estado: 'activo',
          created_at: now,
          updated_at: now,
          updated_by: ''
        };
      } else {
        record = {
          id: createId(),
          nombre: String(formData.get('nombre') || '').trim(),
          cantidad: String(Math.max(1, Number(formData.get('cantidad') || 1))),
          nota: String(formData.get('nota') || '').trim(),
          estado: 'pendiente',
          asignado_a: String(formData.get('asignado_a') || '').trim(),
          created_at: now,
          updated_at: now,
          updated_by: ''
        };
      }
      viewState.records[viewState.tab].push(record);
      viewState.dirty = true;
      setStatus('Elemento agregado localmente. Tocá Guardar para compartirlo.', 'success');
      draw();
    });

    viewState.container.querySelectorAll('[data-action="toggle"]').forEach(input => {
      input.addEventListener('change', () => {
        const record = viewState.records[viewState.tab].find(item => item.id === input.dataset.id);
        if (!record) return;
        record.estado = input.checked ? (viewState.tab === 'Valija' ? 'listo' : 'comprado') : 'pendiente';
        viewState.dirty = true;
        draw();
      });
    });
    viewState.container.querySelectorAll('[data-action="archive"]').forEach(button => {
      button.addEventListener('click', () => {
        const record = viewState.records[viewState.tab].find(item => item.id === button.dataset.id);
        if (!record) return;
        record.estado = viewState.tab === 'Gastos' ? 'anulado' : 'archivado';
        viewState.dirty = true;
        draw();
      });
    });

    viewState.container.querySelectorAll('[data-conflict]').forEach(button => {
      button.addEventListener('click', () => resolveConflict(Number(button.dataset.index), button.dataset.conflict));
    });
  }

  function render(container, tab = 'Valija', onEnabled = () => {}) {
    viewState = emptyState();
    viewState.container = container;
    viewState.tab = TABS.includes(tab) ? tab : 'Valija';
    viewState.onEnabled = onEnabled;
    viewState.authorized = Boolean(window.TravelFirebase.auth.currentUser);
    viewState.lastSync = '';
    draw();
    if (viewState.authorized) loadCurrentTab();
  }

  window.TravelVault = Object.freeze({ render });
})();
