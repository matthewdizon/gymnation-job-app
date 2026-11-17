# GymNation API

Build a small HTTP API for gym memberships, billing, and payment reconciliation in the UAE, Saudi Arabia, and Bahrain.

## Scope

1. Create members and look them up by normalized, unique phone numbers.
2. Create plans and agreements; calculate invoice schedules with proration, joining fees, and VAT.
3. Reconcile monthly gateway rows against expected invoices and save the results.

Use exact integer minor-unit arithmetic, date-only calculations, and concurrency-safe uniqueness. Reconciliation must reuse invoice calculations and produce order-independent verdicts.

## Delivery

- Root `Dockerfile`; API on `0.0.0.0:8080`, with `/health` returning 200 within 60 seconds.
- Docker `test` stage that runs the tests.
- No runtime network access; start with empty state and compute invoices on request.
- `NOTES.md` for run instructions, skipped work, and assumptions; `PROMPTS.md` for AI conversations before submission.
- Submit on `main`, with the repository under 200 MB.

## Progress and next steps

The initial scaffold uses Node.js 24, TypeScript, and Fastify, with a health endpoint, Node test runner checks, and Docker runtime/test stages. App creation is separate from server startup so tests can send requests without opening a port. Storage is still undecided.

Next: members → billing → reconciliation → submission checks. No frontend or hosted deployment is required. See `NOTES.md` for run commands and current scope.

See [the task brief](docs/gymnation-task.md) for exact schemas, rules, and errors.
