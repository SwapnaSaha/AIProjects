import { Router } from 'express';
import { state } from '../data/state.js';

const router = Router();

// Real audit content, real filtering — the gap here is enforcement (see GAPS.md
// "Audit Immutability"), not the data or the UI, both of which are genuine.
router.get('/', (req, res) => {
  const { entity_type, entity_id, actor } = req.query;
  let list = state.auditLog;
  if (entity_type) list = list.filter(a => a.entityType === entity_type);
  if (entity_id) list = list.filter(a => a.entityId === entity_id);
  if (actor) list = list.filter(a => a.actorUserId === actor);
  res.json(list.slice().reverse());
});

export default router;
