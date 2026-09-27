import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, PlateTag, EmptyState, TablePagination,
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
import { Anchor, Plus, Eye, Trash2, Printer, Pencil } from 'lucide-react';
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

  const clearSearch = () => {
    setSearchQuery('');
    setPagination(prev => ({ ...prev, page: 1 }));
    loadServices('');
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
      <StatusPill tone={isConcluido ? 'emerald' : 'amber'}>
        {isConcluido ? 'Concluído' : 'No Pátio'}
      </StatusPill>
    );
  };

  const cavalos = vehicles.filter(v => v.vehicle_type === 'CAVALO' || v.vehicle_type === 'CAMINHÃO');

  return (
    <Layout>
      <div className="space-y-4" data-testid="port-service-page">
        <PageHeader icon={Anchor} title="Serviço Portuário" subtitle="Registre os serviços internos realizados dentro do porto" />

        <FilterCard hasFilters={!!searchQuery} onClear={clearSearch} onApply={handleSearch}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterField label="Cliente, motorista ou placa">
              <SearchInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                data-testid="search-port-service-input"
              />
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um serviço pra habilitar as ações da barra */}
        <DataCard
          title="Serviços portuários"
          count={pagination.total}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo serviço" onClick={openNewModal} testId="new-port-service-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedService && openDetails(singleSelectedService)} disabled={!singleSelectedService} />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedService && openEditModal(singleSelectedService)} disabled={!singleSelectedService} />
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedService && handlePrintPDF(singleSelectedService.id)} disabled={!singleSelectedService} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedService && handleDelete(singleSelectedService.id)} disabled={!singleSelectedService} />
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
          ) : services.length === 0 ? (
            <EmptyState
              icon={Anchor}
              title="Nenhum Serviço Portuário encontrado"
              hint={searchQuery ? 'Ajuste a busca' : 'Registre o primeiro pelo botão "Novo serviço"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={services.length > 0 && services.every(s => selectedIds.has(s.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Nº</th>
                    <th>Cliente</th>
                    <th>Motorista</th>
                    <th>Placa</th>
                    <th>Data</th>
                    <th>Turno</th>
                    <th>Situação</th>
                    <th className="!text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((service) => {
                    const isSelected = selectedIds.has(service.id);
                    return (
                      <tr
                        key={service.id}
                        data-selected={isSelected}
                        className="cursor-pointer"
                        onClick={() => toggleSelect(service.id)}
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(service.id)}
                          />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{service.service_number}</td>
                        <td><div className="max-w-[220px] truncate" title={service.client_name || ''}>{service.client_name}</div></td>
                        <td><div className="max-w-[200px] truncate" title={service.driver_name || ''}>{service.driver_name}</div></td>
                        <td><PlateTag>{service.cavalo_plate}</PlateTag></td>
                        <td className="whitespace-nowrap tabular-nums">
                          {service.service_date && format(new Date(service.service_date + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR })}
                        </td>
                        <td>
                          <StatusPill tone={service.turno === 'NOITE' ? 'violet' : 'amber'} dot={false}>
                            {service.turno === 'NOITE' ? 'Noite' : 'Dia'}
                          </StatusPill>
                        </td>
                        <td>{getSituacaoBadge(service.situacao)}</td>
                        <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtMoney(service.operation_value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
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
