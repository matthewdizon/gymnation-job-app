import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

async function fixture(app: FastifyInstance, options: {
  country?: 'SA' | 'AE' | 'BH'; monthly?: number; joining_fee?: number; start_date?: string; due_day?: number;
} = {}) {
  const country = options.country ?? 'SA';
  const phone = country === 'BH' ? '31234567' : '0551234567';
  const created = await app.inject({ method: 'POST', url: '/members', payload: { name: 'Member', country, phone } });
  const member = created.statusCode === 201 ? created.json() : (await app.inject({ url: `/members/lookup?phone=${phone}&country=${country}` })).json();
  const plan_id = `plan-${Math.random()}`;
  assert.equal((await app.inject({ method: 'POST', url: '/plans', payload: {
    id: plan_id, country, monthly: options.monthly ?? 29900, joining_fee: options.joining_fee ?? 0,
  } })).statusCode, 201);
  const agreement = await app.inject({ method: 'POST', url: '/agreements', payload: {
    member_id: member.id, plan_id, start_date: options.start_date ?? '2026-09-20', due_day: options.due_day ?? 1,
  } });
  assert.equal(agreement.statusCode, 201);
  return agreement.json().id as string;
}

function row(agreement_id: string, gateway_txn_id = 'txn', overrides: Record<string, unknown> = {}) {
  return { gateway_txn_id, agreement_id, amount: 34385, currency: 'SAR', status: 'SETTLED', attempted_on: '2026-10-01', ...overrides };
}

function post(app: FastifyInstance, rows: unknown[], month = '2026-10') {
  return app.inject({ method: 'POST', url: '/reconciliation/runs', payload: { month, rows } });
}

const zeros = { MATCHED: 0, DUE_DAY_DRIFT: 0, DOUBLE_CHARGE_RISK: 0, MISSING_FROM_LEDGER: 0, DECLINED: 0 };

test('Part 3 returns all verdicts, request order, invoice references and summary zeros', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const matched = await fixture(app);
  const drift = await fixture(app);
  const doubled = await fixture(app);
  const declined = await fixture(app, { country: 'BH', monthly: 24500 });
  const response = await post(app, [row(matched, 'match'), row(drift, 'drift', { attempted_on: '2026-10-31' }),
    row(doubled, 'double1'), row('unknown', 'missing'),
    row(declined, 'declined', { status: 'DECLINED', currency: 'BHD', amount: 26950 }),
    row(doubled, 'double2', { attempted_on: '2026-10-02' })]);
  assert.equal(response.statusCode, 201);
  const run = response.json();
  assert.equal(typeof run.id, 'string');
  assert.equal(run.month, '2026-10');
  assert.deepEqual(run.summary, { MATCHED: 1, DUE_DAY_DRIFT: 1, DOUBLE_CHARGE_RISK: 2, MISSING_FROM_LEDGER: 1, DECLINED: 1 });
  assert.deepEqual(run.rows, [
    { gateway_txn_id: 'match', verdict: 'MATCHED', invoice: { agreement_id: matched, invoice_no: 2 } },
    { gateway_txn_id: 'drift', verdict: 'DUE_DAY_DRIFT', invoice: { agreement_id: drift, invoice_no: 2 } },
    { gateway_txn_id: 'double1', verdict: 'DOUBLE_CHARGE_RISK', invoice: { agreement_id: doubled, invoice_no: 2 } },
    { gateway_txn_id: 'missing', verdict: 'MISSING_FROM_LEDGER', invoice: null },
    { gateway_txn_id: 'declined', verdict: 'DECLINED', invoice: null },
    { gateway_txn_id: 'double2', verdict: 'DOUBLE_CHARGE_RISK', invoice: { agreement_id: doubled, invoice_no: 2 } },
  ]);
  assert.deepEqual(run.unmatched_invoices, [{ agreement_id: declined, invoice_no: 2, due_date: '2026-10-01', total: 26950, currency: 'BHD' }]);
  const onlyMatch = (await post(app, [row(matched)])).json();
  assert.deepEqual(onlyMatch.summary, { ...zeros, MATCHED: 1 });
});

