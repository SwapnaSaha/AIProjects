import { Router } from 'express';
import { ctx } from '../context.js';
import { getForecast } from '../lib/forecasting.js';
import { computePriorityScore } from '../lib/priority.js';
import { state } from '../data/state.js';

const router = Router();

// Real math on real (session) data — the gap is HISTORY: engg.md FEATURE_8's real spec
// needs a weekly_chain_metrics table with a pre-agent baseline captured at pilot start
// so trend deltas mean something. A fresh in-memory server has no history to trend
// against, so this returns a current snapshot only — labeled as such, not faked.
router.get('/summary', (req, res) => {
  let highUrgency = 0, mediumUrgency = 0, totalTracked = 0;
  for (const store of ctx.stores) {
    for (const ndc of ctx.demoNdcList) {
      const drug = ctx.formularyByNdc.get(ndc);
      const inventory = ctx.inventoryByKey.get(`${store.storeId}|${ndc}`);
      const forecast = getForecast(ctx.forecastIndex, store.storeId, ndc);
      if (forecast.insufficientData) continue;
      const priority = computePriorityScore({ forecast, inventory, velocityTier: drug.velocityTier });
      totalTracked++;
      if (priority.band === 'high') highUrgency++;
      else if (priority.band === 'medium') mediumUrgency++;
    }
  }

  const pos = state.purchaseOrders;
  const shippedOrAcked = pos.filter(p => ['shipped', 'acked'].includes(p.status));
  const illustrativeSavings = shippedOrAcked.reduce((sum, po) => {
    const line = po.lines[0];
    return sum + line.quantityFinal * line.unitPrice * 0.15;
  }, 0);

  const activeShortages = ctx.shortages.filter(s => s.status === 'Current' || s.status === 'current').length;
  const substitutionsPending = state.substitutions.filter(s => s.decision === 'pending').length;
  const substitutionsAccepted = state.substitutions.filter(s => s.decision === 'accepted').length;
  const substitutionsDecided = state.substitutions.filter(s => s.decision !== 'pending').length;

  res.json({
    asOf: new Date().toISOString(),
    isSnapshotOnly: true, // no historical baseline in this in-memory prototype — see GAPS.md
    stockoutRisk: { totalTracked, highUrgency, mediumUrgency, highUrgencyPct: totalTracked ? Math.round((highUrgency / totalTracked) * 1000) / 10 : 0 },
    orders: {
      total: pos.length,
      byStatus: pos.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {}),
    },
    shortages: { active: activeShortages, substitutionsPending, substitutionsAccepted, acceptRate: substitutionsDecided ? Math.round((substitutionsAccepted / substitutionsDecided) * 1000) / 10 : null },
    illustrativeSavingsUsd: Math.round(illustrativeSavings),
    auditEntries: state.auditLog.length,
  });
});

router.get('/stores', (req, res) => {
  res.json(ctx.stores);
});

export default router;
