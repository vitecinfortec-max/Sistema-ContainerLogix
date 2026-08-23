import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import { Calendar, Plus, Eye, Trash2, Search, Printer, Pencil, X, FileText } from 'lucide-react';
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
  }, [pagination.page]);

  const loadSelectData = async () => {
    try {
      const [clientsRes, driversRes, vehiclesRes] = await Promise.all([
        api.getClients(),
        api.getDrivers(),
        api.getVehicles({ per_page: 100 })
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
      loadSchedules();
    } catch (error) {
      toast.error('Erro ao excluir programação');
    }
  };

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
    const styles = {
      'ATIVO': 'bg-green-100 text-green-800',
      'CONCLUIDO': 'bg-blue-100 text-blue-800',
      'CANCELADO': 'bg-red-100 text-red-800'
    };
    const labels = {
      'ATIVO': 'Ativo',
      'CONCLUIDO': 'Concluído',
      'CANCELADO': 'Cancelado'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles['ATIVO']}`}>
        {labels[status] || status}
      </span>
    );
  };

  const cavalos = vehicles.filter(v => v.vehicle_type === 'CAVALO' || v.vehicle_type === 'CAMINHÃO');
  const carretas = vehicles.filter(v => v.vehicle_type === 'CARRETA');

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Programação de Carregamento</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Gerencie as programações de carregamento</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <Input
              placeholder="Buscar por cliente, motorista ou container..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              data-testid="search-schedule-input"
            />
            <Button variant="outline" onClick={handleSearch}>
              <Search className="w-4 h-4" />
            </Button>
          </div>
          <Button onClick={openNewModal} data-testid="new-schedule-btn">
            <Plus className="w-4 h-4 mr-2" />
            Nova Programação
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Programações ({pagination.total})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : schedules.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nenhuma programação encontrada
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-3 px-4 font-medium">Nº</th>
                      <th className="text-left py-3 px-4 font-medium">Cliente Contratante</th>
                      <th className="text-left py-3 px-4 font-medium">Cliente Destino</th>
                      <th className="text-left py-3 px-4 font-medium">Itens</th>
                      <th className="text-left py-3 px-4 font-medium">Status</th>
                      <th className="text-left py-3 px-4 font-medium">Criado em</th>
                      <th className="text-left py-3 px-4 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map(schedule => (
                      <tr key={schedule.id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-4 font-mono font-bold">#{schedule.schedule_number}</td>
                        <td className="py-3 px-4">{schedule.contracting_client_name}</td>
                        <td className="py-3 px-4">{schedule.destination_client_name}</td>
                        <td className="py-3 px-4">{schedule.items?.length || 0}</td>
                        <td className="py-3 px-4">{getStatusBadge(schedule.status)}</td>
                        <td className="py-3 px-4">
                          {schedule.created_at && format(new Date(schedule.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openDetails(schedule)} title="Ver detalhes">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openEditModal(schedule)} title="Editar">
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handlePrintPDF(schedule.id)} title="Gerar PDF">
                              <Printer className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(schedule.id)} title="Excluir" className="text-red-600 hover:text-red-700">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {pagination.pages > 1 && (
              <div className="flex justify-center gap-2 mt-4">
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

      {/* Modal Nova/Editar Programação */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
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
                    placeholder="Digite o nome do cliente contratante..."
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
                    placeholder="Digite o nome do cliente destino..."
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
                    placeholder="Número do Booking"
                  />
                </div>
                <div>
                  <Label>Viagem</Label>
                  <Input
                    value={formData.voyage}
                    onChange={(e) => setFormData(prev => ({ ...prev, voyage: e.target.value.toUpperCase() }))}
                    placeholder="Número da Viagem"
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
                        <Label className="text-xs">Tipo *</Label>
                        <Select value={item.operation_type} onValueChange={(v) => handleItemChange(index, 'operation_type', v)}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Coleta ou Entrega" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="COLETA">Coleta</SelectItem>
                            <SelectItem value="ENTREGA">Entrega</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Motorista *</Label>
                        <Autocomplete
                          value={item.driver_name}
                          onChange={(val) => handleItemChange(index, 'driver_name', val)}
                          options={drivers}
                          placeholder="Digite o nome..."
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
                        <Label className="text-xs">CPF</Label>
                        <Input className="h-9" value={item.driver_cpf} onChange={(e) => handleItemChange(index, 'driver_cpf', e.target.value)} placeholder="CPF" />
                      </div>
                      <div>
                        <Label className="text-xs">Cavalo *</Label>
                        <Autocomplete
                          value={item.cavalo_plate}
                          onChange={(val) => handleItemChange(index, 'cavalo_plate', val.toUpperCase())}
                          options={cavalos}
                          placeholder="Digite a placa..."
                          displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                          valueField="id"
                          onSelect={(vehicle) => {
                            handleItemChange(index, 'cavalo_plate', vehicle.plate);
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Carreta</Label>
                        <Autocomplete
                          value={item.carreta_plate}
                          onChange={(val) => handleItemChange(index, 'carreta_plate', val.toUpperCase())}
                          options={carretas}
                          placeholder="Digite a placa..."
                          displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                          valueField="id"
                          onSelect={(vehicle) => {
                            handleItemChange(index, 'carreta_plate', vehicle.plate);
                          }}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Label className="text-xs">Local de Carregamento *</Label>
                        <Input className="h-9" value={item.loading_location} onChange={(e) => handleItemChange(index, 'loading_location', e.target.value)} placeholder="Local de carregamento" />
                      </div>
                      <div>
                        <Label className="text-xs">Data *</Label>
                        <Input className="h-9" type="date" value={item.loading_date} onChange={(e) => handleItemChange(index, 'loading_date', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">Nº Container</Label>
                        <Input className="h-9" value={item.container_number} onChange={(e) => handleItemChange(index, 'container_number', e.target.value.toUpperCase())} placeholder="XXXX1234567" />
                      </div>
                      <div>
                        <Label className="text-xs">Lacre</Label>
                        <Input className="h-9" value={item.seal_number} onChange={(e) => handleItemChange(index, 'seal_number', e.target.value.toUpperCase())} placeholder="Nº do Lacre" />
                      </div>
                      {(formData.contracting_client_name === BAG_NUMBER_CLIENT_NAME || formData.destination_client_name === BAG_NUMBER_CLIENT_NAME) && (
                        <div>
                          <Label className="text-xs">Nº da Bolsa</Label>
                          <Input
                            className="h-9"
                            value={item.bag_number}
                            onChange={(e) => handleItemChange(index, 'bag_number', e.target.value)}
                            placeholder="Ex: 245250701171065"
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
              <Input value={formData.observations} onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))} placeholder="Observações adicionais" />
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
                          <td className="p-2">{item.loading_date ? format(new Date(item.loading_date), 'dd/MM/yyyy') : '-'}</td>
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
