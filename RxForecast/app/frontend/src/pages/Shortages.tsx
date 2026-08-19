import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Shortage, type Substitution } from '../api/client';
import { Badge, Button, Card, EmptyState, Spinner } from '../components/ui';

const SEVERITY_TONE: Record<string, 'error' | 'warning'> = {
  'Full shortage - no supply': 'error',
};

export default function Shortages() {
  const { data: shortages, isLoading } = useQuery({ queryKey: ['shortages', 'current'], queryFn: () => api.getShortages('current') });
  const { data: feedStatus } = useQuery({ queryKey: ['shortages', 'feed-status'], queryFn: api.getShortageFeedStatus, refetchInterval: 60_000 });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Shortage Alerts</h1>
      <p className="text-sm text-an-fg-subtle mb-4">
        Mapped to your formulary from FDA/ASHP feeds, with proposed substitutes.{' '}
        {feedStatus?.liveFeedActive ? (
          <span className="text-an-fg-muted">(Live openFDA feed active — this synthetic demo formulary uses fictional NDCs, so 0 results here is expected; see GAPS.md.)</span>
        ) : (
          <span className="text-an-fg-muted">(This prototype re-presents a sample of historical shortage records as active for demo purposes — see GAPS.md.)</span>
        )}
      </p>
      {isLoading && <Spinner />}
      {shortages && shortages.length === 0 && (
        <EmptyState>
          No active shortages affecting your formulary.
          {feedStatus?.liveFeedActive && ' (Live FDA feed — expected with this demo’s fictional NDCs.)'}
        </EmptyState>
      )}
      <div className="space-y-3">
        {shortages?.map(s => <ShortageCard key={s.id} shortage={s} />)}
      </div>
    </div>
  );
}

function ShortageCard({ shortage }: { shortage: Shortage }) {
  const [expanded, setExpanded] = useState(false);
  const { data: subs } = useQuery({
    queryKey: ['substitutions', shortage.id],
    queryFn: () => api.getSubstitutions(shortage.id),
    enabled: expanded,
  });

  return (
    <Card>
      <button className="w-full text-left flex items-start justify-between" onClick={() => setExpanded(x => !x)}>
        <div>
          <div className="font-medium">{shortage.genericName} <span className="text-an-fg-subtle font-normal text-sm">({shortage.ndc})</span></div>
          <div className="text-xs text-an-fg-subtle mt-1">{shortage.reason} · reported {shortage.dateReported} · source: {shortage.source}</div>
        </div>
        <Badge tone={SEVERITY_TONE[shortage.severity] || 'warning'}>{shortage.severity}</Badge>
      </button>
      {expanded && (
        <div className="mt-4 border-t border-an-border pt-4 space-y-3">
          {shortage.bulletinExcerpt && (
            <pre className="text-[11px] font-mono bg-an-bg-elevated p-3 rounded-md overflow-x-auto whitespace-pre-wrap text-an-fg-subtle">{shortage.bulletinExcerpt}</pre>
          )}
          {subs === undefined && <Spinner />}
          {subs?.length === 0 && <div className="text-sm text-an-fg-subtle">No live recommendations for this shortage.</div>}
          {subs?.map(sub => <SubstitutionRow key={sub.id} sub={sub} />)}
        </div>
      )}
    </Card>
  );
}

function SubstitutionRow({ sub }: { sub: Substitution }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (payload: { decision: 'accept' | 'reject'; altNdc?: string }) => api.decideSubstitution(sub.id, payload.decision, payload.altNdc),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['substitutions', sub.shortageId] }),
    onError: (e: unknown) => setError(e instanceof ApiError ? e.detail : 'Something went wrong.'),
  });

  if (sub.decision !== 'pending') {
    return (
      <div className="text-sm bg-an-bg-subtle rounded-md p-3 flex items-center justify-between">
        <span>{sub.storeId} — {sub.originalGenericName}</span>
        <Badge tone={sub.decision === 'accepted' ? 'success' : 'neutral'}>{sub.decision}</Badge>
      </div>
    );
  }

  if (sub.options.length === 0 && sub.ruleApplied?.type === 'never_substitute') {
    return (
      <div className="bg-an-bg-subtle rounded-md p-3">
        <div className="text-sm font-medium mb-1">{sub.storeId} — {sub.originalGenericName}</div>
        <div className="text-xs text-an-fg-subtle">
          No substitutes offered — an active <Badge tone="accent">never substitute</Badge> rule blocks this drug (rationale: "{sub.ruleApplied.rationale}").
        </div>
      </div>
    );
  }

  return (
    <div className="bg-an-bg-subtle rounded-md p-3">
      <div className="text-sm font-medium mb-2">{sub.storeId} — {sub.originalGenericName}</div>
      {sub.ruleApplied?.type === 'never_generic' && (
        <div className="text-[11px] text-an-fg-subtle mb-2">Restricted to brand-name alternatives per an active <Badge tone="accent">never generic</Badge> rule.</div>
      )}
      <div className="space-y-2">
        {sub.options.map(opt => (
          <div key={opt.altNdc} className={`text-xs rounded-md p-2 ${opt.blocked ? 'bg-an-critical/15 border border-an-critical' : 'bg-an-bg-surface'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">{opt.altGenericName}</span>
              {opt.teMatch && <Badge tone="success">TE match</Badge>}
              {opt.blocked && <Badge tone="critical">Schedule II — blocked</Badge>}
            </div>
            <div className="text-an-fg-subtle">{opt.rationale}</div>
            {!opt.blocked && (
              <Button variant="primary" className="mt-2 h-7 px-3 text-xs" onClick={() => decide.mutate({ decision: 'accept', altNdc: opt.altNdc })} disabled={decide.isPending}>
                Accept this substitute
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button className="text-xs text-an-fg-subtle underline" onClick={() => decide.mutate({ decision: 'reject' })} disabled={decide.isPending}>
          Reject — escalate to pharmacist
        </button>
      </div>
      {error && <div className="text-xs text-an-critical mt-2">{error}</div>}
      <div className="text-[10px] text-an-fg-muted mt-2">{sub.confidence != null ? `Confidence: ${(sub.confidence * 100).toFixed(0)}% · ` : ''}SIMULATED reasoning (see GAPS.md — production uses Claude via Azure AI Foundry)</div>
    </div>
  );
}
