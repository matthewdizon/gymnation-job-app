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

- This initial scaffold implements only health and JSON 404 responses. Members, billing, reconciliation, and their validation are next.
- Health reports process availability; there are no external dependencies to probe.
- State storage is still undecided; the scaffold makes no runtime network requests.
