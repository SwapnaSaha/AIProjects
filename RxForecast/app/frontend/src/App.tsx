import { useEffect, useState } from 'react';
import { useAuth } from './state/auth';
import Login from './pages/Login';
import Queue from './pages/Queue';
import Shortages from './pages/Shortages';
import Overrides from './pages/Overrides';
import Audit from './pages/Audit';
import Dashboard from './pages/Dashboard';

type View = 'queue' | 'shortages' | 'overrides' | 'audit' | 'dashboard';

const NAV: { id: View; label: string; roles: string[] }[] = [
  { id: 'queue', label: 'Reorder Queue', roles: ['buyer', 'pic'] },
  { id: 'shortages', label: 'Shortages', roles: ['buyer', 'pic', 'pharmacist'] },
  { id: 'overrides', label: 'Rules', roles: ['buyer'] },
  { id: 'audit', label: 'Audit Trail', roles: ['compliance', 'director'] },
  { id: 'dashboard', label: 'Dashboard', roles: ['director', 'buyer'] },
];

function App() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<View>('queue');

  useEffect(() => {
    if (!user) return;
    if (user.role === 'director') setView('dashboard');
    else if (user.role === 'compliance') setView('audit');
    else setView('queue');
  }, [user]);

  if (!user) return <Login />;

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
          <button onClick={logout} className="text-xs text-an-fg-subtle underline">Sign out</button>
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
