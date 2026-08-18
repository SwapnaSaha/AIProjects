import { useState } from 'react';
import { useAuth } from '../state/auth';
import { Button } from '../components/ui';

// Capability lists are grounded in what's actually enforced, not aspirational: App.tsx's
// NAV role list (which pages each role can even navigate to), the store-scope check in
// middleware/auth.js (PIC only), and the Schedule II hard-block in shortages.js (applies
// to every role, no exceptions). Nothing here claims a restriction the backend doesn't
// actually have, or a capability the UI doesn't actually expose.
const ROLES = [
  {
    id: 'buyer',
    label: 'Buyer',
    desc: 'Category Buyer / Pharmacy Procurement Manager',
    canDo: [
      'Review and approve the reorder queue — single or bulk — across all stores',
      'Edit recommended quantities, defer, or reject queue items',
      'Review shortage alerts and accept/reject substitute recommendations',
      'Create and manage persistent buyer override rules',
    ],
    cannotDo: [
      'Approve a Schedule II substitution — always hard-blocked, routed to pharmacist review',
      'View the compliance audit trail',
      'View the ROI/KPI dashboard — director-only (engg.md FEATURE_8)',
    ],
  },
  {
    id: 'director',
    label: 'Director',
    desc: 'Director of Supply Chain',
    canDo: [
      'View the ROI/KPI dashboard (stockout reduction, working capital, savings)',
      'View the complete, chain-wide compliance audit trail',
    ],
    cannotDo: [
      'Approve, edit, defer, or reject anything in the reorder queue',
      'Accept or reject substitutions, or create override rules',
    ],
  },
  {
    id: 'pic',
    label: 'Pharmacist-in-Charge',
    desc: 'Store-level operations',
    canDo: [
      'Review and approve the reorder queue for their own store',
      'Review shortage alerts and substitutions for their own store',
    ],
    cannotDo: [
      "View or act on any other store's data — enforced server-side (403), not just hidden in the UI",
      'Manage override rules, view the audit trail, or view the dashboard',
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance Officer',
    desc: 'Oversight — read-only',
    canDo: [
      'View the complete, chain-wide audit trail with full citation detail on every entry',
    ],
    cannotDo: [
      'Take any operational action anywhere in the app — no queue, shortages, or override access',
    ],
  },
  {
    id: 'pharmacist',
    label: 'Pharmacist SME',
    desc: 'Substitution safety sign-off',
    canDo: [
      'Review shortage-driven substitution recommendations for clinical/safety appropriateness',
    ],
    cannotDo: [
      'Touch the reorder queue, override rules, audit trail, or dashboard',
    ],
  },
];

export default function Login({ onBack }: { onBack?: () => void }) {
  const { login } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function handleLogin(role: string) {
    setLoading(role);
    setError(null);
    try {
      await login(role);
    } catch {
      setError('Could not sign in — is the backend running on :4000?');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div data-theme="light" className="min-h-screen flex items-center justify-center bg-an-bg-base py-12">
      <div className="w-full max-w-lg">
        {onBack && (
          <button onClick={onBack} className="text-xs text-an-fg-subtle hover:text-an-fg-base mb-4">← Back</button>
        )}
        <div className="mb-2 text-xs font-mono uppercase tracking-widest text-an-accent">RxForecast — Prototype</div>
        <h1 className="text-3xl font-semibold mb-2" style={{ fontFamily: 'Lora, Georgia, serif' }}>Persona Selector</h1>
        <p className="text-an-fg-subtle text-sm mb-6">
          This demo has no real password/SSO — pick a role to see RxForecast from that persona's view.
          Each persona has genuinely different access, not just a different label — expand a role to see what it
          can and can't do.
        </p>
        <div className="space-y-2">
          {ROLES.map(r => {
            const isExpanded = expanded === r.id;
            return (
              <div key={r.id} className="border border-an-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpanded(isExpanded ? null : r.id)}
                  className="w-full text-left p-3 hover:bg-an-bg-surface transition flex items-start justify-between gap-3"
                >
                  <div>
                    <div className="font-medium">{r.label}</div>
                    <div className="text-xs text-an-fg-subtle">{r.desc}</div>
                  </div>
                  <span className="text-an-fg-subtle text-xs mt-1 shrink-0">{isExpanded ? '▲' : '▼'}</span>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-an-border bg-an-bg-subtle">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mt-2">
                      <div>
                        <div className="font-medium text-an-success mb-1">Can do</div>
                        <ul className="space-y-1 text-an-fg-subtle">
                          {r.canDo.map(item => <li key={item} className="flex gap-1.5"><span className="text-an-success">✓</span><span>{item}</span></li>)}
                        </ul>
                      </div>
                      <div>
                        <div className="font-medium text-an-error mb-1">Cannot do</div>
                        <ul className="space-y-1 text-an-fg-subtle">
                          {r.cannotDo.map(item => <li key={item} className="flex gap-1.5"><span className="text-an-error">✕</span><span>{item}</span></li>)}
                        </ul>
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      className="mt-3 h-8 px-4 text-xs w-full"
                      onClick={() => handleLogin(r.id)}
                      disabled={loading !== null}
                    >
                      {loading === r.id ? 'Signing in…' : `Sign in as ${r.label}`}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {error && <div className="mt-4 text-sm text-an-error">{error}</div>}
        <div className="mt-6">
          <Button variant="ghost" onClick={() => handleLogin('buyer')} disabled={loading !== null}>Quick start as Buyer</Button>
        </div>
      </div>
    </div>
  );
}
