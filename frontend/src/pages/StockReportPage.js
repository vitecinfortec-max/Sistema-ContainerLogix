import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { FileText, FileSpreadsheet, Search, X, BarChart3, Package, Boxes, Wallet, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

const STATUS_OPTIONS = [
  ['ATIVO', 'Ativo'],
  ['INATIVO', 'Inativo'],
];

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtQty = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

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

export default function StockReportPage() {
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('all');
  const [familyId, setFamilyId] = useState('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false);
  const [warehouses, setWarehouses] = useState([]);
  const [families, setFamilies] = useState([]);
  const [summary, setSummary] = useState({ count: 0, total_quantity: 0, total_value: 0, zero_stock_count: 0 });
  const [byWarehouseChart, setByWarehouseChart] = useState([]);

  useEffect(() => {
    loadWarehouses();
    loadFamilies();
  }, []);

  useEffect(() => {
    loadSummary();
    loadByWarehouseChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, warehouseId, familyId, status]);

  const loadWarehouses = async () => {
    try {
      const r = await api.getWarehouses();
      setWarehouses(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const loadFamilies = async () => {
    try {
      const r = await api.getProductFamilies();
      setFamilies(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const buildParams = () => {
    const params = {};
    if (search) params.search = search;
    if (warehouseId !== 'all') params.warehouse_id = warehouseId;
    if (familyId !== 'all') params.family_id = familyId;
    if (status !== 'all') params.status = status;
    return params;
  };

  const loadSummary = async () => {
    try {
      const r = await api.getStockReportSummary(buildParams());
      setSummary(r.data);
    } catch (e) {
      console.error('Erro ao carregar resumo do relatório de estoque:', e);
    }
  };

  const loadByWarehouseChart = async () => {
    try {
      const r = await api.getStockReportByWarehouse(buildParams());
      setByWarehouseChart(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar gráfico de estoque por almoxarifado:', e);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setWarehouseId('all');
    setFamilyId('all');
    setStatus('all');
  };

  const hasFilters = search || warehouseId !== 'all' || familyId !== 'all' || status !== 'all';

  const downloadPDF = async () => {
    setLoading(true);
    try {
      const response = await api.getStockReportPDF(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_estoque_${timestamp}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Estoque PDF gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de estoque PDF');
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = async () => {
    setLoading(true);
    try {
      const response = await api.getStockReportExcel(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_estoque_${timestamp}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Estoque Excel gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de estoque Excel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-5" data-testid="stock-report-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Relatório de Estoque</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Acompanhe a quantidade e o valor dos produtos em estoque</p>
        </div>

        {/* Filters */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" />
                Filtrar
              </span>
              {hasFilters && (
                <button onClick={clearFilters} className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-primary flex items-center gap-1 font-normal" data-testid="report-stock-clear-filters">
                  <X className="w-3 h-3" />
                  Limpar
                </button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Produto</Label>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-xs"
                  data-testid="report-stock-search"
                />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Almoxarifado</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger className="h-8 text-xs" data-testid="report-stock-filter-warehouse">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[13px]">Todos</SelectItem>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id} className="text-[13px]">{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Família</Label>
                <Select value={familyId} onValueChange={setFamilyId}>
                  <SelectTrigger className="h-8 text-xs" data-testid="report-stock-filter-family">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[13px]">Todas</SelectItem>
                    {families.map((f) => (
                      <SelectItem key={f.id} value={f.id} className="text-[13px]">{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-8 text-xs" data-testid="report-stock-filter-status">
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
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="stock-summary-cards">
          <KpiCard icon={Package} label="Total de Produtos" value={summary.count} testid="stock-kpi-count" />
          <KpiCard icon={Boxes} label="Quantidade Total" value={fmtQty(summary.total_quantity)} testid="stock-kpi-quantity" />
          <KpiCard icon={Wallet} label="Valor Total em Estoque" value={fmtMoney(summary.total_value)} testid="stock-kpi-value" />
          <KpiCard icon={AlertTriangle} label="Sem Estoque" value={summary.zero_stock_count} testid="stock-kpi-zero" />
        </div>

        {/* Barra de ações */}
        <div>
          <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-1 block uppercase tracking-wide font-semibold">Exportar</Label>
          <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
            <Button variant="ghost" size="sm" onClick={downloadPDF} disabled={loading} title="Baixar PDF" data-testid="download-stock-report-pdf-button" className="h-9 w-9 p-0 disabled:opacity-30">
              <FileText className="w-4 h-4 text-red-600" />
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadExcel} disabled={loading} title="Baixar Excel" data-testid="download-stock-report-button" className="h-9 w-9 p-0 disabled:opacity-30">
              <FileSpreadsheet className="w-4 h-4 text-green-600" />
            </Button>
          </div>
        </div>

        {/* Dashboard: Valor em Estoque por Almoxarifado */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="stock-by-warehouse-chart-card">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Valor em Estoque por Almoxarifado</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {byWarehouseChart.some((d) => d.total_value > 0) ? (
              <div className="h-72 w-full" data-testid="stock-by-warehouse-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byWarehouseChart} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-slate-800" />
                    <XAxis dataKey="warehouse_name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }} />
                    <Bar dataKey="total_value" name="Valor em Estoque" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={40} />
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
