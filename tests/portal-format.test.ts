import test from 'node:test';
import assert from 'node:assert/strict';
import { toCashCents, CASH_MAX_CENTS } from '../src/app/portal/cash-api.ts';
import { mexicoInstant, mexicoLocal, mexicoDayRange } from '../src/app/portal/operations-api.ts';

test('caja convierte decimales sin redondear ni perder centavos', () => {
  assert.equal(toCashCents('0.01'), 1); assert.equal(toCashCents('10,30'), 1030);
  assert.equal(toCashCents('0'), 0); assert.equal(toCashCents('90000000000.00'), CASH_MAX_CENTS);
  for (const value of ['-1','1.001','1e3','1,000.00','90000000000.01','NaN','']) assert.equal(toCashCents(value), null, value);
});
test('agenda convierte horario de México independientemente de la zona del equipo', () => {
  const initial = process.env.TZ;
  try {
    for (const zone of ['Asia/Tokyo','Europe/London','America/Los_Angeles']) {
      process.env.TZ=zone;
      assert.equal(mexicoInstant('2026-09-28T09:00'), '2026-09-28T15:00:00.000Z');
      assert.equal(mexicoLocal('2026-09-28T15:00:00Z'), '2026-09-28T09:00');
    }
  } finally { if (initial===undefined) delete process.env.TZ; else process.env.TZ=initial; }
});
test('agenda rechaza fechas imposibles y conserva cambio de año y día completo', () => {
  assert.equal(mexicoInstant('2026-02-30T09:00'),null);
  assert.equal(mexicoInstant('2026-09-28T25:00'),null);
  assert.equal(mexicoDayRange('2026-02-30'),null);
  assert.deepEqual(mexicoDayRange('2026-12-31'),{from:'2026-12-31T06:00:00.000Z',to:'2027-01-01T06:00:00.000Z'});
});
