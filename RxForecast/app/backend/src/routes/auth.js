import { Router } from 'express';
import { login } from '../data/state.js';

const router = Router();

// PROTOTYPE login — pick a role, no password/SSO/MFA. Real spec: engg.md FEATURE_0.
router.post('/login', (req, res) => {
  const { role } = req.body || {};
  const result = login(role);
  if (!result) return res.status(400).json({ detail: `Unknown role "${role}"` });
  res.json(result);
});

export default router;
