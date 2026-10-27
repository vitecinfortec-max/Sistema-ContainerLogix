import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  ToolbarDivider, StatusPill, EmptyState, TablePagination, usePagination, PlateTag,
} from '../components/DataPage';
import { FormSectionTitle, Field } from '../components/FormKit';
import { CityStateFields } from '../components/AddressFields';
import { Autocomplete } from '../components/Autocomplete';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import {
  CTE_EDITABLE, MDFE_STATUS_LABELS, MDFE_STATUS_TONES, SEGURO_RESPONSAVEL_OPTIONS, TIPO_CARGA_OPTIONS,
  TIPO_CARROCERIA_OPTIONS, TIPO_PROPRIETARIO_OPTIONS, TIPO_RODADO_OPTIONS, UF_LIST, downloadBlob, formatCnpjCpf, onlyDigits,
} from '../lib/fiscal';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import {
  Ban, CheckCircle2, Clock, FileCheck, FileCode, FileCog, Flag, Loader2, Pencil, Plus, Printer, RefreshCw, Save,
  Send, Trash2, Truck, UserPlus, X, XCircle,
} from 'lucide-react';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const toNumber = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const toInput = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const intOrNull = (v) => { const n = parseInt(onlyDigits(v), 10); return Number.isFinite(n) ? n : null; };

const emptyOwner = () => ({ cnpj_cpf: '', nome: '', rntrc: '', ie: '', uf: '', tipo: '1' });
const emptyVehicle = (uf, trailer = false) => ({
  vehicle_id: null, placa: '', renavam: '', tara: '', capacidade_kg: '',
  tipo_rodado: trailer ? undefined : '03', tipo_carroceria: trailer ? '04' : '00', uf_licenciamento: uf || '',
  terceiro: false, proprietario: emptyOwner(),
});

function buildEmpty(settings) {
  const uf = settings?.endereco?.uf || '';
  return {
    cte_ids: [],
    uf_inicio: uf, uf_fim: uf,
    municipios_carregamento: [{ cidade: '', uf }],
    percursos: [],
    data_inicio_viagem: '',
    descarregamentos: [{ cidade: '', uf, ctes: [''] }],
    veiculo: emptyVehicle(uf),
    reboques: [],
    condutores: [{ driver_id: null, nome: '', cpf: '' }],
    ciots: [],
    contratantes: [],
    seguro_responsavel: String(settings?.seguro_responsavel || 1),
    seguro_responsavel_cnpj_cpf: '',
    seguradora_nome: settings?.seguradora_nome || '',
    seguradora_cnpj: settings?.seguradora_cnpj ? formatCnpjCpf(settings.seguradora_cnpj) : '',
    seguro_apolice: settings?.seguro_apolice || '',
    averbacoes: [],
    tipo_carga: settings?.mdfe_tipo_carga || '04',
    descricao_produto: settings?.produto_predominante || 'CONTAINER',
    valor_total_carga: '', unidade_peso: '01', peso_bruto: '',
    observacoes: '',
  };
}

function vehicleToForm(v, uf, trailer) {
  if (!v) return emptyVehicle(uf, trailer);
  const owner = v.proprietario;
  return {
    ...emptyVehicle(uf, trailer), ...v,
    tara: v.tara ?? '', capacidade_kg: v.capacidade_kg ?? '',
    terceiro: !!(owner && owner.cnpj_cpf),
    proprietario: owner ? { ...emptyOwner(), ...owner, cnpj_cpf: formatCnpjCpf(owner.cnpj_cpf || '') } : emptyOwner(),
  };
}

function toForm(doc, settings) {
  const base = buildEmpty(settings);
  const uf = settings?.endereco?.uf || '';
  return {
    ...base, ...doc,
    municipios_carregamento: doc.municipios_carregamento?.length ? doc.municipios_carregamento : base.municipios_carregamento,
    descarregamentos: doc.descarregamentos?.length ? doc.descarregamentos.map((d) => ({ ...d, ctes: d.ctes?.length ? d.ctes : [''] })) : base.descarregamentos,
    veiculo: vehicleToForm(doc.veiculo, uf, false),
    reboques: (doc.reboques || []).map((r) => vehicleToForm(r, uf, true)),
    condutores: doc.condutores?.length ? doc.condutores.map((c) => ({ ...c, cpf: formatCnpjCpf(c.cpf || '') })) : base.condutores,
    ciots: (doc.ciots || []).map((c) => ({ ...c, responsavel_cnpj_cpf: formatCnpjCpf(c.responsavel_cnpj_cpf || '') })),
    contratantes: (doc.contratantes || []).map((c) => ({ ...c, cnpj_cpf: formatCnpjCpf(c.cnpj_cpf || '') })),
    seguro_responsavel: String(doc.seguro_responsavel || base.seguro_responsavel),
    seguradora_cnpj: doc.seguradora_cnpj ? formatCnpjCpf(doc.seguradora_cnpj) : base.seguradora_cnpj,
    valor_total_carga: toInput(doc.valor_total_carga),
    peso_bruto: toInput(doc.peso_bruto),
    data_inicio_viagem: doc.data_inicio_viagem || '',
    observacoes: doc.observacoes || '',
  };
}

