import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initContext } from './context.js';
import { requireAuth } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import queueRoutes from './routes/queue.js';
import forecastRoutes from './routes/forecast.js';
import shortagesRoutes, { substitutionsRouter } from './routes/shortages.js';
import posRoutes from './routes/pos.js';
import overridesRoutes from './routes/overrides.js';
import auditRoutes from './routes/audit.js';
import dashboardRoutes from './routes/dashboard.js';
import formularyRoutes from './routes/formulary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The built frontend (../../frontend/dist) — doesn't exist in local dev (the frontend
// runs as its own Vite dev server there instead, see README.md), but a hosting
// platform's build step produces it. Serving both from one process means one deployed
// URL, same-origin /api calls (no CORS setup needed), and the frontend's api/client.ts
// needs zero changes since it already calls a relative /api path.
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', prototype: true }));

app.use('/api/auth', authRoutes);
app.use('/api/queue', requireAuth, queueRoutes);
app.use('/api/forecast', requireAuth, forecastRoutes);
app.use('/api/shortages', requireAuth, shortagesRoutes);
app.use('/api/substitutions', requireAuth, substitutionsRouter);
app.use('/api/pos', requireAuth, posRoutes);
app.use('/api/overrides', requireAuth, overridesRoutes);
app.use('/api/audit', requireAuth, auditRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/formulary', requireAuth, formularyRoutes);

// Static frontend + SPA fallback — only matters when FRONTEND_DIST actually exists
// (a production build ran); express.static() silently no-ops on a missing directory in
// local dev, so this is safe to always register. The catch-all only serves index.html
// for genuinely unmatched GET requests — anything under /api or /health that reaches
// here is a real 404 from that router, not something to paper over with the SPA shell.
app.use(express.static(FRONTEND_DIST));
app.get(/^(?!\/api|\/health).*/, (req, res, next) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'), (err) => {
    if (err) next(); // no build present (local dev) — fall through to the 404 below
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ type: 'about:blank', title: 'Internal error', status: 500, detail: err.message });
  void next;
});

await initContext();
app.listen(PORT, () => {
  console.log(`\nRxForecast prototype API listening on http://localhost:${PORT}`);
  console.log('This is a demo server — in-memory data, mock auth, simulated EDI transport. See GAPS.md.\n');
});
