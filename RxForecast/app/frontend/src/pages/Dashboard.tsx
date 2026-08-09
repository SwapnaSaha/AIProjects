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
        <KpiTile label="High-urgency SKUs" value={data.stockoutRisk.highUrgency} sub={`${data.stockoutRisk.highUrgencyPct}% of tracked items`} accent />
        <KpiTile label="Active shortages" value={data.shortages.active} />
        <KpiTile label="Orders placed (session)" value={data.orders.total} />
        <KpiTile label="Illustrative savings" value={`$${data.illustrativeSavingsUsd.toLocaleString()}`} sub="Demo estimate — not the real methodology" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-an-bg-surface border border-an-border rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-3">Orders by status</div>
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
            <div className="flex justify-between"><span>Pending</span><span className="font-mono">{data.shortages.substitutionsPending}</span></div>
            <div className="flex justify-between"><span>Accepted</span><span className="font-mono">{data.shortages.substitutionsAccepted}</span></div>
            <div className="flex justify-between"><span>Accept rate</span><span className="font-mono">{data.shortages.acceptRate != null ? `${data.shortages.acceptRate}%` : '—'}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
