import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { Agreement, Plan } from '../src/billing.js';
import { calculateInvoiceSchedule } from '../src/billing.js';
import { parseDate } from '../src/dates.js';

function schedule(start: string, dueDay: number, from: string, to: string, monthly = 29900, joiningFee = 0, country: Plan['country'] = 'SA') {
  const plan: Plan = { id: 'plan', country, currency: country === 'SA' ? 'SAR' : country === 'AE' ? 'AED' : 'BHD', monthly, joining_fee: joiningFee };
  const agreement: Agreement = { id: 'agreement', member_id: 'member', plan_id: plan.id, start_date: start, due_day: dueDay };
  return calculateInvoiceSchedule(agreement, plan, parseDate(from, 'from'), parseDate(to, 'to'));
}

test('worked examples round proration and VAT and charge joining fees only once', () => {
  assert.deepEqual(schedule('2026-09-20', 1, '2026-09-01', '2026-10-31'), [
    { invoice_no: 1, due_date: '2026-09-20', kind: 'FIRST', proration: { days: 11, cycle_days: 30 }, net: 10963, vat: 1644, total: 12607, currency: 'SAR' },
    { invoice_no: 2, due_date: '2026-10-01', kind: 'MONTHLY', proration: null, net: 29900, vat: 4485, total: 34385, currency: 'SAR' },
  ]);
  assert.deepEqual(schedule('2026-09-05', 20, '2026-09-01', '2026-09-30', 24900, 9900, 'AE'), [
    { invoice_no: 1, due_date: '2026-09-05', kind: 'FIRST', proration: { days: 15, cycle_days: 31 }, net: 21948, vat: 1097, total: 23045, currency: 'AED' },
    { invoice_no: 2, due_date: '2026-09-20', kind: 'MONTHLY', proration: null, net: 24900, vat: 1245, total: 26145, currency: 'AED' },
  ]);
});

