import type { Country } from './phones.js';
import { dayInMonth, formatDate, monthOf, parseDate } from './dates.js';
import { ApiError } from './errors.js';

export const billingCountries = {
  AE: { currency: 'AED', vatPercent: 5 },
  SA: { currency: 'SAR', vatPercent: 15 },
  BH: { currency: 'BHD', vatPercent: 10 },
} as const;

export interface Plan {
  id: string;
  country: Country;
  currency: typeof billingCountries[Country]['currency'];
  monthly: number;
  joining_fee: number;
}

export interface Agreement {
  id: string;
  member_id: string;
  plan_id: string;
  start_date: string;
  due_day: number;
}

export interface Invoice {
  invoice_no: number;
  due_date: string;
  kind: 'FIRST' | 'MONTHLY';
  proration: { days: number; cycle_days: number } | null;
  net: number;
  vat: number;
  total: number;
  currency: Plan['currency'];
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

function safeMoney(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ApiError(422, 'VALIDATION', 'Calculated invoice exceeds the supported integer range');
  }
  return Number(value);
}

export function calculateInvoiceSchedule(agreement: Agreement, plan: Plan, from: number, to: number): Invoice[] {
  const start = parseDate(agreement.start_date, 'start_date');
  const startMonth = monthOf(start);
  const nextMonth = dayInMonth(startMonth, agreement.due_day) > start ? startMonth : startMonth + 1;
  const next = dayInMonth(nextMonth, agreement.due_day);
  const previous = dayInMonth(nextMonth - 1, agreement.due_day);
  const invoices: Invoice[] = [];

  function invoice(invoiceNo: number, dueDate: number, proration: Invoice['proration']): Invoice {
    // Round proration before adding the joining fee, then round VAT on that net.
    const net = proration === null ? BigInt(plan.monthly)
      : roundHalfUp(BigInt(plan.monthly) * BigInt(proration.days), BigInt(proration.cycle_days)) + BigInt(plan.joining_fee);
    const vat = roundHalfUp(net * BigInt(billingCountries[plan.country].vatPercent), 100n);
    return {
      invoice_no: invoiceNo, due_date: formatDate(dueDate), kind: proration === null ? 'MONTHLY' : 'FIRST',
      proration, net: safeMoney(net), vat: safeMoney(vat), total: safeMoney(net + vat), currency: plan.currency,
    };
  }

  if (start >= from && start <= to) {
    invoices.push(invoice(1, start, { days: next - start, cycle_days: next - previous }));
  }
  // Jump to the requested month instead of walking from the agreement's start.
  for (let month = Math.max(nextMonth, monthOf(from)); month <= monthOf(to); month++) {
    const due = dayInMonth(month, agreement.due_day);
    if (due >= from && due <= to) invoices.push(invoice(month - nextMonth + 2, due, null));
  }
  return invoices;
}
