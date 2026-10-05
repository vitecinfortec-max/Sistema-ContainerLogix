import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, FilterCard, FilterField, DataCard, EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { FileText, FileSpreadsheet, BarChart3, ClipboardList, Wallet, Gauge, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { BarsChart, CHART_COLORS, dailyChartData } from '../components/Charts';

const STATUS_OPTIONS = [
  ['ABERTO', 'Aberto'],
  ['ANDAMENTO', 'Em Andamento'],
  ['FECHADO', 'Fechado'],
  ['CANCELADO', 'Cancelado'],
];

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DAILY_SERIES = [
  { key: 'total_value', name: 'Valor de Serviços', color: CHART_COLORS.primary },
];

export default function ReportsServiceOrdersPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [equipmentPlate, setEquipmentPlate] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState({ count: 0, total_value: 0, avg_value: 0, open_count: 0 });
  const [dailyChart, setDailyChart] = useState([]);

  useEffect(() => {
    loadVehicles();
    loadCategories();
    loadDailyChart();
  }, []);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, equipmentPlate, status, category]);

  const loadVehicles = async () => {
    try {
      const r = await api.getVehicles({ per_page: 1000 });
      setVehicles(r.data?.items || r.data || []);
    } catch (e) { /* ignore */ }
  };

  const loadCategories = async () => {
    try {
      const r = await api.getOSCategories();
      setCategories(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const loadDailyChart = async () => {
    try {
      const r = await api.getServiceOrdersDailyChart();
      setDailyChart(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar gráfico diário de serviços:', e);
    }
  };

  const buildParams = () => {
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (equipmentPlate) params.equipment_plate = equipmentPlate;
    if (status !== 'all') params.status = status;
    if (category !== 'all') params.category = category;
    return params;
  };

  const loadSummary = async () => {
    try {
      const r = await api.getServiceOrdersReportSummary(buildParams());
      setSummary(r.data);
    } catch (e) {
      console.error('Erro ao carregar resumo do relatório de serviços:', e);
    }
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setEquipmentPlate('');
    setStatus('all');
    setCategory('all');
  };

  const hasFilters = dateFrom || dateTo || equipmentPlate || status !== 'all' || category !== 'all';

  const downloadPDF = async () => {
    setLoading(true);
    try {
      const response = await api.downloadServiceOrdersPDFReport(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_servicos_${timestamp}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Serviços PDF gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de serviços PDF');
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = async () => {
    setLoading(true);
    try {
      const response = await api.downloadServiceOrdersExcelReport(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_servicos_${timestamp}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Serviços Excel gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de serviços Excel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="reports-service-orders-page">
        <PageHeader icon={ClipboardList} title="Relatório de Serviços" subtitle="Acompanhe as Ordens de Serviço e o custo de manutenção da frota" />

        <FilterCard
          hasFilters={!!hasFilters}
          onClear={clearFilters}
          clearLinkTestId="report-service-orders-clear-filters"
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={downloadPDF} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-service-orders-pdf-button">
                <FileText className="w-4 h-4 text-red-600" /> Baixar PDF
              </Button>
              <Button type="button" size="sm" onClick={downloadExcel} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-service-orders-excel-button">
                <FileSpreadsheet className="w-4 h-4" /> Baixar Excel
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <FilterField label="Data início">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-sm" data-testid="report-service-orders-date-from" />
            </FilterField>
            <FilterField label="Data fim">
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-sm" data-testid="report-service-orders-date-to" />
            </FilterField>
            <FilterField label="Equipamento">
              <Autocomplete
                value={equipmentPlate}
                onChange={setEquipmentPlate}
                onSelect={(v) => setEquipmentPlate(v.plate)}
                options={vehicles}
                displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                className="h-9 text-sm font-mono"
              />
            </FilterField>
            <FilterField label="Status">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 text-sm" data-testid="report-service-orders-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todos</SelectItem>
                  {STATUS_OPTIONS.map(([v, l]) => (
                    <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Categoria">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9 text-sm" data-testid="report-service-orders-filter-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todas</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.name} className="text-[13px]">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <div data-testid="service-orders-summary-cards">
          <StatGrid>
            <StatCard icon={ClipboardList} label="Ordens de serviço" value={summary.count} tone="blue" testId="service-orders-kpi-count" />
            <StatCard icon={Wallet} label="Valor total" value={fmtMoney(summary.total_value)} tone="emerald" testId="service-orders-kpi-value" />
            <StatCard icon={Gauge} label="Valor médio" value={fmtMoney(summary.avg_value)} tone="primary" testId="service-orders-kpi-avg" />
            <StatCard icon={Clock} label="Em aberto" value={summary.open_count} tone="amber" testId="service-orders-kpi-open" />
          </StatGrid>
        </div>

        {/* Dashboard: Ordens de Serviço por Dia */}
        <DataCard
          title={(<span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Ordens de serviço por dia</span>)}
          meta={<span className="text-xs text-slate-400 dark:text-slate-500">últimos 14 dias</span>}
          testId="daily-service-orders-chart-card"
        >
          <div className="p-4">
            {dailyChart.some((d) => d.total_value > 0) ? (
              <BarsChart
                testId="daily-service-orders-chart"
                data={dailyChartData(dailyChart)}
                series={DAILY_SERIES}
                valueFormat={fmtMoney}
                allowDecimals
              />
            ) : (
              <EmptyState icon={BarChart3} title="Sem dados suficientes para exibir o gráfico" />
            )}
          </div>
        </DataCard>
      </div>
    </Layout>
  );
}
