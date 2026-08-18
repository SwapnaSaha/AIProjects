import { useEffect, useState } from 'react';
import { useAuth } from './state/auth';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Queue from './pages/Queue';
import Shortages from './pages/Shortages';
import Overrides from './pages/Overrides';
import Audit from './pages/Audit';
import Dashboard from './pages/Dashboard';

type View = 'queue' | 'shortages' | 'overrides' | 'audit' | 'dashboard';

// sessionStorage (not localStorage) is the point: cleared when the tab/window closes, so
// a genuinely fresh invocation of the app always lands on the marketing page first — even
// if a valid session is still sitting in localStorage — but a same-tab page refresh
// mid-session doesn't force a detour back through Landing/Login every time.
const ENTERED_KEY = 'rxf_entered_session';

const NAV: { id: View; label: string; roles: string[] }[] = [
  { id: 'queue', label: 'Reorder Queue', roles: ['buyer', 'pic'] },
  { id: 'shortages', label: 'Shortages', roles: ['buyer', 'pic', 'pharmacist'] },
  { id: 'overrides', label: 'Rules', roles: ['buyer'] },
  { id: 'audit', label: 'Audit Trail', roles: ['compliance', 'director'] },
  // Director-only (added 2026-08-17) — engg.md FEATURE_8 always scoped this to the
  // Director of Supply Chain role; buyer access here was a prototype inconsistency,
  // not an intentional deviation, now corrected to match the spec.
  { id: 'dashboard', label: 'Dashboard', roles: ['director'] },
];

function App() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<View>('queue');
  const [hasEntered, setHasEntered] = useState(() => sessionStorage.getItem(ENTERED_KEY) === 'true');

  // Sign-out returns to the persona selector (Login), not all the way back to Landing —
  // hasEntered/sessionStorage is deliberately left untouched here, so the app falls
  // straight to the `!user` branch below. Landing is only for a genuinely fresh
  // invocation (see ENTERED_KEY's comment) or the explicit "← Back" link on Login.
  function handleSignOut() {
    logout();
  }

  useEffect(() => {
    if (!user) return;
    if (user.role === 'director') setView('dashboard');
    else if (user.role === 'compliance') setView('audit');
    else {
      // Was hardcoded to 'queue' for every other role — broke for pharmacist (found
      // 2026-08-17 during a full click-through): pharmacist's only NAV entry is
      // 'shortages', so they landed on a Queue view with no matching nav button and
      // could act on it, directly contradicting what Login.tsx documents as off-limits
      // to that persona. Deriving the default from NAV itself means this can't drift
      // out of sync again if NAV's role lists ever change.
      const firstAllowed = NAV.find(n => n.roles.includes(user.role));
      setView(firstAllowed?.id ?? 'queue');
    }
  }, [user]);

  // No router in this prototype (react-router was deliberately removed — see GAPS.md);
  // this mirrors the same state-based view switching the authenticated app already uses
  // below, just for the two pre-auth screens.
  if (!hasEntered) {
    return <Landing onExplore={() => { sessionStorage.setItem(ENTERED_KEY, 'true'); setHasEntered(true); }} />;
  }

  if (!user) {
    return <Login onBack={() => { sessionStorage.removeItem(ENTERED_KEY); setHasEntered(false); }} />;
  }

  const visibleNav = NAV.filter(n => n.roles.includes(user.role));

  return (
    <div className="flex h-screen bg-an-bg-base text-an-fg-base">
      <aside className="w-64 bg-an-bg-subtle border-r border-an-border flex flex-col shrink-0">
        <div className="px-6 py-6">
          <div className="font-mono text-xs uppercase tracking-widest text-an-accent">RxForecast</div>
          <div className="text-xs text-an-fg-muted mt-0.5">Prototype build</div>
        </div>
        <nav className="flex-1 px-2 space-y-1">
          {visibleNav.map(n => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={`w-full text-left h-9 px-3 rounded-md text-sm ${view === n.id ? 'bg-an-bg-elevated text-an-fg-base' : 'text-an-fg-subtle hover:bg-an-bg-surface hover:text-an-fg-base'}`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-an-border">
          <div className="text-sm">{user.name}</div>
          <div className="text-xs text-an-fg-muted capitalize mb-2">{user.role}{user.storeId ? ` · ${user.storeId}` : ''}</div>
          <button onClick={handleSignOut} className="text-xs text-an-fg-subtle underline">Sign out</button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        {view === 'queue' && <Queue />}
        {view === 'shortages' && <Shortages />}
        {view === 'overrides' && <Overrides />}
        {view === 'audit' && <Audit />}
        {view === 'dashboard' && <Dashboard />}
      </main>
    </div>
  );
}

export default App;
