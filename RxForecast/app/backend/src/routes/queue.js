import { Router } from 'express';
import { ctx } from '../context.js';
import { getForecast } from '../lib/forecasting.js';
import { computePriorityScore } from '../lib/priority.js';
import { recommendedQtyFromForecast } from '../lib/orderQty.js';
import { state, writeAudit } from '../data/state.js';
import { requireStoreScope } from '../middleware/auth.js';

const router = Router();

function buildQueueRow(storeId, ndc) {
  const drug = ctx.formularyByNdc.get(ndc);
  const inventory = ctx.inventoryByKey.get(`${storeId}|${ndc}`);
  const forecast = getForecast(ctx.forecastIndex, storeId, ndc);
  const priority = computePriorityScore({ forecast, inventory, velocityTier: drug.velocityTier });
  const shortage = ctx.shortages.find(s => s.ndc === ndc && (s.status === 'Current' || s.status === 'current'));
  return {
    key: `${storeId}|${ndc}`, storeId, ndc,
    genericName: drug.genericName, brandName: drug.brandName, category: drug.category,
    velocityTier: drug.velocityTier, isControlled: drug.isControlled, deaSchedule: drug.deaSchedule,
    forecastQty7d: forecast.forecastQty7d, insufficientData: forecast.insufficientData,
    recommendedQty: recommendedQtyFromForecast(forecast, inventory),
    onHand: inventory ? inventory.onHand + inventory.inTransit : null,
    daysOfSupply: priority.daysOfSupply, priorityScore: priority.score, urgencyBand: priority.band,
    shortageLinked: !!shortage,
  };
}

router.get('/', (req, res) => {
  let { store_id, category } = req.query;
  // PIC accounts are hard-scoped to their own store — a requested store_id for any
  // other store is silently overridden, not just filtered client-side, so there's no
  // way to bypass this by editing the query string.
  if (req.user.role === 'pic') store_id = req.user.storeId;

  const hasOpenPo = new Set(
    state.purchaseOrders
      .filter(po => !['rejected', 'cancelled'].includes(po.status))
      .flatMap(po => po.lines.map(l => `${po.storeId}|${l.ndc}`))
  );

  const deferredForUser = state.deferredQueueItems.get(req.user.userId);

  let rows = [];
  for (const store of ctx.stores) {
    if (store_id && store.storeId !== store_id) continue;
    for (const ndc of ctx.demoNdcList) {
      const key = `${store.storeId}|${ndc}`;
      if (deferredForUser?.has(key)) continue;
      if (state.rejectedQueueItems.has(key)) continue;
      if (hasOpenPo.has(key)) continue; // duplicate suppression — an open PO already covers this
      const drug = ctx.formularyByNdc.get(ndc);
      if (!drug) continue;
      if (category && drug.category !== category) continue;
      const row = buildQueueRow(store.storeId, ndc);
      if (row.urgencyBand === 'low' && !row.shortageLinked) continue; // only show actionable rows
      rows.push(row);
    }
  }
  rows.sort((a, b) => b.priorityScore - a.priorityScore);
  res.json({ rows, total: rows.length, generatedAt: new Date().toISOString(), scopedToStore: req.user.role === 'pic' ? req.user.storeId : null });
});

router.get('/:key/detail', (req, res) => {
  const [storeId, ndc] = req.params.key.split('|');
  if (!requireStoreScope(req, res, storeId)) return;
  if (!ctx.formularyByNdc.has(ndc)) return res.status(404).json({ detail: 'Unknown NDC' });
  const row = buildQueueRow(storeId, ndc);
  const drug = ctx.formularyByNdc.get(ndc);
  const contracts = ctx.contractsByNdc.get(ndc) || [];
  res.json({ ...row, drug, contracts, store: ctx.storesById.get(storeId) });
});

router.post('/:key/defer', (req, res) => {
  const [storeId] = req.params.key.split('|');
  if (!requireStoreScope(req, res, storeId)) return;
  if (!state.deferredQueueItems.has(req.user.userId)) state.deferredQueueItems.set(req.user.userId, new Set());
  state.deferredQueueItems.get(req.user.userId).add(req.params.key);
  res.json({ deferred: true, key: req.params.key, resurfacesNote: 'Resurfaces the next time you log in (per engg.md FEATURE_1 — production resurfaces on the next nightly cycle instead).' });
});

// Reject the agent's recommendation before any PO exists (engg.md FEATURE_4's
// "Reject" path, distinct from POST /api/pos/:id/reject which cancels an
// already-approved PO). Removes the row from the queue and logs why.
router.post('/:key/reject', (req, res) => {
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ detail: 'A rejection reason is required.' });
  const [storeId, ndc] = req.params.key.split('|');
  if (!requireStoreScope(req, res, storeId)) return;
  state.rejectedQueueItems.add(req.params.key); // permanent — an explicit decision, not a "come back later"
  writeAudit({
    entityType: 'queue_recommendation', entityId: req.params.key, action: 'rejected',
    actorUserId: req.user.userId, actorRole: req.user.role, payload: { storeId, ndc, reason },
    sources: [`Rejected by ${req.user.role} before a PO was drafted — no EDI transaction was ever generated for this recommendation.`],
  });
  res.json({ rejected: true, key: req.params.key });
});

export default router;
