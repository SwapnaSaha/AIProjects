import { getForecast } from './forecasting.js';

// Shared by the Reorder Queue (pre-filling the editable qty field) and PO creation
// (the actual default when no override is sent) so the two can never drift apart.
export function recommendedQtyFromForecast(forecast, inventory) {
  const target = inventory?.targetDays ?? 21;
  const onHand = inventory ? inventory.onHand + inventory.inTransit : 0;
  return Math.max(0, Math.round(forecast.avgDaily * target - onHand));
}

export function computeRecommendedQty(ctx, storeId, ndc) {
  const forecast = getForecast(ctx.forecastIndex, storeId, ndc);
  const inventory = ctx.inventoryByKey.get(`${storeId}|${ndc}`);
  return { qty: recommendedQtyFromForecast(forecast, inventory), forecast, inventory };
}
