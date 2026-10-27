import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  ToolbarDivider, StatusPill, EmptyState, TablePagination, usePagination, PlateTag,
} from '../components/DataPage';
import { Field, IssueSection } from '../components/FormKit';
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
  vehicleFromRegistry, waitWhilePending,
} from '../lib/fiscal';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { differenceInCalendarDays, format } from 'date-fns';
import {
  AlertTriangle, Ban, CheckCircle2, Clock, FileCheck, FileCode, FileCog, Flag, Loader2, Pencil, Plus, Printer, RefreshCw, Save,
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
const normPlate = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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

/** Dados do Cadastro de Veículo por cima do que está no formulário (números vazios no cadastro não apagam o digitado). */
function mergeRegistry(current, data) {
  const out = { ...current };
  ['vehicle_id', 'placa', 'renavam', 'tara', 'capacidade_kg', 'tipo_rodado', 'tipo_carroceria'].forEach((k) => {
    if (data[k] !== undefined && data[k] !== null && data[k] !== '') out[k] = data[k];
  });
  out.terceiro = !!data.terceiro;
  out.proprietario = data.terceiro ? { ...emptyOwner(), ...data.proprietario } : emptyOwner();
  return out;
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

// Blocos da página de emissão (as pendências da conferência levam até eles)
const SECTION_LABELS = {
  basicos: 'Configuração', percurso: 'Percurso', descarga: 'Descarregamento', condutores: 'Motorista e veículo',
  antt: 'CIOT e contratantes', seguro: 'Seguro da carga', carga: 'Carga',
};
const Section = (props) => <IssueSection idPrefix="mdfe" {...props} />;

const docOk = (v) => [11, 14].includes(onlyDigits(v).length);
const cteKeyOk = (k) => onlyDigits(k).length === 44 && onlyDigits(k).slice(20, 22) === '57';

function ownerIssues(owner, label, add) {
  const o = owner || {};
  if (!docOk(o.cnpj_cpf)) add(`${label}: CNPJ/CPF do proprietário inválido`);
  if ((o.nome || '').trim().length < 2) add(`${label}: informe o nome do proprietário`);
  if (onlyDigits(o.rntrc).length !== 8) add(`${label}: RNTRC do proprietário deve ter 8 dígitos`);
  if (!(o.ie || '').trim()) add(`${label}: informe a IE do proprietário (ou "ISENTO")`);
  if (!o.uf) add(`${label}: informe a UF do proprietário`);
}

/** Conferência local antes de transmitir (as mesmas regras do backend, menos o código IBGE, conferido lá). */
function validateMdfe(f, settings) {
  const issues = [];
  const add = (section) => (msg) => issues.push({ section, msg });
  if (settings && (!settings.provider_configured || !settings.provider_synced_at || !settings.certificate)) {
    add('basicos')('Configuração Fiscal incompleta (emissor, cadastro da empresa ou certificado A1)');
  }
  if (settings && onlyDigits(settings.rntrc).length !== 8) add('basicos')('Configuração Fiscal: RNTRC do emitente deve ter 8 dígitos');

  const percurso = add('percurso');
  if (!f.uf_inicio) percurso('Informe a UF de início (carregamento)');
  if (!f.uf_fim) percurso('Informe a UF de fim (descarregamento)');
  const carregamento = f.municipios_carregamento.filter((m) => (m.cidade || '').trim());
  if (!carregamento.length) percurso('Informe ao menos um município de carregamento');
  carregamento.forEach((m) => {
    if (m.uf !== f.uf_inicio) percurso(`Município de carregamento ${m.cidade} não é da UF de início (${f.uf_inicio || '-'})`);
  });
  f.percursos.filter(Boolean).forEach((uf) => {
    if ([f.uf_inicio, f.uf_fim].includes(uf)) percurso(`UF de percurso ${uf} não pode ser a de início nem a de fim`);
  });

  const descarga = add('descarga');
  const unloading = f.descarregamentos.filter((d) => (d.cidade || '').trim() || d.ctes.some((k) => onlyDigits(k)));
  if (!unloading.length) descarga('Informe ao menos um município de descarregamento com os CT-es');
  unloading.forEach((d) => {
    const cidade = (d.cidade || '').trim() || '-';
    if (cidade === '-') descarga('Descarregamento: informe o município');
    else if (d.uf !== f.uf_fim) descarga(`Município de descarregamento ${cidade} não é da UF de fim (${f.uf_fim || '-'})`);
    const keys = d.ctes.map(onlyDigits).filter(Boolean);
    if (!keys.length) descarga(`Descarregamento em ${cidade}: informe ao menos uma chave de CT-e`);
    else if (!keys.every(cteKeyOk)) descarga(`Descarregamento em ${cidade}: chave de CT-e inválida (44 dígitos, modelo 57)`);
  });
  const keys = f.descarregamentos.flatMap((d) => d.ctes.map(onlyDigits).filter(Boolean));
  if (new Set(keys).size !== keys.length) descarga('A mesma chave de CT-e aparece mais de uma vez');

  const condutor = add('condutores');
  const drivers = f.condutores.filter((c) => (c.nome || '').trim() || onlyDigits(c.cpf));
  if (!drivers.length) condutor('Informe ao menos um condutor');
  drivers.forEach((c) => {
    if ((c.nome || '').trim().length < 2 || onlyDigits(c.cpf).length !== 11) condutor(`Condutor ${(c.nome || '').trim() || '-'}: informe nome e CPF (11 dígitos)`);
  });
  const v = f.veiculo;
  if (normPlate(v.placa).length !== 7) condutor('Veículo: placa inválida (7 caracteres)');
  if (!(intOrNull(v.tara) > 0)) condutor('Veículo: informe a tara (kg)');
  if (!v.tipo_rodado) condutor('Veículo: informe o tipo de rodado');
  if (!v.tipo_carroceria) condutor('Veículo: informe o tipo de carroceria');
  if (!v.uf_licenciamento) condutor('Veículo: informe a UF de licenciamento');
  if (v.terceiro) ownerIssues(v.proprietario, 'Veículo', condutor);
  f.reboques.forEach((r, i) => {
    const label = `Reboque ${i + 1}`;
    if (normPlate(r.placa).length !== 7) condutor(`${label}: placa inválida (7 caracteres)`);
    if (!(intOrNull(r.tara) > 0)) condutor(`${label}: informe a tara (kg)`);
    if (!(intOrNull(r.capacidade_kg) > 0)) condutor(`${label}: informe a capacidade (kg)`);
    if (!r.uf_licenciamento) condutor(`${label}: informe a UF de licenciamento`);
    if (r.terceiro) ownerIssues(r.proprietario, label, condutor);
  });

  const antt = add('antt');
  f.ciots.filter((c) => c.numero || c.responsavel_cnpj_cpf).forEach((c) => {
    if (onlyDigits(c.numero).length !== 12) antt('CIOT deve ter 12 dígitos');
    if (!docOk(c.responsavel_cnpj_cpf)) antt('CIOT: informe o CNPJ/CPF do responsável pela geração');
  });
  f.contratantes.filter((c) => c.nome || c.cnpj_cpf).forEach((c) => {
    if (!docOk(c.cnpj_cpf)) antt(`Contratante ${(c.nome || '').trim() || '-'}: CNPJ/CPF inválido`);
  });

  const seguro = add('seguro');
  if (f.seguro_responsavel === '2' && !docOk(f.seguro_responsavel_cnpj_cpf)) seguro('Seguro da carga: informe o CNPJ/CPF do contratante responsável');
  if (onlyDigits(f.seguradora_cnpj) && onlyDigits(f.seguradora_cnpj).length !== 14) seguro('Seguro da carga: CNPJ da seguradora inválido');

  const carga = add('carga');
  if ((f.descricao_produto || '').trim().length < 2) carga('Informe a descrição do produto predominante');
  if (!(toNumber(f.valor_total_carga) > 0)) carga('Informe o valor total da carga');
  if (!(toNumber(f.peso_bruto) > 0)) carga('Informe o peso bruto da carga');
  return issues;
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

/** Veículo de tração ou reboque: escolhe do Cadastro de Veículo (que preenche o resto) ou digita. */
function VehicleFields({ value, onChange, vehicles, registry, onPicked, trailer = false, testId }) {
  const v = value;
  const set = (field, val) => onChange({ ...v, [field]: val });
  const setOwner = (field, val) => onChange({ ...v, proprietario: { ...v.proprietario, [field]: val } });
  const pick = (vehicle) => {
    onChange(mergeRegistry(v, vehicleFromRegistry(vehicle, { trailer, ...registry })));
    if (onPicked) onPicked(vehicle);
  };
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Field label="Placa" required>
          <Autocomplete
            value={v.placa || ''}
            onChange={(text) => onChange({ ...v, placa: text.toUpperCase(), vehicle_id: null })}
            options={vehicles}
            displayField={(o) => `${o.plate}${o.model ? ` · ${o.model}` : ''}`}
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
            <OptionSelect value={v.tipo_rodado} onChange={(val) => set('tipo_rodado', val)} options={TIPO_RODADO_OPTIONS} testId={testId ? `${testId}-rodado` : undefined} />
          </Field>
        )}
        <Field label="Carroceria" required>
          <OptionSelect value={v.tipo_carroceria} onChange={(val) => set('tipo_carroceria', val)} options={TIPO_CARROCERIA_OPTIONS} testId={testId ? `${testId}-carroceria` : undefined} />
        </Field>
        <Field label="UF licenciamento" required>
          <UfSelect value={v.uf_licenciamento} onChange={(val) => set('uf_licenciamento', val)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <Checkbox checked={!!v.terceiro} onCheckedChange={(c) => set('terceiro', !!c)} data-testid={testId ? `${testId}-terceiro` : undefined} />
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
  const [companies, setCompanies] = useState([]);
  const [registryReady, setRegistryReady] = useState(false);
  const [authorizedCtes, setAuthorizedCtes] = useState([]);
  const [cteFilter, setCteFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [emitted, setEmitted] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [closeDoc, setCloseDoc] = useState(null);
  const [closeForm, setCloseForm] = useState({ city: '', state: '', data: '' });
  const [driverOpen, setDriverOpen] = useState(false);
  const [driverForm, setDriverForm] = useState({ nome: '', cpf: '' });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const debounceRef = useRef(null);
  const activeRef = useRef(true);
  const issues = useMemo(() => validateMdfe(form, settings), [form, settings]);
  const issuesIn = (section) => issues.filter((i) => i.section === section).length;
  // Rola a página do formulário até o bloco (depois do diálogo renderizar)
  const scrollToSection = (id) => setTimeout(() => {
    document.getElementById(`mdfe-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);

  const filtered = statusFilter ? list.filter((m) => m.status === statusFilter) : list;
  const { pageItems, paginationProps } = usePagination(filtered, { resetKey: `${search}|${statusFilter}` });
  const registry = { companies, drivers };

  useEffect(() => {
    api.getFiscalSettings().then((r) => setSettings(r.data)).catch(() => setSettings({}));
    Promise.allSettled([
      api.getVehicles({ per_page: 1000 }).then((r) => setVehicles(r.data?.items || r.data || [])),
      api.getDrivers().then((r) => setDrivers((r.data || []).filter((d) => d.status !== 'INATIVO'))),
      api.getTransportCompanies().then((r) => setCompanies(r.data?.items || r.data || [])),
    ]).then(() => setRegistryReady(true));
    return () => { activeRef.current = false; };
  }, []);

  // "Gerar MDF-e" na tela de CT-e chega aqui com ?ctes=id1,id2
  useEffect(() => {
    const ids = (searchParams.get('ctes') || '').split(',').filter(Boolean);
    if (!ids.length || settings === null || !registryReady) return;
    setSearchParams({}, { replace: true });
    api.getMdfeDraftFromCtes(ids)
      .then((r) => openForm(fromDraft(r.data)))
      .catch((e) => toast.error(e.response?.data?.detail || 'Erro ao montar o MDF-e a partir dos CT-es'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, registryReady]);

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

  const replaceInList = (doc) => {
    setList((prev) => prev.map((m) => (m.id === doc.id ? doc : m)));
    setEmitted((prev) => (prev?.id === doc.id ? doc : prev));
  };
  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const setRow = (field, index, patch) => setForm((prev) => ({ ...prev, [field]: prev[field].map((row, i) => (i === index ? { ...row, ...patch } : row)) }));
  const addRow = (field, row) => setForm((prev) => ({ ...prev, [field]: [...prev[field], row] }));
  const removeRow = (field, index) => setForm((prev) => ({ ...prev, [field]: prev[field].filter((_, i) => i !== index) }));
  const setUnloadingKey = (di, ki, value) => setForm((prev) => ({
    ...prev,
    descarregamentos: prev.descarregamentos.map((d, i) => (i === di ? { ...d, ctes: d.ctes.map((k, j) => (j === ki ? value : k)) } : d)),
  }));

  const uf = settings?.endereco?.uf || '';
  const findVehicle = (plate) => (normPlate(plate) ? vehicles.find((v) => normPlate(v.plate) === normPlate(plate)) : null);
  // Completa um veículo do rascunho com o Cadastro de Veículo (rodado, carroceria, proprietário)
  const enrichVehicle = (v, trailer) => {
    const found = findVehicle(v?.placa);
    return found ? mergeRegistry(v, vehicleFromRegistry(found, { trailer, ...registry })) : v;
  };
  const fromDraft = (data) => {
    const f = toForm(data, settings);
    return { ...f, veiculo: enrichVehicle(f.veiculo, false), reboques: f.reboques.map((r) => enrichVehicle(r, true)) };
  };

  // Motorista e carreta vinculados ao cavalo escolhido (só preenche o que está vazio)
  const suggestFromTraction = (vehicle) => setForm((prev) => {
    let next = prev;
    const plate = normPlate(vehicle.plate);
    const driver = drivers.find((d) => d.id === vehicle.driver_id) || drivers.find((d) => normPlate(d.default_truck_plate) === plate);
    if (driver && !prev.condutores.some((c) => (c.nome || '').trim())) {
      next = { ...next, condutores: [{ driver_id: driver.id, nome: driver.name, cpf: formatCnpjCpf(driver.cpf || '') }] };
    }
    const trailer = findVehicle(driver?.default_trailer_plate);
    if (trailer && !prev.reboques.some((r) => r.placa)) {
      next = { ...next, reboques: [mergeRegistry(emptyVehicle(uf, true), vehicleFromRegistry(trailer, { trailer: true, ...registry }))] };
    }
    return next;
  });

  // Cavalo e carreta padrão do motorista escolhido, se ainda não há veículo
  const suggestFromDriver = (driver) => setForm((prev) => {
    if (prev.veiculo.placa) return prev;
    const truck = findVehicle(driver.default_truck_plate);
    if (!truck) return prev;
    let next = { ...prev, veiculo: mergeRegistry(prev.veiculo, vehicleFromRegistry(truck, registry)) };
    const trailer = findVehicle(driver.default_trailer_plate);
    if (trailer && !prev.reboques.some((r) => r.placa)) {
      next = { ...next, reboques: [mergeRegistry(emptyVehicle(uf, true), vehicleFromRegistry(trailer, { trailer: true, ...registry }))] };
    }
    return next;
  });

  const loadAuthorizedCtes = () => api.getCtes({ status: 'AUTORIZADO' })
    .then((r) => setAuthorizedCtes(r.data || []))
    .catch(() => setAuthorizedCtes([]));

  const openForm = (f, id = null) => {
    setEditingId(id);
    setEmitted(null);
    setForm(f);
    setCteFilter('');
    loadAuthorizedCtes();
    setDialogOpen(true);
  };
  const openCreate = () => openForm(buildEmpty(settings));
  const openEdit = (doc) => openForm(toForm(doc, settings), doc.id);

  /**
   * Marca/desmarca um CT-e da viagem: percurso, descarregamentos, contratantes,
   * peso e valor são remontados pelo servidor; veículo, reboques e condutores
   * só entram se ainda estiverem vazios. Chaves digitadas de CT-e de fora do
   * sistema são mantidas.
   */
  const toggleCte = async (id) => {
    const ids = form.cte_ids.includes(id) ? form.cte_ids.filter((x) => x !== id) : [...form.cte_ids, id];
    setBusy('ctes');
    try {
      const draft = ids.length ? fromDraft((await api.getMdfeDraftFromCtes(ids)).data) : null;
      const systemKeys = new Set(authorizedCtes.map((c) => c.chave).filter(Boolean));
      setForm((prev) => {
        const manual = prev.descarregamentos
          .map((d) => ({ ...d, ctes: d.ctes.filter((k) => onlyDigits(k) && !systemKeys.has(onlyDigits(k))) }))
          .filter((d) => d.ctes.length);
        if (!draft) {
          return { ...prev, cte_ids: [], descarregamentos: manual.length ? manual : [{ cidade: '', uf: prev.uf_fim, ctes: [''] }] };
        }
        const descarregamentos = draft.descarregamentos.map((d) => ({ ...d, ctes: [...d.ctes] }));
        manual.forEach((m) => {
          const same = descarregamentos.find((d) => d.cidade === m.cidade && d.uf === m.uf);
          if (same) same.ctes.push(...m.ctes); else descarregamentos.push(m);
        });
        return {
          ...prev,
          cte_ids: draft.cte_ids,
          uf_inicio: draft.uf_inicio,
          uf_fim: draft.uf_fim,
          municipios_carregamento: draft.municipios_carregamento,
          descarregamentos,
          contratantes: draft.contratantes,
          valor_total_carga: draft.valor_total_carga,
          peso_bruto: draft.peso_bruto,
          descricao_produto: draft.descricao_produto,
          observacoes: draft.observacoes,
          // Seguro do CT-e (ou o padrão da Configuração Fiscal); averbações somam
          seguro_responsavel: draft.seguro_responsavel,
          seguradora_nome: draft.seguradora_nome,
          seguradora_cnpj: draft.seguradora_cnpj,
          seguro_apolice: draft.seguro_apolice,
          averbacoes: [...new Set([...prev.averbacoes.filter((a) => (a || '').trim()), ...draft.averbacoes])],
          veiculo: prev.veiculo.placa ? prev.veiculo : draft.veiculo,
          reboques: prev.reboques.some((r) => r.placa) ? prev.reboques : draft.reboques,
          condutores: prev.condutores.some((c) => (c.nome || '').trim()) ? prev.condutores : draft.condutores,
        };
      });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao montar o MDF-e a partir dos CT-es');
    } finally {
      setBusy('');
    }
  };

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

  const emit = async (doc) => {
    if (!doc) return null;
    const ambiente = settings?.ambiente === 'producao' ? 'PRODUÇÃO (com valor fiscal)' : 'homologação (teste, sem valor fiscal)';
    if (!(await confirm(`Transmitir este MDF-e para a Sefaz em ${ambiente}?`))) return null;
    setBusy('emit');
    try {
      let result = (await api.emitMdfe(doc.id)).data;
      replaceInList(result);
      if (result.status === 'PENDENTE') {
        setBusy('wait');
        result = await waitWhilePending(result, api.refreshMdfe, { onUpdate: replaceInList, isActive: () => activeRef.current });
      }
      if (result.status === 'AUTORIZADO') {
        toast.success(`MDF-e nº ${result.numero} autorizado`, { action: { label: 'DAMDFE', onClick: () => download(result, 'pdf') } });
      } else if (result.status === 'PENDENTE') {
        toast.info('A Sefaz ainda não respondeu: use "Atualizar situação" em instantes');
      } else {
        toast.error(`MDF-e ${MDFE_STATUS_LABELS[result.status] || result.status}: ${result.motivo || ''}`, { duration: 12000 });
      }
      return result;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao transmitir o MDF-e', { duration: 12000 });
      loadList();
      return null;
    } finally {
      setBusy('');
    }
  };

  const saveAndEmit = async () => {
    if (issues.length) {
      scrollToSection('conferencia');
      toast.error(`Há ${issues.length} pendência(s) antes de transmitir`);
      return;
    }
    const doc = await save({ silent: true });
    if (!doc) return;
    const result = await emit(doc);
    if (!result) return;
    if (CTE_EDITABLE.includes(result.status)) scrollToSection('conferencia');
    else setEmitted(result);
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
  const emitting = busy === 'emit' || busy === 'wait';
  const onTrip = list.filter((m) => m.status === 'AUTORIZADO');

  // CT-es autorizados livres (ou já deste MDF-e), do mesmo ambiente dos já marcados
  const pickedCtes = authorizedCtes.filter((c) => form.cte_ids.includes(c.id));
  const ambientePicked = pickedCtes[0]?.ambiente;
  const cteQuery = cteFilter.trim().toUpperCase();
  const availableCtes = authorizedCtes.filter((c) => (!c.mdfe_id || c.mdfe_id === editingId || form.cte_ids.includes(c.id))
    && (!cteQuery || [c.numero, c.remetente?.nome, c.destinatario?.nome, c.destino?.cidade, c.loading_order_number, ...(c.containers || []).map((x) => x.numero)]
      .some((x) => String(x ?? '').toUpperCase().includes(cteQuery))));

  const openClose = (doc) => {
    if (!doc) return;
    const last = doc.descarregamentos?.[doc.descarregamentos.length - 1] || {};
    setCloseForm({ city: last.cidade || '', state: last.uf || '', data: format(new Date(), 'yyyy-MM-dd') });
    setCloseDoc(doc);
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

        {onTrip.length > 0 && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20 p-3 space-y-2" data-testid="mdfe-on-trip">
            <p className="text-sm font-semibold text-violet-900 dark:text-violet-200 flex items-center gap-2">
              <Truck className="w-4 h-4" /> Em viagem: encerre ao chegar (sem o encerramento a Sefaz recusa novo MDF-e para a mesma placa)
            </p>
            <div className="divide-y divide-violet-100 dark:divide-violet-900/60">
              {onTrip.map((m) => {
                const since = m.emitido_em || m.created_at;
                const days = since ? differenceInCalendarDays(new Date(), new Date(since)) : 0;
                const destinos = [...new Set((m.descarregamentos || []).map((d) => d.cidade).filter(Boolean))].join(', ');
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5 text-sm" data-testid={`mdfe-trip-${m.id}`}>
                    <span className="font-semibold tabular-nums">Nº {m.numero}</span>
                    {m.veiculo?.placa && <PlateTag>{m.veiculo.placa}</PlateTag>}
                    <span className="text-slate-600 dark:text-slate-300 truncate max-w-[260px]">{m.uf_inicio} → {destinos || m.uf_fim}</span>
                    <span className={`text-xs ${days >= 3 ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-slate-500'}`}>
                      {days === 0 ? 'emitido hoje' : `há ${days} dia(s)`}
                    </span>
                    <div className="ml-auto flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => download(m, 'pdf')} disabled={!!busy}><Printer className="w-3.5 h-3.5 mr-1" /> DAMDFE</Button>
                      <Button size="sm" variant="outline" onClick={() => openClose(m)} disabled={!!busy} data-testid={`mdfe-trip-close-${m.id}`}><Flag className="w-3.5 h-3.5 mr-1" /> Encerrar</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
              <ToolbarButton icon={Flag} label="Encerrar" tone="violet" onClick={() => openClose(selected)} disabled={!isAuthorized || !!busy} testId="mdfe-close-btn" />
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
              hint={hasFilters ? 'Ajuste os filtros' : 'Use "Novo MDF-e" e marque os CT-es autorizados da viagem'}
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
                      <tr key={m.id} onClick={() => toggleSelect(m.id)} onDoubleClick={() => CTE_EDITABLE.includes(m.status) && openEdit(m)}
                        data-selected={selectedIds.has(m.id)} className="cursor-pointer" data-testid={`mdfe-row-${m.id}`}>
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
      </div>

      {/* Encerramento */}
      <Dialog open={!!closeDoc} onOpenChange={(open) => { if (!open) setCloseDoc(null); }}>
        <DialogContent className="max-w-lg" data-testid="mdfe-close-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Flag className="w-5 h-5 text-primary" /> Encerrar MDF-e nº {closeDoc?.numero}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <CityStateFields value={{ city: closeForm.city, state: closeForm.state }} onChange={(v) => setCloseForm((p) => ({ ...p, city: v.city || '', state: v.state || '' }))} cityLabel="Município do encerramento" />
            <Field label="Data do encerramento">
              <Input type="date" value={closeForm.data} onChange={(e) => setCloseForm((p) => ({ ...p, data: e.target.value }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDoc(null)}>Voltar</Button>
            <Button onClick={async () => { if (await runAction('close', () => api.closeMdfe(closeDoc.id, { cidade: closeForm.city, uf: closeForm.state, data: closeForm.data }), 'MDF-e encerrado')) setCloseDoc(null); }}
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

      {/* Formulário: uma página só, com conferência antes de transmitir */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!emitting) setDialogOpen(open); }}>
        <DialogContent className="max-w-6xl max-h-[94vh] flex flex-col gap-0 p-0" data-testid="mdfe-dialog">
          <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <Truck className="w-5 h-5 text-primary" />
              {emitted ? `MDF-e nº ${emitted.numero || '-'}` : editingId ? 'Editar MDF-e' : 'Novo MDF-e'}
              {!emitted && form.cte_ids?.length > 0 && <span className="text-sm font-normal text-slate-500">· {form.cte_ids.length} CT-e(s) do sistema</span>}
              {!emitted && settings && settings.ambiente !== 'producao' && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Homologação</span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            {emitted ? (
              <div className="py-6 space-y-5 text-center" data-testid="mdfe-emitted">
                {emitted.status === 'AUTORIZADO'
                  ? <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600" />
                  : <Clock className="w-12 h-12 mx-auto text-amber-500" />}
                <div className="space-y-1">
                  <p className="text-lg font-semibold">
                    {emitted.status === 'AUTORIZADO' ? `MDF-e nº ${emitted.numero} autorizado` : `MDF-e ${(MDFE_STATUS_LABELS[emitted.status] || emitted.status).toLowerCase()}`}
                  </p>
                  {emitted.status === 'PENDENTE' && <p className="text-sm text-slate-500">A Sefaz ainda não respondeu. Consulte de novo em instantes.</p>}
                  {emitted.chave && <p className="text-xs font-mono text-slate-500 break-all">Chave: {emitted.chave}</p>}
                  {emitted.status === 'AUTORIZADO' && <p className="text-xs text-amber-700 dark:text-amber-300">Lembre de encerrar o MDF-e ao fim da viagem.</p>}
                  {emitted.motivo && emitted.status !== 'AUTORIZADO' && <p className="text-sm text-red-700 dark:text-red-300">{emitted.motivo}</p>}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {emitted.status === 'AUTORIZADO' ? (
                    <>
                      <Button onClick={() => download(emitted, 'pdf')} disabled={!!busy} data-testid="mdfe-emitted-pdf">
                        {busy === 'pdf' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Printer className="w-4 h-4 mr-1.5" />} DAMDFE
                      </Button>
                      <Button variant="outline" onClick={() => download(emitted, 'xml')} disabled={!!busy}><FileCode className="w-4 h-4 mr-1.5" /> XML</Button>
                    </>
                  ) : (
                    <Button variant="outline" disabled={!!busy}
                      onClick={() => runAction('refresh', () => api.refreshMdfe(emitted.id), (d) => `Situação: ${MDFE_STATUS_LABELS[d.status] || d.status}`)}>
                      {busy === 'refresh' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />} Atualizar situação
                    </Button>
                  )}
                  <Button variant="outline" onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" /> Novo MDF-e</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-7">
                {editingDoc?.motivo && ['REJEITADO', 'ERRO'].includes(editingDoc.status) && (
                  <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-800 dark:text-red-200"><b>Último retorno:</b> {editingDoc.motivo}</div>
                )}
                {issuesIn('basicos') > 0 && (
                  <section id="mdfe-sec-basicos" className="scroll-mt-3 space-y-1.5">
                    {issues.filter((it) => it.section === 'basicos').map((it, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                        <AlertTriangle className="w-4 h-4 shrink-0" /> {it.msg}
                        <button type="button" className="ml-auto text-xs underline" onClick={() => navigate('/fiscal/configuracao')}>Configuração Fiscal</button>
                      </div>
                    ))}
                  </section>
                )}

                <Section id="ctes" title="CT-es da viagem"
                  actions={(
                    <span className="text-xs text-slate-500">
                      {busy === 'ctes' && <Loader2 className="inline w-3.5 h-3.5 mr-1 animate-spin" />}
                      Marque os CT-es: percurso, descarga, peso, valor, motorista, veículo e seguro vêm deles
                    </span>
                  )}>
                  <div className="space-y-2" data-testid="mdfe-cte-picker">
                    <Input value={cteFilter} onChange={(e) => setCteFilter(e.target.value)} placeholder="Filtrar por nº, cliente, cidade, container ou ordem" className="h-9" />
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                      {availableCtes.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-slate-500">Nenhum CT-e autorizado disponível{cteQuery ? ' com esse filtro' : ' (os já manifestados não aparecem)'}.</p>
                      ) : availableCtes.map((c) => {
                        const checked = form.cte_ids.includes(c.id);
                        const otherAmbiente = !checked && ambientePicked && c.ambiente !== ambientePicked;
                        return (
                          <label key={c.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${otherAmbiente ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60'}`} data-testid={`mdfe-cte-${c.id}`}>
                            <Checkbox checked={checked} disabled={busy === 'ctes' || otherAmbiente} onCheckedChange={() => toggleCte(c.id)} />
                            <span className="w-16 font-semibold tabular-nums">Nº {c.numero}</span>
                            <span className="flex-1 min-w-0 truncate">{c.remetente?.nome || '-'} → {c.destinatario?.nome || '-'}</span>
                            <span className="hidden md:block w-44 truncate text-slate-500">{c.destino?.cidade ? `${c.destino.cidade}/${c.destino.uf}` : '-'}</span>
                            <span className="w-28 text-right tabular-nums">{fmtMoney(c.valor_carga || c.valor_total)}</span>
                            {c.ambiente === 'homologacao' && <span className="text-[10px] uppercase text-slate-400">homolog.</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </Section>

                <Section id="percurso" title="Percurso" count={issuesIn('percurso')}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Field label="UF de início" required><UfSelect value={form.uf_inicio} onChange={(v) => set('uf_inicio', v)} testId="mdfe-uf-inicio" /></Field>
                    <Field label="UF de fim" required><UfSelect value={form.uf_fim} onChange={(v) => set('uf_fim', v)} testId="mdfe-uf-fim" /></Field>
                    <Field label="Início previsto da viagem" className="col-span-2">
                      <Input type="datetime-local" value={form.data_inicio_viagem || ''} onChange={(e) => set('data_inicio_viagem', e.target.value)} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
                    <div className="lg:col-span-8 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Municípios de carregamento <span className="text-red-500">*</span></p>
                        <Button type="button" variant="outline" size="sm" onClick={() => addRow('municipios_carregamento', { cidade: '', uf: form.uf_inicio })}><Plus className="w-3.5 h-3.5 mr-1" /> Município</Button>
                      </div>
                      {form.municipios_carregamento.map((m, i) => (
                        <div key={i} className="flex gap-2 items-end">
                          <div className="flex-1"><CityStateFields value={{ city: m.cidade, state: m.uf }} onChange={(v) => setRow('municipios_carregamento', i, { cidade: v.city || '', uf: v.state || '', codigo_municipio: null })} /></div>
                          <RowRemove onClick={() => removeRow('municipios_carregamento', i)} />
                        </div>
                      ))}
                    </div>
                    <div className="lg:col-span-4 space-y-2 lg:border-l lg:border-slate-200 lg:pl-6 dark:lg:border-slate-700">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">UFs atravessadas</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => addRow('percursos', '')}><Plus className="w-3.5 h-3.5 mr-1" /> UF</Button>
                      </div>
                      {form.percursos.length === 0 && <p className="text-xs text-slate-500">Sem a de início e a de fim. Vazio = viagem direta.</p>}
                      <div className="flex flex-wrap gap-2">
                        {form.percursos.map((p, i) => (
                          <div key={i} className="flex gap-1 w-32">
                            <UfSelect value={p} onChange={(v) => setForm((prev) => ({ ...prev, percursos: prev.percursos.map((x, j) => (j === i ? v : x)) }))} allowEmpty />
                            <RowRemove onClick={() => removeRow('percursos', i)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </Section>

                <Section id="descarga" title="Descarregamento e CT-es" count={issuesIn('descarga')}
                  actions={<Button type="button" variant="outline" size="sm" onClick={() => addRow('descarregamentos', { cidade: '', uf: form.uf_fim, ctes: [''] })}><Plus className="w-3.5 h-3.5 mr-1" /> Município</Button>}>
                  {form.descarregamentos.map((d, di) => (
                    <div key={di} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-testid={`mdfe-descarga-${di}`}>
                      <div className="flex gap-2 items-end">
                        <div className="flex-1"><CityStateFields value={{ city: d.cidade, state: d.uf }} onChange={(v) => setRow('descarregamentos', di, { cidade: v.city || '', uf: v.state || '', codigo_municipio: null })} /></div>
                        <RowRemove onClick={() => removeRow('descarregamentos', di)} />
                      </div>
                      {d.ctes.map((k, ki) => {
                        const known = authorizedCtes.find((c) => c.chave && c.chave === onlyDigits(k));
                        const bad = onlyDigits(k).length === 44 && !cteKeyOk(k);
                        return (
                          <div key={ki} className="flex gap-2 items-center">
                            <Input value={k} onChange={(e) => setUnloadingKey(di, ki, onlyDigits(e.target.value).slice(0, 44))} placeholder="Chave do CT-e (44 dígitos)"
                              className={`font-mono ${bad ? 'border-red-400' : ''}`} aria-label="Chave do CT-e" data-testid={`mdfe-chave-${di}-${ki}`} />
                            {known && <span className="shrink-0 text-xs text-slate-500">CT-e nº {known.numero}</span>}
                            <RowRemove onClick={() => setRow('descarregamentos', di, { ctes: d.ctes.filter((_, j) => j !== ki) })} />
                          </div>
                        );
                      })}
                      <Button type="button" variant="ghost" size="sm" onClick={() => setRow('descarregamentos', di, { ctes: [...d.ctes, ''] })}><Plus className="w-3.5 h-3.5 mr-1" /> Chave de CT-e (de fora do sistema)</Button>
                    </div>
                  ))}
                </Section>

                <Section id="condutores" title="Motorista e veículo" count={issuesIn('condutores')}
                  actions={(
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => addRow('condutores', { driver_id: null, nome: '', cpf: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Condutor</Button>
                      <Button type="button" variant="outline" size="sm" disabled={form.reboques.length >= 3} onClick={() => addRow('reboques', emptyVehicle(uf, true))}><Plus className="w-3.5 h-3.5 mr-1" /> Reboque</Button>
                    </>
                  )}>
                  {form.condutores.map((c, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <Field label={i === 0 ? 'Motorista (condutor)' : undefined} required={i === 0} className="flex-1">
                        <Autocomplete value={c.nome || ''} onChange={(t) => setRow('condutores', i, { nome: t, driver_id: null })} options={drivers}
                          displayField={(d) => d.name}
                          onSelect={(d) => { setRow('condutores', i, { driver_id: d.id, nome: d.name, cpf: formatCnpjCpf(d.cpf || '') }); suggestFromDriver(d); }}
                          testId={`mdfe-condutor-${i}`} />
                      </Field>
                      <Field label={i === 0 ? 'CPF' : undefined} required={i === 0} className="w-44">
                        <Input value={c.cpf || ''} onChange={(e) => setRow('condutores', i, { cpf: formatCnpjCpf(e.target.value).slice(0, 14) })} className="font-mono" />
                      </Field>
                      <RowRemove onClick={() => removeRow('condutores', i)} />
                    </div>
                  ))}
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-500">Veículo principal (tração)</p>
                    <VehicleFields value={form.veiculo} onChange={(v) => set('veiculo', v)} vehicles={vehicles} registry={registry} onPicked={suggestFromTraction} testId="mdfe-veiculo" />
                  </div>
                  {form.reboques.map((r, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                      <div className="flex justify-between items-center"><span className="text-xs font-semibold text-slate-500">Vinculado 0{i + 1} (reboque)</span><RowRemove onClick={() => removeRow('reboques', i)} /></div>
                      <VehicleFields value={r} onChange={(v) => setRow('reboques', i, v)} vehicles={vehicles} registry={registry} trailer testId={`mdfe-reboque-${i}`} />
                    </div>
                  ))}
                </Section>

                <Section id="antt" title="CIOT e contratantes" count={issuesIn('antt')}
                  actions={(
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => addRow('ciots', { numero: '', responsavel_cnpj_cpf: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> CIOT</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => addRow('contratantes', { nome: '', cnpj_cpf: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Contratante</Button>
                    </>
                  )}>
                  {form.ciots.length === 0 && form.contratantes.length === 0 && (
                    <p className="text-xs text-slate-500">CIOT só para motorista autônomo / TAC. Os contratantes vêm dos CT-es marcados.</p>
                  )}
                  {form.ciots.map((c, i) => (
                    <div key={`ciot-${i}`} className="flex gap-2 items-end">
                      <Field label={i === 0 ? 'Código CIOT (12 dígitos)' : undefined} className="flex-1">
                        <Input value={c.numero} onChange={(e) => setRow('ciots', i, { numero: onlyDigits(e.target.value).slice(0, 12) })} className="font-mono" />
                      </Field>
                      <Field label={i === 0 ? 'CNPJ/CPF de quem gerou' : undefined} className="w-56">
                        <Input value={c.responsavel_cnpj_cpf} onChange={(e) => setRow('ciots', i, { responsavel_cnpj_cpf: formatCnpjCpf(e.target.value) })} className="font-mono" />
                      </Field>
                      <RowRemove onClick={() => removeRow('ciots', i)} />
                    </div>
                  ))}
                  {form.contratantes.map((c, i) => (
                    <div key={`contr-${i}`} className="flex gap-2 items-end">
                      <Field label={i === 0 ? 'Contratante' : undefined} className="flex-1"><Input value={c.nome || ''} onChange={(e) => setRow('contratantes', i, { nome: e.target.value })} /></Field>
                      <Field label={i === 0 ? 'CNPJ / CPF' : undefined} className="w-56"><Input value={c.cnpj_cpf} onChange={(e) => setRow('contratantes', i, { cnpj_cpf: formatCnpjCpf(e.target.value) })} className="font-mono" /></Field>
                      <RowRemove onClick={() => removeRow('contratantes', i)} />
                    </div>
                  ))}
                </Section>

                <Section id="seguro" title="Seguro da carga" count={issuesIn('seguro')}
                  actions={<Button type="button" variant="outline" size="sm" onClick={() => addRow('averbacoes', '')}><Plus className="w-3.5 h-3.5 mr-1" /> Averbação</Button>}>
                  <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
                    <Field label="Responsável" required className="md:col-span-2">
                      <OptionSelect value={form.seguro_responsavel} onChange={(v) => set('seguro_responsavel', v)} options={SEGURO_RESPONSAVEL_OPTIONS} />
                    </Field>
                    {form.seguro_responsavel === '2' && (
                      <Field label="CNPJ/CPF do contratante" required className="md:col-span-2">
                        <Input value={form.seguro_responsavel_cnpj_cpf} onChange={(e) => set('seguro_responsavel_cnpj_cpf', formatCnpjCpf(e.target.value))} className="font-mono" />
                      </Field>
                    )}
                    <Field label="Seguradora" className={`col-span-2 ${form.seguro_responsavel === '2' ? 'md:col-span-3' : 'md:col-span-4'}`}>
                      <Input value={form.seguradora_nome} maxLength={30} onChange={(e) => set('seguradora_nome', e.target.value)} />
                    </Field>
                    <Field label="CNPJ da seguradora" className={form.seguro_responsavel === '2' ? 'md:col-span-2' : 'md:col-span-3'}>
                      <Input value={form.seguradora_cnpj} onChange={(e) => set('seguradora_cnpj', formatCnpjCpf(e.target.value))} className="font-mono" />
                    </Field>
                    <Field label="Nº apólice" className={form.seguro_responsavel === '2' ? 'md:col-span-3' : 'md:col-span-3'}>
                      <Input value={form.seguro_apolice} maxLength={20} onChange={(e) => set('seguro_apolice', e.target.value)} />
                    </Field>
                  </div>
                  {form.averbacoes.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {form.averbacoes.map((a, i) => (
                        <div key={i} className="flex gap-1">
                          <Input value={a} maxLength={40} placeholder="Nº da averbação" onChange={(e) => setForm((p) => ({ ...p, averbacoes: p.averbacoes.map((x, j) => (j === i ? e.target.value : x)) }))} aria-label="Número da averbação" />
                          <RowRemove onClick={() => removeRow('averbacoes', i)} />
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section id="carga" title="Totais da carga" count={issuesIn('carga')}>
                  <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
                    <Field label="Tipo da carga" required className="col-span-2 md:col-span-3">
                      <OptionSelect value={form.tipo_carga} onChange={(v) => set('tipo_carga', v)} options={TIPO_CARGA_OPTIONS} />
                    </Field>
                    <Field label="Produto predominante" required className="col-span-2 md:col-span-3">
                      <Input value={form.descricao_produto} maxLength={120} onChange={(e) => set('descricao_produto', e.target.value.toUpperCase())} />
                    </Field>
                    <Field label="Valor total (R$)" required className="md:col-span-2">
                      <Input inputMode="decimal" value={form.valor_total_carga} onChange={(e) => set('valor_total_carga', e.target.value.replace(/[^\d,.]/g, ''))} className="text-right" data-testid="mdfe-valor-carga" />
                    </Field>
                    <Field label="Peso bruto" required className="md:col-span-2">
                      <Input inputMode="decimal" value={form.peso_bruto} onChange={(e) => set('peso_bruto', e.target.value.replace(/[^\d,.]/g, ''))} className="text-right" data-testid="mdfe-peso" />
                    </Field>
                    <Field label="Unidade" className="md:col-span-2">
                      <OptionSelect value={form.unidade_peso} onChange={(v) => set('unidade_peso', v)} options={[['01', 'KG'], ['02', 'TON']]} />
                    </Field>
                  </div>
                </Section>

                <Section id="observacoes" title="Informações complementares">
                  <Textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value.slice(0, 5000))} rows={3} />
                </Section>

                <Section id="conferencia" title="Conferência antes de transmitir">
                  {issues.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" data-testid="mdfe-conferencia-ok">
                      <CheckCircle2 className="w-4 h-4 shrink-0" /> Tudo certo para transmitir.
                    </div>
                  ) : (
                    <ul className="space-y-1.5" data-testid="mdfe-issues">
                      {issues.map((it, i) => (
                        <li key={i}>
                          <button type="button" onClick={() => scrollToSection(it.section)}
                            className="flex w-full items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span className="flex-1">{it.msg}</span>
                            <span className="shrink-0 text-xs opacity-80">{SECTION_LABELS[it.section]} ↑</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>
            )}
          </div>

          <DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 space-x-0 sm:space-x-0 border-t border-slate-100 px-4 sm:px-6 py-3 dark:border-slate-800">
            {!emitted && (
              issues.length ? (
                <button type="button" onClick={() => scrollToSection('conferencia')} className="mr-auto flex items-center gap-1.5 text-sm font-medium text-amber-700 hover:underline dark:text-amber-300" data-testid="mdfe-issues-count">
                  <AlertTriangle className="w-4 h-4" /> {issues.length} pendência(s)
                </button>
              ) : (
                <span className="mr-auto flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="w-4 h-4" /> Pronto para transmitir</span>
              )
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={emitting}>Fechar</Button>
            {!emitted && (
              <>
                <Button variant="outline" onClick={() => save()} disabled={saving || !!busy} data-testid="mdfe-save-btn">
                  {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />} Salvar rascunho
                </Button>
                <Button onClick={saveAndEmit} disabled={saving || !!busy} data-testid="mdfe-save-emit-btn">
                  {emitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
                  {busy === 'wait' ? 'Aguardando a Sefaz...' : 'Salvar e transmitir'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
