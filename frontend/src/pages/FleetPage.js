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
import { Tabs, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Wrench, Plus, Eye, Trash2, Printer, Pencil, Car, Camera, Upload, X, Loader2, CheckCircle2, Clock, AlertTriangle, FileBarChart } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { compressImage } from '../lib/imageCompression';
import { calendarDate, toDateInput, todayISO } from '../lib/dates';
import { useUrlState } from '../hooks/useUrlState';
import { apiErrorMessage } from '../lib/errors';
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
  ['insurance_expiry', 'Seguro'],
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

  // As duas buscas filtram enquanto se digita (sem botão "Filtrar") e valem
  // também ao trocar de página e ao recarregar depois de salvar.
  const debouncedVehicleSearch = useDebouncedValue(vehicleSearch.trim());
  const debouncedPlate = useDebouncedValue(searchPlate.trim());

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
      toast.error(apiErrorMessage(error, 'Erro ao carregar veículos'));
    } finally {
      setVehiclesLoading(false);
    }
  };

  const handleVehicleSearchChange = (value) => {
    setVehicleSearch(value);
    setVehiclePagination(prev => ({ ...prev, page: 1 }));
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
      toast.error(apiErrorMessage(error, 'Erro ao excluir veículo'));
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
      toast.error(apiErrorMessage(error, 'Erro ao carregar revisões'));
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
      toast.error(apiErrorMessage(error, 'Erro ao excluir revisão'));
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
      toast.error(apiErrorMessage(error, 'Erro ao enviar foto do Km'));
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
      toast.error(apiErrorMessage(error, 'Erro ao remover foto do Km'));
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
      toast.error(apiErrorMessage(error, 'Erro ao gerar PDF'));
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
              <StatCard label="Documentos vencidos" value={docsExpiredCount} icon={AlertTriangle} tone="red" hint="CRLV, licenciamento, tacógrafo, vistoria, seguro" testId="vehicle-docs-expired" />
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
                  primary={<ToolbarPrimary icon={Plus} label="Novo veículo" onClick={() => navigate('/fleet/veiculos/new')} testId="new-vehicle-btn" />}
                >
                  <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedVehicle && navigate(`/fleet/veiculos/${singleSelectedVehicle.id}/edit`)} disabled={!singleSelectedVehicle} />
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
                          onDoubleClick={() => navigate(`/fleet/veiculos/${vehicle.id}/edit`)}
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
