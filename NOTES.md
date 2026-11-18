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

# Scenarios outside the task brief

These are open business questions for a fuller product; the API currently follows the brief's rules.

1. **Visitors without a supported phone number.** A visitor staying for a few months may only have a mobile number from outside AE, SA, or BH, or no phone number. Registration requires a supported number, so they cannot register. A member can use an international number from any of the three supported countries regardless of their member country. Supporting other numbers or an alternative identifier would need new validation and identity rules.
2. **Returning members joining in another country.** Someone who joined in Saudi Arabia in 2020 and returns in 2026 while visiting the UAE cannot create a UAE agreement against their SA member record: it returns `422 PLAN_COUNTRY_MISMATCH`. There is no member-country update endpoint, transfer, or temporary visitor agreement. Simply changing their country would also need a policy for existing agreements and billing history. Separately, agreements never end under the brief: stopping gym visits does not cancel billing. Country transfers, visitor access, cancellation, and reactivation need explicit business rules.
3. **Outstanding balances, overpayments, and refunds.** Reconciliation compares submitted rows with one month's expected invoices; it does not maintain a running balance, allocate partial payments, carry over credits, or initiate refunds. `DOUBLE_CHARGE_RISK` flags every settled row linked to the same invoice within a run; it does not confirm an accidental charge or reverse one. Amounts outside the one-minor-unit matching tolerance receive `MISSING_FROM_LEDGER`, without calculating an amount owed or credit. Handling arrears across months, duplicate collections across runs, and refund eligibility requires a payment ledger and settlement policies.
4. **Late payments, grace periods, and missed months.** `DUE_DAY_DRIFT` means a single linked settled row was attempted on a different day from the invoice due date, whether early or late; it is not a late-fee decision. Matching only considers invoices due in the run's month, so a payment for a prior month's invoice is not allocated back to it. The API has no grace period, late fees, retry or collection schedule, or suspension after several unpaid months. Those policies, including fee amounts, timing, and any applicable VAT, remain undefined.
