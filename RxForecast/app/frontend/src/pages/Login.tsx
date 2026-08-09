import { useState } from 'react';
import { useAuth } from '../state/auth';
import { Button } from '../components/ui';

const ROLES = [
  { id: 'buyer', label: 'Buyer', desc: 'Category Buyer / Pharmacy Procurement Manager — daily reorder queue, shortages, approvals' },
  { id: 'director', label: 'Director', desc: 'Director of Supply Chain — ROI dashboard, KPIs' },
  { id: 'pic', label: 'Pharmacist-in-Charge', desc: 'Store-level, flags recommendations' },
  { id: 'compliance', label: 'Compliance Officer', desc: 'Full audit trail access' },
  { id: 'pharmacist', label: 'Pharmacist SME', desc: 'Substitution safety sign-off' },
];

export default function Login() {
  const { login } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div data-theme="light" className="min-h-screen flex items-center justify-center bg-an-bg-base">
      <div className="w-full max-w-md">
        <div className="mb-2 text-xs font-mono uppercase tracking-widest text-an-accent">RxForecast — Prototype</div>
        <h1 className="text-3xl font-semibold mb-2" style={{ fontFamily: 'Lora, Georgia, serif' }}>Sign in</h1>
        <p className="text-an-fg-subtle text-sm mb-6">
          This demo has no real password/SSO — pick a role to see RxForecast from that persona's view.
        </p>
        <div className="space-y-2">
          {ROLES.map(r => (
            <button
              key={r.id}
              onClick={() => handleLogin(r.id)}
              disabled={loading !== null}
              className="w-full text-left border border-an-border rounded-lg p-3 hover:bg-an-bg-surface transition disabled:opacity-50"
            >
              <div className="font-medium">{r.label}</div>
              <div className="text-xs text-an-fg-subtle">{r.desc}</div>
              {loading === r.id && <div className="text-xs text-an-accent mt-1">Signing in…</div>}
            </button>
          ))}
        </div>
        {error && <div className="mt-4 text-sm text-an-error">{error}</div>}
        <div className="mt-6">
          <Button variant="ghost" onClick={() => handleLogin('buyer')} disabled={loading !== null}>Quick start as Buyer</Button>
        </div>
      </div>
    </div>
  );
}
