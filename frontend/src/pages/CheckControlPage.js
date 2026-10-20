import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatGrid, StatCard, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination, UserTag,
} from '../components/DataPage';
import { Field } from '../components/FormKit';
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
  Banknote, Plus, Eye, Pencil, Trash2, Printer, CheckCircle2, RotateCcw, Undo2, Ban, Clock, AlertTriangle, CalendarClock,
  Camera, Upload, X, Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { todayISO, calendarDate } from '../lib/dates';
import { compressImage } from '../lib/imageCompression';

const PAGE_SIZE = 15;

const STATUS = {
  EMITIDO: { label: 'Emitido', tone: 'blue' },
  COMPENSADO: { label: 'Compensado', tone: 'emerald' },
  DEVOLVIDO: { label: 'Devolvido', tone: 'violet' },
  CANCELADO: { label: 'Cancelado', tone: 'slate' },
};

const DATE_FIELDS = { due_date: 'Vencimento', issue_date: 'Emissão', compensation_date: 'Compensação' };

const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDay = (value) => (value ? format(calendarDate(value), 'dd/MM/yyyy') : '-');

// Dias entre hoje e o vencimento (negativo = vencido)
function daysUntil(day) {
  const ms = calendarDate(day) - calendarDate(todayISO());
  return Math.round(ms / 86400000);
}

// Próxima folha do talão: mesmo número + 1, mantendo os zeros à esquerda
function nextCheckNumber(number) {
  if (!/^\d+$/.test(number || '')) return '';
  return String(Number(number) + 1).padStart(number.length, '0');
}

const PHOTO_SIDES = { FRENTE: 'Frente', VERSO: 'Verso' };

const photoOf = (check, side) => (check?.photos || []).find((p) => p.side === side);

// Um lado do cheque: a foto (clique abre em tamanho real) ou os botões de
// câmera/galeria para enviar
function CheckPhotoSlot({ label, src, busy, onPick, onRemove, testId }) {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);
  const pick = (e) => { onPick(e.target.files?.[0]); e.target.value = ''; };
  return (
    <div data-testid={testId}>
      <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
      {src ? (
        <div className="relative inline-block">
          <a href={src} target="_blank" rel="noreferrer" title="Abrir foto">
            <img src={src} alt={`Cheque - ${label}`} className="w-56 h-28 object-cover rounded-lg border" />
          </a>
          {onRemove && (
            <Button
              title="Remover" aria-label="Remover" type="button" variant="destructive" size="icon"
              className="absolute top-1 right-1 h-6 w-6" onClick={onRemove} disabled={busy}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => cameraRef.current?.click()}>
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Camera className="w-4 h-4 mr-1.5" />}
            Câmera
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => galleryRef.current?.click()}>
            <Upload className="w-4 h-4 mr-1.5" /> Galeria
          </Button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
          <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={pick} />
        </div>
      )}
    </div>
  );
}

// `account`: conta padrão vinda do backend (Dados Bancários da empresa ou a
// do último cheque) com a última folha usada nela
function emptyForm(account) {
  return {
    check_number: nextCheckNumber(account?.last_check_number),
    bank: account?.bank || '',
    agency: account?.agency || '',
    account: account?.account || '',
    payee: '',
    amount: '',
    issue_date: todayISO(),
    due_date: todayISO(),
    description: '',
    observations: '',
  };
}

