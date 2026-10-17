import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { db } from './firebase-client.js';

const INITIAL_COUNTRY_IDS = ['finland', 'sweden', 'belgium', 'germany', 'spain', 'czech'];
const COUNTRY_IMAGES = {
  finland: new URL('./img/finland.jpg', import.meta.url).href,
  sweden: new URL('./img/sweden.jpg', import.meta.url).href,
  belgium: new URL('./img/belgium.jpg', import.meta.url).href,
  germany: new URL('./img/germany.jpg', import.meta.url).href,
  spain: new URL('./img/spain.jpg', import.meta.url).href,
  czech: new URL('./img/czech.jpg', import.meta.url).href
};
const VAULT_SCHEMAS = Object.freeze({
  Valija: ['id', 'nombre', 'cantidad', 'nota', 'estado', 'asignado_a', 'created_at', 'updated_at', 'updated_by'],
  Compras: ['id', 'nombre', 'cantidad', 'nota', 'estado', 'asignado_a', 'created_at', 'updated_at', 'updated_by'],
  Gastos: ['id', 'fecha', 'descripcion', 'categoria', 'importe_minor_units', 'moneda', 'pagado_por', 'participantes', 'estado', 'created_at', 'updated_at', 'updated_by']
});

function orderedBy(data, field = 'order') {
  return data.sort((first, second) => Number(first[field] || 0) - Number(second[field] || 0));
}

async function loadCountries() {
  const snapshot = await getDocs(collection(db, 'countries'));
  return orderedBy(snapshot.docs.map(country => ({
    id: country.id,
    ...country.data(),
    bgImage: COUNTRY_IMAGES[country.id] || country.data().bgImage || ''
  })));
}

async function loadCountry(countryId) {
  const countrySnapshot = await getDoc(doc(db, 'countries', countryId));
  if (!countrySnapshot.exists()) return null;

  const [citySnapshot, serviceSnapshot] = await Promise.all([
    getDocs(collection(db, 'countries', countryId, 'cities')),
    getDocs(collection(db, 'countries', countryId, 'additionalData'))
  ]);
  const cities = await Promise.all(citySnapshot.docs.map(async cityDocument => {
    const city = { id: cityDocument.id, ...cityDocument.data() };
    const activitySnapshot = await getDocs(collection(db, 'countries', countryId, 'cities', cityDocument.id, 'activities'));
    const activities = orderedBy(activitySnapshot.docs.map(activity => activity.data()));
    return {
      ...city,
      actividades: activities.filter(activity => activity.category === 'actividad'),
      gastronomia: activities.filter(activity => activity.category === 'gastronomia')
    };
  }));
  const additionalData = orderedBy(serviceSnapshot.docs.map(service => ({ id: service.id, ...service.data() })));
  const services = Object.fromEntries(additionalData.map(data => [data.category, data.url]));

  return {
    id: countrySnapshot.id,
    ...countrySnapshot.data(),
    ciudades: orderedBy(cities),
    servicios: services,
    datosAdicionales: additionalData
  };
}

async function loadRouteStops() {
  const snapshot = await getDocs(collection(db, 'routeStops'));
  return orderedBy(snapshot.docs.map(stop => ({ id: stop.id, ...stop.data() })));
}

function mapActivity(activity, category, order) {
  const value = typeof activity === 'string' ? { nombre: activity } : activity || {};
  return {
    category,
    dia: Number.isFinite(Number(value.dia)) ? Number(value.dia) : null,
    nombre: String(value.nombre || '').trim(),
    mapa: String(value.mapa || ''),
    order
  };
}

function serviceLabel(category) {
  const labels = {
    consulados: 'Consulados',
    farmacias: 'Farmacias',
    lavanderias: 'Lavanderías',
    supermercados: 'Supermercados'
  };
  return labels[category] || category;
}

