import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { DataCard, StatusPill } from '../components/DataPage';
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
      <div className="space-y-4" data-testid="modules-page">
        <PageHeader
          icon={LayoutGrid}
          title="Módulos Contratados"
          subtitle="Controle o que este cliente pode usar. Desative um grupo inteiro ou só itens específicos — o resto dos usuários deste sistema deixa de enxergar o que estiver desativado aqui."
          actions={(
            <Button onClick={handleSave} disabled={saving} className="h-9 gap-1.5 text-[13px]" data-testid="save-modules-button">
              <Save className="w-4 h-4" />
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          )}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {catalog.map((group) => {
            const groupBlocked = isDisabled(group.key);
            return (
              <DataCard
                key={group.key}
                title={group.label}
                meta={(
                  <StatusPill tone={groupBlocked ? 'slate' : 'emerald'}>
                    {groupBlocked ? 'Grupo bloqueado' : 'Grupo liberado'}
                  </StatusPill>
                )}
                toolbar={(
                  <Switch
                    checked={!groupBlocked}
                    onCheckedChange={() => toggleGroup(group.key, group.items)}
                    data-testid={`module-group-switch-${group.key}`}
                  />
                )}
              >
                <table className="data-table">
                  <tbody>
                    {group.items.map((item) => {
                      const itemBlocked = groupBlocked || isDisabled(item.key);
                      return (
                        <tr key={item.key}>
                          <td className={itemBlocked ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'}>{item.label}</td>
                          <td className="w-24 text-right !py-1.5">
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
              </DataCard>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
