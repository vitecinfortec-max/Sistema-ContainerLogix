import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import { Gauge, Plus, Trash2 } from 'lucide-react';
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
  OK: { label: 'OK', color: 'bg-green-100 text-green-800' },
  DUE_SOON: { label: 'Próximo', color: 'bg-amber-100 text-amber-800' },
  OVERDUE: { label: 'Vencido', color: 'bg-red-100 text-red-800' },
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

  const toggleSelectAllOnPage = () => {
    setSelectedIds(prev => {
      const pageIds = readings.map(r => r.id);
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
      <div className="space-y-5" data-testid="odometer-readings-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Lançamento de Hodômetro</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Registre a quilometragem dos veículos e acompanhe quando a próxima manutenção está próxima</p>
        </div>

        {/* Situação de Manutenção */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Gauge className="w-4 h-4" />
              Situação de Manutenção
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingStatus ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : maintenanceStatus.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                Nenhum veículo com Revisão registrada ainda
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Placa</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Modelo</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">KM Atual</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Próxima Manutenção</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">KM Restante</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maintenanceStatus.map((m, idx) => {
                      const badge = STATUS_BADGES[m.status] || STATUS_BADGES.OK;
                      return (
                        <tr key={m.vehicle_id} className={idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}>
                          <td className="px-4 py-2.5 text-sm font-mono font-semibold text-slate-800 dark:text-slate-200">{m.vehicle_plate}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{m.vehicle_model || '-'}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtKm(m.current_km)}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtKm(m.next_due_km)}</td>
                          <td className="px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">{fmtKm(m.km_remaining)}</td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${badge.color}`}>{badge.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openNewModal}
            className="h-9 w-9 p-0"
            title="Novo Lançamento"
            data-testid="new-odometer-reading-btn"
          >
            <Plus className="w-4 h-4 text-primary" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={selectedIds.size === 0}
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
              <Gauge className="w-4 h-4" />
              Lançamentos de Hodômetro ({pagination.total})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : readings.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                Nenhum lançamento de hodômetro registrado ainda
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left w-10">
                        <Checkbox
                          checked={readings.length > 0 && readings.every(r => selectedIds.has(r.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Placa</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">KM</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Observações</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Criado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readings.map((r, idx) => {
                      const isSelected = selectedIds.has(r.id);
                      return (
                        <tr
                          key={r.id}
                          className={`cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 hover:bg-primary/15' : `hover:bg-slate-50 dark:hover:bg-slate-800/80 ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}`}
                          onClick={() => toggleSelect(r.id)}
                        >
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(r.id)} />
                          </td>
                          <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{r.reading_number}</td>
                          <td className="px-4 py-2.5 text-sm font-mono text-slate-600 dark:text-slate-400">{r.vehicle_plate}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtKm(r.km)}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtDate(r.reading_date)}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{r.observations || '-'}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                            {r.created_at && format(new Date(r.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {pagination.pages > 1 && (
              <div className="flex justify-center gap-2 mt-4 pb-4">
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
                  type="number"
                  step="1"
                  min="0"
                  className="h-9"
                  value={formData.km}
                  onChange={(e) => setFormData(prev => ({ ...prev, km: e.target.value }))}
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
