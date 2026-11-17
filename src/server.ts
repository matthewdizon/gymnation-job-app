import { buildApp } from './app.js';

const app = buildApp({ logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    try {
      await app.close();
    } catch (error) {
      app.log.error(error);
      process.exitCode = 1;
    }
  });
}

try {
  await app.listen({ host: '0.0.0.0', port: 8080 });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
