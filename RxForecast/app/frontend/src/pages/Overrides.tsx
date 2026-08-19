import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Override } from '../api/client';
import { Badge, Button, Card, Drawer, EmptyState, Spinner } from '../components/ui';

const TYPES = ['never_substitute', 'preferred_distributor', 'custom_par_level', 'never_generic', 'always_secondary_source'];

// Which rule types actually change agent behavior in this build (wired 2026-08-19 — see
// rule.md §5) vs. which are still stored/audited only. Shown in the create form so this
// isn't a silent gap — matches how the rest of this prototype flags simulated vs. real.
const WIRING_NOTE: Record<string, string> = {
  never_substitute: 'Wired: the Substitution Reasoner offers zero alternatives for this drug at this scope.',
  never_generic: 'Wired: the Substitution Reasoner only offers brand-name alternatives for this drug at this scope.',
  custom_par_level: 'Wired: the target days-of-supply below replaces the inventory default when computing recommended order quantity.',
  preferred_distributor: 'Not yet wired — stored and audited, but PO sourcing still always uses the default distributor. See GAPS.md.',
  always_secondary_source: 'Not yet wired — stored and audited, but PO sourcing still always uses the default distributor. See GAPS.md.',
};

export default function Overrides() {
  const qc = useQueryClient();
  const { data: overrides, isLoading } = useQuery({ queryKey: ['overrides'], queryFn: api.getOverrides });
  const { data: formulary } = useQuery({ queryKey: ['formulary'], queryFn: api.getFormulary });
  const [showForm, setShowForm] = useState(false);
  const [ndc, setNdc] = useState('');
  const [type, setType] = useState(TYPES[0]);
  const [rationale, setRationale] = useState('');
  const [parLevelDays, setParLevelDays] = useState('');
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [selected, setSelected] = useState<Override | null>(null);

  const needsParLevel = type === 'custom_par_level';

  const createMutation = useMutation({
    mutationFn: () => {
      const drug = formulary?.find(f => f.ndc === ndc);
      return api.createOverride({
        ndc, genericName: drug?.genericName, type, rationale,
        parLevelDays: needsParLevel ? Number(parLevelDays) : undefined,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['overrides'] });
      setConflictWarning(res.conflictWarning);
      if (!res.conflictWarning) { setShowForm(false); setNdc(''); setRationale(''); setParLevelDays(''); }
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.toggleOverride(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['overrides'] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">My Rules</h1>
        <Button variant="primary" onClick={() => setShowForm(x => !x)}>+ Add Rule</Button>
      </div>
      <p className="text-sm text-an-fg-subtle mb-4">Persistent buyer preferences the agent applies to future recommendations automatically.</p>

      {showForm && (
        <Card className="mb-4">
          <div className="grid gap-2 mb-2">
            <select value={ndc} onChange={e => setNdc(e.target.value)} className="h-9 px-3 rounded-md bg-an-bg-elevated border border-an-border text-sm">
              <option value="">Select a drug…</option>
              {formulary?.map(f => <option key={f.ndc} value={f.ndc}>{f.genericName} ({f.ndc})</option>)}
            </select>
            <select value={type} onChange={e => setType(e.target.value)} className="h-9 px-3 rounded-md bg-an-bg-elevated border border-an-border text-sm">
              {TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <div className="text-xs text-an-fg-subtle -mt-1">{WIRING_NOTE[type]}</div>
            {needsParLevel && (
              <input
                type="number" min={1} placeholder="Target days of supply (required)"
                value={parLevelDays} onChange={e => setParLevelDays(e.target.value)}
                className="h-9 px-3 rounded-md bg-an-bg-elevated border border-an-border text-sm"
              />
            )}
            <textarea placeholder="Rationale (required — this is the explainability source)" value={rationale} onChange={e => setRationale(e.target.value)} className="h-20 px-3 py-2 rounded-md bg-an-bg-elevated border border-an-border text-sm" />
          </div>
          {conflictWarning && <div className="text-xs text-an-warning mb-2">⚠ {conflictWarning}</div>}
          <Button
            variant="primary"
            disabled={!ndc || !rationale || (needsParLevel && !(Number(parLevelDays) > 0)) || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Save rule
          </Button>
        </Card>
      )}

      {isLoading && <Spinner />}
      {overrides && overrides.length === 0 && <EmptyState>No rules yet.</EmptyState>}
      <div className="border border-an-border rounded-lg overflow-hidden">
        {overrides?.map(o => (
          <div
            key={o.id}
            className="flex items-center justify-between px-4 py-3 border-b border-an-border last:border-b-0 cursor-pointer hover:bg-an-bg-surface"
            onClick={() => setSelected(o)}
          >
            <div>
              <div className="text-sm font-medium">{o.genericName || o.ndc} <span className="text-an-fg-subtle font-normal">— {o.type.replace(/_/g, ' ')}</span></div>
              <div className="text-xs text-an-fg-subtle">{o.storeId ? `Store ${o.storeId}` : 'All stores'} · {o.rationale}</div>
            </div>
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <Badge tone={o.active ? 'success' : 'neutral'}>{o.active ? 'active' : 'inactive'}</Badge>
              <button className="text-xs text-an-fg-subtle underline" onClick={() => toggleMutation.mutate({ id: o.id, active: !o.active })}>
                {o.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <RuleDetailDrawer
          override={selected}
          onClose={() => setSelected(null)}
          onToggled={(active) => { setSelected(s => (s ? { ...s, active } : s)); qc.invalidateQueries({ queryKey: ['overrides'] }); }}
        />
      )}
    </div>
  );
}

const TYPE_EXPLAINER: Record<string, string> = {
  never_substitute: "The agent will never propose a substitute for this drug, even during an active shortage — it surfaces the shortage and stops there.",
  preferred_distributor: 'When this drug is reordered, the agent prefers the specified distributor over the usual contract-price ranking.',
  custom_par_level: "Overrides the default target days-of-supply used to compute this drug's recommended order quantity.",
  never_generic: 'The agent will always recommend the brand-name product for this drug, never a generic equivalent.',
  always_secondary_source: 'The agent sources this drug from the secondary/backup distributor by default, not the primary contract distributor.',
};

function RuleDetailDrawer({ override, onClose, onToggled }: { override: Override; onClose: () => void; onToggled: (active: boolean) => void }) {
  const qc = useQueryClient();
  const { data: history, isLoading } = useQuery({
    queryKey: ['auditForOverride', override.id],
    queryFn: () => api.getAudit({ entity_type: 'buyer_override', entity_id: override.id }),
  });
  const toggleMutation = useMutation({
    mutationFn: () => api.toggleOverride(override.id, !override.active),
    onSuccess: (updated) => {
      onToggled(updated.active);
      qc.invalidateQueries({ queryKey: ['auditForOverride', override.id] });
    },
  });

  return (
    <Drawer open title={override.genericName || override.ndc} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <Badge tone={override.active ? 'success' : 'neutral'}>{override.active ? 'active' : 'inactive'}</Badge>
          <span className="text-xs text-an-fg-subtle">{override.type.replace(/_/g, ' ')}</span>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-2">What this rule does</div>
          <div className="text-sm bg-an-bg-subtle rounded-md p-3">{TYPE_EXPLAINER[override.type] ?? 'Applied automatically by the agent whenever this drug is considered for reorder.'}</div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm bg-an-bg-surface rounded-md p-3">
          <div className="text-an-fg-subtle text-xs">Drug</div>
          <div className="font-mono text-xs">{override.genericName || '—'} ({override.ndc})</div>
          <div className="text-an-fg-subtle text-xs">Scope</div>
          <div className="text-xs">{override.storeId ? `Store ${override.storeId} only` : 'All stores'}</div>
          <div className="text-an-fg-subtle text-xs">Created by</div>
          <div className="text-xs">{override.buyerId}</div>
          <div className="text-an-fg-subtle text-xs">Created</div>
          <div className="text-xs">{new Date(override.createdDate).toLocaleString()}</div>
          <div className="text-an-fg-subtle text-xs">Rule ID</div>
          <div className="font-mono text-xs">{override.id}</div>
          {override.type === 'custom_par_level' && (
            <>
              <div className="text-an-fg-subtle text-xs">Target days of supply</div>
              <div className="text-xs">{override.parLevelDays ?? <span className="text-an-warning">not set — this rule has no effect on order quantity</span>}</div>
            </>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-2">Rationale</div>
          <div className="text-sm bg-an-bg-surface rounded-md p-3">{override.rationale}</div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-2">History</div>
          {isLoading && <Spinner />}
          {history && history.length === 0 && <div className="text-xs text-an-fg-subtle">No audit history recorded for this rule.</div>}
          {history && history.length > 0 && (
            <ol className="space-y-2 text-xs">
              {history.map(h => (
                <li key={h.id} className="bg-an-bg-surface rounded-md p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{h.action.replace(/_/g, ' ')}</span>
                    <span className="text-an-fg-muted">{new Date(h.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-an-fg-subtle mb-1">by {h.actorRole}{h.actorUserId !== 'system' && ` (${h.actorUserId})`}</div>
                  {h.sources.length > 0 && (
                    <ul className="space-y-1 mt-1">
                      {h.sources.map((s, i) => <li key={i} className="text-an-fg-subtle">[{i + 1}] {s}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <Button variant="ghost" onClick={() => toggleMutation.mutate()} disabled={toggleMutation.isPending}>
          {override.active ? 'Deactivate this rule' : 'Reactivate this rule'}
        </Button>
      </div>
    </Drawer>
  );
}
