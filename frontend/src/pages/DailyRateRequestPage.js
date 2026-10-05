import { useEffect, useState, useRef } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import { Wallet, Plus, Eye, Trash2, Printer, Pencil, X, CheckCircle2, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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

  // Estado de Seleção (toolbar)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  function createEmptyItem() {
    return {
      driver_id: '',
      driver_name: '',
      vehicle_plate: '',
      client_name: '',
      departure_date: new Date().toISOString().split('T')[0],
      others_value: 0,
      commission_value: 0,
      lunch_value: 0,
      daily_rate_quantity: 0,
      daily_rate_value: 0
    };
  }

  useEffect(() => {
    loadRequests();
    loadSelectData();
    setSelectedIds(new Set());
  }, [pagination.page]);

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

  const loadRequests = async (search = searchQuery, status = statusFilter) => {
    setLoading(true);
    try {
      const params = { page: pagination.page, per_page: 15 };
      if (search) params.search = search;
      if (status) params.status = status;

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

  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadRequests(searchQuery);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setStatusFilter('');
    setPagination(prev => ({ ...prev, page: 1 }));
    loadRequests('', '');
  };

  const handleStatusFilterChange = (value) => {
    const next = value === 'ALL' ? '' : value;
    setStatusFilter(next);
    setPagination(prev => ({ ...prev, page: 1 }));
    loadRequests(searchQuery, next);
  };

  // Marca como Pago/Pendente todas as solicitações selecionadas (uma ou
  // várias). Só habilita quando todas estão no status de origem certo.
  const markSelectedAs = async (newStatus) => {
    const targets = requests.filter((r) => selectedIds.has(r.id) && r.status !== newStatus);
    if (targets.length === 0 || updatingStatus) return;
    setUpdatingStatus(true);
    try {
      await Promise.all(targets.map((r) => api.updateDailyRateRequestStatus(r.id, newStatus)));
      const plural = targets.length > 1;
      toast.success(newStatus === 'PAGO'
        ? (plural ? `${targets.length} solicitações marcadas como pagas` : 'Solicitação marcada como paga')
        : (plural ? `${targets.length} solicitações voltaram para pendente` : 'Solicitação voltou para pendente'));
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar o status');
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
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData(prev => ({ ...prev, items: newItems }));
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
    const newItems = formData.items.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, items: newItems }));
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
  const canMarkPending = selectedRequests.length > 0 && selectedRequests.every((r) => r.status === 'PAGO');

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

  const getStatusBadge = (status) => {
    const tones = { PENDENTE: 'amber', PAGO: 'emerald', CANCELADO: 'red' };
    const labels = { PENDENTE: 'Pendente', PAGO: 'Pago', CANCELADO: 'Cancelado' };
    return <StatusPill tone={tones[status] || 'amber'}>{labels[status] || status}</StatusPill>;
  };

  const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <Layout>
      <div className="space-y-4">
        <PageHeader icon={Wallet} title="Solicitação de Diária" subtitle="Gerencie as solicitações de diária, comissão e almoço dos motoristas" />

        <FilterCard hasFilters={!!(searchQuery || statusFilter)} onClear={clearSearch} onApply={handleSearch}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Motorista, placa ou cliente">
              <SearchInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
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
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedRequest && openEditModal(singleSelectedRequest)} disabled={!singleSelectedRequest} />
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
            <EmptyState title="Carregando..." />
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
                      <td>{getStatusBadge(request.status)}</td>
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
                <h3 className="font-semibold">Itens da Solicitação</h3>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="w-4 h-4 mr-1" /> Adicionar Item
                </Button>
              </div>

              <div className="space-y-4">
                {formData.items.map((item, index) => (
                  <div key={index} className="border rounded-lg p-4 relative">
                    <div className="absolute top-2 right-2">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)} className="h-6 w-6 text-red-500">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="text-sm font-medium text-muted-foreground mb-3">Item #{index + 1}</div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block">Motorista *</Label>
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
                        <Label className="text-xs mb-1 block">Placa *</Label>
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
                        <Label className="text-xs mb-1 block">Cliente *</Label>
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
                        <Label className="text-xs mb-1 block">Data de Saída *</Label>
                        <Input className="h-9" type="date" value={item.departure_date} onChange={(e) => handleItemChange(index, 'departure_date', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Outros (R$)</Label>
                        <Input className="h-9" type="number" step="0.01" value={item.others_value} onChange={(e) => handleItemChange(index, 'others_value', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Comissão (R$)</Label>
                        <Input className="h-9" type="number" step="0.01" value={item.commission_value} onChange={(e) => handleItemChange(index, 'commission_value', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Almoço (R$)</Label>
                        <Input className="h-9" type="number" step="0.01" value={item.lunch_value} onChange={(e) => handleItemChange(index, 'lunch_value', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Qtd. Diária</Label>
                        <Input className="h-9" type="number" step="1" value={item.daily_rate_quantity} onChange={(e) => handleItemChange(index, 'daily_rate_quantity', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Valor da Diária (R$)</Label>
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
              <Label>Observações</Label>
              <Input value={formData.observations} onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvando...' : (editingRequest ? 'Salvar Alterações' : 'Criar Solicitação')}
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
              {selectedRequest && getStatusBadge(selectedRequest.status)}
            </DialogTitle>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Itens ({selectedRequest.items?.length || 0})</h4>
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-sm rows-in">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2">#</th>
                        <th className="text-left p-2">Motorista</th>
                        <th className="text-left p-2">Placa</th>
                        <th className="text-left p-2">Cliente</th>
                        <th className="text-left p-2">Data</th>
                        <th className="text-right p-2">Outros</th>
                        <th className="text-right p-2">Comissão</th>
                        <th className="text-right p-2">Almoço</th>
                        <th className="text-right p-2">Qtd.</th>
                        <th className="text-right p-2">Diária</th>
                        <th className="text-right p-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRequest.items?.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{idx + 1}</td>
                          <td className="p-2">{item.driver_name}</td>
                          <td className="p-2 font-mono">{item.vehicle_plate}</td>
                          <td className="p-2">{item.client_name}</td>
                          <td className="p-2">{item.departure_date ? format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(item.departure_date) ? `${item.departure_date}T00:00:00` : item.departure_date), 'dd/MM/yyyy') : '-'}</td>
                          <td className="p-2 text-right">{formatMoney(item.others_value)}</td>
                          <td className="p-2 text-right">{formatMoney(item.commission_value)}</td>
                          <td className="p-2 text-right">{formatMoney(item.lunch_value)}</td>
                          <td className="p-2 text-right">{item.daily_rate_quantity}</td>
                          <td className="p-2 text-right">{formatMoney(item.daily_rate_value)}</td>
                          <td className="p-2 text-right font-semibold">{formatMoney(item.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-right font-bold mt-2">
                  Total Geral: {formatMoney(selectedRequest.total_value)}
                </div>
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
      <ConfirmDialog />
    </Layout>
  );
}
