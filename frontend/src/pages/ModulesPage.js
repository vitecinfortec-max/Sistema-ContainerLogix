import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Switch } from '../components/ui/switch';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useModuleConfig } from '../context/ModuleConfigContext';
import { LayoutGrid, Save } from 'lucide-react';

export default function ModulesPage() {
  const { reload: reloadModuleConfig } = useModuleConfig();
  const [catalog, setCatalog] = useState([]);
  const [disabled, setDisabled] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [catalogRes, configRes] = await Promise.all([
        api.getModuleCatalog(),
        api.getModuleConfig(),
      ]);
      setCatalog(catalogRes.data.catalog);
      setDisabled(configRes.data.disabled_modules || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao carregar módulos');
    } finally {
      setLoading(false);
    }
  };

  const isDisabled = (key) => disabled.includes(key);

  const toggleGroup = (groupKey, items) => {
    setDisabled((prev) => {
      const itemKeys = items.map((i) => i.key);
      if (prev.includes(groupKey)) {
        // Reativando o grupo inteiro - remove o grupo e todos os itens dele da lista
        return prev.filter((k) => k !== groupKey && !itemKeys.includes(k));
      }
      // Desativando o grupo inteiro - remove os itens individuais (redundante
      // com o grupo desativado) e adiciona só a chave do grupo
      return [...prev.filter((k) => !itemKeys.includes(k)), groupKey];
    });
  };

  const toggleItem = (groupKey, itemKey) => {
    setDisabled((prev) => {
      if (prev.includes(itemKey)) {
        return prev.filter((k) => k !== itemKey);
      }
      return [...prev, itemKey];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateModuleConfig(disabled);
      await reloadModuleConfig();
      toast.success('Módulos atualizados');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar módulos');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="modules-loading">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="modules-page">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-primary" />
              Módulos Contratados
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
              Controle o que este cliente pode usar. Desative um grupo inteiro ou só itens específicos —
              o resto dos usuários deste sistema deixa de enxergar o que estiver desativado aqui.
            </p>
          </div>
          <Button onClick={handleSave} disabled={saving} className="h-10 text-[13px] font-semibold" data-testid="save-modules-button">
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {catalog.map((group) => (
            <Card key={group.key}>
              <CardHeader className="bg-slate-50 dark:bg-slate-800 py-3">
                <CardTitle className="text-[13px] font-medium flex items-center justify-between">
                  <span>{group.label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-medium ${!isDisabled(group.key) ? 'text-green-600' : 'text-slate-400 dark:text-slate-500'}`}>
                      {!isDisabled(group.key) ? 'Grupo liberado' : 'Grupo bloqueado'}
                    </span>
                    <Switch
                      checked={!isDisabled(group.key)}
                      onCheckedChange={() => toggleGroup(group.key, group.items)}
                      data-testid={`module-group-switch-${group.key}`}
                    />
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full">
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {group.items.map((item) => {
                      const groupBlocked = isDisabled(group.key);
                      const itemBlocked = groupBlocked || isDisabled(item.key);
                      return (
                        <tr key={item.key}>
                          <td className="px-4 py-2.5 text-[13px]">{item.label}</td>
                          <td className="px-4 py-2.5 w-24 text-right">
                            <Switch
                              checked={!itemBlocked}
                              onCheckedChange={() => toggleItem(group.key, item.key)}
                              disabled={groupBlocked}
                              data-testid={`module-item-switch-${item.key}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
