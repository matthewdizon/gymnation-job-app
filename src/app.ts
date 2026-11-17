import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import { createPlanStore, registerPlanRoutes } from './plans.js';
import { createAgreementStore, registerAgreementRoutes } from './agreements.js';
import { ApiError } from './errors.js';
import { createReconciliationStore, registerReconciliationRoutes } from './reconciliation.js';
import { createMemberStore, registerMemberRoutes } from './members.js';

export function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify(options);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, ...error.details },
      });
    }
    const status = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    if (error instanceof Error && typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(422).send({ error: { code: 'VALIDATION', message: error.message } });
    }
    app.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  const members = createMemberStore();
  const plans = createPlanStore();
  const agreements = createAgreementStore();
  registerMemberRoutes(app, members);
  registerPlanRoutes(app, plans);
  registerAgreementRoutes(app, agreements, members, plans);
  registerReconciliationRoutes(app, createReconciliationStore(), agreements, plans);

  app.get('/health', async () => ({ status: 'ok' }));

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  return app;
}
