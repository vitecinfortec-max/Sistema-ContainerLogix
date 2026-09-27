import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterField, DataCard, Toolbar, ToolbarButton, StatusPill, PlateTag, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Autocomplete } from '../components/Autocomplete';
import { Anchor, Search, Eye, FileText, FileSpreadsheet, Pencil, Printer, X, Check, Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const BATCH_STATUS_OPTIONS = [
  { value: 'PENDENTE', label: 'Pendente', tone: 'amber' },
  { value: 'PAGO', label: 'Pago', tone: 'emerald' },
  { value: 'CANCELADO', label: 'Cancelado', tone: 'red' },
];

const getBatchStatusBadge = (status) => BATCH_STATUS_OPTIONS.find(s => s.value === status) || BATCH_STATUS_OPTIONS[0];

const fmtDate = (d) => {
  if (!d) return '-';
  try {
    return format(new Date(d + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR });
  } catch (e) {
    return d;
  }
};

const fmtPeriod = (from, to) => {
  if (from && to) return `${fmtDate(from)} a ${fmtDate(to)}`;
  return fmtDate(from) !== '-' ? fmtDate(from) : (fmtDate(to) !== '-' ? fmtDate(to) : '-');
};

export default function PortServiceBillingPage() {
  // Cadastros
  const [clients, setClients] = useState([]);

  // Gerar Fatura
  const [clientName, setClientName] = useState('');
  const [clientId, setClientId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [discountValue, setDiscountValue] = useState('');
  const [batchObservations, setBatchObservations] = useState('');

  // Lista de Faturas
  const [batches, setBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selectedBatchIds, setSelectedBatchIds] = useState(() => new Set());

  // Modal de detalhes
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [batchServices, setBatchServices] = useState([]);
  const [loadingBatchServices, setLoadingBatchServices] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editDiscount, setEditDiscount] = useState('');
  const [editObservations, setEditObservations] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    loadClients();
    loadBatches();
    setSelectedBatchIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page]);

  const loadClients = async () => {
    try {
      const r = await api.getClients({ per_page: 1000 });
      setClients(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar clientes:', e);
    }
  };

  const loadBatches = async () => {
    setLoadingBatches(true);
    try {
      const response = await api.getPortServiceBillingBatches({ page: pagination.page, per_page: 15 });
      setBatches(response.data.items);
      setPagination(prev => ({ ...prev, pages: response.data.pages, total: response.data.total }));
    } catch (error) {
      toast.error('Erro ao carregar faturas de Serviço Portuário');
    } finally {
      setLoadingBatches(false);
    }
  };

  const handleSearchCandidates = async () => {
    if (!clientId) {
      toast.error('Selecione um cliente');
      return;
    }
    setSearching(true);
    try {
      const params = { client_id: clientId };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const response = await api.getPortServiceBillingCandidates(params);
      setCandidates(response.data || []);
      setSelectedIds(new Set());
    } catch (error) {
      toast.error('Erro ao buscar Serviços Portuários');
    } finally {
      setSearching(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllCandidates = () => {
    setSelectedIds(prev => {
      const ids = candidates.map(c => c.id);
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id));
      if (allSelected) return new Set();
      return new Set(ids);
    });
  };

  const selectedTotal = candidates
    .filter(c => selectedIds.has(c.id))
    .reduce((sum, c) => sum + (c.operation_value || 0), 0);
  const discountNumber = Number(discountValue) || 0;
  const netTotal = Math.max(0, selectedTotal - discountNumber);

  const handleGenerateInvoice = async () => {
    if (selectedIds.size === 0) {
      toast.error('Selecione pelo menos um Serviço Portuário');
      return;
    }
    setGenerating(true);
    try {
      await api.createPortServiceBillingBatch({
        client_id: clientId,
        client_name: clientName,
        service_ids: [...selectedIds],
        period_from: dateFrom || null,
        period_to: dateTo || null,
        discount_value: discountNumber,
        observations: batchObservations || null,
      });
      toast.success('Fatura de Serviço Portuário gerada com sucesso!');
      setCandidates(prev => prev.filter(c => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
      setDiscountValue('');
      setBatchObservations('');
      setPagination(prev => ({ ...prev, page: 1 }));
      loadBatches();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao gerar fatura');
    } finally {
      setGenerating(false);
    }
  };

  const toggleSelectBatch = (id) => {
    setSelectedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllBatchesOnPage = () => {
    setSelectedBatchIds(prev => {
      const pageIds = batches.map(b => b.id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  };

  const singleSelectedBatch = selectedBatchIds.size === 1
    ? batches.find(b => b.id === [...selectedBatchIds][0])
    : null;

  const openDetails = async (batch) => {
    setSelectedBatch(batch);
    setDetailModalOpen(true);
    setEditMode(false);
    setEditDiscount(String(batch.discount_value || 0));
    setEditObservations(batch.observations || '');
    setLoadingBatchServices(true);
    try {
      const response = await api.getPortServiceBillingBatchServices(batch.id);
      setBatchServices(response.data || []);
    } catch (error) {
      toast.error('Erro ao carregar serviços da fatura');
    } finally {
      setLoadingBatchServices(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedBatch) return;
    const newDiscount = Number(editDiscount) || 0;
    if (newDiscount > selectedBatch.total_value) {
      toast.error('Desconto não pode ser maior que o valor dos serviços');
      return;
    }
    setSavingEdit(true);
    try {
      const response = await api.updatePortServiceBillingBatch(selectedBatch.id, {
        discount_value: newDiscount,
        observations: editObservations || null,
      });
      toast.success('Fatura atualizada com sucesso!');
      setSelectedBatch(response.data);
      setBatches(prev => prev.map(b => b.id === selectedBatch.id ? response.data : b));
      setEditMode(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar fatura');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleUpdateStatus = async (newStatus) => {
    if (!selectedBatch) return;
    setUpdatingStatus(true);
    try {
      await api.updatePortServiceBillingBatchStatus(selectedBatch.id, newStatus);
      toast.success('Status atualizado com sucesso!');
      setSelectedBatch(prev => ({ ...prev, status: newStatus }));
      setBatches(prev => prev.map(b => b.id === selectedBatch.id ? { ...b, status: newStatus } : b));
    } catch (error) {
      toast.error('Erro ao atualizar status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handlePrintPDF = async (id) => {
    try {
      const response = await api.getPortServiceBillingBatchPDF(id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `fatura_servico_portuario_${id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    }
  };

  const handleDownloadExcel = async (id) => {
    try {
      const response = await api.getPortServiceBillingBatchExcel(id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `fatura_servico_portuario_${id}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar Excel');
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="port-service-billing-page">
        <PageHeader icon={Anchor} title="Faturamento Portuário" subtitle="Selecione um cliente e um período pra faturar os Serviços Portuários realizados" />

        {/* Gerar Fatura */}
        <DataCard title={(<span className="flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" />Gerar fatura</span>)}>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <FilterField label="Cliente *" className="sm:col-span-2">
                <Autocomplete
                  value={clientName}
                  onChange={(val) => { setClientName(val); setClientId(''); }}
                  onSelect={(c) => { setClientName(c.name); setClientId(c.id); }}
                  options={clients}
                  displayField="name"
                  valueField="id"
                  className="text-sm"
                />
              </FilterField>
              <FilterField label="Período de">
                <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </FilterField>
              <FilterField label="Período até">
                <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </FilterField>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSearchCandidates} disabled={searching} className="h-8 text-xs px-4 gap-1.5">
                <Search className="w-3.5 h-3.5" />
                {searching ? 'Buscando...' : 'Buscar serviços'}
              </Button>
            </div>

            {candidates.length > 0 && (
              <div className="space-y-3">
                <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="w-10 pr-0">
                            <Checkbox
                              checked={candidates.length > 0 && candidates.every(c => selectedIds.has(c.id))}
                              onCheckedChange={toggleSelectAllCandidates}
                            />
                          </th>
                          <th>Nº</th>
                          <th>Data</th>
                          <th>Motorista</th>
                          <th>Placa</th>
                          <th>Turno</th>
                          <th className="!text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((c) => {
                          const isSelected = selectedIds.has(c.id);
                          return (
                            <tr
                              key={c.id}
                              data-selected={isSelected}
                              className="cursor-pointer"
                              onClick={() => toggleSelect(c.id)}
                            >
                              <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                                <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(c.id)} />
                              </td>
                              <td className="cell-strong whitespace-nowrap tabular-nums">#{c.service_number}</td>
                              <td className="whitespace-nowrap tabular-nums">{fmtDate(c.service_date)}</td>
                              <td><div className="max-w-[220px] truncate" title={c.driver_name || ''}>{c.driver_name}</div></td>
                              <td><PlateTag>{c.cavalo_plate}</PlateTag></td>
                              <td>
                                <StatusPill tone={c.turno === 'NOITE' ? 'violet' : 'amber'} dot={false}>
                                  {c.turno === 'NOITE' ? 'Noite' : 'Dia'}
                                </StatusPill>
                              </td>
                              <td className="text-right whitespace-nowrap tabular-nums">{fmtMoney(c.operation_value)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <FilterField label="Desconto (R$)">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-9 text-sm"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      data-testid="port-service-invoice-discount-input"
                    />
                  </FilterField>
                  <FilterField label="Observações" className="sm:col-span-2">
                    <Input
                      className="h-9 text-sm"
                      value={batchObservations}
                      onChange={(e) => setBatchObservations(e.target.value)}
                    />
                  </FilterField>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-4 py-3">
                  <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-[13px] text-slate-500 dark:text-slate-400">
                    <span><span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{selectedIds.size}</span> selecionado(s)</span>
                    <span>Serviços: <span className="font-medium text-slate-700 dark:text-slate-200 tabular-nums">{fmtMoney(selectedTotal)}</span></span>
                    {discountNumber > 0 && (
                      <span>Desconto: <span className="font-medium text-red-600 dark:text-red-400 tabular-nums">- {fmtMoney(discountNumber)}</span></span>
                    )}
                    <span>Total: <span className="text-base font-semibold text-primary tabular-nums">{fmtMoney(netTotal)}</span></span>
                  </div>
                  <Button onClick={handleGenerateInvoice} disabled={generating || selectedIds.size === 0} data-testid="generate-port-service-invoice-button">
                    {generating ? 'Gerando...' : `Gerar Fatura (${selectedIds.size})`}
                  </Button>
                </div>
              </div>
            )}
            {candidates.length === 0 && clientId && !searching && (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum Serviço Portuário pendente de faturamento encontrado pra esse cliente/período.</p>
            )}
          </div>
        </DataCard>

        {/* Faturas geradas - marque uma pra habilitar as ações da barra */}
        <DataCard
          title="Faturas de serviço portuário"
          count={pagination.total}
          toolbar={(
            <Toolbar selectedCount={selectedBatchIds.size}>
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedBatch && openDetails(singleSelectedBatch)} disabled={!singleSelectedBatch} />
              <ToolbarButton icon={FileText} label="Baixar PDF" tone="red" onClick={() => singleSelectedBatch && handlePrintPDF(singleSelectedBatch.id)} disabled={!singleSelectedBatch} />
              <ToolbarButton icon={FileSpreadsheet} label="Baixar Excel" tone="emerald" onClick={() => singleSelectedBatch && handleDownloadExcel(singleSelectedBatch.id)} disabled={!singleSelectedBatch} />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              pageSize={15}
              onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            />
          )}
        >
          {loadingBatches ? (
            <EmptyState title="Carregando..." />
          ) : batches.length === 0 ? (
            <EmptyState icon={Anchor} title="Nenhuma fatura de Serviço Portuário gerada ainda" hint="Use o card acima pra buscar os serviços de um cliente e gerar a fatura" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={batches.length > 0 && batches.every(b => selectedBatchIds.has(b.id))}
                        onCheckedChange={toggleSelectAllBatchesOnPage}
                      />
                    </th>
                    <th>Nº</th>
                    <th>Cliente</th>
                    <th>Período</th>
                    <th className="!text-right">Serviços</th>
                    <th className="!text-right">Valor total</th>
                    <th>Status</th>
                    <th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => {
                    const isSelected = selectedBatchIds.has(batch.id);
                    const badge = getBatchStatusBadge(batch.status);
                    return (
                      <tr
                        key={batch.id}
                        data-selected={isSelected}
                        className="cursor-pointer"
                        onClick={() => toggleSelectBatch(batch.id)}
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleSelectBatch(batch.id)} />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{batch.batch_number}</td>
                        <td><div className="max-w-[240px] truncate" title={batch.client_name || ''}>{batch.client_name}</div></td>
                        <td className="whitespace-nowrap tabular-nums">{fmtPeriod(batch.period_from, batch.period_to)}</td>
                        <td className="text-right tabular-nums">{batch.item_count}</td>
                        <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtMoney(batch.net_total ?? batch.total_value)}</td>
                        <td><StatusPill tone={badge.tone}>{badge.label}</StatusPill></td>
                        <td className="whitespace-nowrap tabular-nums">
                          {batch.created_at && format(new Date(batch.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fatura de Serviço Portuário #{selectedBatch?.batch_number}</DialogTitle>
          </DialogHeader>

          {selectedBatch && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Cliente</p>
                  <p className="font-medium">{selectedBatch.client_name}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Período</p>
                  <p className="font-medium">{fmtPeriod(selectedBatch.period_from, selectedBatch.period_to)}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground mb-1">Status</p>
                  <Select value={selectedBatch.status} onValueChange={handleUpdateStatus} disabled={updatingStatus}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BATCH_STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="bg-muted/50 p-3 rounded flex items-end justify-end">
                  {!editMode ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditMode(true)}
                      disabled={selectedBatch.status === 'CANCELADO'}
                      data-testid="edit-port-service-invoice-button"
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditMode(false)} disabled={savingEdit}>
                        <X className="w-3.5 h-3.5 mr-1.5" /> Cancelar
                      </Button>
                      <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit}>
                        <Check className="w-3.5 h-3.5 mr-1.5" /> {savingEdit ? 'Salvando...' : 'Salvar'}
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="border rounded p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Valor dos Serviços</span>
                  <span className="font-medium">{fmtMoney(selectedBatch.total_value)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Desconto</span>
                  {editMode ? (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-8 w-32 text-right"
                      value={editDiscount}
                      onChange={(e) => setEditDiscount(e.target.value)}
                    />
                  ) : (
                    <span className="font-medium">{fmtMoney(selectedBatch.discount_value)}</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm border-t pt-2">
                  <span className="font-semibold">Valor Total</span>
                  <span className="font-semibold text-primary">
                    {fmtMoney(editMode ? Math.max(0, selectedBatch.total_value - (Number(editDiscount) || 0)) : (selectedBatch.net_total ?? selectedBatch.total_value))}
                  </span>
                </div>
              </div>

              <div className="bg-muted/50 p-3 rounded">
                <p className="text-sm text-muted-foreground mb-1">Observações</p>
                {editMode ? (
                  <Input
                    value={editObservations}
                    onChange={(e) => setEditObservations(e.target.value)}
                  />
                ) : (
                  <p className="font-medium">{selectedBatch.observations || '-'}</p>
                )}
              </div>

              <div>
                <h4 className="font-semibold mb-2">Serviços ({batchServices.length})</h4>
                {loadingBatchServices ? (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <div className="border rounded overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left p-2">Nº</th>
                          <th className="text-left p-2">Data</th>
                          <th className="text-left p-2">Motorista</th>
                          <th className="text-left p-2">Placa</th>
                          <th className="text-left p-2">Turno</th>
                          <th className="text-right p-2">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchServices.map((s) => (
                          <tr key={s.id} className="border-t">
                            <td className="p-2">#{s.service_number}</td>
                            <td className="p-2">{fmtDate(s.service_date)}</td>
                            <td className="p-2">{s.driver_name}</td>
                            <td className="p-2 font-mono">{s.cavalo_plate}</td>
                            <td className="p-2">{s.turno === 'NOITE' ? 'Noite' : 'Dia'}</td>
                            <td className="p-2 text-right">{fmtMoney(s.operation_value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
            <Button variant="outline" onClick={() => handleDownloadExcel(selectedBatch?.id)}>
              <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
            </Button>
            <Button onClick={() => handlePrintPDF(selectedBatch?.id)}>
              <Printer className="w-4 h-4 mr-2" /> PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
