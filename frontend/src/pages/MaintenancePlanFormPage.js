import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton } from '../components/DataPage';
import { Field, FormSection, FormActions } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { toast } from 'sonner';
import { CalendarClock, ClipboardList, ListChecks, Plus, Trash2, Wand2 } from 'lucide-react';

// Os itens da Revisão de Veículo, para começar um plano sem digitar tudo
const SUGGESTED_ITEMS = [
  'Óleo do motor', 'Filtro de óleo', 'Filtro de ar', 'Filtro do ar-condicionado', 'Filtro de combustível',
  'Filtro racor', 'Filtro hidráulico', 'Óleo da caixa', 'Óleo do diferencial', 'Lubrificação', 'Lavagem',
];

const newItem = (name = '') => ({ key: `n-${Date.now()}-${Math.random()}`, name, interval_km: '', interval_days: '', alert_km: '1000', alert_days: '15' });
const digits = (value) => value.replace(/\D/g, '');
const toInt = (value) => (value === '' || value === null || value === undefined ? null : Number(value));

// Novo plano (/fleet/plano-manutencao/new) e edição (/fleet/plano-manutencao/:id/edit)
export default function MaintenancePlanFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const backToList = () => navigate('/fleet/plano-manutencao?tab=planos');

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [form, setForm] = useState({ name: '', vehicle_types: [], active: true, notes: '' });
  const [items, setItems] = useState([newItem()]);

  useEffect(() => {
    api.getVehicleTypes().then((r) => setVehicleTypes(r.data || []))
      .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar os tipos de veículo')));
    if (!isEdit) return;
    api.getMaintenancePlan(id)
      .then(({ data }) => {
        setForm({ name: data.name, vehicle_types: data.vehicle_types, active: data.active, notes: data.notes || '' });
        setItems(data.items.map((i) => ({
          key: i.id, id: i.id, name: i.name,
          interval_km: i.interval_km ? String(i.interval_km) : '', interval_days: i.interval_days ? String(i.interval_days) : '',
          alert_km: String(i.alert_km ?? ''), alert_days: String(i.alert_days ?? ''),
        })));
      })
      .catch((error) => {
        toast.error(apiErrorMessage(error, 'Erro ao carregar o plano'));
        backToList();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const toggleType = (value) => setForm((prev) => ({
    ...prev,
    vehicle_types: prev.vehicle_types.includes(value) ? prev.vehicle_types.filter((t) => t !== value) : [...prev.vehicle_types, value],
  }));
  const changeItem = (key, field, value) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)));
  const removeItem = (key) => setItems((prev) => prev.filter((i) => i.key !== key));
  const addSuggested = () => setItems((prev) => {
    const named = prev.filter((i) => i.name.trim());
    const have = new Set(named.map((i) => i.name.trim().toLowerCase()));
    return [...named, ...SUGGESTED_ITEMS.filter((n) => !have.has(n.toLowerCase())).map((n) => newItem(n))];
  });

  const handleSubmit = async () => {
    const filled = items.filter((i) => i.name.trim());
    if (!form.name.trim() || form.vehicle_types.length === 0 || filled.length === 0) {
      toast.error('Preencha o nome, escolha os tipos de veículo e inclua pelo menos um item');
      return;
    }
    const missing = filled.find((i) => !Number(i.interval_km) && !Number(i.interval_days));
    if (missing) {
      toast.error(`Informe o intervalo em km ou em dias do item "${missing.name.trim()}"`);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        items: filled.map((i) => ({
          ...(i.id ? { id: i.id } : {}),
          name: i.name,
          interval_km: toInt(i.interval_km) || null,
          interval_days: toInt(i.interval_days) || null,
          alert_km: toInt(i.alert_km) ?? 0,
          alert_days: toInt(i.alert_days) ?? 0,
        })),
      };
      if (isEdit) await api.updateMaintenancePlan(id, payload);
      else await api.createMaintenancePlan(payload);
      toast.success(isEdit ? 'Plano atualizado' : 'Plano cadastrado');
      backToList();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao salvar o plano'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4" data-testid="maintenance-plan-form-page">
        <PageHeader
          backTo={backToList}
          icon={CalendarClock}
          title={isEdit ? 'Editar plano de manutenção' : 'Novo plano de manutenção'}
          subtitle="Os itens preventivos de um tipo de veículo e de quanto em quanto tempo cada um é feito"
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            <FormSection title="Plano" icon={ClipboardList}>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <Field label="Nome do plano" required className="lg:col-span-2">
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="plan-name" />
                </Field>
                <Field label="Situação">
                  <label className="flex h-10 items-center gap-2 text-sm">
                    <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: !!v })} data-testid="plan-active" />
                    Plano ativo (desativado não gera aviso)
                  </label>
                </Field>
              </div>
              <Field label="Tipos de veículo" required hint="O plano vale para todos os veículos ativos destes tipos no Cadastro de Veículos.">
                <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                  {vehicleTypes.map((t) => (
                    <label key={t.value} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={form.vehicle_types.includes(t.value)} onCheckedChange={() => toggleType(t.value)} data-testid={`plan-type-${t.value}`} />
                      {t.label}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Observações">
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </FormSection>

            <FormSection
              title={`Itens (${items.filter((i) => i.name.trim()).length})`}
              icon={ListChecks}
              actions={(
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={addSuggested} data-testid="plan-suggest-items-btn">
                    <Wand2 className="w-4 h-4 mr-1" /> Itens da revisão
                  </Button>
                  <Button type="button" size="sm" onClick={() => setItems((prev) => [...prev, newItem()])} data-testid="plan-add-item-btn">
                    <Plus className="w-4 h-4 mr-1" /> Adicionar item
                  </Button>
                </div>
              )}
            >
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cada item vence pelo que chegar primeiro: o intervalo em km ou em dias. Os campos de aviso dizem com quanto de antecedência ele passa a aparecer como "vence em breve".
              </p>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="min-w-[200px]">Item *</th>
                      <th className="min-w-[110px]">A cada (km)</th>
                      <th className="min-w-[100px]">Ou a cada (dias)</th>
                      <th className="min-w-[110px]">Avisar com (km)</th>
                      <th className="min-w-[100px]">Ou com (dias)</th>
                      <th aria-label="Remover" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={item.key}>
                        <td><Input value={item.name} onChange={(e) => changeItem(item.key, 'name', e.target.value)} aria-label={`Nome do item ${index + 1}`} data-testid={`plan-item-name-${index}`} /></td>
                        <td><Input inputMode="numeric" value={item.interval_km} onChange={(e) => changeItem(item.key, 'interval_km', digits(e.target.value))} aria-label={`Intervalo em km do item ${index + 1}`} data-testid={`plan-item-km-${index}`} /></td>
                        <td><Input inputMode="numeric" value={item.interval_days} onChange={(e) => changeItem(item.key, 'interval_days', digits(e.target.value))} aria-label={`Intervalo em dias do item ${index + 1}`} data-testid={`plan-item-days-${index}`} /></td>
                        <td><Input inputMode="numeric" value={item.alert_km} onChange={(e) => changeItem(item.key, 'alert_km', digits(e.target.value))} aria-label={`Aviso em km do item ${index + 1}`} /></td>
                        <td><Input inputMode="numeric" value={item.alert_days} onChange={(e) => changeItem(item.key, 'alert_days', digits(e.target.value))} aria-label={`Aviso em dias do item ${index + 1}`} /></td>
                        <td>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(item.key)} aria-label={`Remover o item ${index + 1}`} title="Remover item">
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </FormSection>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={backToList}>Cancelar</Button>
              <Button type="button" onClick={handleSubmit} disabled={saving} data-testid="plan-save-btn">
                {saving ? 'Salvando...' : (isEdit ? 'Salvar alterações' : 'Cadastrar plano')}
              </Button>
            </FormActions>
          </div>
        )}
      </div>
    </Layout>
  );
}
