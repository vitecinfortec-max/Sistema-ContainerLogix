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
import { FileText, FileSpreadsheet, Calendar, X, BarChart3, ClipboardList, Wallet, Gauge, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

const STATUS_OPTIONS = [
  ['ABERTO', 'Aberto'],
  ['ANDAMENTO', 'Em Andamento'],
  ['FECHADO', 'Fechado'],
  ['CANCELADO', 'Cancelado'],
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
      <div className="space-y-5" data-testid="reports-service-orders-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Relatório de Serviços
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Acompanhe as Ordens de Serviço e o custo de manutenção da frota</p>
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
                <button onClick={clearFilters} className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-primary flex items-center gap-1 font-normal" data-testid="report-service-orders-clear-filters">
                  <X className="w-3 h-3" />
                  Limpar
                </button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Início</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs" data-testid="report-service-orders-date-from" />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Fim</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs" data-testid="report-service-orders-date-to" />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Equipamento</Label>
                <Autocomplete
                  value={equipmentPlate}
                  onChange={setEquipmentPlate}
                  onSelect={(v) => setEquipmentPlate(v.plate)}
                  options={vehicles}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  className="text-xs font-mono"
                />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-8 text-xs" data-testid="report-service-orders-filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[13px]">Todos</SelectItem>
                    {STATUS_OPTIONS.map(([v, l]) => (
                      <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Categoria</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-8 text-xs" data-testid="report-service-orders-filter-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[13px]">Todas</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.name} className="text-[13px]">{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="service-orders-summary-cards">
          <KpiCard icon={ClipboardList} label="Ordens de Serviço" value={summary.count} testid="service-orders-kpi-count" />
          <KpiCard icon={Wallet} label="Valor Total" value={fmtMoney(summary.total_value)} testid="service-orders-kpi-value" />
          <KpiCard icon={Gauge} label="Valor Médio" value={fmtMoney(summary.avg_value)} testid="service-orders-kpi-avg" />
          <KpiCard icon={Clock} label="Em Aberto" value={summary.open_count} testid="service-orders-kpi-open" />
        </div>

        {/* Barra de ações */}
        <div>
          <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wide font-semibold">Exportar</Label>
          <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
            <Button variant="ghost" size="sm" onClick={downloadPDF} disabled={loading} title="Baixar PDF" data-testid="download-service-orders-pdf-button" className="h-9 w-9 p-0 disabled:opacity-30">
              <FileText className="w-4 h-4 text-red-600" />
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadExcel} disabled={loading} title="Baixar Excel" data-testid="download-service-orders-excel-button" className="h-9 w-9 p-0 disabled:opacity-30">
              <FileSpreadsheet className="w-4 h-4 text-green-600" />
            </Button>
          </div>
        </div>

        {/* Dashboard: Ordens de Serviço por Dia */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="daily-service-orders-chart-card">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Ordens de Serviço por Dia</CardTitle>
              <span className="text-xs text-slate-400 dark:text-slate-500">(últimos 14 dias)</span>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {dailyChart.some((d) => d.total_value > 0) ? (
              <div className="h-72 w-full" data-testid="daily-service-orders-chart">
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
