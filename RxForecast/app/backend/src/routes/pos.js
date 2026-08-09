import { Router } from 'express';
import { ctx } from '../context.js';
import { state, writeAudit, nextPoId } from '../data/state.js';
import { renderX12_850, renderX12_855 } from '../lib/edi850.js';
import { enforceStoreScope } from '../middleware/auth.js';
import { computeRecommendedQty } from '../lib/orderQty.js';

const router = Router();

function serializePo(po) {
  return { ...po, lines: po.lines.map(l => ({ ...l })) };
}

/**
 * Shared PO-creation logic used by both the single POST / and the bulk POST /bulk
 * routes, so bulk approve enforces exactly the same Schedule II hard-block, store
 * scoping, and 2-sigma sanity check as approving one row at a time — bulk is not a
 * separate, weaker code path.
 */
function createSinglePo(user, { storeId, ndc, distributorId, quantity, confirmOverride }) {
  const drug = ctx.formularyByNdc.get(ndc);
  const store = ctx.storesById.get(storeId);
  const distributor = ctx.distributorsById.get(distributorId) || ctx.distributors[0];
  if (!drug || !store) return { ok: false, status: 400, body: { detail: 'Unknown store or NDC' } };

  if (!enforceStoreScope(user, storeId)) {
    return { ok: false, status: 403, body: { detail: `Your account is scoped to store ${user.storeId}.` } };
  }

  if (drug.isControlled && drug.deaSchedule === 2) {
    return {
      ok: false, status: 422,
      body: {
        type: 'about:blank', title: 'Manual order required — Schedule II', status: 422,
        detail: `${drug.genericName} is DEA Schedule II. No auto-PO is permitted; this requires DEA Form 222 / CSOS and manual ordering outside RxForecast.`,
      },
    };
  }

  const rec = computeRecommendedQty(ctx, storeId, ndc);
  const qtyAgent = rec.qty;
  const qtyFinal = quantity != null && quantity !== '' ? Number(quantity) : qtyAgent;

  const historicalAvg30 = rec.forecast.avgDaily * 30;
  const band = Math.max(historicalAvg30 * 1.5, 20);
  if (Math.abs(qtyFinal - qtyAgent) > band && !confirmOverride) {
    return {
      ok: false, status: 422,
      body: {
        type: 'about:blank', title: 'Quantity outside expected range', status: 422,
        detail: `${qtyFinal} units is well outside the historical demand band (agent recommended ${qtyAgent}). Resubmit with confirmOverride:true to proceed anyway — this will be logged.`,
        agentRecommended: qtyAgent,
      },
    };
  }

  const contracts = ctx.contractsByNdc.get(ndc) || [];
  const contract = contracts.find(c => c.distributorId === distributor.id) || contracts[0];
  const unitPrice = contract ? contract.price : drug.wacPrice;

  const po = {
    id: nextPoId(), storeId, distributorId: distributor.id,
    status: 'approved',
    lines: [{ ndc, quantityAgent: qtyAgent, quantityFinal: qtyFinal, unitPrice }],
    createdAt: new Date().toISOString(), approvedBy: user.userId, transmittedAt: null,
    ediRaw850: null, ediRaw855: null, ackStatus: null,
  };
  state.purchaseOrders.push(po);

  writeAudit({
    entityType: 'purchase_order', entityId: po.id, action: 'approved',
    actorUserId: user.userId, actorRole: user.role,
    payload: { storeId, ndc, quantityAgent: qtyAgent, quantityFinal: qtyFinal, modified: qtyFinal !== qtyAgent, distributorId: distributor.id, unitPrice, drugName: drug.genericName },
    sources: [
      `Forecast: ${rec.forecast.avgDaily} units/day average over ${rec.forecast.dataWindowDays ?? 'n/a'} days of dispense history`,
      `Inventory snapshot: ${rec.inventory?.onHand ?? 'n/a'} on hand + ${rec.inventory?.inTransit ?? 0} in transit`,
      `Target days of supply: ${rec.inventory?.targetDays ?? 21} (${drug.velocityTier}-tier default)`,
      contract ? `Contract: ${distributor.name} (${contract.type}) at $${unitPrice.toFixed(2)}/pack` : `No contract on file — priced at WAC ($${unitPrice.toFixed(2)}/pack)`,
    ],
  });

  transmit(po);
  return { ok: true, po };
}

