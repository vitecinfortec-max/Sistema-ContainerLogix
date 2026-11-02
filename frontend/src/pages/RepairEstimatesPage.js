import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../hooks/useConfirm';
import { toast } from 'sonner';
import {
  FileWarning, Plus, Eye, Pencil, Trash2, Printer, CheckCircle2, XCircle, RotateCcw, Ban, Clock, AlertTriangle, ThumbsUp, ThumbsDown,
  Download,
} from 'lucide-react';
import { format } from 'date-fns';
import { useUrlState } from '../hooks/useUrlState';
import { ESTIMATE_STATUS as STATUS, formatMoney, estimateCode, vistoriaCode, validUntil, isExpired } from '../lib/repairEstimates';

const PAGE_SIZE = 15;

export default function RepairEstimatesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [estimates, setEstimates] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [searchQuery, setSearchQuery] = useUrlState('query', '');
  const [statusFilter, setStatusFilter] = useUrlState('status', '');
  const [dateFrom, setDateFrom] = useUrlState('dateFrom', '');
  const [dateTo, setDateTo] = useUrlState('dateTo', '');
  const debouncedSearch = useDebouncedValue(searchQuery.trim());

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

  // Link antigo "Gerar orçamento" (?vistoria=<id>): o formulário agora é uma
  // página própria
  useEffect(() => {
    const vistoriaId = searchParams.get('vistoria');
    if (vistoriaId) navigate(`/repair-estimates/new?vistoria=${vistoriaId}`, { replace: true });
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
              <FilterField label="Emissão inicial">
                <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => changeFilter(setDateFrom)(e.target.value)} />
              </FilterField>
              <FilterField label="Emissão final">
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
              primary={<ToolbarPrimary icon={Plus} label="Novo orçamento" onClick={() => navigate('/repair-estimates/new')} testId="new-estimate-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => single && setDetailEstimate(single)} disabled={!single} />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && navigate(`/repair-estimates/${single.id}/edit`)} disabled={!isOpen} testId="estimate-edit" />
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
