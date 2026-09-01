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
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../components/ui/command';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Truck, Wrench, Plus, Eye, Trash2, FileText, Search, Printer, Pencil, Car, Check, ChevronsUpDown } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function FleetPage() {
  const { confirm, ConfirmDialog } = useConfirm();
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
  const buildEmptyVehicleForm = () => ({
    plate: '',
    renavam: '',
    chassis: '',
    model: '',
    brand: '',
    year: '',
    model_year: '',
    color: '',
    asset_code: '',
    vehicle_type: '',
    category: '',
    load_capacity: '',
    axle_count: '',
    body_type: '',
    fuel_type: '',
    tank_capacity: '',
    engine_power: '',
    tare_weight: '',
    gross_weight: '',
    crlv_number: '',
    crlv_expiry: '',
    licensing_expiry: '',
    tachograph_expiry: '',
    inspection_date: '',
    inspection_expiry: '',
    owner_type: '',
    ownership_status: '',
    transport_company: '',
    status: 'ATIVO',
    observations: '',
    driver_id: ''
  });
  const [vehicleForm, setVehicleForm] = useState(buildEmptyVehicleForm());
  const [drivers, setDrivers] = useState([]);
  const [driverPopoverOpen, setDriverPopoverOpen] = useState(false);

  const vehicleTypes = [
    { value: 'CAMINHÃO', label: 'Caminhão' },
    { value: 'CARRETA', label: 'Carreta' },
    { value: 'CAVALO', label: 'Cavalo Mecânico' },
    { value: 'EMPILHADEIRA', label: 'Empilhadeira' },
    { value: 'GUINDASTE', label: 'Guindaste' },
    { value: 'REACH_STACKER', label: 'Reach Stacker' },
    { value: 'VAN', label: 'Van' },
    { value: 'EQUIPAMENTO', label: 'Outro Equipamento' },
  ];

  const statusOptions = [
    { value: 'ATIVO', label: 'Ativo' },
    { value: 'INATIVO', label: 'Inativo' },
    { value: 'MANUTENCAO', label: 'Em Manutenção' },
  ];

  const categoryOptions = [
    { value: 'CARGA', label: 'Carga' },
    { value: 'TRACAO', label: 'Tração' },
    { value: 'EQUIPAMENTO_PATIO', label: 'Equipamento de Pátio' },
  ];

  const fuelOptions = [
    { value: 'DIESEL', label: 'Diesel' },
    { value: 'GASOLINA', label: 'Gasolina' },
    { value: 'ELETRICO', label: 'Elétrico' },
    { value: 'GLP', label: 'GLP' },
  ];

  const ownerTypeOptions = [
    { value: 'PROPRIA', label: 'Empresa Própria' },
    { value: 'TERCEIRIZADO', label: 'Terceirizado' },
    { value: 'AUTONOMO', label: 'Motorista Autônomo' },
  ];

  const ownershipStatusOptions = [
    { value: 'PROPRIO', label: 'Próprio' },
    { value: 'ALUGADO', label: 'Alugado' },
    { value: 'AGREGADO', label: 'Agregado' },
  ];

  useEffect(() => {
    if (activeTab === 'revisions') {
      loadRevisions();
    } else if (activeTab === 'vehicles') {
      loadVehicles();
      loadDrivers();
    }
  }, [activeTab, pagination.page, vehiclePagination.page]);

  const loadDrivers = async () => {
    try {
      const response = await api.getDrivers();
      setDrivers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Erro ao carregar motoristas:', error);
      toast.error('Erro ao carregar motoristas');
    }
  };

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
    setVehicleForm(buildEmptyVehicleForm());
    setEditingVehicle(null);
  };

  const openNewVehicleModal = () => {
    resetVehicleForm();
    setVehicleModalOpen(true);
  };

  const openEditVehicleModal = (vehicle) => {
    setEditingVehicle(vehicle);
    const empty = buildEmptyVehicleForm();
    const form = { ...empty };
    for (const key of Object.keys(empty)) {
      if (vehicle[key] !== undefined && vehicle[key] !== null) {
        form[key] = typeof empty[key] === 'string' && typeof vehicle[key] !== 'string'
          ? String(vehicle[key])
          : vehicle[key];
      }
    }
    setVehicleForm(form);
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
        renavam: vehicleForm.renavam || null,
        chassis: vehicleForm.chassis || null,
        model: vehicleForm.model || null,
        brand: vehicleForm.brand || null,
        year: vehicleForm.year ? parseInt(vehicleForm.year) : null,
        model_year: vehicleForm.model_year ? parseInt(vehicleForm.model_year) : null,
        color: vehicleForm.color || null,
        asset_code: vehicleForm.asset_code || null,
        vehicle_type: vehicleForm.vehicle_type,
        category: vehicleForm.category || null,
        load_capacity: vehicleForm.load_capacity || null,
        axle_count: vehicleForm.axle_count ? parseInt(vehicleForm.axle_count) : null,
        body_type: vehicleForm.body_type || null,
        fuel_type: vehicleForm.fuel_type || null,
        tank_capacity: vehicleForm.tank_capacity || null,
        engine_power: vehicleForm.engine_power || null,
        tare_weight: vehicleForm.tare_weight || null,
        gross_weight: vehicleForm.gross_weight || null,
        crlv_number: vehicleForm.crlv_number || null,
        crlv_expiry: vehicleForm.crlv_expiry || null,
        licensing_expiry: vehicleForm.licensing_expiry || null,
        tachograph_expiry: vehicleForm.tachograph_expiry || null,
        inspection_date: vehicleForm.inspection_date || null,
        inspection_expiry: vehicleForm.inspection_expiry || null,
        owner_type: vehicleForm.owner_type || null,
        ownership_status: vehicleForm.ownership_status || null,
        transport_company: vehicleForm.transport_company || null,
        status: vehicleForm.status,
        observations: vehicleForm.observations || null,
        driver_id: vehicleForm.driver_id || null
      };

      if (editingVehicle) {
        if (!vehicleForm.driver_id) data.clear_driver = true;
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
    if (!(await confirm('Deseja realmente excluir este veículo?'))) return;
    
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
      'INATIVO': 'bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200',
      'MANUTENCAO': 'bg-yellow-100 text-yellow-800',
    };
    const labels = {
      'ATIVO': 'Ativo',
      'INATIVO': 'Inativo',
      'MANUTENCAO': 'Manutenção',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${styles[status] || styles['ATIVO']}`}>
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
    if (!(await confirm('Deseja realmente excluir esta revisão?'))) return;
    
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
      const link = document.createElement('a');
      link.href = url;
      link.download = `revisao_${revisionId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
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
      <div className="space-y-5" data-testid="fleet-page">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              {activeTab === 'revisions' ? <Wrench className="w-4 h-4" /> : <Car className="w-4 h-4" />}
              {activeTab === 'revisions' ? 'Controle de Revisão' : 'Cadastro de Veículo'}
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
              {activeTab === 'revisions' ? 'Registro de revisões e trocas de óleo dos veículos' : 'Cadastro e gerenciamento da frota de veículos'}
            </p>
          </div>
          {activeTab === 'revisions' ? (
            <Button
              onClick={() => setNewModalOpen(true)}
              data-testid="new-revision-btn"
              className="text-[13px] font-semibold uppercase tracking-wide h-10 px-5 bg-primary hover:bg-primary/90"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Nova Revisão
            </Button>
          ) : (
            <Button
              onClick={openNewVehicleModal}
              data-testid="new-vehicle-btn"
              className="text-[13px] font-semibold uppercase tracking-wide h-10 px-5 bg-primary hover:bg-primary/90"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Novo Veículo
            </Button>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* ========== ABA CADASTRO DE VEÍCULOS ========== */}
          <TabsContent value="vehicles" className="space-y-5">
            <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
              <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="flex items-center gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  <Search className="w-4 h-4" />
                  Filtrar
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-1 sm:max-w-sm gap-3">
                  <div>
                    <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Placa, modelo ou marca</Label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                      <Input
                        value={vehicleSearch}
                        onChange={(e) => setVehicleSearch(e.target.value.toUpperCase())}
                        onKeyPress={(e) => e.key === 'Enter' && handleVehicleSearch()}
                        className="h-9 text-sm pl-8"
                        data-testid="search-vehicle-input"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" onClick={handleVehicleSearch} className="h-8 text-xs font-medium bg-primary hover:bg-primary/90">
                    Filtrar
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
              <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <Car className="w-4 h-4" />
                  Veículos Cadastrados ({vehiclePagination.total})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {vehiclesLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : vehicles.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    Nenhum veículo cadastrado
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Placa</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tipo</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Marca</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Modelo</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Ano</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Motorista</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vehicles.map((vehicle, idx) => (
                          <tr
                            key={vehicle.id}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}
                          >
                            <td className="px-4 py-2.5 text-sm font-mono font-semibold text-slate-800 dark:text-slate-200">{vehicle.plate}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{vehicleTypes.find(t => t.value === vehicle.vehicle_type)?.label || vehicle.vehicle_type}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{vehicle.brand || '-'}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{vehicle.model || '-'}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{vehicle.year || '-'}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{vehicle.driver_name || '-'}</td>
                            <td className="px-4 py-2.5">{getStatusBadge(vehicle.status)}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditVehicleModal(vehicle)}
                                  title="Editar"
                                  className="h-7 w-7 p-0"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-blue-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteVehicle(vehicle.id)}
                                  title="Excluir"
                                  className="h-7 w-7 p-0"
                                >
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
          <TabsContent value="revisions" className="space-y-5 mt-4">
            <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
              <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="flex items-center gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  <Search className="w-4 h-4" />
                  Filtrar
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-1 sm:max-w-sm gap-3">
                  <div>
                    <Label className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wider font-semibold">Placa</Label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                      <Input
                        value={searchPlate}
                        onChange={(e) => setSearchPlate(e.target.value.toUpperCase())}
                        onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                        className="h-9 text-sm pl-8"
                        data-testid="search-plate-input"
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

            {/* Tabela de revisões */}
            <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
              <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <Wrench className="w-4 h-4" />
                  Revisões Registradas ({pagination.total})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : revisions.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    Nenhuma revisão encontrada
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Placa</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Modelo</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">KM Atual</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Óleo</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Mecânico</th>
                          <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revisions.map((revision, idx) => (
                          <tr
                            key={revision.id}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}
                          >
                            <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{revision.revision_number}</td>
                            <td className="px-4 py-2.5 text-sm font-mono text-slate-700 dark:text-slate-300">{revision.vehicle_plate}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{revision.vehicle_model || '-'}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                              {format(new Date(revision.revision_date), 'dd/MM/yyyy', { locale: ptBR })}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{formatKM(revision.current_km)}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{revision.oil_used}</td>
                            <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{revision.mechanic_name}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleViewDetails(revision)}
                                  title="Ver Detalhes"
                                  className="h-7 w-7 p-0"
                                >
                                  <Eye className="w-3.5 h-3.5 text-primary" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handlePrintPDF(revision.id)}
                                  title="Imprimir PDF"
                                  className="h-7 w-7 p-0"
                                >
                                  <Printer className="w-3.5 h-3.5 text-blue-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(revision.id)}
                                  title="Excluir"
                                  className="h-7 w-7 p-0"
                                >
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
                  <SelectValue />
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
                    />
                  </div>
                  <div>
                    <Label>Modelo</Label>
                    <Input
                      value={formData.vehicle_model}
                      onChange={(e) => handleInputChange('vehicle_model', e.target.value)}
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
                    />
                  </div>
                  <div>
                    <Label>KM Atual (Trocado com) *</Label>
                    <Input
                      type="number"
                      value={formData.current_km}
                      onChange={(e) => handleInputChange('current_km', e.target.value)}
                    />
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-semibold text-lg mb-4 text-orange-600">Próxima Revisão (KM)</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <Label>Óleo Motor</Label>
                      <Input type="number" value={formData.next_oil_motor_km} onChange={(e) => handleInputChange('next_oil_motor_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Filtro Óleo</Label>
                      <Input type="number" value={formData.next_oil_filter_km} onChange={(e) => handleInputChange('next_oil_filter_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Filtro Ar</Label>
                      <Input type="number" value={formData.next_air_filter_km} onChange={(e) => handleInputChange('next_air_filter_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Filtro Ar Condicionado</Label>
                      <Input type="number" value={formData.next_ac_filter_km} onChange={(e) => handleInputChange('next_ac_filter_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Filtro Combustível</Label>
                      <Input type="number" value={formData.next_fuel_filter_km} onChange={(e) => handleInputChange('next_fuel_filter_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Filtro Racor</Label>
                      <Input type="number" value={formData.next_racor_filter_km} onChange={(e) => handleInputChange('next_racor_filter_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Filtro APU</Label>
                      <Input type="number" value={formData.next_apu_filter_km} onChange={(e) => handleInputChange('next_apu_filter_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Filtro Hidráulico</Label>
                      <Input type="number" value={formData.next_hydraulic_filter_km} onChange={(e) => handleInputChange('next_hydraulic_filter_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Óleo Caixa de Marcha</Label>
                      <Input type="number" value={formData.next_gearbox_oil_km} onChange={(e) => handleInputChange('next_gearbox_oil_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Óleo Diferencial</Label>
                      <Input type="number" value={formData.next_differential_oil_km} onChange={(e) => handleInputChange('next_differential_oil_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Lubrificação</Label>
                      <Input type="number" value={formData.next_lubrication_km} onChange={(e) => handleInputChange('next_lubrication_km', e.target.value)} />
                    </div>
                    <div>
                      <Label>Lavagem</Label>
                      <Input type="number" value={formData.next_washing_km} onChange={(e) => handleInputChange('next_washing_km', e.target.value)} />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-semibold text-lg mb-4">Responsáveis</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Nome do Mecânico *</Label>
                      <Input value={formData.mechanic_name} onChange={(e) => handleInputChange('mechanic_name', e.target.value)} />
                    </div>
                    <div>
                      <Label>Realizado por</Label>
                      <Input value={formData.performed_by} onChange={(e) => handleInputChange('performed_by', e.target.value)} />
                    </div>
                  </div>
                  <div className="mt-4">
                    <Label>Observações</Label>
                    <Input value={formData.observations} onChange={(e) => handleInputChange('observations', e.target.value)} />
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
                    />
                  </div>
                  <div>
                    <Label>Modelo</Label>
                    <Input
                      value={formData.vehicle_model}
                      onChange={(e) => handleInputChange('vehicle_model', e.target.value)}
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
                        <SelectValue />
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
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Nome do Mecânico *</Label>
                    <Input
                      value={formData.mechanic_name}
                      onChange={(e) => handleInputChange('mechanic_name', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Realizado por</Label>
                    <Input
                      value={formData.performed_by}
                      onChange={(e) => handleInputChange('performed_by', e.target.value)}
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Car className="w-5 h-5" />
              {editingVehicle ? 'Editar Veículo' : 'Novo Veículo'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">Identificação</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Placa *</Label>
                <Input
                  value={vehicleForm.plate}
                  onChange={(e) => handleVehicleFormChange('plate', e.target.value.toUpperCase())}
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
                    <SelectValue />
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
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Categoria</Label>
                <Select value={vehicleForm.category} onValueChange={(value) => handleVehicleFormChange('category', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cor</Label>
                <Input value={vehicleForm.color} onChange={(e) => handleVehicleFormChange('color', e.target.value)} />
              </div>
              <div>
                <Label>Nº Patrimônio/Cód. Interno</Label>
                <Input value={vehicleForm.asset_code} onChange={(e) => handleVehicleFormChange('asset_code', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Marca</Label>
                <Input
                  value={vehicleForm.brand}
                  onChange={(e) => handleVehicleFormChange('brand', e.target.value)}
                />
              </div>
              <div>
                <Label>Modelo</Label>
                <Input
                  value={vehicleForm.model}
                  onChange={(e) => handleVehicleFormChange('model', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Ano de Fabricação</Label>
                <Input
                  type="number"
                  value={vehicleForm.year}
                  onChange={(e) => handleVehicleFormChange('year', e.target.value)}
                  min="1900"
                  max="2100"
                />
              </div>
              <div>
                <Label>Ano Modelo</Label>
                <Input
                  type="number"
                  value={vehicleForm.model_year}
                  onChange={(e) => handleVehicleFormChange('model_year', e.target.value)}
                  min="1900"
                  max="2100"
                />
              </div>
            </div>

            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">Especificações</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Capacidade de Carga</Label>
                <Input value={vehicleForm.load_capacity} onChange={(e) => handleVehicleFormChange('load_capacity', e.target.value)} />
              </div>
              <div>
                <Label>Nº de Eixos</Label>
                <Input type="number" value={vehicleForm.axle_count} onChange={(e) => handleVehicleFormChange('axle_count', e.target.value)} />
              </div>
              <div>
                <Label>Tipo de Carroceria/Implemento</Label>
                <Input value={vehicleForm.body_type} onChange={(e) => handleVehicleFormChange('body_type', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Combustível</Label>
                <Select value={vehicleForm.fuel_type} onValueChange={(value) => handleVehicleFormChange('fuel_type', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {fuelOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Capacidade do Tanque</Label>
                <Input value={vehicleForm.tank_capacity} onChange={(e) => handleVehicleFormChange('tank_capacity', e.target.value)} />
              </div>
              <div>
                <Label>Potência do Motor</Label>
                <Input value={vehicleForm.engine_power} onChange={(e) => handleVehicleFormChange('engine_power', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tara (peso vazio)</Label>
                <Input value={vehicleForm.tare_weight} onChange={(e) => handleVehicleFormChange('tare_weight', e.target.value)} />
              </div>
              <div>
                <Label>PBT (Peso Bruto Total)</Label>
                <Input value={vehicleForm.gross_weight} onChange={(e) => handleVehicleFormChange('gross_weight', e.target.value)} />
              </div>
            </div>

            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">Documentação</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>RENAVAM</Label>
                <Input value={vehicleForm.renavam} onChange={(e) => handleVehicleFormChange('renavam', e.target.value)} />
              </div>
              <div>
                <Label>Chassi</Label>
                <Input value={vehicleForm.chassis} onChange={(e) => handleVehicleFormChange('chassis', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>CRLV - Número</Label>
                <Input value={vehicleForm.crlv_number} onChange={(e) => handleVehicleFormChange('crlv_number', e.target.value)} />
              </div>
              <div>
                <Label>CRLV - Validade</Label>
                <Input type="date" value={vehicleForm.crlv_expiry} onChange={(e) => handleVehicleFormChange('crlv_expiry', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Vencimento do Licenciamento</Label>
                <Input type="date" value={vehicleForm.licensing_expiry} onChange={(e) => handleVehicleFormChange('licensing_expiry', e.target.value)} />
              </div>
              <div>
                <Label>Vencimento do Tacógrafo</Label>
                <Input type="date" value={vehicleForm.tachograph_expiry} onChange={(e) => handleVehicleFormChange('tachograph_expiry', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Data da Vistoria</Label>
                <Input type="date" value={vehicleForm.inspection_date} onChange={(e) => handleVehicleFormChange('inspection_date', e.target.value)} />
              </div>
              <div>
                <Label>Validade da Vistoria</Label>
                <Input type="date" value={vehicleForm.inspection_expiry} onChange={(e) => handleVehicleFormChange('inspection_expiry', e.target.value)} />
              </div>
            </div>

            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">Vínculo</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Proprietário</Label>
                <Select value={vehicleForm.owner_type} onValueChange={(value) => handleVehicleFormChange('owner_type', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ownerTypeOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status de Propriedade</Label>
                <Select value={vehicleForm.ownership_status} onValueChange={(value) => handleVehicleFormChange('ownership_status', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ownershipStatusOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Transportadora Vinculada</Label>
                <Input value={vehicleForm.transport_company} onChange={(e) => handleVehicleFormChange('transport_company', e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Status</Label>
              <Select
                value={vehicleForm.status}
                onValueChange={(value) => handleVehicleFormChange('status', value)}
              >
                <SelectTrigger>
                  <SelectValue />
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

            <div>
              <Label>Motorista Responsável</Label>
              <Popover open={driverPopoverOpen} onOpenChange={setDriverPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={driverPopoverOpen}
                    className="w-full justify-between font-normal"
                  >
                    {vehicleForm.driver_id
                      ? drivers.find(driver => driver.id === vehicleForm.driver_id)?.name
                      : 'Selecione o motorista (opcional)'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput />
                    <CommandList>
                      <CommandEmpty>Nenhum motorista encontrado</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="Nenhum"
                          onSelect={() => {
                            handleVehicleFormChange('driver_id', '');
                            setDriverPopoverOpen(false);
                          }}
                        >
                          <Check className={cn('mr-2 h-4 w-4', !vehicleForm.driver_id ? 'opacity-100' : 'opacity-0')} />
                          Nenhum
                        </CommandItem>
                        {drivers.map(driver => (
                          <CommandItem
                            key={driver.id}
                            value={driver.name}
                            onSelect={() => {
                              handleVehicleFormChange('driver_id', driver.id);
                              setDriverPopoverOpen(false);
                            }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', vehicleForm.driver_id === driver.id ? 'opacity-100' : 'opacity-0')} />
                            {driver.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground mt-1">
                Ao vincular, a placa deste veículo é preenchida automaticamente ao selecionar esse motorista em uma Movimentação ou Contrato de Frete.
              </p>
            </div>

            <div>
              <Label>Observações</Label>
              <Input
                value={vehicleForm.observations}
                onChange={(e) => handleVehicleFormChange('observations', e.target.value)}
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
      <ConfirmDialog />
    </Layout>
  );
}
