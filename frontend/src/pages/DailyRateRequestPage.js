import { FormSectionTitle } from '../components/FormKit';
import { useEffect, useState, useRef } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, PeriodFilterFields, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import { Wallet, Plus, Eye, Trash2, Printer, Pencil, X, CheckCircle2, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { todayISO } from '../lib/dates';
import PeriodReportDialog from '../components/PeriodReportDialog';
import { FileBarChart } from 'lucide-react';

const brl = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Motorista (item) pago. Solicitação de antes do pagamento por item: vale o
// status dela (mesma regra do backend).
function isItemPaid(request, item) {
  if (item.paid !== null && item.paid !== undefined) return !!item.paid;
  return request.status === 'PAGO';
}

function itemPaidAt(request, item) {
  if (item.paid !== null && item.paid !== undefined) return item.paid ? item.paid_at : null;
  return request.status === 'PAGO' ? (request.paid_at || request.updated_at) : null;
}

function paidSummary(request) {
  const items = request.items || [];
  const paidItems = items.filter((item) => isItemPaid(request, item));
  const paidValue = paidItems.reduce((sum, item) => sum + (item.total || 0), 0);
  return { paidCount: paidItems.length, count: items.length, paidValue, openValue: (request.total_value || 0) - paidValue };
}

function calculateItemTotal(item) {
  const others = parseFloat(item.others_value) || 0;
  const commission = parseFloat(item.commission_value) || 0;
  const lunch = parseFloat(item.lunch_value) || 0;
  const qty = parseFloat(item.daily_rate_quantity) || 0;
  const dailyRate = parseFloat(item.daily_rate_value) || 0;
  return others + commission + lunch + qty * dailyRate;
}

export default function DailyRateRequestPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [reportOpen, setReportOpen] = useState(false);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  const [clients, setClients] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    observations: '',
    items: [createEmptyItem()]
  });

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [payingItem, setPayingItem] = useState(false);

  // Estado de Seleção (toolbar)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  function createEmptyItem() {
    return {
      driver_id: '',
      driver_name: '',
      vehicle_plate: '',
      client_name: '',
      departure_date: todayISO(),
      others_value: 0,
      commission_value: 0,
      lunch_value: 0,
      daily_rate_quantity: 0,
      daily_rate_value: 0
    };
  }

  // A busca é feita enquanto se digita (sem botão "Filtrar") e vale também
  // ao trocar de página e ao recarregar depois de salvar.
  const debouncedSearch = useDebouncedValue(searchQuery.trim());

  const [period, setPeriod] = useState(['', '']);
  const changePeriod = (value) => { setPeriod(value); setPagination(prev => ({ ...prev, page: 1 })); };

  useEffect(() => {
    loadSelectData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadRequests();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, debouncedSearch, statusFilter, period]);

  const loadSelectData = async () => {
    try {
      const [clientsRes, driversRes, vehiclesRes] = await Promise.all([
        api.getClients(),
        api.getDrivers(),
        api.getVehicles({ per_page: 1000 })
      ]);
      setClients(clientsRes.data);
      setDrivers(driversRes.data);
      setVehicles(vehiclesRes.data.items || []);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      toast.error('Erro ao carregar dados');
    }
  };

  const loadRequests = async (search = debouncedSearch, status = statusFilter) => {
    try {
      const params = { page: pagination.page, per_page: 15 };
      if (search) params.search = search;
      if (status) params.status = status;
      if (period[0]) params.date_from = period[0];
      if (period[1]) params.date_to = period[1];

      const response = await api.getDailyRateRequests(params);
      setRequests(response.data.items);
      setPagination(prev => ({
        ...prev,
        pages: response.data.pages,
        total: response.data.total
      }));
    } catch (error) {
      toast.error('Erro ao carregar solicitações de diária');
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setStatusFilter('');
    setPeriod(['', '']);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleSearchChange = (value) => {
    setSearchQuery(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleStatusFilterChange = (value) => {
    const next = value === 'ALL' ? '' : value;
    setStatusFilter(next);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Marca como Pago/Pendente todas as solicitações selecionadas (uma ou
  // várias). Só habilita quando todas estão no status de origem certo.
  const markSelectedAs = async (newStatus) => {
    const targets = requests.filter((r) => selectedIds.has(r.id) && r.status !== newStatus);
    if (targets.length === 0 || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      // Uma a uma, sem parar na primeira falha: o aviso diz quantas passaram
      // e quais não (antes um erro escondia que as outras foram gravadas).
      const results = await Promise.allSettled(targets.map((r) => api.updateDailyRateRequestStatus(r.id, newStatus)));
      const failed = targets.filter((_, i) => results[i].status === 'rejected');
      const done = targets.length - failed.length;
      if (done > 0) {
        const plural = done > 1;
        toast.success(newStatus === 'PAGO'
          ? (plural ? `${done} solicitações marcadas como pagas` : 'Solicitação marcada como paga')
          : (plural ? `${done} solicitações voltaram para pendente` : 'Solicitação voltou para pendente'));
      }
      if (failed.length > 0) {
        toast.error(`Não foi possível atualizar: Nº ${failed.map((r) => r.request_number).join(', ')}`);
      }
    } finally {
      setUpdatingStatus(false);
      loadRequests();
    }
  };

  const resetForm = () => {
    setFormData({
      observations: '',
      items: [createEmptyItem()]
    });
    setEditingRequest(null);
  };

  const openNewModal = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (request) => {
    setEditingRequest(request);
    setFormData({
      observations: request.observations || '',
      items: request.items.length > 0 ? request.items : [createEmptyItem()]
    });
    setModalOpen(true);
  };

  const handleItemChange = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, createEmptyItem()]
    }));
  };

  const removeItem = (index) => {
    if (formData.items.length === 1) {
      toast.error('A solicitação deve ter pelo menos um item');
      return;
    }
    setFormData(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  };

  const handleSubmit = async () => {
    for (let i = 0; i < formData.items.length; i++) {
      const item = formData.items[i];
      if (!item.driver_name || !item.vehicle_plate || !item.client_name || !item.departure_date) {
        toast.error(`Preencha os campos obrigatórios do item ${i + 1}`);
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        observations: formData.observations,
        items: formData.items.map(item => ({
          ...item,
          others_value: parseFloat(item.others_value) || 0,
          commission_value: parseFloat(item.commission_value) || 0,
          lunch_value: parseFloat(item.lunch_value) || 0,
          daily_rate_quantity: parseFloat(item.daily_rate_quantity) || 0,
          daily_rate_value: parseFloat(item.daily_rate_value) || 0,
        }))
      };

      if (editingRequest) {
        await api.updateDailyRateRequest(editingRequest.id, payload);
        toast.success('Solicitação atualizada com sucesso!');
      } else {
        await api.createDailyRateRequest(payload);
        toast.success('Solicitação criada com sucesso!');
      }
      setModalOpen(false);
      resetForm();
      loadRequests();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar solicitação');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Deseja realmente excluir esta solicitação?'))) return;

    try {
      await api.deleteDailyRateRequest(id);
      toast.success('Solicitação excluída');
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadRequests();
    } catch (error) {
      toast.error('Erro ao excluir solicitação');
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedIds(prev => {
      const pageIds = requests.map(r => r.id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  };

  const singleSelectedRequest = selectedIds.size === 1
    ? requests.find(r => r.id === [...selectedIds][0])
    : null;
  const selectedRequests = requests.filter((r) => selectedIds.has(r.id));
  const canMarkPaid = selectedRequests.length > 0 && selectedRequests.every((r) => r.status === 'PENDENTE');
  const canMarkPending = selectedRequests.length > 0 && selectedRequests.every((r) => r.status === 'PAGO' || paidSummary(r).paidCount > 0);
  // Com motorista já pago não edita (o valor pago não pode mudar)
  const canEdit = !!singleSelectedRequest && (singleSelectedRequest.status || 'PENDENTE') === 'PENDENTE'
    && paidSummary(singleSelectedRequest).paidCount === 0;

  const handlePrintPDF = async (id) => {
    try {
      const response = await api.getDailyRateRequestPDF(id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `solicitacao_diaria_${id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    }
  };

  const openDetails = (request) => {
    setSelectedRequest(request);
    setDetailModalOpen(true);
  };

  // Marca/desmarca o pagamento de um motorista; com todos pagos a
  // solicitação fica Paga
  const toggleItemPaid = async (index, paid) => {
    if (!selectedRequest || payingItem) return;
    setPayingItem(true);
    try {
      const { data } = await api.setDailyRatePaidItems(selectedRequest.id, [index], paid);
      setSelectedRequest(data);
      const name = data.items[index]?.driver_name;
      toast.success(paid ? `${name}: marcado como pago` : `${name}: voltou para pendente`);
      loadRequests();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar o pagamento');
    } finally {
      setPayingItem(false);
    }
  };

  const getStatusBadge = (request) => {
    const { status } = request;
    const { paidCount, count } = paidSummary(request);
    if (status === 'PENDENTE' && paidCount > 0) {
      return <StatusPill tone="blue" title="Motoristas pagos / total">Pago {paidCount} de {count}</StatusPill>;
    }
    const tones = { PENDENTE: 'amber', PAGO: 'emerald', CANCELADO: 'red' };
    const labels = { PENDENTE: 'Pendente', PAGO: 'Pago', CANCELADO: 'Cancelado' };
    return <StatusPill tone={tones[status] || 'amber'}>{labels[status] || status}</StatusPill>;
  };

  const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <Layout>
      <div className="space-y-4">
        <PageHeader
          icon={Wallet}
          title="Solicitação de Diária"
          subtitle="Gerencie as solicitações de diária, comissão e almoço dos motoristas"
          actions={(
            <Button variant="outline" size="sm" onClick={() => setReportOpen(true)} data-testid="daily-rate-period-report">
              <FileBarChart className="w-4 h-4 mr-1.5" /> Relatório do período
            </Button>
          )}
        />

        <FilterCard hasFilters={!!(searchQuery || statusFilter || period[0] || period[1])} onClear={clearSearch}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Motorista, placa ou cliente">
              <SearchInput
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                data-testid="search-daily-rate-input"
              />
            </FilterField>
            <FilterField label="Status">
              <Select value={statusFilter || 'ALL'} onValueChange={handleStatusFilterChange}>
                <SelectTrigger className="h-9 text-sm" data-testid="filter-daily-rate-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="PENDENTE">Pendente</SelectItem>
                  <SelectItem value="PAGO">Pago</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <PeriodFilterFields value={period} onChange={changePeriod} testIdPrefix="daily-rate" />
          </div>
        </FilterCard>

        {/* Lista - marque uma solicitação pra habilitar as ações da barra */}
        <DataCard
          title="Solicitações"
          count={pagination.total}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova solicitação" onClick={openNewModal} testId="new-daily-rate-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedRequest && openDetails(singleSelectedRequest)} disabled={!singleSelectedRequest} />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedRequest && openEditModal(singleSelectedRequest)} disabled={!canEdit} />
              <ToolbarDivider />
              <ToolbarButton icon={CheckCircle2} label="Marcar como pago" tone="emerald" onClick={() => markSelectedAs('PAGO')} disabled={!canMarkPaid || updatingStatus} testId="daily-rate-mark-paid" />
              <ToolbarButton icon={RotateCcw} label="Marcar como pendente" tone="amber" onClick={() => markSelectedAs('PENDENTE')} disabled={!canMarkPending || updatingStatus} testId="daily-rate-mark-pending" />
              <ToolbarDivider />
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedRequest && handlePrintPDF(singleSelectedRequest.id)} disabled={!singleSelectedRequest} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedRequest && handleDelete(singleSelectedRequest.id)} disabled={!singleSelectedRequest} />
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
          {loading ? (
            <EmptyState loading />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Nenhuma solicitação encontrada"
              hint={searchQuery ? 'Ajuste a busca' : 'Registre a primeira pelo botão "Nova solicitação"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={requests.length > 0 && requests.every(r => selectedIds.has(r.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Nº</th>
                    <th className="!text-right">Itens</th>
                    <th className="!text-right">Total</th>
                    <th className="!text-right">A pagar</th>
                    <th>Status</th>
                    <th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(request => (
                    <tr
                      key={request.id}
                      data-selected={selectedIds.has(request.id)}
                      className="cursor-pointer"
                      onClick={() => toggleSelect(request.id)}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(request.id)}
                          onCheckedChange={() => toggleSelect(request.id)}
                        />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{request.request_number}</td>
                      <td className="text-right tabular-nums">{request.items?.length || 0}</td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">{formatMoney(request.total_value)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">
                        {request.status === 'CANCELADO' ? '-' : formatMoney(paidSummary(request).openValue)}
                      </td>
                      <td>{getStatusBadge(request)}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {request.created_at && format(new Date(request.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      {/* Modal Nova/Editar Solicitação */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Wallet className="w-4 h-4 text-primary" />
              {editingRequest ? 'Editar Solicitação' : 'Nova Solicitação de Diária'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-4">
                <FormSectionTitle bare>Itens da Solicitação</FormSectionTitle>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="w-4 h-4 mr-1" /> Adicionar item
                </Button>
              </div>

              <div className="space-y-4">
                {formData.items.map((item, index) => (
                  <div key={index} className="border rounded-lg p-4 relative">
                    <div className="absolute top-2 right-2">
                      <Button title="Remover" aria-label="Remover" type="button" variant="ghost" size="icon" onClick={() => removeItem(index)} className="h-6 w-6 text-destructive">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="text-sm font-medium text-muted-foreground mb-3">Item #{index + 1}</div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <Label className="mb-1.5 block">Motorista *</Label>
                        <Autocomplete
                          value={item.driver_name}
                          onChange={(val) => handleItemChange(index, 'driver_name', val)}
                          options={drivers}
                          displayField="name"
                          valueField="id"
                          onSelect={(driver) => {
                            handleItemChange(index, 'driver_id', driver.id);
                            handleItemChange(index, 'driver_name', driver.name);
                          }}
                        />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Placa *</Label>
                        <Autocomplete
                          value={item.vehicle_plate}
                          onChange={(val) => handleItemChange(index, 'vehicle_plate', val.toUpperCase())}
                          options={vehicles}
                          displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                          valueField="id"
                          onSelect={(vehicle) => handleItemChange(index, 'vehicle_plate', vehicle.plate)}
                        />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Cliente *</Label>
                        <Autocomplete
                          value={item.client_name}
                          onChange={(val) => handleItemChange(index, 'client_name', val)}
                          options={clients}
                          displayField="name"
                          valueField="id"
                          onSelect={(client) => handleItemChange(index, 'client_name', client.name)}
                        />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Data de Saída *</Label>
                        <Input className="h-9" type="date" value={item.departure_date} onChange={(e) => handleItemChange(index, 'departure_date', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Outros (R$)</Label>
                        <Input className="h-9" type="number" step="0.01" value={item.others_value} onChange={(e) => handleItemChange(index, 'others_value', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Comissão (R$)</Label>
                        <Input className="h-9" type="number" step="0.01" value={item.commission_value} onChange={(e) => handleItemChange(index, 'commission_value', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Almoço (R$)</Label>
                        <Input className="h-9" type="number" step="0.01" value={item.lunch_value} onChange={(e) => handleItemChange(index, 'lunch_value', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Qtd. Diária</Label>
                        <Input className="h-9" type="number" step="1" value={item.daily_rate_quantity} onChange={(e) => handleItemChange(index, 'daily_rate_quantity', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Valor da Diária (R$)</Label>
                        <Input className="h-9" type="number" step="0.01" value={item.daily_rate_value} onChange={(e) => handleItemChange(index, 'daily_rate_value', e.target.value)} />
                      </div>
                    </div>

                    <div className="mt-3 text-right text-sm font-semibold">
                      Total do item: {formatMoney(calculateItemTotal(item))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 text-right text-lg font-bold">
                Total Geral: {formatMoney(formData.items.reduce((sum, item) => sum + calculateItemTotal(item), 0))}
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Observações</Label>
              <Input value={formData.observations} onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvando...' : (editingRequest ? 'Salvar alterações' : 'Criar solicitação')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Solicitação #{selectedRequest?.request_number}
              {selectedRequest && getStatusBadge(selectedRequest)}
            </DialogTitle>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Itens ({selectedRequest.items?.length || 0})</h4>
                <div className="border rounded overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Motorista</th>
                        <th>Placa</th>
                        <th>Cliente</th>
                        <th>Data</th>
                        <th className="!text-right">Outros</th>
                        <th className="!text-right">Comissão</th>
                        <th className="!text-right">Almoço</th>
                        <th className="!text-right">Qtd.</th>
                        <th className="!text-right">Diária</th>
                        <th className="!text-right">Total</th>
                        <th className="!text-center">Pago</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRequest.items?.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td>{idx + 1}</td>
                          <td>{item.driver_name}</td>
                          <td className="font-mono">{item.vehicle_plate}</td>
                          <td>{item.client_name}</td>
                          <td>{item.departure_date ? format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(item.departure_date) ? `${item.departure_date}T00:00:00` : item.departure_date), 'dd/MM/yyyy') : '-'}</td>
                          <td className="text-right">{formatMoney(item.others_value)}</td>
                          <td className="text-right">{formatMoney(item.commission_value)}</td>
                          <td className="text-right">{formatMoney(item.lunch_value)}</td>
                          <td className="text-right">{item.daily_rate_quantity}</td>
                          <td className="text-right">{formatMoney(item.daily_rate_value)}</td>
                          <td className="text-right font-semibold">{formatMoney(item.total)}</td>
                          <td className="text-center whitespace-nowrap">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <Checkbox
                                checked={isItemPaid(selectedRequest, item)}
                                disabled={payingItem || selectedRequest.status === 'CANCELADO'}
                                onCheckedChange={(v) => toggleItemPaid(idx, !!v)}
                                aria-label={`Pago - ${item.driver_name}`}
                                data-testid={`daily-rate-item-paid-${idx}`}
                              />
                              {itemPaidAt(selectedRequest, item) && (
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {format(new Date(itemPaidAt(selectedRequest, item)), 'dd/MM/yyyy')}
                                </span>
                              )}
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 mt-2 text-sm">
                  {selectedRequest.status !== 'CANCELADO' && (
                    <>
                      <span>Pago: <strong className="tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(paidSummary(selectedRequest).paidValue)}</strong></span>
                      <span>A pagar: <strong className="tabular-nums text-amber-700 dark:text-amber-400">{formatMoney(paidSummary(selectedRequest).openValue)}</strong></span>
                    </>
                  )}
                  <span className="font-bold">Total Geral: {formatMoney(selectedRequest.total_value)}</span>
                </div>
                {selectedRequest.status !== 'CANCELADO' && (
                  <p className="text-xs text-muted-foreground mt-1">Marque "Pago" em cada motorista conforme for pagando. Com todos pagos, a solicitação fica Paga.</p>
                )}
              </div>

              {selectedRequest.observations && (
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Observações</p>
                  <p>{selectedRequest.observations}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
            <Button onClick={() => handlePrintPDF(selectedRequest?.id)}>
              <Printer className="w-4 h-4 mr-2" /> Gerar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PeriodReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Relatório de Diárias"
        description="Diárias, comissões e almoços por motorista e item a item: o que já foi pago e o que está pendente."
        selects={[{
          key: 'period_by',
          label: 'Período pela data de',
          options: [{ value: 'departure', label: 'Saída' }, { value: 'payment', label: 'Pagamento (só as pagas)' }],
        }]}
        statuses={[{ value: '', label: 'Pendentes e pagas' }, { value: 'PENDENTE', label: 'Pendentes' }, { value: 'PAGO', label: 'Pagas' }, { value: 'CANCELADO', label: 'Canceladas' }]}
        textFilters={[{ key: 'driver', label: 'Motorista' }, { key: 'client', label: 'Cliente' }]}
        load={api.getDailyRatesReport}
        summarize={(d) => [
          ['Viagens', d.summary.count], ['Motoristas', d.drivers.length],
          ['Total', brl(d.summary.total)], ['Pago', brl(d.summary.paid)], ['A pagar', brl(d.summary.pending)],
        ]}
        downloadPdf={api.downloadDailyRatesReportPdf}
        downloadExcel={api.downloadDailyRatesReportExcel}
        filename="relatorio_diarias"
      />
      <ConfirmDialog />
    </Layout>
  );
}
