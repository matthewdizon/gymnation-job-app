import { ApiError } from './errors.js';

const DAY_MS = 86_400_000;

export function dayInMonth(monthIndex: number, day: number): number {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const end = new Date(0);
  end.setUTCFullYear(year, month + 1, 0);
  const date = new Date(0);
  date.setUTCFullYear(year, month, Math.min(day, end.getUTCDate()));
  return date.getTime() / DAY_MS;
}

export function monthOf(day: number): number {
  const date = new Date(day * DAY_MS);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function formatDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function parseDate(value: unknown, field: string): number {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const result = dayInMonth(year * 12 + month - 1, day);
      if (formatDate(result) === value) return result;
    }
  }
  throw new ApiError(422, 'VALIDATION', `${field} must be a valid YYYY-MM-DD date`);
}
