import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton } from '../components/DataPage';
import { FormSection, FormActions } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { Autocomplete, OptionAutocomplete } from '../components/Autocomplete';
import { WithQuickAdd } from '../components/QuickCreate';
import { CityStateFields } from '../components/AddressFields';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Plus, Trash2, Save, FileText, CalendarClock, Users, Gauge, AlignLeft, Package, Wrench, History, Lock } from 'lucide-react';
import { useConfirm } from '../hooks/useConfirm';
import { nowLocalInput } from '../lib/dates';
import { formatPlate } from '../lib/masks';
import { apiErrorMessage } from '../lib/errors';

const LIST_PATH = '/fleet/ordem-servico';

const fmtMoney = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Junta os campos estruturados do cadastro (street/number/neighborhood) numa
// única linha de texto, pro campo "Endereço" (texto livre) da OS.
const formatAddress = (details) => {
  if (!details) return '';
  const streetLine = [details.street, details.number].filter(Boolean).join(', ');
  return [streetLine, details.neighborhood].filter(Boolean).join(' - ');
};

const asList = (r) => r.data?.items || r.data || [];

// Fechada ou Cancelada: a OS fica só para consulta (o servidor também recusa)
const FINAL_STATUSES = ['FECHADO', 'CANCELADO'];

