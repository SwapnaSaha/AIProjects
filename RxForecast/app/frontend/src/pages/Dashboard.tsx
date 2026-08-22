import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { KpiTile, Spinner } from '../components/ui';

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboard, refetchInterval: 4000 });

  if (isLoading || !data) return <Spinner />;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Director Dashboard</h1>
      <p className="text-sm text-an-fg-subtle mb-4">
        As of {new Date(data.asOf).toLocaleTimeString()}.{' '}
        <span className="text-an-fg-muted">Snapshot only — no week-over-week trend in this prototype (fresh in-memory server has no history to trend against; see GAPS.md).</span>
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile
          label="High-urgency SKUs" value={data.stockoutRisk.highUrgency} sub={`${data.stockoutRisk.highUrgencyPct}% of tracked items`} accent
          tooltip="Count of store+NDC items where the Reorder Queue's priority formula (stockout risk × velocity-tier weight) computes 'high' urgency. Items with insufficient forecast data are excluded from both the count and the % denominator. See reorder.md §4.1."
        />
        <KpiTile
          label="Active shortages" value={data.shortages.active}
          tooltip="Count of shortages currently marked 'Current' — the same list the Shortages page reads. Reflects the live openFDA feed if SHORTAGE_FEED_ENABLED is on. See shortages.md §2–3."
        />
        <KpiTile
          label="Orders placed (session)" value={data.orders.total}
          tooltip="Total purchase orders created since the backend process last started. In-memory only — resets to 0 on a server restart."
        />
        <KpiTile
          label="Illustrative savings" value={`$${data.illustrativeSavingsUsd.toLocaleString()}`} sub="Demo estimate — not the real methodology"
          tooltip="Σ (quantityFinal × unitPrice × 15%) across shipped/acked orders. The 15% is a flat placeholder multiplier, not a real baseline-vs-current calculation. See dashboard.md §2."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-an-bg-surface border border-an-border rounded-lg p-4" title="Direct tally of state.purchaseOrders grouped by their current status field — no scoring, just counting.">
          <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-3 flex items-center gap-1">Orders by status <span className="text-an-fg-muted" aria-hidden="true">ⓘ</span></div>
          <div className="space-y-2">
            {Object.entries(data.orders.byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <span className="capitalize">{status}</span>
                <span className="font-mono">{count}</span>
              </div>
            ))}
            {Object.keys(data.orders.byStatus).length === 0 && <div className="text-sm text-an-fg-subtle">No orders yet this session.</div>}
          </div>
        </div>
        <div className="bg-an-bg-surface border border-an-border rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-3">Substitution decisions</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between cursor-help" title="Count of substitution recommendations with decision === 'pending' — still awaiting a buyer's accept/reject.">
              <span>Pending</span><span className="font-mono">{data.shortages.substitutionsPending}</span>
            </div>
            <div className="flex justify-between cursor-help" title="Count of substitution recommendations with decision === 'accepted'.">
              <span>Accepted</span><span className="font-mono">{data.shortages.substitutionsAccepted}</span>
            </div>
            <div className="flex justify-between cursor-help" title="accepted ÷ (accepted + rejected), rounded to 1 decimal. Shows — until at least one substitution has been decided.">
              <span>Accept rate</span><span className="font-mono">{data.shortages.acceptRate != null ? `${data.shortages.acceptRate}%` : '—'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
