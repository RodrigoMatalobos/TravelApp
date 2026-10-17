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
import { mergeCountryCatalog } from './country-catalog.mjs';
import {
  buildItinerarySnapshot,
  diffDocuments,
  INITIAL_COUNTRY_IDS
} from './itinerary-sync.mjs';

const COUNTRY_IMAGES = {
  finland: 'img/finland.jpg',
  sweden: 'img/sweden.jpg',
  belgium: 'img/belgium.jpg',
  germany: 'img/germany.jpg',
  spain: 'img/spain.jpg',
  czech: 'img/czech.jpg'
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
  const storedCountries = snapshot.docs.map(country => ({ id: country.id, ...country.data() }));
  return mergeCountryCatalog(storedCountries, COUNTRY_IMAGES);
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
  return orderedBy(snapshot.docs.map(stop => ({ id: stop.id, ...stop.data() })))
    .filter(stop => Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude)));
}

function documentsFrom(snapshot) {
  return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
}

async function loadCountryCollectionsForSync(countryId) {
  const [citySnapshot, serviceSnapshot] = await Promise.all([
    getDocs(collection(db, 'countries', countryId, 'cities')),
    getDocs(collection(db, 'countries', countryId, 'additionalData'))
  ]);
  const activityGroups = await Promise.all(citySnapshot.docs.map(async cityDocument => {
    const activitySnapshot = await getDocs(collection(db, 'countries', countryId, 'cities', cityDocument.id, 'activities'));
    return activitySnapshot.docs.map(activity => ({
      id: activity.id,
      key: `${countryId}/${cityDocument.id}/${activity.id}`,
      countryId,
      cityId: cityDocument.id,
      data: activity.data()
    }));
  }));

  return {
    cities: citySnapshot.docs.map(city => ({ id: city.id, countryId, data: city.data() })),
    activities: activityGroups.flat(),
    services: serviceSnapshot.docs.map(service => ({ id: service.id, countryId, data: service.data() }))
  };
}

function addDiffOperations(operations, existingDocs, desiredDocs, refFor) {
  const { upserts, deletes } = diffDocuments(existingDocs, desiredDocs);
  upserts.forEach(item => operations.push({ type: 'set', ref: refFor(item), data: item.data }));
  deletes.forEach(item => operations.push({ type: 'delete', ref: refFor(item) }));
}

async function commitWriteOperations(operations) {
  const chunkSize = 400;
  for (let start = 0; start < operations.length; start += chunkSize) {
    const batch = writeBatch(db);
    operations.slice(start, start + chunkSize).forEach(operation => {
      if (operation.type === 'delete') batch.delete(operation.ref);
      else batch.set(operation.ref, operation.data);
    });
    await batch.commit();
  }
}

async function syncItineraryData({ countries = {}, route = {} }) {
  const desired = buildItinerarySnapshot({ countries, route, countryImages: COUNTRY_IMAGES });
  const [countrySnapshot, routeSnapshot] = await Promise.all([
    getDocs(collection(db, 'countries')),
    getDocs(collection(db, 'routeStops'))
  ]);
  const existingCountries = documentsFrom(countrySnapshot);
  const existingCountryIds = new Set(existingCountries.map(country => country.id));
  const targetCountryIds = new Set(desired.countries.map(country => country.id));
  const legacyCountryIds = desired.legacyCountryIds.filter(countryId => existingCountryIds.has(countryId));
  const countryIdsToInspect = [...targetCountryIds, ...legacyCountryIds];
  const existingCountryData = new Map(await Promise.all(countryIdsToInspect.map(async countryId => [
    countryId,
    await loadCountryCollectionsForSync(countryId)
  ])));
  const operations = [];

  addDiffOperations(
    operations,
    existingCountries.filter(country => targetCountryIds.has(country.id)),
    desired.countries,
    country => doc(db, 'countries', country.id)
  );

  desired.countries.forEach(country => {
    const countryId = country.id;
    const existing = existingCountryData.get(countryId) || { cities: [], activities: [], services: [] };
    addDiffOperations(
      operations,
      existing.cities,
      desired.cities.filter(city => city.countryId === countryId),
      city => doc(db, 'countries', countryId, 'cities', city.id)
    );
    addDiffOperations(
      operations,
      existing.activities,
      desired.activities.filter(activity => activity.countryId === countryId),
      activity => doc(db, 'countries', countryId, 'cities', activity.cityId, 'activities', activity.id)
    );
    addDiffOperations(
      operations,
      existing.services,
      desired.services.filter(service => service.countryId === countryId),
      service => doc(db, 'countries', countryId, 'additionalData', service.id)
    );
  });

  legacyCountryIds.forEach(countryId => {
    const existing = existingCountryData.get(countryId);
    operations.push({ type: 'delete', ref: doc(db, 'countries', countryId) });
    existing.cities.forEach(city => operations.push({
      type: 'delete',
      ref: doc(db, 'countries', countryId, 'cities', city.id)
    }));
    existing.activities.forEach(activity => operations.push({
      type: 'delete',
      ref: doc(db, 'countries', countryId, 'cities', activity.cityId, 'activities', activity.id)
    }));
    existing.services.forEach(service => operations.push({
      type: 'delete',
      ref: doc(db, 'countries', countryId, 'additionalData', service.id)
    }));
  });

  addDiffOperations(
    operations,
    documentsFrom(routeSnapshot),
    desired.routeStops,
    stop => doc(db, 'routeStops', stop.id)
  );

  await commitWriteOperations(operations);
  return {
    writeCount: operations.length,
    countries: desired.countries.map(country => country.id),
    routeStops: desired.routeStops.length
  };
}

async function seedInitialData(options) {
  return syncItineraryData(options);
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
  syncItineraryData,
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