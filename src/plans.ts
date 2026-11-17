import type { FastifyInstance } from 'fastify';
import { billingCountries } from './billing.js';
import type { Plan } from './billing.js';
import { ApiError } from './errors.js';
import { parseCountry } from './phones.js';
import { parseId, parseInteger, parseObject } from './validation.js';

export function createPlanStore() {
  const plans = new Map<string, Plan>();
  return {
    create(plan: Plan): Plan {
      // No await between the uniqueness check and write.
      if (plans.has(plan.id)) throw new ApiError(409, 'PLAN_EXISTS', 'Plan already exists');
      plans.set(plan.id, plan);
      return plan;
    },
    findById(id: string): Plan | undefined { return plans.get(id); },
  };
}

export function registerPlanRoutes(app: FastifyInstance, store: ReturnType<typeof createPlanStore>) {
  app.post('/plans', async (request, reply) => {
    const body = parseObject(request.body);
    const id = parseId(body.id, 'id');
    const country = parseCountry(body.country);
    const monthly = parseInteger(body.monthly, 'monthly', 1);
    const joining_fee = parseInteger(body.joining_fee, 'joining_fee', 0);
    return reply.code(201).send(store.create({ id, country, currency: billingCountries[country].currency, monthly, joining_fee }));
  });
}
