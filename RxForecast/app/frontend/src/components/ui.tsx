import React from 'react';

export function Button({ variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'critical' }) {
  const base = 'h-9 px-4 rounded-md text-sm font-medium transition duration-150 ease-out disabled:opacity-40 disabled:cursor-not-allowed';
  const styles: Record<string, string> = {
    primary: 'bg-an-accent text-white hover:bg-an-accent-hover',
    ghost: 'bg-transparent text-an-fg-base border border-an-border hover:bg-an-bg-surface',
    danger: 'bg-an-error/15 text-an-error hover:bg-an-error/25',
    critical: 'bg-an-critical text-white hover:bg-an-critical',
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'error' | 'critical' | 'accent'; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    neutral: 'bg-an-bg-surface text-an-fg-muted',
    success: 'bg-an-success/15 text-an-success',
    warning: 'bg-an-warning/15 text-an-warning',
    error: 'bg-an-error/15 text-an-error',
    critical: 'bg-an-critical text-white',
    accent: 'bg-an-accent-subtle text-an-accent',
  };
  return (
    <span className={`inline-flex items-center h-5 px-2 rounded-full text-[11px] font-medium uppercase tracking-wide ${styles[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={`bg-an-bg-surface border border-an-border rounded-lg p-4 ${className}`}>{children}</div>;
}

export function KpiTile({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: boolean }) {
  return (
    <Card>
      <div className="text-[11px] uppercase tracking-wide text-an-fg-subtle mb-2">{label}</div>
      <div className={`text-2xl font-semibold ${accent ? 'text-an-accent' : 'text-an-fg-base'}`}>{value}</div>
      {sub && <div className="text-xs text-an-fg-subtle mt-1">{sub}</div>}
    </Card>
  );
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-[480px] max-w-full bg-an-bg-elevated flex flex-col shadow-xl" style={{ transition: 'transform 150ms cubic-bezier(0.16,1,0.3,1)' }}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-an-border">
          <div className="text-lg font-semibold">{title}</div>
          <button onClick={onClose} className="text-an-fg-subtle hover:text-an-fg-base w-6 h-6">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="border-t border-an-border p-4 sticky bottom-0 bg-an-bg-elevated">{footer}</div>}
      </div>
    </div>
  );
}

export function StatusStepper({ status, ackStatus }: { status: string; ackStatus: string | null }) {
  const stages = ['approved', 'transmitted', ['acked', 'backordered'], 'shipped'];
  const idx = stages.findIndex(s => Array.isArray(s) ? s.includes(status) : s === status);
  const labels = ['Approved', 'Transmitted', ackStatus === 'Backordered' || ackStatus === 'Partial Allocation' ? 'Backordered' : 'Acked', 'Shipped'];
  return (
    <div className="flex items-center gap-1">
      {labels.map((label, i) => {
        const done = i <= idx;
        const isBackorder = i === 2 && (status === 'backordered');
        const tone = isBackorder ? 'bg-an-warning' : done ? 'bg-an-success' : 'bg-an-fg-muted';
        return (
          <React.Fragment key={label}>
            {i > 0 && <div className={`h-px w-6 ${i <= idx ? 'bg-an-success' : 'bg-an-border'}`} />}
            <div className="flex flex-col items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${tone}`} />
              <div className="text-[10px] text-an-fg-subtle whitespace-nowrap">{label}</div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-16 text-an-fg-subtle text-sm">{children}</div>;
}

export function Spinner() {
  return <div className="text-an-fg-subtle text-sm py-8 text-center">Loading…</div>;
}
