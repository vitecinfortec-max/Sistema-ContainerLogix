import { FormSectionTitle } from '../components/FormKit';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, PlateTag, EmptyState, TablePagination,
  rowTone,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import PeriodReportDialog from '../components/PeriodReportDialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../components/ui/command';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Truck, Wrench, Plus, Eye, Trash2, FileText, Printer, Pencil, Car, Check, ChevronsUpDown, Camera, Upload, X, Loader2, CheckCircle2, Clock, AlertTriangle, FileBarChart } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { compressImage } from '../lib/imageCompression';
import {
  DocumentImportButton, DocumentImportNotice, DocumentAttachments, applyDocumentFields, addAttachment, IMPORTED_FIELD_CLASS,
} from '../components/DocumentImport';
import { calendarDate, toDateInput, todayISO } from '../lib/dates';
import { formatPlate } from '../lib/masks';

import { useUrlState } from '../hooks/useUrlState';
const VEHICLE_STATUS_LABELS = { ATIVO: 'Ativo', INATIVO: 'Inativo', MANUTENCAO: 'Manutenção' };
// Mesma margem do backend (MAINTENANCE_ALERT_MARGIN_KM em routers/frota.py)
const MAINTENANCE_MARGIN_KM = 1000;
const MAINTENANCE_BADGES = {
  OK: { label: 'Em dia', tone: 'emerald' },
  DUE_SOON: { label: 'Próxima', tone: 'amber' },
  OVERDUE: { label: 'Vencida', tone: 'red' },
};

const VEHICLE_STATUS_TONES = { ATIVO: 'emerald', INATIVO: 'slate', MANUTENCAO: 'amber' };

// Cor da linha na lista: inativo apagado, documento vencido em vermelho,
// documento vencendo ou veículo em manutenção em amarelo
function vehicleRowSituation(vehicle, today) {
  if (vehicle.status === 'INATIVO') return 'off';
  const docs = vehicleDocsStatus(vehicle, today);
  if (docs?.status === 'EXPIRED') return 'alert';
  if (docs?.status === 'SOON' || vehicle.status === 'MANUTENCAO') return 'warn';
  return null;
}

// Vencimentos do cadastro do veículo - avisa com 30 dias de antecedência
const VEHICLE_DOCS = [
  ['crlv_expiry', 'CRLV'],
  ['licensing_expiry', 'Licenciamento'],
  ['tachograph_expiry', 'Tacógrafo'],
  ['inspection_expiry', 'Vistoria'],
];
const DOC_ALERT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Situação dos documentos: o vencimento mais urgente decide (vencido > a vencer > em dia). */
function vehicleDocsStatus(vehicle, today) {
  const todayDate = new Date(`${today}T00:00:00`);
  const docs = VEHICLE_DOCS
    .map(([field, label]) => {
      const day = toDateInput(vehicle[field]);
      if (!day) return null;
      const days = Math.round((new Date(`${day}T00:00:00`) - todayDate) / DAY_MS);
      return { label, day, days };
    })
    .filter(Boolean)
    .sort((a, b) => a.days - b.days);
  if (docs.length === 0) return null;
  const detail = docs.map((d) => `${d.label}: ${format(new Date(`${d.day}T00:00:00`), 'dd/MM/yyyy')}`).join(' | ');
  const worst = docs[0];
  if (worst.days < 0) {
    const expired = docs.filter((d) => d.days < 0).map((d) => d.label);
    return { status: 'EXPIRED', tone: 'red', label: `Vencido: ${expired.join(', ')}`, detail };
  }
  if (worst.days <= DOC_ALERT_DAYS) {
    return { status: 'SOON', tone: 'amber', label: `${worst.label} vence ${worst.days === 0 ? 'hoje' : `em ${worst.days} dia${worst.days === 1 ? '' : 's'}`}`, detail };
  }
  return { status: 'OK', tone: 'emerald', label: 'Em dia', detail };
}

