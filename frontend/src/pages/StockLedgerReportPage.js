import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { FileText, FileSpreadsheet, Calendar, X, BarChart3, ArrowDownCircle, ArrowUpCircle, Wallet } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const OPERATION_OPTIONS = [
  ['ENTRADA', 'Entrada'],
  ['SAIDA', 'Saída'],
];

const REFERENCE_OPTIONS = [
  ['NFE', 'Nota Fiscal'],
  ['OS', 'Ordem de Serviço'],
  ['VEICULO', 'Veículo'],
  ['OUTRO', 'Outro'],
  ['SEM_REFERENCIA', 'Sem Referência'],
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

export default function StockLedgerReportPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [operationType, setOperationType] = useState('all');
  const [referenceType, setReferenceType] = useState('all');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ entrada_count: 0, entrada_value: 0, saida_count: 0, saida_value: 0 });
  const [dailyChart, setDailyChart] = useState([]);

  useEffect(() => {
    loadDailyChart();
  }, []);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, search, operationType, referenceType]);

  const loadDailyChart = async () => {
    try {
      const r = await api.getStockLedgerDailyChart();
      setDailyChart(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar gráfico diário de movimentações de estoque:', e);
    }
  };

  const buildParams = () => {
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (search) params.search = search;
    if (operationType !== 'all') params.operation_type = operationType;
    if (referenceType !== 'all') params.reference_type = referenceType;
    return params;
  };

  const loadSummary = async () => {
    try {
      const r = await api.getStockLedgerSummary(buildParams());
      setSummary(r.data);
    } catch (e) {
      console.error('Erro ao carregar resumo de movimentações de estoque:', e);
    }
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setOperationType('all');
    setReferenceType('all');
  };

  const hasFilters = dateFrom || dateTo || search || operationType !== 'all' || referenceType !== 'all';

  const downloadPDF = async () => {
    setLoading(true);
    try {
      const response = await api.getStockLedgerPDF(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_movimentacoes_estoque_${timestamp}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Movimentações de Estoque PDF gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de movimentações de estoque PDF');
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = async () => {
    setLoading(true);
    try {
      const response = await api.getStockLedgerExcel(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_movimentacoes_estoque_${timestamp}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Movimentações de Estoque Excel gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de movimentações de estoque Excel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-5" data-testid="stock-ledger-report-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Relatório de Movimentações de Estoque</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Entradas e saídas de produtos, com a Nota Fiscal de origem ou a Ordem de Serviço de destino</p>
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
                <button onClick={clearFilters} className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-primary flex items-center gap-1 font-normal" data-testid="report-stock-ledger-clear-filters">
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
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs" data-testid="report-stock-ledger-date-from" />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Fim</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs" data-testid="report-stock-ledger-date-to" />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Produto</Label>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs" data-testid="report-stock-ledger-search" />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Tipo</Label>
                <Select value={operationType} onValueChange={setOperationType}>
                  <SelectTrigger className="h-8 text-xs" data-testid="report-stock-ledger-filter-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[13px]">Todos</SelectItem>
                    {OPERATION_OPTIONS.map(([v, l]) => (
                      <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Referência</Label>
                <Select value={referenceType} onValueChange={setReferenceType}>
                  <SelectTrigger className="h-8 text-xs" data-testid="report-stock-ledger-filter-reference">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[13px]">Todas</SelectItem>
                    {REFERENCE_OPTIONS.map(([v, l]) => (
                      <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="stock-ledger-summary-cards">
          <KpiCard icon={ArrowDownCircle} label="Entradas" value={summary.entrada_count} testid="stock-ledger-kpi-entrada-count" />
          <KpiCard icon={Wallet} label="Valor de Entradas" value={fmtMoney(summary.entrada_value)} testid="stock-ledger-kpi-entrada-value" />
          <KpiCard icon={ArrowUpCircle} label="Saídas" value={summary.saida_count} testid="stock-ledger-kpi-saida-count" />
          <KpiCard icon={Wallet} label="Valor de Saídas" value={fmtMoney(summary.saida_value)} testid="stock-ledger-kpi-saida-value" />
        </div>

        {/* Barra de ações */}
        <div>
          <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wide font-semibold">Exportar</Label>
          <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
            <Button variant="ghost" size="sm" onClick={downloadPDF} disabled={loading} title="Baixar PDF" data-testid="download-stock-ledger-pdf-button" className="h-9 w-9 p-0 disabled:opacity-30">
              <FileText className="w-4 h-4 text-red-600" />
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadExcel} disabled={loading} title="Baixar Excel" data-testid="download-stock-ledger-excel-button" className="h-9 w-9 p-0 disabled:opacity-30">
              <FileSpreadsheet className="w-4 h-4 text-green-600" />
            </Button>
          </div>
        </div>

        {/* Dashboard: Entradas e Saídas por Dia */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="stock-ledger-daily-chart-card">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Entradas e Saídas por Dia</CardTitle>
              <span className="text-xs text-slate-400 dark:text-slate-500">(últimos 14 dias)</span>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {dailyChart.some((d) => d.entrada_value > 0 || d.saida_value > 0) ? (
              <div className="h-72 w-full" data-testid="stock-ledger-daily-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChart.map(d => ({
                    ...d,
                    label: format(new Date(d.date + 'T00:00:00'), 'dd/MM', { locale: ptBR })
                  }))} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-slate-800" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="entrada_value" name="Entradas" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="saida_value" name="Saídas" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={28} />
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
