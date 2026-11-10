import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton } from '../components/DataPage';
import { Field, FormSection, FormActions } from '../components/FormKit';
import { OptionAutocomplete } from '../components/Autocomplete';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { todayISO } from '../lib/dates';
import { downloadBlob } from '../lib/fiscal';
import { formatMoney, parseMoney } from '../lib/payables';
import { toast } from 'sonner';
import { ClipboardCheck, Truck, ListChecks, Package, Plus, Trash2 } from 'lucide-react';

const TYPES = { PREVENTIVA: 'Preventiva', CORRETIVA: 'Corretiva' };
const newPart = () => ({ key: `${Date.now()}-${Math.random()}`, description: '', quantity: '1', unit_value: '' });
const formatKm = (km) => `${Number(km).toLocaleString('pt-BR')} km`;
const intervalText = (item) => [item.interval_km ? formatKm(item.interval_km) : null, item.interval_days ? `${item.interval_days} dias` : null]
  .filter(Boolean).join(' ou ');
const itemKey = (i) => `${i.plan_id}|${i.item_id}`;

// Registro de Manutenção (MAN-000001): o que foi feito num veículo da frota.
// Os itens do plano marcados recomeçam a contagem deles na Situação.
export default function MaintenanceRecordFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const backToList = () => navigate('/fleet/plano-manutencao?tab=registros');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fleet, setFleet] = useState([]);
  const [form, setForm] = useState({
    vehicle_id: searchParams.get('vehicle') || '', executed_date: todayISO(), km: '', maintenance_type: 'PREVENTIVA',
    workshop: '', other_services: '', labor_value: '', notes: '',
  });
  // Vindo da Situação, o item da linha escolhida já vem marcado
  const [checked, setChecked] = useState(() => {
    const plan = searchParams.get('plan');
    const item = searchParams.get('item');
    return new Set(plan && item ? [`${plan}|${item}`] : []);
  });
  const [parts, setParts] = useState([]);
  const [kmVehicle, setKmVehicle] = useState(null);

  useEffect(() => {
    api.getMaintenancePlanFleet()
      .then((r) => setFleet(r.data || []))
      .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar os veículos da frota')))
      .finally(() => setLoading(false));
  }, []);

  const vehicle = fleet.find((v) => v.id === form.vehicle_id) || null;
  const onChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  // Escolheu (ou trocou) o veículo: traz o KM atual dele; os itens marcados
  // de outro veículo saem, porque são de outro plano
  useEffect(() => {
    if (!vehicle || vehicle.id === kmVehicle) return;
    if (kmVehicle !== null) setChecked(new Set());
    setKmVehicle(vehicle.id);
    setForm((prev) => ({ ...prev, km: vehicle.current_km ? String(vehicle.current_km) : '' }));
  }, [vehicle, kmVehicle]);

  const toggleItem = (key) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const plans = useMemo(() => {
    const groups = {};
    (vehicle?.items || []).forEach((i) => { (groups[i.plan_name] = groups[i.plan_name] || []).push(i); });
    return Object.entries(groups);
  }, [vehicle]);
  const selectedItems = (vehicle?.items || []).filter((i) => checked.has(itemKey(i)));
  const needsKm = selectedItems.some((i) => i.interval_km);

  const partsTotal = parts.reduce((sum, p) => sum + (parseMoney(p.quantity) || 0) * (parseMoney(p.unit_value) || 0), 0);
  const total = partsTotal + (parseMoney(form.labor_value) || 0);
  const changePart = (key, field, value) => setParts((prev) => prev.map((p) => (p.key === key ? { ...p, [field]: value } : p)));

  const handleSubmit = async () => {
    if (!vehicle) {
      toast.error('Escolha o veículo');
      return;
    }
    const km = form.km === '' ? null : Number(form.km);
    if (needsKm && km === null) {
      toast.error('Informe o KM do veículo: há item marcado que vence por km');
      return;
    }
    const cleanParts = parts.filter((p) => p.description.trim()).map((p) => ({
      description: p.description, quantity: parseMoney(p.quantity) || 1, unit_value: parseMoney(p.unit_value) || 0,
    }));
    if (selectedItems.length === 0 && !form.other_services.trim() && cleanParts.length === 0) {
      toast.error('Marque os itens do plano ou informe os serviços ou as peças');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.createMaintenanceRecord({
        vehicle_id: vehicle.id, executed_date: form.executed_date, km, maintenance_type: form.maintenance_type,
        items: selectedItems.map((i) => ({ plan_id: i.plan_id, item_id: i.item_id })),
        other_services: form.other_services, workshop: form.workshop, parts: cleanParts,
        labor_value: parseMoney(form.labor_value) || 0, notes: form.notes,
      });
      toast.success(`Registro ${data.record_code} salvo`);
      // O PDF sai logo depois de salvar (reimpressão pela aba Registros)
      try {
        const pdf = await api.getMaintenanceRecordPdf(data.id);
        downloadBlob(pdf.data, `${data.record_code}.pdf`);
      } catch (error) {
        toast.error('Registro salvo, mas o PDF não foi gerado. Imprima pela aba Registros.');
      }
      backToList();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao salvar o registro'));
    } finally {
      setSaving(false);
    }
  };

  const vehicleOptions = fleet.map((v) => [v.id, [v.plate, [v.brand, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4" data-testid="maintenance-record-form-page">
        <PageHeader
          backTo={backToList}
          icon={ClipboardCheck}
          title="Novo registro de manutenção"
          subtitle="O que foi feito no veículo. Os itens do plano marcados recomeçam a contagem até a próxima troca."
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            <FormSection title="Veículo e execução" icon={Truck}>
              {fleet.length === 0 && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Nenhum veículo participa do Plano de Manutenção. Marque "Participa do Plano de Manutenção" no cadastro dos veículos da frota.
                </p>
              )}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Veículo" required className="col-span-2" hint="Só os veículos da frota (busca por placa ou modelo).">
                  <OptionAutocomplete value={form.vehicle_id} onChange={(v) => onChange('vehicle_id', v)} options={vehicleOptions} testId="record-vehicle" />
                </Field>
                <Field label="Data da execução" required>
                  <Input type="date" value={form.executed_date} max={todayISO()} onChange={(e) => onChange('executed_date', e.target.value)} data-testid="record-date" />
                </Field>
                <Field label="KM / hodômetro" required={needsKm}>
                  <Input inputMode="numeric" value={form.km} onChange={(e) => onChange('km', e.target.value.replace(/\D/g, ''))} data-testid="record-km" />
                </Field>
                <Field label="Tipo de manutenção">
                  <Select value={form.maintenance_type} onValueChange={(v) => onChange('maintenance_type', v)}>
                    <SelectTrigger data-testid="record-type"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TYPES).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Oficina ou responsável" className="col-span-2 lg:col-span-3">
                  <Input value={form.workshop} onChange={(e) => onChange('workshop', e.target.value)} data-testid="record-workshop" />
                </Field>
              </div>
            </FormSection>

            <FormSection title={`Itens e serviços executados${selectedItems.length ? ` (${selectedItems.length} do plano)` : ''}`} icon={ListChecks}>
              {!vehicle ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Escolha o veículo para ver os itens do plano dele.</p>
              ) : plans.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Este veículo não tem plano ativo para o tipo dele. Descreva os serviços abaixo.</p>
              ) : plans.map(([planName, items]) => (
                <div key={planName} className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Plano: {planName}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
                    {items.map((i) => (
                      <label key={itemKey(i)} className="flex items-start gap-2 text-sm cursor-pointer rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <Checkbox className="mt-0.5" checked={checked.has(itemKey(i))} onCheckedChange={() => toggleItem(itemKey(i))} data-testid={`record-item-${i.item_id}`} />
                        <span>
                          {i.item_name}
                          <span className="block text-xs text-slate-500 dark:text-slate-400">a cada {intervalText(i)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <Field label="Outros serviços executados" hint="Serviços fora do plano, um por linha (aparecem no PDF).">
                <Textarea rows={3} value={form.other_services} onChange={(e) => onChange('other_services', e.target.value)} data-testid="record-other-services" />
              </Field>
            </FormSection>

            <FormSection
              title="Peças e valores"
              icon={Package}
              actions={(
                <Button type="button" variant="outline" size="sm" onClick={() => setParts((prev) => [...prev, newPart()])} data-testid="record-add-part">
                  <Plus className="w-4 h-4 mr-1" /> Adicionar peça
                </Button>
              )}
            >
              {parts.length > 0 && (
                <div className="space-y-2">
                  {parts.map((p, index) => (
                    <div key={p.key} className="grid grid-cols-12 gap-2 items-end">
                      <Field label={index === 0 ? 'Peça' : ''} className="col-span-12 sm:col-span-6">
                        <Input value={p.description} onChange={(e) => changePart(p.key, 'description', e.target.value)} aria-label={`Descrição da peça ${index + 1}`} />
                      </Field>
                      <Field label={index === 0 ? 'Qtd.' : ''} className="col-span-3 sm:col-span-2">
                        <Input inputMode="decimal" value={p.quantity} onChange={(e) => changePart(p.key, 'quantity', e.target.value)} aria-label={`Quantidade da peça ${index + 1}`} />
                      </Field>
                      <Field label={index === 0 ? 'Valor unit. (R$)' : ''} className="col-span-5 sm:col-span-2">
                        <Input inputMode="decimal" value={p.unit_value} onChange={(e) => changePart(p.key, 'unit_value', e.target.value)} aria-label={`Valor unitário da peça ${index + 1}`} />
                      </Field>
                      <div className="col-span-3 sm:col-span-1 pb-2 text-right text-sm tabular-nums">{formatMoney((parseMoney(p.quantity) || 0) * (parseMoney(p.unit_value) || 0))}</div>
                      <div className="col-span-1 pb-0.5">
                        <Button type="button" variant="ghost" size="icon" onClick={() => setParts((prev) => prev.filter((x) => x.key !== p.key))} aria-label={`Remover a peça ${index + 1}`} title="Remover peça">
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                <Field label="Mão de obra (R$)">
                  <Input inputMode="decimal" value={form.labor_value} onChange={(e) => onChange('labor_value', e.target.value)} data-testid="record-labor" />
                </Field>
                <div className="lg:col-span-3 text-right text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Peças {formatMoney(partsTotal)} · Total </span>
                  <span className="font-semibold tabular-nums" data-testid="record-total">{formatMoney(total)}</span>
                </div>
              </div>
              <Field label="Observações">
                <Textarea rows={2} value={form.notes} onChange={(e) => onChange('notes', e.target.value)} />
              </Field>
            </FormSection>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={backToList}>Cancelar</Button>
              <Button type="button" onClick={handleSubmit} disabled={saving} data-testid="record-save-btn">
                {saving ? 'Salvando...' : 'Salvar e gerar PDF'}
              </Button>
            </FormActions>
          </div>
        )}
      </div>
    </Layout>
  );
}
