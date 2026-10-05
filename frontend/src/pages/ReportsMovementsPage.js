import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { FilterCard, FilterField, SearchInput, DataCard, EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { FileText, FileSpreadsheet, X, BarChart3, Mail } from 'lucide-react';
import { format } from 'date-fns';
import { BarsChart, CHART_COLORS, dailyChartData } from '../components/Charts';

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const DAILY_SERIES = [
  { key: 'entries', name: 'Entradas', color: CHART_COLORS.primary },
  { key: 'exits', name: 'Saídas', color: CHART_COLORS.amber },
];

export default function ReportsMovementsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [emailDate, setEmailDate] = useState(yesterdayISO());
  const [sendingEmails, setSendingEmails] = useState(false);
  const [emailResult, setEmailResult] = useState(null);

  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterClient, setFilterClient] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState([]);
  const [dailyChart, setDailyChart] = useState([]);

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
      const response = await api.getDashboardStats();
      setDailyChart(response.data.daily_chart || []);
    } catch (error) {
      console.error('Erro ao carregar gráfico diário:', error);
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
    setClientSearch('');
    setDateFrom('');
    setDateTo('');
  };

  const hasFilters = filterType !== 'all' || filterStatus !== 'all' || filterClient !== 'all' || dateFrom || dateTo;

  const buildParams = () => {
    const params = {};
    if (filterType !== 'all') params.operation_type = filterType;
    if (filterStatus !== 'all') params.status_filter = filterStatus;
    if (filterClient !== 'all') params.client_name = filterClient;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  };

  const downloadPDF = async () => {
    setLoading(true);
    try {
      const params = buildParams();
      const response = await api.downloadPDFReport(params);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_movimentacoes_${timestamp}.pdf`);
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
      const params = buildParams();
      const response = await api.downloadExcelReport(params);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const timestamp = format(new Date(), 'dd-MM-yyyy_HH-mm');
      link.setAttribute('download', `relatorio_movimentacoes_${timestamp}.xlsx`);
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

  const sendDailyEmails = async () => {
    setSendingEmails(true);
    setEmailResult(null);
    try {
      const response = await api.sendDailyMovementReports(emailDate);
      setEmailResult(response.data);
      const { sent, errors } = response.data;
      if (errors.length > 0) {
        toast.error(`Enviado para ${sent.length} cliente(s), ${errors.length} erro(s)`);
      } else {
        toast.success(`Relatório enviado para ${sent.length} cliente(s)`);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao enviar relatórios por e-mail');
    } finally {
      setSendingEmails(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="reports-movements-page">
        <PageHeader icon={BarChart3} title="Relatório de Movimentações" subtitle="Gere e exporte relatórios das movimentações de containers" />

        <FilterCard
          hasFilters={hasFilters}
          onClear={clearFilters}
          clearLinkTestId="report-clear-filters"
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={downloadPDF} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-pdf-button">
                <FileText className="w-4 h-4 text-red-600" /> Baixar PDF
              </Button>
              <Button type="button" size="sm" onClick={downloadExcel} disabled={loading} className="h-8 text-xs gap-1.5" data-testid="download-excel-button">
                <FileSpreadsheet className="w-4 h-4" /> Baixar Excel
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <FilterField label="Data início">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 text-sm"
                data-testid="report-date-from"
              />
            </FilterField>
            <FilterField label="Data fim">
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 text-sm"
                data-testid="report-date-to"
              />
            </FilterField>

            <FilterField label="Operação">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-9 text-sm" data-testid="report-filter-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todas as Operações</SelectItem>
                  <SelectItem value="ENTRADA" className="text-[13px]">Apenas Entradas</SelectItem>
                  <SelectItem value="SAIDA" className="text-[13px]">Apenas Saídas</SelectItem>
                  <SelectItem value="ESTOQUE" className="text-[13px]">Estoque Atual</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Status">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-9 text-sm" data-testid="report-filter-status">
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
                    data-testid="report-filter-client"
                  />
                  {filterClient !== 'all' && (
                    <button
                      type="button"
                      onClick={clearClient}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400"
                      data-testid="report-filter-client-clear"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}

                  {showClientSuggestions && clientSuggestions.length > 0 && (
                    <div
                      className="absolute z-[100] w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-y-auto"
                      data-testid="report-filter-client-suggestions"
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
          </div>
        </FilterCard>

        {/* Entradas e Saídas por Dia */}
        <DataCard
          title={(<span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Entradas e saídas por dia</span>)}
          meta={<span className="text-xs text-slate-400 dark:text-slate-500">últimos 14 dias</span>}
          testId="daily-chart-card"
        >
          <div className="p-4">
            {dailyChart.length > 0 ? (
              <BarsChart
                testId="daily-chart"
                data={dailyChartData(dailyChart)}
                series={DAILY_SERIES}
              />
            ) : (
              <EmptyState icon={BarChart3} title="Sem dados suficientes para exibir o gráfico" />
            )}
          </div>
        </DataCard>

        {isAdmin && (
          <DataCard
            title={(<span className="flex items-center gap-2"><Mail className="w-4 h-4 text-primary" />Envio automático por e-mail</span>)}
            testId="daily-email-report-card"
          >
            <div className="p-4 space-y-3">
              <p className="text-[13px] text-slate-500 dark:text-slate-400">
                Todo dia às 07:00 o sistema envia automaticamente, por e-mail, o relatório de movimentações do dia anterior pra cada Cliente ativo com e-mail cadastrado.
                Use os campos abaixo pra disparar o envio manualmente (útil pra testar ou reenviar um dia específico).
              </p>
              <div className="flex items-end gap-3 flex-wrap">
                <FilterField label="Data das movimentações">
                  <Input
                    type="date"
                    value={emailDate}
                    onChange={(e) => setEmailDate(e.target.value)}
                    className="h-9 text-sm"
                    data-testid="daily-email-report-date"
                  />
                </FilterField>
                <Button
                  onClick={sendDailyEmails}
                  disabled={sendingEmails || !emailDate}
                  data-testid="daily-email-report-send-btn"
                  className="h-9"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  {sendingEmails ? 'Enviando...' : 'Enviar agora'}
                </Button>
              </div>
              {emailResult && (
                <div className="text-[12px] space-y-1 pt-1">
                  <p className="text-emerald-700 dark:text-emerald-400">
                    Enviado para {emailResult.sent.length} cliente(s){emailResult.sent.length > 0 ? `: ${emailResult.sent.join(', ')}` : ''}
                  </p>
                  {emailResult.skipped.length > 0 && (
                    <p className="text-slate-500 dark:text-slate-400">
                      Sem movimentação no dia ({emailResult.skipped.length}): {emailResult.skipped.join(', ')}
                    </p>
                  )}
                  {emailResult.errors.length > 0 && (
                    <p className="text-red-600 dark:text-red-400">
                      Erro ao enviar para: {emailResult.errors.map((e) => `${e.client} (${e.error})`).join('; ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </DataCard>
        )}
      </div>
    </Layout>
  );
}