test('candidate selection uses earliest due date even when later invoice is closer or still unlinked', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  // FIRST totals 20; MONTHLY totals 21. Both rows must choose FIRST, even for an exact later match.
  const two = await fixture(app, { country: 'AE', monthly: 20, start_date: '2026-10-01', due_day: 31 });
  const rows = [row(two, 'one', { currency: 'AED', amount: 21, attempted_on: '2026-10-31' }),
    row(two, 'two', { currency: 'AED', amount: 20, attempted_on: '2026-10-01' })];
  const first = (await post(app, rows)).json();
  assert.deepEqual(first.rows.map((r: { verdict: string; invoice: unknown }) => ({ verdict: r.verdict, invoice: r.invoice })), [
    { verdict: 'DOUBLE_CHARGE_RISK', invoice: { agreement_id: two, invoice_no: 1 } },
    { verdict: 'DOUBLE_CHARGE_RISK', invoice: { agreement_id: two, invoice_no: 1 } },
  ]);
  assert.ok(first.unmatched_invoices.some((i: { agreement_id: string; invoice_no: number }) => i.agreement_id === two && i.invoice_no === 2));
  const reversed = (await post(app, [...rows].reverse())).json();
  assert.deepEqual(reversed.rows, [...first.rows].reverse());
  assert.deepEqual(reversed.summary, first.summary);
  assert.deepEqual(reversed.unmatched_invoices, first.unmatched_invoices);
});

test('amount tolerance is inclusive at one unit, excludes two units, and never crosses agreements or months', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const id = await fixture(app);
  const future = await fixture(app, { start_date: '2026-11-01' });
  for (const amount of [34384, 34385, 34386]) {
    const response = await post(app, [row(id, 'txn', { amount })]);
    assert.equal(response.json().rows[0].verdict, 'MATCHED');
  }
  for (const amount of [34383, 34387, 12607, Number.MAX_SAFE_INTEGER]) {
    assert.equal((await post(app, [row(id, 'txn', { amount })])).json().rows[0].verdict, 'MISSING_FROM_LEDGER');
  }
  for (const agreement of [future, 'unknown']) {
    assert.equal((await post(app, [row(agreement)])).json().rows[0].verdict, 'MISSING_FROM_LEDGER');
  }
});

test('declined rows never link or inflate double-charge counts, including unknown agreements', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const id = await fixture(app);
  const result = (await post(app, [row(id, 'settled'), row(id, 'declined', { status: 'DECLINED' }), row('unknown', 'unknown', { status: 'DECLINED' })])).json();
  assert.deepEqual(result.summary, { ...zeros, MATCHED: 1, DECLINED: 2 });
  assert.deepEqual(result.rows.map((r: { verdict: string }) => r.verdict), ['MATCHED', 'DECLINED', 'DECLINED']);
  assert.deepEqual(result.unmatched_invoices, []);
  assert.equal((await post(app, [row(id, 'declined', { status: 'DECLINED' })])).json().unmatched_invoices.length, 1);
});

test('empty runs include every expected invoice sorted by date, agreement and lifetime number', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  assert.deepEqual((await post(app, [])).json().summary, zeros);
  const ids = [await fixture(app), await fixture(app), await fixture(app, { start_date: '2026-10-05', due_day: 20, country: 'AE', monthly: 24900, joining_fee: 9900 }),
    await fixture(app, { start_date: '2026-11-01' })];
  const expected = [];
  for (const id of ids) {
    const invoices = (await app.inject({ url: `/agreements/${id}/invoices?from=2026-10-01&to=2026-10-31` })).json();
    for (const invoice of invoices) expected.push({ agreement_id: id, invoice_no: invoice.invoice_no, due_date: invoice.due_date, total: invoice.total, currency: invoice.currency });
  }
  expected.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.agreement_id.localeCompare(b.agreement_id) || a.invoice_no - b.invoice_no);
  const run = (await post(app, [])).json();
  assert.deepEqual(run.rows, []);
  assert.deepEqual(run.summary, zeros);
  assert.deepEqual(run.unmatched_invoices, expected);
  assert.equal(expected.length, 4);
});

test('business validation aggregates every offending row and code, including declined rows', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const id = await fixture(app);
  const response = await post(app, [row(id, 'dup', { currency: 'AED', attempted_on: '2026-09-30', status: 'DECLINED' }),
    row('unknown', 'dup', { currency: 'BHD', attempted_on: '2026-11-01' }), row(id, 'wrong', { currency: 'BHD' })]);
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, 'INVALID_ROWS');
  assert.equal(typeof response.json().error.message, 'string');
  assert.deepEqual(response.json().error.errors, [
    { gateway_txn_id: 'dup', code: 'DUPLICATE_TXN' }, { gateway_txn_id: 'dup', code: 'ROW_OUTSIDE_MONTH' },
    { gateway_txn_id: 'dup', code: 'CURRENCY_MISMATCH' }, { gateway_txn_id: 'dup', code: 'DUPLICATE_TXN' },
    { gateway_txn_id: 'dup', code: 'ROW_OUTSIDE_MONTH' }, { gateway_txn_id: 'wrong', code: 'CURRENCY_MISMATCH' },
  ]);
  assert.equal((await post(app, [row('unknown', 'valid', { currency: 'BHD' })])).statusCode, 201);
});

