# RxForecast — Prototype

A working prototype of the predictive EDI ordering agent, built to demo the concept to customers and gather feedback. See **[GAPS.md](./GAPS.md)** for exactly what's real vs. simulated here versus the full production spec (`../PRD.md`, `../engg.md`, `../lld.md`, `../deployment.md`), **[reorder.md](./reorder.md)** for exactly how every number and badge on the Reorder Queue is computed, and **[dashboard.md](./dashboard.md)** for the same on the Director Dashboard.

## Run it

**Backend** (Node.js, no external database — reads a trimmed slice of `../../RxForecast_SyntheticData/` into memory at startup):

```bash
cd backend
npm install
npm run dev
```

Runs on `http://localhost:4000`.

**Frontend** (React + Vite + TypeScript + Tailwind v4):

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173`, proxies `/api` to the backend.

Open `http://localhost:5173`, pick a role (no password — this is a prototype, see `GAPS.md` "Authentication"), and go.

## What to click through

1. **Buyer → Reorder Queue** — filter to a store, open a row, see the real forecast + explainability panel, approve a reorder. Note the qty field is already filled with the agent's recommended quantity (greyed until you touch it) — it's editable inline in the drawer too.
2. Watch the **EDI 850 status stepper** — it generates a real X12 850 document (click "View raw X12 850")
3. **Edit + save + bulk approve** — on the Reorder Queue, edit the pre-filled qty on a few rows and click **Save** on each (the field turns solid with a ✓ once saved; Save stays disabled until you actually change something) — you can do this for as many rows as you like without selecting them yet. Then check the rows you want to submit (Schedule II rows are disabled — hover to see why) and click "Approve N selected" from the floating bar; the result banner shows a per-row outcome, and any row you saved an override for is approved at that quantity, not the agent's default.
4. **Defer** a row, then sign out and sign back in as the same role — the row reappears (defer resurfaces on your next login in this demo, standing in for the real nightly-cycle resurfacing). **Reject** a different row with a reason — it stays gone even after signing back in, since a reject is a recorded decision, not a "later."
5. **Shortages** — expand a card, try accepting a substitute; try the methylphenidate ER (Schedule II) card and note there's no accept option at all
6. **Rules** — see the override that got auto-created from the substitution you accepted; **click any rule** to open its detail — full scope/rationale, a plain-language explanation of what that rule type does, and its audit history; try toggling Deactivate/Reactivate from inside the drawer and watch the history list update live
7. Sign out, sign back in as **Pharmacist-in-Charge** → notice the Reorder Queue shows a "Store-locked: ST001" indicator instead of a store picker, and every row is that store only — this is enforced by the API, not just the UI (try editing the URL/query string, it still comes back scoped)
8. Sign in as **Compliance Officer** → **Audit Trail** — see the full chain: approved → transmitted → acked → substitution decided → override created; **click any row** to open its detail — a plain-language explanation, the full structured payload, numbered citations, and (for PO-related entries) the linked raw X12 850/855
9. Sign in as **Director** → **Dashboard** — real session-aggregated metrics

## Stack

- Backend: Node.js + Express, in-memory data (no DB — see `GAPS.md`)
- Frontend: React 19 + Vite + TypeScript + Tailwind v4, `@tanstack/react-query` for server state
- No router library — the app is small enough that simple state-based view switching (`App.tsx`) was the pragmatic choice over pulling in react-router
