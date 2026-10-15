import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, StatusPill,
  PlateTag, EmptyState, TablePagination,
} from '../components/DataPage';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { sanitizeKmInput } from '../lib/utils';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import { Gauge, Plus, Trash2, Truck, CheckCircle2, Clock, AlertTriangle, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { todayISO } from '../lib/dates';

const fmtKm = (v) => v === null || v === undefined ? '-' : `${Number(v).toLocaleString('pt-BR')} km`;

const fmtDate = (d) => {
  if (!d) return '-';
  try {
    return format(new Date(d + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR });
  } catch (e) {
    return d;
  }
};

// "KM restante" negativo vira "vencido há X km"
const fmtRemaining = (v) => {
  if (v === null || v === undefined) return '-';
  return v <= 0 ? `vencido há ${fmtKm(Math.abs(v))}` : fmtKm(v);
};

const REMAINING_TONE = { OVERDUE: '!text-red-600 dark:!text-red-400', DUE_SOON: '!text-amber-600 dark:!text-amber-400' };

const STATUS_ORDER = { OVERDUE: 0, DUE_SOON: 1, OK: 2 };

const STATUS_BADGES = {
  OK: { label: 'OK', tone: 'emerald' },
  DUE_SOON: { label: 'Próximo', tone: 'amber' },
  OVERDUE: { label: 'Vencido', tone: 'red' },
};

function createEmptyForm() {
  return {
    vehicle_id: '',
    vehicle_plate: '',
    km: '',
    reading_date: todayISO(),
    observations: '',
  };
}

export default function OdometerReadingsPage() {
  const { confirm, ConfirmDialog } = useConfirm();

  // Situação de Manutenção
  const [maintenanceStatus, setMaintenanceStatus] = useState([]);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Lançamento de Hodômetro
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [vehicles, setVehicles] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(createEmptyForm());

  // Filtros da lista (filtram enquanto se digita)
  const [plateFilter, setPlateFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const debouncedPlate = useDebouncedValue(plateFilter.trim());

  useEffect(() => {
    loadMaintenanceStatus();
    loadVehicles();
  }, []);

  useEffect(() => {
    loadReadings();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, debouncedPlate, sourceFilter]);

  const onFilter = (setter) => (value) => {
    setter(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const loadMaintenanceStatus = async () => {
    setLoadingStatus(true);
    try {
      const response = await api.getVehicleMaintenanceStatus();
      // Mais urgente primeiro: vencidos, depois próximos, cada grupo pelo KM restante
      const list = [...(response.data || [])].sort((a, b) =>
        (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || (a.km_remaining ?? 0) - (b.km_remaining ?? 0));
      setMaintenanceStatus(list);
    } catch (error) {
      toast.error('Erro ao carregar situação de manutenção');
    } finally {
      setLoadingStatus(false);
    }
  };

  const loadReadings = async () => {
    try {
      const params = { page: pagination.page, per_page: 20 };
      if (debouncedPlate) params.vehicle_plate = debouncedPlate;
      if (sourceFilter !== 'all') params.source = sourceFilter;
      const response = await api.getOdometerReadings(params);
      setReadings(response.data.items);
      setPagination(prev => ({ ...prev, pages: response.data.pages, total: response.data.total }));
    } catch (error) {
      toast.error('Erro ao carregar lançamentos de hodômetro');
    } finally {
      setLoading(false);
    }
  };

  const loadVehicles = async () => {
    try {
      const response = await api.getVehicles({ per_page: 1000 });
      setVehicles(response.data.items || []);
    } catch (error) {
      console.error('Erro ao carregar veículos:', error);
    }
  };

  const cavalos = vehicles.filter(v => v.vehicle_type === 'CAVALO' || v.vehicle_type === 'CAMINHÃO');

  const openNewModal = () => {
    setEditingId(null);
    setFormData(createEmptyForm());
    setModalOpen(true);
  };

  const singleSelected = selectedIds.size === 1 ? readings.find(r => r.id === [...selectedIds][0]) : null;

  const openEditModal = () => {
    if (!singleSelected) return;
    setEditingId(singleSelected.id);
    setFormData({
      vehicle_id: singleSelected.vehicle_id,
      vehicle_plate: singleSelected.vehicle_plate,
      km: String(singleSelected.km ?? ''),
      reading_date: singleSelected.reading_date || todayISO(),
      observations: singleSelected.observations || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.vehicle_id || !formData.km || !formData.reading_date) {
      toast.error('Preencha Veículo, KM e Data');
      return;
    }

    setSaving(true);
    try {
      const payload = { ...formData, km: Number(formData.km) };
      if (editingId) {
        await api.updateOdometerReading(editingId, payload);
        toast.success('Lançamento atualizado!');
      } else {
        await api.createOdometerReading(payload);
        toast.success('Lançamento de hodômetro criado com sucesso!');
        setPagination(prev => ({ ...prev, page: 1 }));
      }
      setModalOpen(false);
      loadReadings();
      loadMaintenanceStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar lançamento');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirm(`Deseja realmente excluir ${selectedIds.size} lançamento(s) de hodômetro?`))) return;

    try {
      await Promise.all([...selectedIds].map(id => api.deleteOdometerReading(id)));
      toast.success('Lançamento(s) excluído(s)');
      setSelectedIds(new Set());
      loadReadings();
      loadMaintenanceStatus();
    } catch (error) {
      toast.error('Erro ao excluir lançamento');
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const countByStatus = (status) => maintenanceStatus.filter((m) => m.status === status).length;

  const toggleSelectAllOnPage = () => {
    setSelectedIds(prev => {
      const pageIds = readings.filter(r => r.source === 'MANUAL').map(r => r.id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="odometer-readings-page">
        <PageHeader
          icon={Gauge}
          title="Lançamento de Hodômetro"
          subtitle="Registre a quilometragem dos veículos e acompanhe quando a próxima manutenção está próxima"
        />

        <StatGrid>
          <StatCard label="Veículos acompanhados" value={maintenanceStatus.length} icon={Truck} tone="blue" hint="com revisão registrada" />
          <StatCard label="Em dia" value={countByStatus('OK')} icon={CheckCircle2} tone="emerald" />
          <StatCard label="Manutenção próxima" value={countByStatus('DUE_SOON')} icon={Clock} tone="amber" />
          <StatCard label="Manutenção vencida" value={countByStatus('OVERDUE')} icon={AlertTriangle} tone="red" />
        </StatGrid>

        {/* Situação de Manutenção */}
        <DataCard title="Situação de manutenção" count={loadingStatus ? '...' : maintenanceStatus.length}>
          {loadingStatus ? (
            <EmptyState loading />
          ) : maintenanceStatus.length === 0 ? (
            <EmptyState icon={Gauge} title="Nenhum veículo com Revisão registrada ainda" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Placa</th>
                    <th>Modelo</th>
                    <th className="!text-right">KM atual</th>
                    <th>Próximo item</th>
                    <th className="!text-right">Vence em</th>
                    <th className="!text-right">KM restante</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenanceStatus.map((m) => {
                    const badge = STATUS_BADGES[m.status] || STATUS_BADGES.OK;
                    return (
                      <tr key={m.vehicle_id}>
                        <td><PlateTag>{m.vehicle_plate}</PlateTag></td>
                        <td>{m.vehicle_model || '-'}</td>
                        <td className="text-right whitespace-nowrap tabular-nums">{fmtKm(m.current_km)}</td>
                        <td><div className="max-w-[240px] truncate" title={(m.next_due_items || []).join(', ')}>{(m.next_due_items || []).join(', ') || '-'}</div></td>
                        <td className="text-right whitespace-nowrap tabular-nums">{fmtKm(m.next_due_km)}</td>
                        <td className={`text-right whitespace-nowrap tabular-nums cell-strong ${REMAINING_TONE[m.status] || ''}`}>{fmtRemaining(m.km_remaining)}</td>
                        <td><StatusPill tone={badge.tone}>{badge.label}</StatusPill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        <FilterCard hasFilters={!!plateFilter || sourceFilter !== 'all'} onClear={() => { setPlateFilter(''); onFilter(setSourceFilter)('all'); }}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Placa">
              <SearchInput value={plateFilter} onChange={(e) => onFilter(setPlateFilter)(e.target.value.toUpperCase())} data-testid="odometer-plate-filter" />
            </FilterField>
            <FilterField label="Origem">
              <Select value={sourceFilter} onValueChange={onFilter(setSourceFilter)}>
                <SelectTrigger className="h-9 text-sm" data-testid="odometer-source-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="MANUAL">Manual</SelectItem>
                  <SelectItem value="ABASTECIMENTO">Abastecimento</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - só lançamentos manuais podem ser selecionados (os de
            Abastecimento são corrigidos na tela de Abastecimento) */}
        <DataCard
          title="Lançamentos de hodômetro"
          count={pagination.total}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo lançamento" onClick={openNewModal} testId="new-odometer-reading-btn" />}
            >
              <ToolbarButton icon={Edit} label="Editar" tone="blue" onClick={openEditModal} disabled={!singleSelected} testId="edit-odometer-reading-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={selectedIds.size === 0} />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              pageSize={20}
              onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            />
          )}
        >
          {loading ? (
            <EmptyState loading />
          ) : readings.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title={plateFilter || sourceFilter !== 'all' ? 'Nenhum lançamento encontrado' : 'Nenhum lançamento de hodômetro registrado ainda'}
              hint={plateFilter || sourceFilter !== 'all' ? 'Ajuste os filtros' : 'Registre o primeiro pelo botão "Novo lançamento"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={readings.some(r => r.source === 'MANUAL') && readings.filter(r => r.source === 'MANUAL').every(r => selectedIds.has(r.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Nº</th>
                    <th>Placa</th>
                    <th className="!text-right">KM</th>
                    <th>Data</th>
                    <th>Origem</th>
                    <th>Observações</th>
                    <th>Lançado em</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => {
                    const isManual = r.source === 'MANUAL';
                    const isSelected = isManual && selectedIds.has(r.id);
                    return (
                      <tr
                        key={r.id}
                        data-selected={isSelected}
                        className={isManual ? 'cursor-pointer' : ''}
                        onClick={() => isManual && toggleSelect(r.id)}
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          {isManual && <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(r.id)} />}
                        </td>
                        {/* Leitura de Abastecimento leva o nº do abastecimento - outra numeração */}
                        <td className="whitespace-nowrap tabular-nums">
                          {isManual
                            ? <span className="cell-strong">#{r.reading_number}</span>
                            : <span className="text-slate-500 dark:text-slate-400" title="Número do abastecimento">Abast. #{r.reading_number}</span>}
                        </td>
                        <td><PlateTag>{r.vehicle_plate}</PlateTag></td>
                        <td className="text-right whitespace-nowrap tabular-nums">{fmtKm(r.km)}</td>
                        <td className="whitespace-nowrap tabular-nums">{fmtDate(r.reading_date)}</td>
                        <td>
                          <StatusPill tone={isManual ? 'slate' : 'primary'} dot={false}>
                            {isManual ? 'Manual' : 'Abastecimento'}
                          </StatusPill>
                        </td>
                        <td><div className="max-w-[260px] truncate" title={r.observations || ''}>{r.observations || '-'}</div></td>
                        <td className="whitespace-nowrap tabular-nums">
                          {r.created_at ? format(new Date(r.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-'}
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

      {/* Modal Novo Lançamento */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Gauge className="w-4 h-4 text-primary" />
              {editingId ? 'Editar Lançamento de Hodômetro' : 'Novo Lançamento de Hodômetro'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label className="mb-1.5 block">Veículo *</Label>
                <Autocomplete
                  value={formData.vehicle_plate}
                  onChange={(val) => setFormData(prev => ({ ...prev, vehicle_plate: val.toUpperCase(), vehicle_id: '' }))}
                  options={cavalos}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  valueField="id"
                  onSelect={(vehicle) => setFormData(prev => ({ ...prev, vehicle_id: vehicle.id, vehicle_plate: vehicle.plate }))}
                />
              </div>
              <div>
                <Label className="mb-1.5 block">KM *</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  className="h-9"
                  value={formData.km}
                  onChange={(e) => {
                    const v = sanitizeKmInput(e.target.value);
                    if (v !== null) setFormData(prev => ({ ...prev, km: v }));
                  }}
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Data *</Label>
                <Input
                  type="date"
                  className="h-9"
                  value={formData.reading_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, reading_date: e.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1.5 block">Observações</Label>
                <Input
                  value={formData.observations}
                  onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving} data-testid="save-odometer-reading-btn">
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </Layout>
  );
}
