import { Router } from 'express';
import { state, writeAudit } from '../data/state.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(state.overridesActive.slice().sort((a, b) => (a.createdDate < b.createdDate ? 1 : -1)));
});

router.post('/', (req, res) => {
  const { storeId, ndc, genericName, type, rationale } = req.body || {};
  if (!rationale) return res.status(400).json({ detail: 'Rationale is required — it is the explainability source for this rule.' });
  const conflict = state.overridesActive.find(o => o.active && o.ndc === ndc && (o.storeId === storeId || o.storeId === null));
  const override = {
    id: `OVRLIVE${Date.now()}`, buyerId: req.user.userId, storeId: storeId || null, ndc, genericName,
    type, rationale, createdDate: new Date().toISOString(), active: true,
  };
  state.overridesActive.push(override);
  writeAudit({
    entityType: 'buyer_override', entityId: override.id, action: 'created',
    actorUserId: req.user.userId, actorRole: req.user.role, payload: override,
    sources: [`Manually entered rationale (${req.user.role}): "${rationale}"`, `Scope: ${storeId ? `store ${storeId} only` : 'all stores'}, rule type "${type}"`],
  });
  res.status(201).json({ override, conflictWarning: conflict ? `An active rule already exists for this NDC${conflict.storeId ? ' at this store' : ' across all stores'} (${conflict.type}).` : null });
});

router.patch('/:id', (req, res) => {
  const override = state.overridesActive.find(o => o.id === req.params.id);
  if (!override) return res.status(404).json({ detail: 'Unknown override' });
  const wasActive = override.active;
  override.active = req.body?.active ?? !override.active;
  writeAudit({
    entityType: 'buyer_override', entityId: override.id, action: override.active ? 'reactivated' : 'deactivated',
    actorUserId: req.user.userId, actorRole: req.user.role, payload: {},
    sources: [`Rule toggled ${wasActive ? 'active → inactive' : 'inactive → active'} by ${req.user.role}. Original rationale: "${override.rationale}"`],
  });
  res.json(override);
});

export default router;
