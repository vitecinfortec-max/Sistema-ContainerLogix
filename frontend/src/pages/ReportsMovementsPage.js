import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { FileText, FileSpreadsheet, Calendar, X, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} style={{ color: entry.color }} className="font-medium">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

export default function ReportsMovementsPage() {
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

  return (
    <Layout>
      <div className="space-y-5" data-testid="reports-movements-page">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Relatório de Movimentações
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Gere e exporte relatórios das movimentações de containers</p>
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
                <button onClick={clearFilters} className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-primary flex items-center gap-1 font-normal" data-testid="report-clear-filters">
                  <X className="w-3 h-3" />
                  Limpar
                </button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Início</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-8 text-xs"
                  data-testid="report-date-from"
                />
              </div>
              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Data Fim</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-8 text-xs"
                  data-testid="report-date-to"
                />
              </div>

              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Operação</Label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="h-8 text-xs" data-testid="report-filter-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[13px]">Todas as Operações</SelectItem>
                    <SelectItem value="ENTRADA" className="text-[13px]">Apenas Entradas</SelectItem>
                    <SelectItem value="SAIDA" className="text-[13px]">Apenas Saídas</SelectItem>
                    <SelectItem value="ESTOQUE" className="text-[13px]">Estoque Atual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-8 text-xs" data-testid="report-filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-[13px]">Todos os Status</SelectItem>
                    <SelectItem value="CHEIO" className="text-[13px]">Cheio</SelectItem>
                    <SelectItem value="VAZIO" className="text-[13px]">Vazio</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Cliente - Autocomplete (digite para buscar) */}
              <div ref={clientBoxRef}>
                <Label className="text-[9px] text-slate-400 dark:text-slate-500 mb-0.5 block uppercase tracking-wide font-semibold">Cliente</Label>
                <div className="relative">
                <Input
                  value={clientSearch}
                  onChange={(e) => handleClientSearch(e.target.value)}
                  onFocus={() => {
                    if (clientSearch.length >= 1 && clientSuggestions.length > 0) {
                      setShowClientSuggestions(true);
                    }
                  }}
                  className={`h-8 text-xs pr-8 ${filterClient !== 'all' ? 'border-emerald-500 bg-emerald-50' : ''}`}
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
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Barra de ações */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={downloadPDF}
            disabled={loading}
            title="Baixar PDF"
            data-testid="download-pdf-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <FileText className="w-4 h-4 text-red-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={downloadExcel}
            disabled={loading}
            title="Baixar Excel"
            data-testid="download-excel-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <FileSpreadsheet className="w-4 h-4 text-green-600" />
          </Button>
        </div>

        {/* Entradas e Saídas por Dia */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="daily-chart-card">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Entradas e Saídas por Dia</CardTitle>
              <span className="text-xs text-slate-400 dark:text-slate-500">(últimos 14 dias)</span>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {dailyChart.length > 0 ? (
              <div className="h-72 w-full" data-testid="daily-chart">
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
                    <Bar dataKey="entries" name="Entradas" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="exits" name="Saídas" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={28} />
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
