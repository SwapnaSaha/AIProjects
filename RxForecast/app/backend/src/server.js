import express from 'express';
import cors from 'cors';
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
