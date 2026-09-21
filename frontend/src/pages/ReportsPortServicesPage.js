import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { FileText, FileSpreadsheet, Calendar, X, BarChart3, Anchor, Wallet, Gauge, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

const TURNO_OPTIONS = [
  ['DIA', 'Dia'],
  ['NOITE', 'Noite'],
];

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} style={{ color: entry.color }} className="font-medium">
          {entry.name}: {fmtMoney(entry.value)}
        </p>
      ))}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, testid }) {
  return (
    <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid={testid}>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-4.5 h-4.5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide font-semibold truncate">{label}</div>
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

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
      <div className="space-y-5" data-testid="reports-port-services-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Relatório de Serviço Portuário
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Acompanhe os serviços internos realizados dentro do porto</p>
        </div>

        {/* Filters */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                Filtrar
              </span>
              {hasFilters && (
                <button onClick={clearFilters} className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-primary flex items-center gap-1 font-normal" data-testid="report-port-services-clear-filters">
                  <X className="w-3 h-3" />
                  Limpar
                </button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Início</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs" data-testid="report-port-services-date-from" />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Fim</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs" data-testid="report-port-services-date-to" />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Cliente</Label>
                <Autocomplete
                  value={clientName}
                  onChange={(val) => { setClientName(val); setClientId(''); }}
                  onSelect={(c) => { setClientName(c.name); setClientId(c.id); }}
                  options={clients}
                  displayField="name"
                  className="text-xs"
                />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Turno</Label>
                <Select value={turno} onValueChange={setTurno}>
                  <SelectTrigger className="h-8 text-xs" data-testid="report-port-services-filter-turno">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[13px]">Todos</SelectItem>
                    {TURNO_OPTIONS.map(([v, l]) => (
                      <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="port-services-summary-cards">
          <KpiCard icon={Anchor} label="Total de Serviços" value={summary.count} testid="port-services-kpi-count" />
          <KpiCard icon={Wallet} label="Valor Total" value={fmtMoney(summary.total_value)} testid="port-services-kpi-value" />
          <KpiCard icon={Gauge} label="Valor Médio" value={fmtMoney(summary.avg_value)} testid="port-services-kpi-avg" />
          <KpiCard icon={Clock} label="Em Andamento" value={summary.in_progress_count} testid="port-services-kpi-in-progress" />
        </div>

        {/* Barra de ações */}
        <div>
          <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wide font-semibold">Exportar</Label>
          <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
            <Button variant="ghost" size="sm" onClick={downloadPDF} disabled={loading} title="Baixar PDF" data-testid="download-port-services-pdf-button" className="h-9 w-9 p-0 disabled:opacity-30">
              <FileText className="w-4 h-4 text-red-600" />
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadExcel} disabled={loading} title="Baixar Excel" data-testid="download-port-services-excel-button" className="h-9 w-9 p-0 disabled:opacity-30">
              <FileSpreadsheet className="w-4 h-4 text-green-600" />
            </Button>
          </div>
        </div>

        {/* Dashboard: Serviços Portuários por Dia */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="daily-port-services-chart-card">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Serviços Portuários por Dia</CardTitle>
              <span className="text-xs text-slate-400 dark:text-slate-500">(últimos 14 dias)</span>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {dailyChart.some((d) => d.total_value > 0) ? (
              <div className="h-72 w-full" data-testid="daily-port-services-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChart.map(d => ({
                    ...d,
                    label: format(new Date(d.date + 'T00:00:00'), 'dd/MM', { locale: ptBR })
                  }))} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-slate-800" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }} />
                    <Bar dataKey="total_value" name="Valor de Serviços" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-400 dark:text-slate-500">
                <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Sem dados suficientes para exibir o gráfico</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
