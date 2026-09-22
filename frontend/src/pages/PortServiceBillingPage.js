import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Autocomplete } from '../components/Autocomplete';
import { Anchor, Search, Eye, Printer, FileSpreadsheet, Pencil, X, Check } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const BATCH_STATUS_OPTIONS = [
  { value: 'PENDENTE', label: 'Pendente', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'PAGO', label: 'Pago', color: 'bg-green-100 text-green-800' },
  { value: 'CANCELADO', label: 'Cancelado', color: 'bg-red-100 text-red-800' },
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
      <div className="space-y-5" data-testid="port-service-billing-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Faturamento Portuário</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Selecione um cliente e um período pra faturar os Serviços Portuários realizados</p>
        </div>

        {/* Gerar Fatura */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Anchor className="w-4 h-4" />
              Gerar Fatura
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-xs mb-1 block">Cliente *</Label>
                <Autocomplete
                  value={clientName}
                  onChange={(val) => { setClientName(val); setClientId(''); }}
                  onSelect={(c) => { setClientName(c.name); setClientId(c.id); }}
                  options={clients}
                  displayField="name"
                  valueField="id"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Período De</Label>
                <Input type="date" className="h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Período Até</Label>
                <Input type="date" className="h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
            <Button size="sm" onClick={handleSearchCandidates} disabled={searching} className="h-8 text-xs font-medium bg-primary hover:bg-primary/90">
              <Search className="w-3.5 h-3.5 mr-1.5" />
              Buscar
            </Button>

            {candidates.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2 w-10">
                          <Checkbox
                            checked={candidates.length > 0 && candidates.every(c => selectedIds.has(c.id))}
                            onCheckedChange={toggleSelectAllCandidates}
                          />
                        </th>
                        <th className="text-left p-2">Nº</th>
                        <th className="text-left p-2">Data</th>
                        <th className="text-left p-2">Motorista</th>
                        <th className="text-left p-2">Placa</th>
                        <th className="text-left p-2">Turno</th>
                        <th className="text-right p-2">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c) => {
                        const isSelected = selectedIds.has(c.id);
                        return (
                          <tr
                            key={c.id}
                            className={`border-t cursor-pointer ${isSelected ? 'bg-primary/10' : ''}`}
                            onClick={() => toggleSelect(c.id)}
                          >
                            <td className="p-2" onClick={(e) => e.stopPropagation()}>
                              <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(c.id)} />
                            </td>
                            <td className="p-2">#{c.service_number}</td>
                            <td className="p-2">{fmtDate(c.service_date)}</td>
                            <td className="p-2">{c.driver_name}</td>
                            <td className="p-2 font-mono">{c.cavalo_plate}</td>
                            <td className="p-2">{c.turno === 'NOITE' ? 'Noite' : 'Dia'}</td>
                            <td className="p-2 text-right">{fmtMoney(c.operation_value)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Desconto (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-9"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      data-testid="port-service-invoice-discount-input"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs mb-1 block">Observações</Label>
                    <Input
                      className="h-9"
                      value={batchObservations}
                      onChange={(e) => setBatchObservations(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {selectedIds.size} selecionado(s) — Serviços: {fmtMoney(selectedTotal)}
                    {discountNumber > 0 && <> — Desconto: {fmtMoney(discountNumber)}</>}
                    {' '}— Total: <span className="font-semibold text-foreground">{fmtMoney(netTotal)}</span>
                  </span>
                  <Button onClick={handleGenerateInvoice} disabled={generating || selectedIds.size === 0} data-testid="generate-port-service-invoice-button">
                    {generating ? 'Gerando...' : `Gerar Fatura (${selectedIds.size})`}
                  </Button>
                </div>
              </div>
            )}
            {candidates.length === 0 && clientId && !searching && (
              <p className="text-sm text-muted-foreground pt-2">Nenhum Serviço Portuário pendente de faturamento encontrado pra esse cliente/período.</p>
            )}
          </CardContent>
        </Card>

        {/* Toolbar da lista de faturas */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedBatch && openDetails(singleSelectedBatch)}
            disabled={!singleSelectedBatch}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Ver Detalhes"
          >
            <Eye className="w-4 h-4 text-primary" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedBatch && handlePrintPDF(singleSelectedBatch.id)}
            disabled={!singleSelectedBatch}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Baixar PDF"
          >
            <Printer className="w-4 h-4 text-emerald-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedBatch && handleDownloadExcel(singleSelectedBatch.id)}
            disabled={!singleSelectedBatch}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Baixar Excel"
          >
            <FileSpreadsheet className="w-4 h-4 text-green-600" />
          </Button>
          {selectedBatchIds.size > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 pr-1">
              {selectedBatchIds.size} selecionado(s)
            </span>
          )}
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Anchor className="w-4 h-4" />
              Faturas de Serviço Portuário ({pagination.total})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingBatches ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : batches.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                Nenhuma fatura de Serviço Portuário gerada ainda
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left w-10">
                        <Checkbox
                          checked={batches.length > 0 && batches.every(b => selectedBatchIds.has(b.id))}
                          onCheckedChange={toggleSelectAllBatchesOnPage}
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Período</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Serviços</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Valor Total</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Criado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch, idx) => {
                      const isSelected = selectedBatchIds.has(batch.id);
                      const badge = getBatchStatusBadge(batch.status);
                      return (
                        <tr
                          key={batch.id}
                          className={`cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 hover:bg-primary/15' : `hover:bg-slate-50 dark:hover:bg-slate-800/80 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}`}
                          onClick={() => toggleSelectBatch(batch.id)}
                        >
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={isSelected} onCheckedChange={() => toggleSelectBatch(batch.id)} />
                          </td>
                          <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{batch.batch_number}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{batch.client_name}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtPeriod(batch.period_from, batch.period_to)}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{batch.item_count}</td>
                          <td className="px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">{fmtMoney(batch.net_total ?? batch.total_value)}</td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${badge.color}`}>{badge.label}</span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                            {batch.created_at && format(new Date(batch.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {pagination.pages > 1 && (
              <div className="flex justify-center gap-2 mt-4 pb-4">
                <Button variant="outline" size="sm" disabled={pagination.page === 1} onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}>
                  Anterior
                </Button>
                <span className="px-4 py-2 text-sm">Página {pagination.page} de {pagination.pages}</span>
                <Button variant="outline" size="sm" disabled={pagination.page === pagination.pages} onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}>
                  Próxima
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
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
