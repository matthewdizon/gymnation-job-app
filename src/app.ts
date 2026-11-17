import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';

export function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify(options);

  app.get('/health', async () => ({ status: 'ok' }));

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  return app;
}