test('malformed request and row fields return VALIDATION before business checks', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const valid = row('unknown');
  const invalidRows: unknown[] = [null, [], 1, 'row', {},
    ...['gateway_txn_id', 'agreement_id'].flatMap((field) => [undefined, null, '', ' ', 1].map((v) => ({ ...valid, [field]: v }))),
    ...[undefined, null, '1', 0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((amount) => ({ ...valid, amount })),
    ...[undefined, null, 'USD', 'sar', 1].map((currency) => ({ ...valid, currency })),
    ...[undefined, null, 'settled', 'PENDING', 1].map((status) => ({ ...valid, status })),
    ...[undefined, null, '2026-02-29', '2026-10-32', '2026-10-01T00:00:00Z', '2026-1-01', 1].map((attempted_on) => ({ ...valid, attempted_on })),
  ];
  const payloads: unknown[] = [null, [], 1, {},
    ...[undefined, null, 202610, '', '2026-1', '2026-00', '2026-13', '0000-01', '10000-01', '2026-10-01'].map((month) => ({ month, rows: [] })),
    ...[undefined, null, {}, 'rows', 1].map((rows) => ({ month: '2026-10', rows })),
    ...invalidRows.map((r) => ({ month: '2026-10', rows: [r] })),
    { month: '2026-10', rows: [row('unknown', 'dup'), row('unknown', 'dup'), { ...valid, amount: 0 }] },
  ];
  for (const payload of payloads) {
    const response = await app.inject({ method: 'POST', url: '/reconciliation/runs', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
    assert.equal(response.statusCode, 422, JSON.stringify(payload));
    assert.equal(response.json().error.code, 'VALIDATION', JSON.stringify(payload));
  }
});

test('calendar month boundaries include clamped leap dates, first invoices, and supported year extremes', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const leap = await fixture(app, { start_date: '2028-01-31', due_day: 31 });
  assert.equal((await post(app, [row(leap, 'leap', { attempted_on: '2028-02-29' })], '2028-02')).json().rows[0].verdict, 'MATCHED');
  assert.equal((await post(app, [row(leap, 'outside', { attempted_on: '2028-03-01' })], '2028-02')).json().error.code, 'INVALID_ROWS');
  const first = await fixture(app, { start_date: '2026-09-20' });
  const run = (await post(app, [row(first, 'first', { attempted_on: '2026-09-20', amount: 12607 })], '2026-09')).json();
  assert.equal(run.rows[0].invoice.invoice_no, 1);
  for (const [month, start_date, due_day] of [['0001-01', '0001-01-01', 1], ['9999-12', '9999-12-31', 31]] as const) {
    const id = await fixture(app, { start_date, due_day });
    const response = await post(app, [row(id, month, { attempted_on: start_date })], month);
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().rows[0].verdict, 'MATCHED');
  }
});

test('saved runs are fixed snapshots, repeat transactions are allowed across concurrent runs, and stores are isolated', async (t) => {
  const app = buildApp();
  const fresh = buildApp();
  t.after(() => Promise.all([app.close(), fresh.close()]));
  const id = await fixture(app);
  const beforeInvoices = (await app.inject({ url: `/agreements/${id}/invoices?from=2026-10-01&to=2026-10-31` })).json();
  const responses = await Promise.all(Array.from({ length: 20 }, () => post(app, [row(id)])));
  const ids = new Set<string>();
  for (const response of responses) {
    assert.equal(response.statusCode, 201);
    const run = response.json();
    ids.add(run.id);
    assert.deepEqual(run.summary, { ...zeros, MATCHED: 1 });
    const saved = await app.inject({ url: `/reconciliation/runs/${run.id}` });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.json(), run);
  }
  assert.equal(ids.size, 20);
  const original = responses[0]!.json();
  await fixture(app);
  assert.deepEqual((await app.inject({ url: `/reconciliation/runs/${original.id}` })).json(), original);
  assert.deepEqual((await app.inject({ url: `/agreements/${id}/invoices?from=2026-10-01&to=2026-10-31` })).json(), beforeInvoices);
  for (const [instance, runId] of [[app, 'unknown'], [fresh, original.id]] as const) {
    const response = await instance.inject({ url: `/reconciliation/runs/${runId}` });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, 'NOT_FOUND');
  }
});

test('reconciliation reuses BHD minor-unit VAT and allows a positive one-unit payment against a zero-total invoice', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const bhd = await fixture(app, { country: 'BH', monthly: 5790, start_date: '2026-10-01' });
  const zero = await fixture(app, { monthly: 1, start_date: '2026-10-31' });
  const response = await post(app, [row(bhd, 'bhd', { amount: 6369, currency: 'BHD' }),
    row(zero, 'zero', { amount: 1, attempted_on: '2026-10-31' })]);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json().summary, { ...zeros, MATCHED: 2 });
  assert.deepEqual(response.json().unmatched_invoices, []);
});
