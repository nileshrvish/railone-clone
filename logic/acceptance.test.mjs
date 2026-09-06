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
import {
  computeTotal, computeTicketTotal, classMinimum, viaDisplay, fareLine, validTillISO,
  journeyValidityNote, isSeasonType, passDurationLabel, pricedPassBands,
  parseManualFare, withManualFare,
} from './fare.js';

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
  assert.equal(viaDisplay(q.via, q.routeCount), '------'); // direct: no routing points to qualify

  // Valid till 23:59 the following day.
  const bookedDate = new Date(2026, 7, 14, 9, 52); // 14 Aug 2026, local
  const validIso = validTillISO({ ticketType: 'return', bookedDate, quote: q });
  assert.equal(validIso, '2026-08-15');

  // The footer carries that date, rather than a fixed one.
  assert.equal(
    journeyValidityNote({ ticketType: 'return', validTillIso: validIso }),
    'Valid for one ret. jrny. till midnight of 15/08/2026'
  );
});

test('2b. validity footer switches wording with the ticket type', () => {
  const q = rail.quote('AWL', 'TNA', { ticketType: 'single', cls: 'SECOND' });

  const singleIso = validTillISO({ ticketType: 'single', bookedDate: new Date(2026, 7, 14), quote: q });
  assert.equal(
    journeyValidityNote({ ticketType: 'single', validTillIso: singleIso }),
    '*Valid for start of journey within 1 hour or until departure of the first train.'
  );

  // A return booked a day later carries that later date, not a hardcoded one.
  const laterIso = validTillISO({ ticketType: 'return', bookedDate: new Date(2026, 11, 31), quote: q });
  assert.equal(
    journeyValidityNote({ ticketType: 'return', validTillIso: laterIso }),
    'Valid for one ret. jrny. till midnight of 01/01/2027'
  );

  // Season passes print their validity in the rows above, not in the footer.
  assert.equal(journeyValidityNote({ ticketType: 'season_monthly', validTillIso: '2026-09-09' }), null);
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

// ---------------------------------------------------------------- season passes

const PASS_TYPES = ['season_monthly', 'season_quarterly', 'season_half_yearly', 'season_yearly'];

test('8. every pass type prices off the published MST row, per its own multiplier', () => {
  // BUD -> CSMT is 68 km, the one slab with a sourced MST figure (Rs.315).
  const mst = rail.quote('BUD', 'CSMT', { ticketType: 'season_monthly', cls: 'SECOND' });
  assert.equal(mst.fareInr, 315);
  assert.match(mst.fareBasis, /published MST table/);

  const rules = data.fare_rules.ticket_types;
  for (const type of PASS_TYPES.slice(1)) {
    const q = rail.quote('BUD', 'CSMT', { ticketType: type, cls: 'SECOND' });
    // fare_rules says N x MST rounded to the nearest Rs.5 — assert that exact rule.
    const expected = Math.round(315 * rules[type].multiplier_of_mst / 5) * 5;
    assert.equal(q.fareInr, expected, `${type} should be ${expected}`);
    assert.equal(q.fareAvailable, true);
  }

  // Concretely: 2.7x, 5.4x and 10.8x of Rs.315.
  assert.equal(rail.quote('BUD', 'CSMT', { ticketType: 'season_quarterly' }).fareInr, 850);
  assert.equal(rail.quote('BUD', 'CSMT', { ticketType: 'season_half_yearly' }).fareInr, 1700);
  assert.equal(rail.quote('BUD', 'CSMT', { ticketType: 'season_yearly' }).fareInr, 3400);
});

test('9. pass validity is valid_from + N months - 1 day, for each duration', () => {
  const start = '2026-08-10';
  const expected = {
    season_monthly: '2026-09-09',      // the worked example in fare_rules
    season_quarterly: '2026-11-09',
    season_half_yearly: '2027-02-09',
    season_yearly: '2027-08-09',
  };
  for (const type of PASS_TYPES) {
    const q = rail.quote('BUD', 'CSMT', { ticketType: type, cls: 'SECOND', startDate: start });
    assert.equal(q.validFrom, start);
    assert.equal(q.validTill, expected[type], `${type} validity`);
    assert.equal(validTillISO({ ticketType: type, bookedDate: new Date(), quote: q }), expected[type]);
  }

  // Month-end start dates clamp instead of overflowing into the next month.
  assert.equal(rail.quote('BUD', 'CSMT', { ticketType: 'season_monthly', startDate: '2026-01-31' }).validTill, '2026-02-27');
  assert.equal(rail.quote('BUD', 'CSMT', { ticketType: 'season_yearly', startDate: '2028-02-29' }).validTill, '2029-02-27');
});

test('10. a pass is one document for one holder: passenger counts never multiply it', () => {
  const q = rail.quote('BUD', 'CSMT', { ticketType: 'season_quarterly', cls: 'SECOND', startDate: '2026-08-10' });
  const classMin = classMinimum(data.fare_rules, 'SECOND');

  for (const [adults, children] of [[1, 0], [4, 3], [6, 6]]) {
    assert.equal(
      computeTicketTotal({ ticketType: 'season_quarterly', fareInr: q.fareInr, adults, children, classMin }),
      850, `pass total must stay the pass fare for ${adults}A/${children}C`
    );
  }

  // Journey tickets are unchanged — still per head.
  const single = rail.quote('AWL', 'TNA', { ticketType: 'single', cls: 'SECOND' });
  assert.equal(
    computeTicketTotal({ ticketType: 'single', fareInr: single.fareInr, adults: 2, children: 1, classMin }),
    computeTotal(single.fareInr, 2, 1, classMin)
  );
  assert.equal(isSeasonType('single'), false);
  assert.equal(isSeasonType('season_half_yearly'), true);
  assert.equal(passDurationLabel('season_monthly'), '1 month');
  assert.equal(passDurationLabel('season_half_yearly'), '6 months');
});

test('11. an unpriced pass stays honestly unpriced rather than being invented', () => {
  // Airoli -> Thane is 6 km: the slab has no MST figure, and none is guessed.
  const q = rail.quote('AWL', 'TNA', { ticketType: 'season_monthly', cls: 'SECOND', startDate: '2026-08-10' });
  assert.equal(q.fareAvailable, false);
  assert.equal(q.fareInr, null);
  // Validity is still computed — only the price is missing.
  assert.equal(q.validTill, '2026-09-09');

  // First class has no sourced MST row at all, in any slab.
  assert.equal(rail.quote('BUD', 'CSMT', { ticketType: 'season_monthly', cls: 'FIRST' }).fareInr, null);
  assert.deepEqual(pricedPassBands(data.fare_rules, 'FIRST'), []);

  // Second class is priced for exactly the band the data actually sources.
  assert.deepEqual(pricedPassBands(data.fare_rules, 'SECOND'), ['66\u201370 km']);
});

test('12. a manually entered fare overrides the table, and says that it did', () => {
  assert.deepEqual(parseManualFare(''), { fare: null, error: null });        // blank = use the table
  assert.deepEqual(parseManualFare('  '), { fare: null, error: null });
  assert.equal(parseManualFare('850').fare, 850);
  assert.equal(parseManualFare('12.50').fare, 12.5);
  for (const bad of ['abc', '0', '-5', '1000000']) {
    const parsed = parseManualFare(bad);
    assert.equal(parsed.fare, null, `${bad} must not parse to a fare`);
    assert.ok(parsed.error, `${bad} must explain itself`);
  }

  // Airoli -> Thane has no MST row; a typed fare makes the pass bookable.
  const unpriced = rail.quote('AWL', 'TNA', { ticketType: 'season_monthly', cls: 'SECOND', startDate: '2026-08-10' });
  assert.equal(unpriced.fareAvailable, false);

  const overridden = withManualFare(unpriced, 275);
  assert.equal(overridden.fareInr, 275);
  assert.equal(overridden.fareAvailable, true);
  assert.equal(overridden.manualFare, true);
  assert.match(overridden.fareBasis, /manually entered/);
  assert.equal(unpriced.fareInr, null, 'the original quote must not be mutated');
  assert.equal(unpriced.validTill, overridden.validTill, 'route and validity still come from the engine');

  // The override replaces the per-ticket fare, so each type treats it as before.
  const classMin = classMinimum(data.fare_rules, 'SECOND');
  assert.equal(
    computeTicketTotal({ ticketType: 'season_monthly', fareInr: overridden.fareInr, adults: 1, children: 0, classMin }),
    275, 'a pass total is the pass fare'
  );
  assert.equal(
    computeTicketTotal({ ticketType: 'single', fareInr: 30, adults: 2, children: 1, classMin }),
    75, 'a journey ticket still multiplies over passengers (2x30 + 1x15)'
  );

  // Blank box, and no-route results, leave the quote exactly as it was.
  assert.equal(withManualFare(unpriced, null), unpriced);
  const noRoute = { error: 'NO_ROUTE' };
  assert.equal(withManualFare(noRoute, 500), noRoute);
});

test('13. Via carries the number of genuinely distinct routes, then the route', () => {
  // The real Badlapur-CSMT ticket names one route; the one-station wobbles
  // Yen's algorithm turns up are the same corridor, not alternatives.
  const bud = rail.quote('BUD', 'CSMT');
  assert.equal(bud.routeCount, 1);
  assert.equal(viaDisplay(bud.via, bud.routeCount), '1RT>>KYN-TNA-CLA-DR-SNRD');

  // Thane to Vashi really is two: Trans-Harbour, or round through Kurla.
  const options = rail.routeOptions('TNA', 'VSH');
  assert.equal(options.length, 2);
  assert.ok(options[0].km < options[1].km, 'shortest route first');
  const tnaVsh = rail.quote('TNA', 'VSH');
  assert.equal(tnaVsh.routeCount, 2);
  assert.match(viaDisplay(tnaVsh.via, tnaVsh.routeCount), /^2RT>>/);

  // The route shown is always the one the fare was quoted on.
  assert.equal(tnaVsh.chargeableKm, options[0].km);
  assert.equal(tnaVsh.via, options[0].corridor);

  // Codes, never names.
  for (const code of tnaVsh.via.split('-')) {
    assert.ok(rail.stations.has(code), `${code} should be a station code`);
  }

  // A count is never invented: no count in, no prefix out (old saved tickets).
  assert.equal(viaDisplay('KYN-TNA', undefined), 'KYN-TNA');
  assert.equal(viaDisplay('', 3), '------');   // nothing to prefix
  assert.equal(viaDisplay(null, 2), '------');
  assert.equal(viaDisplay('TUBH-SNPD', 2), '2RT>>TUBH-SNPD');

  // Every pair reports at least one route, and never more than it can justify.
  for (const [a, b] of [['AWL', 'TNA'], ['PNVL', 'CCG'], ['CSMT', 'PNVL'], ['KYN', 'CCG']]) {
    const count = rail.routeCount(a, b);
    assert.ok(count >= 1 && count <= 8, `${a}->${b} reported ${count} routes`);
    assert.equal(count, rail.routeOptions(a, b).length);
  }
});

test('14. counting routes does not disturb the fare path', () => {
  // route() with no bans must still be the same shortest path it always was.
  const withOpts = rail.route('BUD', 'CSMT', {});
  const plain = rail.route('BUD', 'CSMT');
  assert.equal(plain.km, withOpts.km);
  assert.deepEqual(plain.path.map(p => p.code), withOpts.path.map(p => p.code));
  assert.equal(rail.quote('BUD', 'CSMT', { ticketType: 'season_monthly', cls: 'SECOND' }).fareInr, 315);
  assert.equal(rail.quote('AWL', 'TNA', { ticketType: 'single', cls: 'SECOND' }).fareInr, 5);
});
