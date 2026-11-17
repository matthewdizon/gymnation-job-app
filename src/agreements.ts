import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Agreement } from './billing.js';
import { calculateInvoiceSchedule } from './billing.js';
import { parseDate } from './dates.js';
import { ApiError } from './errors.js';
import type { createMemberStore } from './members.js';
import type { createPlanStore } from './plans.js';
import { parseId, parseInteger, parseObject } from './validation.js';

export function createAgreementStore() {
  const agreements = new Map<string, Agreement>();
  return {
    create(input: Omit<Agreement, 'id'>): Agreement {
      const agreement = { id: randomUUID(), ...input };
      agreements.set(agreement.id, agreement);
      return agreement;
    },
    findById(id: string): Agreement | undefined { return agreements.get(id); },
    all(): IterableIterator<Agreement> { return agreements.values(); },
  };
}

export function registerAgreementRoutes(
  app: FastifyInstance,
  agreements: ReturnType<typeof createAgreementStore>,
  members: ReturnType<typeof createMemberStore>,
  plans: ReturnType<typeof createPlanStore>,
) {
  app.post('/agreements', async (request, reply) => {
    const body = parseObject(request.body);
    const member_id = parseId(body.member_id, 'member_id');
    const plan_id = parseId(body.plan_id, 'plan_id');
    parseDate(body.start_date, 'start_date');
    const start_date = body.start_date as string;
    const due_day = parseInteger(body.due_day, 'due_day', 1, 31);
    const member = members.findById(member_id);
    if (member === undefined) throw new ApiError(422, 'UNKNOWN_MEMBER', 'Member not found');
    const plan = plans.findById(plan_id);
    if (plan === undefined) throw new ApiError(422, 'UNKNOWN_PLAN', 'Plan not found');
    if (member.country !== plan.country) throw new ApiError(422, 'PLAN_COUNTRY_MISMATCH', 'Plan country must match member country');
    return reply.code(201).send(agreements.create({ member_id, plan_id, start_date, due_day }));
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>('/agreements/:id/invoices', async (request) => {
    const agreement = agreements.findById(request.params.id);
    if (agreement === undefined) throw new ApiError(404, 'NOT_FOUND', 'Agreement not found');
    const from = parseDate(request.query.from, 'from');
    const to = parseDate(request.query.to, 'to');
    if (to < from || to - from > 366) throw new ApiError(422, 'INVALID_RANGE', 'Range must be ordered and at most 366 days apart');
    return calculateInvoiceSchedule(agreement, plans.findById(agreement.plan_id)!, from, to);
  });
}
