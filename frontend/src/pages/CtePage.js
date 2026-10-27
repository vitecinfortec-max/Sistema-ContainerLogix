import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  ToolbarDivider, StatusPill, EmptyState, TablePagination, usePagination,
} from '../components/DataPage';
import { FormSectionTitle, Field } from '../components/FormKit';
import { AddressFields, CityStateFields } from '../components/AddressFields';
import { ClientNamePicker } from '../components/ClientNamePicker';
import { Autocomplete } from '../components/Autocomplete';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import {
  CFOP_OPTIONS, CTE_EDITABLE, CTE_STATUS_LABELS, CTE_STATUS_TONES, ICMS_CST_OPTIONS, ICMS_WITH_RATE,
  IE_TOMADOR_OPTIONS, TOMADOR_OPTIONS, UNIDADE_OPTIONS, downloadBlob, formatCnpjCpf, fromAddressFields, toAddressFields,
} from '../lib/fiscal';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import {
  Ban, CheckCircle2, Clock, FileCheck, FileCode, FileCog, Loader2, PackageCheck, Pencil, Plus, Printer, RefreshCw,
  Save, Send, Trash2, Truck, X, XCircle,
} from 'lucide-react';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const toNumber = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
// Número digitado (pt-BR) a partir do valor salvo
const toInput = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

const emptyParty = () => ({ client_id: null, nome: '', cnpj_cpf: '', ie: '', fone: '', email: '', endereco: {} });

function buildEmpty(settings) {
  return {
    loading_order_id: null,
    loading_order_number: null,
    cfop: settings?.cfop_padrao || '5353',
    natureza_operacao: settings?.natureza_operacao || 'PRESTACAO DE SERVICO DE TRANSPORTE',
    tomador_papel: '0',
    indicador_ie_tomador: '1',
    remetente: emptyParty(),
    destinatario: emptyParty(),
    tomador: emptyParty(),
    origem: { cidade: '', uf: '' },
    destino: { cidade: '', uf: '' },
    valor_total: '',
    valor_receber: '',
    componentes: [],
    icms_cst: settings?.icms_cst || '00',
    icms_aliquota: toInput(settings?.icms_aliquota),
    valor_carga: '',
    produto_predominante: settings?.produto_predominante || 'CONTAINER',
    outras_caracteristicas: '',
    quantidades: [{ unidade: '01', tipo_medida: 'PESO BRUTO', quantidade: '' }],
    documentos: [{ tipo: 'NFE', chave: '', tipo_outros: '99', descricao: '', numero: '', data_emissao: '', valor: '' }],
    containers: [],
    observacoes: '',
  };
}

// Documento salvo -> formulário (números viram texto pt-BR)
function toForm(doc, settings) {
  const base = buildEmpty(settings);
  const party = (p) => ({ ...emptyParty(), ...(p || {}), cnpj_cpf: p?.cnpj_cpf ? formatCnpjCpf(p.cnpj_cpf) : '' });
  return {
    ...base,
    ...doc,
    tomador_papel: String(doc.tomador_papel ?? 0),
    indicador_ie_tomador: String(doc.indicador_ie_tomador ?? 1),
    remetente: party(doc.remetente),
    destinatario: party(doc.destinatario),
    tomador: party(doc.tomador),
    origem: doc.origem || base.origem,
    destino: doc.destino || base.destino,
    valor_total: toInput(doc.valor_total),
    valor_receber: toInput(doc.valor_receber),
    icms_cst: doc.icms_cst || base.icms_cst,
    icms_aliquota: toInput(doc.icms_aliquota ?? settings?.icms_aliquota),
    valor_carga: toInput(doc.valor_carga),
    componentes: (doc.componentes || []).map((c) => ({ ...c, valor: toInput(c.valor) })),
    quantidades: (doc.quantidades?.length ? doc.quantidades : base.quantidades).map((q) => ({ ...q, quantidade: toInput(q.quantidade) })),
    documentos: (doc.documentos?.length ? doc.documentos : base.documentos).map((d) => ({ ...base.documentos[0], ...d, valor: toInput(d.valor) })),
    containers: doc.containers || [],
    observacoes: doc.observacoes || '',
  };
}