const fmtDateTime = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Nova OS (/fleet/ordem-servico/new) e edição (/fleet/ordem-servico/:id/edit)
export default function OrdemServicoFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const backToList = () => navigate(LIST_PATH);

  const [loading, setLoading] = useState(isEdit);
  const [osNumber, setOsNumber] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [osCategories, setOsCategories] = useState([]);
  const [productCatalog, setProductCatalog] = useState([]);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  // Status gravado no servidor (não o do formulário): decide se a OS trava
  const [savedStatus, setSavedStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [legacyInfo, setLegacyInfo] = useState(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const locked = isEdit && FINAL_STATUSES.includes(savedStatus);

  // Pessoa/Supervisor/Técnico/Ajudante buscam nos cadastros de Motorista +
  // Funcionário combinados (unificados na tela /cadastro) - _type marca de
  // qual registro veio, pra guardar junto do id selecionado.
  const people = [
    ...drivers.map((d) => ({ ...d, _type: 'motorista' })),
    ...employees.map((e) => ({ ...e, _type: 'funcionario' })),
  ];

  // Normaliza Produto/Cadastro de Serviço pro mesmo formato usado pelas
  // linhas de Produtos e Serviços da OS.
  const productCatalogOptions = productCatalog.map((p) => ({
    code: String(p.code), description: p.description, unit: p.unit, price: p.reference_value,
  }));
  const serviceCatalogOptions = serviceCatalog.map((s) => ({
    code: String(s.code), description: s.description, unit: s.unit, price: s.value,
  }));

  useEffect(() => {
    // Cadastros de apoio: se algum falhar o campo só fica sem sugestões
    api.getVehicles({ per_page: 1000 }).then((r) => setVehicles(asList(r))).catch(() => {});
    api.getDrivers().then((r) => setDrivers(r.data || [])).catch(() => {});
    api.getEmployees().then((r) => setEmployees(r.data || [])).catch(() => {});
    api.getOSCategories().then((r) => setOsCategories((r.data || []).filter((c) => c.active))).catch(() => {});
    api.getProducts().then((r) => setProductCatalog((r.data || []).filter((p) => p.status === 'ATIVO'))).catch(() => {});
    api.getServiceCatalog().then((r) => setServiceCatalog((r.data || []).filter((s) => s.active))).catch(() => {});

    if (isEdit) {
      api.getOrdemServico(id)
        .then(({ data: d }) => {
          setOsNumber(d.os_number);
          setSavedStatus(d.status);
          setHistory(d.history || []);
          setLegacyInfo({ created_at: d.created_at, created_by_name: d.created_by_name, updated_at: d.updated_at });
          setForm({
            ...buildEmpty(),
            ...d,
            products: d.products?.length ? d.products : [],
            services: d.services?.length ? d.services : [],
          });
        })
        .catch((error) => {
          toast.error(apiErrorMessage(error, 'Erro ao carregar OS'));
          backToList();
        })
        .finally(() => setLoading(false));
    } else {
      api.getOrdemServicoNextNumber()
        .then((r) => setOsNumber(r.data?.next_number || 1))
        .catch(() => setOsNumber(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onChange = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const setItem = (kind, idx, field, val) => {
    setForm((p) => {
      const arr = [...(p[kind] || [])];
      const item = { ...arr[idx], [field]: val };
      const q = Number(field === 'quantity' ? val : item.quantity || 0);
      const up = Number(field === 'unit_price' ? val : item.unit_price || 0);
      const ds = Number(field === 'discount' ? val : item.discount || 0);
      item.total = q * up - ds;
      arr[idx] = item;
      return { ...p, [kind]: arr };
    });
  };

  const addItem = (kind) => setForm((p) => ({
    ...p, [kind]: [...(p[kind] || []), { code: '', description: '', quantity: 1, unit: kind === 'services' ? 'quantidade' : 'UN', unit_price: 0, discount: 0, total: 0 }],
  }));
  const removeItem = (kind, idx) => setForm((p) => ({
    ...p, [kind]: (p[kind] || []).filter((_, i) => i !== idx),
  }));

  const productsTotal = (form.products || []).reduce((a, i) => a + Number(i.total || 0), 0);
  const servicesTotal = (form.services || []).reduce((a, i) => a + Number(i.total || 0), 0);

  const handleSave = async () => {
    if (locked) return;
    if (FINAL_STATUSES.includes(form.status)) {
      const verb = form.status === 'FECHADO' ? 'fechada' : 'cancelada';
      const ok = await confirm(
        `Depois de ${verb}, a OS não poderá mais ser editada nem excluída, e não aceitará mais saída de estoque. Deseja continuar?`,
        form.status === 'FECHADO' ? 'Finalizar Ordem de Serviço' : 'Cancelar Ordem de Serviço',
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const toItem = (i) => ({
        ...i,
        quantity: Number(i.quantity || 0),
        unit_price: Number(i.unit_price || 0),
        discount: Number(i.discount || 0),
        total: Number(i.total || 0),
      });
      const payload = {
        ...form,
        reading_initial: Number(form.reading_initial || 0),
        reading_final: Number(form.reading_final || 0),
        products: (form.products || []).map(toItem),
        services: (form.services || []).map(toItem),
      };
      if (isEdit) {
        await api.updateOrdemServico(id, payload);
        toast.success('OS atualizada');
      } else {
        await api.createOrdemServico(payload);
        toast.success('OS criada');
      }
      backToList();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Erro ao salvar'));
    } finally { setSaving(false); }
  };

  const categoryOptions = osCategories.map((c) => [c.name, c.name]);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4" data-testid="os-form-page">
        <PageHeader
          icon={FileText}
          title={locked ? 'Ordem de Serviço' : isEdit ? 'Editar Ordem de Serviço' : 'Nova Ordem de Serviço'}
          subtitle="Manutenção da frota"
          meta={osNumber !== null && <Badge variant="outline" className="text-primary border-primary/30">Nº {osNumber}</Badge>}
          backTo={LIST_PATH}
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            {locked && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200" data-testid="os-locked-banner">
                <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Esta OS está <strong>{savedStatus === 'FECHADO' ? 'fechada' : 'cancelada'}</strong> e fica apenas para consulta:
                  não pode mais ser editada nem receber saída de estoque.
                </span>
              </div>
            )}
            {/* fieldset desabilitado trava todos os campos e botões de uma vez */}
            <fieldset disabled={locked} className="space-y-4 min-w-0">
            <FormSection title="Dados da O.S." icon={FileText}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <SelectField label="Prioridade *" value={form.priority} onChange={(v) => onChange('priority', v)} options={[['ALTA', 'Alta'], ['MEDIA', 'Média'], ['BAIXA', 'Baixa']]} testid="os-priority" />
                <SelectField label="Tipo *" value={form.os_type} onChange={(v) => onChange('os_type', v)} options={[['INTERNO', 'Interno'], ['EXTERNO', 'Externo']]} testid="os-type" />
                <SelectField label="Status *" value={form.status} onChange={(v) => onChange('status', v)} options={[['ABERTO', 'Aberto'], ['ANDAMENTO', 'Em Andamento'], ['FECHADO', 'Fechado'], ['CANCELADO', 'Cancelado']]} testid="os-status" />
                <div>
                  <Label className="mb-1.5 block">Categoria *</Label>
                  <OptionAutocomplete
                    value={form.category}
                    onChange={(v) => onChange('category', v)}
                    options={categoryOptions}
                    className="text-sm"
                    testId="os-category"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block">Equipamento (Placa)</Label>
                  <WithQuickAdd kind="vehicle" testId="os-equipment-quick-add" initial={{ plate: form.equipment_plate }}
                    onCreated={(vh) => { setVehicles((prev) => [...prev, vh]); onChange('equipment_plate', vh.plate); onChange('equipment_id', vh.id); }}>
                    <Autocomplete
                      value={form.equipment_plate}
                      onChange={(v) => onChange('equipment_plate', formatPlate(v))}
                      onSelect={(vh) => { onChange('equipment_plate', formatPlate(vh.plate)); onChange('equipment_id', vh.id); }}
                      options={vehicles}
                      displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                      className="h-9 text-sm font-mono"
                    />
                  </WithQuickAdd>
                </div>
                <div>
                  <Label className="mb-1.5 block">Apropriação (Equip. Agregador)</Label>
                  <WithQuickAdd kind="vehicle" testId="os-appropriation-quick-add" initial={{ plate: form.appropriation_plate }}
                    onCreated={(vh) => { setVehicles((prev) => [...prev, vh]); onChange('appropriation_plate', vh.plate); onChange('appropriation_id', vh.id); }}>
                    <Autocomplete
                      value={form.appropriation_plate}
                      onChange={(v) => onChange('appropriation_plate', formatPlate(v))}
                      onSelect={(vh) => { onChange('appropriation_plate', formatPlate(vh.plate)); onChange('appropriation_id', vh.id); }}
                      options={vehicles}
                      displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                      className="h-9 text-sm font-mono"
                    />
                  </WithQuickAdd>
                </div>
                <div>
                  <Label className="mb-1.5 block">Pessoa *</Label>
                  <WithQuickAdd kind="driver" testId="os-person-quick-add" initial={{ name: form.person_name }}
                    onCreated={(p) => {
                      setDrivers((prev) => [...prev, p]);
                      onChange('person_name', p.name);
                      onChange('person_id', p.id);
                      onChange('person_type', 'motorista');
                      onChange('person_doc', p.cpf || '');
                      onChange('contact_value', p.phone || '');
                    }}>
                    <Autocomplete
                      value={form.person_name}
                      onChange={(v) => onChange('person_name', v)}
                      onSelect={(p) => {
                        onChange('person_name', p.name);
                        onChange('person_id', p.id);
                        onChange('person_type', p._type);
                        // Preenche CPF, telefone e endereço com o que já está no
                        // cadastro de Motorista/Funcionário, em vez de deixar
                        // esses campos em branco pro usuário redigitar.
                        onChange('person_doc', p.cpf || '');
                        onChange('contact_value', p.phone || '');
                        const addr = p.address_details || {};
                        onChange('address', formatAddress(addr));
                        onChange('city', addr.city || '');
                        onChange('state', addr.state || '');
                        onChange('city_uf', addr.city && addr.state ? `${addr.city}/${addr.state}` : (addr.city || addr.state || ''));
                      }}
                      options={people}
                      displayField="name"
                      className="h-9 text-sm"
                    />
                  </WithQuickAdd>
                </div>
                <Field label="CPF/CNPJ" value={form.person_doc} onChange={(v) => onChange('person_doc', v)} testid="os-person-doc" />
                <Field label="Telefone" value={form.contact_value} onChange={(v) => onChange('contact_value', v)} testid="os-phone" />
                <Field label="Endereço *" value={form.address} onChange={(v) => onChange('address', v)} testid="os-address" />
                <CityStateFields
                  flat
                  value={{ city: form.city, state: form.state }}
                  onChange={({ city, state }) => {
                    onChange('city', city);
                    onChange('state', state);
                    onChange('city_uf', city && state ? `${city}/${state}` : (city || state || ''));
                  }}
                />
                {!form.city && !form.state && form.city_uf && (
                  <p className="sm:col-span-2 lg:col-span-3 text-[0.6875rem] text-slate-400 dark:text-slate-500 -mt-2">
                    Cidade/UF cadastrada anteriormente (texto livre): {form.city_uf}
                  </p>
                )}
                <CheckboxField label="Retorno" value={form.is_retorno} onChange={(v) => onChange('is_retorno', v)} />
              </div>
            </FormSection>

            <FormSection title="Prazos" icon={CalendarClock}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field type="datetime-local" label="Abertura *" value={form.opened_at} onChange={(v) => onChange('opened_at', v)} testid="os-opened" />
                <Field type="datetime-local" label="Orçamento" value={form.budget_at} onChange={(v) => onChange('budget_at', v)} testid="os-budget" />
                <Field type="datetime-local" label="Aprovação" value={form.approved_at} onChange={(v) => onChange('approved_at', v)} testid="os-approved" />
                <Field type="datetime-local" label="Prev. Fechamento" value={form.forecast_close_at} onChange={(v) => onChange('forecast_close_at', v)} testid="os-forecast" />
                <Field type="datetime-local" label="Fechamento" value={form.closed_at} onChange={(v) => onChange('closed_at', v)} testid="os-closed" />
                <CheckboxField label="Exige PT?" value={form.requires_pt} onChange={(v) => onChange('requires_pt', v)} />
              </div>
            </FormSection>

            <FormSection title="Equipe e supervisão" icon={Users}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  ['supervisor', 'Supervisor'],
                  ['technician', 'Técnico'],
                  ['helper', 'Ajudante'],
                ].map(([role, label]) => (
                  <div key={role}>
                    <Label className="mb-1.5 block">{label}</Label>
                    <WithQuickAdd kind="employee" testId={`os-${role}-quick-add`} initial={{ name: form[`${role}_name`] }}
                      onCreated={(p) => { setEmployees((prev) => [...prev, p]); onChange(`${role}_name`, p.name); onChange(`${role}_id`, p.id); onChange(`${role}_type`, 'funcionario'); }}>
                      <Autocomplete
                        value={form[`${role}_name`]}
                        onChange={(v) => onChange(`${role}_name`, v)}
                        onSelect={(p) => { onChange(`${role}_name`, p.name); onChange(`${role}_id`, p.id); onChange(`${role}_type`, p._type); }}
                        options={people}
                        displayField="name"
                        className="h-9 text-sm"
                      />
                    </WithQuickAdd>
                  </div>
                ))}
              </div>
            </FormSection>

            <FormSection title="Controle de uso" icon={Gauge}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
                <Field type="number" label="Leitura Inicial (KM/HR)" value={form.reading_initial} onChange={(v) => onChange('reading_initial', v)} testid="os-rd-ini" />
                <Field type="number" label="Leitura Final (KM/HR)" value={form.reading_final} onChange={(v) => onChange('reading_final', v)} testid="os-rd-fim" />
              </div>
            </FormSection>

            <FormSection title="Descrição da O.S." icon={AlignLeft}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <TextAreaField label="Detalhamento da Demanda" value={form.description} onChange={(v) => onChange('description', v)} testid="os-desc" />
                <TextAreaField label="Ações Associadas" value={form.associated_actions} onChange={(v) => onChange('associated_actions', v)} testid="os-actions" />
                <TextAreaField label="Parecer de Encerramento" value={form.closure_remark} onChange={(v) => onChange('closure_remark', v)} testid="os-closure" />
                <TextAreaField label="Observação" value={form.observations} onChange={(v) => onChange('observations', v)} testid="os-obs" />
              </div>
            </FormSection>

            <ItemsSection title="Produtos" icon={Package} items={form.products || []} kind="products"
              onAdd={() => addItem('products')} onRemove={(i) => removeItem('products', i)}
              onChange={(i, f, v) => setItem('products', i, f, v)}
              catalogOptions={productCatalogOptions}
              quickKind="product" onCatalogCreated={(prod) => setProductCatalog((prev) => [...prev, prod])}
              toOption={(prod) => ({ code: String(prod.code), description: prod.description, unit: prod.unit, price: prod.reference_value })}
              showUnit={true} />

            <ItemsSection title="Serviços" icon={Wrench} items={form.services || []} kind="services"
              onAdd={() => addItem('services')} onRemove={(i) => removeItem('services', i)}
              onChange={(i, f, v) => setItem('services', i, f, v)}
              catalogOptions={serviceCatalogOptions}
              quickKind="service" onCatalogCreated={(svc) => setServiceCatalog((prev) => [...prev, svc])}
              toOption={(svc) => ({ code: String(svc.code), description: svc.description, unit: svc.unit, price: svc.value })}
              showUnit={true} />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <TotalBox label="Total produtos" value={productsTotal} />
              <TotalBox label="Total serviços" value={servicesTotal} />
              <TotalBox label="Valor total" value={productsTotal + servicesTotal} highlight />
            </div>
            </fieldset>

            {isEdit && <HistorySection history={history} legacyInfo={legacyInfo} />}

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={backToList} data-testid="os-cancel">{locked ? 'Voltar' : 'Cancelar'}</Button>
              {!locked && (
                <Button type="button" onClick={handleSave} disabled={saving} data-testid="os-save">
                  <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : isEdit ? 'Atualizar OS' : 'Salvar OS'}
                </Button>
              )}
            </FormActions>
          </div>
        )}
      </div>
      <ConfirmDialog />
    </Layout>
  );
}

