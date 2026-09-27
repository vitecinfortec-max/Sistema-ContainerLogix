import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, StatusPill, PlateTag, EmptyState, TablePagination,
} from '../components/DataPage';
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
import { Gauge, Plus, Trash2, Truck, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const fmtKm = (v) => v === null || v === undefined ? '-' : `${Number(v).toLocaleString('pt-BR')} km`;

const fmtDate = (d) => {
  if (!d) return '-';
  try {
    return format(new Date(d + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR });
  } catch (e) {
    return d;
  }
};

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
    reading_date: new Date().toISOString().split('T')[0],
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
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(createEmptyForm());

  useEffect(() => {
    loadMaintenanceStatus();
    loadReadings();
    loadVehicles();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page]);

  const loadMaintenanceStatus = async () => {
    setLoadingStatus(true);
    try {
      const response = await api.getVehicleMaintenanceStatus();
      setMaintenanceStatus(response.data || []);
    } catch (error) {
      toast.error('Erro ao carregar situação de manutenção');
    } finally {
      setLoadingStatus(false);
    }
  };

  const loadReadings = async () => {
    setLoading(true);
    try {
      const response = await api.getOdometerReadings({ page: pagination.page, per_page: 20 });
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
    setFormData(createEmptyForm());
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.vehicle_id || !formData.km || !formData.reading_date) {
      toast.error('Preencha Veículo, KM e Data');
      return;
    }

    setSaving(true);
    try {
      await api.createOdometerReading({ ...formData, km: Number(formData.km) });
      toast.success('Lançamento de hodômetro criado com sucesso!');
      setModalOpen(false);
      setPagination(prev => ({ ...prev, page: 1 }));
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
            <EmptyState title="Carregando..." />
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
                    <th className="!text-right">Próxima manutenção</th>
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
                        <td className="text-right whitespace-nowrap tabular-nums">{fmtKm(m.next_due_km)}</td>
                        <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtKm(m.km_remaining)}</td>
                        <td><StatusPill tone={badge.tone}>{badge.label}</StatusPill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        {/* Lista - só lançamentos manuais podem ser selecionados (os de
            Abastecimento são excluídos pela tela de Abastecimento) */}
        <DataCard
          title="Lançamentos de hodômetro"
          count={pagination.total}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo lançamento" onClick={openNewModal} testId="new-odometer-reading-btn" />}
            >
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
            <EmptyState title="Carregando..." />
          ) : readings.length === 0 ? (
            <EmptyState icon={Gauge} title="Nenhum lançamento de hodômetro registrado ainda" hint='Registre o primeiro pelo botão "Novo lançamento"' />
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
                    <th>Criado em</th>
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
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{r.reading_number}</td>
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
                          {r.created_at && format(new Date(r.created_at), 'dd/MM/yyyy', { locale: ptBR })}
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
              Novo Lançamento de Hodômetro
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label>Veículo *</Label>
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
                <Label>KM *</Label>
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
                <Label>Data *</Label>
                <Input
                  type="date"
                  className="h-9"
                  value={formData.reading_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, reading_date: e.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Observações</Label>
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