function toPayload(form) {
  const party = (p) => ({ ...p, nome: (p.nome || '').trim(), cnpj_cpf: p.cnpj_cpf || null });
  const papel = Number(form.tomador_papel);
  return {
    loading_order_id: form.loading_order_id || null,
    loading_order_number: form.loading_order_number || null,
    cfop: form.cfop,
    natureza_operacao: (form.natureza_operacao || '').trim(),
    tomador_papel: papel,
    indicador_ie_tomador: Number(form.indicador_ie_tomador),
    remetente: party(form.remetente),
    destinatario: party(form.destinatario),
    tomador: papel === 4 ? party(form.tomador) : null,
    origem: form.origem,
    destino: form.destino,
    valor_total: toNumber(form.valor_total),
    valor_receber: toNumber(form.valor_receber),
    componentes: form.componentes.filter((c) => (c.nome || '').trim()).map((c) => ({ nome: c.nome.trim(), valor: toNumber(c.valor) || 0 })),
    icms_cst: form.icms_cst,
    icms_aliquota: ICMS_WITH_RATE.includes(form.icms_cst) ? toNumber(form.icms_aliquota) : null,
    valor_carga: toNumber(form.valor_carga),
    produto_predominante: (form.produto_predominante || '').trim(),
    outras_caracteristicas: (form.outras_caracteristicas || '').trim() || null,
    quantidades: form.quantidades.filter((q) => toNumber(q.quantidade)).map((q) => ({ ...q, quantidade: toNumber(q.quantidade) })),
    documentos: form.documentos
      .filter((d) => (d.tipo === 'NFE' ? (d.chave || '').replace(/\D/g, '') : (d.descricao || d.numero)))
      .map((d) => ({
        tipo: d.tipo,
        chave: d.tipo === 'NFE' ? (d.chave || '').replace(/\D/g, '') : null,
        tipo_outros: d.tipo === 'OUTROS' ? (d.tipo_outros || '99') : null,
        descricao: d.tipo === 'OUTROS' ? (d.descricao || '').trim() || null : null,
        numero: d.tipo === 'OUTROS' ? (d.numero || '').trim() || null : null,
        data_emissao: d.tipo === 'OUTROS' ? d.data_emissao || null : null,
        valor: d.tipo === 'OUTROS' ? toNumber(d.valor) : null,
      })),
    containers: form.containers.filter((c) => (c.numero || '').trim()).map((c) => ({ numero: c.numero.trim().toUpperCase(), lacre: (c.lacre || '').trim() || null })),
    observacoes: (form.observacoes || '').trim() || null,
  };
}