test('due-day anchors survive clamping, leap years, and year boundaries', () => {
  const invoices = schedule('2028-01-31', 31, '2028-01-31', '2028-05-31');
  assert.deepEqual(invoices.map((i) => i.due_date), ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31']);
  assert.deepEqual(invoices[0]!.proration, { days: 29, cycle_days: 29 });
  assert.equal(invoices[0]!.net, 29900);
  assert.deepEqual(schedule('2026-12-31', 31, '2026-12-31', '2027-03-31').map((i) => i.due_date), ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  assert.deepEqual(schedule('2027-02-28', 31, '2027-02-28', '2027-02-28')[0]!.proration, { days: 31, cycle_days: 31 });
  assert.deepEqual(schedule('2027-02-27', 31, '2027-02-27', '2027-02-27')[0]!.proration, { days: 1, cycle_days: 28 });
});

test('rounding is half up in minor units, including BHD and large exact products', () => {
  const half = schedule('2026-09-16', 1, '2026-09-16', '2026-09-16', 1, 9, 'AE')[0]!;
  assert.deepEqual({ net: half.net, vat: half.vat, total: half.total }, { net: 10, vat: 1, total: 11 });
  const bhd = schedule('2026-09-01', 1, '2026-09-01', '2026-09-01', 5790, 0, 'BH')[0]!;
  assert.deepEqual({ net: bhd.net, vat: bhd.vat, total: bhd.total, currency: bhd.currency }, { net: 5790, vat: 579, total: 6369, currency: 'BHD' });
  const zero = schedule('2026-09-30', 1, '2026-09-30', '2026-09-30', 1)[0]!;
  assert.equal(zero.total, 0);
  const large = schedule('2026-09-20', 1, '2026-09-20', '2026-09-20', 1000000000000001)[0]!;
  assert.equal(large.net, 366666666666667);
  assert.equal(large.vat, 55000000000000);
  assert.throws(() => schedule('2026-09-01', 1, '2026-09-01', '2026-09-01', Number.MAX_SAFE_INTEGER), /supported integer range/);
});

test('inclusive filters keep lifetime numbering, empty ranges, and distant schedules', () => {
  assert.deepEqual(schedule('2026-09-20', 1, '2026-01-01', '2026-09-19'), []);
  assert.deepEqual(schedule('2026-09-20', 1, '2026-10-02', '2026-10-31'), []);
  assert.equal(schedule('2026-09-20', 1, '2026-12-01', '2026-12-01')[0]!.invoice_no, 4);
  assert.equal(schedule('0001-01-01', 1, '9999-12-01', '9999-12-01')[0]!.invoice_no, 119988);
  assert.deepEqual(schedule('9999-12-31', 31, '9999-12-31', '9999-12-31')[0]!.proration, { days: 31, cycle_days: 31 });
});

test('real calendar dates are required without timezones or automatic overflow', () => {
  for (const value of ['2026-02-29', '2100-02-29', '2026-04-31', '0000-01-01', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-9-01', '2026-09-01T00:00:00Z', ' 2026-09-01', null, 20260901]) {
    assert.throws(() => parseDate(value, 'date'), /valid YYYY-MM-DD/);
  }
  for (const value of ['0001-01-01', '0099-12-31', '2000-02-29', '2028-02-29', '9999-12-31']) {
    assert.equal(Number.isInteger(parseDate(value, 'date')), true);
  }
});

test('all due-day anchors across leap and ordinary years keep chronological schedules and filter invariance', () => {
  for (const year of [2027, 2028]) {
    for (let due = 1; due <= 31; due++) {
      const all = schedule(`${year}-01-15`, due, `${year}-01-01`, `${year}-12-31`);
      for (let index = 1; index < all.length; index++) {
        assert.ok(all[index]!.due_date > all[index - 1]!.due_date);
        assert.equal(all[index]!.invoice_no, all[index - 1]!.invoice_no + 1);
      }
      assert.deepEqual(schedule(`${year}-01-15`, due, `${year}-06-01`, `${year}-08-31`), all.filter((i) => i.due_date >= `${year}-06-01` && i.due_date <= `${year}-08-31`));
    }
  }
});

test('Part 2 API creates plans and multiple agreements and returns computed invoices', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const member = (await app.inject({ method: 'POST', url: '/members', payload: { name: 'Noura', country: 'SA', phone: '0551234567' } })).json();
  const plan = await app.inject({ method: 'POST', url: '/plans', payload: { id: 'anytime-sa', country: 'SA', monthly: 29900, joining_fee: 0 } });
  assert.equal(plan.statusCode, 201);
  assert.deepEqual(plan.json(), { id: 'anytime-sa', country: 'SA', currency: 'SAR', monthly: 29900, joining_fee: 0 });
  const payload = { member_id: member.id, plan_id: 'anytime-sa', start_date: '2026-09-20', due_day: 1 };
  const agreements = await Promise.all(Array.from({ length: 2 }, () => app.inject({ method: 'POST', url: '/agreements', payload })));
  const ids = agreements.map((response) => {
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), { id: response.json().id, ...payload });
    return response.json().id;
  });
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) {
    const url = `/agreements/${id}/invoices?from=2026-09-01&to=2026-12-31`;
    const response = await app.inject({ url });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), schedule('2026-09-20', 1, '2026-09-01', '2026-12-31'));
    assert.deepEqual((await app.inject({ url })).json(), response.json());
    for (const [range, status, code] of [
      ['from=2026-01-01&to=2027-01-02', 200, undefined],
      ['from=2026-01-01&to=2027-01-03', 422, 'INVALID_RANGE'],
      ['from=2026-09-02&to=2026-09-01', 422, 'INVALID_RANGE'],
      ['', 422, 'VALIDATION'], ['from=2026-09-01', 422, 'VALIDATION'],
      ['from=2026-02-30&to=2026-09-01', 422, 'VALIDATION'],
      ['from=2026-09-01&from=2026-09-01&to=2026-09-30', 422, 'VALIDATION'],
    ] as const) {
      const result = await app.inject({ url: `/agreements/${id}/invoices?${range}` });
      assert.equal(result.statusCode, status);
      if (code) assert.equal(result.json().error.code, code);
    }
  }
  const missing = await app.inject({ url: '/agreements/missing/invoices?from=2026-09-01&to=2026-09-30' });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'NOT_FOUND');
});