export default function CheckControlPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [checks, setChecks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [suppliers, setSuppliers] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateField, setDateField] = useState('due_date');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery.trim());

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCheck, setEditingCheck] = useState(null);
  const [formData, setFormData] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  // Fotos escolhidas no formulário, enviadas ao salvar: { [side]: { file, previewUrl } | { removed: true } }
  const [photoDraft, setPhotoDraft] = useState({});

  const [detailCheck, setDetailCheck] = useState(null);
  const [detailPhotoBusy, setDetailPhotoBusy] = useState(null); // lado sendo enviado/removido
  // Compensar (data) ou devolver (motivo): { status, targets, compensation_date, return_reason }
  const [statusDialog, setStatusDialog] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const filterParams = () => {
    const params = { date_field: dateField };
    if (debouncedSearch) params.search = debouncedSearch;
    if (statusFilter) params.status = statusFilter;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  };

  useEffect(() => {
    // O cadastro de fornecedores pode estar desativado: aí o favorecido é só digitado
    api.getSuppliers()
      .then((res) => setSuppliers(Array.isArray(res.data) ? res.data : (res.data.items || [])))
      .catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    loadChecks();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, debouncedSearch, statusFilter, dateField, dateFrom, dateTo]);

  const loadChecks = async () => {
    try {
      const [listRes, summaryRes] = await Promise.all([
        api.getChecks({ ...filterParams(), page: pagination.page, per_page: PAGE_SIZE }),
        api.getChecksSummary(),
      ]);
      setChecks(listRes.data.items);
      setPagination((prev) => ({ ...prev, pages: listRes.data.pages, total: listRes.data.total }));
      setSummary(summaryRes.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao carregar cheques');
    } finally {
      setLoading(false);
    }
  };

  const changeFilter = (setter) => (value) => {
    setter(value);
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setDateField('due_date');
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
      const pageIds = checks.map((c) => c.id);
      if (pageIds.length > 0 && pageIds.every((id) => prev.has(id))) return new Set();
      return new Set(pageIds);
    });
  };

  const selectedChecks = checks.filter((c) => selectedIds.has(c.id));
  const single = selectedChecks.length === 1 ? selectedChecks[0] : null;
  const canCompensate = selectedChecks.length > 0 && selectedChecks.every((c) => ['EMITIDO', 'DEVOLVIDO'].includes(c.status));
  const canReturn = !!single && ['EMITIDO', 'COMPENSADO'].includes(single.status);
  const canCancel = !!single && ['EMITIDO', 'DEVOLVIDO'].includes(single.status);
  const canReopen = selectedChecks.length > 0 && selectedChecks.every((c) => c.status !== 'EMITIDO');
  const canDelete = !!single && ['EMITIDO', 'CANCELADO'].includes(single.status);

  // ---------- Cadastro ----------
  const resetPhotoDraft = () => {
    setPhotoDraft((prev) => {
      Object.values(prev).forEach((d) => d.previewUrl && URL.revokeObjectURL(d.previewUrl));
      return {};
    });
  };

  const draftPhoto = async (side, file) => {
    if (!file) return;
    const compressed = await compressImage(file);
    setPhotoDraft((prev) => {
      if (prev[side]?.previewUrl) URL.revokeObjectURL(prev[side].previewUrl);
      return { ...prev, [side]: { file: compressed, previewUrl: URL.createObjectURL(compressed) } };
    });
  };

  const removeDraftPhoto = (side) => {
    setPhotoDraft((prev) => {
      if (prev[side]?.previewUrl) URL.revokeObjectURL(prev[side].previewUrl);
      // Foto nova descartada volta ao que estava salvo; foto salva fica marcada para remover
      const next = { ...prev };
      if (prev[side]?.file) delete next[side];
      else next[side] = { removed: true };
      return next;
    });
  };

  const formPhotoSrc = (side) => {
    const draft = photoDraft[side];
    if (draft?.removed) return null;
    if (draft?.previewUrl) return draft.previewUrl;
    const saved = photoOf(editingCheck, side);
    return saved ? api.getFileUrl(saved.url) : null;
  };

  // Envia/remove as fotos do formulário; devolve os lados que falharam
  const savePhotoDraft = async (checkId) => {
    const failed = [];
    for (const [side, draft] of Object.entries(photoDraft)) {
      try {
        if (draft.file) await api.uploadCheckPhoto(checkId, side, draft.file);
        else if (draft.removed && photoOf(editingCheck, side)) await api.deleteCheckPhoto(checkId, side);
      } catch (error) {
        failed.push(PHOTO_SIDES[side].toLowerCase());
      }
    }
    return failed;
  };

  const openNewModal = () => {
    setEditingCheck(null);
    setFormData(emptyForm(summary?.default_account));
    resetPhotoDraft();
    setModalOpen(true);
  };

  const openEditModal = (check) => {
    setEditingCheck(check);
    resetPhotoDraft();
    setFormData({
      check_number: check.check_number,
      bank: check.bank,
      agency: check.agency || '',
      account: check.account || '',
      payee: check.payee,
      amount: check.amount,
      issue_date: check.issue_date,
      due_date: check.due_date,
      description: check.description || '',
      observations: check.observations || '',
    });
    setModalOpen(true);
  };

  const setField = (field) => (value) => setFormData((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    const { check_number, bank, payee, amount, issue_date, due_date } = formData;
    if (!check_number.trim() || !bank.trim() || !payee.trim() || !issue_date || !due_date) {
      toast.error('Preencha os campos obrigatórios');
      return;
    }
    if (!(parseFloat(amount) > 0)) {
      toast.error('O valor do cheque deve ser maior que zero');
      return;
    }
    if (due_date < issue_date) {
      toast.error('O vencimento não pode ser antes da data de emissão');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...formData, amount: parseFloat(amount) };
      const response = editingCheck
        ? await api.updateCheck(editingCheck.id, payload)
        : await api.createCheck(payload);
      const failedPhotos = await savePhotoDraft(response.data.id);
      toast.success(editingCheck ? 'Cheque atualizado' : 'Cheque cadastrado');
      if (failedPhotos.length > 0) {
        toast.error(`Não foi possível salvar a foto (${failedPhotos.join(' e ')}). Tente de novo em "Ver detalhes".`);
      }
      resetPhotoDraft();
      setModalOpen(false);
      loadChecks();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar cheque');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (check) => {
    if (!(await confirm(`Deseja realmente excluir o cheque nº ${check.check_number}?`))) return;
    try {
      await api.deleteCheck(check.id);
      toast.success('Cheque excluído');
      loadChecks();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao excluir cheque');
    }
  };

  // ---------- Fotos (detalhes) ----------
  // Aqui a foto vai direto, em qualquer status - o verso costuma ser
  // fotografado depois que o cheque já foi compensado
  // `file` null = remover; undefined = seletor fechado sem escolher
  const changeDetailPhoto = async (side, file) => {
    if (!detailCheck || file === undefined) return;
    if (file === null && !(await confirm(`Remover a foto do ${PHOTO_SIDES[side].toLowerCase()} do cheque?`))) return;
    setDetailPhotoBusy(side);
    try {
      const response = file
        ? await api.uploadCheckPhoto(detailCheck.id, side, await compressImage(file))
        : await api.deleteCheckPhoto(detailCheck.id, side);
      setDetailCheck(response.data);
      setChecks((prev) => prev.map((c) => (c.id === response.data.id ? response.data : c)));
      toast.success(file ? 'Foto do cheque salva' : 'Foto do cheque removida');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar a foto do cheque');
    } finally {
      setDetailPhotoBusy(null);
    }
  };

  // ---------- Status ----------
  // Uma a uma, sem parar na primeira falha: o aviso diz quantos passaram e quais não
  const applyStatus = async (targets, payload, successText) => {
    if (targets.length === 0 || updatingStatus) return false;
    setUpdatingStatus(true);
    try {
      const results = await Promise.allSettled(targets.map((c) => api.updateCheckStatus(c.id, payload)));
      const failed = targets.filter((_, i) => results[i].status === 'rejected');
      const done = targets.length - failed.length;
      if (done > 0) toast.success(done > 1 ? `${done} cheques ${successText.plural}` : `Cheque ${successText.single}`);
      if (failed.length === 1) {
        const reason = results[targets.indexOf(failed[0])].reason;
        toast.error(reason?.response?.data?.detail || `Não foi possível atualizar o cheque nº ${failed[0].check_number}`);
      } else if (failed.length > 1) {
        toast.error(`Não foi possível atualizar: nº ${failed.map((c) => c.check_number).join(', ')}`);
      }
      return failed.length === 0;
    } finally {
      setUpdatingStatus(false);
      loadChecks();
    }
  };

  const submitStatusDialog = async () => {
    const { status, targets, compensation_date, return_reason } = statusDialog;
    if (status === 'COMPENSADO' && !compensation_date) {
      toast.error('Informe a data de compensação');
      return;
    }
    if (status === 'DEVOLVIDO' && !return_reason.trim()) {
      toast.error('Informe o motivo da devolução');
      return;
    }
    const ok = await applyStatus(
      targets,
      { status, compensation_date, return_reason },
      status === 'COMPENSADO'
        ? { single: 'marcado como compensado', plural: 'marcados como compensados' }
        : { single: 'marcado como devolvido', plural: 'marcados como devolvidos' },
    );
    if (ok) setStatusDialog(null);
  };

  const cancelCheck = async (check) => {
    if (!(await confirm(`Cancelar o cheque nº ${check.check_number}? Use para folha inutilizada ou sustada.`))) return;
    applyStatus([check], { status: 'CANCELADO' }, { single: 'cancelado', plural: 'cancelados' });
  };

  const reopenChecks = async () => {
    if (!(await confirm('Voltar os cheques selecionados para Emitido? A data de compensação e o motivo de devolução são apagados.'))) return;
    applyStatus(selectedChecks, { status: 'EMITIDO' }, { single: 'voltou para emitido', plural: 'voltaram para emitido' });
  };

  const handleReportPDF = async () => {
    try {
      const response = await api.getChecksReportPDF(filterParams());
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `controle_cheques_${todayISO()}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar o relatório');
    }
  };

  // Emitido ganha o prazo no selo: vencido (vermelho) ou vencendo em breve (âmbar)
  const statusBadge = (check) => {
    if (check.status === 'EMITIDO') {
      const days = daysUntil(check.due_date);
      if (days < 0) return <StatusPill tone="red" title={`Vencido há ${-days} dia(s), sem compensar`}>Vencido</StatusPill>;
      if (days <= (summary?.due_soon_days ?? 7)) {
        return <StatusPill tone="amber">{days === 0 ? 'Vence hoje' : `Vence em ${days} dia${days > 1 ? 's' : ''}`}</StatusPill>;
      }
    }
    const info = STATUS[check.status] || { label: check.status, tone: 'slate' };
    return <StatusPill tone={info.tone}>{info.label}</StatusPill>;
  };

  const kpi = (key) => summary?.[key] || { count: 0, total: 0 };

  return (
    <Layout>
      <div className="space-y-4">
        <PageHeader icon={Banknote} title="Controle de Cheque" subtitle="Cheques emitidos: emissão, vencimento, compensação e devolução" />

        <StatGrid>
          <StatCard label="Em aberto" value={formatMoney(kpi('open').total)} icon={Clock} tone="blue" hint={`${kpi('open').count} cheque(s) a compensar`} testId="check-kpi-open" />
          <StatCard label={`Vencem em ${summary?.due_soon_days ?? 7} dias`} value={formatMoney(kpi('due_soon').total)} icon={CalendarClock} tone="amber" hint={`${kpi('due_soon').count} cheque(s)`} testId="check-kpi-due-soon" />
          <StatCard label="Vencidos sem compensar" value={formatMoney(kpi('overdue').total)} icon={AlertTriangle} tone="red" hint={`${kpi('overdue').count} cheque(s)`} testId="check-kpi-overdue" />
          <StatCard label="Devolvidos" value={formatMoney(kpi('returned').total)} icon={Undo2} tone="violet" hint={`${kpi('returned').count} cheque(s) para resolver`} testId="check-kpi-returned" />
        </StatGrid>

        <FilterCard
          hasFilters={hasFilters}
          onClear={clearFilters}
          actions={(
            <Button variant="outline" size="sm" onClick={handleReportPDF} data-testid="check-report-pdf">
              <Printer className="w-4 h-4 mr-1.5" /> Relatório PDF
            </Button>
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <FilterField label="Nº, favorecido, banco ou finalidade" className="lg:col-span-2">
              <SearchInput value={searchQuery} onChange={(e) => changeFilter(setSearchQuery)(e.target.value)} data-testid="search-check-input" />
            </FilterField>
            <FilterField label="Status">
              <Select value={statusFilter || 'ALL'} onValueChange={(v) => changeFilter(setStatusFilter)(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="filter-check-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="EMITIDO">Emitido (em aberto)</SelectItem>
                  <SelectItem value="VENCIDO">Vencido sem compensar</SelectItem>
                  <SelectItem value="COMPENSADO">Compensado</SelectItem>
                  <SelectItem value="DEVOLVIDO">Devolvido</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Período por">
              <Select value={dateField} onValueChange={changeFilter(setDateField)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DATE_FIELDS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <div className="grid grid-cols-2 gap-2">
              <FilterField label="De">
                <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => changeFilter(setDateFrom)(e.target.value)} />
              </FilterField>
              <FilterField label="Até">
                <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => changeFilter(setDateTo)(e.target.value)} />
              </FilterField>
            </div>
          </div>
        </FilterCard>

        <DataCard
          title="Cheques"
          count={pagination.total}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo cheque" onClick={openNewModal} testId="new-check-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => single && setDetailCheck(single)} disabled={!single} />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && openEditModal(single)} disabled={!single || single.status !== 'EMITIDO'} testId="check-edit" />
              <ToolbarDivider />
              <ToolbarButton
                icon={CheckCircle2} label="Marcar como compensado" tone="emerald"
                onClick={() => setStatusDialog({ status: 'COMPENSADO', targets: selectedChecks, compensation_date: todayISO(), return_reason: '' })}
                disabled={!canCompensate || updatingStatus} testId="check-mark-compensated"
              />
              <ToolbarButton
                icon={Undo2} label="Marcar como devolvido" tone="violet"
                onClick={() => setStatusDialog({ status: 'DEVOLVIDO', targets: [single], compensation_date: '', return_reason: '' })}
                disabled={!canReturn || updatingStatus} testId="check-mark-returned"
              />
              <ToolbarButton icon={Ban} label="Cancelar cheque" tone="amber" onClick={() => single && cancelCheck(single)} disabled={!canCancel || updatingStatus} testId="check-cancel" />
              <ToolbarButton icon={RotateCcw} label="Voltar para emitido" tone="slate" onClick={reopenChecks} disabled={!canReopen || updatingStatus} testId="check-reopen" />
              <ToolbarDivider />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => single && handleDelete(single)} disabled={!canDelete} testId="check-delete" />
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
          ) : checks.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="Nenhum cheque encontrado"
              hint={hasFilters ? 'Ajuste os filtros' : 'Cadastre o primeiro pelo botão "Novo cheque"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox checked={checks.length > 0 && checks.every((c) => selectedIds.has(c.id))} onCheckedChange={toggleSelectAllOnPage} />
                    </th>
                    <th>Nº</th>
                    <th>Banco</th>
                    <th>Favorecido</th>
                    <th>Emissão</th>
                    <th>Vencimento</th>
                    <th className="!text-right">Valor</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.map((check) => (
                    <tr key={check.id} data-selected={selectedIds.has(check.id)} className="cursor-pointer" onClick={() => toggleSelect(check.id)}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(check.id)} onCheckedChange={() => toggleSelect(check.id)} />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">
                        {check.check_number}
                        {check.photos?.length > 0 && (
                          <span title={`Foto: ${check.photos.map((p) => PHOTO_SIDES[p.side]).join(' e ')}`}>
                            <Camera className="inline w-3.5 h-3.5 ml-1.5 text-muted-foreground" aria-label="Com foto" />
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="whitespace-nowrap">{check.bank}</div>
                        {(check.agency || check.account) && (
                          <div className="text-xs text-muted-foreground whitespace-nowrap">
                            {[check.agency && `Ag. ${check.agency}`, check.account && `C/C ${check.account}`].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{check.payee}</div>
                        {check.description && <div className="text-xs text-muted-foreground">{check.description}</div>}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{formatDay(check.issue_date)}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {formatDay(check.due_date)}
                        {check.compensation_date && <div className="text-xs text-muted-foreground">Comp. {formatDay(check.compensation_date)}</div>}
                      </td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">{formatMoney(check.amount)}</td>
                      <td>{statusBadge(check)}</td>
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Banknote className="w-4 h-4 text-primary" />
              {editingCheck ? `Editar cheque nº ${editingCheck.check_number}` : 'Novo cheque'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Nº do cheque" required>
              <Input className="h-9" value={formData.check_number} onChange={(e) => setField('check_number')(e.target.value)} data-testid="check-number-input" />
            </Field>
            <Field label="Banco" required className="col-span-2 md:col-span-1">
              <Input className="h-9" value={formData.bank} onChange={(e) => setField('bank')(e.target.value)} placeholder="Ex: Banco do Brasil" />
            </Field>
            <Field label="Agência">
              <Input className="h-9" value={formData.agency} onChange={(e) => setField('agency')(e.target.value)} />
            </Field>
            <Field label="Conta">
              <Input className="h-9" value={formData.account} onChange={(e) => setField('account')(e.target.value)} />
            </Field>
            {!editingCheck && summary?.default_account && (
              <p className="col-span-2 md:col-span-4 -mt-1 text-xs text-muted-foreground" data-testid="check-account-source">
                {summary.default_account.source === 'company'
                  ? 'Conta preenchida com os Dados Bancários de "Dados da Empresa" - altere se o cheque for de outra conta.'
                  : 'Conta do último cheque lançado. Cadastre os Dados Bancários em "Dados da Empresa" para usá-los como padrão.'}
              </p>
            )}

            <Field label="Favorecido (nominal a)" required className="col-span-2">
              <Autocomplete
                value={formData.payee}
                onChange={setField('payee')}
                options={suppliers}
                displayField="name"
                valueField="id"
                onSelect={(supplier) => setField('payee')(supplier.name)}
                testId="check-payee-input"
              />
            </Field>
            <Field label="Valor (R$)" required className="col-span-2 md:col-span-1">
              <Input className="h-9" type="number" step="0.01" min="0" value={formData.amount} onChange={(e) => setField('amount')(e.target.value)} data-testid="check-amount-input" />
            </Field>
            <div className="hidden md:block" />

            <Field label="Data de emissão" required>
              <Input className="h-9" type="date" value={formData.issue_date} onChange={(e) => setField('issue_date')(e.target.value)} />
            </Field>
            <Field label="Data de vencimento" required hint="Bom para">
              <Input className="h-9" type="date" min={formData.issue_date} value={formData.due_date} onChange={(e) => setField('due_date')(e.target.value)} />
            </Field>
            <Field label="Finalidade / referência" className="col-span-2">
              <Input className="h-9" value={formData.description} onChange={(e) => setField('description')(e.target.value)} placeholder="Ex: NF 1234, aluguel de outubro" />
            </Field>

            <Field label="Observações" className="col-span-2 md:col-span-4">
              <Textarea rows={2} value={formData.observations} onChange={(e) => setField('observations')(e.target.value)} />
            </Field>

            <div className="col-span-2 md:col-span-4 border-t border-slate-100 dark:border-slate-800 pt-3">
              <p className="text-sm font-medium mb-2">Foto do cheque</p>
              <div className="flex flex-wrap gap-6">
                {Object.entries(PHOTO_SIDES).map(([side, label]) => (
                  <CheckPhotoSlot
                    key={side} label={label} src={formPhotoSrc(side)}
                    onPick={(file) => draftPhoto(side, file)} onRemove={() => removeDraftPhoto(side)}
                    testId={`check-form-photo-${side.toLowerCase()}`}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving} data-testid="check-save-btn">
              {saving ? 'Salvando...' : (editingCheck ? 'Salvar alterações' : 'Cadastrar cheque')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compensar / Devolver */}
      <Dialog open={!!statusDialog} onOpenChange={(open) => !open && setStatusDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {statusDialog?.status === 'COMPENSADO' ? 'Marcar como compensado' : 'Marcar como devolvido'}
            </DialogTitle>
          </DialogHeader>
          {statusDialog && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {statusDialog.targets.length > 1
                  ? `${statusDialog.targets.length} cheques · ${formatMoney(statusDialog.targets.reduce((sum, c) => sum + c.amount, 0))}`
                  : `Cheque nº ${statusDialog.targets[0].check_number} · ${statusDialog.targets[0].payee} · ${formatMoney(statusDialog.targets[0].amount)}`}
              </p>
              {statusDialog.status === 'COMPENSADO' ? (
                <Field label="Data de compensação" required>
                  <Input
                    type="date" className="h-9" max={todayISO()} value={statusDialog.compensation_date}
                    onChange={(e) => setStatusDialog((prev) => ({ ...prev, compensation_date: e.target.value }))}
                    data-testid="check-compensation-date"
                  />
                </Field>
              ) : (
                <Field label="Motivo da devolução" required>
                  <Input
                    className="h-9" value={statusDialog.return_reason} placeholder="Ex: Alínea 11 - sem fundos"
                    onChange={(e) => setStatusDialog((prev) => ({ ...prev, return_reason: e.target.value }))}
                    data-testid="check-return-reason"
                  />
                </Field>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>Cancelar</Button>
            <Button onClick={submitStatusDialog} disabled={updatingStatus} data-testid="check-status-confirm">Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalhes */}
      <Dialog open={!!detailCheck} onOpenChange={(open) => !open && setDetailCheck(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Cheque nº {detailCheck?.check_number}
              {detailCheck && statusBadge(detailCheck)}
            </DialogTitle>
          </DialogHeader>
          {detailCheck && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  ['Banco', detailCheck.bank],
                  ['Agência', detailCheck.agency],
                  ['Conta', detailCheck.account],
                  ['Favorecido', detailCheck.payee],
                  ['Valor', formatMoney(detailCheck.amount)],
                  ['Finalidade', detailCheck.description],
                  ['Emissão', formatDay(detailCheck.issue_date)],
                  ['Vencimento', formatDay(detailCheck.due_date)],
                  ['Compensação', formatDay(detailCheck.compensation_date)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium break-words">{value || '-'}</p>
                  </div>
                ))}
              </div>
              {detailCheck.return_reason && (
                <div className="rounded bg-violet-50 dark:bg-violet-500/10 p-3">
                  <p className="text-xs text-muted-foreground">Motivo da devolução</p>
                  <p>{detailCheck.return_reason}</p>
                </div>
              )}
              {detailCheck.observations && (
                <div className="rounded bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Observações</p>
                  <p className="whitespace-pre-line">{detailCheck.observations}</p>
                </div>
              )}
              <div>
                <h4 className="font-semibold mb-2">Foto do cheque</h4>
                <div className="flex flex-wrap gap-6">
                  {Object.entries(PHOTO_SIDES).map(([side, label]) => {
                    const photo = photoOf(detailCheck, side);
                    return (
                      <CheckPhotoSlot
                        key={side} label={label} src={photo ? api.getFileUrl(photo.url) : null}
                        busy={detailPhotoBusy === side}
                        onPick={(file) => changeDetailPhoto(side, file)} onRemove={() => changeDetailPhoto(side, null)}
                        testId={`check-detail-photo-${side.toLowerCase()}`}
                      />
                    );
                  })}
                </div>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Histórico</h4>
                <ol className="space-y-2 border-l border-slate-200 dark:border-slate-700 pl-4">
                  {(detailCheck.history || []).map((entry, idx) => (
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
            <Button variant="outline" onClick={() => setDetailCheck(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
