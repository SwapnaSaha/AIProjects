import { Router } from 'express';
import { ctx } from '../context.js';
import { state, writeAudit } from '../data/state.js';
import { refreshPendingSubstitutionsForNdc } from '../lib/substitution.js';

const router = Router();

const SUBSTITUTION_AFFECTING_TYPES = ['never_substitute', 'never_generic'];

// Substitution options are precomputed into state.substitutions at boot (and on each
// live-feed poll), not recalculated per-request — so a rule created after boot has
// nothing to affect until the relevant pending records are refreshed. Called after any
// create/toggle that could change a never_substitute/never_generic outcome so the effect
// is visible immediately, not just after a restart. Never lets a refresh failure break
// the request that triggered it — logs and continues, same defensive pattern as
// shortageFeed.js.
async function refreshIfRelevant(type, ndc) {
  if (!SUBSTITUTION_AFFECTING_TYPES.includes(type)) return;
  try {
    await refreshPendingSubstitutionsForNdc(ndc, {
      substitutions: state.substitutions,
      shortages: ctx.shortages,
      formulary: ctx.formulary,
      contracts: ctx.contracts,
      storesById: ctx.storesById,
    });
  } catch (err) {
    console.error(`[overrides] failed to refresh pending substitutions for ${ndc}:`, err.message);
  }
}

router.get('/', (req, res) => {
  res.json(state.overridesActive.slice().sort((a, b) => (a.createdDate < b.createdDate ? 1 : -1)));
});

router.post('/', async (req, res) => {
  const { storeId, ndc, genericName, type, rationale, parLevelDays } = req.body || {};
  if (!rationale) return res.status(400).json({ detail: 'Rationale is required — it is the explainability source for this rule.' });
  if (type === 'custom_par_level' && !(Number.isFinite(Number(parLevelDays)) && Number(parLevelDays) > 0)) {
    return res.status(400).json({ detail: 'custom_par_level rules require a positive target days-of-supply value.' });
  }
  const conflict = state.overridesActive.find(o => o.active && o.ndc === ndc && (o.storeId === storeId || o.storeId === null));
  const override = {
    id: `OVRLIVE${Date.now()}`, buyerId: req.user.userId, storeId: storeId || null, ndc, genericName,
    type, rationale, createdDate: new Date().toISOString(), active: true,
    // Only meaningful for custom_par_level — see orderQty.js's resolveTargetDays(), which
    // is the one place this field is actually consulted (rule.md §5's gap, wired 2026-08-19).
    parLevelDays: type === 'custom_par_level' ? Number(parLevelDays) : null,
  };
  state.overridesActive.push(override);
  writeAudit({
    entityType: 'buyer_override', entityId: override.id, action: 'created',
    actorUserId: req.user.userId, actorRole: req.user.role, payload: override,
    sources: [`Manually entered rationale (${req.user.role}): "${rationale}"`, `Scope: ${storeId ? `store ${storeId} only` : 'all stores'}, rule type "${type}"`],
  });
  await refreshIfRelevant(type, ndc);
  res.status(201).json({ override, conflictWarning: conflict ? `An active rule already exists for this NDC${conflict.storeId ? ' at this store' : ' across all stores'} (${conflict.type}).` : null });
});

router.patch('/:id', async (req, res) => {
  const override = state.overridesActive.find(o => o.id === req.params.id);
  if (!override) return res.status(404).json({ detail: 'Unknown override' });
  const wasActive = override.active;
  override.active = req.body?.active ?? !override.active;
  writeAudit({
    entityType: 'buyer_override', entityId: override.id, action: override.active ? 'reactivated' : 'deactivated',
    actorUserId: req.user.userId, actorRole: req.user.role, payload: {},
    sources: [`Rule toggled ${wasActive ? 'active → inactive' : 'inactive → active'} by ${req.user.role}. Original rationale: "${override.rationale}"`],
  });
  await refreshIfRelevant(override.type, override.ndc);
  res.json(override);
});

export default router;