test('plans validate inputs, derive all currencies, and keep app-scoped concurrency-safe uniqueness', async (t) => {
  const app = buildApp();
  const fresh = buildApp();
  t.after(() => Promise.all([app.close(), fresh.close()]));
  const valid = { id: 'test', country: 'SA', monthly: 29900, joining_fee: 0 };
  const payloads = [null, [], 'text', {},
    ...[undefined, null, '', ' ', 1].map((id) => ({ ...valid, id })),
    ...[undefined, null, 'US', 'sa'].map((country) => ({ ...valid, country })),
    ...[undefined, null, '29900', 0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((monthly) => ({ ...valid, monthly })),
    ...[undefined, null, '0', -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((joining_fee) => ({ ...valid, joining_fee })),
  ];
  for (const payload of payloads) {
    const response = await app.inject({ method: 'POST', url: '/plans', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, 'VALIDATION');
  }
  const responses = await Promise.all(Array.from({ length: 40 }, () => app.inject({ method: 'POST', url: '/plans', payload: valid })));
  assert.equal(responses.filter((r) => r.statusCode === 201).length, 1);
  for (const response of responses.filter((r) => r.statusCode !== 201)) {
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'PLAN_EXISTS');
  }
  assert.equal((await fresh.inject({ method: 'POST', url: '/plans', payload: valid })).statusCode, 201);
  for (const [country, currency] of [['AE', 'AED'], ['BH', 'BHD']]) {
    const response = await app.inject({ method: 'POST', url: '/plans', payload: { ...valid, id: country, country } });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().currency, currency);
  }
});

test('agreements validate fields and references against the member country, including foreign SIMs', async (t) => {
  const app = buildApp();
  const fresh = buildApp();
  t.after(() => Promise.all([app.close(), fresh.close()]));
  const member = (await app.inject({ method: 'POST', url: '/members', payload: { name: 'Foreign SIM', country: 'AE', phone: '+966551234567' } })).json();
  for (const country of ['AE', 'SA']) await app.inject({ method: 'POST', url: '/plans', payload: { id: country, country, monthly: 100, joining_fee: 0 } });
  const valid = { member_id: member.id, plan_id: 'AE', start_date: '2026-09-01', due_day: 31 };
  for (const payload of [null, [], {},
    ...[undefined, null, 7, ''].map((member_id) => ({ ...valid, member_id })),
    ...[undefined, null, 7, ''].map((plan_id) => ({ ...valid, plan_id })),
    ...[undefined, null, '2026-02-29', '2026-9-01'].map((start_date) => ({ ...valid, start_date })),
    ...[undefined, null, '1', 0, 32, 1.5].map((due_day) => ({ ...valid, due_day })),
  ]) {
    const response = await app.inject({ method: 'POST', url: '/agreements', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, 'VALIDATION');
  }
  for (const [payload, code] of [
    [{ ...valid, member_id: 'missing' }, 'UNKNOWN_MEMBER'],
    [{ ...valid, plan_id: 'missing' }, 'UNKNOWN_PLAN'],
    [{ ...valid, plan_id: 'SA' }, 'PLAN_COUNTRY_MISMATCH'],
  ] as const) {
    const response = await app.inject({ method: 'POST', url: '/agreements', payload });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, code);
  }
  const created = await app.inject({ method: 'POST', url: '/agreements', payload: valid });
  assert.equal(created.statusCode, 201);
  const missing = await fresh.inject({ url: `/agreements/${created.json().id}/invoices?from=2026-09-01&to=2026-09-30` });
  assert.equal(missing.statusCode, 404);
});
