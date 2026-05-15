# Invoice IQ → AI Invoice Intelligence Platform

This is a large scope. To keep each step shippable and reviewable, I'll deliver in **4 phases**. After each phase you'll have a working, testable improvement — not a 3-day silent rewrite.

---

## Phase 1 — Detection Engine (backend-heavy)
**Goal:** Make fraud/tampering detection real, not just GSTIN-based.

1. **Amount tampering check** in `verify-gstin` / `process-invoice`:
   - Validate `taxable + cgst + sgst + igst ≈ total_amount` (₹1 tolerance).
   - On mismatch → add issue `AMOUNT_MISMATCH`, +25 fraud score, set status `error`.
2. **Duplicate detection** (already partial):
   - Same `file_hash` → +30 (existing).
   - Same `invoice_number + seller GSTIN` with different amount → +25, issue `DUPLICATE_NUMBER_DIFF_AMOUNT`.
   - Same GSTIN with different `seller_name` → +15, issue `VENDOR_NAME_DRIFT`.
3. **Tax-rate sanity**: CGST≠SGST when both present, or rate not in {0,5,12,18,28} → +10.
4. **Unified scoring** (replaces current ad-hoc):
   - Compute `compliance_score = 100 - fraud_score`.
   - 90–100 Low/Valid · 70–89 Medium/Warning · <70 High/Error.
5. **Multi-page PDF**: split each page into its own invoice row (uses existing `pdf-split.ts`, wire it into upload pipeline).

## Phase 2 — Vendor Intelligence + Repository
**Goal:** Persistent vendor profiles + invoice management UI.

1. **DB migration**: new `vendors` table (`gstin` PK, `legal_name`, `trade_name`, `risk_level`, `total_invoices`, `flagged_count`, `last_seen_at`).
2. **Trigger / server fn** to upsert vendor on each new invoice and recompute `risk_level`:
   - flagged_count/total > 0.3 → High; > 0.1 → Medium; else Low.
3. **Invoices page** (`/invoices`) enhancements:
   - Search bar (invoice #, seller, GSTIN).
   - Filter chips: Valid / Warning / Error / High Risk.
   - Sort by date / amount / risk.
   - Row actions: View Details modal, Delete, Re-verify GSTIN.
4. **Vendors page** (new `/vendors`): table of vendor cards with risk badge + invoice count.

## Phase 3 — Analytics + Alerts + Export
**Goal:** Dashboard upgrade and reporting.

1. **Dashboard widgets**: Total invoices, Total GST collected, Fraud detected, Compliance %, MoM trend.
2. **Charts** (recharts, already installed): monthly invoice volume (line), fraud risk distribution (pie), top risky vendors (bar).
3. **Alerts feed** (in-app): server fn returns latest 20 alerts (duplicate, mismatch, high risk, inactive GSTIN). Bell icon + badge in `AppShell`.
4. **Export**:
   - CSV export (already partial in `export-utils.ts`) — extend with fraud columns.
   - PDF report (jsPDF) — invoice detail + compliance summary.

## Phase 4 — Reliability + UX polish
1. **Retry logic** on edge functions: 2 retries with exponential backoff for GST API + AI OCR.
2. **Fallback chain**: GST API → cache → `gstin_fallback` table → mark `gstin_source='unverified'` (kills "via none").
3. **Stuck rows**: server fn `requeue-stuck-invoices` — any `processing` >5 min → reset to allow retry.
4. **UI**: retry button on failed invoices, fraud tooltip with reason+impact+suggestion, vendor risk badges, "last updated" timestamps, upload progress bar per file.

---

## Technical notes (for the dev reviewer)

- All new server logic via `createServerFn` in `src/lib/*.functions.ts` — no new edge functions unless an external webhook needs it.
- Reuse existing tables (`invoices`, `gstin_cache`, `gstin_fallback`); add `vendors` only.
- Keep current Supabase email/password auth untouched.
- Scoring centralized in `src/lib/scoring.ts` so edge fn + server fn share one source of truth.
- Use existing `Tesseract.js` fallback path; add timeout + retry around Lovable AI Gateway call.

---

## Delivery order
I'll start with **Phase 1** (highest priority per your last brief — fraud rules + amount consistency + alerts foundation). Each phase ends with a publish-ready build you can demo for your viva.

**Reply "go phase 1"** to begin, or tell me which phase to prioritize.
