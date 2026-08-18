import { Button, Card } from '../components/ui';

const CAPABILITIES: { title: string; desc: string; icon: React.ReactNode }[] = [
  {
    title: 'Demand Forecasting',
    desc: 'Trailing-average forecasts with confidence bands, per store and SKU — flags cold-start items instead of guessing.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
        <path d="M3 17l5-5 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Live Shortage Intelligence',
    desc: 'Polls the FDA Drug Shortages feed and maps active shortages directly onto your formulary.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
        <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Substitution Reasoning',
    desc: 'TE-code-matched alternatives with contract pricing — Schedule II swaps are always routed to pharmacist review, never auto-approved.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m0 8v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3m0-8V5a2 2 0 0 0-2-2h-3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Automated EDI Ordering',
    desc: 'Real ANSI X12 850/855 purchase orders, generated from the approved queue with full control-number sequencing.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Persistent Override Rules',
    desc: 'Buyer preferences on substitutions and sourcing stick — accepted decisions become reusable rules, not one-off overrides.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Compliance-Ready Audit Trail',
    desc: 'Every recommendation and decision is cited — a complete, append-only record from forecast to shipped order.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
        <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 12c0 4.4-3.6 8-9 9-5.4-1-9-4.6-9-9V5l9-3 9 3v7Z" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function Landing({ onExplore }: { onExplore: () => void }) {
  return (
    <div data-theme="light" className="min-h-screen bg-an-bg-base text-an-fg-base">
      <div className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <div className="mb-2 text-xs font-mono uppercase tracking-widest text-an-accent">Predictive EDI Ordering</div>
        <h1 className="text-4xl md:text-5xl font-medium mb-5 max-w-3xl" style={{ fontFamily: 'Lora, Georgia, serif' }}>
          RxForecast
        </h1>
        <p className="text-lg text-an-fg-subtle max-w-2xl mb-4 leading-relaxed">
          RxForecast is a predictive ordering agent for mid-market pharmacy chains. It forecasts demand, tracks
          live drug shortages, recommends clinically-sound substitutions, and drafts EDI purchase orders — so
          buyers spend less time reconciling spreadsheets and more time catching problems before they become
          stockouts.
        </p>
        <p className="text-sm text-an-fg-muted max-w-2xl mb-10">
          Right drug, right store, right time — without stockouts, write-offs, or compliance exposure.
        </p>

        <Button variant="primary" className="h-11 px-6 text-base" onClick={onExplore}>
          Explore RxForecast →
        </Button>

        <div className="mt-20">
          <div className="text-xs font-mono uppercase tracking-widest text-an-fg-subtle mb-5">What it does</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAPABILITIES.map(c => (
              <Card key={c.title} className="!bg-an-bg-surface">
                <div className="w-8 h-8 rounded-md bg-an-accent-subtle text-an-accent flex items-center justify-center mb-3">
                  {c.icon}
                </div>
                <div className="font-medium text-sm mb-1">{c.title}</div>
                <div className="text-xs text-an-fg-subtle leading-relaxed">{c.desc}</div>
              </Card>
            ))}
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-an-border text-xs text-an-fg-muted">
          Prototype build — in-memory demo data, no real SSO. See <code className="font-mono">GAPS.md</code> for what's real vs. simulated.
        </div>
      </div>
    </div>
  );
}