/** Remetente / Destinatário / Tomador: escolhe do cadastro de clientes ou digita. */
function PartyFields({ title, value, onChange, clients, testId }) {
  const v = value || emptyParty();
  const set = (field, val) => onChange({ ...v, [field]: val });
  const pick = (client) => {
    const d = client.address_details || {};
    onChange({
      client_id: client.id,
      nome: client.name || '',
      cnpj_cpf: client.cnpj ? formatCnpjCpf(client.cnpj) : '',
      ie: client.state_registration || '',
      fone: client.phone || '',
      email: client.email || '',
      endereco: fromAddressFields({ street: d.street, number: d.number, neighborhood: d.neighborhood, zip: d.zip, city: d.city, state: d.state }, {}),
    });
  };
  return (
    <div className="space-y-3" data-testid={testId}>
      <FormSectionTitle>{title}</FormSectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Nome / Razão Social" required className="md:col-span-2">
          <ClientNamePicker
            testId={testId ? `${testId}-name` : undefined}
            text={v.nome || ''}
            onTextChange={(text) => onChange({ ...v, nome: text, client_id: null })}
            onPick={pick}
            onClear={() => onChange(emptyParty())}
            clients={clients}
          />
        </Field>
        <Field label="CNPJ / CPF" required>
          <Input value={v.cnpj_cpf || ''} onChange={(e) => set('cnpj_cpf', formatCnpjCpf(e.target.value))} className="font-mono" />
        </Field>
        <Field label="Inscrição Estadual" hint='ou "ISENTO"'>
          <Input value={v.ie || ''} onChange={(e) => set('ie', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Telefone">
          <Input value={v.fone || ''} onChange={(e) => set('fone', e.target.value)} />
        </Field>
        <Field label="E-mail" className="md:col-span-3">
          <Input value={v.email || ''} onChange={(e) => set('email', e.target.value)} />
        </Field>
      </div>
      <AddressFields value={toAddressFields(v.endereco)} onChange={(addr) => set('endereco', fromAddressFields(addr, v.endereco))} />
    </div>
  );
}

function RowRemove({ onClick }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-slate-400 hover:text-red-600" onClick={onClick} aria-label="Remover">
      <X className="w-4 h-4" />
    </Button>
  );
}

export default function CtePage() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [settings, setSettings] = useState(null);
  const [clients, setClients] = useState([]);
  const [orders, setOrders] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [orderText, setOrderText] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const debounceRef = useRef(null);

  const filtered = statusFilter ? list.filter((c) => c.status === statusFilter) : list;
  const { pageItems, paginationProps } = usePagination(filtered, { resetKey: `${search}|${statusFilter}` });

  useEffect(() => {
    api.getFiscalSettings().then((r) => setSettings(r.data)).catch(() => setSettings({}));
    api.getClients().then((r) => setClients((r.data || []).filter((c) => c.status !== 'INATIVO'))).catch(() => {});
    api.getLoadingOrders().then((r) => setOrders(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadList(); }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const loadList = async () => {
    setLoading(true);
    try {
      const r = await api.getCtes(search ? { search } : {});
      setList(r.data || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao carregar os CT-e');
    } finally {
      setLoading(false);
    }
  };

  const replaceInList = (doc) => setList((prev) => prev.map((c) => (c.id === doc.id ? doc : c)));
  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const setRow = (field, index, patch) => setForm((prev) => ({
    ...prev, [field]: prev[field].map((row, i) => (i === index ? { ...row, ...patch } : row)),
  }));
  const addRow = (field, row) => setForm((prev) => ({ ...prev, [field]: [...prev[field], row] }));
  const removeRow = (field, index) => setForm((prev) => ({ ...prev, [field]: prev[field].filter((_, i) => i !== index) }));

  const openCreate = () => {
    setEditingId(null);
    setForm(buildEmpty(settings));
    setDialogOpen(true);
  };

  const openEdit = (doc) => {
    setEditingId(doc.id);
    setForm(toForm(doc, settings));
    setDialogOpen(true);
  };

  const openFromOrder = async (order) => {
    if (!order) return;
    try {
      const r = await api.getCteDraftFromLoadingOrder(order.id);
      setEditingId(null);
      setForm(toForm(r.data, settings));
      setOrderDialogOpen(false);
      setOrderText('');
      setDialogOpen(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao carregar a Ordem de Carregamento');
    }
  };

  const save = async ({ silent = false } = {}) => {
    if (saving) return null;
    setSaving(true);
    try {
      const payload = toPayload(form);
      const r = editingId ? await api.updateCte(editingId, payload) : await api.createCte(payload);
      setEditingId(r.data.id);
      if (!silent) toast.success('CT-e salvo');
      await loadList();
      return r.data;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar o CT-e');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const emit = async (doc) => {
    if (!doc) return;
    const ambiente = settings?.ambiente === 'producao' ? 'PRODUÇÃO (com valor fiscal)' : 'homologação (teste, sem valor fiscal)';
    if (!(await confirm(`Transmitir este CT-e para a Sefaz em ${ambiente}?`))) return;
    setBusy('emit');
    try {
      const r = await api.emitCte(doc.id);
      replaceInList(r.data);
      const status = r.data.status;
      if (status === 'AUTORIZADO') toast.success(`CT-e nº ${r.data.numero} autorizado`);
      else if (status === 'PENDENTE') toast.info('CT-e na fila do emissor: use "Atualizar situação" em instantes');
      else toast.error(`CT-e ${CTE_STATUS_LABELS[status] || status}: ${r.data.motivo || ''}`);
      return r.data;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao transmitir o CT-e', { duration: 12000 });
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

  const refresh = async (doc) => {
    setBusy('refresh');
    try {
      const r = await api.refreshCte(doc.id);
      replaceInList(r.data);
      toast.success(`Situação: ${CTE_STATUS_LABELS[r.data.status] || r.data.status}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao consultar a situação');
    } finally {
      setBusy('');
    }
  };

  const download = async (doc, kind) => {
    setBusy(kind);
    try {
      const r = kind === 'pdf' ? await api.getCtePDF(doc.id) : await api.getCteXML(doc.id);
      downloadBlob(r.data, `CTe_${doc.numero}_${doc.chave || doc.id}.${kind}`);
    } catch (e) {
      toast.error(kind === 'pdf' ? 'Erro ao baixar o DACTE' : 'Erro ao baixar o XML');
    } finally {
      setBusy('');
    }
  };

  const submitCancel = async (doc) => {
    setBusy('cancel');
    try {
      const r = await api.cancelCte(doc.id, justificativa);
      replaceInList(r.data);
      setCancelOpen(false);
      setJustificativa('');
      toast.success(r.data.status === 'CANCELADO' ? 'CT-e cancelado' : 'Cancelamento enviado, aguardando a Sefaz');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao cancelar o CT-e');
    } finally {
      setBusy('');
    }
  };

  const remove = async (doc) => {
    const note = doc.numero ? ` O número ${doc.numero} ficará sem uso.` : '';
    if (!(await confirm(`Excluir este CT-e (${CTE_STATUS_LABELS[doc.status]})?${note}`))) return;
    try {
      await api.deleteCte(doc.id);
      setSelectedIds(new Set());
      toast.success('CT-e excluído');
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
  const toggleSelectAllOnPage = () => {
    const pageIds = pageItems.map((c) => c.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const selected = selectedIds.size === 1 ? list.find((c) => c.id === [...selectedIds][0]) : null;
  const isEditable = selected && CTE_EDITABLE.includes(selected.status);
  const isDone = selected && ['AUTORIZADO', 'CANCELADO'].includes(selected.status);
  // MDF-e: um ou mais CT-es autorizados da mesma viagem
  const selectedDocs = list.filter((c) => selectedIds.has(c.id));
  const canManifest = selectedDocs.length > 0 && selectedDocs.every((c) => c.status === 'AUTORIZADO');
  const count = (statuses) => filtered.filter((c) => statuses.includes(c.status)).length;
  const hasFilters = !!(search || statusFilter);
  const editingDoc = editingId ? list.find((c) => c.id === editingId) : null;
  const notReady = settings && (!settings.provider_configured || !settings.provider_synced_at || !settings.certificate);

  return (
    <Layout>
      <div className="space-y-4" data-testid="cte-page">
        <PageHeader
          icon={FileCheck}
          title="CT-e"
          subtitle="Conhecimento de Transporte Eletrônico emitido pela Focus NFe"
          actions={(
            <Button variant="outline" size="sm" onClick={() => navigate('/fiscal/configuracao')} data-testid="cte-settings-btn">
              <FileCog className="w-4 h-4 mr-1.5" /> Configuração Fiscal
            </Button>
          )}
        />

        {notReady && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 text-sm text-amber-900 dark:text-amber-200" data-testid="cte-not-ready">
            Antes de emitir, complete a <button type="button" className="underline font-semibold" onClick={() => navigate('/fiscal/configuracao')}>Configuração Fiscal</button>
            {!settings.provider_configured ? ' (emissor ainda não configurado no servidor)' : !settings.provider_synced_at ? ' (envie o cadastro da empresa ao emissor)' : ' (envie o certificado A1)'}.
          </div>
        )}
        {settings && settings.ambiente !== 'producao' && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Ambiente de <b>homologação</b>: os CT-e emitidos aqui não têm valor fiscal.</p>
        )}

        <StatGrid>
          <StatCard label="CT-e" value={filtered.length} icon={FileCheck} tone="blue" hint={hasFilters ? 'com os filtros atuais' : 'cadastrados'} />
          <StatCard label="Autorizados" value={count(['AUTORIZADO'])} icon={CheckCircle2} tone="primary" />
          <StatCard label="A transmitir / com pendência" value={count(['RASCUNHO', 'PENDENTE', 'REJEITADO', 'ERRO', 'ENVIANDO'])} icon={Clock} tone="amber" />
          <StatCard label="Cancelados" value={count(['CANCELADO', 'DENEGADO'])} icon={XCircle} tone="red" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setStatusFilter(''); }}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Nº, cliente, container, chave ou nº da ordem" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="cte-search" />
            </FilterField>
            <FilterField label="Situação">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="cte-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  {Object.entries(CTE_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Conhecimentos de transporte"
          count={loading ? '...' : filtered.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo CT-e" onClick={openCreate} testId="cte-new-btn" />}
            >
              <ToolbarButton icon={PackageCheck} label="Da Ordem de Carregamento" tone="violet" onClick={() => setOrderDialogOpen(true)} testId="cte-from-order-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => openEdit(selected)} disabled={!isEditable} testId="cte-edit-btn" />
              <ToolbarButton icon={Send} label="Transmitir" tone="emerald" onClick={() => emit(selected)} disabled={!isEditable || !!busy} testId="cte-emit-btn" />
              <ToolbarButton icon={RefreshCw} label="Atualizar situação" tone="slate" onClick={() => refresh(selected)} disabled={!selected?.provider_id || !!busy} testId="cte-refresh-btn" />
              <ToolbarButton icon={Printer} label="DACTE" tone="emerald" onClick={() => download(selected, 'pdf')} disabled={!isDone || !!busy} testId="cte-pdf-btn" />
              <ToolbarButton icon={FileCode} label="XML" tone="slate" onClick={() => download(selected, 'xml')} disabled={!isDone || !!busy} testId="cte-xml-btn" />
              <ToolbarButton icon={Truck} label="Gerar MDF-e" tone="violet" onClick={() => navigate(`/fiscal/mdfe?ctes=${selectedDocs.map((c) => c.id).join(',')}`)} disabled={!canManifest} testId="cte-mdfe-btn" />
              <ToolbarButton icon={Ban} label="Cancelar CT-e" tone="red" onClick={() => setCancelOpen(true)} disabled={selected?.status !== 'AUTORIZADO'} testId="cte-cancel-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => remove(selected)} disabled={!isEditable} testId="cte-delete-btn" />
            </Toolbar>
          )}
          footer={<TablePagination {...paginationProps} />}
        >
          {filtered.length === 0 && !loading ? (
            <EmptyState
              icon={FileCheck}
              title={hasFilters ? 'Nenhum CT-e encontrado' : 'Nenhum CT-e emitido'}
              hint={hasFilters ? 'Ajuste os filtros' : 'Crie o primeiro pelo "Novo CT-e" ou a partir de uma Ordem de Carregamento'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox checked={pageItems.length > 0 && pageItems.every((c) => selectedIds.has(c.id))} onCheckedChange={toggleSelectAllOnPage} />
                    </th>
                    <th>Nº</th>
                    <th>Remetente</th>
                    <th>Destinatário</th>
                    <th>Percurso</th>
                    <th className="text-right">Valor</th>
                    <th>Situação</th>
                    <th>Ordem</th>
                    <th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((c) => (
                    <tr key={c.id} onClick={() => toggleSelect(c.id)} data-selected={selectedIds.has(c.id)} className="cursor-pointer" data-testid={`cte-row-${c.id}`}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">
                        {c.numero ? `${c.numero}` : '-'}
                        {c.serie !== null && c.serie !== undefined && <span className="text-xs text-slate-400"> / {c.serie}</span>}
                      </td>
                      <td><div className="max-w-[200px] truncate" title={c.remetente?.nome || ''}>{c.remetente?.nome || '-'}</div></td>
                      <td><div className="max-w-[200px] truncate" title={c.destinatario?.nome || ''}>{c.destinatario?.nome || '-'}</div></td>
                      <td className="whitespace-nowrap">
                        {c.origem?.cidade ? `${c.origem.cidade}/${c.origem.uf}` : '-'} → {c.destino?.cidade ? `${c.destino.cidade}/${c.destino.uf}` : '-'}
                      </td>
                      <td className="text-right tabular-nums whitespace-nowrap">{fmtMoney(c.valor_total)}</td>
                      <td>
                        <StatusPill tone={CTE_STATUS_TONES[c.status] || 'slate'} title={c.motivo || c.chave || ''}>
                          {CTE_STATUS_LABELS[c.status] || c.status}
                        </StatusPill>
                        {c.ambiente === 'homologacao' && <span className="ml-1 text-[10px] text-slate-400 uppercase">homolog.</span>}
                        {c.mdfe_numero && <div className="text-[11px] text-slate-500">MDF-e nº {c.mdfe_numero}</div>}
                      </td>
                      <td className="tabular-nums">{c.loading_order_number ? `#${c.loading_order_number}` : '-'}</td>
                      <td className="whitespace-nowrap tabular-nums">{c.created_at ? format(new Date(c.created_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
        {selected?.motivo && ['REJEITADO', 'ERRO', 'DENEGADO'].includes(selected.status) && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-4 py-3 text-sm text-red-800 dark:text-red-200" data-testid="cte-motivo">
            <b>Retorno da Sefaz / emissor:</b> {selected.motivo}
          </div>
        )}
        {selected?.chave && (
          <p className="text-xs text-slate-500 font-mono" data-testid="cte-chave">Chave: {selected.chave}{selected.protocolo ? ` · Protocolo: ${selected.protocolo}` : ''}</p>
        )}
      </div>

      {/* Escolha da Ordem de Carregamento */}
      <Dialog open={orderDialogOpen} onOpenChange={setOrderDialogOpen}>
        <DialogContent className="max-w-lg" data-testid="cte-order-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><PackageCheck className="w-5 h-5 text-primary" /> CT-e a partir da Ordem de Carregamento</DialogTitle>
          </DialogHeader>
          <Field label="Ordem de Carregamento" hint="Digite o número, o cliente ou o container">
            <Autocomplete
              value={orderText}
              onChange={setOrderText}
              options={orders.filter((o) => o.status !== 'CANCELADA')}
              displayField={(o) => `#${o.order_number} · ${o.client_name || 'sem cliente'} · ${(o.items || []).map((i) => i.container_number).filter(Boolean).join(', ') || '-'}`}
              onSelect={openFromOrder}
              testId="cte-order-input"
            />
          </Field>
        </DialogContent>
      </Dialog>

      {/* Cancelamento */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-lg" data-testid="cte-cancel-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Ban className="w-5 h-5 text-red-600" /> Cancelar CT-e nº {selected?.numero}</DialogTitle>
          </DialogHeader>
          <Field label="Justificativa" required hint={`${justificativa.trim().length}/255 - mínimo 15 caracteres. O prazo de cancelamento na Sefaz é curto (em geral 7 dias).`}>
            <Textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value.slice(0, 255))} rows={3} data-testid="cte-cancel-reason" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Voltar</Button>
            <Button variant="destructive" onClick={() => submitCancel(selected)} disabled={busy === 'cancel' || justificativa.trim().length < 15} data-testid="cte-cancel-confirm">
              {busy === 'cancel' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Cancelar CT-e
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Formulário */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto" data-testid="cte-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileCheck className="w-5 h-5 text-primary" />
              {editingId ? 'Editar CT-e' : 'Novo CT-e'}
              {form.loading_order_number && <span className="text-sm font-normal text-slate-500">· Ordem de Carregamento #{form.loading_order_number}</span>}
            </DialogTitle>
          </DialogHeader>
          {editingDoc?.motivo && ['REJEITADO', 'ERRO'].includes(editingDoc.status) && (
            <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-800 dark:text-red-200">
              <b>Último retorno:</b> {editingDoc.motivo}
            </div>
          )}

          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <FormSectionTitle>Operação</FormSectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Field label="CFOP" required className="md:col-span-2">
                  <Select value={form.cfop} onValueChange={(v) => set('cfop', v)}>
                    <SelectTrigger data-testid="cte-cfop"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CFOP_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Natureza da Operação" required className="md:col-span-2">
                  <Input value={form.natureza_operacao} onChange={(e) => set('natureza_operacao', e.target.value.toUpperCase())} maxLength={60} />
                </Field>
                <Field label="Tomador do serviço" required>
                  <Select value={form.tomador_papel} onValueChange={(v) => set('tomador_papel', v)}>
                    <SelectTrigger data-testid="cte-tomador"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TOMADOR_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Tomador perante o ICMS" required>
                  <Select value={form.indicador_ie_tomador} onValueChange={(v) => set('indicador_ie_tomador', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {IE_TOMADOR_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>

            <PartyFields title="Remetente" value={form.remetente} onChange={(v) => set('remetente', v)} clients={clients} testId="cte-remetente" />
            <PartyFields title="Destinatário" value={form.destinatario} onChange={(v) => set('destinatario', v)} clients={clients} testId="cte-destinatario" />
            {form.tomador_papel === '4' && (
              <PartyFields title="Tomador (outros)" value={form.tomador} onChange={(v) => set('tomador', v)} clients={clients} testId="cte-tomador-outros" />
            )}

            <div className="space-y-3">
              <FormSectionTitle>Percurso</FormSectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-1.5">Início da prestação</p>
                  <CityStateFields value={{ city: form.origem.cidade, state: form.origem.uf }}
                    onChange={(v) => set('origem', { cidade: v.city || '', uf: v.state || '', codigo_municipio: null })} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-1.5">Término da prestação</p>
                  <CityStateFields value={{ city: form.destino.cidade, state: form.destino.uf }}
                    onChange={(v) => set('destino', { cidade: v.city || '', uf: v.state || '', codigo_municipio: null })} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <FormSectionTitle>Valores e ICMS</FormSectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Field label="Valor total da prestação (R$)" required>
                  <Input inputMode="decimal" value={form.valor_total} onChange={(e) => set('valor_total', e.target.value.replace(/[^\d,.]/g, ''))} data-testid="cte-valor-total" />
                </Field>
                <Field label="Valor a receber (R$)" hint="Vazio = igual ao total">
                  <Input inputMode="decimal" value={form.valor_receber} onChange={(e) => set('valor_receber', e.target.value.replace(/[^\d,.]/g, ''))} />
                </Field>
                <Field label="ICMS (CST)" required>
                  <Select value={form.icms_cst} onValueChange={(v) => set('icms_cst', v)}>
                    <SelectTrigger data-testid="cte-icms-cst"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ICMS_CST_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Alíquota ICMS (%)" required={ICMS_WITH_RATE.includes(form.icms_cst)}>
                  <Input inputMode="decimal" value={form.icms_aliquota} disabled={!ICMS_WITH_RATE.includes(form.icms_cst)}
                    onChange={(e) => set('icms_aliquota', e.target.value.replace(/[^\d,.]/g, ''))} data-testid="cte-icms-aliquota" />
                </Field>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500">Componentes do valor (opcional - a soma deve bater com o total)</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => addRow('componentes', { nome: '', valor: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Componente</Button>
                </div>
                {form.componentes.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={c.nome} maxLength={15} onChange={(e) => setRow('componentes', i, { nome: e.target.value.toUpperCase() })} className="flex-1" aria-label="Nome do componente" />
                    <Input inputMode="decimal" value={c.valor} onChange={(e) => setRow('componentes', i, { valor: e.target.value.replace(/[^\d,.]/g, '') })} className="w-40" aria-label="Valor do componente" />
                    <RowRemove onClick={() => removeRow('componentes', i)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <FormSectionTitle>Carga</FormSectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Field label="Produto predominante" required>
                  <Input value={form.produto_predominante} onChange={(e) => set('produto_predominante', e.target.value.toUpperCase())} maxLength={60} />
                </Field>
                <Field label="Outras características">
                  <Input value={form.outras_caracteristicas || ''} onChange={(e) => set('outras_caracteristicas', e.target.value.toUpperCase())} maxLength={30} />
                </Field>
                <Field label="Valor da carga (R$)">
                  <Input inputMode="decimal" value={form.valor_carga} onChange={(e) => set('valor_carga', e.target.value.replace(/[^\d,.]/g, ''))} />
                </Field>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500">Quantidades *</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => addRow('quantidades', { unidade: '01', tipo_medida: 'PESO BRUTO', quantidade: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Quantidade</Button>
                </div>
                {form.quantidades.map((q, i) => (
                  <div key={i} className="flex gap-2">
                    <Select value={q.unidade} onValueChange={(v) => setRow('quantidades', i, { unidade: v })}>
                      <SelectTrigger className="w-32" aria-label="Unidade"><SelectValue /></SelectTrigger>
                      <SelectContent>{UNIDADE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input value={q.tipo_medida} maxLength={20} onChange={(e) => setRow('quantidades', i, { tipo_medida: e.target.value.toUpperCase() })} className="flex-1" aria-label="Tipo da medida" />
                    <Input inputMode="decimal" value={q.quantidade} onChange={(e) => setRow('quantidades', i, { quantidade: e.target.value.replace(/[^\d,.]/g, '') })} className="w-40" aria-label="Quantidade" data-testid={`cte-qtd-${i}`} />
                    <RowRemove onClick={() => removeRow('quantidades', i)} />
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500">Containers (vão como unidades de carga)</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => addRow('containers', { numero: '', lacre: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Container</Button>
                </div>
                {form.containers.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={c.numero} onChange={(e) => setRow('containers', i, { numero: e.target.value.toUpperCase() })} className="flex-1 font-mono" maxLength={20} aria-label="Container" />
                    <Input value={c.lacre || ''} onChange={(e) => setRow('containers', i, { lacre: e.target.value.toUpperCase() })} className="w-48 font-mono" maxLength={20} aria-label="Lacre" />
                    <RowRemove onClick={() => removeRow('containers', i)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormSectionTitle bare>Documentos transportados *</FormSectionTitle>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => addRow('documentos', { tipo: 'NFE', chave: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> NF-e</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => addRow('documentos', { tipo: 'OUTROS', tipo_outros: '99', descricao: '', numero: '', data_emissao: '', valor: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Outro documento</Button>
                </div>
              </div>
              {form.documentos.map((d, i) => (
                <div key={i} className="flex gap-2 items-end">
                  {d.tipo === 'NFE' ? (
                    <Field label="Chave da NF-e (44 dígitos)" className="flex-1">
                      <Input value={d.chave || ''} onChange={(e) => setRow('documentos', i, { chave: e.target.value.replace(/\D/g, '').slice(0, 44) })} className="font-mono" data-testid={`cte-nfe-${i}`} />
                    </Field>
                  ) : (
                    <>
                      <Field label="Tipo" className="w-36">
                        <Select value={d.tipo_outros || '99'} onValueChange={(v) => setRow('documentos', i, { tipo_outros: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="99">Outros</SelectItem>
                            <SelectItem value="00">Declaração</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Descrição" className="flex-1">
                        <Input value={d.descricao || ''} maxLength={100} onChange={(e) => setRow('documentos', i, { descricao: e.target.value })} />
                      </Field>
                      <Field label="Número" className="w-32">
                        <Input value={d.numero || ''} maxLength={20} onChange={(e) => setRow('documentos', i, { numero: e.target.value })} />
                      </Field>
                      <Field label="Emissão" className="w-40">
                        <Input type="date" value={d.data_emissao || ''} onChange={(e) => setRow('documentos', i, { data_emissao: e.target.value })} />
                      </Field>
                      <Field label="Valor (R$)" className="w-32">
                        <Input inputMode="decimal" value={d.valor || ''} onChange={(e) => setRow('documentos', i, { valor: e.target.value.replace(/[^\d,.]/g, '') })} />
                      </Field>
                    </>
                  )}
                  <RowRemove onClick={() => removeRow('documentos', i)} />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <FormSectionTitle>Observações</FormSectionTitle>
              <Textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value.slice(0, 2000))} rows={3} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Fechar</Button>
            <Button variant="outline" onClick={() => save()} disabled={saving || !!busy} data-testid="cte-save-btn">
              {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />} Salvar rascunho
            </Button>
            <Button onClick={saveAndEmit} disabled={saving || !!busy} data-testid="cte-save-emit-btn">
              {busy === 'emit' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />} Salvar e transmitir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
