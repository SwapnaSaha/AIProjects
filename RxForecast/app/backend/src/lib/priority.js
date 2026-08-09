// Priority scoring for the Reorder Queue — engg.md FEATURE_1's computePriorityScore().
// Deliberately does NOT use dollar margin as an input: PRD.md's Fairness section requires
// margin data suppressed from the substitution/sourcing agent context to avoid biasing
// toward higher-margin brand-name recommendations. We use velocity tier as the weight
// proxy instead, same mitigation intent, applied here too for consistency.
const TIER_WEIGHT = { A: 1.5, B: 1.1, C: 0.8 };

export function computePriorityScore({ forecast, inventory, velocityTier }) {
  if (forecast.insufficientData) return { score: 0, band: 'insufficient_data', daysOfSupply: null };
  const onHand = inventory ? inventory.onHand + inventory.inTransit : 0;
  const avgDaily = Math.max(forecast.avgDaily, 0.01);
  const daysOfSupply = onHand / avgDaily;
  const reorderPoint = inventory?.reorderPointDays ?? 10;
  const stockoutRisk = Math.max(0, (reorderPoint - daysOfSupply) / reorderPoint); // 0..1+
  const tierWeight = TIER_WEIGHT[velocityTier] ?? 1;
  const score = Math.round(stockoutRisk * tierWeight * 100 * 100) / 100;
  let band = 'low';
  if (daysOfSupply < reorderPoint * 0.5) band = 'high';
  else if (daysOfSupply < reorderPoint) band = 'medium';
  return { score, band, daysOfSupply: Math.round(daysOfSupply * 10) / 10 };
}
