import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton } from '../components/DataPage';
import { Field, FormSection, FormActions } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { toLocalDay } from '../lib/dates';
import { formatPlate } from '../lib/masks';
import { apiErrorMessage } from '../lib/errors';
import { fmtMoney, downloadFreightContractPdf } from '../lib/freightContracts';
import {
  FileText, Plus, Trash2, Save, Download, Calculator, Import, ClipboardList, Building2, Truck, MapPin,
  Scale, ListChecks, Package, Banknote, History, Landmark,
} from 'lucide-react';

const buildEmptyForm = () => ({
  // Dados do Contrato
  emission_date: '', payment_method: '', operation_type: '',
  trip_start_date: '', trip_end_date: '', agencia: '', talao: '',
  // Contratado
  contratado_id: '', contratado_name: '',
  // Motorista e Veículos
  driver_name: '', driver_cpf: '', driver_phone: '',
  truck_plate: '', truck_renavam: '', truck_owner: '', vehicle_type: '',
  trailer_plate: '', trailer_renavam: '', trailer_owner: '',
  trailer2_plate: '', trailer2_renavam: '', trailer2_owner: '',
  // Dados do Serviço
  service_local: '', service_date: '', service_type: 'CONTAINER',
  service_modality: 'LS', origin: '', destination: '',
  cte: '', weight: '',
  collection_date: '', delivery_date: '',
  container_number: '', client_name: '',
  // Frete Mínimo (campos manuais - sem cálculo automático)
  vehicle_composition: '', high_performance: false, freight_table: '',
  cargo_type: '', distance_km: '', axle_count: '',
  return_freight_type: '', return_km: '', minimum_freight: '',
  // Demonstrativo / Carga
  services: [{ description: '', value: 0 }],
  cargo_items: [],
  documents_list: '',
  // Valores
  rule: '', tolerance: '', driver_fee: '', collection_weight: '',
  service_value: 0, daily_rate: 0, other_discounts: '',
  inss_discount_percent: '', sest_senat_discount_percent: '',
  ir_calculation_base: '', irrf_discount: '', insurance_discount: '',
  toll_value: '', net_freight: '', advance: 0, advance_installments: '',
  fuel: 0, arrival_weight: '', weight_loss_discount: '', fuel_balance: '',
  complement: '', result: '', others: 0, discounts: 0,
  // Contratos anteriores
  inss_ceiling: '', contratado_monthly_inss_discount: '',
  // Dados de pagamento
  ciot: '',
  // Origem dos dados puxados
  loading_order_id: null, loading_order_number: null, cte_id: null,
  // Dados bancários
  bank_agency: '', bank_account: '', bank_pix: '', bank_beneficiary: '',
  observations: '',
});

const CARGO_FIELDS = ['nf_number', 'fiscal_date', 'nature', 'species', 'mark', 'batch_number', 'quantity', 'weight_kg', 'cubage_m3', 'value'];
// Linha de carga vinda do servidor: todo campo com valor, pra os inputs seguirem controlados
const normalizeCargo = (items) => (items || []).map((c) => Object.fromEntries(CARGO_FIELDS.map((f) => [f, c[f] ?? ''])));