export default function FleetPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [revisionReportOpen, setRevisionReportOpen] = useState(false);
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
  const [selectedRevisionIds, setSelectedRevisionIds] = useState(() => new Set());
  
  // Situação de manutenção por placa (mesma conta do Lançamento de Hodômetro)
  const [maintenanceByPlate, setMaintenanceByPlate] = useState({});
  // Lista completa de veículos, usada pelo autocomplete de Placa (independente
  // da paginação de 15/página da aba "Veículos")
  const [allVehicles, setAllVehicles] = useState([]);

  // Modal de detalhes
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedRevision, setSelectedRevision] = useState(null);
  const [uploadingDetailKmPhoto, setUploadingDetailKmPhoto] = useState(false);

  // ========== VEÍCULOS ==========
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleTypeFilter, setVehicleTypeFilter] = useUrlState('vehicleType', '');
  const [vehicleStatusFilter, setVehicleStatusFilter] = useUrlState('vehicleStatus', '');
  const [vehiclePagination, setVehiclePagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selectedVehicleIds, setSelectedVehicleIds] = useState(() => new Set());
  
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
    fuel_target_km_l: '',
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
    driver_id: '',
    document_attachments: []
  });
  const [vehicleForm, setVehicleForm] = useState(buildEmptyVehicleForm());
  const [vehicleImportedFields, setVehicleImportedFields] = useState(() => new Set());
  const [vehicleImportNotice, setVehicleImportNotice] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [driverPopoverOpen, setDriverPopoverOpen] = useState(false);
  const [transportCompanies, setTransportCompanies] = useState([]);

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

  // As duas buscas filtram enquanto se digita (sem botão "Filtrar") e valem
  // também ao trocar de página e ao recarregar depois de salvar.
  const debouncedVehicleSearch = useDebouncedValue(vehicleSearch.trim());
  const debouncedPlate = useDebouncedValue(searchPlate.trim());

  useEffect(() => {
    if (activeTab === 'vehicles') {
      loadDrivers();
      loadTransportCompanies();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'vehicles') loadVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, vehiclePagination.page, debouncedVehicleSearch, vehicleTypeFilter, vehicleStatusFilter]);

  useEffect(() => {
    if (activeTab === 'revisions') loadRevisions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, pagination.page, debouncedPlate]);

  useEffect(() => {
    if (activeTab === 'revisions') loadMaintenanceStatus();
  }, [activeTab]);

  const loadMaintenanceStatus = async () => {
    try {
      const response = await api.getVehicleMaintenanceStatus();
      setMaintenanceByPlate(Object.fromEntries((response.data || []).map((m) => [m.vehicle_plate, m])));
    } catch (error) {
      console.error('Erro ao carregar situação de manutenção:', error);
    }
  };

  // Carrega a frota inteira uma vez (independente da aba/paginação) para o
  // autocomplete de Placa do Controle de Revisão puxar do cadastro real.
  useEffect(() => {
    loadAllVehiclesForAutocomplete();
  }, []);

  const loadAllVehiclesForAutocomplete = async () => {
    try {
      const response = await api.getVehicles({ per_page: 1000 });
      setAllVehicles(response.data?.items || []);
    } catch (error) {
      console.error('Erro ao carregar veículos:', error);
    }
  };

  const loadDrivers = async () => {
    try {
      const response = await api.getDrivers();
      setDrivers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Erro ao carregar motoristas:', error);
      toast.error('Erro ao carregar motoristas');
    }
  };

  const loadTransportCompanies = async () => {
    try {
      const response = await api.getCompanies();
      setTransportCompanies(response.data?.items || response.data || []);
    } catch (error) {
      console.error('Erro ao carregar transportadoras:', error);
    }
  };

  // ========== FUNÇÕES DE VEÍCULOS ==========
  const loadVehicles = async (search = debouncedVehicleSearch) => {
    try {
      const params = { page: vehiclePagination.page, per_page: 15 };
      if (search) params.search = search;
      if (vehicleTypeFilter) params.vehicle_type = vehicleTypeFilter;
      if (vehicleStatusFilter) params.status = vehicleStatusFilter;
      
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

  const handleVehicleSearchChange = (value) => {
    setVehicleSearch(value);
    setVehiclePagination(prev => ({ ...prev, page: 1 }));
  };

  const handleVehicleFormChange = (field, value) => {
    setVehicleForm(prev => ({ ...prev, [field]: value }));
    setVehicleImportedFields(prev => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  const clearVehicleImport = () => {
    setVehicleImportedFields(new Set());
    setVehicleImportNotice(null);
  };

  const resetVehicleForm = () => {
    setVehicleForm(buildEmptyVehicleForm());
    setEditingVehicle(null);
    clearVehicleImport();
  };

  // Campos lidos do CRLV vão para o formulário, destacados para conferência.
  // Tipo e Categoria são deduzidos da Espécie/Tipo do documento, então só
  // entram se ainda estiverem vazios.
  const handleCrlvRead = (reading) => {
    const warnings = [...reading.warnings];
    const readPlate = reading.fields.plate;
    if (editingVehicle && readPlate && vehicleForm.plate && readPlate !== vehicleForm.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase()) {
      warnings.unshift(`A placa do documento (${readPlate}) é diferente da placa deste cadastro: confira se é o veículo certo`);
    }
    const { next, applied } = applyDocumentFields(vehicleForm, reading.fields, { onlyIfEmpty: ['vehicle_type', 'category'] });
    next.document_attachments = addAttachment(next.document_attachments, reading.file_url);
    const info = [];
    if (reading.info.licensing_year) info.push(['Exercício do licenciamento', reading.info.licensing_year]);
    if (reading.info.owner_name) {
      info.push(['Proprietário', [reading.info.owner_name, reading.info.owner_document].filter(Boolean).join(' - ')]);
    }
    setVehicleForm(next);
    setVehicleImportedFields(new Set(applied));
    setVehicleImportNotice({ label: 'CRLV', count: applied.length, warnings, info });
  };
  const importedClass = (field) => (vehicleImportedFields.has(field) ? IMPORTED_FIELD_CLASS : '');

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
    clearVehicleImport();
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
        fuel_target_km_l: Number(String(vehicleForm.fuel_target_km_l).replace(',', '.')) > 0 ? Number(String(vehicleForm.fuel_target_km_l).replace(',', '.')) : null,
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
        driver_id: vehicleForm.driver_id || null,
        document_attachments: vehicleForm.document_attachments || []
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
      loadAllVehiclesForAutocomplete();
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
      setSelectedVehicleIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadVehicles();
      loadAllVehiclesForAutocomplete();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao excluir veículo');
    }
  };

  const toggleSelectVehicle = (id) => {
    setSelectedVehicleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVehiclesOnPage = () => {
    const pageIds = vehicles.map(v => v.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedVehicleIds.has(id));
    setSelectedVehicleIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const clearVehicleSearch = () => {
    setVehicleSearch('');
    setVehicleTypeFilter('');
    setVehicleStatusFilter('');
    setVehiclePagination(prev => ({ ...prev, page: 1 }));
  };

  const changeVehicleFilter = (setter) => (value) => {
    setter(value === '_all' ? '' : value);
    setVehiclePagination(prev => ({ ...prev, page: 1 }));
  };

  // Indicadores sobre a frota inteira (a tabela é paginada no servidor)
  const today = todayISO();
  const fleetDocs = allVehicles.map((v) => vehicleDocsStatus(v, today));
  const docsExpiredCount = fleetDocs.filter((d) => d?.status === 'EXPIRED').length;
  const docsSoonCount = fleetDocs.filter((d) => d?.status === 'SOON').length;

  // ========== FUNÇÕES DE REVISÕES ==========
  const loadRevisions = async (plate = debouncedPlate) => {
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

  const handleSearchPlateChange = (value) => {
    setSearchPlate(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const clearRevisionSearch = () => {
    setSearchPlate('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Deseja realmente excluir esta revisão?'))) return;

    try {
      await api.deleteVehicleRevision(id);
      toast.success('Revisão excluída');
      setSelectedRevisionIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadRevisions();
    } catch (error) {
      toast.error('Erro ao excluir revisão');
    }
  };

  const handleViewDetails = async (revision) => {
    setSelectedRevision(revision);
    setDetailModalOpen(true);
  };

  const handleDetailKmPhotoUpload = async (file) => {
    if (!file || !selectedRevision) return;
    setUploadingDetailKmPhoto(true);
    try {
      const compressed = await compressImage(file);
      const response = await api.uploadVehicleRevisionKmPhoto(selectedRevision.id, compressed);
      const updated = { ...selectedRevision, current_km_photo_url: response.data.current_km_photo_url };
      setSelectedRevision(updated);
      setRevisions(prev => prev.map(r => r.id === updated.id ? updated : r));
      toast.success('Foto do Km adicionada!');
    } catch (error) {
      toast.error('Erro ao enviar foto do Km');
    } finally {
      setUploadingDetailKmPhoto(false);
    }
  };

  const handleDetailKmPhotoRemove = async () => {
    if (!selectedRevision) return;
    try {
      await api.deleteVehicleRevisionKmPhoto(selectedRevision.id);
      const updated = { ...selectedRevision, current_km_photo_url: null };
      setSelectedRevision(updated);
      setRevisions(prev => prev.map(r => r.id === updated.id ? updated : r));
      toast.success('Foto do Km removida!');
    } catch (error) {
      toast.error('Erro ao remover foto do Km');
    }
  };

  const toggleSelectRevision = (id) => {
    setSelectedRevisionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllRevisionsOnPage = () => {
    const pageIds = revisions.map(r => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedRevisionIds.has(id));
    setSelectedRevisionIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
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

  const maintenanceList = Object.values(maintenanceByPlate);

  const singleSelectedRevision = selectedRevisionIds.size === 1 ? revisions.find(r => r.id === [...selectedRevisionIds][0]) : null;
  const singleSelectedVehicle = selectedVehicleIds.size === 1 ? vehicles.find(v => v.id === [...selectedVehicleIds][0]) : null;

  return (
    <Layout>
      <div className="space-y-4" data-testid="fleet-page">
        <PageHeader
          icon={activeTab === 'revisions' ? Wrench : Car}
          title={activeTab === 'revisions' ? 'Controle de Revisão' : 'Cadastro de Veículo'}
          subtitle={activeTab === 'revisions' ? 'Registro de revisões e trocas de óleo dos veículos' : 'Cadastro e gerenciamento da frota de veículos'}
          actions={activeTab === 'revisions' && (
            <Button variant="outline" size="sm" onClick={() => setRevisionReportOpen(true)} data-testid="revision-period-report">
              <FileBarChart className="w-4 h-4 mr-1.5" /> Relatório de revisões
            </Button>
          )}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* ========== ABA CADASTRO DE VEÍCULOS ========== */}
          <TabsContent value="vehicles" className="space-y-4 mt-0">
            <StatGrid>
              <StatCard label="Veículos" value={allVehicles.length} icon={Car} tone="blue" hint="cadastrados" />
              <StatCard label="Ativos" value={allVehicles.filter((v) => v.status === 'ATIVO').length} icon={CheckCircle2} tone="emerald" hint="em operação" />
              <StatCard label="Documentos a vencer" value={docsSoonCount} icon={Clock} tone="amber" hint={`em até ${DOC_ALERT_DAYS} dias`} testId="vehicle-docs-soon" />
              <StatCard label="Documentos vencidos" value={docsExpiredCount} icon={AlertTriangle} tone="red" hint="CRLV, licenciamento, tacógrafo, vistoria" testId="vehicle-docs-expired" />
            </StatGrid>

            <FilterCard hasFilters={!!(vehicleSearch || vehicleTypeFilter || vehicleStatusFilter)} onClear={clearVehicleSearch}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <FilterField label="Placa, modelo ou marca">
                  <SearchInput
                    value={vehicleSearch}
                    onChange={(e) => handleVehicleSearchChange(e.target.value.toUpperCase())}
                    data-testid="search-vehicle-input"
                  />
                </FilterField>
                <FilterField label="Tipo">
                  <Select value={vehicleTypeFilter || '_all'} onValueChange={changeVehicleFilter(setVehicleTypeFilter)}>
                    <SelectTrigger className="h-9 text-sm" data-testid="vehicle-type-filter"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">Todos</SelectItem>
                      {vehicleTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="Status">
                  <Select value={vehicleStatusFilter || '_all'} onValueChange={changeVehicleFilter(setVehicleStatusFilter)}>
                    <SelectTrigger className="h-9 text-sm" data-testid="vehicle-status-filter"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all">Todos</SelectItem>
                      {Object.entries(VEHICLE_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FilterField>
              </div>
            </FilterCard>

            {/* Lista - marque um veículo pra habilitar as ações da barra */}
            <DataCard
              title="Veículos"
              count={vehiclePagination.total}
              toolbar={(
                <Toolbar
                  selectedCount={selectedVehicleIds.size}
                  primary={<ToolbarPrimary icon={Plus} label="Novo veículo" onClick={openNewVehicleModal} testId="new-vehicle-btn" />}
                >
                  <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedVehicle && openEditVehicleModal(singleSelectedVehicle)} disabled={!singleSelectedVehicle} />
                  <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedVehicle && handleDeleteVehicle(singleSelectedVehicle.id)} disabled={!singleSelectedVehicle} />
                </Toolbar>
              )}
              footer={(
                <TablePagination
                  currentPage={vehiclePagination.page}
                  totalPages={vehiclePagination.pages}
                  totalItems={vehiclePagination.total}
                  pageSize={15}
                  onPageChange={(page) => setVehiclePagination(prev => ({ ...prev, page }))}
                />
              )}
            >
              {vehiclesLoading ? (
                <EmptyState loading />
              ) : vehicles.length === 0 ? (
                <EmptyState
                  icon={Car}
                  title={vehicleSearch || vehicleTypeFilter || vehicleStatusFilter ? 'Nenhum veículo encontrado' : 'Nenhum veículo cadastrado'}
                  hint={vehicleSearch || vehicleTypeFilter || vehicleStatusFilter ? 'Ajuste os filtros' : 'Cadastre o primeiro pelo botão "Novo veículo"'}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="w-10 pr-0">
                          <Checkbox
                            checked={vehicles.length > 0 && vehicles.every(v => selectedVehicleIds.has(v.id))}
                            onCheckedChange={toggleSelectAllVehiclesOnPage}
                            data-testid="select-all-vehicles-checkbox"
                          />
                        </th>
                        <th>Placa</th>
                        <th>Tipo</th>
                        <th>Marca</th>
                        <th>Modelo</th>
                        <th>Ano</th>
                        <th>Motorista</th>
                        <th>Documentos</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vehicles.map((vehicle) => (
                        <tr
                          key={vehicle.id}
                          onClick={() => toggleSelectVehicle(vehicle.id)}
                          data-selected={selectedVehicleIds.has(vehicle.id)}
                          data-row-tone={rowTone(vehicleRowSituation(vehicle, today))}
                          className="cursor-pointer"
                        >
                          <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedVehicleIds.has(vehicle.id)}
                              onCheckedChange={() => toggleSelectVehicle(vehicle.id)}
                              data-testid="vehicle-row-checkbox"
                            />
                          </td>
                          <td><PlateTag>{vehicle.plate}</PlateTag></td>
                          <td className="whitespace-nowrap">{vehicleTypes.find(t => t.value === vehicle.vehicle_type)?.label || vehicle.vehicle_type}</td>
                          <td>{vehicle.brand || '-'}</td>
                          <td>{vehicle.model || '-'}</td>
                          <td className="tabular-nums">{vehicle.year || '-'}</td>
                          <td><div className="max-w-[220px] truncate" title={vehicle.driver_name || ''}>{vehicle.driver_name || '-'}</div></td>
                          <td className="whitespace-nowrap">
                            {(() => {
                              const docs = vehicleDocsStatus(vehicle, today);
                              return docs
                                ? <StatusPill tone={docs.tone} title={docs.detail}>{docs.label}</StatusPill>
                                : <span className="text-slate-400 dark:text-slate-500">-</span>;
                            })()}
                          </td>
                          <td>
                            <StatusPill tone={VEHICLE_STATUS_TONES[vehicle.status] || 'emerald'}>
                              {VEHICLE_STATUS_LABELS[vehicle.status] || vehicle.status}
                            </StatusPill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DataCard>
          </TabsContent>

          {/* ========== ABA CONTROLE DE REVISÃO ========== */}
          <TabsContent value="revisions" className="space-y-4 mt-0">
            <StatGrid>
              <StatCard label="Revisões" value={pagination.total} icon={Wrench} tone="blue" hint="registradas" />
              <StatCard label="Veículos em dia" value={maintenanceList.filter((m) => m.status === 'OK').length} icon={CheckCircle2} tone="emerald" />
              <StatCard label="Manutenção próxima" value={maintenanceList.filter((m) => m.status === 'DUE_SOON').length} icon={Clock} tone="amber" hint={`até ${MAINTENANCE_MARGIN_KM.toLocaleString('pt-BR')} km`} />
              <StatCard label="Manutenção vencida" value={maintenanceList.filter((m) => m.status === 'OVERDUE').length} icon={AlertTriangle} tone="red" />
            </StatGrid>

            <FilterCard hasFilters={!!searchPlate} onClear={clearRevisionSearch}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <FilterField label="Placa">
                  <SearchInput
                    value={searchPlate}
                    onChange={(e) => handleSearchPlateChange(e.target.value.toUpperCase())}
                    data-testid="search-plate-input"
                  />
                </FilterField>
              </div>
            </FilterCard>

            {/* Lista - marque uma revisão pra habilitar as ações da barra */}
            <DataCard
              title="Revisões"
              count={pagination.total}
              toolbar={(
                <Toolbar
                  selectedCount={selectedRevisionIds.size}
                  primary={<ToolbarPrimary icon={Plus} label="Nova revisão" onClick={() => navigate('/fleet/revisoes/new')} testId="new-revision-btn" />}
                >
                  <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedRevision && handleViewDetails(singleSelectedRevision)} disabled={!singleSelectedRevision} />
                  <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedRevision && navigate(`/fleet/revisoes/${singleSelectedRevision.id}/edit`)} disabled={!singleSelectedRevision} testId="edit-revision-btn" />
                  <ToolbarButton icon={Printer} label="Imprimir PDF" tone="emerald" onClick={() => singleSelectedRevision && handlePrintPDF(singleSelectedRevision.id)} disabled={!singleSelectedRevision} />
                  <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedRevision && handleDelete(singleSelectedRevision.id)} disabled={!singleSelectedRevision} />
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
              ) : revisions.length === 0 ? (
                <EmptyState
                  icon={Wrench}
                  title="Nenhuma revisão encontrada"
                  hint={searchPlate ? 'Ajuste a busca' : 'Registre a primeira pelo botão "Nova revisão"'}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="w-10 pr-0">
                          <Checkbox
                            checked={revisions.length > 0 && revisions.every(r => selectedRevisionIds.has(r.id))}
                            onCheckedChange={toggleSelectAllRevisionsOnPage}
                            data-testid="select-all-checkbox"
                          />
                        </th>
                        <th>Nº</th>
                        <th>Placa</th>
                        <th>Modelo</th>
                        <th>Data</th>
                        <th className="!text-right">KM atual</th>
                        <th>Óleo</th>
                        <th>Mecânico</th>
                        <th>Situação do veículo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revisions.map((revision) => (
                        <tr
                          key={revision.id}
                          onClick={() => toggleSelectRevision(revision.id)}
                          data-selected={selectedRevisionIds.has(revision.id)}
                          className="cursor-pointer"
                        >
                          <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedRevisionIds.has(revision.id)}
                              onCheckedChange={() => toggleSelectRevision(revision.id)}
                              data-testid="revision-row-checkbox"
                            />
                          </td>
                          <td className="cell-strong whitespace-nowrap tabular-nums">#{revision.revision_number}</td>
                          <td><PlateTag>{revision.vehicle_plate}</PlateTag></td>
                          <td>{revision.vehicle_model || '-'}</td>
                          <td className="whitespace-nowrap tabular-nums">
                            {format(calendarDate(revision.revision_date), 'dd/MM/yyyy', { locale: ptBR })}
                          </td>
                          <td className="text-right whitespace-nowrap tabular-nums">{formatKM(revision.current_km)}</td>
                          <td><div className="max-w-[200px] truncate" title={revision.oil_used || ''}>{revision.oil_used || '-'}</div></td>
                          <td><div className="max-w-[200px] truncate" title={revision.mechanic_name || ''}>{revision.mechanic_name || '-'}</div></td>
                          <td>
                            {(() => {
                              const m = maintenanceByPlate[revision.vehicle_plate];
                              const badge = m && MAINTENANCE_BADGES[m.status];
                              return badge
                                ? <StatusPill tone={badge.tone} title={(m.next_due_items || []).join(', ')}>{badge.label}</StatusPill>
                                : <span className="text-slate-400 dark:text-slate-500">-</span>;
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DataCard>
          </TabsContent>
        </Tabs>
      </div>

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
                  <p className="font-bold">{format(calendarDate(selectedRevision.revision_date), 'dd/MM/yyyy')}</p>
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
                <p className="text-sm text-muted-foreground mb-2">Foto do Km (Hodômetro)</p>
                {selectedRevision.current_km_photo_url ? (
                  <div className="relative inline-block">
                    <img
                      src={api.getFileUrl(selectedRevision.current_km_photo_url)}
                      alt="Foto do Km"
                      className="w-48 h-32 object-cover rounded-lg border"
                    />
                    <Button title="Remover" aria-label="Remover"
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6"
                      onClick={handleDetailKmPhotoRemove}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={uploadingDetailKmPhoto} onClick={() => document.getElementById('detail-km-photo-camera-input').click()}>
                      {uploadingDetailKmPhoto ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                      Câmera
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={uploadingDetailKmPhoto} onClick={() => document.getElementById('detail-km-photo-gallery-input').click()}>
                      <Upload className="w-4 h-4 mr-2" />
                      Galeria
                    </Button>
                    <input
                      id="detail-km-photo-camera-input"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => { handleDetailKmPhotoUpload(e.target.files?.[0]); e.target.value = ''; }}
                    />
                    <input
                      id="detail-km-photo-gallery-input"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => { handleDetailKmPhotoUpload(e.target.files?.[0]); e.target.value = ''; }}
                    />
                  </div>
                )}
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
          <div className="space-y-2">
            <div className="flex flex-col items-start gap-1">
              <DocumentImportButton kinds={['crlv']} onRead={handleCrlvRead} disabled={vehicleSaving} />
            </div>
            <DocumentImportNotice notice={vehicleImportNotice} onClose={() => setVehicleImportNotice(null)} />
          </div>

          <div className="space-y-5">
            <FormSectionTitle>Identificação</FormSectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Placa *</Label>
                <Input
                  className={importedClass('plate')} value={vehicleForm.plate}
                  onChange={(e) => handleVehicleFormChange('plate', formatPlate(e.target.value))}
                  data-testid="input-vehicle-plate-form"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Tipo *</Label>
                <Select
                  value={vehicleForm.vehicle_type}
                  onValueChange={(value) => handleVehicleFormChange('vehicle_type', value)}
                >
                  <SelectTrigger className={importedClass('vehicle_type')}>
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
                <Label className="mb-1.5 block">Categoria</Label>
                <Select value={vehicleForm.category} onValueChange={(value) => handleVehicleFormChange('category', value)}>
                  <SelectTrigger className={importedClass('category')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Cor</Label>
                <Input className={importedClass('color')} value={vehicleForm.color} onChange={(e) => handleVehicleFormChange('color', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">Nº Patrimônio/Cód. Interno</Label>
                <Input value={vehicleForm.asset_code} onChange={(e) => handleVehicleFormChange('asset_code', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Marca</Label>
                <Input
                  className={importedClass('brand')} value={vehicleForm.brand}
                  onChange={(e) => handleVehicleFormChange('brand', e.target.value)}
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Modelo</Label>
                <Input
                  className={importedClass('model')} value={vehicleForm.model}
                  onChange={(e) => handleVehicleFormChange('model', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Ano de Fabricação</Label>
                <Input
                  type="number" min="0"
                  className={importedClass('year')} value={vehicleForm.year}
                  onChange={(e) => handleVehicleFormChange('year', e.target.value)}
                  min="1900"
                  max="2100"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Ano Modelo</Label>
                <Input
                  type="number" min="0"
                  className={importedClass('model_year')} value={vehicleForm.model_year}
                  onChange={(e) => handleVehicleFormChange('model_year', e.target.value)}
                  min="1900"
                  max="2100"
                />
              </div>
            </div>

            <FormSectionTitle>Especificações</FormSectionTitle>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="mb-1.5 block">Capacidade de Carga</Label>
                <Input className={importedClass('load_capacity')} value={vehicleForm.load_capacity} onChange={(e) => handleVehicleFormChange('load_capacity', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">Nº de Eixos</Label>
                <Input type="number" min="0" className={importedClass('axle_count')} value={vehicleForm.axle_count} onChange={(e) => handleVehicleFormChange('axle_count', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">Tipo de Carroceria/Implemento</Label>
                <Input className={importedClass('body_type')} value={vehicleForm.body_type} onChange={(e) => handleVehicleFormChange('body_type', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="mb-1.5 block">Combustível</Label>
                <Select value={vehicleForm.fuel_type} onValueChange={(value) => handleVehicleFormChange('fuel_type', value)}>
                  <SelectTrigger className={importedClass('fuel_type')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {fuelOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Capacidade do Tanque</Label>
                <Input value={vehicleForm.tank_capacity} onChange={(e) => handleVehicleFormChange('tank_capacity', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">Meta de Consumo (km/L)</Label>
                <Input inputMode="decimal" value={vehicleForm.fuel_target_km_l} onChange={(e) => handleVehicleFormChange('fuel_target_km_l', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">Potência do Motor</Label>
                <Input className={importedClass('engine_power')} value={vehicleForm.engine_power} onChange={(e) => handleVehicleFormChange('engine_power', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Tara (peso vazio)</Label>
                <Input value={vehicleForm.tare_weight} onChange={(e) => handleVehicleFormChange('tare_weight', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">PBT (Peso Bruto Total)</Label>
                <Input className={importedClass('gross_weight')} value={vehicleForm.gross_weight} onChange={(e) => handleVehicleFormChange('gross_weight', e.target.value)} />
              </div>
            </div>

            <FormSectionTitle>Documentação</FormSectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">RENAVAM</Label>
                <Input className={importedClass('renavam')} value={vehicleForm.renavam} onChange={(e) => handleVehicleFormChange('renavam', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">Chassi</Label>
                <Input className={importedClass('chassis')} value={vehicleForm.chassis} onChange={(e) => handleVehicleFormChange('chassis', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Número do CRLV</Label>
                <Input className={importedClass('crlv_number')} value={vehicleForm.crlv_number} onChange={(e) => handleVehicleFormChange('crlv_number', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">Validade do CRLV</Label>
                <Input type="date" value={vehicleForm.crlv_expiry} onChange={(e) => handleVehicleFormChange('crlv_expiry', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Vencimento do Licenciamento</Label>
                <Input type="date" value={vehicleForm.licensing_expiry} onChange={(e) => handleVehicleFormChange('licensing_expiry', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">Vencimento do Tacógrafo</Label>
                <Input type="date" value={vehicleForm.tachograph_expiry} onChange={(e) => handleVehicleFormChange('tachograph_expiry', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Data da Vistoria</Label>
                <Input type="date" value={vehicleForm.inspection_date} onChange={(e) => handleVehicleFormChange('inspection_date', e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block">Validade da Vistoria</Label>
                <Input type="date" value={vehicleForm.inspection_expiry} onChange={(e) => handleVehicleFormChange('inspection_expiry', e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block">Documentos anexados (CRLV...)</Label>
              <DocumentAttachments
                value={vehicleForm.document_attachments}
                onChange={(v) => handleVehicleFormChange('document_attachments', v)}
              />
            </div>

            <FormSectionTitle>Vínculo</FormSectionTitle>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="mb-1.5 block">Proprietário</Label>
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
                <Label className="mb-1.5 block">Status de Propriedade</Label>
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
                <Label className="mb-1.5 block">Transportadora Vinculada</Label>
                <Autocomplete
                  value={vehicleForm.transport_company}
                  onChange={(v) => handleVehicleFormChange('transport_company', v)}
                  onSelect={(c) => handleVehicleFormChange('transport_company', c.name)}
                  options={transportCompanies}
                  displayField="name"
                />
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block">Status</Label>
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
              <Label className="mb-1.5 block">Motorista Responsável</Label>
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
              <Label className="mb-1.5 block">Observações</Label>
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
              {vehicleSaving ? 'Salvando...' : (editingVehicle ? 'Salvar alterações' : 'Cadastrar veículo')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PeriodReportDialog
        open={revisionReportOpen}
        onOpenChange={setRevisionReportOpen}
        title="Relatório de Revisões da Frota"
        description="Revisões do período por veículo, a situação de manutenção de hoje de cada veículo ativo (troca vencida, próxima ou em dia) e os veículos que ainda não têm nenhuma revisão lançada."
        periodLabel="Data da revisão"
        textFilters={[{ key: 'plate', label: 'Placa ou modelo' }]}
        load={api.getRevisionsReport}
        summarize={(d) => [
          ['Revisões no período', `${d.summary.revisions} em ${d.summary.vehicles_revised} veículo(s)`],
          ['Troca vencida', d.summary.overdue],
          ['Troca próxima', d.summary.due_soon],
          ['Sem revisão lançada', d.summary.without_revision],
        ]}
        downloadPdf={api.getRevisionsReportPdf}
        downloadExcel={api.getRevisionsReportExcel}
        filename="relatorio_revisoes"
      />
      <ConfirmDialog />
    </Layout>
  );
}
