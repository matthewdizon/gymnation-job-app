import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ApiError } from './errors.js';
import { normalizePhone, parseCountry } from './phones.js';
import type { Country } from './phones.js';

export interface Member {
  id: string;
  name: string;
  country: Country;
  phone: string;
}

export function createMemberStore() {
  const membersById = new Map<string, Member>();
  const memberIdsByPhone = new Map<string, string>();

  return {
    create(input: Omit<Member, 'id'>): Member {
      // Keep this check and both writes synchronous: requests cannot interleave here.
      const existingId = memberIdsByPhone.get(input.phone);
      if (existingId !== undefined) {
        throw new ApiError(409, 'PHONE_TAKEN', 'Phone already belongs to a member', {
          existing_member_id: existingId,
        });
      }
      const member = { id: randomUUID(), ...input };
      membersById.set(member.id, member);
      memberIdsByPhone.set(member.phone, member.id);
      return member;
    },
    findById(id: string): Member | undefined {
      return membersById.get(id);
    },
    findByPhone(phone: string): Member | undefined {
      const id = memberIdsByPhone.get(phone);
      return id === undefined ? undefined : membersById.get(id);
    },
  };
}

export function registerMemberRoutes(app: FastifyInstance, store: ReturnType<typeof createMemberStore>) {
  app.post<{ Body: Record<string, unknown> }>('/members', async (request, reply) => {
    const body = request.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError(422, 'VALIDATION', 'body must be an object');
    }
    if (typeof body.name !== 'string') {
      throw new ApiError(422, 'VALIDATION', 'name must be a string');
    }
    const name = body.name.trim();
    if ([...name].length < 1 || [...name].length > 120) {
      throw new ApiError(422, 'VALIDATION', 'name must contain 1 to 120 characters');
    }
    const country = parseCountry(body.country);
    const phone = normalizePhone(body.phone, country, 'create');
    return reply.code(201).send(store.create({ name, country, phone }));
  });

  app.get<{ Querystring: Record<string, unknown> }>('/members/lookup', async (request) => {
    const { phone, country: countryValue } = request.query;
    const country = countryValue === undefined ? undefined : parseCountry(countryValue);
    const normalized = normalizePhone(phone, country, 'lookup');
    const member = store.findByPhone(normalized);
    if (member === undefined) {
      throw new ApiError(404, 'NOT_FOUND', 'Member not found');
    }
    return member;
  });
}
