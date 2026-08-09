import { Router } from 'express';
import { ctx } from '../context.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(ctx.formulary);
});

export default router;
