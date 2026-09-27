import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import {
  FileText, FileSpreadsheet, BarChart3, Package, Boxes, Wallet, AlertTriangle,
  ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const MODELO_OPTIONS = [
  ['INVENTARIO', 'Inventário'],
  ['MOVIMENTACOES', 'Movimentações de Estoque'],
];

const STATUS_OPTIONS = [
  ['ATIVO', 'Ativo'],
  ['INATIVO', 'Inativo'],
];

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

export default function StockReportPage() {
  const [modelo, setModelo] = useState('INVENTARIO');
  const [loading, setLoading] = useState(false);

  // ---- Inventário ----
  const [invSearch, setInvSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('all');
  const [familyId, setFamilyId] = useState('all');
  const [status, setStatus] = useState('all');
  const [warehouses, setWarehouses] = useState([]);
  const [families, setFamilies] = useState([]);
  const [invSummary, setInvSummary] = useState({ count: 0, total_quantity: 0, total_value: 0, zero_stock_count: 0 });
  const [byWarehouseChart, setByWarehouseChart] = useState([]);

  // ---- Movimentações de Estoque ----
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [operationType, setOperationType] = useState('all');
  const [referenceType, setReferenceType] = useState('all');
  const [ledgerSummary, setLedgerSummary] = useState({ entrada_count: 0, entrada_value: 0, saida_count: 0, saida_value: 0 });
  const [dailyChart, setDailyChart] = useState([]);

  useEffect(() => {
    loadWarehouses();
    loadFamilies();
    loadDailyChart();
  }, []);

  useEffect(() => {
    if (modelo === 'INVENTARIO') {
      loadInvSummary();
      loadByWarehouseChart();
    } else {
      loadLedgerSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo, invSearch, warehouseId, familyId, status, dateFrom, dateTo, ledgerSearch, operationType, referenceType]);

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

  const loadDailyChart = async () => {
    try {
      const r = await api.getStockLedgerDailyChart();
      setDailyChart(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar gráfico diário de movimentações de estoque:', e);
    }
  };

  const buildInvParams = () => {
    const params = {};
    if (invSearch) params.search = invSearch;
    if (warehouseId !== 'all') params.warehouse_id = warehouseId;
    if (familyId !== 'all') params.family_id = familyId;
    if (status !== 'all') params.status = status;
    return params;
  };

  const buildLedgerParams = () => {
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (ledgerSearch) params.search = ledgerSearch;
    if (operationType !== 'all') params.operation_type = operationType;
    if (referenceType !== 'all') params.reference_type = referenceType;
    return params;
  };

  const loadInvSummary = async () => {
    try {
      const r = await api.getStockReportSummary(buildInvParams());
      setInvSummary(r.data);
    } catch (e) {
      console.error('Erro ao carregar resumo do inventário:', e);
    }
  };

  const loadByWarehouseChart = async () => {
    try {
      const r = await api.getStockReportByWarehouse(buildInvParams());
      setByWarehouseChart(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar gráfico de estoque por almoxarifado:', e);
    }
  };

  const loadLedgerSummary = async () => {
    try {
      const r = await api.getStockLedgerSummary(buildLedgerParams());
      setLedgerSummary(r.data);
    } catch (e) {
      console.error('Erro ao carregar resumo de movimentações de estoque:', e);
    }
  };

  const clearFilters = () => {
    if (modelo === 'INVENTARIO') {
      setInvSearch('');
      setWarehouseId('all');
      setFamilyId('all');
      setStatus('all');
    } else {
      setDateFrom('');
      setDateTo('');
      setLedgerSearch('');
      setOperationType('all');
      setReferenceType('all');
    }
  };

  const hasFilters = modelo === 'INVENTARIO'
    ? (invSearch || warehouseId !== 'all' || familyId !== 'all' || status !== 'all')
    : (dateFrom || dateTo || ledgerSearch || operationType !== 'all' || referenceType !== 'all');

  const downloadPDF = async () => {
    setLoading(true);
    try {
      const response = modelo === 'INVENTARIO'
        ? await api.getStockReportPDF(buildInvParams())
        : await api.getStockLedgerPDF(buildLedgerParams());
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      const filename = modelo === 'INVENTARIO' ? `relatorio_estoque_${timestamp}.pdf` : `relatorio_movimentacoes_estoque_${timestamp}.pdf`;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório PDF gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório PDF');
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = async () => {
    setLoading(true);
    try {
      const response = modelo === 'INVENTARIO'
        ? await api.getStockReportExcel(buildInvParams())
        : await api.getStockLedgerExcel(buildLedgerParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      const filename = modelo === 'INVENTARIO' ? `relatorio_estoque_${timestamp}.xlsx` : `relatorio_movimentacoes_estoque_${timestamp}.xlsx`;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório Excel gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório Excel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="stock-reports-page">
        <PageHeader icon={BarChart3} title="Relatórios do Estoque" subtitle="Inventário atual, entradas e saídas de produtos" />

        <FilterCard
          hasFilters={!!hasFilters}
          onClear={clearFilters}
          clearLinkTestId="report-stock-clear-filters"
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={downloadPDF} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-stock-report-pdf-button">
                <FileText className="w-4 h-4 text-red-600" /> Baixar PDF
              </Button>
              <Button type="button" size="sm" onClick={downloadExcel} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-stock-report-button">
                <FileSpreadsheet className="w-4 h-4" /> Baixar Excel
              </Button>
            </>
          )}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <FilterField label="Modelo">
                <Select value={modelo} onValueChange={setModelo}>
                  <SelectTrigger className="h-9 text-sm" data-testid="report-stock-modelo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELO_OPTIONS.map(([v, l]) => (
                      <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            </div>

            {modelo === 'INVENTARIO' ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <FilterField label="Produto">
                  <SearchInput value={invSearch} onChange={(e) => setInvSearch(e.target.value)} data-testid="report-stock-search" />
                </FilterField>
                <FilterField label="Almoxarifado">
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger className="h-9 text-sm" data-testid="report-stock-filter-warehouse">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-[13px]">Todos</SelectItem>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id} className="text-[13px]">{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="Família">
                  <Select value={familyId} onValueChange={setFamilyId}>
                    <SelectTrigger className="h-9 text-sm" data-testid="report-stock-filter-family">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-[13px]">Todas</SelectItem>
                      {families.map((f) => (
                        <SelectItem key={f.id} value={f.id} className="text-[13px]">{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="Status">
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="h-9 text-sm" data-testid="report-stock-filter-status">
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
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <FilterField label="Data início">
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-sm" data-testid="report-stock-ledger-date-from" />
                </FilterField>
                <FilterField label="Data fim">
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-sm" data-testid="report-stock-ledger-date-to" />
                </FilterField>
                <FilterField label="Produto">
                  <SearchInput value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)} data-testid="report-stock-ledger-search" />
                </FilterField>
                <FilterField label="Tipo">
                  <Select value={operationType} onValueChange={setOperationType}>
                    <SelectTrigger className="h-9 text-sm" data-testid="report-stock-ledger-filter-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-[13px]">Todos</SelectItem>
                      {OPERATION_OPTIONS.map(([v, l]) => (
                        <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="Referência">
                  <Select value={referenceType} onValueChange={setReferenceType}>
                    <SelectTrigger className="h-9 text-sm" data-testid="report-stock-ledger-filter-reference">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-[13px]">Todas</SelectItem>
                      {REFERENCE_OPTIONS.map(([v, l]) => (
                        <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
              </div>
            )}
          </div>
        </FilterCard>

        {/* KPIs */}
        {modelo === 'INVENTARIO' ? (
          <div data-testid="stock-summary-cards">
            <StatGrid>
              <StatCard icon={Package} label="Total de produtos" value={invSummary.count} tone="blue" testId="stock-kpi-count" />
              <StatCard icon={Boxes} label="Quantidade total" value={fmtQty(invSummary.total_quantity)} tone="primary" testId="stock-kpi-quantity" />
              <StatCard icon={Wallet} label="Valor total em estoque" value={fmtMoney(invSummary.total_value)} tone="emerald" testId="stock-kpi-value" />
              <StatCard icon={AlertTriangle} label="Sem estoque" value={invSummary.zero_stock_count} tone={invSummary.zero_stock_count > 0 ? 'amber' : 'slate'} testId="stock-kpi-zero" />
            </StatGrid>
          </div>
        ) : (
          <div data-testid="stock-ledger-summary-cards">
            <StatGrid>
              <StatCard icon={ArrowDownCircle} label="Entradas" value={ledgerSummary.entrada_count} tone="primary" testId="stock-ledger-kpi-entrada-count" />
              <StatCard icon={Wallet} label="Valor de entradas" value={fmtMoney(ledgerSummary.entrada_value)} tone="emerald" testId="stock-ledger-kpi-entrada-value" />
              <StatCard icon={ArrowUpCircle} label="Saídas" value={ledgerSummary.saida_count} tone="amber" testId="stock-ledger-kpi-saida-count" />
              <StatCard icon={Wallet} label="Valor de saídas" value={fmtMoney(ledgerSummary.saida_value)} tone="red" testId="stock-ledger-kpi-saida-value" />
            </StatGrid>
          </div>
        )}

        {/* Dashboard */}
        {modelo === 'INVENTARIO' ? (
          <DataCard
            title={(<span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Valor em estoque por almoxarifado</span>)}
            testId="stock-by-warehouse-chart-card"
          >
            <div className="p-4">
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
                <EmptyState icon={BarChart3} title="Sem dados suficientes para exibir o gráfico" />
              )}
            </div>
          </DataCard>
        ) : (
          <DataCard
            title={(<span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Entradas e saídas por dia</span>)}
            meta={<span className="text-xs text-slate-400 dark:text-slate-500">últimos 14 dias</span>}
            testId="stock-ledger-daily-chart-card"
          >
            <div className="p-4">
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
                <EmptyState icon={BarChart3} title="Sem dados suficientes para exibir o gráfico" />
              )}
            </div>
          </DataCard>
        )}
      </div>
    </Layout>
  );
}
