import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, DataCard, PlateTag, EmptyState,
} from '../components/DataPage';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Autocomplete } from '../components/Autocomplete';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { TrendingUp, TrendingDown, Truck, Gauge, AlertTriangle, Target, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const fmtKm = (v) => v === null || v === undefined ? '-' : `${Number(v).toLocaleString('pt-BR')} km`;
const fmtAvg = (v) => v === null || v === undefined ? '-' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km/L`;
const fmtLiters = (v) => v === null || v === undefined ? '-' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;

const fmtDate = (d) => {
  if (!d) return '-';
  try {
    return format(new Date(d + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR });
  } catch (e) {
    return d;
  }
};

export default function FuelConsumptionPage() {
  // Média Atual por Veículo
  const [summary, setSummary] = useState([]);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // Histórico de Cálculos
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [vehicles, setVehicles] = useState([]);
  const [vehiclePlateFilter, setVehiclePlateFilter] = useState('');

  // Meta de km/L do veículo: { vehicle_id, vehicle_plate, value }
  const [targetDialog, setTargetDialog] = useState(null);
  const [savingTarget, setSavingTarget] = useState(false);

  useEffect(() => {
    loadSummary();
    loadHistory();
    loadVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSummary = async () => {
    setLoadingSummary(true);
    try {
      const response = await api.getFuelConsumptionSummary();
      setSummary(response.data || []);
    } catch (error) {
      toast.error('Erro ao carregar médias por veículo');
    } finally {
      setLoadingSummary(false);
    }
  };

  const loadHistory = async (plate) => {
    setLoadingHistory(true);
    try {
      const response = await api.getFuelConsumptionHistory(plate ? { vehicle_plate: plate } : {});
      setHistory(response.data || []);
    } catch (error) {
      toast.error('Erro ao carregar histórico de cálculos');
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadVehicles = async () => {
    try {
      const response = await api.getVehicles({ per_page: 1000 });
      const items = response.data.items || [];
      setVehicles(items.filter(v => v.vehicle_type === 'CAVALO' || v.vehicle_type === 'CAMINHÃO'));
    } catch (error) {
      console.error('Erro ao carregar veículos:', error);
    }
  };

  const handleFilterChange = (val) => {
    setVehiclePlateFilter(val);
    loadHistory(val);
  };

  const openTargetDialog = (s) => setTargetDialog({
    vehicle_id: s.vehicle_id,
    vehicle_plate: s.vehicle_plate,
    value: s.target ? String(s.target).replace('.', ',') : '',
  });

  const saveTarget = async () => {
    const raw = String(targetDialog.value || '').trim().replace(',', '.');
    const value = raw === '' ? null : Number(raw);
    if (value !== null && !(value > 0)) {
      toast.error('Informe uma meta maior que zero, ou deixe vazio para remover');
      return;
    }
    setSavingTarget(true);
    try {
      await api.updateVehicle(targetDialog.vehicle_id, { fuel_target_km_l: value });
      toast.success(value ? 'Meta de consumo salva' : 'Meta de consumo removida');
      setTargetDialog(null);
      loadSummary();
      loadHistory(vehiclePlateFilter);
    } catch (error) {
      toast.error(error.response?.data?.detail?.toString?.() || 'Erro ao salvar a meta');
    } finally {
      setSavingTarget(false);
    }
  };

  // Indicadores do topo - só veículos que já têm média calculada
  const averages = summary.filter((s) => s.current_average !== null && s.current_average !== undefined);
  const fleetAverage = averages.length
    ? averages.reduce((acc, s) => acc + Number(s.current_average), 0) / averages.length
    : null;
  const best = averages.reduce((acc, s) => (!acc || s.current_average > acc.current_average ? s : acc), null);
  const worst = averages.reduce((acc, s) => (!acc || s.current_average < acc.current_average ? s : acc), null);
  const belowTarget = summary.filter((s) => s.below_target);

  return (
    <Layout>
      <div className="space-y-4" data-testid="fuel-consumption-page">
        <PageHeader
          icon={TrendingUp}
          title="Controle de Média"
          subtitle="Média de consumo (km/L) calculada automaticamente a partir do KM lançado em cada Abastecimento"
        />

        <StatGrid className="lg:grid-cols-5">
          <StatCard label="Veículos com média" value={averages.length} icon={Truck} tone="blue" hint="com 2+ abastecimentos" />
          <StatCard label="Média da frota" value={fmtAvg(fleetAverage)} icon={Gauge} tone="primary" hint="média entre os veículos" />
          <StatCard label="Melhor média" value={fmtAvg(best?.current_average)} icon={TrendingUp} tone="emerald" hint={best?.vehicle_plate || '-'} />
          <StatCard label="Menor média" value={fmtAvg(worst?.current_average)} icon={TrendingDown} tone="amber" hint={worst?.vehicle_plate || '-'} />
          <StatCard
            label="Abaixo da meta" value={belowTarget.length} icon={AlertTriangle} tone="red"
            hint={belowTarget.length ? belowTarget.map((s) => s.vehicle_plate).join(', ') : 'nenhum veículo'}
          />
        </StatGrid>

        {/* Média Atual por Veículo */}
        <DataCard title="Média atual por veículo" count={loadingSummary ? '...' : summary.length}>
          {loadingSummary ? (
            <EmptyState loading />
          ) : summary.length === 0 ? (
            <EmptyState icon={TrendingUp} title="Nenhum veículo com pelo menos 2 abastecimentos registrados ainda" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Placa</th>
                    <th>Modelo</th>
                    <th className="!text-right">Média atual</th>
                    <th className="!text-right">Meta</th>
                    <th>Último abastecimento</th>
                    <th className="!text-right">Qtd. de cálculos</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr key={s.vehicle_id} data-testid={`consumption-row-${s.vehicle_plate}`}>
                      <td><PlateTag>{s.vehicle_plate}</PlateTag></td>
                      <td>{s.vehicle_model || '-'}</td>
                      <td className={`text-right whitespace-nowrap tabular-nums font-semibold ${s.below_target ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>
                        {s.below_target && <AlertTriangle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-label="Abaixo da meta" />}
                        {fmtAvg(s.current_average)}
                      </td>
                      <td className="text-right whitespace-nowrap tabular-nums">
                        <button
                          type="button" onClick={() => openTargetDialog(s)} title="Definir meta de consumo"
                          className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-primary"
                        >
                          {s.target ? fmtAvg(s.target) : <span className="text-slate-400">definir</span>}
                          <Pencil className="w-3 h-3" />
                        </button>
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{fmtDate(s.last_supply_date)}</td>
                      <td className="text-right tabular-nums">{s.pair_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        {/* Filtrar histórico */}
        <FilterCard title="Filtrar histórico" hasFilters={!!vehiclePlateFilter} onClear={() => handleFilterChange('')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Veículo">
              <Autocomplete
                value={vehiclePlateFilter}
                onChange={handleFilterChange}
                options={vehicles}
                displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                valueField="id"
                onSelect={(vehicle) => handleFilterChange(vehicle.plate)}
              />
            </FilterField>
          </div>
        </FilterCard>

        {/* Histórico de Cálculos */}
        <DataCard title="Histórico de cálculos" count={loadingHistory ? '...' : history.length}>
          {loadingHistory ? (
            <EmptyState loading />
          ) : history.length === 0 ? (
            <EmptyState icon={TrendingUp} title="Nenhum cálculo de média disponível ainda" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nº abastecimento</th>
                    <th>Placa</th>
                    <th>Data</th>
                    <th className="!text-right">KM anterior</th>
                    <th className="!text-right">KM atual</th>
                    <th className="!text-right">KM percorrido</th>
                    <th className="!text-right">Litros</th>
                    <th className="!text-right">Média</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.supply_id}>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{h.supply_number}</td>
                      <td><PlateTag>{h.vehicle_plate}</PlateTag></td>
                      <td className="whitespace-nowrap tabular-nums">{fmtDate(h.supply_date)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{fmtKm(h.previous_reading)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{fmtKm(h.current_reading)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{fmtKm(h.km_traveled)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">
                        {fmtLiters(h.liters)}
                        {/* Média de tanque cheio a tanque cheio: os parciais do meio somam nos litros */}
                        {h.partial_count > 0 && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {`inclui ${h.partial_count} parcia${h.partial_count > 1 ? 'is' : 'l'}`}
                          </div>
                        )}
                      </td>
                      <td className={`text-right whitespace-nowrap tabular-nums cell-strong ${h.target && h.average < h.target ? 'text-red-600 dark:text-red-400' : ''}`}>
                        {fmtAvg(h.average)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <Dialog open={!!targetDialog} onOpenChange={(open) => !open && setTargetDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Target className="w-5 h-5 text-primary" />
              Meta de consumo - {targetDialog?.vehicle_plate}
            </DialogTitle>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block">Meta (km/L)</Label>
            <Input
              inputMode="decimal" placeholder="Ex.: 2,5" autoFocus
              value={targetDialog?.value ?? ''}
              onChange={(e) => setTargetDialog((p) => ({ ...p, value: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && saveTarget()}
              data-testid="fuel-target-input"
            />
            <p className="text-xs text-muted-foreground mt-1.5">Média abaixo da meta fica em destaque. Deixe vazio para remover.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTargetDialog(null)}>Cancelar</Button>
            <Button onClick={saveTarget} disabled={savingTarget} data-testid="fuel-target-save">
              {savingTarget ? 'Salvando...' : 'Salvar meta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
