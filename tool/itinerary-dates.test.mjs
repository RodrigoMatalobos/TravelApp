import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDateLabel } from '../frontend/itinerary-dates.mjs';

test('convierte el día del itinerario en una fecha aproximada desde el inicio de la estancia', () => {
  assert.equal(activityDateLabel('30/11/2026 – 08/12/2026', 1), '30 de noviembre');
  assert.equal(activityDateLabel('30/11/2026 – 08/12/2026', 8), '7 de diciembre');
  assert.equal(activityDateLabel('03/01/2027 – 06/01/2027', 2), '4 de enero');
});

test('marca los días flexibles y no inventa fechas cuando la estancia no es válida', () => {
  assert.equal(activityDateLabel('30/11/2026 – 08/12/2026', 0), 'Fecha flexible');
  assert.equal(activityDateLabel('31/02/2027 – 04/03/2027', 1), 'Fecha a confirmar');
  assert.equal(activityDateLabel('', 1), 'Fecha a confirmar');
});
