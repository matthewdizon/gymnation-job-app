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

- Parts 1–3 are implemented: members, plans, agreements, computed invoice schedules, and monthly gateway reconciliation with stored run retrieval. Gateway rows are submitted as JSON; CSV uploads are outside the brief.
- Health reports process availability; there are no external dependencies to probe.
- Members, plans, agreements, and reconciliation runs are stored in memory per app instance and reset on restart. Run one Node.js process; synchronous duplicate checks and writes protect uniqueness within that process. No runtime network access is needed.
- Phone cleaning removes literal spaces, hyphens, and round brackets; other whitespace is invalid. Name limits count Unicode code points after trimming. Extra JSON fields are ignored; country codes are case-sensitive.
- Plan IDs and referenced IDs must be nonblank strings; IDs are preserved exactly. Dates use the Gregorian calendar, years 0001–9999. Money inputs must be safe JavaScript integers; calculations use BigInt, and an invoice that cannot be represented safely as JSON numbers returns `422 VALIDATION`.
- Reconciliation accepts empty rows and returns all expected invoices as unmatched. Currency must be AED, SAR, or BHD. Malformed fields return `422 VALIDATION` before the specified row business checks, which aggregate as `422 INVALID_ROWS`, including for declined rows.
- Transaction IDs must be unique within a run; the same transactions may appear in separate runs. Each saved run is a fixed snapshot, independent of later agreements or runs.
