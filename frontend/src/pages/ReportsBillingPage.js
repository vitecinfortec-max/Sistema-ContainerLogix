import { useState, useEffect } from 'react';
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

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      const response = await api.getClients();
      setClients(response.data);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
    }
  };

  const clearFilters = () => {
    setFilterType('all');
    setFilterStatus('all');
    setFilterClient('all');
    setBilledFilter('all');
    setDateFrom('');
    setDateTo('');
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
          <h1 className="text-lg font-semibold text-slate-800">
            Relatório de Faturamento
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Gere relatórios financeiros com dados de faturamento das movimentações</p>
        </div>

        <div className="border-t border-slate-200"></div>

        {/* Filters */}
        <Card className="shadow-sm">
          <CardHeader className="bg-slate-50/50 pb-3 pt-4">
            <CardTitle className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
              <Calendar className="w-4 h-4" />
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-36">
                <Label className="text-[11px] text-slate-500 mb-1 block">Data Início</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-10 text-[13px]"
                  data-testid="report-billing-date-from"
                />
              </div>
              <div className="w-36">
                <Label className="text-[11px] text-slate-500 mb-1 block">Data Fim</Label>
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
                  className="h-10 text-[13px] text-slate-600"
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
                  <SelectValue placeholder="Todas as Operações" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todas as Operações</SelectItem>
                  <SelectItem value="ENTRADA" className="text-[13px]">Apenas Entradas</SelectItem>
                  <SelectItem value="SAIDA" className="text-[13px]">Apenas Saídas</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-10 text-[13px]" data-testid="report-billing-filter-status">
                  <SelectValue placeholder="Todos os Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todos os Status</SelectItem>
                  <SelectItem value="CHEIO" className="text-[13px]">Cheio</SelectItem>
                  <SelectItem value="VAZIO" className="text-[13px]">Vazio</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterClient} onValueChange={setFilterClient}>
                <SelectTrigger className="h-10 text-[13px]" data-testid="report-billing-filter-client">
                  <SelectValue placeholder="Todos os Clientes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todos os Clientes</SelectItem>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.name} className="text-[13px]">{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={billedFilter} onValueChange={setBilledFilter}>
                <SelectTrigger className="h-10 text-[13px]" data-testid="report-billing-filter-billed">
                  <SelectValue placeholder="Faturamento" />
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
            <CardTitle className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
              <FileSpreadsheet className="w-4 h-4 text-amber-500" />
              Faturamento Excel
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <p className="text-[11px] text-slate-500 mb-3">
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