async function seedInitialData({ countries = {}, route, updateExistingCountries = [] }) {
  const countryIdsToSeed = INITIAL_COUNTRY_IDS.filter(countryId => Array.isArray(countries[countryId]?.ciudades));
  if (!countryIdsToSeed.length) {
    throw new Error('Seleccioná al menos un JSON de país y map-locations.json.');
  }
  countryIdsToSeed.forEach(countryId => {
    if (countries[countryId].id !== countryId) {
      throw new Error(`El archivo ${countryId}.json no coincide con su nombre.`);
    }
  });
  if (countries.belgium && countries.belgium.pais !== 'Bélgica') {
    throw new Error('El archivo belgium.json no contiene datos de Bélgica.');
  }

  const routeStops = (Array.isArray(route?.stops) ? route.stops : [])
    .filter(stop => countryIdsToSeed.includes(stop.countryId));
  const routeOrder = new Map(routeStops.map((stop, index) => [stop.countryId, index]));
  const countryIds = [...countryIdsToSeed].sort((first, second) =>
    (routeOrder.get(first) ?? Number.MAX_SAFE_INTEGER) - (routeOrder.get(second) ?? Number.MAX_SAFE_INTEGER));
  const updateIds = new Set(updateExistingCountries);
  const batch = writeBatch(db);
  let writeCount = 0;

  for (const countryId of countryIds) {
    const countryRef = doc(db, 'countries', countryId);
    const existingCountry = await getDoc(countryRef);
    if (existingCountry.exists() && !updateIds.has(countryId)) continue;

    const source = countries[countryId];
    batch.set(countryRef, {
      id: countryId,
      pais: source.pais || countryId,
      flag: source.flag || '',
      spotifyUrl: source.spotifyUrl || '',
      driveFolderUrl: source.driveFolderUrl || '',
      bgImage: COUNTRY_IMAGES[countryId] || '',
      order: routeOrder.get(countryId) ?? countryIds.indexOf(countryId)
    }, { merge: true });
    writeCount += 1;

    for (const [cityIndex, sourceCity] of (source.ciudades || []).entries()) {
      const cityId = `city-${String(cityIndex + 1).padStart(2, '0')}`;
      const cityRef = doc(db, 'countries', countryId, 'cities', cityId);
      const { actividades = [], gastronomia = [], ...cityFields } = sourceCity;
      batch.set(cityRef, { ...cityFields, id: cityId, order: cityIndex }, { merge: true });
      writeCount += 1;

      const activityEntries = [
        ...actividades.map(item => ['actividad', item]),
        ...gastronomia.map(item => ['gastronomia', item])
      ];
      if (existingCountry.exists()) {
        const existingActivities = await getDocs(collection(db, 'countries', countryId, 'cities', cityId, 'activities'));
        const retainedActivityIds = new Set(activityEntries.map((_, index) => `activity-${String(index + 1).padStart(3, '0')}`));
        existingActivities.docs
          .filter(activity => !retainedActivityIds.has(activity.id))
          .forEach(activity => {
            batch.delete(activity.ref);
            writeCount += 1;
          });
      }
      activityEntries.forEach(([category, activity], activityIndex) => {
        const activityRef = doc(db, 'countries', countryId, 'cities', cityId, 'activities', `activity-${String(activityIndex + 1).padStart(3, '0')}`);
        batch.set(activityRef, mapActivity(activity, category, activityIndex));
        writeCount += 1;
      });
    }

    Object.entries(source.servicios || {}).forEach(([category, url], serviceIndex) => {
      const serviceRef = doc(db, 'countries', countryId, 'additionalData', category);
      batch.set(serviceRef, {
        category,
        label: serviceLabel(category),
        url: String(url || ''),
        order: serviceIndex
      }, { merge: true });
      writeCount += 1;
    });
  }

  const existingStops = await getDocs(collection(db, 'routeStops'));
  const knownStopIds = new Set(existingStops.docs.map(stop => stop.id));
  routeStops.forEach((stop, order) => {
    if (knownStopIds.has(stop.id)) return;
    batch.set(doc(db, 'routeStops', stop.id), { ...stop, order });
    writeCount += 1;
  });

  if (writeCount) await batch.commit();
  return { writeCount, countries: countryIds };
}

