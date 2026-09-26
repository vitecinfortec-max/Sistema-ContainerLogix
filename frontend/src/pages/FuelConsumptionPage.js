import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Autocomplete } from '../components/Autocomplete';
import { TrendingUp, Search } from 'lucide-react';
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

  return (
    <Layout>
      <div className="space-y-5" data-testid="fuel-consumption-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Controle de Média</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Média de consumo (km/L) calculada automaticamente a partir do KM lançado em cada Abastecimento</p>
        </div>

        {/* Média Atual por Veículo */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <TrendingUp className="w-4 h-4" />
              Média Atual por Veículo
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingSummary ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : summary.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                Nenhum veículo com pelo menos 2 abastecimentos registrados ainda
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Placa</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Modelo</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Média Atual</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Último Abastecimento</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Qtd. de Cálculos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((s, idx) => (
                      <tr key={s.vehicle_id} className={idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}>
                        <td className="px-4 py-2.5 text-sm font-mono font-semibold text-slate-800 dark:text-slate-200">{s.vehicle_plate}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{s.vehicle_model || '-'}</td>
                        <td className="px-4 py-2.5 text-sm font-semibold text-primary">{fmtAvg(s.current_average)}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtDate(s.last_supply_date)}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{s.pair_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Filtrar histórico */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="max-w-sm">
              <Label className="text-xs mb-1 block">Veículo</Label>
              <Autocomplete
                value={vehiclePlateFilter}
                onChange={handleFilterChange}
                options={vehicles}
                displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                valueField="id"
                onSelect={(vehicle) => handleFilterChange(vehicle.plate)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Histórico de Cálculos */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <TrendingUp className="w-4 h-4" />
              Histórico de Cálculos ({history.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingHistory ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : history.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                Nenhum cálculo de média disponível ainda
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº Abastecimento</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Placa</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">KM Anterior</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">KM Atual</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">KM Percorrido</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Litros</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, idx) => (
                      <tr key={h.supply_id} className={idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}>
                        <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{h.supply_number}</td>
                        <td className="px-4 py-2.5 text-sm font-mono text-slate-600 dark:text-slate-400">{h.vehicle_plate}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtDate(h.supply_date)}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtKm(h.previous_reading)}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtKm(h.current_reading)}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtKm(h.km_traveled)}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtLiters(h.liters)}</td>
                        <td className="px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">{fmtAvg(h.average)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
