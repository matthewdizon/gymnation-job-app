# Run

Requires Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Production: `npm run build && npm start`.
The API listens on `0.0.0.0:8080`; `curl http://localhost:8080/health` returns `200` with `{"status":"ok"}`.

# Checks

```sh
npm run typecheck
npm test
npm run build
docker build --target test .
docker build -t app .
docker run --rm -p 8080:8080 app
```

# Scope and assumptions

- Parts 1 and 2 are implemented: members, plans, agreements, and computed invoice schedules. Reconciliation is not implemented yet.
- Health reports process availability; there are no external dependencies to probe.
- Members, plans, and agreements are stored in memory per app instance and reset on restart. Run one Node.js process; synchronous duplicate checks and writes protect uniqueness within that process. No runtime network access is needed.
- Phone cleaning removes literal spaces, hyphens, and round brackets; other whitespace is invalid. Name limits count Unicode code points after trimming. Extra JSON fields are ignored; country codes are case-sensitive.
- Plan IDs and referenced IDs must be nonblank strings; IDs are preserved exactly. Dates use the Gregorian calendar, years 0001–9999. Money inputs must be safe JavaScript integers; calculations use BigInt, and an invoice that cannot be represented safely as JSON numbers returns `422 VALIDATION`.
