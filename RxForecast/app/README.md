# RxForecast — Prototype

A working prototype of the predictive EDI ordering agent, built to demo the concept to customers and gather feedback. See **[GAPS.md](./GAPS.md)** for exactly what's real vs. simulated here versus the full production spec (`../PRD.md`, `../engg.md`, `../lld.md`, `../deployment.md`), **[reorder.md](./reorder.md)** for exactly how every number and badge on the Reorder Queue is computed, **[dashboard.md](./dashboard.md)** for the same on the Director Dashboard, **[shortages.md](./shortages.md)** for the same on the Shortage Alerts page, and **[rule.md](./rule.md)** for the same on the Rules page — 3 of 5 rule types now genuinely change agent behavior (`never_substitute`, `never_generic`, `custom_par_level`); 2 (the distributor-sourcing types) don't yet.

## Run it

**Backend** (Node.js, no external database — reads the trimmed synthetic dataset committed at `backend/seed-data/` into memory at startup; re-run `node scripts/export-seed-data.mjs` from `backend/` to regenerate it if the full external `RxForecast_SyntheticData/` source ever changes, or `node scripts/generate.cjs` first to regenerate that full ~101MB source itself from the same deterministic seed):

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
7. **Create a `never_substitute` rule** for a drug with an active shortage, then go back to Shortages and expand that card — the substitute options are genuinely gone, replaced with a message citing the rule, no restart needed. Try `custom_par_level` on a Reorder Queue drug with a low target-days value too — the recommended qty visibly drops and a small "rule" tag appears next to it.
8. Sign out, sign back in as **Pharmacist-in-Charge** → notice the Reorder Queue shows a "Store-locked: ST001" indicator instead of a store picker, and every row is that store only — this is enforced by the API, not just the UI (try editing the URL/query string, it still comes back scoped)
9. Sign in as **Compliance Officer** → **Audit Trail** — see the full chain: approved → transmitted → acked → substitution decided → override created; **click any row** to open its detail — a plain-language explanation, the full structured payload, numbered citations, and (for PO-related entries) the linked raw X12 850/855
10. Sign in as **Director** → **Dashboard** — real session-aggregated metrics

## Deploying a shareable link (free)

Both frontend and backend run from **one Express process** in production — `server.js` serves the built React app as static files alongside the `/api/*` routes, same origin, so there's no CORS setup and the frontend's `/api` calls (already relative, unchanged) just work. This means one deployed URL, not two.

**[Render](https://render.com)** free web service tier fits this: no credit card required, 512MB RAM/0.1 CPU (plenty for this app), 750 free hours/month. The one real caveat — a free service **sleeps after 15 minutes idle and takes 30–60s to wake up** on the next request. Open the link yourself a minute before a live demo so your manager doesn't hit that cold start.

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. Create a free Render account (render.com) and connect your GitHub account — you do this step yourself, not something that can be automated on your behalf.
3. **New → Web Service**, pick this repo.
4. Settings:
   - **Root Directory:** `RxForecast/app`
   - **Environment:** Node
   - **Build Command:** `cd frontend && npm install && npm run build && cd ../backend && npm install`
   - **Start Command:** `cd backend && npm start`
   - **Instance Type:** Free
5. Leave environment variables unset — every optional integration (Foundry, Content Safety, the live openFDA feed) is off by default and the app runs fully without any of them; see `.env.example` in `backend/` if you want to turn one on later.
6. Deploy. Render gives you a `https://<your-service-name>.onrender.com` URL — that's the one link to share.

## Stack

- Backend: Node.js + Express, in-memory data (no DB — see `GAPS.md`)
- Frontend: React 19 + Vite + TypeScript + Tailwind v4, `@tanstack/react-query` for server state
- No router library — the app is small enough that simple state-based view switching (`App.tsx`) was the pragmatic choice over pulling in react-router
