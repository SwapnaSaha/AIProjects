import { Router } from 'express';
import { ctx } from '../context.js';
import { state, writeAudit, nextPoId } from '../data/state.js';

const router = Router();

function bulletinExcerpt(bulletinId) {
  const idx = ctx.bulletinText.indexOf(bulletinId);
  if (idx === -1) return null;
  return ctx.bulletinText.slice(idx - 60 < 0 ? 0 : idx - 60, idx + 500).trim();
}

router.get('/', (req, res) => {
  const status = req.query.status;
  let list = ctx.shortages;
  if (status) list = list.filter(s => s.status.toLowerCase() === status.toLowerCase());
  res.json(list.map(s => ({ ...s, bulletinExcerpt: bulletinExcerpt(s.bulletinId) })));
});

router.get('/:id/substitutions', (req, res) => {
  const subs = state.substitutions.filter(s => s.shortageId === req.params.id);
  res.json(subs);
});

export default router;

export const substitutionsRouter = Router();
substitutionsRouter.post('/:id/decision', (req, res) => {
  const sub = state.substitutions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ detail: 'Unknown substitution recommendation' });
  const { decision, altNdc } = req.body || {}; // 'accept' | 'reject'
  if (!['accept', 'reject'].includes(decision)) return res.status(400).json({ detail: 'decision must be accept or reject' });

  const chosen = sub.options.find(o => o.altNdc === altNdc) || sub.options[0];
  if (decision === 'accept' && chosen?.blocked) {
    return res.status(422).json({
      type: 'about:blank', title: 'Blocked — Schedule II', status: 422,
      detail: 'This alternative is DEA Schedule II. No auto-substitution is permitted; route to pharmacist manual review.',
    });
  }

  sub.decision = decision === 'accept' ? 'accepted' : 'rejected';
  sub.decidedAt = new Date().toISOString();
  sub.chosenAltNdc = decision === 'accept' ? chosen?.altNdc : null;

  const shortageForSub = ctx.shortages.find(s => s.id === sub.shortageId);
  writeAudit({
    entityType: 'substitution', entityId: sub.id, action: `substitution_${sub.decision}`,
    actorUserId: req.user.userId, actorRole: req.user.role,
    payload: { shortageId: sub.shortageId, storeId: sub.storeId, originalNdc: sub.originalNdc, chosenAltNdc: sub.chosenAltNdc },
    sources: [
      ...(chosen ? [`Alternative rationale: ${chosen.rationale}`, `TE code match: ${chosen.teMatch ? 'yes' : 'no'}`] : []),
      ...(shortageForSub ? [`Shortage source: ${shortageForSub.source} (bulletin ${shortageForSub.bulletinId}, reported ${shortageForSub.dateReported}) — reason: ${shortageForSub.reason}`] : []),
    ],
  });

  if (decision === 'accept') {
    const overrideId = `OVRLIVE${nextPoId()}`;
    state.overridesActive.push({
      id: overrideId, buyerId: req.user.userId, storeId: sub.storeId, ndc: sub.originalNdc,
      genericName: sub.originalGenericName, type: 'preferred_substitute',
      rationale: `Auto-created from accepted shortage substitution ${sub.id}: ${chosen.rationale}`,
      createdDate: new Date().toISOString(), active: true,
    });
    writeAudit({
      entityType: 'buyer_override', entityId: overrideId, action: 'created',
      actorUserId: req.user.userId, actorRole: req.user.role,
      payload: { auto: true, fromSubstitution: sub.id },
      sources: [`Auto-created from accepted shortage substitution ${sub.id} — see the linked substitution audit entry for the shortage bulletin and TE-code rationale.`],
    });
  }

  res.json(sub);
});
