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
import { ClipboardCheck, Plus, Eye, Trash2, Search, Printer, Pencil, X, FileText, Clock, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Cliente para o qual exibimos o campo "Nº da Bolsa" (flexitank)
const BAG_NUMBER_CLIENT_NAME = 'MANUPORT LIQUIDS DO BRASIL LTDA';

export default function DeliveryStatusPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  // Modal de novo status
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  // Dados da programação buscada
  const [scheduleData, setScheduleData] = useState(null);
  const [scheduleSearchNumber, setScheduleSearchNumber] = useState('');
  const [searchingSchedule, setSearchingSchedule] = useState(false);

  // Formulário
  const [formData, setFormData] = useState({
    schedule_number: '',
    status_date: new Date().toISOString().split('T')[0],
    items: [],
    observations: ''
  });

  // Modal de detalhes
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(null);

  useEffect(() => {
    loadStatuses();
  }, [pagination.page]);

  const loadStatuses = async () => {
    try {
      const response = await api.getDeliveryStatuses({ page: pagination.page, per_page: 20 });
      setStatuses(response.data.items);
      setPagination(prev => ({ ...prev, pages: response.data.pages, total: response.data.total }));
    } catch (error) {
      toast.error('Erro ao carregar status de entrega');
    } finally {
      setLoading(false);
    }
  };

  const searchSchedule = async () => {
    if (!scheduleSearchNumber) {
      toast.error('Digite o número da programação');
      return;
    }
    
    setSearchingSchedule(true);
    try {
      const response = await api.getScheduleForDeliveryStatus(scheduleSearchNumber);
      const schedule = response.data;
      setScheduleData(schedule);
      
      // Preencher itens com dados da programação + campos de horário vazios
      const items = schedule.items.map(item => ({
        driver_id: item.driver_id,
        driver_name: item.driver_name,
        driver_cpf: item.driver_cpf,
        cavalo_plate: item.cavalo_plate,
        carreta_plate: item.carreta_plate,
        container_number: item.container_number,
        loading_location: item.loading_location,
        bag_number: item.bag_number || '',
        port_schedule_time: '',
        arrival_time: '',
        loading_start_time: '',
        loading_end_time: '',
        departure_time: '',
        delivery_completed: ''
      }));

      setFormData(prev => ({
        ...prev,
        schedule_number: schedule.schedule_number,
        items
      }));
      
      toast.success(`Programação Nº ${schedule.schedule_number} carregada com ${items.length} motorista(s)`);
    } catch (error) {
      toast.error('Programação não encontrada');
      setScheduleData(null);
    } finally {
      setSearchingSchedule(false);
    }
  };

  const handleSubmit = async () => {
    if (!scheduleData && !editingStatus) {
      toast.error('Busque uma programação primeiro');
      return;
    }
    
    if (formData.items.length === 0) {
      toast.error('Nenhum item para salvar');
      return;
    }
    
    setSaving(true);
    try {
      if (editingStatus) {
        await api.updateDeliveryStatus(editingStatus.id, formData);
        toast.success('Status de entrega atualizado!');
      } else {
        await api.createDeliveryStatus(formData);
        toast.success('Status de entrega criado!');
      }
      setModalOpen(false);
      resetForm();
      loadStatuses();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      schedule_number: '',
      status_date: new Date().toISOString().split('T')[0],
      items: [],
      observations: ''
    });
    setScheduleData(null);
    setScheduleSearchNumber('');
    setEditingStatus(null);
  };

  const openEditModal = async (status) => {
    setEditingStatus(status);
    setScheduleData({
      schedule_number: status.schedule_number,
      destination_client_name: status.destination_client_name,
      contracting_client_name: status.contracting_client_name,
      booking: status.booking,
      voyage: status.voyage
    });
    setFormData({
      schedule_number: status.schedule_number,
      status_date: status.status_date,
      items: status.items,
      observations: status.observations || ''
    });
    setModalOpen(true);
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir este status de entrega?'))) return;
    try {
      await api.deleteDeliveryStatus(id);
      toast.success('Status de entrega excluído!');
      loadStatuses();
    } catch (error) {
      toast.error('Erro ao excluir');
    }
  };

  const handlePrint = async (id) => {
    try {
      const response = await api.getDeliveryStatusPDF(id);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `status_entrega_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    }
  };

  const handleExcel = async (id) => {
    try {
      const response = await api.getDeliveryStatusExcel(id);
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `status_entrega_${id}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar Excel');
    }
  };

  const viewDetails = (status) => {
    setSelectedStatus(status);
    setDetailModalOpen(true);
  };

  const updateItemTime = (index, field, value) => {
    setFormData(prev => {
      const newItems = [...prev.items];
      newItems[index] = { ...newItems[index], [field]: value };
      return { ...prev, items: newItems };
    });
  };

  const getShortName = (fullName) => {
    if (!fullName) return '-';
    const parts = fullName.trim().split(' ');
    const preposicoes = ['DE', 'DA', 'DO', 'DOS', 'DAS', 'E'];
    const nomes = parts.filter(p => !preposicoes.includes(p.toUpperCase()));
    if (nomes.length >= 2) return `${nomes[0]} ${nomes[1]}`;
    return nomes[0] || parts[0] || '-';
  };

  return (
    <Layout>
      <div className="space-y-5" data-testid="delivery-status-page">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Status de Entrega</h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Controle de horários de entrega por programação</p>
          </div>
          <Button
            onClick={() => { resetForm(); setModalOpen(true); }}
            className="text-[13px] font-semibold uppercase tracking-wide h-10 px-5 bg-primary hover:bg-primary/90"
            data-testid="new-delivery-status-btn"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Novo Status
          </Button>
        </div>

        {/* Filtros */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-[13px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Search className="w-4 h-4" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex gap-3 items-end">
              <div className="flex-1 max-w-xs">
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Nº Programação</Label>
                <Input
                  type="number"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 text-sm"
                  data-testid="search-schedule-number"
                />
              </div>
              <Button size="sm" className="h-9 text-xs font-medium" onClick={() => {
                setPagination(prev => ({ ...prev, page: 1 }));
                loadStatuses();
              }}>
                <Search className="w-4 h-4 mr-1" />
                Buscar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Lista */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4" />
                Status de Entrega ({pagination.total})
              </span>
              {pagination.pages > 1 && (
                <span className="text-xs font-normal text-slate-400 dark:text-slate-500">Página {pagination.page} de {pagination.pages}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
            ) : statuses.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Nenhum status de entrega encontrado</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Prog. Ref.</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente Destino</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Motoristas</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statuses.map((status, idx) => (
                      <tr key={status.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}>
                        <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{status.status_number}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">Prog. #{status.schedule_number}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                          {status.status_date ? format(new Date(status.status_date + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{status.destination_client_name}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{status.items?.length || 0}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                            status.status === 'CONCLUIDO' ? 'bg-green-100 text-green-800' :
                            status.status === 'CANCELADO' ? 'bg-red-100 text-red-800' :
                            'bg-blue-100 text-blue-800'
                          }`}>
                            {status.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-0.5">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => viewDetails(status)} title="Ver detalhes">
                              <Eye className="w-3.5 h-3.5 text-primary" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditModal(status)} title="Editar">
                              <Pencil className="w-3.5 h-3.5 text-blue-600" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handlePrint(status.id)} title="Imprimir PDF">
                              <Printer className="w-3.5 h-3.5 text-green-600" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleExcel(status.id)} title="Baixar Excel">
                              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDelete(status.id)} title="Excluir">
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Paginação */}
            {pagination.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs text-slate-400 dark:text-slate-500">Página {pagination.page} de {pagination.pages}</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagination.page === 1} onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}>
                    Anterior
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagination.page === pagination.pages} onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}>
                    Próximo
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal Criar/Editar */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) resetForm(); setModalOpen(open); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              {editingStatus ? 'Editar Status de Entrega' : 'Novo Status de Entrega'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Buscar Programação */}
            {!editingStatus && (
              <div className="p-4 border rounded-lg bg-slate-50 dark:bg-slate-800">
                <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 block">Buscar Programação de Carregamento</Label>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Nº Programação</Label>
                    <Input
                      type="number"
                      value={scheduleSearchNumber}
                      onChange={(e) => setScheduleSearchNumber(e.target.value)}
                      className="h-9"
                      data-testid="schedule-search-input"
                    />
                  </div>
                  <Button onClick={searchSchedule} disabled={searchingSchedule} className="h-9">
                    <Search className="w-4 h-4 mr-2" />
                    {searchingSchedule ? 'Buscando...' : 'Buscar'}
                  </Button>
                </div>
              </div>
            )}

            {/* Dados da Programação */}
            {scheduleData && (
              <div className="p-4 border rounded-lg bg-green-50 border-green-200">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-semibold text-green-800">Programação Nº {scheduleData.schedule_number}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Cliente Contratante:</span>
                    <span className="ml-2 font-medium">{scheduleData.contracting_client_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Cliente Destino:</span>
                    <span className="ml-2 font-medium">{scheduleData.destination_client_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Booking:</span>
                    <span className="ml-2 font-medium">{scheduleData.booking || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Viagem:</span>
                    <span className="ml-2 font-medium">{scheduleData.voyage || '-'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Data do Status */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Data do Status</Label>
                <Input
                  type="date"
                  value={formData.status_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, status_date: e.target.value }))}
                  className="h-9"
                  data-testid="status-date-input"
                />
              </div>
            </div>

            {/* Lista de Motoristas com Horários */}
            {formData.items.length > 0 && (
              <div className="space-y-4">
                <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Horários de Entrega por Motorista</Label>
                
                {formData.items.map((item, index) => (
                  <div key={index} className="p-4 border rounded-lg bg-white dark:bg-slate-900">
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                      <span className="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center font-semibold">{index + 1}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{getShortName(item.driver_name)}</span>
                      <span className="text-slate-400 dark:text-slate-500">|</span>
                      <span className="text-sm text-slate-500 dark:text-slate-400">{item.cavalo_plate}</span>
                      {item.container_number && (
                        <>
                          <span className="text-slate-400 dark:text-slate-500">|</span>
                          <span className="text-sm text-slate-500 dark:text-slate-400">{item.container_number}</span>
                        </>
                      )}
                    </div>

                    {(scheduleData?.contracting_client_name === BAG_NUMBER_CLIENT_NAME || scheduleData?.destination_client_name === BAG_NUMBER_CLIENT_NAME) && (
                      <div className="mb-3 max-w-xs">
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Nº da Bolsa</Label>
                        <Input
                          value={item.bag_number || ''}
                          onChange={(e) => updateItemTime(index, 'bag_number', e.target.value)}
                          maxLength={30}
                          className="h-8 text-sm"
                          data-testid={`delivery-status-bag-number-${index}`}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-6 gap-3">
                      <div>
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">
                          <Clock className="w-3 h-3 inline mr-1" />
                          Chegada Cliente
                        </Label>
                        <Input
                          type="time"
                          value={item.arrival_time || ''}
                          onChange={(e) => updateItemTime(index, 'arrival_time', e.target.value)}
                          className="h-8 text-sm"
                          data-testid={`arrival-time-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">
                          <Clock className="w-3 h-3 inline mr-1" />
                          Início Carreg.
                        </Label>
                        <Input
                          type="time"
                          value={item.loading_start_time || ''}
                          onChange={(e) => updateItemTime(index, 'loading_start_time', e.target.value)}
                          className="h-8 text-sm"
                          data-testid={`loading-start-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">
                          <Clock className="w-3 h-3 inline mr-1" />
                          Término Carreg.
                        </Label>
                        <Input
                          type="time"
                          value={item.loading_end_time || ''}
                          onChange={(e) => updateItemTime(index, 'loading_end_time', e.target.value)}
                          className="h-8 text-sm"
                          data-testid={`loading-end-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">
                          <Clock className="w-3 h-3 inline mr-1" />
                          Saída Cliente
                        </Label>
                        <Input
                          type="time"
                          value={item.departure_time || ''}
                          onChange={(e) => updateItemTime(index, 'departure_time', e.target.value)}
                          className="h-8 text-sm"
                          data-testid={`departure-time-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">
                          <Clock className="w-3 h-3 inline mr-1" />
                          Agend. Porto
                        </Label>
                        <Input
                          type="time"
                          value={item.port_schedule_time || ''}
                          onChange={(e) => updateItemTime(index, 'port_schedule_time', e.target.value)}
                          className="h-8 text-sm"
                          data-testid={`port-schedule-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">
                          <Clock className="w-3 h-3 inline mr-1" />
                          Entrega Final.
                        </Label>
                        <Input
                          type="time"
                          value={item.delivery_completed || ''}
                          onChange={(e) => updateItemTime(index, 'delivery_completed', e.target.value)}
                          className="h-8 text-sm"
                          data-testid={`delivery-completed-${index}`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Observações */}
            <div>
              <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Observações</Label>
              <textarea
                className="w-full h-20 p-3 border rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                value={formData.observations}
                onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))}
                data-testid="observations-input"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setModalOpen(false); }}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving || formData.items.length === 0}>
              {saving ? 'Salvando...' : editingStatus ? 'Atualizar' : 'Criar Status'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              Status de Entrega #{selectedStatus?.status_number}
            </DialogTitle>
          </DialogHeader>

          {selectedStatus && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Programação Ref.</span>
                  <span className="text-sm font-semibold">Nº {selectedStatus.schedule_number}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Data do Status</span>
                  <span className="text-sm">{selectedStatus.status_date ? format(new Date(selectedStatus.status_date + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR }) : '-'}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Cliente Contratante</span>
                  <span className="text-sm">{selectedStatus.contracting_client_name}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block">Cliente Destino</span>
                  <span className="text-sm">{selectedStatus.destination_client_name}</span>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Horários por Motorista</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">#</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Motorista</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Placa</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Container</th>
                        <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Chegada</th>
                        <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Início</th>
                        <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Término</th>
                        <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Saída</th>
                        <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Agend. Porto</th>
                        <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Entrega Final.</th>
                        {selectedStatus.items?.some(i => i.bag_number) && (
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº da Bolsa</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStatus.items?.map((item, idx) => (
                        <tr key={idx} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 font-semibold">{idx + 1}</td>
                          <td className="px-3 py-2">{getShortName(item.driver_name)}</td>
                          <td className="px-3 py-2 font-mono">{item.cavalo_plate}</td>
                          <td className="px-3 py-2">{item.container_number || '-'}</td>
                          <td className="px-3 py-2 text-center">{item.arrival_time || '-'}</td>
                          <td className="px-3 py-2 text-center">{item.loading_start_time || '-'}</td>
                          <td className="px-3 py-2 text-center">{item.loading_end_time || '-'}</td>
                          <td className="px-3 py-2 text-center">{item.departure_time || '-'}</td>
                          <td className="px-3 py-2 text-center">{item.port_schedule_time || '-'}</td>
                          <td className="px-3 py-2 text-center">{item.delivery_completed || '-'}</td>
                          {selectedStatus.items?.some(i => i.bag_number) && (
                            <td className="px-3 py-2 font-mono">{item.bag_number || '-'}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedStatus.observations && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block mb-1">Observações</span>
                  <span className="text-sm">{selectedStatus.observations}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
            <Button variant="outline" onClick={() => { handleExcel(selectedStatus.id); }}>
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Baixar Excel
            </Button>
            <Button onClick={() => { handlePrint(selectedStatus.id); }}>
              <Printer className="w-4 h-4 mr-2" />
              Imprimir PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
