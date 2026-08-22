import { Router } from 'express';
import { ctx } from '../context.js';
import { getForecast } from '../lib/forecasting.js';

const router = Router();

router.get('/:storeId/:ndc', (req, res) => {
  const { storeId, ndc } = req.params;
  const drug = ctx.formularyByNdc.get(ndc);
  if (!drug) return res.status(404).json({ detail: 'Unknown NDC' });
  const forecast = getForecast(ctx.forecastIndex, storeId, ndc);
  const inventory = ctx.inventoryByKey.get(`${storeId}|${ndc}`);

  res.json({
    storeId, ndc, drug,
    forecast,
    inventory,
    citations: [
      { type: 'dispense_history', detail: `${forecast.dataPoints || 0} dispense events over ${forecast.dataWindowDays || 0} days`, source: 'seed-data/dispense_history.csv' },
      { type: 'inventory_snapshot', detail: inventory ? `As of last snapshot: ${inventory.onHand} on hand, ${inventory.inTransit} in transit` : 'No recent snapshot', source: 'inventory_snapshot_weekly.csv' },
      { type: 'model', detail: 'PROTOTYPE: trailing-average forecaster, not the production LightGBM model — see GAPS.md', source: 'lib/forecasting.js' },
    ],
  });
});

export default router;