function vehiclePayload(v, trailer) {
  const out = {
    vehicle_id: v.vehicle_id || null,
    placa: (v.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    renavam: onlyDigits(v.renavam) || null,
    tara: intOrNull(v.tara),
    capacidade_kg: intOrNull(v.capacidade_kg),
    tipo_carroceria: v.tipo_carroceria,
    uf_licenciamento: v.uf_licenciamento,
    proprietario: v.terceiro ? { ...v.proprietario, cnpj_cpf: onlyDigits(v.proprietario.cnpj_cpf) } : null,
  };
  if (!trailer) out.tipo_rodado = v.tipo_rodado;
  return out;
}

function toPayload(form) {
  return {
    cte_ids: form.cte_ids || [],
    uf_inicio: form.uf_inicio,
    uf_fim: form.uf_fim,
    municipios_carregamento: form.municipios_carregamento.filter((m) => m.cidade).map((m) => ({ cidade: m.cidade, uf: m.uf, codigo_municipio: m.codigo_municipio || null })),
    percursos: form.percursos.filter(Boolean),
    data_inicio_viagem: form.data_inicio_viagem || null,
    descarregamentos: form.descarregamentos.filter((d) => d.cidade).map((d) => ({
      cidade: d.cidade, uf: d.uf, codigo_municipio: d.codigo_municipio || null,
      ctes: d.ctes.map((k) => onlyDigits(k)).filter(Boolean),
    })),
    veiculo: vehiclePayload(form.veiculo, false),
    reboques: form.reboques.map((r) => vehiclePayload(r, true)),
    condutores: form.condutores.filter((c) => c.nome || c.cpf).map((c) => ({ driver_id: c.driver_id || null, nome: (c.nome || '').trim(), cpf: onlyDigits(c.cpf) })),
    ciots: form.ciots.filter((c) => c.numero).map((c) => ({ numero: onlyDigits(c.numero), responsavel_cnpj_cpf: onlyDigits(c.responsavel_cnpj_cpf) })),
    contratantes: form.contratantes.filter((c) => c.cnpj_cpf).map((c) => ({ nome: (c.nome || '').trim() || null, cnpj_cpf: onlyDigits(c.cnpj_cpf) })),
    seguro_responsavel: Number(form.seguro_responsavel),
    seguro_responsavel_cnpj_cpf: onlyDigits(form.seguro_responsavel_cnpj_cpf) || null,
    seguradora_nome: (form.seguradora_nome || '').trim() || null,
    seguradora_cnpj: onlyDigits(form.seguradora_cnpj) || null,
    seguro_apolice: (form.seguro_apolice || '').trim() || null,
    averbacoes: form.averbacoes.map((a) => (a || '').trim()).filter(Boolean),
    tipo_carga: form.tipo_carga,
    descricao_produto: (form.descricao_produto || '').trim(),
    valor_total_carga: toNumber(form.valor_total_carga),
    unidade_peso: form.unidade_peso,
    peso_bruto: toNumber(form.peso_bruto),
    observacoes: (form.observacoes || '').trim() || null,
  };
}

function UfSelect({ value, onChange, testId, allowEmpty = false }) {
  return (
    <Select value={value || '_empty'} onValueChange={(v) => onChange(v === '_empty' ? '' : v)}>
      <SelectTrigger data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value="_empty">-</SelectItem>}
        {UF_LIST.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function OptionSelect({ value, onChange, options, testId }) {
  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function RowRemove({ onClick }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-slate-400 hover:text-red-600" onClick={onClick} aria-label="Remover">
      <X className="w-4 h-4" />
    </Button>
  );
}

/** Veículo de tração ou reboque: escolhe do Cadastro de Veículo ou digita. */
function VehicleFields({ value, onChange, vehicles, trailer = false, testId }) {
  const v = value;
  const set = (field, val) => onChange({ ...v, [field]: val });
  const setOwner = (field, val) => onChange({ ...v, proprietario: { ...v.proprietario, [field]: val } });
  const pick = (vehicle) => onChange({
    ...v,
    vehicle_id: vehicle.id,
    placa: (vehicle.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    renavam: vehicle.renavam || '',
    tara: onlyDigits(vehicle.tare_weight) ? String(intOrNull(vehicle.tare_weight)) : v.tara,
  });
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Field label="Placa" required>
          <Autocomplete
            value={v.placa || ''}
            onChange={(text) => onChange({ ...v, placa: text.toUpperCase(), vehicle_id: null })}
            options={vehicles}
            displayField={(o) => o.plate}
            onSelect={pick}
            testId={testId ? `${testId}-placa` : undefined}
          />
        </Field>
        <Field label="RENAVAM">
          <Input value={v.renavam || ''} onChange={(e) => set('renavam', onlyDigits(e.target.value).slice(0, 11))} className="font-mono" />
        </Field>
        <Field label="Tara (kg)" required>
          <Input inputMode="numeric" value={v.tara} onChange={(e) => set('tara', onlyDigits(e.target.value).slice(0, 6))} data-testid={testId ? `${testId}-tara` : undefined} />
        </Field>
        <Field label="Capacidade (kg)" required={trailer}>
          <Input inputMode="numeric" value={v.capacidade_kg} onChange={(e) => set('capacidade_kg', onlyDigits(e.target.value).slice(0, 6))} />
        </Field>
        {!trailer && (
          <Field label="Rodado" required>
            <OptionSelect value={v.tipo_rodado} onChange={(val) => set('tipo_rodado', val)} options={TIPO_RODADO_OPTIONS} />
          </Field>
        )}
        <Field label="Carroceria" required>
          <OptionSelect value={v.tipo_carroceria} onChange={(val) => set('tipo_carroceria', val)} options={TIPO_CARROCERIA_OPTIONS} />
        </Field>
        <Field label="UF licenciamento" required>
          <UfSelect value={v.uf_licenciamento} onChange={(val) => set('uf_licenciamento', val)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <Checkbox checked={!!v.terceiro} onCheckedChange={(c) => set('terceiro', !!c)} />
        Veículo de terceiro (informar o proprietário)
      </label>
      {v.terceiro && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Field label="CNPJ / CPF" required>
            <Input value={v.proprietario.cnpj_cpf} onChange={(e) => setOwner('cnpj_cpf', formatCnpjCpf(e.target.value))} className="font-mono" />
          </Field>
          <Field label="Nome / Razão Social" required className="md:col-span-2">
            <Input value={v.proprietario.nome} onChange={(e) => setOwner('nome', e.target.value)} />
          </Field>
          <Field label="RNTRC" required>
            <Input value={v.proprietario.rntrc} onChange={(e) => setOwner('rntrc', onlyDigits(e.target.value).slice(0, 8))} className="font-mono" />
          </Field>
          <Field label="IE" required hint='ou "ISENTO"'>
            <Input value={v.proprietario.ie} onChange={(e) => setOwner('ie', e.target.value.toUpperCase())} />
          </Field>
          <Field label="UF" required>
            <UfSelect value={v.proprietario.uf} onChange={(val) => setOwner('uf', val)} />
          </Field>
          <Field label="Tipo" required className="md:col-span-2">
            <OptionSelect value={v.proprietario.tipo} onChange={(val) => setOwner('tipo', val)} options={TIPO_PROPRIETARIO_OPTIONS} />
          </Field>
        </div>
      )}
    </div>
  );
}

export default function MdfePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [settings, setSettings] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeForm, setCloseForm] = useState({ city: '', state: '', data: '' });
  const [driverOpen, setDriverOpen] = useState(false);
  const [driverForm, setDriverForm] = useState({ nome: '', cpf: '' });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const debounceRef = useRef(null);

  const filtered = statusFilter ? list.filter((m) => m.status === statusFilter) : list;
  const { pageItems, paginationProps } = usePagination(filtered, { resetKey: `${search}|${statusFilter}` });

  useEffect(() => {
    api.getFiscalSettings().then((r) => setSettings(r.data)).catch(() => setSettings({}));
    api.getVehicles({ per_page: 1000 }).then((r) => setVehicles(r.data?.items || r.data || [])).catch(() => {});
    api.getDrivers().then((r) => setDrivers((r.data || []).filter((d) => d.status !== 'INATIVO'))).catch(() => {});
  }, []);

  // "Gerar MDF-e" na tela de CT-e chega aqui com ?ctes=id1,id2
  useEffect(() => {
    const ids = (searchParams.get('ctes') || '').split(',').filter(Boolean);
    if (!ids.length || settings === null) return;
    setSearchParams({}, { replace: true });
    api.getMdfeDraftFromCtes(ids)
      .then((r) => { setEditingId(null); setForm(toForm(r.data, settings)); setDialogOpen(true); })
      .catch((e) => toast.error(e.response?.data?.detail || 'Erro ao montar o MDF-e a partir dos CT-es'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadList(); }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const loadList = async () => {
    setLoading(true);
    try {
      const r = await api.getMdfes(search ? { search } : {});
      setList(r.data || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao carregar os MDF-e');
    } finally {
      setLoading(false);
    }
  };

  const replaceInList = (doc) => setList((prev) => prev.map((m) => (m.id === doc.id ? doc : m)));
  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const setRow = (field, index, patch) => setForm((prev) => ({ ...prev, [field]: prev[field].map((row, i) => (i === index ? { ...row, ...patch } : row)) }));
  const addRow = (field, row) => setForm((prev) => ({ ...prev, [field]: [...prev[field], row] }));
  const removeRow = (field, index) => setForm((prev) => ({ ...prev, [field]: prev[field].filter((_, i) => i !== index) }));
  const setUnloadingKey = (di, ki, value) => setForm((prev) => ({
    ...prev,
    descarregamentos: prev.descarregamentos.map((d, i) => (i === di ? { ...d, ctes: d.ctes.map((k, j) => (j === ki ? value : k)) } : d)),
  }));

  const openCreate = () => { setEditingId(null); setForm(buildEmpty(settings)); setDialogOpen(true); };
  const openEdit = (doc) => { setEditingId(doc.id); setForm(toForm(doc, settings)); setDialogOpen(true); };

  const save = async ({ silent = false } = {}) => {
    if (saving) return null;
    setSaving(true);
    try {
      const payload = toPayload(form);
      const r = editingId ? await api.updateMdfe(editingId, payload) : await api.createMdfe(payload);
      setEditingId(r.data.id);
      if (!silent) toast.success('MDF-e salvo');
      await loadList();
      return r.data;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar o MDF-e');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const emit = async (doc) => {
    if (!doc) return null;
    const ambiente = settings?.ambiente === 'producao' ? 'PRODUÇÃO (com valor fiscal)' : 'homologação (teste, sem valor fiscal)';
    if (!(await confirm(`Transmitir este MDF-e para a Sefaz em ${ambiente}?`))) return null;
    setBusy('emit');
    try {
      const r = await api.emitMdfe(doc.id);
      replaceInList(r.data);
      const status = r.data.status;
      if (status === 'AUTORIZADO') toast.success(`MDF-e nº ${r.data.numero} autorizado`);
      else if (status === 'PENDENTE') toast.info('MDF-e na fila do emissor: use "Atualizar situação" em instantes');
      else toast.error(`MDF-e ${MDFE_STATUS_LABELS[status] || status}: ${r.data.motivo || ''}`);
      return r.data;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao transmitir o MDF-e', { duration: 12000 });
      loadList();
      return null;
    } finally {
      setBusy('');
    }
  };

  const saveAndEmit = async () => {
    const doc = await save({ silent: true });
    if (!doc) return;
    const result = await emit(doc);
    if (result && !CTE_EDITABLE.includes(result.status)) setDialogOpen(false);
  };

  const runAction = async (key, fn, success) => {
    setBusy(key);
    try {
      const r = await fn();
      replaceInList(r.data);
      toast.success(typeof success === 'function' ? success(r.data) : success);
      return true;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao falar com o emissor fiscal', { duration: 10000 });
      return false;
    } finally {
      setBusy('');
    }
  };

  const download = async (doc, kind) => {
    setBusy(kind);
    try {
      const r = kind === 'pdf' ? await api.getMdfePDF(doc.id) : await api.getMdfeXML(doc.id);
      downloadBlob(r.data, `MDFe_${doc.numero}_${doc.chave || doc.id}.${kind}`);
    } catch (e) {
      toast.error(kind === 'pdf' ? 'Erro ao baixar o DAMDFE' : 'Erro ao baixar o XML');
    } finally {
      setBusy('');
    }
  };

  const remove = async (doc) => {
    if (!(await confirm(`Excluir este MDF-e (${MDFE_STATUS_LABELS[doc.status]})?`))) return;
    try {
      await api.deleteMdfe(doc.id);
      setSelectedIds(new Set());
      toast.success('MDF-e excluído');
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao excluir');
    }
  };

  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selected = selectedIds.size === 1 ? list.find((m) => m.id === [...selectedIds][0]) : null;
  const isEditable = selected && CTE_EDITABLE.includes(selected.status);
  const isAuthorized = selected?.status === 'AUTORIZADO';
  const hasDocs = selected && ['AUTORIZADO', 'ENCERRADO', 'CANCELADO'].includes(selected.status);
  const count = (statuses) => filtered.filter((m) => statuses.includes(m.status)).length;
  const hasFilters = !!(search || statusFilter);
  const editingDoc = editingId ? list.find((m) => m.id === editingId) : null;

  const openClose = () => {
    const last = selected?.descarregamentos?.[selected.descarregamentos.length - 1] || {};
    setCloseForm({ city: last.cidade || '', state: last.uf || '', data: format(new Date(), 'yyyy-MM-dd') });
    setCloseOpen(true);
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="mdfe-page">
        <PageHeader
          icon={Truck}
          title="MDF-e"
          subtitle="Manifesto Eletrônico de Documentos Fiscais da viagem, emitido pela Focus NFe"
          actions={(
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/fiscal/cte')}><FileCheck className="w-4 h-4 mr-1.5" /> CT-e</Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/fiscal/configuracao')}><FileCog className="w-4 h-4 mr-1.5" /> Configuração Fiscal</Button>
            </div>
          )}
        />
        {settings && settings.ambiente !== 'producao' && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Ambiente de <b>homologação</b>: os MDF-e emitidos aqui não têm valor fiscal.</p>
        )}

        <StatGrid>
          <StatCard label="MDF-e" value={filtered.length} icon={Truck} tone="blue" hint={hasFilters ? 'com os filtros atuais' : 'cadastrados'} />
          <StatCard label="Em viagem (autorizados)" value={count(['AUTORIZADO'])} icon={CheckCircle2} tone="primary" hint="encerre ao fim da viagem" />
          <StatCard label="A transmitir / com pendência" value={count(['RASCUNHO', 'PENDENTE', 'REJEITADO', 'ERRO', 'ENVIANDO'])} icon={Clock} tone="amber" />
          <StatCard label="Encerrados / cancelados" value={count(['ENCERRADO', 'CANCELADO', 'DENEGADO'])} icon={XCircle} tone="slate" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setStatusFilter(''); }}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Nº, placa, motorista, cidade ou chave" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="mdfe-search" />
            </FilterField>
            <FilterField label="Situação">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  {Object.entries(MDFE_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Manifestos"
          count={loading ? '...' : filtered.length}
          toolbar={(
            <Toolbar selectedCount={selectedIds.size} primary={<ToolbarPrimary icon={Plus} label="Novo MDF-e" onClick={openCreate} testId="mdfe-new-btn" />}>
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => openEdit(selected)} disabled={!isEditable} testId="mdfe-edit-btn" />
              <ToolbarButton icon={Send} label="Transmitir" tone="emerald" onClick={() => emit(selected)} disabled={!isEditable || !!busy} testId="mdfe-emit-btn" />
              <ToolbarButton icon={RefreshCw} label="Atualizar situação" onClick={() => runAction('refresh', () => api.refreshMdfe(selected.id), (d) => `Situação: ${MDFE_STATUS_LABELS[d.status] || d.status}`)} disabled={!selected?.ref || !!busy} testId="mdfe-refresh-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={Flag} label="Encerrar" tone="violet" onClick={openClose} disabled={!isAuthorized || !!busy} testId="mdfe-close-btn" />
              <ToolbarButton icon={UserPlus} label="Incluir condutor" tone="blue" onClick={() => { setDriverForm({ nome: '', cpf: '' }); setDriverOpen(true); }} disabled={!isAuthorized || !!busy} testId="mdfe-driver-btn" />
              <ToolbarButton icon={Printer} label="DAMDFE" tone="emerald" onClick={() => download(selected, 'pdf')} disabled={!hasDocs || !!busy} testId="mdfe-pdf-btn" />
              <ToolbarButton icon={FileCode} label="XML" onClick={() => download(selected, 'xml')} disabled={!hasDocs || !!busy} testId="mdfe-xml-btn" />
              <ToolbarButton icon={Ban} label="Cancelar MDF-e" tone="red" onClick={() => setCancelOpen(true)} disabled={!isAuthorized} testId="mdfe-cancel-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => remove(selected)} disabled={!isEditable} testId="mdfe-delete-btn" />
            </Toolbar>
          )}
          footer={<TablePagination {...paginationProps} />}
        >
          {filtered.length === 0 && !loading ? (
            <EmptyState
              icon={Truck}
              title={hasFilters ? 'Nenhum MDF-e encontrado' : 'Nenhum MDF-e emitido'}
              hint={hasFilters ? 'Ajuste os filtros' : 'Na tela de CT-e, marque os CT-es autorizados da viagem e use "Gerar MDF-e"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0" />
                    <th>Nº</th>
                    <th>Placa</th>
                    <th>Motorista</th>
                    <th>Percurso</th>
                    <th className="text-right">CT-es</th>
                    <th className="text-right">Valor da carga</th>
                    <th>Situação</th>
                    <th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((m) => {
                    const ctes = (m.descarregamentos || []).reduce((n, d) => n + (d.ctes || []).length, 0);
                    const destinos = [...new Set((m.descarregamentos || []).map((d) => d.cidade).filter(Boolean))].join(', ');
                    return (
                      <tr key={m.id} onClick={() => toggleSelect(m.id)} data-selected={selectedIds.has(m.id)} className="cursor-pointer" data-testid={`mdfe-row-${m.id}`}>
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selectedIds.has(m.id)} onCheckedChange={() => toggleSelect(m.id)} />
                        </td>
                        <td className="cell-strong tabular-nums whitespace-nowrap">{m.numero || '-'}{m.serie != null && <span className="text-xs text-slate-400"> / {m.serie}</span>}</td>
                        <td>{m.veiculo?.placa ? <PlateTag>{m.veiculo.placa}</PlateTag> : '-'}</td>
                        <td><div className="max-w-[180px] truncate">{(m.condutores || []).map((c) => c.nome).join(', ') || '-'}</div></td>
                        <td className="whitespace-nowrap">{m.uf_inicio || '-'} → {m.uf_fim || '-'}<div className="text-xs text-slate-400 max-w-[220px] truncate">{destinos}</div></td>
                        <td className="text-right tabular-nums">{ctes}</td>
                        <td className="text-right tabular-nums whitespace-nowrap">{fmtMoney(m.valor_total_carga)}</td>
                        <td>
                          <StatusPill tone={MDFE_STATUS_TONES[m.status] || 'slate'} title={m.motivo || m.chave || ''}>{MDFE_STATUS_LABELS[m.status] || m.status}</StatusPill>
                          {m.ambiente === 'homologacao' && <span className="ml-1 text-[10px] text-slate-400 uppercase">homolog.</span>}
                        </td>
                        <td className="whitespace-nowrap tabular-nums">{m.created_at ? format(new Date(m.created_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
        {selected?.motivo && ['REJEITADO', 'ERRO', 'DENEGADO'].includes(selected.status) && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-4 py-3 text-sm text-red-800 dark:text-red-200" data-testid="mdfe-motivo">
            <b>Retorno da Sefaz / emissor:</b> {selected.motivo}
          </div>
        )}
        {selected?.chave && <p className="text-xs text-slate-500 font-mono" data-testid="mdfe-chave">Chave: {selected.chave}</p>}
        {selected?.status === 'AUTORIZADO' && (
          <p className="text-xs text-amber-700 dark:text-amber-300">Lembrete: encerre o MDF-e ao fim da viagem. Sem o encerramento a Sefaz recusa novo manifesto para a mesma placa.</p>
        )}
      </div>

      {/* Encerramento */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-lg" data-testid="mdfe-close-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Flag className="w-5 h-5 text-primary" /> Encerrar MDF-e nº {selected?.numero}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <CityStateFields value={{ city: closeForm.city, state: closeForm.state }} onChange={(v) => setCloseForm((p) => ({ ...p, city: v.city || '', state: v.state || '' }))} cityLabel="Município do encerramento" />
            <Field label="Data do encerramento">
              <Input type="date" value={closeForm.data} onChange={(e) => setCloseForm((p) => ({ ...p, data: e.target.value }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>Voltar</Button>
            <Button onClick={async () => { if (await runAction('close', () => api.closeMdfe(selected.id, { cidade: closeForm.city, uf: closeForm.state, data: closeForm.data }), 'MDF-e encerrado')) setCloseOpen(false); }}
              disabled={busy === 'close' || !closeForm.city || !closeForm.state} data-testid="mdfe-close-confirm">
              {busy === 'close' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Encerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inclusão de condutor */}
      <Dialog open={driverOpen} onOpenChange={setDriverOpen}>
        <DialogContent className="max-w-lg" data-testid="mdfe-driver-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><UserPlus className="w-5 h-5 text-primary" /> Incluir condutor no MDF-e nº {selected?.numero}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Nome" required className="md:col-span-2">
              <Autocomplete value={driverForm.nome} onChange={(t) => setDriverForm((p) => ({ ...p, nome: t }))} options={drivers}
                displayField={(d) => d.name} onSelect={(d) => setDriverForm({ nome: d.name, cpf: formatCnpjCpf(d.cpf || '') })} />
            </Field>
            <Field label="CPF" required>
              <Input value={driverForm.cpf} onChange={(e) => setDriverForm((p) => ({ ...p, cpf: formatCnpjCpf(e.target.value).slice(0, 14) }))} className="font-mono" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDriverOpen(false)}>Voltar</Button>
            <Button onClick={async () => { if (await runAction('driver', () => api.addMdfeDriver(selected.id, { nome: driverForm.nome, cpf: onlyDigits(driverForm.cpf) }), 'Condutor incluído')) setDriverOpen(false); }}
              disabled={busy === 'driver' || !driverForm.nome || onlyDigits(driverForm.cpf).length !== 11}>
              {busy === 'driver' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Incluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancelamento */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Ban className="w-5 h-5 text-red-600" /> Cancelar MDF-e nº {selected?.numero}</DialogTitle></DialogHeader>
          <Field label="Justificativa" required hint={`${justificativa.trim().length}/255 - mínimo 15 caracteres. Só é possível cancelar antes de a viagem começar (em geral até 24h); depois, encerre.`}>
            <Textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value.slice(0, 255))} rows={3} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Voltar</Button>
            <Button variant="destructive" disabled={busy === 'cancel' || justificativa.trim().length < 15}
              onClick={async () => { if (await runAction('cancel', () => api.cancelMdfe(selected.id, justificativa), 'MDF-e cancelado')) { setCancelOpen(false); setJustificativa(''); } }}>
              {busy === 'cancel' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Cancelar MDF-e
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Formulário */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto" data-testid="mdfe-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Truck className="w-5 h-5 text-primary" />
              {editingId ? 'Editar MDF-e' : 'Novo MDF-e'}
              {form.cte_ids?.length > 0 && <span className="text-sm font-normal text-slate-500">· {form.cte_ids.length} CT-e(s) do sistema</span>}
            </DialogTitle>
          </DialogHeader>
          {editingDoc?.motivo && ['REJEITADO', 'ERRO'].includes(editingDoc.status) && (
            <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-800 dark:text-red-200"><b>Último retorno:</b> {editingDoc.motivo}</div>
          )}

          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <FormSectionTitle>Percurso</FormSectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="UF de início" required><UfSelect value={form.uf_inicio} onChange={(v) => set('uf_inicio', v)} testId="mdfe-uf-inicio" /></Field>
                <Field label="UF de fim" required><UfSelect value={form.uf_fim} onChange={(v) => set('uf_fim', v)} testId="mdfe-uf-fim" /></Field>
                <Field label="Início previsto da viagem" className="col-span-2">
                  <Input type="datetime-local" value={form.data_inicio_viagem || ''} onChange={(e) => set('data_inicio_viagem', e.target.value)} />
                </Field>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500">UFs atravessadas no caminho (sem a de início e a de fim)</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => addRow('percursos', '')}><Plus className="w-3.5 h-3.5 mr-1" /> UF</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.percursos.map((uf, i) => (
                    <div key={i} className="flex gap-1 w-32">
                      <UfSelect value={uf} onChange={(v) => setForm((p) => ({ ...p, percursos: p.percursos.map((x, j) => (j === i ? v : x)) }))} allowEmpty />
                      <RowRemove onClick={() => removeRow('percursos', i)} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500">Municípios de carregamento *</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => addRow('municipios_carregamento', { cidade: '', uf: form.uf_inicio })}><Plus className="w-3.5 h-3.5 mr-1" /> Município</Button>
                </div>
                {form.municipios_carregamento.map((m, i) => (
                  <div key={i} className="flex gap-2 items-end">
                    <div className="flex-1"><CityStateFields value={{ city: m.cidade, state: m.uf }} onChange={(v) => setRow('municipios_carregamento', i, { cidade: v.city || '', uf: v.state || '', codigo_municipio: null })} /></div>
                    <RowRemove onClick={() => removeRow('municipios_carregamento', i)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormSectionTitle bare>Descarregamento e CT-es *</FormSectionTitle>
                <Button type="button" variant="outline" size="sm" onClick={() => addRow('descarregamentos', { cidade: '', uf: form.uf_fim, ctes: [''] })}><Plus className="w-3.5 h-3.5 mr-1" /> Município</Button>
              </div>
              {form.descarregamentos.map((d, di) => (
                <div key={di} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-testid={`mdfe-descarga-${di}`}>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1"><CityStateFields value={{ city: d.cidade, state: d.uf }} onChange={(v) => setRow('descarregamentos', di, { cidade: v.city || '', uf: v.state || '', codigo_municipio: null })} /></div>
                    <RowRemove onClick={() => removeRow('descarregamentos', di)} />
                  </div>
                  {d.ctes.map((k, ki) => (
                    <div key={ki} className="flex gap-2">
                      <Input value={k} onChange={(e) => setUnloadingKey(di, ki, onlyDigits(e.target.value).slice(0, 44))} className="font-mono" aria-label="Chave do CT-e" data-testid={`mdfe-chave-${di}-${ki}`} />
                      <RowRemove onClick={() => setRow('descarregamentos', di, { ctes: d.ctes.filter((_, j) => j !== ki) })} />
                    </div>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRow('descarregamentos', di, { ctes: [...d.ctes, ''] })}><Plus className="w-3.5 h-3.5 mr-1" /> Chave de CT-e</Button>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <FormSectionTitle>Veículo de tração</FormSectionTitle>
              <VehicleFields value={form.veiculo} onChange={(v) => set('veiculo', v)} vehicles={vehicles} testId="mdfe-veiculo" />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormSectionTitle bare>Reboques (até 3)</FormSectionTitle>
                <Button type="button" variant="outline" size="sm" disabled={form.reboques.length >= 3} onClick={() => addRow('reboques', emptyVehicle(settings?.endereco?.uf, true))}><Plus className="w-3.5 h-3.5 mr-1" /> Reboque</Button>
              </div>
              {form.reboques.map((r, i) => (
                <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                  <div className="flex justify-between items-center"><span className="text-xs font-semibold text-slate-500">Reboque {i + 1}</span><RowRemove onClick={() => removeRow('reboques', i)} /></div>
                  <VehicleFields value={r} onChange={(v) => setRow('reboques', i, v)} vehicles={vehicles} trailer testId={`mdfe-reboque-${i}`} />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormSectionTitle bare>Condutores *</FormSectionTitle>
                <Button type="button" variant="outline" size="sm" onClick={() => addRow('condutores', { driver_id: null, nome: '', cpf: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Condutor</Button>
              </div>
              {form.condutores.map((c, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <Field label="Nome" className="flex-1">
                    <Autocomplete value={c.nome || ''} onChange={(t) => setRow('condutores', i, { nome: t, driver_id: null })} options={drivers}
                      displayField={(d) => d.name} onSelect={(d) => setRow('condutores', i, { driver_id: d.id, nome: d.name, cpf: formatCnpjCpf(d.cpf || '') })} testId={`mdfe-condutor-${i}`} />
                  </Field>
                  <Field label="CPF" className="w-44">
                    <Input value={c.cpf || ''} onChange={(e) => setRow('condutores', i, { cpf: formatCnpjCpf(e.target.value).slice(0, 14) })} className="font-mono" />
                  </Field>
                  <RowRemove onClick={() => removeRow('condutores', i)} />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormSectionTitle bare>CIOT (motorista autônomo / TAC)</FormSectionTitle>
                <Button type="button" variant="outline" size="sm" onClick={() => addRow('ciots', { numero: '', responsavel_cnpj_cpf: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> CIOT</Button>
              </div>
              {form.ciots.map((c, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <Field label="Código CIOT (12 dígitos)" className="flex-1">
                    <Input value={c.numero} onChange={(e) => setRow('ciots', i, { numero: onlyDigits(e.target.value).slice(0, 12) })} className="font-mono" />
                  </Field>
                  <Field label="CNPJ/CPF de quem gerou" className="w-56">
                    <Input value={c.responsavel_cnpj_cpf} onChange={(e) => setRow('ciots', i, { responsavel_cnpj_cpf: formatCnpjCpf(e.target.value) })} className="font-mono" />
                  </Field>
                  <RowRemove onClick={() => removeRow('ciots', i)} />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormSectionTitle bare>Contratantes do transporte</FormSectionTitle>
                <Button type="button" variant="outline" size="sm" onClick={() => addRow('contratantes', { nome: '', cnpj_cpf: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Contratante</Button>
              </div>
              {form.contratantes.map((c, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <Field label="Nome" className="flex-1"><Input value={c.nome || ''} onChange={(e) => setRow('contratantes', i, { nome: e.target.value })} /></Field>
                  <Field label="CNPJ / CPF" className="w-56"><Input value={c.cnpj_cpf} onChange={(e) => setRow('contratantes', i, { cnpj_cpf: formatCnpjCpf(e.target.value) })} className="font-mono" /></Field>
                  <RowRemove onClick={() => removeRow('contratantes', i)} />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <FormSectionTitle>Seguro da carga</FormSectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Field label="Responsável" required>
                  <OptionSelect value={form.seguro_responsavel} onChange={(v) => set('seguro_responsavel', v)} options={SEGURO_RESPONSAVEL_OPTIONS} />
                </Field>
                {form.seguro_responsavel === '2' && (
                  <Field label="CNPJ/CPF do contratante responsável" required>
                    <Input value={form.seguro_responsavel_cnpj_cpf} onChange={(e) => set('seguro_responsavel_cnpj_cpf', formatCnpjCpf(e.target.value))} className="font-mono" />
                  </Field>
                )}
                <Field label="Seguradora"><Input value={form.seguradora_nome} maxLength={30} onChange={(e) => set('seguradora_nome', e.target.value)} /></Field>
                <Field label="CNPJ da seguradora"><Input value={form.seguradora_cnpj} onChange={(e) => set('seguradora_cnpj', formatCnpjCpf(e.target.value))} className="font-mono" /></Field>
                <Field label="Apólice"><Input value={form.seguro_apolice} maxLength={20} onChange={(e) => set('seguro_apolice', e.target.value)} /></Field>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500">Averbações</p>
                  <Button type="button" variant="ghost" size="sm" onClick={() => addRow('averbacoes', '')}><Plus className="w-3.5 h-3.5 mr-1" /> Averbação</Button>
                </div>
                {form.averbacoes.map((a, i) => (
                  <div key={i} className="flex gap-2 w-full md:w-1/2">
                    <Input value={a} maxLength={40} onChange={(e) => setForm((p) => ({ ...p, averbacoes: p.averbacoes.map((x, j) => (j === i ? e.target.value : x)) }))} aria-label="Número da averbação" />
                    <RowRemove onClick={() => removeRow('averbacoes', i)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <FormSectionTitle>Carga</FormSectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Field label="Tipo da carga" required className="col-span-2">
                  <OptionSelect value={form.tipo_carga} onChange={(v) => set('tipo_carga', v)} options={TIPO_CARGA_OPTIONS} />
                </Field>
                <Field label="Produto predominante" required className="col-span-2 md:col-span-3">
                  <Input value={form.descricao_produto} maxLength={120} onChange={(e) => set('descricao_produto', e.target.value.toUpperCase())} />
                </Field>
                <Field label="Valor total da carga (R$)" required>
                  <Input inputMode="decimal" value={form.valor_total_carga} onChange={(e) => set('valor_total_carga', e.target.value.replace(/[^\d,.]/g, ''))} data-testid="mdfe-valor-carga" />
                </Field>
                <Field label="Peso bruto" required>
                  <Input inputMode="decimal" value={form.peso_bruto} onChange={(e) => set('peso_bruto', e.target.value.replace(/[^\d,.]/g, ''))} data-testid="mdfe-peso" />
                </Field>
                <Field label="Unidade">
                  <OptionSelect value={form.unidade_peso} onChange={(v) => set('unidade_peso', v)} options={[['01', 'KG'], ['02', 'TON']]} />
                </Field>
              </div>
            </div>

            <div className="space-y-3">
              <FormSectionTitle>Informações complementares</FormSectionTitle>
              <Textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value.slice(0, 5000))} rows={2} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Fechar</Button>
            <Button variant="outline" onClick={() => save()} disabled={saving || !!busy} data-testid="mdfe-save-btn">
              {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />} Salvar rascunho
            </Button>
            <Button onClick={saveAndEmit} disabled={saving || !!busy} data-testid="mdfe-save-emit-btn">
              {busy === 'emit' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />} Salvar e transmitir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
