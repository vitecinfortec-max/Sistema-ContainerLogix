import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Truck, ClipboardCheck, Users, DatabaseBackup } from 'lucide-react';
import { offlineMovements, offlineInspections } from '../lib/offlineDb';

export default function OfflineHomePage() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({ movements: 0, inspections: 0 });

  useEffect(() => {
    (async () => {
      const [movements, inspections] = await Promise.all([offlineMovements.list(), offlineInspections.list()]);
      setCounts({ movements: movements.length, inspections: inspections.length });
    })();
  }, []);

  const items = [
    { icon: Truck, label: 'Gate', count: counts.movements, path: '/movements' },
    { icon: ClipboardCheck, label: 'Vistoria de Container', count: counts.inspections, path: '/inspections' },
    { icon: Users, label: 'Cadastros Básicos', path: '/registries' },
    { icon: DatabaseBackup, label: 'Backup', path: '/backup' },
  ];

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-2xl font-bold mb-1">ContainerLogix</h1>
      <p className="text-sm text-muted-foreground mb-4">Modo offline — dados salvos neste aparelho</p>

      {items.map(({ icon: Icon, label, count, path }) => (
        <Card key={path} className="cursor-pointer active:opacity-70" onClick={() => navigate(path)}>
          <CardHeader className="flex-row items-center gap-3 space-y-0 py-4">
            <Icon className="w-6 h-6 text-primary" />
            <CardTitle className="text-base flex-1">{label}</CardTitle>
            {count !== undefined && <span className="text-sm text-muted-foreground">{count}</span>}
          </CardHeader>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground text-center pt-4">
        Lembre-se de fazer backup periodicamente na tela "Backup".
      </p>
    </div>
  );
}
