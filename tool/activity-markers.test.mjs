import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityDateKey,
  activityMarkerKey,
  completeImportantActivityReminder,
  getActivityMarkers,
  getDueImportantActivities,
  toggleActivityMarker
} from '../frontend/activity-markers.mjs';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

test('activityDateKey maps itinerary day numbers and ignores flexible or invalid dates', () => {
  assert.equal(activityDateKey('30/12/2026 – 02/01/2027', 3), '2027-01-01');
  assert.equal(activityDateKey('31/02/2026', 1), null);
  assert.equal(activityDateKey('30/12/2026', null), null);
});

test('favorites stay independent while important activities create local due reminders', () => {
  const storage = createMemoryStorage();
  const key = activityMarkerKey({
    userId: 'user-1',
    countryId: 'germany',
    cityId: 'city-1',
    activityId: 'activity-1'
  });
  toggleActivityMarker(key, 'favorite', {}, storage);
  toggleActivityMarker(key, 'important', {
    title: 'Devolver camperas',
    country: 'Alemania',
    city: 'Berlín',
    date: '2026-12-30'
  }, storage);

  assert.equal(getActivityMarkers(key, storage).favorite, true);
  assert.deepEqual(getDueImportantActivities('2026-12-29', storage), []);
  assert.equal(getDueImportantActivities('2026-12-30', storage)[0].title, 'Devolver camperas');
  assert.equal(completeImportantActivityReminder(key, storage), true);
  assert.deepEqual(getDueImportantActivities('2026-12-31', storage), []);

  toggleActivityMarker(key, 'important', {}, storage);
  assert.deepEqual(getActivityMarkers(key, storage), {
    favorite: true,
    important: false,
    reminder: null
  });
});
