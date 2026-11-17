import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { calculateInvoiceSchedule } from './billing.js';
import type { Invoice, Plan } from './billing.js';
import type { createAgreementStore } from './agreements.js';
import type { createPlanStore } from './plans.js';
import { dayInMonth, monthOf, parseDate } from './dates.js';
import { ApiError } from './errors.js';
import { parseId, parseInteger, parseObject } from './validation.js';

interface GatewayRow {
  gateway_txn_id: string;
  agreement_id: string;
  amount: number;
  currency: Plan['currency'];
  status: 'SETTLED' | 'DECLINED';
  attempted_on: string;
}

interface ExpectedInvoice extends Pick<Invoice, 'invoice_no' | 'due_date' | 'total' | 'currency'> {
  agreement_id: string;
}

type Verdict = 'MATCHED' | 'DUE_DAY_DRIFT' | 'DOUBLE_CHARGE_RISK' | 'MISSING_FROM_LEDGER' | 'DECLINED';

interface ReconciliationRun {
  id: string;
  month: string;
  summary: Record<Verdict, number>;
  rows: {
    gateway_txn_id: string;
    verdict: Verdict;
    invoice: Pick<ExpectedInvoice, 'agreement_id' | 'invoice_no'> | null;
  }[];
  unmatched_invoices: ExpectedInvoice[];
}

export function createReconciliationStore() {
  const runs = new Map<string, ReconciliationRun>();
  return {
    save(run: ReconciliationRun): void { runs.set(run.id, run); },
    findById(id: string): ReconciliationRun | undefined { return runs.get(id); },
  };
}

function parseRow(value: unknown): GatewayRow {
  const row = parseObject(value);
  const gateway_txn_id = parseId(row.gateway_txn_id, 'gateway_txn_id');
  const agreement_id = parseId(row.agreement_id, 'agreement_id');
  const amount = parseInteger(row.amount, 'amount', 1);
  if (row.currency !== 'AED' && row.currency !== 'SAR' && row.currency !== 'BHD') {
    throw new ApiError(422, 'VALIDATION', 'currency must be AED, SAR, or BHD');
  }
  if (row.status !== 'SETTLED' && row.status !== 'DECLINED') {
    throw new ApiError(422, 'VALIDATION', 'status must be SETTLED or DECLINED');
  }
  parseDate(row.attempted_on, 'attempted_on');
  return { gateway_txn_id, agreement_id, amount, currency: row.currency, status: row.status, attempted_on: row.attempted_on as string };
}

function validateRows(
  rows: GatewayRow[], month: string,
  agreements: ReturnType<typeof createAgreementStore>, plans: ReturnType<typeof createPlanStore>,
): void {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.gateway_txn_id, (counts.get(row.gateway_txn_id) ?? 0) + 1);
  const errors: { gateway_txn_id: string; code: string }[] = [];
  for (const row of rows) {
    const add = (code: string) => errors.push({ gateway_txn_id: row.gateway_txn_id, code });
    if (counts.get(row.gateway_txn_id)! > 1) add('DUPLICATE_TXN');
    if (row.attempted_on.slice(0, 7) !== month) add('ROW_OUTSIDE_MONTH');
    const agreement = agreements.findById(row.agreement_id);
    if (agreement !== undefined && plans.findById(agreement.plan_id)!.currency !== row.currency) add('CURRENCY_MISMATCH');
  }
  if (errors.length > 0) throw new ApiError(422, 'INVALID_ROWS', 'Gateway rows failed validation', { errors });
}

function reconcile(month: string, rows: GatewayRow[], expected: ExpectedInvoice[]): ReconciliationRun {
  const byAgreement = new Map<string, ExpectedInvoice[]>();
  for (const invoice of expected) {
    const invoices = byAgreement.get(invoice.agreement_id) ?? [];
    invoices.push(invoice);
    byAgreement.set(invoice.agreement_id, invoices);
  }
  const links = rows.map((row) => row.status === 'DECLINED' ? undefined
    : byAgreement.get(row.agreement_id)?.find((invoice) => Math.abs(invoice.total - row.amount) <= 1));
  // Count every link before assigning verdicts; no row consumes a candidate.
  const counts = new Map<ExpectedInvoice, number>();
  for (const invoice of links) {
    if (invoice !== undefined) counts.set(invoice, (counts.get(invoice) ?? 0) + 1);
  }
  const summary: Record<Verdict, number> = { MATCHED: 0, DUE_DAY_DRIFT: 0, DOUBLE_CHARGE_RISK: 0, MISSING_FROM_LEDGER: 0, DECLINED: 0 };
  const results = rows.map((row, index) => {
    const invoice = links[index];
    const verdict: Verdict = row.status === 'DECLINED' ? 'DECLINED'
      : invoice === undefined ? 'MISSING_FROM_LEDGER'
      : counts.get(invoice)! > 1 ? 'DOUBLE_CHARGE_RISK'
      : row.attempted_on === invoice.due_date ? 'MATCHED' : 'DUE_DAY_DRIFT';
    summary[verdict]++;
    return { gateway_txn_id: row.gateway_txn_id, verdict,
      invoice: invoice === undefined ? null : { agreement_id: invoice.agreement_id, invoice_no: invoice.invoice_no } };
  });
  return { id: randomUUID(), month, summary, rows: results,
    unmatched_invoices: expected.filter((invoice) => !counts.has(invoice)) };
}

export function registerReconciliationRoutes(
  app: FastifyInstance,
  store: ReturnType<typeof createReconciliationStore>,
  agreements: ReturnType<typeof createAgreementStore>,
  plans: ReturnType<typeof createPlanStore>,
) {
  app.post('/reconciliation/runs', async (request, reply) => {
    const body = parseObject(request.body);
    if (typeof body.month !== 'string' || !/^\d{4}-\d{2}$/.test(body.month)) {
      throw new ApiError(422, 'VALIDATION', 'month must be a valid YYYY-MM month');
    }
    const month = body.month;
    const from = parseDate(`${month}-01`, 'month');
    const to = dayInMonth(monthOf(from), 31);
    if (!Array.isArray(body.rows)) throw new ApiError(422, 'VALIDATION', 'rows must be an array');
    const rows = body.rows.map(parseRow);
    validateRows(rows, month, agreements, plans);
    const expected: ExpectedInvoice[] = [];
    for (const agreement of agreements.all()) {
      for (const invoice of calculateInvoiceSchedule(agreement, plans.findById(agreement.plan_id)!, from, to)) {
        expected.push({ agreement_id: agreement.id, invoice_no: invoice.invoice_no,
          due_date: invoice.due_date, total: invoice.total, currency: invoice.currency });
      }
    }
    // Sorting also makes each agreement's first matching candidate its earliest invoice.
    expected.sort((a, b) => a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1
      : a.agreement_id < b.agreement_id ? -1 : a.agreement_id > b.agreement_id ? 1 : a.invoice_no - b.invoice_no);
    const run = reconcile(month, rows, expected);
    store.save(run);
    return reply.code(201).send(run);
  });

  app.get<{ Params: { id: string } }>('/reconciliation/runs/:id', async (request) => {
    const run = store.findById(request.params.id);
    if (run === undefined) throw new ApiError(404, 'NOT_FOUND', 'Reconciliation run not found');
    return run;
  });
}
