import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, ApiError, type QueueRow, type BulkApproveResult } from '../api/client';
import { useAuth } from '../state/auth';
import { Badge, Button, Drawer, EmptyState, Spinner, StatusStepper } from '../components/ui';

const URGENCY_TONE: Record<string, 'error' | 'warning' | 'success' | 'neutral'> = {
  high: 'error', medium: 'warning', low: 'success', insufficient_data: 'neutral',
};

export default function Queue() {
  const { user } = useAuth();
  const isPic = user?.role === 'pic';
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState('');
  const [selected, setSelected] = useState<Record<string, true>>({}); // rows checked for bulk approve
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({}); // key -> in-progress (unsaved) input text
  const [qtySaved, setQtySaved] = useState<Record<string, number>>({}); // key -> saved override quantity
  const [bulkResult, setBulkResult] = useState<BulkApproveResult | null>(null);

  const effectiveStoreFilter = isPic ? (user!.storeId ?? '') : storeFilter;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['queue', effectiveStoreFilter],
    queryFn: () => api.getQueue(effectiveStoreFilter ? { store_id: effectiveStoreFilter } : {}),
  });
  const { data: stores } = useQuery({ queryKey: ['stores'], queryFn: api.getStores, enabled: !isPic });

  const deferMutation = useMutation({
    mutationFn: (key: string) => api.deferQueueItem(key),
    onSuccess: () => refetch(),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: () => {
      const items = Object.keys(selected).map(key => {
        const [storeId, ndc] = key.split('|');
        return { key, storeId, ndc, distributorId: 'MCK', quantity: qtySaved[key] };
      });
      return api.bulkApprovePos(items);
    },
    onSuccess: (result) => {
      setBulkResult(result);
      setSelected({});
      setQtySaved(prev => {
        const next = { ...prev };
        result.results.filter(r => r.ok).forEach(r => { delete next[r.key]; });
        return next;
      });
      refetch();
    },
  });

  const eligibleKeys = (data?.rows ?? []).filter(r => r.deaSchedule !== 2).map(r => r.key);
  const allEligibleSelected = eligibleKeys.length > 0 && eligibleKeys.every(k => k in selected);
  const selectedCount = Object.keys(selected).length;

  function toggleRow(row: QueueRow, checked: boolean) {
    setSelected(prev => {
      const next = { ...prev };
      if (checked) next[row.key] = true;
      else delete next[row.key];
      return next;
    });
  }
  function toggleAll(checked: boolean) {
    if (checked) setSelected(Object.fromEntries(eligibleKeys.map(k => [k, true as const])));
    else setSelected({});
  }
  function draftValue(row: QueueRow) {
    return qtyDraft[row.key] ?? String(qtySaved[row.key] ?? row.recommendedQty);
  }
  function isDirty(row: QueueRow) {
    const draft = qtyDraft[row.key];
    if (draft === undefined) return false;
    return Number(draft) !== (qtySaved[row.key] ?? row.recommendedQty);
  }
  function saveQty(row: QueueRow) {
    const val = Number(draftValue(row));
    if (!Number.isFinite(val) || val < 0) return;
    setQtySaved(prev => ({ ...prev, [row.key]: val }));
    setQtyDraft(prev => { const next = { ...prev }; delete next[row.key]; return next; });
  }

  return (
    <div className="pb-20">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Reorder Queue</h1>
        {isPic ? (
          <div className="text-sm text-an-fg-subtle bg-an-bg-subtle border border-an-border rounded-md px-3 h-9 flex items-center gap-2">
            <span>Store-locked:</span> <span className="font-medium text-an-fg-base">{user!.storeId}</span>
          </div>
        ) : (
          <select
            value={storeFilter}
            onChange={e => setStoreFilter(e.target.value)}
            className="h-9 px-3 rounded-md bg-an-bg-surface border border-an-border text-sm"
          >
            <option value="">All stores</option>
            {stores?.map(s => <option key={s.storeId} value={s.storeId}>{s.name}</option>)}
          </select>
        )}
      </div>
      <p className="text-sm text-an-fg-subtle mb-4">
        Ranked by stockout risk × velocity tier. {data ? `${data.total} items need attention.` : ''}
        {isPic && ' Your account only sees and acts on your own store — this is enforced server-side, not just filtered client-side.'}
      </p>

      {bulkResult && (
        <div className={`mb-4 rounded-md p-3 text-sm border ${bulkResult.failed === 0 ? 'bg-an-success/10 border-an-success text-an-success' : 'bg-an-warning/10 border-an-warning text-an-warning'}`}>
          <div className="flex items-center justify-between">
            <span>Bulk approve: {bulkResult.approved} approved{bulkResult.failed ? `, ${bulkResult.failed} need attention` : ''}.</span>
            <button className="text-xs underline" onClick={() => setBulkResult(null)}>Dismiss</button>
          </div>
          {bulkResult.failed > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-an-fg-subtle">
              {bulkResult.results.filter(r => !r.ok).map(r => <li key={r.key}>· {r.key}: {r.detail}</li>)}
            </ul>
          )}
        </div>
      )}

      {isLoading && <Spinner />}
      {data && data.rows.length === 0 && <EmptyState>All caught up — nothing needs reordering right now.</EmptyState>}
      {data && data.rows.length > 0 && (
        <div className="border border-an-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-an-bg-subtle text-an-fg-subtle text-[11px] uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 w-8">
                  <input type="checkbox" checked={allEligibleSelected} onChange={e => toggleAll(e.target.checked)} aria-label="Select all eligible rows" />
                </th>
                <th className="text-left px-4 py-2">Drug</th>
                <th className="text-left px-4 py-2">Store</th>
                <th className="text-left px-4 py-2">Category</th>
                <th className="text-right px-4 py-2">On hand</th>
                <th className="text-right px-4 py-2">Days of supply</th>
                <th className="text-right px-4 py-2">Qty to order</th>
                <th className="text-left px-4 py-2">Urgency</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row: QueueRow) => {
                const isSelected = row.key in selected;
                const scheduleII = row.deaSchedule === 2;
                return (
                <tr
                  key={row.key}
                  className="border-t border-an-border hover:bg-an-bg-surface"
                  style={{ borderLeft: `3px solid var(--an-${row.urgencyBand === 'insufficient_data' ? 'border-strong' : row.urgencyBand === 'high' ? 'error' : row.urgencyBand === 'medium' ? 'warning' : 'success'})` }}
                >
                  <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={scheduleII}
                      title={scheduleII ? 'Schedule II drugs require manual DEA Form 222 / CSOS ordering — not eligible for bulk approve.' : undefined}
                      onChange={e => toggleRow(row, e.target.checked)}
                    />
                  </td>
                  <td className="px-4 py-2.5 cursor-pointer" onClick={() => setSelectedKey(row.key)}>
                    <div className="font-medium">{row.genericName}</div>
                    {row.brandName && <div className="text-xs text-an-fg-subtle">{row.brandName}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-an-fg-subtle cursor-pointer" onClick={() => setSelectedKey(row.key)}>{row.storeId}</td>
                  <td className="px-4 py-2.5 text-an-fg-subtle cursor-pointer" onClick={() => setSelectedKey(row.key)}>{row.category}</td>
                  <td className="px-4 py-2.5 text-right cursor-pointer" onClick={() => setSelectedKey(row.key)}>{row.onHand ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right cursor-pointer" onClick={() => setSelectedKey(row.key)}>{row.daysOfSupply ?? '—'}</td>
                  <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                    {(() => {
                      const dirty = isDirty(row);
                      const saved = row.key in qtySaved && !dirty;
                      return (
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="number"
                            min={0}
                            value={draftValue(row)}
                            onChange={e => setQtyDraft(prev => ({ ...prev, [row.key]: e.target.value }))}
                            title={saved ? 'Saved override — will be used by bulk approve' : 'Agent-recommended quantity — editable'}
                            className={`h-7 w-20 px-2 rounded-md border text-sm text-right ${
                              dirty
                                ? 'border-an-accent text-an-fg-base bg-an-bg-surface'
                                : saved
                                ? 'border-an-border text-an-fg-base bg-an-bg-surface'
                                : 'border-an-border text-an-fg-subtle bg-an-bg-subtle'
                            }`}
                          />
                          <button
                            className="text-xs text-an-accent disabled:text-an-fg-muted disabled:cursor-not-allowed"
                            disabled={!dirty}
                            onClick={() => saveQty(row)}
                          >
                            Save
                          </button>
                          {saved && <span className="text-an-success text-xs" title="Saved override">✓</span>}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5 cursor-pointer" onClick={() => setSelectedKey(row.key)}>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={URGENCY_TONE[row.urgencyBand]}>{row.urgencyBand.replace('_', ' ')}</Badge>
                      {row.shortageLinked && <Badge tone="critical">shortage</Badge>}
                      {scheduleII && <Badge tone="neutral">Sch. II</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      className="text-xs text-an-fg-subtle hover:text-an-fg-base"
                      onClick={e => { e.stopPropagation(); deferMutation.mutate(row.key); }}
                    >
                      Defer
                    </button>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      )}

      {selectedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-an-bg-elevated border-t border-an-border px-6 py-3 flex items-center justify-between shadow-lg z-40">
          <div className="text-sm">{selectedCount} selected — quantities you've edited and saved (✓) are used as-is; anything not saved uses the agent's recommendation at approval time.</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setSelected({})}>Clear</Button>
            <Button variant="primary" onClick={() => bulkApproveMutation.mutate()} disabled={bulkApproveMutation.isPending}>
              {bulkApproveMutation.isPending ? 'Approving…' : `Approve ${selectedCount} selected`}
            </Button>
          </div>
        </div>
      )}

      {selectedKey && <QueueDetailDrawer queueKey={selectedKey} onClose={() => setSelectedKey(null)} onActed={() => { refetch(); setSelectedKey(null); }} />}
    </div>
  );
}

function QueueDetailDrawer({ queueKey, onClose, onActed }: { queueKey: string; onClose: () => void; onActed: () => void }) {
  const [storeId, ndc] = queueKey.split('|');
  const [qtyOverride, setQtyOverride] = useState<string>('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPo, setCreatedPo] = useState<import('../api/client').Po | null>(null);

  const { data: detail } = useQuery({ queryKey: ['queueDetail', queueKey], queryFn: () => api.getQueueDetail(queueKey) });
  const { data: forecast } = useQuery({ queryKey: ['forecast', storeId, ndc], queryFn: () => api.getForecast(storeId, ndc) });
  const { data: poLive } = useQuery({
    queryKey: ['po', createdPo?.id],
    queryFn: () => api.getPo(createdPo!.id),
    enabled: !!createdPo,
    refetchInterval: (query) => (query.state.data && ['shipped', 'rejected'].includes(query.state.data.status) ? false : 1500),
  });

  const approveMutation = useMutation({
    mutationFn: () => api.createPo({ storeId, ndc, distributorId: 'MCK', quantity: qtyOverride ? Number(qtyOverride) : undefined, confirmOverride }),
    onSuccess: (po) => { setCreatedPo(po); setError(null); },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 422) setError(e.detail);
      else setError('Something went wrong.');
    },
  });
  const rejectMutation = useMutation({
    mutationFn: () => api.rejectQueueItem(queueKey, rejectReason),
    onSuccess: onActed,
  });

  const po = poLive || createdPo;
  const scheduleII = detail?.drug.deaSchedule === 2;

  return (
    <Drawer open title={detail ? detail.genericName : 'Loading…'} onClose={onClose}>
      {!detail && <Spinner />}
      {detail && (
        <div className="space-y-5">
          <div>
            <div className="text-xs text-an-fg-subtle">{detail.store.name} · {detail.category}</div>
            {detail.brandName && <div className="text-sm text-an-fg-subtle">Brand: {detail.brandName}</div>}
          </div>

          {forecast && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-2">7-day forecast</div>
              {forecast.forecast.insufficientData ? (
                <div className="text-sm bg-an-bg-subtle text-an-fg-subtle rounded-md p-3">
                  Insufficient data ({forecast.forecast.dataWindowDays} days of history) — falling back to par-level guidance rather than a confident forecast.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="bg-an-bg-surface rounded-md p-2"><div className="text-an-fg-subtle text-xs">Forecast</div><div className="font-mono">{forecast.forecast.forecastQty7d}</div></div>
                  <div className="bg-an-bg-surface rounded-md p-2"><div className="text-an-fg-subtle text-xs">Low</div><div className="font-mono">{forecast.forecast.confidenceLow}</div></div>
                  <div className="bg-an-bg-surface rounded-md p-2"><div className="text-an-fg-subtle text-xs">High</div><div className="font-mono">{forecast.forecast.confidenceHigh}</div></div>
                </div>
              )}
              <details className="mt-2">
                <summary className="text-xs text-an-accent cursor-pointer">Why? (explainability)</summary>
                <ul className="mt-2 space-y-1 text-xs text-an-fg-subtle font-mono">
                  {forecast.citations.map((c, i) => <li key={i}>· {c.detail}</li>)}
                </ul>
              </details>
            </div>
          )}

          {scheduleII ? (
            <div className="bg-an-critical/15 border border-an-critical rounded-md p-3">
              <div className="text-sm font-medium text-an-critical">Manual order required — Schedule II</div>
              <div className="text-xs text-an-fg-subtle mt-1">DEA Schedule II drugs cannot be auto-ordered by RxForecast. This requires DEA Form 222 / CSOS outside this system.</div>
            </div>
          ) : !po ? (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-2">Recommended order</div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="number"
                  min={0}
                  value={qtyOverride !== '' ? qtyOverride : String(detail.recommendedQty)}
                  onChange={e => { setQtyOverride(e.target.value); setConfirmOverride(false); setError(null); }}
                  className={`h-9 px-3 rounded-md border text-sm w-full ${qtyOverride !== '' ? 'bg-an-bg-surface border-an-border text-an-fg-base' : 'bg-an-bg-subtle border-an-border text-an-fg-subtle'}`}
                />
                <span className="text-xs text-an-fg-subtle whitespace-nowrap">units</span>
              </div>
              {error && (
                <div className="text-xs text-an-error bg-an-error/10 rounded-md p-2 mb-2">
                  {error}
                  {!confirmOverride && <button className="block underline mt-1" onClick={() => { setConfirmOverride(true); setError(null); }}>Confirm and override anyway</button>}
                </div>
              )}
              {!showReject ? (
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                    {qtyOverride ? 'Approve modified' : 'Approve as recommended'}
                  </Button>
                  <Button variant="danger" onClick={() => setShowReject(true)}>Reject</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    placeholder="Reason for rejecting (required)"
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    className="w-full h-20 px-3 py-2 rounded-md bg-an-bg-surface border border-an-border text-sm"
                  />
                  <div className="flex gap-2">
                    <Button variant="danger" disabled={!rejectReason || rejectMutation.isPending} onClick={() => rejectMutation.mutate()}>Confirm reject</Button>
                    <Button variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-3">EDI 850 status — {po.id}</div>
              <StatusStepper status={po.status} ackStatus={po.ackStatus} />
              {po.ediRaw850 && (
                <details className="mt-4">
                  <summary className="text-xs text-an-accent cursor-pointer">View raw X12 850</summary>
                  <pre className="mt-2 text-[11px] font-mono bg-an-bg-elevated p-3 rounded-md overflow-x-auto whitespace-pre-wrap">{po.ediRaw850}</pre>
                </details>
              )}
              {po.ediRaw855 && (
                <details className="mt-2">
                  <summary className="text-xs text-an-accent cursor-pointer">View raw X12 855 (ack)</summary>
                  <pre className="mt-2 text-[11px] font-mono bg-an-bg-elevated p-3 rounded-md overflow-x-auto whitespace-pre-wrap">{po.ediRaw855}</pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
