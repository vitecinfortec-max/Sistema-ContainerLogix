import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, FilterCard, FilterField, DataCard, EmptyState, StatusPill, PlateTag, TablePagination, usePagination } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { FileText, FileSpreadsheet, BarChart3, Fuel, Droplet, Wallet, Gauge } from 'lucide-react';
import { format } from 'date-fns';
import { BarsChart, CHART_COLORS, dailyChartData } from '../components/Charts';

const FUEL_TYPE_OPTIONS = [
  ['DIESEL_S10', 'Diesel S10'],
  ['DIESEL_S500', 'Diesel S500'],
  ['GASOLINA_COMUM', 'Gasolina Comum'],
  ['GASOLINA_ADITIVADA', 'Gasolina Aditivada'],
  ['ETANOL', 'Etanol'],
  ['ARLA_32', 'Arla 32'],
  ['GNV', 'GNV'],
  ['OUTRO', 'Outro'],
];

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtLiters = (v) => `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;

const DAILY_SERIES = [
  { key: 'total_value', name: 'Valor Abastecido', color: CHART_COLORS.primary },
];

export default function ReportsFuelSupplyPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [equipmentPlate, setEquipmentPlate] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [fuelType, setFuelType] = useState('all');
  const [source, setSource] = useState('all');
  const [loadingRows, setLoadingRows] = useState(true);
  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [summary, setSummary] = useState({ count: 0, total_liters: 0, total_value: 0, avg_price_per_liter: 0, rows: [] });
  const [dailyChart, setDailyChart] = useState([]);

  useEffect(() => {
    loadVehicles();
    loadSuppliers();
    loadDailyChart();
  }, []);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, equipmentPlate, supplierName, fuelType, source]);

  const loadVehicles = async () => {
    try {
      const r = await api.getVehicles({ per_page: 1000 });
      setVehicles(r.data?.items || r.data || []);
    } catch (e) { /* ignore */ }
  };

  const loadSuppliers = async () => {
    try {
      const r = await api.getSuppliers();
      setSuppliers(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const loadDailyChart = async () => {
    try {
      const r = await api.getFuelSupplyDailyChart();
      setDailyChart(r.data || []);
    } catch (e) {
      console.error('Erro ao carregar gráfico diário de abastecimento:', e);
    }
  };

  const buildParams = () => {
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (equipmentPlate) params.equipment_plate = equipmentPlate;
    if (supplierName) params.supplier_name = supplierName;
    if (fuelType !== 'all') params.fuel_type = fuelType;
    if (source !== 'all') params.source = source;
    return params;
  };

  const loadSummary = async () => {
    try {
      const r = await api.getFuelSupplyReportSummary(buildParams());
      setSummary({ rows: [], ...r.data });
    } catch (e) {
      console.error('Erro ao carregar resumo do relatório de abastecimento:', e);
    } finally {
      setLoadingRows(false);
    }
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setEquipmentPlate('');
    setSupplierName('');
    setFuelType('all');
    setSource('all');
  };

  const hasFilters = dateFrom || dateTo || equipmentPlate || supplierName || fuelType !== 'all' || source !== 'all';
  const rows = summary.rows || [];
  const { pageItems, paginationProps } = usePagination(rows, { resetKey: `${dateFrom}|${dateTo}|${equipmentPlate}|${supplierName}|${fuelType}|${source}` });

  const downloadPDF = async () => {
    setLoading(true);
    try {
      const response = await api.downloadFuelSupplyPDFReport(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_abastecimento_${timestamp}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Abastecimento PDF gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de abastecimento PDF');
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = async () => {
    setLoading(true);
    try {
      const response = await api.downloadFuelSupplyExcelReport(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_abastecimento_${timestamp}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Abastecimento Excel gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de abastecimento Excel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="reports-fuel-supply-page">
        <PageHeader icon={Fuel} title="Relatório de Abastecimento" subtitle="Acompanhe o consumo e o custo de combustível/ARLA da frota" />

        <FilterCard
          hasFilters={!!hasFilters}
          onClear={clearFilters}
          clearLinkTestId="report-fuel-supply-clear-filters"
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={downloadPDF} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-fuel-supply-pdf-button">
                <FileText className="w-4 h-4 text-red-600" /> Baixar PDF
              </Button>
              <Button type="button" size="sm" onClick={downloadExcel} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-fuel-supply-excel-button">
                <FileSpreadsheet className="w-4 h-4" /> Baixar Excel
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <FilterField label="Data início">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-sm" data-testid="report-fuel-supply-date-from" />
            </FilterField>
            <FilterField label="Data fim">
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-sm" data-testid="report-fuel-supply-date-to" />
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
            <FilterField label="Fornecedor">
              <Autocomplete
                value={supplierName}
                onChange={setSupplierName}
                onSelect={(s) => setSupplierName(s.name)}
                options={suppliers}
                displayField="name"
                className="h-9 text-sm"
              />
            </FilterField>
            <FilterField label="Combustível/ARLA">
              <Select value={fuelType} onValueChange={setFuelType}>
                <SelectTrigger className="h-9 text-sm" data-testid="report-fuel-supply-filter-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todos</SelectItem>
                  {FUEL_TYPE_OPTIONS.map(([v, l]) => (
                    <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Fonte">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="h-9 text-sm" data-testid="report-fuel-supply-filter-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todas</SelectItem>
                  <SelectItem value="POSTO_EXTERNO" className="text-[13px]">Posto Externo</SelectItem>
                  <SelectItem value="TANQUE_PROPRIO" className="text-[13px]">Tanque Próprio</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <div data-testid="fuel-supply-summary-cards">
          <StatGrid>
            <StatCard icon={Fuel} label="Abastecimentos" value={summary.count} tone="blue" testId="fuel-supply-kpi-count" />
            <StatCard icon={Droplet} label="Litros" value={fmtLiters(summary.total_liters)} tone="primary" testId="fuel-supply-kpi-liters" />
            <StatCard icon={Wallet} label="Valor total" value={fmtMoney(summary.total_value)} tone="emerald" testId="fuel-supply-kpi-value" />
            <StatCard icon={Gauge} label="Preço médio/litro" value={fmtMoney(summary.avg_price_per_liter)} tone="amber" testId="fuel-supply-kpi-avg-price" />
          </StatGrid>
        </div>

        {/* Dashboard: Abastecimento por Dia */}
        <DataCard
          title={(<span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Abastecimento por dia</span>)}
          meta={<span className="text-xs text-slate-400 dark:text-slate-500">últimos 14 dias</span>}
          testId="daily-fuel-supply-chart-card"
        >
          <div className="p-4">
            {dailyChart.some((d) => d.total_value > 0) ? (
              <BarsChart
                testId="daily-fuel-supply-chart"
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

        {/* Os abastecimentos do filtro - o mesmo recorte do PDF e do Excel */}
        <DataCard title="Abastecimentos" count={rows.length} footer={<TablePagination {...paginationProps} />} testId="fuel-supply-report-table">
          {loadingRows ? (
            <EmptyState loading />
          ) : rows.length === 0 ? (
            <EmptyState icon={Fuel} title="Nenhum abastecimento no filtro" hint={hasFilters ? 'Ajuste os filtros' : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Placa</th>
                    <th>Motorista</th>
                    <th>Fornecedor</th>
                    <th>Fonte</th>
                    <th>Combustível</th>
                    <th className="!text-right">Litros</th>
                    <th className="!text-right">R$/L</th>
                    <th className="!text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((f) => (
                    <tr key={f.id}>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{f.supply_number}</td>
                      <td className="whitespace-nowrap tabular-nums">{f.supply_date ? format(new Date(`${f.supply_date}T00:00:00`), 'dd/MM/yyyy') : '-'}</td>
                      <td>{f.equipment_plate ? <PlateTag>{f.equipment_plate}</PlateTag> : '-'}</td>
                      <td><div className="max-w-[180px] truncate" title={f.driver_name || ''}>{f.driver_name || '-'}</div></td>
                      <td><div className="max-w-[180px] truncate" title={f.supplier_name || ''}>{f.supplier_name || '-'}</div></td>
                      <td>
                        <StatusPill tone={f.source === 'TANQUE_PROPRIO' ? 'primary' : 'slate'} dot={false}>
                          {f.source === 'TANQUE_PROPRIO' ? 'Tanque Próprio' : 'Posto Externo'}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap">{f.fuel_type_label || '-'}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{fmtLiters(f.liters)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{fmtMoney(f.unit_price)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">{fmtMoney(f.total_value)}</td>
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
