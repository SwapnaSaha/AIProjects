import { useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AuditEntry } from '../api/client';
import { Badge, Drawer, EmptyState, Spinner } from '../components/ui';

const ACTION_TONE: Record<string, 'error' | 'warning' | 'success' | 'neutral'> = {
  approved: 'success', bulk_approve: 'success', substitution_accepted: 'success',
  reactivated: 'success', created: 'neutral',
  rejected: 'error', substitution_rejected: 'error', deactivated: 'warning',
  edi_850_transmitted: 'neutral', edi_855_received: 'neutral', edi_856_received: 'success',
};

const ENTITY_LABEL: Record<string, string> = {
  purchase_order: 'Purchase order',
  queue_recommendation: 'Reorder recommendation',
  queue_bulk_action: 'Bulk approve action',
  buyer_override: 'Buyer/PIC rule override',
  substitution: 'Shortage substitution',
};

function describe(entry: AuditEntry): string {
  const who = `${entry.actorRole}${entry.actorUserId === 'system' ? '' : ` (${entry.actorUserId})`}`;
  switch (`${entry.entityType}:${entry.action}`) {
    case 'purchase_order:approved':
      return `${who} approved a purchase order${entry.payload.modified ? ', modifying the agent-recommended quantity' : ' as recommended by the agent'}.`;
    case 'purchase_order:rejected':
      return `${who} rejected a purchase order.`;
    case 'purchase_order:edi_850_transmitted':
      return `System transmitted an X12 850 purchase order to the distributor.`;
    case 'purchase_order:edi_855_received':
      return `Distributor sent back an X12 855 functional acknowledgement.`;
    case 'purchase_order:edi_856_received':
      return `Distributor sent an X12 856 advance ship notice — order confirmed shipped.`;
    case 'queue_recommendation:rejected':
      return `${who} rejected the agent's reorder recommendation before any PO was drafted.`;
    case 'queue_bulk_action:bulk_approve':
      return `${who} bulk-approved ${entry.payload.requested} reorder queue rows in one action (${entry.payload.approved} succeeded, ${entry.payload.failed} needed attention).`;
    case 'buyer_override:created':
      return `${who} created a standing buyer/PIC override rule${entry.payload.auto ? ' automatically, from an accepted shortage substitution' : ''}.`;
    case 'buyer_override:reactivated':
      return `${who} reactivated a previously deactivated override rule.`;
    case 'buyer_override:deactivated':
      return `${who} deactivated an override rule.`;
    case 'substitution:substitution_accepted':
      return `${who} accepted a shortage substitution recommendation.`;
    case 'substitution:substitution_rejected':
      return `${who} rejected a shortage substitution recommendation.`;
    default:
      return `${who} performed "${entry.action}" on ${ENTITY_LABEL[entry.entityType] ?? entry.entityType} ${entry.entityId}.`;
  }
}

const PAYLOAD_KEY_LABEL: Record<string, string> = {
  storeId: 'Store', ndc: 'NDC', drugName: 'Drug', quantityAgent: 'Agent-recommended qty', quantityFinal: 'Final qty',
  modified: 'Modified from agent recommendation', distributorId: 'Distributor', unitPrice: 'Unit price',
  reason: 'Reason', requested: 'Rows requested', approved: 'Rows approved', failed: 'Rows failed',
  auto: 'Auto-created', fromSubstitution: 'From substitution', shortageId: 'Shortage', originalNdc: 'Original NDC',
  chosenAltNdc: 'Chosen alternative NDC', ackStatus: 'Acknowledgement status', promisedDate: 'Promised ship date',
  shortageLinked: 'Linked to active shortage', type: 'Rule type', rationale: 'Rationale', genericName: 'Generic name',
  buyerId: 'Created by', createdDate: 'Created', active: 'Active',
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  return String(v);
}

