import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, DataCard, Toolbar, ToolbarButton, ToolbarDivider,
  StatusPill, EmptyState,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { HandCoins, CheckCircle2, RotateCcw, Pencil, Download, FileText, FileSpreadsheet, Receipt, Clock, ListChecks } from 'lucide-react';

const STATUS_LABELS = { PENDENTE: 'Pendente', PAGO: 'Pago', CANCELADO: 'Cancelado' };
const STATUS_TONES = {
  PENDENTE: 'amber',
  PAGO: 'emerald',
  CANCELADO: 'red',
};

const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function FreightPaymentsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [drivers, setDrivers] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [driverFilterName, setDriverFilterName] = useState('');
  const [driverFilterId, setDriverFilterId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ freight_value: '', observations: '' });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);

  const [batches, setBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  useEffect(() => { loadDrivers(); loadBatches(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadList(); }, [driverFilterId, statusFilter, dateFrom, dateTo]);

  const loadDrivers = async () => {
    try {
      const r = await api.getDrivers();
      setDrivers(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (driverFilterId) params.driver_id = driverFilterId;
      if (statusFilter) params.status = statusFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const r = await api.getFreightPayments(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar pagamentos de frete');
    } finally {
      setLoading(false);
    }
  };

  const loadBatches = async () => {
    setLoadingBatches(true);
    try {
      const r = await api.getFreightPaymentBatches();
      setBatches(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar ordens de pagamento');
    } finally {
      setLoadingBatches(false);
    }
  };

  const onSelectDriverFilter = (d) => {
    setDriverFilterName(d.name);
    setDriverFilterId(d.id);
  };

  const onChangeDriverFilterText = (v) => {
    setDriverFilterName(v);
    if (!v) setDriverFilterId('');
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = list.map((p) => p.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const singleSelected = selectedIds.size === 1 ? list.find((p) => p.id === [...selectedIds][0]) : null;
  const selectedItems = list.filter((p) => selectedIds.has(p.id));
  const selectedDriverIds = new Set(selectedItems.map((p) => p.driver_id));
  // Vários lançamentos podem ser marcados como Pago de uma vez, desde que
  // todos sejam do mesmo motorista (vira 1 Ordem de Pagamento) - ver
  // handleMarkPaidBatch. Exportar PDF/Excel usa a mesma checagem de
  // motorista único, mas aceita qualquer status (é só um extrato).
  const sameDriverSelected = selectedItems.length > 0 && selectedDriverIds.size === 1 && !!selectedItems[0].driver_id;
  const canMarkPaidBatch = sameDriverSelected && selectedItems.every((p) => p.status === 'PENDENTE');
  const canExportReport = sameDriverSelected;

  // Indicadores do topo - sobre os lançamentos que batem com os filtros
  const sumByStatus = (status) => list.filter((p) => p.status === status).reduce((acc, p) => acc + (p.freight_value || 0), 0);
  const pendingTotal = sumByStatus('PENDENTE');
  const paidTotal = sumByStatus('PAGO');
  const pendingCount = list.filter((p) => p.status === 'PENDENTE').length;
  const hasFilters = !!(driverFilterName || statusFilter || dateFrom || dateTo);
  const clearFilters = () => {
    setDriverFilterName('');
    setDriverFilterId('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const markStatus = async (id, status) => {
    try {
      await api.updateFreightPaymentStatus(id, status);
      toast.success('Marcado como Pendente');
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao atualizar status');
    }
  };

  const handleMarkPaidBatch = async () => {
    if (!canMarkPaidBatch || markingPaid) return;
    setMarkingPaid(true);
    try {
      const r = await api.markFreightPaymentsPaidBatch([...selectedIds]);
      toast.success(`Ordem de Pagamento Nº ${r.data.batch_number} gerada!`);
      setSelectedIds(new Set());
      loadList();
      loadBatches();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao gerar Ordem de Pagamento');
    } finally {
      setMarkingPaid(false);
    }
  };

  const openEdit = (payment) => {
    setEditingId(payment.id);
    setEditForm({ freight_value: payment.freight_value, observations: payment.observations || '' });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.updateFreightPayment(editingId, {
        freight_value: parseFloat(editForm.freight_value) || 0,
        observations: editForm.observations,
      });
      toast.success('Pagamento atualizado');
      setEditOpen(false);
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao atualizar pagamento');
    } finally { setSaving(false); }
  };

  const downloadReport = async (kind) => {
    if (!canExportReport || generating) return;
    setGenerating(true);
    try {
      const params = { payment_ids: [...selectedIds].join(',') };
      const r = kind === 'pdf' ? await api.getFreightPaymentReportPDF(params) : await api.getFreightPaymentReportExcel(params);
      const ext = kind === 'pdf' ? 'pdf' : 'xlsx';
      const driverName = selectedItems[0]?.driver_name || 'motorista';
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `PrestacaoContas_${driverName.replace(/\s+/g, '_')}.${ext}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório gerado!');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao gerar relatório');
    } finally { setGenerating(false); }
  };

  const handleDownloadReceipt = async (batch) => {
    try {
      const r = await api.getFreightPaymentBatchReceiptPDF(batch.id);
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Recibo_${(batch.driver_name || 'motorista').replace(/\s+/g, '_')}_${batch.batch_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      toast.error('Erro ao gerar recibo');
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="freight-payments-page">
        <PageHeader
          icon={HandCoins}
          title="Pagamento Frete"
          subtitle="Lançamentos gerados a partir das Ordens de Coleta aprovadas em rotas cadastradas"
        />

        <StatGrid>
          <StatCard label="A pagar" value={formatMoney(pendingTotal)} icon={Clock} tone="amber" hint={`${pendingCount} lançamento${pendingCount === 1 ? '' : 's'} pendente${pendingCount === 1 ? '' : 's'}`} />
          <StatCard label="Pago" value={formatMoney(paidTotal)} icon={CheckCircle2} tone="emerald" hint="no período filtrado" />
          <StatCard label="Lançamentos" value={list.length} icon={ListChecks} tone="blue" hint="com os filtros atuais" />
          <StatCard label="Ordens de pagamento" value={batches.length} icon={Receipt} tone="primary" hint="recibos gerados" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={clearFilters}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Motorista">
              <Autocomplete
                value={driverFilterName}
                onChange={onChangeDriverFilterText}
                onSelect={onSelectDriverFilter}
                options={drivers}
                displayField="name"
                className="h-9 text-sm"
              />
            </FilterField>
            <FilterField label="Status">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  <SelectItem value="PENDENTE">Pendente</SelectItem>
                  <SelectItem value="PAGO">Pago</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="De">
              <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </FilterField>
            <FilterField label="Até">
              <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque 1+ lançamentos pra habilitar as ações. Sem botão "Adicionar":
            lançamentos só nascem automaticamente quando uma Ordem de Coleta numa Rota
            cadastrada é Aprovada. Marcar como Pago aceita vários lançamentos de uma vez,
            desde que sejam todos do mesmo motorista (gera 1 Ordem de Pagamento) - as demais
            ações (Pendente/Editar) continuam 1 por vez. PDF/Excel exportam a Prestação de
            Contas dos lançamentos selecionados (também exige motorista único, mas aceita
            qualquer status). */}
        <DataCard
          title="Lançamentos"
          count={loading ? '...' : list.length}
          toolbar={(
            <Toolbar selectedCount={selectedIds.size}>
              <ToolbarButton icon={CheckCircle2} label="Marcar como Pago" tone="emerald" onClick={handleMarkPaidBatch} disabled={!canMarkPaidBatch || markingPaid} testId="freight-payment-mark-paid" />
              <ToolbarButton icon={RotateCcw} label="Marcar como Pendente" tone="amber" onClick={() => singleSelected && markStatus(singleSelected.id, 'PENDENTE')} disabled={!singleSelected || singleSelected.status !== 'PAGO'} testId="freight-payment-mark-pending" />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelected && openEdit(singleSelected)} disabled={!singleSelected || singleSelected.status !== 'PENDENTE'} testId="freight-payment-edit" />
              <ToolbarDivider />
              <ToolbarButton icon={FileText} label="Prestação de Contas em PDF" tone="red" onClick={() => downloadReport('pdf')} disabled={!canExportReport || generating} testId="freight-payment-report-pdf" />
              <ToolbarButton icon={FileSpreadsheet} label="Prestação de Contas em Excel" tone="emerald" onClick={() => downloadReport('excel')} disabled={!canExportReport || generating} testId="freight-payment-report-excel" />
            </Toolbar>
          )}
        >
          {list.length === 0 && !loading ? (
            <EmptyState icon={HandCoins} title="Nenhum lançamento encontrado" hint="Os lançamentos aparecem aqui quando uma Ordem de Coleta numa rota cadastrada é aprovada" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={list.length > 0 && list.every((p) => selectedIds.has(p.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Ordem Nº</th>
                    <th>Rota</th>
                    <th>Motorista</th>
                    <th>Transportadora</th>
                    <th className="!text-right">Valor do frete</th>
                    <th>Status</th>
                    <th>Aprovação</th>
                    <th>Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => toggleSelect(p.id)}
                      data-selected={selectedIds.has(p.id)}
                      className="cursor-pointer"
                      data-testid={`freight-payment-row-${p.payment_number}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(p.id)}
                          onCheckedChange={() => toggleSelect(p.id)}
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{p.payment_number}</td>
                      <td className="whitespace-nowrap tabular-nums">#{p.order_number}</td>
                      <td><div className="max-w-[220px] truncate" title={p.route_name || ''}>{p.route_name || '-'}</div></td>
                      <td><div className="max-w-[200px] truncate" title={p.driver_name || ''}>{p.driver_name || '-'}</div></td>
                      <td><div className="max-w-[200px] truncate" title={p.transport_company || ''}>{p.transport_company || '-'}</div></td>
                      <td className="text-right tabular-nums whitespace-nowrap">{formatMoney(p.freight_value)}</td>
                      <td>
                        <StatusPill tone={STATUS_TONES[p.status] || 'slate'}>
                          {STATUS_LABELS[p.status] || p.status}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{p.created_at ? format(new Date(p.created_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                      <td className="whitespace-nowrap tabular-nums">{p.paid_at ? format(new Date(p.paid_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        <DataCard
          title="Ordens de pagamento"
          count={loadingBatches ? '...' : batches.length}
          meta={<span className="hidden md:inline text-xs text-slate-400 dark:text-slate-500">geradas ao marcar lançamentos como Pago - baixe o recibo de cada uma</span>}
        >
          {batches.length === 0 && !loadingBatches ? (
            <EmptyState icon={Receipt} title="Nenhuma Ordem de Pagamento gerada ainda" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Motorista</th>
                    <th>Transportadora</th>
                    <th className="!text-right">Lançamentos</th>
                    <th className="!text-right">Valor total</th>
                    <th>Data do pagamento</th>
                    <th className="!text-right">Recibo</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} data-testid={`freight-payment-batch-row-${b.batch_number}`}>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{b.batch_number}</td>
                      <td><div className="max-w-[220px] truncate" title={b.driver_name || ''}>{b.driver_name || '-'}</div></td>
                      <td><div className="max-w-[220px] truncate" title={b.transport_company || ''}>{b.transport_company || '-'}</div></td>
                      <td className="text-right tabular-nums">{b.item_count}</td>
                      <td className="text-right tabular-nums whitespace-nowrap cell-strong">{formatMoney(b.total_value)}</td>
                      <td className="whitespace-nowrap tabular-nums">{b.created_at ? format(new Date(b.created_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                      <td className="text-right !py-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadReceipt(b)}
                          title="Baixar Recibo de Pagamento"
                          data-testid={`freight-payment-batch-receipt-${b.batch_number}`}
                          className="h-8 w-8 p-0"
                        >
                          <Download className="w-4 h-4 text-primary" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent data-testid="freight-payment-edit-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Editar Pagamento Frete</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Valor do Frete</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                className="h-10 text-[13px]"
                value={editForm.freight_value}
                onChange={(e) => setEditForm({ ...editForm, freight_value: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Observações</Label>
              <Textarea
                className="text-[13px] min-h-[60px]"
                value={editForm.observations}
                onChange={(e) => setEditForm({ ...editForm, observations: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleEditSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