const HISTORY_ACTIONS = {
  CRIADA: ['Criada', 'text-blue-700 dark:text-blue-300'],
  ALTERADA: ['Alterada', 'text-slate-700 dark:text-slate-300'],
  FINALIZADA: ['Fechada', 'text-emerald-700 dark:text-emerald-300'],
  CANCELADA: ['Cancelada', 'text-red-700 dark:text-red-300'],
};

// Cada gravação da OS, da mais recente para a mais antiga, com data, hora,
// usuário e o que mudou (de -> para).
function HistorySection({ history, legacyInfo }) {
  const entries = [...(history || [])].reverse();
  return (
    <FormSection title="Histórico de alterações" icon={History}>
      {entries.length === 0 ? (
        <div className="text-[0.75rem] text-slate-500 dark:text-slate-400 space-y-1" data-testid="os-history-empty">
          <p>Criada em {fmtDateTime(legacyInfo?.created_at)}{legacyInfo?.created_by_name ? ` por ${legacyInfo.created_by_name}` : ''}.</p>
          {legacyInfo?.updated_at && <p>Última alteração em {fmtDateTime(legacyInfo.updated_at)}.</p>}
          <p>Esta OS é anterior ao histórico detalhado: as próximas alterações aparecerão aqui.</p>
        </div>
      ) : (
        <ol className="space-y-2" data-testid="os-history">
          {entries.map((h, idx) => {
            const [label, tone] = HISTORY_ACTIONS[h.action] || [h.action, 'text-slate-700 dark:text-slate-300'];
            return (
              <li key={`${h.at}-${idx}`} className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">{fmtDateTime(h.at)}</span>
                  <span className={`font-semibold ${tone}`}>{label}</span>
                  {h.user_name && <span className="text-slate-500 dark:text-slate-400">por {h.user_name}</span>}
                </div>
                {(h.changes || []).length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[0.75rem] text-slate-600 dark:text-slate-400">
                    {h.changes.map((c) => (
                      <li key={c.field} className="break-words">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{c.label}:</span>{' '}
                        <span className="line-through decoration-slate-400">{c.old || '(vazio)'}</span>
                        {' → '}
                        <span>{c.new || '(vazio)'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </FormSection>
  );
}

function buildEmpty() {
  return {
    priority: 'MEDIA', requires_pt: false, os_type: 'EXTERNO', status: 'ABERTO',
    category: '', equipment_plate: '', equipment_id: '', person_doc: '', person_name: '',
    person_id: '', person_type: '',
    address: '', city_uf: '', city: '', state: '', is_retorno: false, contact_type: 'banco', contact_value: '',
    opened_at: nowLocalInput(),
    budget_at: '', approved_at: '', forecast_close_at: '', closed_at: '',
    appropriation_plate: '', appropriation_id: '', supervision_type: 'outros', supervision_value: '',
    reading_initial: 0, reading_final: 0,
    description: '', associated_actions: '', closure_remark: '',
    observations: '',
    helper_name: '', helper_id: '', helper_type: '',
    technician_name: '', technician_id: '', technician_type: '',
    supervisor_name: '', supervisor_id: '', supervisor_type: '',
    products: [], services: [],
  };
}

function Field({ label, value, onChange, type = 'text', testid }) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <Input type={type} value={value ?? ''}
        onChange={(e) => onChange(e.target.value)} className="h-9 text-sm" data-testid={testid} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, testid }) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <Select value={value || '_empty'} onValueChange={(v) => onChange(v === '_empty' ? '' : v)}>
        <SelectTrigger className="h-9 text-sm" data-testid={testid}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v || '_empty'} value={v || '_empty'} className="text-sm">{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CheckboxField({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-2 mt-5">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      <Label className="text-[0.75rem] text-slate-700 dark:text-slate-300">{label}</Label>
    </div>
  );
}

function TextAreaField({ label, value, onChange, testid }) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <Textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="text-sm min-h-[3.75rem]" data-testid={testid} />
    </div>
  );
}

// `quickKind`: tipo do cadastro rápido (o "+" ao lado da Descrição) - o
// produto/serviço novo entra no catálogo (`onCatalogCreated`) e já preenche a
// linha, convertido por `toOption` pro mesmo formato do catálogo.
function ItemsSection({ title, icon, items, kind, onAdd, onRemove, onChange, showUnit, catalogOptions = [], quickKind, onCatalogCreated, toOption }) {
  const fillFromCatalog = (idx, cat) => {
    onChange(idx, 'description', cat.description);
    onChange(idx, 'code', cat.code);
    if (cat.unit) onChange(idx, 'unit', cat.unit);
    onChange(idx, 'unit_price', cat.price ?? 0);
  };
  return (
    <FormSection
      title={title}
      icon={icon}
      actions={(
        <Button variant="outline" size="sm" type="button" onClick={onAdd} className="h-8 text-xs">
          <Plus className="w-3.5 h-3.5 mr-1" />Adicionar {title === 'Produtos' ? 'produto' : 'serviço'}
        </Button>
      )}
    >
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-center py-4 text-[0.75rem] text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded">
            Nenhum {title === 'Produtos' ? 'produto' : 'serviço'} adicionado
          </div>
        )}
        {items.map((it, idx) => (
          <div key={idx} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
            <div className="col-span-2 md:col-span-2">
              <Label className="mb-1.5 block">Código</Label>
              <Input value={it.code || ''} onChange={(e) => onChange(idx, 'code', e.target.value)} className="h-8 text-sm" data-testid={`${kind}-code-${idx}`} />
            </div>
            <div className="col-span-2 md:col-span-4">
              <Label className="mb-1.5 block">Descrição</Label>
              <WithQuickAdd kind={quickKind} size="sm" testId={`${kind}-quick-add-${idx}`} initial={{ description: (it.description || '').toUpperCase() }}
                onCreated={(record) => { if (onCatalogCreated) onCatalogCreated(record); fillFromCatalog(idx, toOption(record)); }}>
                <Autocomplete
                  value={it.description || ''}
                  onChange={(v) => onChange(idx, 'description', v)}
                  onSelect={(cat) => fillFromCatalog(idx, cat)}
                  options={catalogOptions}
                  displayField="description"
                  className="h-8 text-sm"
                />
              </WithQuickAdd>
            </div>
            <div className="md:col-span-1">
              <Label className="mb-1.5 block">Qtd</Label>
              <Input type="number" min="0" step="0.01" value={it.quantity ?? ''} onChange={(e) => onChange(idx, 'quantity', e.target.value)} className="h-8 text-sm text-right" data-testid={`${kind}-qty-${idx}`} />
            </div>
            {showUnit && (
              <div className="md:col-span-1">
                <Label className="mb-1.5 block">Un.</Label>
                <Input value={it.unit || ''} onChange={(e) => onChange(idx, 'unit', e.target.value)} className="h-8 text-sm" data-testid={`${kind}-unit-${idx}`} />
              </div>
            )}
            <div className="md:col-span-1">
              <Label className="mb-1.5 block">V. Unit.</Label>
              <Input type="number" min="0" step="0.01" value={it.unit_price ?? ''} onChange={(e) => onChange(idx, 'unit_price', e.target.value)} className="h-8 text-sm text-right" data-testid={`${kind}-unitprice-${idx}`} />
            </div>
            <div className="md:col-span-1">
              <Label className="mb-1.5 block">Desc.</Label>
              <Input type="number" min="0" step="0.01" value={it.discount ?? ''} onChange={(e) => onChange(idx, 'discount', e.target.value)} className="h-8 text-sm text-right" data-testid={`${kind}-disc-${idx}`} />
            </div>
            <div className="md:col-span-1">
              <Label className="mb-1.5 block">Total</Label>
              <Input value={fmtMoney(it.total)} readOnly className="h-8 text-sm text-right font-semibold bg-white dark:bg-slate-900" />
            </div>
            <div className="md:col-span-1">
              <Button title="Excluir" aria-label="Excluir" type="button" variant="ghost" size="sm" onClick={() => onRemove(idx)} className="h-8 px-2 text-destructive hover:text-red-700">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </FormSection>
  );
}

function TotalBox({ label, value, highlight }) {
  return (
    <div className={`p-3 rounded-lg border-2 ${highlight ? 'border-primary/40 bg-primary/5' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800'}`}>
      <div className={`text-xs ${highlight ? 'text-primary' : 'text-slate-500 dark:text-slate-400'} font-medium`}>{label}</div>
      <div className={`text-xl font-bold ${highlight ? 'text-primary' : 'text-slate-800 dark:text-slate-200'}`}>{fmtMoney(value)}</div>
    </div>
  );
}
