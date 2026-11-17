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

- Part 1 is implemented: `POST /members` and `GET /members/lookup` normalize supported mobiles, validate inputs, and enforce unique phones. Billing and reconciliation are not implemented yet.
- Health reports process availability; there are no external dependencies to probe.
- Members are stored in memory per app instance and reset on restart. Run one Node.js process; synchronous duplicate checks and writes protect uniqueness within that process. No runtime network access is needed.
- Phone cleaning removes literal spaces, hyphens, and round brackets; other whitespace is invalid. Name limits count Unicode code points after trimming. Extra JSON fields are ignored; country codes are case-sensitive.