const plateLabel = (v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`;
const driverLabel = (d) => (d.cpf ? `${d.name} · ${d.cpf}` : d.name);

// Novo contrato (/fleet/rpa-terceiro/new) e edição (/fleet/rpa-terceiro/:id/edit)
export default function RPATerceiroFormPage({ rpaType = 'terceiro' }) {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const backToList = () => navigate('/fleet/rpa-terceiro');

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [contractNumber, setContractNumber] = useState(null);
  const [form, setForm] = useState(() => ({ ...buildEmptyForm(), emission_date: isEdit ? '' : toLocalDay(new Date()) }));
  const [drivers, setDrivers] = useState([]);
  const [clients, setClients] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  // Puxar dados da Ordem de Coleta ou do CT-e
  const [sources, setSources] = useState({ orders: [], ctes: [] });
  const [orderSearch, setOrderSearch] = useState('');
  const [cteSearch, setCteSearch] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const load = (request, setter, fallbackMessage, pick = (r) => r.data || []) => request()
      .then((r) => setter(pick(r)))
      .catch((e) => fallbackMessage && toast.error(apiErrorMessage(e, fallbackMessage)));
    load(() => api.getDrivers(), setDrivers, 'Erro ao carregar motoristas');
    load(() => api.getClients(), setClients, 'Erro ao carregar clientes');
    load(() => api.getCompanies(), setCompanies, 'Erro ao carregar transportadoras');
    load(() => api.getVehicles({ per_page: 1000 }), setVehicles, null, (r) => r.data?.items || r.data || []);
    load(() => api.getRPASources(), setSources, null, (r) => ({ orders: r.data?.orders || [], ctes: r.data?.ctes || [] }));

    if (!isEdit) {
      // Sem data gravada, o PDF imprimia o dia da impressão como Emissão
      api.getRPATerceiroNextNumber(rpaType)
        .then((r) => setContractNumber(r.data?.next_number || 1))
        .catch(() => setContractNumber(null));
      return;
    }
    api.getRPATerceiro(id)
      .then(({ data: d }) => {
        setContractNumber(d.rpa_number);
        setForm({
          ...buildEmptyForm(),
          ...d,
          services: (d.services && d.services.length > 0) ? d.services : [{ description: '', value: 0 }],
          cargo_items: normalizeCargo(d.cargo_items),
          service_date: d.service_date || '',
          collection_date: d.collection_date || '',
          delivery_date: d.delivery_date || '',
          emission_date: d.emission_date || '',
          trip_start_date: d.trip_start_date || '',
          trip_end_date: d.trip_end_date || '',
        });
      })
      .catch((e) => {
        toast.error(apiErrorMessage(e, 'Erro ao carregar contrato'));
        backToList();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rpaType]);

  const onChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  // Sobrescreve só o que veio preenchido na origem; o resto do formulário fica como está
  const importDraft = async (load, label) => {
    setImporting(true);
    try {
      const { draft, used_in: usedIn } = (await load()).data;
      const filled = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));
      if (filled.cargo_items) filled.cargo_items = normalizeCargo(filled.cargo_items);
      setForm((prev) => ({ ...prev, ...filled }));
      toast.success(`Dados puxados de ${label}. Confira antes de salvar.`);
      if (usedIn?.length) toast.warning(`Já usado no(s) contrato(s) Nº ${usedIn.join(', ')}`);
      if (!draft.service_value) toast.info('O Frete não veio da origem: informe o valor do contrato');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao puxar os dados'));
    } finally {
      setImporting(false);
    }
  };

  const selectTruckVehicle = (vehicle) => {
    setForm((prev) => ({
      ...prev,
      truck_plate: vehicle.plate,
      truck_renavam: vehicle.renavam || prev.truck_renavam,
      truck_owner: vehicle.transport_company || prev.truck_owner,
      vehicle_type: vehicle.vehicle_type || prev.vehicle_type,
    }));
  };

  const selectTrailerVehicle = (vehicle) => {
    setForm((prev) => ({
      ...prev,
      trailer_plate: vehicle.plate,
      trailer_renavam: vehicle.renavam || prev.trailer_renavam,
      trailer_owner: vehicle.transport_company || prev.trailer_owner,
    }));
  };

  const selectContratado = (company) => {
    setForm((prev) => ({
      ...prev,
      contratado_id: company.id,
      contratado_name: company.name,
      bank_agency: company.bank_agency || prev.bank_agency,
      bank_account: company.bank_account || prev.bank_account,
      bank_pix: company.pix_key || prev.bank_pix,
      bank_beneficiary: company.trade_name || company.name || prev.bank_beneficiary,
    }));
    if (company.bank_agency || company.bank_account || company.pix_key) {
      toast.success('Dados bancários preenchidos a partir da transportadora');
    }
  };

  const selectDriver = async (driver) => {
    setForm((prev) => ({ ...prev, driver_name: driver.name }));
    // Buscar info detalhada (CPF, telefone, última placa, transportadora)
    try {
      const r = await api.getRPADriverInfo(driver.id);
      const info = r.data || {};
      setForm((prev) => ({
        ...prev,
        driver_name: info.driver_name || driver.name,
        driver_cpf: info.driver_cpf || driver.cpf || prev.driver_cpf,
        driver_phone: info.driver_phone || driver.phone || prev.driver_phone,
        truck_plate: info.truck_plate || prev.truck_plate,
        truck_renavam: info.truck_renavam || prev.truck_renavam,
        truck_owner: info.truck_owner || prev.truck_owner,
        trailer_plate: info.trailer_plate || prev.trailer_plate,
        trailer_renavam: info.trailer_renavam || prev.trailer_renavam,
        trailer_owner: info.trailer_owner || prev.trailer_owner,
      }));
      const filled = [];
      if (info.truck_plate) filled.push('Veículo Principal');
      if (info.trailer_plate) filled.push('Vinculado 01');
      if (info.truck_owner) filled.push('Proprietário');
      if (filled.length > 0) {
        toast.success(`Preenchido: CPF, telefone, ${filled.join(', ')}`);
      } else {
        toast.success('Motorista preenchido (sem movimentações anteriores)');
      }
    } catch (e) {
      // Sem info do backend - usar dados básicos do cadastro
      setForm((prev) => ({
        ...prev,
        driver_name: driver.name,
        driver_cpf: driver.cpf || prev.driver_cpf,
        driver_phone: driver.phone || prev.driver_phone,
      }));
    }
  };

  const updateService = (idx, field, value) => {
    setForm((prev) => {
      const services = [...prev.services];
      services[idx] = { ...services[idx], [field]: field === 'value' ? Number(value || 0) : value };
      // Recalcular service_value (soma dos serviços)
      const total = services.reduce((acc, s) => acc + Number(s.value || 0), 0);
      return { ...prev, services, service_value: total };
    });
  };
  const addService = () => {
    setForm((prev) => ({ ...prev, services: [...prev.services, { description: '', value: 0 }] }));
  };
  const removeService = (idx) => {
    setForm((prev) => {
      const services = prev.services.filter((_, i) => i !== idx);
      const total = services.reduce((acc, s) => acc + Number(s.value || 0), 0);
      return {
        ...prev,
        services: services.length ? services : [{ description: '', value: 0 }],
        service_value: total,
      };
    });
  };

  const addCargoItem = () => {
    setForm((prev) => ({ ...prev, cargo_items: [...prev.cargo_items, Object.fromEntries(CARGO_FIELDS.map((f) => [f, '']))] }));
  };
  const updateCargoItem = (idx, field, value) => {
    setForm((prev) => {
      const cargo_items = [...prev.cargo_items];
      cargo_items[idx] = { ...cargo_items[idx], [field]: value };
      return { ...prev, cargo_items };
    });
  };
  const removeCargoItem = (idx) => {
    setForm((prev) => ({ ...prev, cargo_items: prev.cargo_items.filter((_, i) => i !== idx) }));
  };

  const balance = Number(form.service_value || 0) + Number(form.daily_rate || 0) + Number(form.fuel || 0)
    + Number(form.others || 0) - Number(form.advance || 0) - Number(form.discounts || 0);

  const handleSave = async () => {
    if (!form.driver_name?.trim()) {
      toast.error('Informe o nome do motorista');
      return;
    }
    setSaving(true);
    try {
      const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
      const payload = {
        ...form,
        rpa_type: rpaType,
        service_value: Number(form.service_value || 0),
        daily_rate: Number(form.daily_rate || 0),
        fuel: Number(form.fuel || 0),
        advance: Number(form.advance || 0),
        others: Number(form.others || 0),
        discounts: Number(form.discounts || 0),
        tolerance: numOrNull(form.tolerance),
        driver_fee: numOrNull(form.driver_fee),
        collection_weight: numOrNull(form.collection_weight),
        other_discounts: numOrNull(form.other_discounts),
        inss_discount_percent: numOrNull(form.inss_discount_percent),
        sest_senat_discount_percent: numOrNull(form.sest_senat_discount_percent),
        ir_calculation_base: numOrNull(form.ir_calculation_base),
        irrf_discount: numOrNull(form.irrf_discount),
        insurance_discount: numOrNull(form.insurance_discount),
        toll_value: numOrNull(form.toll_value),
        net_freight: numOrNull(form.net_freight),
        advance_installments: form.advance_installments === '' ? null : parseInt(form.advance_installments, 10),
        arrival_weight: numOrNull(form.arrival_weight),
        weight_loss_discount: numOrNull(form.weight_loss_discount),
        fuel_balance: numOrNull(form.fuel_balance),
        complement: numOrNull(form.complement),
        result: numOrNull(form.result),
        distance_km: numOrNull(form.distance_km),
        axle_count: form.axle_count === '' ? null : parseInt(form.axle_count, 10),
        return_km: numOrNull(form.return_km),
        minimum_freight: numOrNull(form.minimum_freight),
        inss_ceiling: numOrNull(form.inss_ceiling),
        contratado_monthly_inss_discount: numOrNull(form.contratado_monthly_inss_discount),
        services: form.services
          .filter((s) => s.description?.trim() || Number(s.value || 0) > 0)
          .map((s) => ({ description: s.description || '', value: Number(s.value || 0) })),
        cargo_items: form.cargo_items
          .filter((c) => Object.values(c).some((v) => v !== '' && v !== null))
          .map((c) => ({
            ...c,
            weight_kg: numOrNull(c.weight_kg),
            cubage_m3: numOrNull(c.cubage_m3),
            value: numOrNull(c.value),
          })),
      };
      if (isEdit) {
        await api.updateRPATerceiro(id, payload);
        toast.success('Contrato atualizado!');
      } else {
        await api.createRPATerceiro(payload);
        toast.success('Contrato criado!');
      }
      backToList();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao salvar contrato'));
    } finally {
      setSaving(false);
    }
  };

  // Campo de texto simples ligado a form[name]
  const F = ({ name, label, type = 'text', className, transform }) => (
    <Field label={label} className={className}>
      <Input
        type={type}
        min={type === 'number' ? '0' : undefined}
        value={form[name] ?? ''}
        onChange={(e) => onChange(name, transform ? transform(e.target.value) : e.target.value)}
        className="h-9 text-sm"
        data-testid={`rpa-${name.replace(/_/g, '-')}`}
      />
    </Field>
  );
  const money = (v) => Number(v || 0);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4" data-testid="rpa-form-page">
        <PageHeader
          backTo={backToList}
          icon={FileText}
          title={isEdit ? 'Editar contrato de frete' : 'Novo contrato de frete'}
          subtitle={contractNumber !== null ? `Contrato Nº ${contractNumber}` : 'Contrato de Afretamento para motorista terceiro'}
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            <FormSection title="Puxar dados" icon={Import} testId="rpa-import">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Ordem de coleta / entrega" hint={importing ? 'Puxando os dados...' : undefined}>
                  <Autocomplete
                    className="text-sm"
                    value={orderSearch}
                    onChange={setOrderSearch}
                    options={sources.orders}
                    displayField="label"
                    valueField="id"
                    onSelect={(o) => importDraft(() => api.getRPADraftFromOrder(o.id), 'a Ordem')}
                    testId="rpa-import-order"
                  />
                </Field>
                <Field label="CT-e">
                  <Autocomplete
                    className="text-sm"
                    value={cteSearch}
                    onChange={setCteSearch}
                    options={sources.ctes}
                    displayField="label"
                    valueField="id"
                    onSelect={(c) => importDraft(() => api.getRPADraftFromCte(c.id), 'o CT-e')}
                    testId="rpa-import-cte"
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Dados do contrato" icon={ClipboardList}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {F({ name: 'emission_date', label: 'Data de emissão', type: 'date' })}
                {F({ name: 'payment_method', label: 'Forma de pagamento' })}
                {F({ name: 'trip_start_date', label: 'Data inicial da viagem', type: 'date' })}
                {F({ name: 'trip_end_date', label: 'Data final da viagem', type: 'date' })}
                {F({ name: 'operation_type', label: 'Tipo de operação' })}
                {F({ name: 'agencia', label: 'Agência' })}
                {F({ name: 'talao', label: 'Talão' })}
              </div>
            </FormSection>

            <FormSection title="Contratado" icon={Building2}>
              <Field label="Transportadora / contratado" className="max-w-xl" hint="Digite para buscar as transportadoras cadastradas, ou escreva o nome">
                <Autocomplete
                  className="text-sm"
                  value={form.contratado_name}
                  onChange={(v) => setForm((prev) => ({ ...prev, contratado_name: v, contratado_id: '' }))}
                  options={companies}
                  displayField="name"
                  onSelect={selectContratado}
                  testId="rpa-contratado-name"
                />
              </Field>
            </FormSection>

            <FormSection title="Motorista e veículos" icon={Truck}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Motorista" required className="sm:col-span-2" hint="Busca por nome ou CPF entre os cadastrados">
                  <Autocomplete
                    className="text-sm"
                    value={form.driver_name}
                    onChange={(v) => onChange('driver_name', v)}
                    options={drivers}
                    displayField={driverLabel}
                    onSelect={selectDriver}
                    testId="rpa-driver-name"
                  />
                </Field>
                {F({ name: 'driver_phone', label: 'Telefone' })}
                {F({ name: 'driver_cpf', label: 'CPF' })}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label="Veículo principal (placa)">
                  <Autocomplete
                    className="text-sm font-mono"
                    value={form.truck_plate}
                    onChange={(v) => onChange('truck_plate', formatPlate(v))}
                    options={vehicles}
                    displayField={plateLabel}
                    onSelect={selectTruckVehicle}
                    testId="rpa-truck-plate"
                  />
                </Field>
                {F({ name: 'vehicle_type', label: 'Tipo do veículo principal' })}
                {F({ name: 'truck_renavam', label: 'Renavam' })}
                {F({ name: 'truck_owner', label: 'Proprietário' })}
                <Field label="Vinculado 01 (placa)">
                  <Autocomplete
                    className="text-sm font-mono"
                    value={form.trailer_plate}
                    onChange={(v) => onChange('trailer_plate', formatPlate(v))}
                    options={vehicles}
                    displayField={plateLabel}
                    onSelect={selectTrailerVehicle}
                    testId="rpa-trailer-plate"
                  />
                </Field>
                <div className="hidden lg:block" />
                {F({ name: 'trailer_renavam', label: 'Renavam vinculado 01' })}
                {F({ name: 'trailer_owner', label: 'Proprietário vinculado 01' })}
                {F({ name: 'trailer2_plate', label: 'Vinculado 02 (placa)', transform: formatPlate })}
                <div className="hidden lg:block" />
                {F({ name: 'trailer2_renavam', label: 'Renavam vinculado 02' })}
                {F({ name: 'trailer2_owner', label: 'Proprietário vinculado 02' })}
              </div>
            </FormSection>

            <FormSection title="Dados do serviço prestado" icon={MapPin}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {F({ name: 'service_local', label: 'Local' })}
                {F({ name: 'service_date', label: 'Data', type: 'date' })}
                {F({ name: 'service_type', label: 'Serviço' })}
                {F({ name: 'service_modality', label: 'Tipo (LS/RODO)' })}
                {F({ name: 'origin', label: 'Origem / local de coleta', className: 'col-span-2' })}
                {F({ name: 'destination', label: 'Destino / local de entrega', className: 'col-span-2' })}
                {F({ name: 'cte', label: 'CT-e' })}
                {F({ name: 'weight', label: 'Peso' })}
                {F({ name: 'collection_date', label: 'Data da coleta', type: 'date' })}
                {F({ name: 'delivery_date', label: 'Data / prazo de entrega', type: 'date' })}
                {F({ name: 'container_number', label: 'Nº do container' })}
                <Field label="Cliente" className="col-span-2 lg:col-span-3">
                  <Autocomplete
                    className="text-sm"
                    value={form.client_name}
                    onChange={(v) => onChange('client_name', v)}
                    options={clients}
                    displayField="name"
                    onSelect={(c) => onChange('client_name', c.name)}
                    testId="rpa-client-name"
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Informações para cálculo do frete mínimo" icon={Scale}>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Campos de preenchimento manual: o sistema não calcula automaticamente o frete mínimo ANTT.
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {F({ name: 'vehicle_composition', label: 'Composição veicular' })}
                {F({ name: 'freight_table', label: 'Tabela de frete' })}
                {F({ name: 'cargo_type', label: 'Tipo de carga' })}
                {F({ name: 'distance_km', label: 'Km', type: 'number' })}
                {F({ name: 'axle_count', label: 'Nº de eixos', type: 'number' })}
                {F({ name: 'return_freight_type', label: 'Frete de retorno' })}
                {F({ name: 'return_km', label: 'Km de retorno', type: 'number' })}
                {F({ name: 'minimum_freight', label: 'Frete mínimo (R$)', type: 'number' })}
              </div>
            </FormSection>

            <FormSection
              title="Demonstrativo dos serviços prestados"
              icon={ListChecks}
              actions={(
                <Button variant="outline" size="sm" onClick={addService} type="button" className="h-8 text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" />Adicionar serviço
                </Button>
              )}
            >
              <div className="space-y-2">
                {form.services.map((s, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-3 items-end p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <Field label="Descrição do serviço" className="col-span-12 sm:col-span-8">
                      <Input value={s.description} onChange={(e) => updateService(idx, 'description', e.target.value)} className="h-9 text-sm" data-testid={`rpa-service-desc-${idx}`} />
                    </Field>
                    <Field label="Valor (R$)" className="col-span-9 sm:col-span-3">
                      <Input type="number" min="0" step="0.01" value={s.value} onChange={(e) => updateService(idx, 'value', e.target.value)} className="h-9 text-sm text-right" data-testid={`rpa-service-value-${idx}`} />
                    </Field>
                    <div className="col-span-3 sm:col-span-1 flex justify-end">
                      <Button title="Tirar serviço" aria-label="Tirar serviço" type="button" variant="ghost" size="sm" onClick={() => removeService(idx)} className="h-9 px-2 text-destructive hover:text-red-700" disabled={form.services.length <= 1}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </FormSection>

            <FormSection
              title="Dados da carga"
              icon={Package}
              actions={(
                <Button variant="outline" size="sm" onClick={addCargoItem} type="button" className="h-8 text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" />Adicionar item de carga
                </Button>
              )}
            >
              {form.cargo_items.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum item de carga adicionado.</p>
              ) : (
                <div className="space-y-2">
                  {form.cargo_items.map((c, idx) => (
                    <div key={idx} className="grid grid-cols-6 sm:grid-cols-12 gap-3 items-end p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                      <Field label="Nº NF" className="col-span-2"><Input value={c.nf_number} onChange={(e) => updateCargoItem(idx, 'nf_number', e.target.value)} className="h-9 text-sm" /></Field>
                      <Field label="Natureza" className="col-span-4 sm:col-span-3"><Input value={c.nature} onChange={(e) => updateCargoItem(idx, 'nature', e.target.value)} className="h-9 text-sm" /></Field>
                      <Field label="Espécie" className="col-span-2"><Input value={c.species} onChange={(e) => updateCargoItem(idx, 'species', e.target.value)} className="h-9 text-sm" /></Field>
                      <Field label="Qtd." className="col-span-2 sm:col-span-1"><Input value={c.quantity} onChange={(e) => updateCargoItem(idx, 'quantity', e.target.value)} className="h-9 text-sm" /></Field>
                      <Field label="Kg" className="col-span-2 sm:col-span-1"><Input type="number" min="0" value={c.weight_kg} onChange={(e) => updateCargoItem(idx, 'weight_kg', e.target.value)} className="h-9 text-sm" /></Field>
                      <Field label="M³" className="col-span-2 sm:col-span-1"><Input type="number" min="0" value={c.cubage_m3} onChange={(e) => updateCargoItem(idx, 'cubage_m3', e.target.value)} className="h-9 text-sm" /></Field>
                      <Field label="Valor" className="col-span-4 sm:col-span-1"><Input type="number" min="0" value={c.value} onChange={(e) => updateCargoItem(idx, 'value', e.target.value)} className="h-9 text-sm" /></Field>
                      <div className="col-span-2 sm:col-span-1 flex justify-end">
                        <Button title="Tirar item" aria-label="Tirar item" type="button" variant="ghost" size="sm" onClick={() => removeCargoItem(idx)} className="h-9 px-2 text-destructive hover:text-red-700">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {F({ name: 'documents_list', label: 'Relação de documentos' })}
            </FormSection>

            <FormSection title="Valores" icon={Banknote}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {F({ name: 'rule', label: 'Regra' })}
                {F({ name: 'tolerance', label: 'Tolerância', type: 'number' })}
                {F({ name: 'driver_fee', label: 'Tarifa do motorista (R$)', type: 'number' })}
                {F({ name: 'collection_weight', label: 'Peso de coleta (kg)', type: 'number' })}
                {F({ name: 'service_value', label: 'Frete / I. Valor do serviço (R$)', type: 'number', transform: money })}
                {F({ name: 'daily_rate', label: 'II. Diária (R$)', type: 'number', transform: money })}
                {F({ name: 'fuel', label: 'III. Combustível (R$)', type: 'number', transform: money })}
                {F({ name: 'advance', label: 'IV. Adiantamento (R$)', type: 'number', transform: money })}
                {F({ name: 'advance_installments', label: 'Parcelas do adiantamento', type: 'number' })}
                {F({ name: 'others', label: 'VI. Outros acréscimos (R$)', type: 'number', transform: money })}
                {F({ name: 'discounts', label: 'Descontos (R$)', type: 'number', transform: money })}
                {F({ name: 'other_discounts', label: 'Outros descontos (R$)', type: 'number' })}
                {F({ name: 'inss_discount_percent', label: 'Desconto INSS (%)', type: 'number' })}
                {F({ name: 'sest_senat_discount_percent', label: 'Desconto SEST/SENAT (%)', type: 'number' })}
                {F({ name: 'ir_calculation_base', label: 'Base de cálculo IR (R$)', type: 'number' })}
                {F({ name: 'irrf_discount', label: 'Desconto IRRF (R$)', type: 'number' })}
                {F({ name: 'insurance_discount', label: 'Desconto de seguro (R$)', type: 'number' })}
                {F({ name: 'toll_value', label: 'Valor de pedágio (R$)', type: 'number' })}
                {F({ name: 'net_freight', label: 'Frete líquido (R$)', type: 'number' })}
                {F({ name: 'arrival_weight', label: 'Peso de chegada (kg)', type: 'number' })}
                {F({ name: 'weight_loss_discount', label: 'Desconto de quebra de peso (R$)', type: 'number' })}
                {F({ name: 'fuel_balance', label: 'Saldo de combustível (R$)', type: 'number' })}
                {F({ name: 'complement', label: 'Complemento (R$)', type: 'number' })}
                {F({ name: 'result', label: 'Resultado (R$)', type: 'number' })}
              </div>
              <div className="flex items-center justify-between p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="flex items-center gap-2 text-primary font-semibold">
                  <Calculator className="w-5 h-5" />
                  Saldo a receber
                </div>
                <div className="text-xl font-bold text-primary tabular-nums" data-testid="rpa-balance">{fmtMoney(balance)}</div>
              </div>
            </FormSection>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <FormSection title="Contratos anteriores" icon={History}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {F({ name: 'inss_ceiling', label: 'Teto do INSS (R$)', type: 'number' })}
                  {F({ name: 'contratado_monthly_inss_discount', label: 'Desconto mensal de INSS do contratado (R$)', type: 'number' })}
                </div>
              </FormSection>
              <FormSection title="Dados de pagamento" icon={Banknote}>
                {F({ name: 'ciot', label: 'CIOT', className: 'max-w-xs' })}
              </FormSection>
            </div>

            <FormSection title="Dados bancários do beneficiário" icon={Landmark}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {F({ name: 'bank_agency', label: 'Nº da agência' })}
                {F({ name: 'bank_account', label: 'Nº da conta' })}
                {F({ name: 'bank_pix', label: 'Chave PIX' })}
                {F({ name: 'bank_beneficiary', label: 'Beneficiário' })}
              </div>
            </FormSection>

            <FormSection title="Observações / instruções de transporte">
              <Textarea
                rows={3}
                aria-label="Observações / instruções de transporte"
                value={form.observations ?? ''}
                onChange={(e) => onChange('observations', e.target.value)}
                className="text-sm"
                data-testid="rpa-observations"
              />
            </FormSection>

            <FormActions sticky>
              {isEdit && (
                <Button type="button" variant="outline" onClick={() => downloadFreightContractPdf(id, contractNumber)} title="Baixar PDF" data-testid="rpa-print-btn">
                  <Download className="w-4 h-4 mr-2" />Imprimir
                </Button>
              )}
              <Button type="button" variant="outline" onClick={backToList} data-testid="rpa-cancel-btn">Cancelar</Button>
              <Button type="button" onClick={handleSave} disabled={saving} data-testid="rpa-save-btn">
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Salvar contrato'}
              </Button>
            </FormActions>
          </div>
        )}
      </div>
    </Layout>
  );
}