router.get('/', (req, res) => {
  const { store_id, status } = req.query;
  let list = state.purchaseOrders;
  if (req.user.role === 'pic') list = list.filter(p => p.storeId === req.user.storeId);
  if (store_id) list = list.filter(p => p.storeId === store_id);
  if (status) list = list.filter(p => p.status === status);
  res.json(list.map(serializePo).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
});

router.get('/:id', (req, res) => {
  const po = state.purchaseOrders.find(p => p.id === req.params.id);
  if (!po) return res.status(404).json({ detail: 'Unknown PO' });
  if (!enforceStoreScope(req.user, po.storeId)) return res.status(403).json({ detail: `Your account is scoped to store ${req.user.storeId}.` });
  res.json(serializePo(po));
});

// Draft + approve in one step (Approve as-is, engg.md FEATURE_4) — this demo skips a
// separate "pending_approval" state and goes queue-row -> approved PO directly, since
// there's no separate nightly-batch/human-review time gap to model interactively.
router.post('/', (req, res) => {
  const result = createSinglePo(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json(result.body);
  res.status(201).json(serializePo(result.po));
});

// Bulk approve — one request, many rows. Reuses createSinglePo() per item so every
// Schedule II block / store-scope check / 2-sigma sanity check still applies per row;
// a bulk request cannot approve anything a single request couldn't. Returns a
// per-item result so the UI can show "18 approved, 2 need confirmation" rather than
// succeeding or failing as one all-or-nothing unit.
router.post('/bulk', (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ detail: 'items must be a non-empty array.' });
  }
  if (items.length > 200) {
    return res.status(400).json({ detail: 'Bulk approve is capped at 200 items per request.' });
  }
  const results = items.map(item => {
    const outcome = createSinglePo(req.user, item);
    return outcome.ok
      ? { key: item.key, ok: true, po: serializePo(outcome.po) }
      : { key: item.key, ok: false, status: outcome.status, detail: outcome.body.detail, agentRecommended: outcome.body.agentRecommended };
  });
  const approved = results.filter(r => r.ok).length;
  writeAudit({
    entityType: 'queue_bulk_action', entityId: `bulk-${Date.now()}`, action: 'bulk_approve',
    actorUserId: req.user.userId, actorRole: req.user.role,
    payload: { requested: items.length, approved, failed: items.length - approved },
    sources: [`Bulk approval of ${items.length} queue rows in one action — see individual purchase_order audit entries for each line's own forecast/inventory citations.`],
  });
  res.status(207).json({ approved, failed: items.length - approved, results });
});

router.post('/:id/reject', (req, res) => {
  const po = state.purchaseOrders.find(p => p.id === req.params.id);
  if (!po) return res.status(404).json({ detail: 'Unknown PO' });
  if (!enforceStoreScope(req.user, po.storeId)) return res.status(403).json({ detail: `Your account is scoped to store ${req.user.storeId}.` });
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ detail: 'A rejection reason is required.' });
  po.status = 'rejected';
  writeAudit({
    entityType: 'purchase_order', entityId: po.id, action: 'rejected',
    actorUserId: req.user.userId, actorRole: req.user.role, payload: { reason },
    sources: [`Rejected after approval, before/after transmission (status at time of rejection: was previously "${po.status}")`],
  });
  res.json(serializePo(po));
});

function transmit(po) {
  const store = ctx.storesById.get(po.storeId);
  const distributor = ctx.distributorsById.get(po.distributorId);
  const x850 = renderX12_850({ po, lines: po.lines, store, distributor, formularyByNdc: ctx.formularyByNdc });
  po.ediRaw850 = x850;
  po.status = 'transmitted';
  po.transmittedAt = new Date().toISOString();

  writeAudit({
    entityType: 'purchase_order', entityId: po.id, action: 'edi_850_transmitted',
    actorUserId: 'system', actorRole: 'agent:edi-transmission-service',
    payload: { distributorId: po.distributorId, controlNumberEnvelope: 'ISA/GS/ST generated — see ediRaw850 on the PO for the full X12 document' },
    sources: [`X12 850 rendered and transmitted to ${distributor.name} — full raw EDI viewable from the PO detail drawer ("View raw X12 850")`],
  });

  // SIMULATED distributor response — see GAPS.md item "EDI Transport". A real VAN/AS2
  // connection would return this asynchronously from McKesson/Cardinal's own system.
  const ndc = po.lines[0].ndc;
  const shortage = ctx.shortages.find(s => s.ndc === ndc && s.status === 'Current');
  const ackDelayMs = 2500 + Math.random() * 2000;
  setTimeout(() => {
    const ackStatus = shortage ? (Math.random() < 0.7 ? 'Backordered' : 'Partial Allocation') : 'Accepted';
    const promisedDate = new Date(Date.now() + (shortage ? 12 : 3) * 86400000).toISOString().slice(0, 10);
    po.ackStatus = ackStatus;
    po.status = ackStatus === 'Accepted' ? 'acked' : 'backordered';
    po.ediRaw855 = renderX12_855({ po, lines: po.lines, distributor, status: ackStatus, promisedDate });
    writeAudit({
      entityType: 'purchase_order', entityId: po.id, action: 'edi_855_received',
      actorUserId: 'system', actorRole: 'agent:edi-ingestion-service',
      payload: { ackStatus, promisedDate, shortageLinked: !!shortage },
      sources: [
        `X12 855 acknowledgement received from ${distributor.name}: ${ackStatus}${shortage ? ` (NDC is on an active shortage — ${shortage.reason})` : ''}`,
        `Promised ship date: ${promisedDate}`,
      ],
    });
    if (ackStatus === 'Accepted') {
      setTimeout(() => {
        po.status = 'shipped';
        writeAudit({
          entityType: 'purchase_order', entityId: po.id, action: 'edi_856_received',
          actorUserId: 'system', actorRole: 'agent:edi-ingestion-service', payload: {},
          sources: [`X12 856 advance ship notice received from ${distributor.name} — order confirmed shipped.`],
        });
      }, 3000 + Math.random() * 2000);
    }
  }, ackDelayMs);
}

export default router;
