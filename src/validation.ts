import { ApiError } from './errors.js';

export function parseObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(422, 'VALIDATION', 'body must be an object');
  }
  return value as Record<string, unknown>;
}

export function parseId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(422, 'VALIDATION', `${field} must be a non-empty string`);
  }
  return value;
}

export function parseInteger(value: unknown, field: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError(422, 'VALIDATION', `${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}
