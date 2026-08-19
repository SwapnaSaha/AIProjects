import { getForecast } from './forecasting.js';
import { findActiveOverride } from './overrideRules.js';

/**
 * Target days-of-supply for a given drug+store: an active `custom_par_level` rule (see
 * rule.md §5, wired 2026-08-19) wins over the inventory record's own default, if the
 * rule actually carries a numeric `parLevelDays` value. Rules created before this field
 * existed (the seeded synthetic set, or any created via the API without the field) have
 * no numeric value to apply and fall through to the inventory default — not an error,
 * just nothing to override with.
 */
export function resolveTargetDays(ndc, storeId, inventory) {
  const rule = findActiveOverride(ndc, storeId, 'custom_par_level');
  if (rule && Number.isFinite(rule.parLevelDays)) {
    return { days: rule.parLevelDays, source: 'rule', ruleId: rule.id };
  }
  return { days: inventory?.targetDays ?? 21, source: 'default', ruleId: null };
}

// Shared by the Reorder Queue (pre-filling the editable qty field) and PO creation
// (the actual default when no override is sent) so the two can never drift apart.
export function recommendedQtyFromForecast(forecast, inventory, targetDays) {
  const target = targetDays ?? inventory?.targetDays ?? 21;
  const onHand = inventory ? inventory.onHand + inventory.inTransit : 0;
  return Math.max(0, Math.round(forecast.avgDaily * target - onHand));
}

export function computeRecommendedQty(ctx, storeId, ndc) {
  const forecast = getForecast(ctx.forecastIndex, storeId, ndc);
  const inventory = ctx.inventoryByKey.get(`${storeId}|${ndc}`);
  const target = resolveTargetDays(ndc, storeId, inventory);
  return { qty: recommendedQtyFromForecast(forecast, inventory, target.days), forecast, inventory, targetDays: target };
}
