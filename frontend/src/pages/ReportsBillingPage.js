import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, EmptyState, StatCard, StatGrid, StatusPill, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { FileText, FileSpreadsheet, X, BarChart3, List, CheckCircle2, Clock, Warehouse } from 'lucide-react';
import { format } from 'date-fns';
import { BarsChart, CHART_COLORS, dailyChartData } from '../components/Charts';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtValue = (v, currency) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: currency === 'USD' ? 'USD' : 'BRL' }));
const PREVIEW_PAGE_SIZE = 15;

const DAILY_SERIES = [
  { key: 'billed', name: 'Faturado', color: CHART_COLORS.primary },
  { key: 'unbilled', name: 'Não Faturado', color: CHART_COLORS.amber },
];

export default function ReportsBillingPage() {
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterClient, setFilterClient] = useState('all');
  const [billedFilter, setBilledFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState([]);
  const [dailyChart, setDailyChart] = useState([]);
  const [preview, setPreview] = useState({ items: [], total: 0, pages: 1, stats: null });
  const [previewPage, setPreviewPage] = useState(1);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Autocomplete de cliente
  const [clientSearch, setClientSearch] = useState('');
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const clientBoxRef = useRef(null);

  useEffect(() => {
    loadClients();
    loadDailyChart();
  }, []);

  const loadDailyChart = async () => {
    try {
      const response = await api.getBillingDailyChart();
      setDailyChart(response.data || []);
    } catch (error) {
      console.error('Erro ao carregar gráfico diário de faturamento:', error);
    }
  };

  // Fechar sugestões ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (clientBoxRef.current && !clientBoxRef.current.contains(event.target)) {
        setShowClientSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadClients = async () => {
    try {
      const response = await api.getClients();
      setClients(response.data);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
      toast.error('Erro ao carregar clientes');
    }
  };

  const handleClientSearch = (searchTerm) => {
    setClientSearch(searchTerm);
    // Resetar seleção se usuário começou a editar
    if (filterClient !== 'all' && searchTerm !== filterClient) {
      setFilterClient('all');
    }
    if (searchTerm.length >= 1) {
      const filtered = clients.filter((c) =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setClientSuggestions(filtered.slice(0, 15));
      setShowClientSuggestions(true);
    } else {
      setClientSuggestions([]);
      setShowClientSuggestions(false);
    }
  };

  const selectClient = (client) => {
    setFilterClient(client.name);
    setClientSearch(client.name);
    setShowClientSuggestions(false);
  };

  const clearClient = () => {
    setFilterClient('all');
    setClientSearch('');
    setShowClientSuggestions(false);
  };

  const clearFilters = () => {
    setFilterType('all');
    setFilterStatus('all');
    setFilterClient('all');
    setBilledFilter('all');
    setDateFrom('');
    setDateTo('');
    setClientSearch('');
    setShowClientSuggestions(false);
  };

  const hasFilters = filterType !== 'all' || filterStatus !== 'all' || filterClient !== 'all' || billedFilter !== 'all' || dateFrom || dateTo;

  const buildParams = () => {
    const params = {};
    if (filterType !== 'all') params.operation_type = filterType;
    if (filterStatus !== 'all') params.status_filter = filterStatus;
    if (filterClient !== 'all') params.client_name = filterClient;
    if (billedFilter !== 'all') params.billed_filter = billedFilter;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  };

  // Início depois do fim: avisa na tela em vez de baixar um relatório vazio
  const periodError = dateFrom && dateTo && dateFrom > dateTo ? 'A data inicial não pode ser depois da data final.' : '';
  const blockIfInvalidPeriod = () => {
    if (periodError) toast.error(periodError);
    return !!periodError;
  };

  useEffect(() => { setPreviewPage(1); }, [filterType, filterStatus, filterClient, billedFilter, dateFrom, dateTo]);

  // Prévia na tela: as mesmas linhas do PDF/Excel, recarregada a cada filtro
  useEffect(() => {
    if (periodError) {
      setPreview({ items: [], total: 0, pages: 1, stats: null });
      return undefined;
    }
    let cancelled = false;
    const loadPreview = async () => {
      setPreviewLoading(true);
      try {
        const response = await api.previewBillingReport({ ...buildParams(), page: previewPage, per_page: PREVIEW_PAGE_SIZE });
        if (!cancelled) setPreview(response.data);
      } catch (error) {
        if (!cancelled) toast.error(error.response?.data?.detail || 'Erro ao carregar a prévia do relatório');
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    loadPreview();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterStatus, filterClient, billedFilter, dateFrom, dateTo, previewPage, periodError]);

  const downloadPDF = async () => {
    if (blockIfInvalidPeriod()) return;
    setLoading(true);
    try {
      const params = buildParams();
      const response = await api.downloadBillingPDFReport(params);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_faturamento_${timestamp}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Faturamento PDF gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de faturamento PDF');
    } finally {
      setLoading(false);
    }
  };

  const downloadExcel = async () => {
    if (blockIfInvalidPeriod()) return;
    setLoading(true);
    try {
      const params = buildParams();
      const response = await api.downloadBillingExcelReport(params);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_faturamento_${timestamp}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Faturamento Excel gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de faturamento Excel');
    } finally {
      setLoading(false);
    }
  };

  const buildStorageOverageParams = () => {
    const params = {};
    if (filterClient !== 'all') params.client_name = filterClient;
    if (filterStatus !== 'all') params.status_filter = filterStatus;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  };

  const downloadStorageOveragePDF = async () => {
    if (blockIfInvalidPeriod()) return;
    setLoading(true);
    try {
      const params = buildStorageOverageParams();
      const response = await api.downloadStorageOveragePdfReport(params);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_diarias_armazenagem_${timestamp}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Diárias de Armazenagem PDF gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de diárias de armazenagem PDF');
    } finally {
      setLoading(false);
    }
  };

  const downloadStorageOverageExcel = async () => {
    if (blockIfInvalidPeriod()) return;
    setLoading(true);
    try {
      const params = buildStorageOverageParams();
      const response = await api.downloadStorageOverageExcelReport(params);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_diarias_armazenagem_${timestamp}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório de Diárias de Armazenagem Excel gerado com sucesso!');
    } catch (error) {
      toast.error('Erro ao gerar relatório de diárias de armazenagem Excel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="reports-billing-page">
        <PageHeader icon={BarChart3} title="Relatório de Faturamento" subtitle="Gere relatórios financeiros com dados de faturamento das movimentações" />

        <FilterCard
          hasFilters={!!hasFilters}
          onClear={clearFilters}
          clearLinkTestId="report-billing-clear-filters"
          actions={(
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Faturamento</span>
              <Button type="button" variant="outline" size="sm" onClick={downloadPDF} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-billing-pdf-button">
                <FileText className="w-4 h-4 text-red-600" /> PDF
              </Button>
              <Button type="button" size="sm" onClick={downloadExcel} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-billing-excel-button">
                <FileSpreadsheet className="w-4 h-4" /> Excel
              </Button>
              <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Diárias de armazenagem</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={downloadStorageOveragePDF}
                disabled={loading}
                title={dateFrom || dateTo ? 'Baixar PDF de Diárias (só dias excedentes dentro do período selecionado)' : 'Baixar PDF de diárias'}
                className="h-8 text-xs gap-1.5"
                data-testid="download-storage-overage-pdf-button"
              >
                <FileText className="w-4 h-4 text-red-600" /> PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={downloadStorageOverageExcel}
                disabled={loading}
                title={dateFrom || dateTo ? 'Baixar Excel de Diárias (só dias excedentes dentro do período selecionado)' : 'Baixar Excel de diárias'}
                className="h-8 text-xs gap-1.5"
                data-testid="download-storage-overage-excel-button"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel
              </Button>
            </div>
          )}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <FilterField label="Data início">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 text-sm"
                data-testid="report-billing-date-from"
              />
            </FilterField>
            <FilterField label="Data fim">
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 text-sm"
                data-testid="report-billing-date-to"
              />
            </FilterField>

            <FilterField label="Operação">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-9 text-sm" data-testid="report-billing-filter-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todas as Operações</SelectItem>
                  <SelectItem value="ENTRADA" className="text-[13px]">Apenas Entradas</SelectItem>
                  <SelectItem value="SAIDA" className="text-[13px]">Apenas Saídas</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Status">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-9 text-sm" data-testid="report-billing-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todos os Status</SelectItem>
                  <SelectItem value="CHEIO" className="text-[13px]">Cheio</SelectItem>
                  <SelectItem value="VAZIO" className="text-[13px]">Vazio</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            {/* Cliente - Autocomplete (digite para buscar) */}
            <div ref={clientBoxRef}>
              <FilterField label="Cliente">
                <div className="relative">
                  <SearchInput
                    value={clientSearch}
                    onChange={(e) => handleClientSearch(e.target.value)}
                    onFocus={() => {
                      if (clientSearch.length >= 1 && clientSuggestions.length > 0) {
                        setShowClientSuggestions(true);
                      }
                    }}
                    className={`pr-8 ${filterClient !== 'all' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' : ''}`}
                    data-testid="report-billing-filter-client"
                  />
                  {filterClient !== 'all' && (
                    <button title="Limpar" aria-label="Limpar"
                      type="button"
                      onClick={clearClient}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400"
                      data-testid="report-billing-filter-client-clear"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}

                  {showClientSuggestions && clientSuggestions.length > 0 && (
                    <div
                      className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-y-auto"
                      data-testid="report-billing-filter-client-suggestions"
                    >
                      {clientSuggestions.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => selectClient(client)}
                          className="w-full px-3 py-2 text-left text-[13px] hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 focus:outline-none border-b border-slate-100 dark:border-slate-800 last:border-b-0"
                        >
                          {client.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {showClientSuggestions && clientSearch.length >= 1 && clientSuggestions.length === 0 && (
                    <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg px-3 py-2 text-[12px] text-slate-500 dark:text-slate-400">
                      Nenhum cliente encontrado
                    </div>
                  )}
                </div>
              </FilterField>
            </div>

            <FilterField label="Faturado">
              <Select value={billedFilter} onValueChange={setBilledFilter}>
                <SelectTrigger className="h-9 text-sm" data-testid="report-billing-filter-billed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todas</SelectItem>
                  <SelectItem value="billed" className="text-[13px]">Faturadas</SelectItem>
                  <SelectItem value="unbilled" className="text-[13px]">Não Faturadas</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </div>
          {periodError ? (
            <p className="text-[12px] text-red-600 dark:text-red-400 mt-2" data-testid="report-billing-period-error">{periodError}</p>
          ) : (dateFrom || dateTo) && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
              O relatório de Diárias de Armazenagem considera só os dias excedentes dentro do período selecionado.
            </p>
          )}
        </FilterCard>

        <StatGrid>
          <StatCard label="Movimentações" value={(preview.stats?.total ?? 0).toLocaleString('pt-BR')} icon={List} tone="blue" hint={hasFilters ? 'com os filtros atuais' : 'no relatório'} testId="billing-preview-total" />
          <StatCard label="Faturado" value={fmtMoney(preview.stats?.billed_value)} icon={CheckCircle2} tone="emerald" hint={`${preview.stats?.billed_count ?? 0} movimentação(ões)`} testId="billing-preview-billed" />
          <StatCard label="A faturar" value={fmtMoney(preview.stats?.unbilled_value)} icon={Clock} tone="amber" hint={preview.stats?.usd_value ? `+ ${fmtValue(preview.stats.usd_value, 'USD')} em dólar no total` : `${preview.stats?.unbilled_count ?? 0} movimentação(ões)`} testId="billing-preview-unbilled" />
          <StatCard label="Diárias de armazenagem" value={fmtMoney(preview.stats?.storage_value)} icon={Warehouse} tone="primary" hint={billedFilter === 'billed' ? 'não entram em "Faturadas"' : `${preview.stats?.storage_count ?? 0} container(s) além do free time`} />
        </StatGrid>

        <DataCard
          title="Prévia do relatório"
          count={previewLoading ? '...' : preview.total}
          meta={<span className="hidden md:inline text-xs text-slate-400 dark:text-slate-500">as mesmas movimentações do PDF e do Excel</span>}
          footer={(
            <TablePagination
              currentPage={previewPage}
              totalPages={preview.pages || 1}
              totalItems={preview.total}
              pageSize={PREVIEW_PAGE_SIZE}
              onPageChange={setPreviewPage}
            />
          )}
        >
          {preview.items.length === 0 ? (
            <EmptyState
              loading={previewLoading}
              icon={List}
              title={periodError ? 'Período inválido' : 'Nenhuma movimentação encontrada'}
              hint={periodError || (hasFilters ? 'Ajuste os filtros' : undefined)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table" data-testid="billing-preview-table">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Operação</th>
                    <th>Container</th>
                    <th>Cliente</th>
                    <th>Tipo de serviço</th>
                    <th className="text-right">Valor</th>
                    <th>Faturado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((m) => (
                    <tr key={m.id}>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{m.transaction_id}</td>
                      <td className="whitespace-nowrap tabular-nums">{m.created_at ? format(new Date(m.created_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                      <td>
                        <StatusPill tone={m.operation_type === 'ENTRADA' ? 'primary' : 'amber'}>
                          {m.operation_type === 'ENTRADA' ? 'Entrada' : 'Saída'}
                        </StatusPill>
                      </td>
                      <td className="cell-strong whitespace-nowrap font-mono text-[12px]">{m.container_number || '-'}</td>
                      <td><div className="max-w-[200px] truncate" title={m.client_name || ''}>{m.client_name || '-'}</div></td>
                      <td><div className="max-w-[180px] truncate" title={m.service_type || ''}>{m.service_type || '-'}</div></td>
                      <td className="text-right whitespace-nowrap tabular-nums">{fmtValue(m.service_value, m.currency)}</td>
                      <td>
                        <StatusPill tone={m.billed ? 'emerald' : 'slate'}>{m.billed ? 'Faturado' : 'A faturar'}</StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        {/* Faturamento por Dia */}
        <DataCard
          title={(<span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Faturamento por dia</span>)}
          meta={<span className="text-xs text-slate-400 dark:text-slate-500">últimos 14 dias</span>}
          testId="daily-billing-chart-card"
        >
          <div className="p-4">
            {dailyChart.length > 0 ? (
              <BarsChart
                testId="daily-billing-chart"
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
