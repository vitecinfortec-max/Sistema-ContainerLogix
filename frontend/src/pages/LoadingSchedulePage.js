import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import { formatContainerNumber } from '../lib/containerNumber';
import { Calendar, Plus, Eye, Trash2, Printer, Pencil, X, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Cliente para o qual exibimos o campo "Nº da Bolsa" (flexitank) na Programação
// de Carregamento e no Status de Entrega
const BAG_NUMBER_CLIENT_NAME = 'MANUPORT LIQUIDS DO BRASIL LTDA';

export default function LoadingSchedulePage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  // Dados para selects
  const [clients, setClients] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  // Modal de nova programação
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [saving, setSaving] = useState(false);

  // Formulário
  const [formData, setFormData] = useState({
    destination_client_id: '',
    destination_client_name: '',
    contracting_client_id: '',
    contracting_client_name: '',
    booking: '',
    voyage: '',
    observations: '',
    items: [createEmptyItem()]
  });

  // Modal de detalhes
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);

  // Estado de Seleção (toolbar)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  function createEmptyItem() {
    return {
      operation_type: 'COLETA',
      driver_id: '',
      driver_name: '',
      driver_cpf: '',
      cavalo_plate: '',
      carreta_plate: '',
      loading_location: '',
      loading_date: new Date().toISOString().split('T')[0],
      container_number: '',
      seal_number: '',
      bag_number: ''
    };
  }

  useEffect(() => {
    loadSchedules();
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

  const loadSchedules = async (search = '') => {
    setLoading(true);
    try {
      const params = { page: pagination.page, per_page: 15 };
      if (search) params.search = search;

      const response = await api.getLoadingSchedules(params);
      setSchedules(response.data.items);
      setPagination(prev => ({
        ...prev,
        pages: response.data.pages,
        total: response.data.total
      }));
    } catch (error) {
      toast.error('Erro ao carregar programações');
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setPagination(prev => ({ ...prev, page: 1 }));
    loadSchedules('');
  };

  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadSchedules(searchQuery);
  };

  const resetForm = () => {
    setFormData({
      destination_client_id: '',
      destination_client_name: '',
      contracting_client_id: '',
      contracting_client_name: '',
      booking: '',
      voyage: '',
      observations: '',
      items: [createEmptyItem()]
    });
    setEditingSchedule(null);
  };

  const openNewModal = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (schedule) => {
    setEditingSchedule(schedule);
    setFormData({
      destination_client_id: schedule.destination_client_id,
      destination_client_name: schedule.destination_client_name,
      contracting_client_id: schedule.contracting_client_id,
      contracting_client_name: schedule.contracting_client_name,
      booking: schedule.booking || '',
      voyage: schedule.voyage || '',
      observations: schedule.observations || '',
      items: schedule.items.length > 0 ? schedule.items : [createEmptyItem()]
    });
    setModalOpen(true);
  };

  const handleClientChange = (field, client) => {
    if (field === 'destination') {
      setFormData(prev => ({
        ...prev,
        destination_client_id: client.id,
        destination_client_name: client.name
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        contracting_client_id: client.id,
        contracting_client_name: client.name
      }));
    }
  };

  const handleDriverChange = (index, driverId) => {
    const driver = drivers.find(d => d.id === driverId);
    const newItems = [...formData.items];
    newItems[index] = {
      ...newItems[index],
      driver_id: driverId,
      driver_name: driver?.name || '',
      driver_cpf: driver?.cpf || ''
    };
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const handleItemChange = (index, field, value) => {
    // Usa a forma funcional do setState (lê `prev`, não `formData` do closure)
    // porque o Autocomplete dispara onChange + onSelect em sequência síncrona
    // ao clicar numa sugestão (ex: driver_id/driver_name/driver_cpf) - com
    // `formData.items` direto, cada chamada partia do mesmo estado desatualizado
    // e só o último campo alterado sobrevivia, apagando os anteriores.
    setFormData(prev => {
      const newItems = [...prev.items];
      newItems[index] = { ...newItems[index], [field]: value };
      return { ...prev, items: newItems };
    });
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, createEmptyItem()]
    }));
  };

  const removeItem = (index) => {
    if (formData.items.length === 1) {
      toast.error('A programação deve ter pelo menos um item');
      return;
    }
    const newItems = formData.items.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const handleSubmit = async () => {
    if (!formData.destination_client_id || !formData.contracting_client_id) {
      toast.error('Selecione os clientes de destino e contratante');
      return;
    }

    // Validar itens
    for (let i = 0; i < formData.items.length; i++) {
      const item = formData.items[i];
      if (!item.operation_type || !item.driver_name || !item.cavalo_plate || !item.loading_location || !item.loading_date) {
        toast.error(`Preencha os campos obrigatórios do item ${i + 1}`);
        return;
      }
    }

    setSaving(true);
    try {
      if (editingSchedule) {
        await api.updateLoadingSchedule(editingSchedule.id, formData);
        toast.success('Programação atualizada com sucesso!');
      } else {
        await api.createLoadingSchedule(formData);
        toast.success('Programação criada com sucesso!');
      }
      setModalOpen(false);
      resetForm();
      loadSchedules();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar programação');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Deseja realmente excluir esta programação?'))) return;

    try {
      await api.deleteLoadingSchedule(id);
      toast.success('Programação excluída');
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadSchedules();
    } catch (error) {
      toast.error('Erro ao excluir programação');
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
      const pageIds = schedules.map(s => s.id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  };

  const singleSelectedSchedule = selectedIds.size === 1
    ? schedules.find(s => s.id === [...selectedIds][0])
    : null;

  const handlePrintPDF = async (id) => {
    try {
      const response = await api.getLoadingSchedulePDF(id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `programacao_${id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    }
  };

  const openDetails = (schedule) => {
    setSelectedSchedule(schedule);
    setDetailModalOpen(true);
  };

  const getStatusBadge = (status) => {
    const tones = { ATIVO: 'emerald', CONCLUIDO: 'blue', CANCELADO: 'red' };
    const labels = { ATIVO: 'Ativo', CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado' };
    return <StatusPill tone={tones[status] || 'emerald'}>{labels[status] || status}</StatusPill>;
  };

  const cavalos = vehicles.filter(v => v.vehicle_type === 'CAVALO' || v.vehicle_type === 'CAMINHÃO');
  const carretas = vehicles.filter(v => v.vehicle_type === 'CARRETA');

  return (
    <Layout>
      <div className="space-y-4" data-testid="loading-schedule-page">
        <PageHeader icon={Calendar} title="Programação de Carregamento" subtitle="Gerencie as programações de carregamento" />

        <FilterCard hasFilters={!!searchQuery} onClear={clearSearch} onApply={handleSearch}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Cliente, motorista ou container">
              <SearchInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                data-testid="search-schedule-input"
              />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma programação pra habilitar as ações da barra */}
        <DataCard
          title="Programações"
          count={pagination.total}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova programação" onClick={openNewModal} testId="new-schedule-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedSchedule && openDetails(singleSelectedSchedule)} disabled={!singleSelectedSchedule} />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedSchedule && openEditModal(singleSelectedSchedule)} disabled={!singleSelectedSchedule} />
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedSchedule && handlePrintPDF(singleSelectedSchedule.id)} disabled={!singleSelectedSchedule} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedSchedule && handleDelete(singleSelectedSchedule.id)} disabled={!singleSelectedSchedule} />
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
          ) : schedules.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="Nenhuma programação encontrada"
              hint={searchQuery ? 'Ajuste a busca' : 'Cadastre a primeira pelo botão "Nova programação"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={schedules.length > 0 && schedules.every(s => selectedIds.has(s.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Nº</th>
                    <th>Cliente contratante</th>
                    <th>Cliente destino</th>
                    <th className="!text-right">Itens</th>
                    <th>Status</th>
                    <th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((schedule) => {
                    const isSelected = selectedIds.has(schedule.id);
                    return (
                      <tr
                        key={schedule.id}
                        data-selected={isSelected}
                        className="cursor-pointer"
                        onClick={() => toggleSelect(schedule.id)}
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(schedule.id)}
                          />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{schedule.schedule_number}</td>
                        <td><div className="max-w-[260px] truncate" title={schedule.contracting_client_name || ''}>{schedule.contracting_client_name}</div></td>
                        <td><div className="max-w-[260px] truncate" title={schedule.destination_client_name || ''}>{schedule.destination_client_name}</div></td>
                        <td className="text-right tabular-nums">{schedule.items?.length || 0}</td>
                        <td>{getStatusBadge(schedule.status)}</td>
                        <td className="whitespace-nowrap tabular-nums">
                          {schedule.created_at && format(new Date(schedule.created_at), 'dd/MM/yyyy', { locale: ptBR })}
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

      {/* Modal Nova/Editar Programação */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Calendar className="w-4 h-4 text-primary" />
              {editingSchedule ? 'Editar Programação' : 'Nova Programação de Carregamento'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Cabeçalho - Clientes */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Informações da Programação</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Cliente Contratante *</Label>
                  <Autocomplete
                    value={formData.contracting_client_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, contracting_client_name: val, contracting_client_id: '' }))}
                    options={clients}
                    displayField="name"
                    valueField="id"
                    onSelect={(client) => handleClientChange('contracting', client)}
                  />
                </div>
                <div>
                  <Label>Cliente Destino *</Label>
                  <Autocomplete
                    value={formData.destination_client_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, destination_client_name: val, destination_client_id: '' }))}
                    options={clients}
                    displayField="name"
                    valueField="id"
                    onSelect={(client) => handleClientChange('destination', client)}
                  />
                </div>
                <div>
                  <Label>Booking</Label>
                  <Input 
                    value={formData.booking} 
                    onChange={(e) => setFormData(prev => ({ ...prev, booking: e.target.value.toUpperCase() }))} 
                  />
                </div>
                <div>
                  <Label>Viagem</Label>
                  <Input
                    value={formData.voyage}
                    onChange={(e) => setFormData(prev => ({ ...prev, voyage: e.target.value.toUpperCase() }))}
                  />
                </div>
              </div>
            </div>

            {/* Itens da Programação */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Itens da Programação</h3>
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
                        <Label className="text-xs mb-1 block">Tipo *</Label>
                        <Select value={item.operation_type} onValueChange={(v) => handleItemChange(index, 'operation_type', v)}>
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="COLETA">Coleta</SelectItem>
                            <SelectItem value="ENTREGA">Entrega</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
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
                            handleItemChange(index, 'driver_cpf', driver.cpf || '');
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">CPF</Label>
                        <Input className="h-9" value={item.driver_cpf} onChange={(e) => handleItemChange(index, 'driver_cpf', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Cavalo *</Label>
                        <Autocomplete
                          value={item.cavalo_plate}
                          onChange={(val) => handleItemChange(index, 'cavalo_plate', val.toUpperCase())}
                          options={cavalos}
                          displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                          valueField="id"
                          onSelect={(vehicle) => {
                            handleItemChange(index, 'cavalo_plate', vehicle.plate);
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Carreta</Label>
                        <Autocomplete
                          value={item.carreta_plate}
                          onChange={(val) => handleItemChange(index, 'carreta_plate', val.toUpperCase())}
                          options={carretas}
                          displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                          valueField="id"
                          onSelect={(vehicle) => {
                            handleItemChange(index, 'carreta_plate', vehicle.plate);
                          }}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Label className="text-xs mb-1 block">Local de Carregamento *</Label>
                        <Input className="h-9" value={item.loading_location} onChange={(e) => handleItemChange(index, 'loading_location', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Data *</Label>
                        <Input className="h-9" type="date" value={item.loading_date} onChange={(e) => handleItemChange(index, 'loading_date', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Nº Container</Label>
                        <Input
                          className="h-9"
                          value={item.container_number}
                          onChange={(e) => handleItemChange(index, 'container_number', e.target.value.toUpperCase())}
                          onBlur={(e) => handleItemChange(index, 'container_number', formatContainerNumber(e.target.value))}
                        />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Lacre</Label>
                        <Input className="h-9" value={item.seal_number} onChange={(e) => handleItemChange(index, 'seal_number', e.target.value.toUpperCase())} />
                      </div>
                      {(formData.contracting_client_name === BAG_NUMBER_CLIENT_NAME || formData.destination_client_name === BAG_NUMBER_CLIENT_NAME) && (
                        <div>
                          <Label className="text-xs mb-1 block">Nº da Bolsa</Label>
                          <Input
                            className="h-9"
                            value={item.bag_number}
                            onChange={(e) => handleItemChange(index, 'bag_number', e.target.value)}
                            maxLength={30}
                            data-testid={`loading-schedule-bag-number-${index}`}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Observações */}
            <div>
              <Label>Observações</Label>
              <Input value={formData.observations} onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvando...' : (editingSchedule ? 'Salvar Alterações' : 'Criar Programação')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Programação #{selectedSchedule?.schedule_number}</DialogTitle>
          </DialogHeader>

          {selectedSchedule && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Cliente Contratante</p>
                  <p className="font-medium">{selectedSchedule.contracting_client_name}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Cliente Destino</p>
                  <p className="font-medium">{selectedSchedule.destination_client_name}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Booking</p>
                  <p className="font-medium">{selectedSchedule.booking || '-'}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Viagem</p>
                  <p className="font-medium">{selectedSchedule.voyage || '-'}</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Itens ({selectedSchedule.items?.length || 0})</h4>
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2">#</th>
                        <th className="text-left p-2">Tipo</th>
                        <th className="text-left p-2">Motorista</th>
                        <th className="text-left p-2">CPF</th>
                        <th className="text-left p-2">Cavalo</th>
                        <th className="text-left p-2">Carreta</th>
                        <th className="text-left p-2">Local</th>
                        <th className="text-left p-2">Data</th>
                        <th className="text-left p-2">Container</th>
                        <th className="text-left p-2">Lacre</th>
                        {selectedSchedule.items?.some(i => i.bag_number) && (
                          <th className="text-left p-2">Nº da Bolsa</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSchedule.items?.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{idx + 1}</td>
                          <td className="p-2">
                            {item.operation_type ? (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                item.operation_type === 'COLETA' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                              }`}>
                                {item.operation_type === 'COLETA' ? 'Coleta' : 'Entrega'}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="p-2">{item.driver_name}</td>
                          <td className="p-2">{item.driver_cpf || '-'}</td>
                          <td className="p-2 font-mono">{item.cavalo_plate}</td>
                          <td className="p-2 font-mono">{item.carreta_plate || '-'}</td>
                          <td className="p-2">{item.loading_location}</td>
                          <td className="p-2">{item.loading_date ? format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(item.loading_date) ? `${item.loading_date}T00:00:00` : item.loading_date), 'dd/MM/yyyy') : '-'}</td>
                          <td className="p-2 font-mono">{item.container_number || '-'}</td>
                          <td className="p-2 font-mono">{item.seal_number || '-'}</td>
                          {selectedSchedule.items?.some(i => i.bag_number) && (
                            <td className="p-2 font-mono">{item.bag_number || '-'}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedSchedule.observations && (
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Observações</p>
                  <p>{selectedSchedule.observations}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
            <Button onClick={() => handlePrintPDF(selectedSchedule?.id)}>
              <Printer className="w-4 h-4 mr-2" /> Gerar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