export default function Audit() {
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['audit'], queryFn: () => api.getAudit() });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Audit Trail</h1>
      <p className="text-sm text-an-fg-subtle mb-4">
        Every recommendation, override, substitution, and PO action, with actor and rationale. Click any entry for full explainability and citations.
      </p>
      {isLoading && <Spinner />}
      {data && data.length === 0 && <EmptyState>No activity yet — approve a reorder or decide a substitution to see entries here.</EmptyState>}
      <div className="border border-an-border rounded-lg overflow-hidden text-sm">
        {data?.map(entry => (
          <div
            key={entry.id}
            className="px-4 py-2.5 border-b border-an-border last:border-b-0 font-mono text-xs flex items-start gap-4 cursor-pointer hover:bg-an-bg-surface"
            onClick={() => setSelected(entry)}
          >
            <span className="text-an-fg-muted whitespace-nowrap">{new Date(entry.createdAt).toLocaleTimeString()}</span>
            <span className="text-an-accent whitespace-nowrap">{entry.action}</span>
            <span className="text-an-fg-subtle whitespace-nowrap">{entry.entityType}:{entry.entityId}</span>
            <span className="text-an-fg-muted whitespace-nowrap">by {entry.actorRole}</span>
            <span className="text-an-fg-subtle truncate">{JSON.stringify(entry.payload)}</span>
            {entry.sources.length > 0 && <span className="text-an-fg-muted whitespace-nowrap ml-auto">{entry.sources.length} citation{entry.sources.length > 1 ? 's' : ''}</span>}
          </div>
        ))}
      </div>

      {selected && <AuditDetailDrawer entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AuditDetailDrawer({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const isPo = entry.entityType === 'purchase_order';
  const { data: po } = useQuery({
    queryKey: ['po', entry.entityId],
    queryFn: () => api.getPo(entry.entityId),
    enabled: isPo,
    retry: false,
  });

  return (
    <Drawer open title={`${entry.action.replace(/_/g, ' ')} — ${entry.id}`} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <Badge tone={ACTION_TONE[entry.action] ?? 'neutral'}>{entry.action.replace(/_/g, ' ')}</Badge>
          <span className="text-xs text-an-fg-subtle">{ENTITY_LABEL[entry.entityType] ?? entry.entityType} · {entry.entityId}</span>
        </div>

        <div className="text-sm bg-an-bg-subtle rounded-md p-3">{describe(entry)}</div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="text-an-fg-subtle">Actor</div>
          <div>{entry.actorRole}{entry.actorUserId !== 'system' && ` (${entry.actorUserId})`}</div>
          <div className="text-an-fg-subtle">Timestamp</div>
          <div>{new Date(entry.createdAt).toLocaleString()}</div>
          <div className="text-an-fg-subtle">Audit ID</div>
          <div className="font-mono">{entry.id}</div>
        </div>

        {Object.keys(entry.payload).length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-2">Details</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm bg-an-bg-surface rounded-md p-3">
              {Object.entries(entry.payload).map(([k, v]) => (
                <Fragment key={k}>
                  <div className="text-an-fg-subtle text-xs">{PAYLOAD_KEY_LABEL[k] ?? k}</div>
                  <div className="font-mono text-xs break-all">{formatValue(v)}</div>
                </Fragment>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-2">
            Explainability & citations {entry.sources.length === 0 && <span className="normal-case text-an-fg-muted">(none recorded for this entry)</span>}
          </div>
          {entry.sources.length > 0 && (
            <ol className="space-y-1.5 text-xs">
              {entry.sources.map((s, i) => (
                <li key={i} className="flex gap-2 bg-an-bg-surface rounded-md p-2">
                  <span className="text-an-fg-muted shrink-0">[{i + 1}]</span>
                  <span className="text-an-fg-base">{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {isPo && po && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-2">Linked purchase order — {po.id} ({po.status})</div>
            {po.ediRaw850 && (
              <details className="mt-1">
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
    </Drawer>
  );
}
