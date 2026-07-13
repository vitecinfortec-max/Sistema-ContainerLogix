import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Truck, Wrench, Plus, Eye, Trash2, FileText, Search, Printer, Pencil, Car } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function FleetPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(tabFromUrl === 'revisions' ? 'revisions' : 'vehicles');
  
  // Atualizar aba quando URL mudar
  useEffect(() => {
    if (tabFromUrl === 'revisions') {
      setActiveTab('revisions');
    } else {
      setActiveTab('vehicles');
    }
  }, [tabFromUrl]);
  
  // ========== REVISÕES ==========
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchPlate, setSearchPlate] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  
  // Modal de nova revisão
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    vehicle_type_revision: 'CAVALO', // CAVALO ou CARRETA
    vehicle_plate: '',
    vehicle_model: '',
    revision_date: new Date().toISOString().split('T')[0],
    oil_used: '',
    current_km: '',
    next_oil_motor_km: '',
    next_oil_filter_km: '',
    next_air_filter_km: '',
    next_ac_filter_km: '',
    next_fuel_filter_km: '',
    next_racor_filter_km: '',
    next_apu_filter_km: '',
    next_hydraulic_filter_km: '',
    next_gearbox_oil_km: '',
    next_differential_oil_km: '',
    next_lubrication_km: '',
    next_washing_km: '',
    mechanic_name: '',
    performed_by: '',
    observations: '',
    // Campos específicos para Carreta
    carreta_revision_type: ''
  });

  // Modal de detalhes
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedRevision, setSelectedRevision] = useState(null);

  // ========== VEÍCULOS ==========
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehiclePagination, setVehiclePagination] = useState({ page: 1, pages: 1, total: 0 });
  
  // Modal de veículo
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({
    plate: '',
    model: '',
    brand: '',
    year: '',
    vehicle_type: '',
    status: 'ATIVO',
    observations: ''
  });

  const vehicleTypes = [
    { value: 'CAMINHÃO', label: 'Caminhão' },
    { value: 'CARRETA', label: 'Carreta' },
    { value: 'CAVALO', label: 'Cavalo Mecânico' },
    { value: 'EMPILHADEIRA', label: 'Empilhadeira' },
    { value: 'GUINDASTE', label: 'Guindaste' },
    { value: 'REACH_STACKER', label: 'Reach Stacker' },
    { value: 'EQUIPAMENTO', label: 'Outro Equipamento' },
  ];

  const statusOptions = [
    { value: 'ATIVO', label: 'Ativo' },
    { value: 'INATIVO', label: 'Inativo' },
    { value: 'MANUTENCAO', label: 'Em Manutenção' },
  ];

  useEffect(() => {
    if (activeTab === 'revisions') {
      loadRevisions();
    } else if (activeTab === 'vehicles') {
      loadVehicles();
    }
  }, [activeTab, pagination.page, vehiclePagination.page]);

  // ========== FUNÇÕES DE VEÍCULOS ==========
  const loadVehicles = async (search = '') => {
    setVehiclesLoading(true);
    try {
      const params = { page: vehiclePagination.page, per_page: 15 };
      if (search) params.search = search;
      
      const response = await api.getVehicles(params);
      setVehicles(response.data.items);
      setVehiclePagination(prev => ({
        ...prev,
        pages: response.data.pages,
        total: response.data.total
      }));
    } catch (error) {
      toast.error('Erro ao carregar veículos');
    } finally {
      setVehiclesLoading(false);
    }
  };

  const handleVehicleSearch = () => {
    setVehiclePagination(prev => ({ ...prev, page: 1 }));
    loadVehicles(vehicleSearch);
  };

  const handleVehicleFormChange = (field, value) => {
    setVehicleForm(prev => ({ ...prev, [field]: value }));
  };

  const resetVehicleForm = () => {
    setVehicleForm({
      plate: '',
      model: '',
      brand: '',
      year: '',
      vehicle_type: '',
      status: 'ATIVO',
      observations: ''
    });
    setEditingVehicle(null);
  };

  const openNewVehicleModal = () => {
    resetVehicleForm();
    setVehicleModalOpen(true);
  };

  const openEditVehicleModal = (vehicle) => {
    setEditingVehicle(vehicle);
    setVehicleForm({
      plate: vehicle.plate || '',
      model: vehicle.model || '',
      brand: vehicle.brand || '',
      year: vehicle.year?.toString() || '',
      vehicle_type: vehicle.vehicle_type || '',
      status: vehicle.status || 'ATIVO',
      observations: vehicle.observations || ''
    });
    setVehicleModalOpen(true);
  };

  const handleVehicleSubmit = async () => {
    if (!vehicleForm.plate || !vehicleForm.vehicle_type) {
      toast.error('Preencha os campos obrigatórios (Placa e Tipo)');
      return;
    }

    setVehicleSaving(true);
    try {
      const data = {
        plate: vehicleForm.plate.toUpperCase(),
        model: vehicleForm.model || null,
        brand: vehicleForm.brand || null,
        year: vehicleForm.year ? parseInt(vehicleForm.year) : null,
        vehicle_type: vehicleForm.vehicle_type,
        status: vehicleForm.status,
        observations: vehicleForm.observations || null
      };

      if (editingVehicle) {
        await api.updateVehicle(editingVehicle.id, data);
        toast.success('Veículo atualizado com sucesso!');
      } else {
        await api.createVehicle(data);
        toast.success('Veículo cadastrado com sucesso!');
      }
      
      setVehicleModalOpen(false);
      resetVehicleForm();
      loadVehicles();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar veículo');
    } finally {
      setVehicleSaving(false);
    }
  };

  const handleDeleteVehicle = async (id) => {
    if (!confirm('Deseja realmente excluir este veículo?')) return;
    
    try {
      await api.deleteVehicle(id);
      toast.success('Veículo excluído');
      loadVehicles();
    } catch (error) {
      toast.error('Erro ao excluir veículo');
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      'ATIVO': 'bg-green-100 text-green-800',
      'INATIVO': 'bg-gray-100 text-gray-800',
      'MANUTENCAO': 'bg-yellow-100 text-yellow-800',
    };
    const labels = {
      'ATIVO': 'Ativo',
      'INATIVO': 'Inativo',
      'MANUTENCAO': 'Manutenção',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles['ATIVO']}`}>
        {labels[status] || status}
      </span>
    );
  };

  // ========== FUNÇÕES DE REVISÕES ==========
  const loadRevisions = async (plate = '') => {
    setLoading(true);
    try {
      const params = { page: pagination.page, per_page: 15 };
      if (plate) params.vehicle_plate = plate;
      
      const response = await api.getVehicleRevisions(params);
      setRevisions(response.data.items);
      setPagination(prev => ({
        ...prev,
        pages: response.data.pages,
        total: response.data.total
      }));
    } catch (error) {
      toast.error('Erro ao carregar revisões');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadRevisions(searchPlate);
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setFormData({
      vehicle_type_revision: 'CAVALO',
      vehicle_plate: '',
      vehicle_model: '',
      revision_date: new Date().toISOString().split('T')[0],
      oil_used: '',
      current_km: '',
      next_oil_motor_km: '',
      next_oil_filter_km: '',
      next_air_filter_km: '',
      next_ac_filter_km: '',
      next_fuel_filter_km: '',
      next_racor_filter_km: '',
      next_apu_filter_km: '',
      next_hydraulic_filter_km: '',
      next_gearbox_oil_km: '',
      next_differential_oil_km: '',
      next_lubrication_km: '',
      next_washing_km: '',
      mechanic_name: '',
      performed_by: '',
      observations: '',
      carreta_revision_type: ''
    });
  };

  const handleSubmit = async () => {
    // Validação diferenciada por tipo
    if (formData.vehicle_type_revision === 'CAVALO') {
      if (!formData.vehicle_plate || !formData.oil_used || !formData.current_km || !formData.mechanic_name) {
        toast.error('Preencha os campos obrigatórios');
        return;
      }
    } else {
      // Carreta
      if (!formData.vehicle_plate || !formData.carreta_revision_type || !formData.mechanic_name) {
        toast.error('Preencha os campos obrigatórios (Placa, Tipo de Revisão, Mecânico)');
        return;
      }
    }

    setSaving(true);
    try {
      let data;
      
      if (formData.vehicle_type_revision === 'CAVALO') {
        data = {
          vehicle_type_revision: 'CAVALO',
          vehicle_plate: formData.vehicle_plate.toUpperCase(),
          vehicle_model: formData.vehicle_model || null,
          revision_date: new Date(formData.revision_date).toISOString(),
          oil_used: formData.oil_used,
          current_km: parseInt(formData.current_km),
          next_oil_motor_km: formData.next_oil_motor_km ? parseInt(formData.next_oil_motor_km) : null,
          next_oil_filter_km: formData.next_oil_filter_km ? parseInt(formData.next_oil_filter_km) : null,
          next_air_filter_km: formData.next_air_filter_km ? parseInt(formData.next_air_filter_km) : null,
          next_ac_filter_km: formData.next_ac_filter_km ? parseInt(formData.next_ac_filter_km) : null,
          next_fuel_filter_km: formData.next_fuel_filter_km ? parseInt(formData.next_fuel_filter_km) : null,
          next_racor_filter_km: formData.next_racor_filter_km ? parseInt(formData.next_racor_filter_km) : null,
          next_apu_filter_km: formData.next_apu_filter_km ? parseInt(formData.next_apu_filter_km) : null,
          next_hydraulic_filter_km: formData.next_hydraulic_filter_km ? parseInt(formData.next_hydraulic_filter_km) : null,
          next_gearbox_oil_km: formData.next_gearbox_oil_km ? parseInt(formData.next_gearbox_oil_km) : null,
          next_differential_oil_km: formData.next_differential_oil_km ? parseInt(formData.next_differential_oil_km) : null,
          next_lubrication_km: formData.next_lubrication_km ? parseInt(formData.next_lubrication_km) : null,
          next_washing_km: formData.next_washing_km ? parseInt(formData.next_washing_km) : null,
          mechanic_name: formData.mechanic_name,
          performed_by: formData.performed_by || null,
          observations: formData.observations || null
        };
      } else {
        // CARRETA - formulário simplificado
        data = {
          vehicle_type_revision: 'CARRETA',
          vehicle_plate: formData.vehicle_plate.toUpperCase(),
          vehicle_model: formData.vehicle_model || null,
          revision_date: new Date(formData.revision_date).toISOString(),
          oil_used: formData.carreta_revision_type, // Usar tipo de revisão como "oil_used" para manter compatibilidade
          current_km: 0, // Carreta não tem KM
          mechanic_name: formData.mechanic_name,
          performed_by: formData.performed_by || null,
          observations: formData.observations || null,
          carreta_revision_type: formData.carreta_revision_type
        };
      }

      await api.createVehicleRevision(data);
      toast.success('Revisão registrada com sucesso!');
      setNewModalOpen(false);
      resetForm();
      loadRevisions();
    } catch (error) {
      toast.error('Erro ao registrar revisão');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Deseja realmente excluir esta revisão?')) return;
    
    try {
      await api.deleteVehicleRevision(id);
      toast.success('Revisão excluída');
      loadRevisions();
    } catch (error) {
      toast.error('Erro ao excluir revisão');
    }
  };

  const handleViewDetails = async (revision) => {
    setSelectedRevision(revision);
    setDetailModalOpen(true);
  };

  const handlePrintPDF = async (revisionId) => {
    try {
      const response = await api.getVehicleRevisionPDF(revisionId);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      toast.error('Erro ao gerar PDF: ' + (error.response?.data?.detail || error.message));
    }
  };

  const formatKM = (value) => {
    if (!value) return '-';
    return `${value.toLocaleString('pt-BR')} KM`;
  };

  return (
    <Layout>
      <div className="space-y-6" data-testid="fleet-page">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Chivo, sans-serif' }}>
              Frota
            </h1>
            <p className="text-muted-foreground mt-1">Gerenciamento de veículos e manutenção</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* ========== ABA CADASTRO DE VEÍCULOS ========== */}
          <TabsContent value="vehicles" className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <Input
                  placeholder="Buscar por placa, modelo ou marca..."
                  value={vehicleSearch}
                  onChange={(e) => setVehicleSearch(e.target.value.toUpperCase())}
                  onKeyPress={(e) => e.key === 'Enter' && handleVehicleSearch()}
                  data-testid="search-vehicle-input"
                />
                <Button variant="outline" onClick={handleVehicleSearch}>
                  <Search className="w-4 h-4" />
                </Button>
              </div>
              <Button onClick={openNewVehicleModal} data-testid="new-vehicle-btn">
                <Plus className="w-4 h-4 mr-2" />
                Novo Veículo
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Car className="w-5 h-5" />
                  Veículos Cadastrados ({vehiclePagination.total})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {vehiclesLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : vehicles.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhum veículo cadastrado
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left py-3 px-4 font-medium">Placa</th>
                          <th className="text-left py-3 px-4 font-medium">Tipo</th>
                          <th className="text-left py-3 px-4 font-medium">Marca</th>
                          <th className="text-left py-3 px-4 font-medium">Modelo</th>
                          <th className="text-left py-3 px-4 font-medium">Ano</th>
                          <th className="text-left py-3 px-4 font-medium">Status</th>
                          <th className="text-left py-3 px-4 font-medium">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vehicles.map(vehicle => (
                          <tr key={vehicle.id} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-4 font-mono font-bold">{vehicle.plate}</td>
                            <td className="py-3 px-4">{vehicleTypes.find(t => t.value === vehicle.vehicle_type)?.label || vehicle.vehicle_type}</td>
                            <td className="py-3 px-4">{vehicle.brand || '-'}</td>
                            <td className="py-3 px-4">{vehicle.model || '-'}</td>
                            <td className="py-3 px-4">{vehicle.year || '-'}</td>
                            <td className="py-3 px-4">{getStatusBadge(vehicle.status)}</td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1">
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => openEditVehicleModal(vehicle)}
                                  title="Editar"
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => handleDeleteVehicle(vehicle.id)}
                                  title="Excluir"
                                  className="text-red-600 hover:text-red-700"
                                >
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

                {vehiclePagination.pages > 1 && (
                  <div className="flex justify-center gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={vehiclePagination.page === 1}
                      onClick={() => setVehiclePagination(prev => ({ ...prev, page: prev.page - 1 }))}
                    >
                      Anterior
                    </Button>
                    <span className="px-4 py-2 text-sm">
                      Página {vehiclePagination.page} de {vehiclePagination.pages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={vehiclePagination.page === vehiclePagination.pages}
                      onClick={() => setVehiclePagination(prev => ({ ...prev, page: prev.page + 1 }))}
                    >
                      Próxima
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== ABA CONTROLE DE REVISÃO ========== */}
          <TabsContent value="revisions" className="space-y-4 mt-4">
            {/* Barra de ações */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <Input
                  placeholder="Buscar por placa..."
                  value={searchPlate}
                  onChange={(e) => setSearchPlate(e.target.value.toUpperCase())}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  data-testid="search-plate-input"
                />
                <Button variant="outline" onClick={handleSearch}>
                  <Search className="w-4 h-4" />
                </Button>
              </div>
              <Button onClick={() => setNewModalOpen(true)} data-testid="new-revision-btn">
                <Plus className="w-4 h-4 mr-2" />
                Nova Revisão
              </Button>
            </div>

            {/* Tabela de revisões */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="w-5 h-5" />
                  Revisões Registradas ({pagination.total})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : revisions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma revisão encontrada
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left py-3 px-4 font-medium">Nº</th>
                          <th className="text-left py-3 px-4 font-medium">Placa</th>
                          <th className="text-left py-3 px-4 font-medium">Modelo</th>
                          <th className="text-left py-3 px-4 font-medium">Data</th>
                          <th className="text-left py-3 px-4 font-medium">KM Atual</th>
                          <th className="text-left py-3 px-4 font-medium">Óleo</th>
                          <th className="text-left py-3 px-4 font-medium">Mecânico</th>
                          <th className="text-left py-3 px-4 font-medium">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revisions.map(revision => (
                          <tr key={revision.id} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-4 font-mono">#{revision.revision_number}</td>
                            <td className="py-3 px-4 font-mono font-bold">{revision.vehicle_plate}</td>
                            <td className="py-3 px-4">{revision.vehicle_model || '-'}</td>
                            <td className="py-3 px-4">
                              {format(new Date(revision.revision_date), 'dd/MM/yyyy', { locale: ptBR })}
                            </td>
                            <td className="py-3 px-4">{formatKM(revision.current_km)}</td>
                            <td className="py-3 px-4">{revision.oil_used}</td>
                            <td className="py-3 px-4">{revision.mechanic_name}</td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1">
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => handleViewDetails(revision)}
                                  title="Ver Detalhes"
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => handlePrintPDF(revision.id)}
                                  title="Imprimir PDF"
                                >
                                  <Printer className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={() => handleDelete(revision.id)}
                                  title="Excluir"
                                  className="text-red-600 hover:text-red-700"
                                >
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

                {/* Paginação */}
                {pagination.pages > 1 && (
                  <div className="flex justify-center gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page === 1}
                      onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                    >
                      Anterior
                    </Button>
                    <span className="px-4 py-2 text-sm">
                      Página {pagination.page} de {pagination.pages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page === pagination.pages}
                      onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                    >
                      Próxima
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal Nova Revisão */}
      <Dialog open={newModalOpen} onOpenChange={setNewModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5" />
              Nova Revisão de Veículo
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Seleção do Tipo de Veículo */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <Label className="text-base font-semibold">Tipo de Veículo *</Label>
              <Select 
                value={formData.vehicle_type_revision} 
                onValueChange={(value) => handleInputChange('vehicle_type_revision', value)}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAVALO">Cavalo Mecânico</SelectItem>
                  <SelectItem value="CARRETA">Carreta</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* ========== FORMULÁRIO CAVALO MECÂNICO ========== */}
            {formData.vehicle_type_revision === 'CAVALO' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Placa do Veículo *</Label>
                    <Input
                      value={formData.vehicle_plate}
                      onChange={(e) => handleInputChange('vehicle_plate', e.target.value.toUpperCase())}
                      placeholder="ABC1D23"
                    />
                  </div>
                  <div>
                    <Label>Modelo</Label>
                    <Input
                      value={formData.vehicle_model}
                      onChange={(e) => handleInputChange('vehicle_model', e.target.value)}
                      placeholder="Ex: Volvo FH 540"
                    />
                  </div>
                  <div>
                    <Label>Data da Revisão *</Label>
                    <Input
                      type="date"
                      value={formData.revision_date}
                      onChange={(e) => handleInputChange('revision_date', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Óleo Utilizado *</Label>
                    <Input
                      value={formData.oil_used}
                      onChange={(e) => handleInputChange('oil_used', e.target.value)}
                      placeholder="Ex: 15W40"
                    />
                  </div>
                  <div>
                    <Label>KM Atual (Trocado com) *</Label>
                    <Input
                      type="number"
                      value={formData.current_km}
                      onChange={(e) => handleInputChange('current_km', e.target.value)}
                      placeholder="Ex: 150000"
                    />
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-semibold text-lg mb-4 text-orange-600">Próxima Revisão (KM)</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <Label>Óleo Motor</Label>
                      <Input type="number" value={formData.next_oil_motor_km} onChange={(e) => handleInputChange('next_oil_motor_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Filtro Óleo</Label>
                      <Input type="number" value={formData.next_oil_filter_km} onChange={(e) => handleInputChange('next_oil_filter_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Filtro Ar</Label>
                      <Input type="number" value={formData.next_air_filter_km} onChange={(e) => handleInputChange('next_air_filter_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Filtro Ar Condicionado</Label>
                      <Input type="number" value={formData.next_ac_filter_km} onChange={(e) => handleInputChange('next_ac_filter_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Filtro Combustível</Label>
                      <Input type="number" value={formData.next_fuel_filter_km} onChange={(e) => handleInputChange('next_fuel_filter_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Filtro Racor</Label>
                      <Input type="number" value={formData.next_racor_filter_km} onChange={(e) => handleInputChange('next_racor_filter_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Filtro APU</Label>
                      <Input type="number" value={formData.next_apu_filter_km} onChange={(e) => handleInputChange('next_apu_filter_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Filtro Hidráulico</Label>
                      <Input type="number" value={formData.next_hydraulic_filter_km} onChange={(e) => handleInputChange('next_hydraulic_filter_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Óleo Caixa de Marcha</Label>
                      <Input type="number" value={formData.next_gearbox_oil_km} onChange={(e) => handleInputChange('next_gearbox_oil_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Óleo Diferencial</Label>
                      <Input type="number" value={formData.next_differential_oil_km} onChange={(e) => handleInputChange('next_differential_oil_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Lubrificação</Label>
                      <Input type="number" value={formData.next_lubrication_km} onChange={(e) => handleInputChange('next_lubrication_km', e.target.value)} placeholder="KM" />
                    </div>
                    <div>
                      <Label>Lavagem</Label>
                      <Input type="number" value={formData.next_washing_km} onChange={(e) => handleInputChange('next_washing_km', e.target.value)} placeholder="KM" />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-semibold text-lg mb-4">Responsáveis</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Nome do Mecânico *</Label>
                      <Input value={formData.mechanic_name} onChange={(e) => handleInputChange('mechanic_name', e.target.value)} placeholder="Nome do mecânico" />
                    </div>
                    <div>
                      <Label>Realizado por</Label>
                      <Input value={formData.performed_by} onChange={(e) => handleInputChange('performed_by', e.target.value)} placeholder="Quem realizou" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <Label>Observações</Label>
                    <Input value={formData.observations} onChange={(e) => handleInputChange('observations', e.target.value)} placeholder="Observações" />
                  </div>
                </div>
              </>
            )}

            {/* ========== FORMULÁRIO CARRETA ========== */}
            {formData.vehicle_type_revision === 'CARRETA' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Placa *</Label>
                    <Input
                      value={formData.vehicle_plate}
                      onChange={(e) => handleInputChange('vehicle_plate', e.target.value.toUpperCase())}
                      placeholder="ABC1D23"
                    />
                  </div>
                  <div>
                    <Label>Modelo</Label>
                    <Input
                      value={formData.vehicle_model}
                      onChange={(e) => handleInputChange('vehicle_model', e.target.value)}
                      placeholder="Ex: Randon SR"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Tipo de Revisão *</Label>
                    <Select 
                      value={formData.carreta_revision_type} 
                      onValueChange={(value) => handleInputChange('carreta_revision_type', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o tipo de revisão" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FREIOS">Freios</SelectItem>
                        <SelectItem value="PNEUS">Pneus</SelectItem>
                        <SelectItem value="SUSPENSAO">Suspensão</SelectItem>
                        <SelectItem value="ELETRICA">Elétrica</SelectItem>
                        <SelectItem value="ESTRUTURA">Estrutura</SelectItem>
                        <SelectItem value="LONA">Lona/Sider</SelectItem>
                        <SelectItem value="GERAL">Revisão Geral</SelectItem>
                        <SelectItem value="OUTROS">Outros</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Data da Revisão</Label>
                    <Input
                      type="date"
                      value={formData.revision_date}
                      onChange={(e) => handleInputChange('revision_date', e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label>Observação</Label>
                  <Input
                    value={formData.observations}
                    onChange={(e) => handleInputChange('observations', e.target.value)}
                    placeholder="Descreva os serviços realizados"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Nome do Mecânico *</Label>
                    <Input
                      value={formData.mechanic_name}
                      onChange={(e) => handleInputChange('mechanic_name', e.target.value)}
                      placeholder="Nome do mecânico"
                    />
                  </div>
                  <div>
                    <Label>Realizado por</Label>
                    <Input
                      value={formData.performed_by}
                      onChange={(e) => handleInputChange('performed_by', e.target.value)}
                      placeholder="Quem realizou a revisão"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvando...' : 'Registrar Revisão'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da Revisão #{selectedRevision?.revision_number}</DialogTitle>
          </DialogHeader>
          
          {selectedRevision && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Veículo</p>
                  <p className="font-bold">{selectedRevision.vehicle_plate}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Modelo</p>
                  <p className="font-bold">{selectedRevision.vehicle_model || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Data</p>
                  <p className="font-bold">{format(new Date(selectedRevision.revision_date), 'dd/MM/yyyy')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">KM Atual</p>
                  <p className="font-bold">{formatKM(selectedRevision.current_km)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Óleo Utilizado</p>
                  <p className="font-bold">{selectedRevision.oil_used}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Mecânico</p>
                  <p className="font-bold">{selectedRevision.mechanic_name}</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-2 text-orange-600">Próxima Revisão</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between"><span>Óleo Motor:</span><span className="font-mono">{formatKM(selectedRevision.next_oil_motor_km)}</span></div>
                  <div className="flex justify-between"><span>Filtro Óleo:</span><span className="font-mono">{formatKM(selectedRevision.next_oil_filter_km)}</span></div>
                  <div className="flex justify-between"><span>Filtro Ar:</span><span className="font-mono">{formatKM(selectedRevision.next_air_filter_km)}</span></div>
                  <div className="flex justify-between"><span>Filtro AR Cond.:</span><span className="font-mono">{formatKM(selectedRevision.next_ac_filter_km)}</span></div>
                  <div className="flex justify-between"><span>Filtro Combustível:</span><span className="font-mono">{formatKM(selectedRevision.next_fuel_filter_km)}</span></div>
                  <div className="flex justify-between"><span>Filtro Racor:</span><span className="font-mono">{formatKM(selectedRevision.next_racor_filter_km)}</span></div>
                  <div className="flex justify-between"><span>Filtro APU:</span><span className="font-mono">{formatKM(selectedRevision.next_apu_filter_km)}</span></div>
                  <div className="flex justify-between"><span>Filtro Hidráulico:</span><span className="font-mono">{formatKM(selectedRevision.next_hydraulic_filter_km)}</span></div>
                  <div className="flex justify-between"><span>Óleo Caixa:</span><span className="font-mono">{formatKM(selectedRevision.next_gearbox_oil_km)}</span></div>
                  <div className="flex justify-between"><span>Óleo Diferencial:</span><span className="font-mono">{formatKM(selectedRevision.next_differential_oil_km)}</span></div>
                  <div className="flex justify-between"><span>Lubrificação:</span><span className="font-mono">{formatKM(selectedRevision.next_lubrication_km)}</span></div>
                  <div className="flex justify-between"><span>Lavagem:</span><span className="font-mono">{formatKM(selectedRevision.next_washing_km)}</span></div>
                </div>
              </div>

              <div className="border-t pt-4">
                <p className="text-sm text-muted-foreground">Registrado por</p>
                <p className="font-bold">{selectedRevision.created_by_name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {format(new Date(selectedRevision.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>
              Fechar
            </Button>
            <Button onClick={() => handlePrintPDF(selectedRevision?.id)}>
              <Printer className="w-4 h-4 mr-2" />
              Imprimir PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Cadastro/Edição de Veículo */}
      <Dialog open={vehicleModalOpen} onOpenChange={setVehicleModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Car className="w-5 h-5" />
              {editingVehicle ? 'Editar Veículo' : 'Novo Veículo'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Placa *</Label>
                <Input
                  value={vehicleForm.plate}
                  onChange={(e) => handleVehicleFormChange('plate', e.target.value.toUpperCase())}
                  placeholder="ABC1D23"
                  data-testid="input-vehicle-plate-form"
                />
              </div>
              <div>
                <Label>Tipo *</Label>
                <Select 
                  value={vehicleForm.vehicle_type} 
                  onValueChange={(value) => handleVehicleFormChange('vehicle_type', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {vehicleTypes.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Marca</Label>
                <Input
                  value={vehicleForm.brand}
                  onChange={(e) => handleVehicleFormChange('brand', e.target.value)}
                  placeholder="Ex: Volvo, Scania..."
                />
              </div>
              <div>
                <Label>Modelo</Label>
                <Input
                  value={vehicleForm.model}
                  onChange={(e) => handleVehicleFormChange('model', e.target.value)}
                  placeholder="Ex: FH 540"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Ano</Label>
                <Input
                  type="number"
                  value={vehicleForm.year}
                  onChange={(e) => handleVehicleFormChange('year', e.target.value)}
                  placeholder="Ex: 2024"
                  min="1900"
                  max="2100"
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select 
                  value={vehicleForm.status} 
                  onValueChange={(value) => handleVehicleFormChange('status', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o status" />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Observações</Label>
              <Input
                value={vehicleForm.observations}
                onChange={(e) => handleVehicleFormChange('observations', e.target.value)}
                placeholder="Observações adicionais"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVehicleModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleVehicleSubmit} disabled={vehicleSaving}>
              {vehicleSaving ? 'Salvando...' : (editingVehicle ? 'Salvar Alterações' : 'Cadastrar Veículo')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
