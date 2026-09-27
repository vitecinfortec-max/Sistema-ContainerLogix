import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, DataCard, PlateTag, EmptyState,
} from '../components/DataPage';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Autocomplete } from '../components/Autocomplete';
import { TrendingUp, TrendingDown, Truck, Gauge } from 'lucide-react';
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

  // Indicadores do topo - só veículos que já têm média calculada
  const averages = summary.filter((s) => s.current_average !== null && s.current_average !== undefined);
  const fleetAverage = averages.length
    ? averages.reduce((acc, s) => acc + Number(s.current_average), 0) / averages.length
    : null;
  const best = averages.reduce((acc, s) => (!acc || s.current_average > acc.current_average ? s : acc), null);
  const worst = averages.reduce((acc, s) => (!acc || s.current_average < acc.current_average ? s : acc), null);

  return (
    <Layout>
      <div className="space-y-4" data-testid="fuel-consumption-page">
        <PageHeader
          icon={TrendingUp}
          title="Controle de Média"
          subtitle="Média de consumo (km/L) calculada automaticamente a partir do KM lançado em cada Abastecimento"
        />

        <StatGrid>
          <StatCard label="Veículos com média" value={averages.length} icon={Truck} tone="blue" hint="com 2+ abastecimentos" />
          <StatCard label="Média da frota" value={fmtAvg(fleetAverage)} icon={Gauge} tone="primary" hint="média entre os veículos" />
          <StatCard label="Melhor média" value={fmtAvg(best?.current_average)} icon={TrendingUp} tone="emerald" hint={best?.vehicle_plate || '-'} />
          <StatCard label="Menor média" value={fmtAvg(worst?.current_average)} icon={TrendingDown} tone="amber" hint={worst?.vehicle_plate || '-'} />
        </StatGrid>

        {/* Média Atual por Veículo */}
        <DataCard title="Média atual por veículo" count={loadingSummary ? '...' : summary.length}>
          {loadingSummary ? (
            <EmptyState title="Carregando..." />
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
                    <th>Último abastecimento</th>
                    <th className="!text-right">Qtd. de cálculos</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr key={s.vehicle_id}>
                      <td><PlateTag>{s.vehicle_plate}</PlateTag></td>
                      <td>{s.vehicle_model || '-'}</td>
                      <td className="text-right whitespace-nowrap tabular-nums font-semibold text-primary">{fmtAvg(s.current_average)}</td>
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
            <EmptyState title="Carregando..." />
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
                      <td className="text-right whitespace-nowrap tabular-nums">{fmtLiters(h.liters)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtAvg(h.average)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>
    </Layout>
  );
}
