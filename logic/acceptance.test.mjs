/**
 * Acceptance tests taken from CLAUDE_CODE_PROMPT.md — real RailOne tickets.
 * Zero test-framework dependency: uses Node's built-in test runner.
 *
 *   npm test        (== node --test logic/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MumbaiRail } from '../mumbai-rail.js';
import { computeTotal, classMinimum, viaDisplay, fareLine, validTillISO } from './fare.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'mumbai_suburban_rail.json'), 'utf8'));
const rail = MumbaiRail.fromJSON(data);

test('1. BUD -> CSMT, season_monthly, SECOND, startDate 2026-08-10', () => {
  const q = rail.quote('BUD', 'CSMT', { ticketType: 'season_monthly', cls: 'SECOND', startDate: '2026-08-10' });
  assert.equal(q.chargeableKm, 68);
  assert.equal(q.via, 'KYN-TNA-CLA-DR-SNRD');
  assert.equal(q.fareInr, 315);
  assert.equal(q.validTill, '2026-09-09');
});

test('2. AWL -> TNA, return, SECOND', () => {
  const q = rail.quote('AWL', 'TNA', { ticketType: 'return', cls: 'SECOND' });
  assert.equal(q.chargeableKm, 6);
  assert.equal(q.fareAvailable, true);
  assert.equal(q.fareInr, 10); // 2 x Rs.5 single
  assert.equal(viaDisplay(q.via), '------'); // direct, no routing points

  // Valid till 23:59 the following day.
  const bookedDate = new Date(2026, 7, 14, 9, 52); // 14 Aug 2026, local
  const validIso = validTillISO({ ticketType: 'return', bookedDate, quote: q });
  assert.equal(validIso, '2026-08-15');
});

test('3. AWL -> TNA, single, SECOND', () => {
  assert.equal(rail.quote('AWL', 'TNA', { ticketType: 'single', cls: 'SECOND' }).fareInr, 5);
});

test('4. 2 adults + 1 child, SECOND, Airoli -> Thane single', () => {
  const q = rail.quote('AWL', 'TNA', { ticketType: 'single', cls: 'SECOND' });
  const minFare = classMinimum(data.fare_rules, 'SECOND');
  const total = computeTotal(q.fareInr, 2, 1, minFare);
  assert.equal(total, 2 * 5 + Math.max(2.5, 5)); // child fare floored at the class minimum
  assert.equal(total, 15);
});

test('5. MumbaiRail.addMonths clamps month-end overflow', () => {
  assert.equal(MumbaiRail.addMonths('2026-01-31', 1), '2026-02-27');
});

test('6. PNVL -> CCG: CIDCO surcharge + named interchanges', () => {
  const q = rail.quote('PNVL', 'CCG');
  assert.equal(q.cidcoSurcharge, true);
  // Assert on codes: display names track the UTS station list and can be
  // re-spelled (Mahim Junction -> Mahim Jn.), but the interchange itself is
  // what this test is about.
  const codes = q.interchanges.map((i) => i.at);
  assert.ok(codes.includes('VDLR'));
  assert.ok(codes.includes('MM'));
  assert.ok(q.interchanges.every((i) => i.name));
});

test('7. Unpriced slab -> fareAvailable is false and no number is shown', () => {
  // 142 km — past every line's real reach (~124km), so no single-line source
  // exists to price it from; must stay honestly unpriced.
  const q = rail.quote('VR', 'KJT');
  assert.equal(q.fareAvailable, false);
  assert.equal(q.fareInr, null);

  const line = fareLine({ cls: 'SECOND', trainType: 'ORDINARY', ticketType: 'single', total: null });
  assert.doesNotMatch(line, /₹\d/);
  assert.doesNotMatch(line, /null|NaN/i);
  assert.match(line, /Fare not available/);
});