async function getMember(uid) {
  const snapshot = await getDoc(doc(db, 'members', uid));
  return snapshot.exists() ? { uid: snapshot.id, ...snapshot.data() } : null;
}

async function submitAccessRequest(user) {
  const requestRef = doc(db, 'accessRequests', user.uid);
  const current = await getDoc(requestRef);
  const request = {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    status: 'pending',
    updatedAt: serverTimestamp()
  };
  if (!current.exists()) {
    request.createdAt = serverTimestamp();
    await setDoc(requestRef, request);
  } else if (current.data().status === 'pending') {
    await setDoc(requestRef, request, { merge: true });
  }
}

async function listAccessRequests() {
  const snapshot = await getDocs(collection(db, 'accessRequests'));
  return snapshot.docs.map(request => ({ uid: request.id, ...request.data() }));
}

async function listMembers() {
  const snapshot = await getDocs(collection(db, 'members'));
  return snapshot.docs.map(member => ({ uid: member.id, ...member.data() }));
}

async function setMemberAccess({ uid, email, displayName = '', enabled, role = 'member' }) {
  await setDoc(doc(db, 'members', uid), {
    uid,
    email,
    displayName,
    enabled,
    role,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function approveAccessRequest(request) {
  const existingMember = await getMember(request.uid);
  await setMemberAccess({
    uid: request.uid,
    email: request.email,
    displayName: request.displayName,
    enabled: true,
    role: existingMember?.role === 'admin' ? 'admin' : 'member'
  });
  await updateDoc(doc(db, 'accessRequests', request.uid), { status: 'approved', updatedAt: serverTimestamp() });
}

async function loadVaultRecords(tab) {
  if (!VAULT_SCHEMAS[tab]) throw new Error(`Lista desconocida: ${tab}.`);
  const snapshot = await getDocs(collection(db, tab.toLowerCase()));
  return snapshot.docs.map(record => ({ id: record.id, ...record.data() }));
}

function signature(record, fields) {
  return JSON.stringify(fields.map(field => String(record?.[field] ?? '').trim()));
}

async function saveVaultRecords(tab, records, baseline, user) {
  const schema = VAULT_SCHEMAS[tab];
  if (!schema) throw new Error(`Lista desconocida: ${tab}.`);
  const contentFields = schema.filter(field => field !== 'updated_at' && field !== 'updated_by');
  const changes = records.filter(record => {
    const original = baseline.get(record.id);
    return !original || signature(record, contentFields) !== signature(original, contentFields);
  });
  if (!changes.length) return { conflicts: [], saved: 0 };

  const conflicts = await runTransaction(db, async transaction => {
    const remotes = [];
    for (const record of changes) {
      remotes.push(await transaction.get(doc(db, tab.toLowerCase(), record.id)));
    }

    const found = changes.flatMap((record, index) => {
      const original = baseline.get(record.id);
      const remoteSnapshot = remotes[index];
      const remote = remoteSnapshot.exists() ? { id: remoteSnapshot.id, ...remoteSnapshot.data() } : null;
      const hasConflict = original
        ? !remote || signature(remote, schema) !== signature(original, schema)
        : Boolean(remote);
      return hasConflict ? [{ id: record.id, localRecord: record, remoteRecord: remote }] : [];
    });
    if (found.length) return found;

    const now = new Date().toISOString();
    changes.forEach(record => transaction.set(doc(db, tab.toLowerCase(), record.id), {
      ...record,
      updated_at: now,
      updated_by: user.displayName || user.email || 'Usuario'
    }));
    return [];
  });

  return { conflicts, saved: conflicts.length ? 0 : changes.length };
}

window.TravelFirestore = Object.freeze({
  INITIAL_COUNTRY_IDS,
  VAULT_SCHEMAS,
  loadCountries,
  loadCountry,
  loadRouteStops,
  seedInitialData,
  getMember,
  submitAccessRequest,
  listAccessRequests,
  listMembers,
  setMemberAccess,
  approveAccessRequest,
  loadVaultRecords,
  saveVaultRecords
});