import { ApiError } from './errors.js';

const countries = {
  AE: { dial: '971', national: /^05\d{8}$/, mobile: /^5\d{8}$/ },
  SA: { dial: '966', national: /^05\d{8}$/, mobile: /^5\d{8}$/ },
  BH: { dial: '973', national: /^3\d{7}$/, mobile: /^3\d{7}$/ },
} as const;

export type Country = keyof typeof countries;

export function parseCountry(value: unknown): Country {
  if (value !== 'AE' && value !== 'SA' && value !== 'BH') {
    throw new ApiError(422, 'VALIDATION', 'country must be AE, SA or BH');
  }
  return value;
}

export function normalizePhone(
  value: unknown,
  country: Country | undefined,
  purpose: 'create' | 'lookup',
): string {
  if (typeof value !== 'string') {
    throw new ApiError(422, 'VALIDATION', 'phone must be a string');
  }

  const phone = value.replace(/[ ()-]/g, '');
  const invalidPhone = () => new ApiError(422, 'INVALID_PHONE', 'phone must be a supported mobile number');
  if (!/^\+?\d+$/.test(phone)) throw invalidPhone();

  const digits = phone.startsWith('+') ? phone.slice(1) : phone;
  for (const [phoneCountry, rules] of Object.entries(countries)) {
    if (digits.startsWith(rules.dial) && rules.mobile.test(digits.slice(rules.dial.length))) {
      if (purpose === 'lookup' && country !== undefined && country !== phoneCountry) {
        throw new ApiError(422, 'PHONE_COUNTRY_MISMATCH', 'country disagrees with the phone dial code');
      }
      return `+${digits}`;
    }
  }

  if (!phone.startsWith('+')) {
    if (country !== undefined && countries[country].national.test(phone)) {
      const mobile = country === 'BH' ? phone : phone.slice(1);
      return `+${countries[country].dial}${mobile}`;
    }
    if (country === undefined && Object.values(countries).some((rules) => rules.national.test(phone))) {
      throw new ApiError(422, 'PHONE_NEEDS_COUNTRY', 'National phones require a country');
    }
  }
  throw invalidPhone();
}
