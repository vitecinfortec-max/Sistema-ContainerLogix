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
import { FileText, FileSpreadsheet, BarChart3, Anchor, Wallet, Gauge, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { BarsChart, CHART_COLORS, dailyChartData } from '../components/Charts';

const TURNO_OPTIONS = [
  ['DIA', 'Dia'],
  ['NOITE', 'Noite'],
];

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DAILY_SERIES = [
  { key: 'total_value', name: 'Valor de Serviços', color: CHART_COLORS.primary },
];

export default function ReportsPortServicesPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientId, setClientId] = useState('');
  const [turno, setTurno] = useState('all');
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState([]);
  const [summary, setSummary] = useState({ count: 0, total_value: 0, avg_value: 0, in_progress_count: 0 });
  const [dailyChart, setDailyChart] = useState([]);

  useEffect(() => {
    loadClients();
    loadDailyChart();
  }, []);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, clientId, turno]);

  const loadClients = async () => {
    try {
      const r = await api.getClients({ per_page: 1000 });
      setClients(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const loadDailyChart = async () => {
    try {
      const r = await api.getPortServicesDailyChart();
      setDailyChart(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar gráfico diário de serviço portuário:', e);
    }
  };

  const buildParams = () => {
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (clientId) params.client_id = clientId;
    if (turno !== 'all') params.turno = turno;
    return params;
  };

  const loadSummary = async () => {
    try {
      const r = await api.getPortServicesReportSummary(buildParams());
      setSummary(r.data);
    } catch (e) {
      console.error('Erro ao carregar resumo do relatório de serviço portuário:', e);
    }
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setClientName('');
    setClientId('');
    setTurno('all');
  };

  const hasFilters = dateFrom || dateTo || clientId || turno !== 'all';

  const downloadPDF = async () => {
    setLoading(true);
    try {
      const response = await api.downloadPortServicesPDFReport(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_servico_portuario_${timestamp}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Serviço Portuário PDF gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de serviço portuário PDF');
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = async () => {
    setLoading(true);
    try {
      const response = await api.downloadPortServicesExcelReport(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_servico_portuario_${timestamp}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Serviço Portuário Excel gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de serviço portuário Excel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="reports-port-services-page">
        <PageHeader icon={BarChart3} title="Relatório de Serviço Portuário" subtitle="Acompanhe os serviços internos realizados dentro do porto" />

        <FilterCard
          hasFilters={!!hasFilters}
          onClear={clearFilters}
          clearLinkTestId="report-port-services-clear-filters"
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={downloadPDF} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-port-services-pdf-button">
                <FileText className="w-4 h-4 text-red-600" /> Baixar PDF
              </Button>
              <Button type="button" size="sm" onClick={downloadExcel} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-port-services-excel-button">
                <FileSpreadsheet className="w-4 h-4" /> Baixar Excel
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Data início">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-sm" data-testid="report-port-services-date-from" />
            </FilterField>
            <FilterField label="Data fim">
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-sm" data-testid="report-port-services-date-to" />
            </FilterField>
            <FilterField label="Cliente">
              <Autocomplete
                value={clientName}
                onChange={(val) => { setClientName(val); setClientId(''); }}
                onSelect={(c) => { setClientName(c.name); setClientId(c.id); }}
                options={clients}
                displayField="name"
                className="h-9 text-sm"
              />
            </FilterField>
            <FilterField label="Turno">
              <Select value={turno} onValueChange={setTurno}>
                <SelectTrigger className="h-9 text-sm" data-testid="report-port-services-filter-turno">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todos</SelectItem>
                  {TURNO_OPTIONS.map(([v, l]) => (
                    <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <div data-testid="port-services-summary-cards">
          <StatGrid>
            <StatCard icon={Anchor} label="Total de serviços" value={summary.count} tone="blue" testId="port-services-kpi-count" />
            <StatCard icon={Wallet} label="Valor total" value={fmtMoney(summary.total_value)} tone="emerald" testId="port-services-kpi-value" />
            <StatCard icon={Gauge} label="Valor médio" value={fmtMoney(summary.avg_value)} tone="primary" testId="port-services-kpi-avg" />
            <StatCard icon={Clock} label="Em andamento" value={summary.in_progress_count} tone="amber" testId="port-services-kpi-in-progress" />
          </StatGrid>
        </div>

        {/* Dashboard: Serviços Portuários por Dia */}
        <DataCard
          title={(<span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Serviços portuários por dia</span>)}
          meta={<span className="text-xs text-slate-400 dark:text-slate-500">últimos 14 dias</span>}
          testId="daily-port-services-chart-card"
        >
          <div className="p-4">
            {dailyChart.some((d) => d.total_value > 0) ? (
              <BarsChart
                testId="daily-port-services-chart"
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
