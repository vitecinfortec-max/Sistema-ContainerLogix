import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
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
import { Anchor, Plus, Eye, Trash2, Search, Printer, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function createEmptyForm() {
  return {
    client_id: '',
    client_name: '',
    driver_id: '',
    driver_name: '',
    cavalo_plate: '',
    service_date: new Date().toISOString().split('T')[0],
    turno: 'DIA',
    entry_time: '',
    exit_time: '',
    operation_value: '',
    observations: '',
  };
}

export default function PortServicePage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  // Dados para os Autocomplete
  const [clients, setClients] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  // Modal de novo/editar registro
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(createEmptyForm());

  // Modal de detalhes
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState(null);

  // Estado de Seleção (toolbar)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  useEffect(() => {
    loadServices();
    loadSelectData();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page]);

  const loadSelectData = async () => {
    try {
      // per_page explícito: get_clients tem default per_page=100 e
      // get_vehicles default per_page=20 - sem isso a lista de sugestões do
      // Autocomplete fica truncada em clientes/frota com mais cadastros.
      const [clientsRes, driversRes, vehiclesRes] = await Promise.all([
        api.getClients({ per_page: 1000 }),
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

  const loadServices = async (search = '') => {
    setLoading(true);
    try {
      const params = { page: pagination.page, per_page: 15 };
      if (search) params.search = search;

      const response = await api.getPortServices(params);
      setServices(response.data.items);
      setPagination(prev => ({
        ...prev,
        pages: response.data.pages,
        total: response.data.total
      }));
    } catch (error) {
      toast.error('Erro ao carregar serviços portuários');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadServices(searchQuery);
  };

  const resetForm = () => {
    setFormData(createEmptyForm());
    setEditingService(null);
  };

  const openNewModal = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (service) => {
    setEditingService(service);
    setFormData({
      client_id: service.client_id,
      client_name: service.client_name,
      driver_id: service.driver_id || '',
      driver_name: service.driver_name,
      cavalo_plate: service.cavalo_plate,
      service_date: service.service_date,
      turno: service.turno,
      entry_time: service.entry_time || '',
      exit_time: service.exit_time || '',
      operation_value: service.operation_value,
      observations: service.observations || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.client_id || !formData.driver_name || !formData.cavalo_plate || !formData.service_date || !formData.operation_value) {
      toast.error('Preencha Cliente, Motorista, Placa do Cavalo, Data e Valor da Operação');
      return;
    }

    const payload = { ...formData, operation_value: Number(formData.operation_value) };

    setSaving(true);
    try {
      if (editingService) {
        await api.updatePortService(editingService.id, payload);
        toast.success('Serviço Portuário atualizado com sucesso!');
      } else {
        await api.createPortService(payload);
        toast.success('Serviço Portuário criado com sucesso!');
      }
      setModalOpen(false);
      resetForm();
      loadServices();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar Serviço Portuário');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Deseja realmente excluir este Serviço Portuário?'))) return;

    try {
      await api.deletePortService(id);
      toast.success('Serviço Portuário excluído');
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadServices();
    } catch (error) {
      toast.error('Erro ao excluir Serviço Portuário');
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
      const pageIds = services.map(s => s.id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  };

  const singleSelectedService = selectedIds.size === 1
    ? services.find(s => s.id === [...selectedIds][0])
    : null;

  const handlePrintPDF = async (id) => {
    try {
      const response = await api.getPortServicePDF(id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `servico_portuario_${id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    }
  };

  const openDetails = (service) => {
    setSelectedService(service);
    setDetailModalOpen(true);
  };

  const getSituacaoBadge = (situacao) => {
    const isConcluido = situacao === 'CONCLUIDO';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${isConcluido ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
        {isConcluido ? 'Concluído' : 'No Pátio'}
      </span>
    );
  };

  const cavalos = vehicles.filter(v => v.vehicle_type === 'CAVALO' || v.vehicle_type === 'CAMINHÃO');

  return (
    <Layout>
      <div className="space-y-5" data-testid="port-service-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Serviço Portuário</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Registre os serviços internos realizados dentro do porto</p>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            <div className="grid grid-cols-1 sm:max-w-sm gap-3">
              <div>
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Cliente, motorista ou placa</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    className="h-9 text-sm pl-8"
                    data-testid="search-port-service-input"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={handleSearch} className="h-8 text-xs font-medium bg-primary hover:bg-primary/90">
                Filtrar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openNewModal}
            className="h-9 w-9 p-0"
            title="Novo Serviço Portuário"
            data-testid="new-port-service-btn"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedService && openDetails(singleSelectedService)}
            disabled={!singleSelectedService}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Ver Detalhes"
          >
            <Eye className="w-4 h-4 text-primary" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedService && openEditModal(singleSelectedService)}
            disabled={!singleSelectedService}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Editar"
          >
            <Pencil className="w-4 h-4 text-blue-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedService && handlePrintPDF(singleSelectedService.id)}
            disabled={!singleSelectedService}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Baixar PDF"
          >
            <Printer className="w-4 h-4 text-emerald-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelectedService && handleDelete(singleSelectedService.id)}
            disabled={!singleSelectedService}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Excluir"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
          {selectedIds.size > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 pr-1">
              {selectedIds.size} selecionado(s)
            </span>
          )}
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Anchor className="w-4 h-4" />
              Serviços Portuários ({pagination.total})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : services.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                Nenhum Serviço Portuário encontrado
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left w-10">
                        <Checkbox
                          checked={services.length > 0 && services.every(s => selectedIds.has(s.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Motorista</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Placa</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Turno</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Situação</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((service, idx) => {
                      const isSelected = selectedIds.has(service.id);
                      return (
                        <tr
                          key={service.id}
                          className={`cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 hover:bg-primary/15' : `hover:bg-slate-50 dark:hover:bg-slate-800/80 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}`}
                          onClick={() => toggleSelect(service.id)}
                        >
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(service.id)}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{service.service_number}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{service.client_name}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{service.driver_name}</td>
                          <td className="px-4 py-2.5 text-sm font-mono text-slate-600 dark:text-slate-400">{service.cavalo_plate}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                            {service.service_date && format(new Date(service.service_date + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR })}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{service.turno === 'NOITE' ? 'Noite' : 'Dia'}</td>
                          <td className="px-4 py-2.5">{getSituacaoBadge(service.situacao)}</td>
                          <td className="px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">{fmtMoney(service.operation_value)}</td>
                        </tr>
                      );
                    })}
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

      {/* Modal Novo/Editar Serviço Portuário */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Anchor className="w-4 h-4 text-primary" />
              {editingService ? 'Editar Serviço Portuário' : 'Novo Serviço Portuário'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Cliente *</Label>
                <Autocomplete
                  value={formData.client_name}
                  onChange={(val) => setFormData(prev => ({ ...prev, client_name: val, client_id: '' }))}
                  options={clients}
                  displayField="name"
                  valueField="id"
                  onSelect={(client) => setFormData(prev => ({ ...prev, client_id: client.id, client_name: client.name }))}
                />
              </div>
              <div>
                <Label>Nome do Motorista *</Label>
                <Autocomplete
                  value={formData.driver_name}
                  onChange={(val) => setFormData(prev => ({ ...prev, driver_name: val, driver_id: '' }))}
                  options={drivers}
                  displayField="name"
                  valueField="id"
                  onSelect={(driver) => setFormData(prev => ({ ...prev, driver_id: driver.id, driver_name: driver.name }))}
                />
              </div>
              <div>
                <Label>Placa do Cavalo *</Label>
                <Autocomplete
                  value={formData.cavalo_plate}
                  onChange={(val) => setFormData(prev => ({ ...prev, cavalo_plate: val.toUpperCase() }))}
                  options={cavalos}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  valueField="id"
                  onSelect={(vehicle) => setFormData(prev => ({ ...prev, cavalo_plate: vehicle.plate }))}
                />
              </div>
              <div>
                <Label>Turno *</Label>
                <Select value={formData.turno} onValueChange={(v) => setFormData(prev => ({ ...prev, turno: v }))}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DIA">Dia</SelectItem>
                    <SelectItem value="NOITE">Noite</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Data do Serviço *</Label>
                <Input
                  type="date"
                  className="h-9"
                  value={formData.service_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, service_date: e.target.value }))}
                />
              </div>
              <div>
                <Label>Valor da Operação (R$) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-9 font-mono"
                  value={formData.operation_value}
                  onChange={(e) => setFormData(prev => ({ ...prev, operation_value: e.target.value }))}
                  data-testid="port-service-value-input"
                />
              </div>
              <div>
                <Label>Horário de Entrada</Label>
                <Input
                  type="time"
                  className="h-9"
                  value={formData.entry_time}
                  onChange={(e) => setFormData(prev => ({ ...prev, entry_time: e.target.value }))}
                />
              </div>
              <div>
                <Label>Horário de Saída</Label>
                <Input
                  type="time"
                  className="h-9"
                  value={formData.exit_time}
                  onChange={(e) => setFormData(prev => ({ ...prev, exit_time: e.target.value }))}
                />
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
              {saving ? 'Salvando...' : (editingService ? 'Salvar Alterações' : 'Criar Registro')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Serviço Portuário #{selectedService?.service_number}</DialogTitle>
          </DialogHeader>

          {selectedService && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Cliente</p>
                  <p className="font-medium">{selectedService.client_name}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Motorista</p>
                  <p className="font-medium">{selectedService.driver_name}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Placa do Cavalo</p>
                  <p className="font-medium font-mono">{selectedService.cavalo_plate}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Data do Serviço</p>
                  <p className="font-medium">{selectedService.service_date && format(new Date(selectedService.service_date + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR })}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Turno</p>
                  <p className="font-medium">{selectedService.turno === 'NOITE' ? 'Noite' : 'Dia'}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Situação</p>
                  <p className="font-medium">{getSituacaoBadge(selectedService.situacao)}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Horário de Entrada</p>
                  <p className="font-medium">{selectedService.entry_time || '-'}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Horário de Saída</p>
                  <p className="font-medium">{selectedService.exit_time || '-'}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded col-span-2">
                  <p className="text-sm text-muted-foreground">Valor da Operação</p>
                  <p className="font-medium">{fmtMoney(selectedService.operation_value)}</p>
                </div>
              </div>

              {selectedService.observations && (
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Observações</p>
                  <p>{selectedService.observations}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
            <Button onClick={() => handlePrintPDF(selectedService?.id)}>
              <Printer className="w-4 h-4 mr-2" /> Gerar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
