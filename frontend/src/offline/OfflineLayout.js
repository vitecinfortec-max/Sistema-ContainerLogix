import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Truck, ClipboardCheck, Users, DatabaseBackup } from 'lucide-react';

const TABS = [
  { path: '/home', icon: Home, label: 'Início' },
  { path: '/movements', icon: Truck, label: 'Movim.' },
  { path: '/inspections', icon: ClipboardCheck, label: 'Vistoria' },
  { path: '/registries', icon: Users, label: 'Cadastros' },
  { path: '/backup', icon: DatabaseBackup, label: 'Backup' },
];

export default function OfflineLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 overflow-y-auto pb-16">
        {children}
      </div>
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-2 z-50">
        {TABS.map(({ path, icon: Icon, label }) => {
          const active = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 text-xs ${active ? 'text-primary font-semibold' : 'text-muted-foreground'}`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
