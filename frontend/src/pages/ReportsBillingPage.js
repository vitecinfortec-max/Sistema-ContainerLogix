import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Download, FileText, FileSpreadsheet, Calendar, X } from 'lucide-react';
import { format } from 'date-fns';

export default function ReportsBillingPage() {
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterClient, setFilterClient] = useState('all');
  const [billedFilter, setBilledFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState([]);

  // Autocomplete de cliente
  const [clientSearch, setClientSearch] = useState('');
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const clientBoxRef = useRef(null);

  useEffect(() => {
    loadClients();
  }, []);

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

  const downloadPDF = async () => {
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

  return (
    <Layout>
      <div className="space-y-5" data-testid="reports-billing-page">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Relatório de Faturamento
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Gere relatórios financeiros com dados de faturamento das movimentações</p>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700"></div>

        {/* Filters */}
        <Card className="shadow-sm">
          <CardHeader className="bg-slate-50 dark:bg-slate-800/50 pb-3 pt-4">
            <CardTitle className="flex items-center gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">
              <Calendar className="w-4 h-4" />
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-36">
                <Label className="text-[11px] text-slate-500 dark:text-slate-400 mb-1 block">Data Início</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-10 text-[13px]"
                  data-testid="report-billing-date-from"
                />
              </div>
              <div className="w-36">
                <Label className="text-[11px] text-slate-500 dark:text-slate-400 mb-1 block">Data Fim</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-10 text-[13px]"
                  data-testid="report-billing-date-to"
                />
              </div>
              {hasFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearFilters}
                  className="h-10 text-[13px] text-slate-600 dark:text-slate-400"
                  data-testid="report-billing-clear-filters"
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Limpar
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-10 text-[13px]" data-testid="report-billing-filter-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todas as Operações</SelectItem>
                  <SelectItem value="ENTRADA" className="text-[13px]">Apenas Entradas</SelectItem>
                  <SelectItem value="SAIDA" className="text-[13px]">Apenas Saídas</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-10 text-[13px]" data-testid="report-billing-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todos os Status</SelectItem>
                  <SelectItem value="CHEIO" className="text-[13px]">Cheio</SelectItem>
                  <SelectItem value="VAZIO" className="text-[13px]">Vazio</SelectItem>
                </SelectContent>
              </Select>

              {/* Cliente - Autocomplete (digite para buscar) */}
              <div className="relative" ref={clientBoxRef}>
                <Input
                  value={clientSearch}
                  onChange={(e) => handleClientSearch(e.target.value)}
                  onFocus={() => {
                    if (clientSearch.length >= 1 && clientSuggestions.length > 0) {
                      setShowClientSuggestions(true);
                    }
                  }}
                  className={`h-10 text-[13px] pr-8 ${filterClient !== 'all' ? 'border-emerald-500 bg-emerald-50' : ''}`}
                  data-testid="report-billing-filter-client"
                />
                {filterClient !== 'all' && (
                  <button
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

              <Select value={billedFilter} onValueChange={setBilledFilter}>
                <SelectTrigger className="h-10 text-[13px]" data-testid="report-billing-filter-billed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todas</SelectItem>
                  <SelectItem value="billed" className="text-[13px]">Faturadas</SelectItem>
                  <SelectItem value="unbilled" className="text-[13px]">Não Faturadas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Download Card - Only Excel */}
        <Card className="border-l-4 border-l-amber-400 shadow-sm hover:shadow-md transition-shadow max-w-md">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-[13px] font-medium text-slate-700 dark:text-slate-300">
              <FileSpreadsheet className="w-4 h-4 text-amber-500" />
              Faturamento Excel
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
              Exporta planilha com valores de operação e totais para controle financeiro.
            </p>
            <Button
              onClick={downloadExcel}
              disabled={loading}
              className="w-full h-10 text-[13px] font-semibold uppercase tracking-wide bg-amber-600 hover:bg-amber-700"
              data-testid="download-billing-excel-button"
            >
              <Download className="w-4 h-4 mr-2" />
              {loading ? 'Gerando...' : 'Baixar Excel'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
