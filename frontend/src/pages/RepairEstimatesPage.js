import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatGrid, StatCard, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination, UserTag,
} from '../components/DataPage';
import { Field, FormSectionTitle } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../hooks/useConfirm';
import { toast } from 'sonner';
import {
  FileWarning, Plus, Eye, Pencil, Trash2, Printer, CheckCircle2, XCircle, RotateCcw, Ban, Clock, AlertTriangle, ThumbsUp, ThumbsDown,
  Download, X, ShieldCheck, Search, Loader2,
} from 'lucide-react';
import { addDays, format } from 'date-fns';
import { todayISO } from '../lib/dates';

const PAGE_SIZE = 15;

const STATUS = {
  EM_ABERTO: { label: 'Em aberto', tone: 'blue' },
  APROVADO: { label: 'Aprovado', tone: 'emerald' },
  REPROVADO: { label: 'Reprovado', tone: 'red' },
  CANCELADO: { label: 'Cancelado', tone: 'slate' },
};

const SIZE_TYPES = ['20DC', '20RF', '20OT', '20FR', '40HC', '40RF', '40OT', '40FR', '40DRY'];

const formatMoney = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const estimateCode = (number) => `OR${String(number || 0).padStart(6, '0')}`;
const vistoriaCode = (number) => `VC${String(number || 0).padStart(6, '0')}`;
const toNumber = (value) => {
  const parsed = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

// Validade conta da data de emissão (dia de Brasília, igual ao backend)
const validUntil = (estimate) => addDays(new Date(estimate.created_at), estimate.validity_days || 0);
const isExpired = (estimate) => estimate.status === 'EM_ABERTO' && format(validUntil(estimate), 'yyyy-MM-dd') < todayISO();

const emptyItem = () => ({ description: '', quantity: 1, unit_price: '' });

function emptyForm() {
  return {
    container_number: '',
    vistoria_id: null,
    vistoria_number: null,
    client_name: '',
    shipping_line: '',
    size_type: '',
    items: [emptyItem()],
    discount: '',
    validity_days: 15,
    execution_days: '',
    observations: '',
  };
}

export default function RepairEstimatesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [estimates, setEstimates] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [repairServices, setRepairServices] = useState([]);
  const [lastPrices, setLastPrices] = useState({});
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery.trim());

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEstimate, setEditingEstimate] = useState(null);
  const [formData, setFormData] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [vistoriaNumber, setVistoriaNumber] = useState('');
  const [lookingUpVistoria, setLookingUpVistoria] = useState(false);

  const [detailEstimate, setDetailEstimate] = useState(null);
  // Aprovar / reprovar: { status, target, responded_by, note }
  const [statusDialog, setStatusDialog] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const filterParams = () => {
    const params = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (statusFilter) params.status = statusFilter;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  };

  useEffect(() => {
    // Cadastros de apoio podem estar desativados: aí os campos são só digitados
    const asList = (res) => (Array.isArray(res.data) ? res.data : (res.data.items || []));
    api.getContainerRepairServices().then((res) => setRepairServices(asList(res))).catch(() => setRepairServices([]));
    api.getClients().then((res) => setClients(asList(res))).catch(() => setClients([]));
    api.getShippingLines().then((res) => setShippingLines(asList(res))).catch(() => setShippingLines([]));
  }, []);

  // Vindo de "Gerar orçamento" na Vistoria de Container: já abre o novo
  // orçamento preenchido com ela
  useEffect(() => {
    const vistoriaId = searchParams.get('vistoria');
    if (!vistoriaId) return;
    setSearchParams({}, { replace: true });
    (async () => {
      try {
        const [vistoriaRes, prices] = await Promise.all([api.getContainerVistoria(vistoriaId), refreshAuxiliary()]);
        setEditingEstimate(null);
        setFormData(fillFromVistoria(emptyForm(), vistoriaRes.data, prices));
        setModalOpen(true);
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Não foi possível carregar a vistoria');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadEstimates();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, debouncedSearch, statusFilter, dateFrom, dateTo]);

  const loadEstimates = async () => {
    try {
      const [listRes, summaryRes] = await Promise.all([
        api.getRepairEstimates({ ...filterParams(), page: pagination.page, per_page: PAGE_SIZE }),
        api.getRepairEstimatesSummary(),
      ]);
      setEstimates(listRes.data.items);
      setPagination((prev) => ({ ...prev, pages: listRes.data.pages, total: listRes.data.total }));
      setSummary(summaryRes.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao carregar orçamentos');
    } finally {
      setLoading(false);
    }
  };

  // Preços sugeridos: recarregados a cada abertura do formulário, pra já
  // trazer o que foi lançado desde a última vez
  const refreshAuxiliary = async () => {
    const prices = await api.getRepairEstimatesLastPrices().then((res) => res.data).catch(() => ({}));
    setLastPrices(prices);
    return prices;
  };

  // Digita o nº da vistoria (123 ou VC000123) e Enter: puxa container,
  // cliente, armador, tamanho e os serviços marcados nela
  const lookupVistoria = async () => {
    const number = vistoriaNumber.trim();
    if (!number || lookingUpVistoria) return;
    setLookingUpVistoria(true);
    try {
      const res = await api.getContainerVistoriaByNumber(number);
      const vistoria = res.data;
      setFormData((prev) => fillFromVistoria(prev, vistoria));
      setVistoriaNumber('');
      if (vistoria.no_damage || !(vistoria.damage_items || []).length) {
        toast.warning(`${vistoriaCode(vistoria.vistoria_number)} não tem serviços de reparo marcados - inclua os itens manualmente`);
      } else {
        toast.success(`${vistoriaCode(vistoria.vistoria_number)}: ${vistoria.damage_items.length} serviço(s) incluído(s)`);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Vistoria não encontrada');
    } finally {
      setLookingUpVistoria(false);
    }
  };

  const suggestedPrice = (description, prices = lastPrices) => {
    const price = prices[(description || '').trim().toLowerCase()];
    return price !== undefined ? price : '';
  };

  // Os "Tipo de Serviços" da vistoria entram como itens (sem repetir os já
  // lançados), com o último preço usado em cada um
  const fillFromVistoria = (form, vistoria, prices = lastPrices) => {
    const kept = form.items.filter((item) => item.description.trim());
    const existing = new Set(kept.map((item) => item.description.trim().toLowerCase()));
    const added = (vistoria.damage_items || [])
      .filter((name) => !existing.has(name.trim().toLowerCase()))
      .map((name) => ({ description: name, quantity: 1, unit_price: suggestedPrice(name, prices) }));
    const items = [...kept, ...added];
    return {
      ...form,
      vistoria_id: vistoria.id,
      vistoria_number: vistoria.vistoria_number,
      container_number: vistoria.container_number || form.container_number,
      client_name: vistoria.client_name || form.client_name,
      shipping_line: vistoria.shipping_line || form.shipping_line,
      size_type: vistoria.size_type || form.size_type,
      items: items.length ? items : [emptyItem()],
    };
  };

  const changeFilter = (setter) => (value) => {
    setter(value);
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const hasFilters = !!(searchQuery || statusFilter || dateFrom || dateTo);

  // ---------- Seleção ----------
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const pageIds = estimates.map((e) => e.id);
      if (pageIds.length > 0 && pageIds.every((id) => prev.has(id))) return new Set();
      return new Set(pageIds);
    });
  };

  const selectedEstimates = estimates.filter((e) => selectedIds.has(e.id));
  const single = selectedEstimates.length === 1 ? selectedEstimates[0] : null;
  const isOpen = !!single && single.status === 'EM_ABERTO';
  const canDelete = !!single && ['EM_ABERTO', 'CANCELADO'].includes(single.status);

  // ---------- Cadastro ----------
  const openNewModal = () => {
    setEditingEstimate(null);
    setFormData(emptyForm());
    setModalOpen(true);
    setVistoriaNumber('');
    refreshAuxiliary();
  };

  const openEditModal = (estimate) => {
    setEditingEstimate(estimate);
    setFormData({
      container_number: estimate.container_number,
      vistoria_id: estimate.vistoria_id || null,
      vistoria_number: estimate.vistoria_number || null,
      client_name: estimate.client_name || '',
      shipping_line: estimate.shipping_line || '',
      size_type: estimate.size_type || '',
      items: estimate.items.map((item) => ({ description: item.description, quantity: item.quantity, unit_price: item.unit_price })),
      discount: estimate.discount || '',
      validity_days: estimate.validity_days,
      execution_days: estimate.execution_days ?? '',
      observations: estimate.observations || '',
    });
    setModalOpen(true);
    refreshAuxiliary();
  };

  const setField = (field) => (value) => setFormData((prev) => ({ ...prev, [field]: value }));

  const setItem = (index, changes) => setFormData((prev) => ({
    ...prev,
    items: prev.items.map((item, i) => (i === index ? { ...item, ...changes } : item)),
  }));

  const pickService = (index, name) => {
    const current = formData.items[index];
    const changes = { description: name };
    if (current.unit_price === '' || toNumber(current.unit_price) === 0) changes.unit_price = suggestedPrice(name);
    setItem(index, changes);
  };

  const addItem = () => setFormData((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
  const removeItem = (index) => setFormData((prev) => ({
    ...prev,
    items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== index) : [emptyItem()],
  }));

  const subtotal = formData.items.reduce((sum, item) => sum + toNumber(item.quantity) * toNumber(item.unit_price), 0);
  const discount = toNumber(formData.discount);
  const total = subtotal - discount;

  const handleSubmit = async () => {
    if (!formData.container_number.trim()) {
      toast.error('Informe o número do container');
      return;
    }
    const items = formData.items.filter((item) => item.description.trim());
    if (items.length === 0) {
      toast.error('Inclua ao menos um serviço no orçamento');
      return;
    }
    if (items.some((item) => !(toNumber(item.quantity) > 0))) {
      toast.error('A quantidade de cada serviço deve ser maior que zero');
      return;
    }
    if (discount < 0 || discount > subtotal) {
      toast.error('O desconto não pode ser maior que o subtotal');
      return;
    }
    if (!(parseInt(formData.validity_days, 10) >= 1)) {
      toast.error('A validade deve ser de pelo menos 1 dia');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        container_number: formData.container_number,
        vistoria_id: formData.vistoria_id,
        client_name: formData.client_name,
        shipping_line: formData.shipping_line,
        size_type: formData.size_type,
        items: items.map((item) => ({ description: item.description, quantity: toNumber(item.quantity), unit_price: toNumber(item.unit_price) })),
        discount,
        validity_days: parseInt(formData.validity_days, 10),
        execution_days: formData.execution_days === '' ? null : parseInt(formData.execution_days, 10),
        observations: formData.observations,
      };
      if (editingEstimate) {
        await api.updateRepairEstimate(editingEstimate.id, payload);
        toast.success('Orçamento atualizado');
      } else {
        const res = await api.createRepairEstimate(payload);
        toast.success(`Orçamento ${estimateCode(res.data.estimate_number)} criado`);
      }
      setModalOpen(false);
      loadEstimates();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar orçamento');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (estimate) => {
    if (!(await confirm(`Deseja realmente excluir o orçamento ${estimateCode(estimate.estimate_number)}?`))) return;
    try {
      await api.deleteRepairEstimate(estimate.id);
      toast.success('Orçamento excluído');
      loadEstimates();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao excluir orçamento');
    }
  };

  // ---------- Status ----------
  const applyStatus = async (estimate, payload, successText) => {
    if (updatingStatus) return false;
    setUpdatingStatus(true);
    try {
      await api.updateRepairEstimateStatus(estimate.id, payload);
      toast.success(`Orçamento ${estimateCode(estimate.estimate_number)} ${successText}`);
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar o orçamento');
      return false;
    } finally {
      setUpdatingStatus(false);
      loadEstimates();
    }
  };

  const submitStatusDialog = async () => {
    const { status, target, responded_by, note } = statusDialog;
    if (!responded_by.trim()) {
      toast.error('Informe quem respondeu pelo cliente');
      return;
    }
    if (status === 'REPROVADO' && !note.trim()) {
      toast.error('Informe o motivo da reprovação');
      return;
    }
    const ok = await applyStatus(target, { status, responded_by, note }, status === 'APROVADO' ? 'aprovado' : 'reprovado');
    if (ok) setStatusDialog(null);
  };

  const cancelEstimate = async (estimate) => {
    if (!(await confirm(`Cancelar o orçamento ${estimateCode(estimate.estimate_number)}? Use para orçamento lançado em duplicidade ou descartado.`))) return;
    applyStatus(estimate, { status: 'CANCELADO' }, 'cancelado');
  };

  const reopenEstimate = async (estimate) => {
    if (!(await confirm(`Reabrir o orçamento ${estimateCode(estimate.estimate_number)}? A resposta do cliente registrada é apagada (fica no histórico).`))) return;
    applyStatus(estimate, { status: 'EM_ABERTO' }, 'reaberto');
  };

  const handlePDF = async (estimate) => {
    try {
      const response = await api.getRepairEstimatePDF(estimate.id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `orcamento_reparo_${estimateCode(estimate.estimate_number)}_${estimate.container_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar o PDF do orçamento');
    }
  };

  const statusBadge = (estimate) => {
    if (isExpired(estimate)) {
      return <StatusPill tone="amber" title={`Validade terminou em ${format(validUntil(estimate), 'dd/MM/yyyy')}, sem resposta do cliente`}>Vencido</StatusPill>;
    }
    const info = STATUS[estimate.status] || { label: estimate.status, tone: 'slate' };
    return <StatusPill tone={info.tone}>{info.label}</StatusPill>;
  };

  const kpi = (key) => summary?.[key] || { count: 0, total: 0 };

  return (
    <Layout>
      <div className="space-y-4">
        <PageHeader icon={FileWarning} title="Orçamento de Reparo" subtitle="Orçamento dos reparos de containers que chegaram com avarias, para aprovação do cliente" />

        <StatGrid>
          <StatCard label="Aguardando aprovação" value={formatMoney(kpi('open').total)} icon={Clock} tone="blue" hint={`${kpi('open').count} orçamento(s) em aberto`} testId="estimate-kpi-open" />
          <StatCard label="Vencidos sem resposta" value={formatMoney(kpi('expired').total)} icon={AlertTriangle} tone="amber" hint={`${kpi('expired').count} orçamento(s) para cobrar o cliente`} testId="estimate-kpi-expired" />
          <StatCard label="Aprovados (30 dias)" value={formatMoney(kpi('approved').total)} icon={ThumbsUp} tone="emerald" hint={`${kpi('approved').count} orçamento(s)`} testId="estimate-kpi-approved" />
          <StatCard label="Reprovados (30 dias)" value={formatMoney(kpi('rejected').total)} icon={ThumbsDown} tone="red" hint={`${kpi('rejected').count} orçamento(s)`} testId="estimate-kpi-rejected" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={clearFilters}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Nº, container, cliente, armador ou serviço" className="lg:col-span-2">
              <SearchInput value={searchQuery} onChange={(e) => changeFilter(setSearchQuery)(e.target.value)} data-testid="search-estimate-input" />
            </FilterField>
            <FilterField label="Status">
              <Select value={statusFilter || 'ALL'} onValueChange={(v) => changeFilter(setStatusFilter)(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="filter-estimate-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="EM_ABERTO">Em aberto</SelectItem>
                  <SelectItem value="VENCIDO">Vencido sem resposta</SelectItem>
                  <SelectItem value="APROVADO">Aprovado</SelectItem>
                  <SelectItem value="REPROVADO">Reprovado</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <div className="grid grid-cols-2 gap-2">
              <FilterField label="Emissão de">
                <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => changeFilter(setDateFrom)(e.target.value)} />
              </FilterField>
              <FilterField label="Até">
                <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => changeFilter(setDateTo)(e.target.value)} />
              </FilterField>
            </div>
          </div>
        </FilterCard>

        <DataCard
          title="Orçamentos"
          count={pagination.total}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo orçamento" onClick={openNewModal} testId="new-estimate-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => single && setDetailEstimate(single)} disabled={!single} />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && openEditModal(single)} disabled={!isOpen} testId="estimate-edit" />
              <ToolbarButton icon={Download} label="Baixar PDF" tone="slate" onClick={() => single && handlePDF(single)} disabled={!single} testId="estimate-pdf" />
              <ToolbarDivider />
              <ToolbarButton
                icon={CheckCircle2} label="Aprovar" tone="emerald"
                onClick={() => setStatusDialog({ status: 'APROVADO', target: single, responded_by: '', note: '' })}
                disabled={!isOpen || updatingStatus} testId="estimate-approve"
              />
              <ToolbarButton
                icon={XCircle} label="Reprovar" tone="red"
                onClick={() => setStatusDialog({ status: 'REPROVADO', target: single, responded_by: '', note: '' })}
                disabled={!isOpen || updatingStatus} testId="estimate-reject"
              />
              <ToolbarButton icon={Ban} label="Cancelar orçamento" tone="amber" onClick={() => single && cancelEstimate(single)} disabled={!isOpen || updatingStatus} testId="estimate-cancel" />
              <ToolbarButton icon={RotateCcw} label="Reabrir" tone="slate" onClick={() => single && reopenEstimate(single)} disabled={!single || single.status === 'EM_ABERTO' || updatingStatus} testId="estimate-reopen" />
              <ToolbarDivider />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => single && handleDelete(single)} disabled={!canDelete} testId="estimate-delete" />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
            />
          )}
        >
          {loading ? (
            <EmptyState loading />
          ) : estimates.length === 0 ? (
            <EmptyState
              icon={FileWarning}
              title="Nenhum orçamento encontrado"
              hint={hasFilters ? 'Ajuste os filtros' : 'Crie o primeiro pelo botão "Novo orçamento" ou por "Gerar orçamento" na Vistoria de Container'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox checked={estimates.length > 0 && estimates.every((e) => selectedIds.has(e.id))} onCheckedChange={toggleSelectAllOnPage} />
                    </th>
                    <th>Nº</th>
                    <th>Container</th>
                    <th>Cliente / Armador</th>
                    <th>Serviços</th>
                    <th>Emissão</th>
                    <th>Validade</th>
                    <th className="!text-right">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {estimates.map((estimate) => (
                    <tr key={estimate.id} data-selected={selectedIds.has(estimate.id)} className="cursor-pointer" onClick={() => toggleSelect(estimate.id)}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(estimate.id)} onCheckedChange={() => toggleSelect(estimate.id)} />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">
                        {estimateCode(estimate.estimate_number)}
                        {estimate.vistoria_number && <div className="text-xs font-normal text-muted-foreground">{vistoriaCode(estimate.vistoria_number)}</div>}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="font-mono">{estimate.container_number}</div>
                        {estimate.size_type && <div className="text-xs text-muted-foreground">{estimate.size_type}</div>}
                      </td>
                      <td>
                        <div>{estimate.client_name || '-'}</div>
                        {estimate.shipping_line && <div className="text-xs text-muted-foreground">{estimate.shipping_line}</div>}
                      </td>
                      <td className="max-w-[260px]">
                        <div className="truncate" title={estimate.items.map((i) => i.description).join(', ')}>
                          {estimate.items.map((i) => i.description).join(', ')}
                        </div>
                        <div className="text-xs text-muted-foreground">{estimate.items.length} item(ns)</div>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{format(new Date(estimate.created_at), 'dd/MM/yyyy')}</td>
                      <td className="whitespace-nowrap tabular-nums">{format(validUntil(estimate), 'dd/MM/yyyy')}</td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">{formatMoney(estimate.total)}</td>
                      <td>{statusBadge(estimate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      {/* Novo / Editar */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileWarning className="w-4 h-4 text-primary" />
              {editingEstimate ? `Editar orçamento ${estimateCode(editingEstimate.estimate_number)}` : 'Novo orçamento de reparo'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Field
              label="Vistoria de Container de origem"
              hint={formData.vistoria_id
                ? 'Os serviços marcados na vistoria entraram como itens, com o último preço usado em cada um.'
                : 'Opcional: digite o nº da vistoria (ex: 123 ou VC000123) e tecle Enter para puxar o container e os serviços.'}
            >
              {formData.vistoria_id ? (
                <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 text-sm">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <span className="font-medium">{vistoriaCode(formData.vistoria_number)}</span>
                  <span className="text-muted-foreground truncate">{formData.container_number}</span>
                  <button
                    type="button" className="ml-auto text-muted-foreground hover:text-foreground" title="Desvincular vistoria" aria-label="Desvincular vistoria"
                    onClick={() => setFormData((prev) => ({ ...prev, vistoria_id: null, vistoria_number: null }))}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 max-w-sm">
                  <Input
                    className="h-9 font-mono uppercase"
                    value={vistoriaNumber}
                    placeholder="Nº da vistoria"
                    autoFocus={!editingEstimate}
                    onChange={(e) => setVistoriaNumber(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        lookupVistoria();
                      }
                    }}
                    data-testid="estimate-vistoria-number-input"
                  />
                  <Button type="button" variant="outline" className="h-9" onClick={lookupVistoria} disabled={!vistoriaNumber.trim() || lookingUpVistoria} data-testid="estimate-vistoria-lookup">
                    {lookingUpVistoria ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}
                    Puxar
                  </Button>
                </div>
              )}
            </Field>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Nº do container" required>
                <Input className="h-9 font-mono uppercase" value={formData.container_number} onChange={(e) => setField('container_number')(e.target.value.toUpperCase())} data-testid="estimate-container-input" />
              </Field>
              <Field label="Tamanho/Tipo">
                <Select value={formData.size_type || 'NONE'} onValueChange={(v) => setField('size_type')(v === 'NONE' ? '' : v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">-</SelectItem>
                    {SIZE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Cliente" className="col-span-2 md:col-span-1">
                <Autocomplete value={formData.client_name} onChange={setField('client_name')} options={clients} displayField="name" valueField="id" onSelect={(c) => setField('client_name')(c.name)} testId="estimate-client-input" />
              </Field>
              <Field label="Armador" className="col-span-2 md:col-span-1">
                <Autocomplete value={formData.shipping_line} onChange={setField('shipping_line')} options={shippingLines} displayField="name" valueField="id" onSelect={(s) => setField('shipping_line')(s.name)} testId="estimate-shipping-line-input" />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormSectionTitle bare>Serviços de reparo</FormSectionTitle>
                <Button type="button" variant="outline" size="sm" onClick={addItem} data-testid="estimate-add-item">
                  <Plus className="w-4 h-4 mr-1" /> Adicionar serviço
                </Button>
              </div>
              <div className="space-y-2">
                <div className="hidden md:grid grid-cols-[1fr_80px_120px_110px_32px] gap-2 text-xs font-medium text-muted-foreground px-0.5">
                  <span>Serviço</span><span>Qtd.</span><span>Valor unit. (R$)</span><span className="text-right">Total</span><span />
                </div>
                {formData.items.map((item, index) => (
                  <div key={index} className="grid grid-cols-[1fr_32px] md:grid-cols-[1fr_80px_120px_110px_32px] gap-2 items-center rounded-md md:rounded-none border md:border-0 border-slate-200 dark:border-slate-700 p-2 md:p-0">
                    <Autocomplete
                      value={item.description}
                      onChange={(text) => setItem(index, { description: text })}
                      options={repairServices}
                      displayField="name"
                      valueField="id"
                      onSelect={(service) => pickService(index, service.name)}
                      testId={`estimate-item-description-${index}`}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-8 md:order-last text-muted-foreground hover:text-destructive" onClick={() => removeItem(index)} title="Remover serviço" aria-label="Remover serviço">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <div className="col-span-2 md:col-span-1 grid grid-cols-3 md:contents gap-2">
                      <Input className="h-9" type="number" step="1" min="0" value={item.quantity} onChange={(e) => setItem(index, { quantity: e.target.value })} aria-label="Quantidade" data-testid={`estimate-item-qty-${index}`} />
                      <Input className="h-9" type="number" step="0.01" min="0" value={item.unit_price} onChange={(e) => setItem(index, { unit_price: e.target.value })} aria-label="Valor unitário" data-testid={`estimate-item-price-${index}`} />
                      <div className="h-9 flex items-center justify-end text-sm font-medium tabular-nums">{formatMoney(toNumber(item.quantity) * toNumber(item.unit_price))}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-4">
              <div className="grid grid-cols-2 gap-3 content-start">
                <Field label="Validade (dias)" required>
                  <Input className="h-9" type="number" min="1" value={formData.validity_days} onChange={(e) => setField('validity_days')(e.target.value)} />
                </Field>
                <Field label="Prazo de execução (dias)" hint="Após a aprovação">
                  <Input className="h-9" type="number" min="0" value={formData.execution_days} onChange={(e) => setField('execution_days')(e.target.value)} />
                </Field>
                <Field label="Observações" className="col-span-2">
                  <Textarea rows={3} value={formData.observations} onChange={(e) => setField('observations')(e.target.value)} placeholder="Ex: condições de pagamento, peças inclusas, fotos na vistoria" />
                </Field>
              </div>
              <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-2 text-sm self-start">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums font-medium">{formatMoney(subtotal)}</span></div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Desconto (R$)</span>
                  <Input className="h-8 w-28 text-right" type="number" step="0.01" min="0" value={formData.discount} onChange={(e) => setField('discount')(e.target.value)} data-testid="estimate-discount-input" />
                </div>
                <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2 text-base">
                  <span className="font-semibold">Total</span>
                  <span className={`tabular-nums font-bold ${total < 0 ? 'text-destructive' : 'text-primary'}`} data-testid="estimate-total">{formatMoney(total)}</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving} data-testid="estimate-save-btn">
              {saving ? 'Salvando...' : (editingEstimate ? 'Salvar alterações' : 'Criar orçamento')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aprovar / Reprovar */}
      <Dialog open={!!statusDialog} onOpenChange={(open) => !open && setStatusDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {statusDialog?.status === 'APROVADO' ? 'Aprovar orçamento' : 'Reprovar orçamento'}
            </DialogTitle>
          </DialogHeader>
          {statusDialog && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {estimateCode(statusDialog.target.estimate_number)} · {statusDialog.target.container_number} · {formatMoney(statusDialog.target.total)}
              </p>
              <Field label="Respondido por (cliente)" required hint="Quem aprovou ou reprovou, ex: Fulano - Maersk, por e-mail">
                <Input
                  className="h-9" value={statusDialog.responded_by}
                  onChange={(e) => setStatusDialog((prev) => ({ ...prev, responded_by: e.target.value }))}
                  data-testid="estimate-responded-by"
                />
              </Field>
              <Field label={statusDialog.status === 'REPROVADO' ? 'Motivo da reprovação' : 'Observação'} required={statusDialog.status === 'REPROVADO'}>
                <Textarea
                  rows={2} value={statusDialog.note}
                  onChange={(e) => setStatusDialog((prev) => ({ ...prev, note: e.target.value }))}
                  data-testid="estimate-status-note"
                />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>Cancelar</Button>
            <Button onClick={submitStatusDialog} disabled={updatingStatus} data-testid="estimate-status-confirm">Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalhes */}
      <Dialog open={!!detailEstimate} onOpenChange={(open) => !open && setDetailEstimate(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Orçamento {detailEstimate && estimateCode(detailEstimate.estimate_number)}
              {detailEstimate && statusBadge(detailEstimate)}
            </DialogTitle>
          </DialogHeader>
          {detailEstimate && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  ['Container', detailEstimate.container_number],
                  ['Tamanho/Tipo', detailEstimate.size_type],
                  ['Cliente', detailEstimate.client_name],
                  ['Armador', detailEstimate.shipping_line],
                  ['Emissão', format(new Date(detailEstimate.created_at), 'dd/MM/yyyy')],
                  ['Válido até', format(validUntil(detailEstimate), 'dd/MM/yyyy')],
                  ['Prazo de execução', detailEstimate.execution_days ? `${detailEstimate.execution_days} dia(s)` : null],
                  ['Vistoria de origem', detailEstimate.vistoria_number ? vistoriaCode(detailEstimate.vistoria_number) : null],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium break-words">{value || '-'}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>Serviço</th><th className="!text-right">Qtd.</th><th className="!text-right">Valor unit.</th><th className="!text-right">Total</th></tr>
                  </thead>
                  <tbody>
                    {detailEstimate.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.description}</td>
                        <td className="text-right tabular-nums">{item.quantity.toLocaleString('pt-BR')}</td>
                        <td className="text-right tabular-nums whitespace-nowrap">{formatMoney(item.unit_price)}</td>
                        <td className="text-right tabular-nums whitespace-nowrap cell-strong">{formatMoney(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ml-auto w-full sm:w-64 space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatMoney(detailEstimate.subtotal)}</span></div>
                {detailEstimate.discount > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Desconto</span><span className="tabular-nums">- {formatMoney(detailEstimate.discount)}</span></div>
                )}
                <div className="flex justify-between font-semibold text-base border-t border-slate-200 dark:border-slate-700 pt-1"><span>Total</span><span className="tabular-nums text-primary">{formatMoney(detailEstimate.total)}</span></div>
              </div>

              {detailEstimate.responded_by && (
                <div className={`rounded p-3 ${detailEstimate.status === 'APROVADO' ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-red-50 dark:bg-red-500/10'}`}>
                  <p className="text-xs text-muted-foreground">
                    {STATUS[detailEstimate.status]?.label} por {detailEstimate.responded_by}
                    {detailEstimate.responded_at && ` em ${format(new Date(detailEstimate.responded_at), 'dd/MM/yyyy HH:mm')}`}
                  </p>
                  {detailEstimate.response_note && <p>{detailEstimate.response_note}</p>}
                </div>
              )}
              {detailEstimate.observations && (
                <div className="rounded bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Observações</p>
                  <p className="whitespace-pre-line">{detailEstimate.observations}</p>
                </div>
              )}
              <div>
                <h4 className="font-semibold mb-2">Histórico</h4>
                <ol className="space-y-2 border-l border-slate-200 dark:border-slate-700 pl-4">
                  {(detailEstimate.history || []).map((entry, idx) => (
                    <li key={idx} className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={STATUS[entry.status]?.tone}>{STATUS[entry.status]?.label || entry.status}</StatusPill>
                      <span className="tabular-nums text-muted-foreground">{format(new Date(entry.at), 'dd/MM/yyyy HH:mm')}</span>
                      <UserTag name={entry.by_name} />
                      {entry.note && <span className="text-muted-foreground">· {entry.note}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => detailEstimate && handlePDF(detailEstimate)}>
              <Printer className="w-4 h-4 mr-1.5" /> Baixar PDF
            </Button>
            <Button variant="outline" onClick={() => setDetailEstimate(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
