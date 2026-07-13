import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Download, FileText, FileSpreadsheet, Calendar, X, DollarSign, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';

export default function ReportsPage() {
  const [reportType, setReportType] = useState('movements');
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
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  };

  const buildBillingParams = () => {
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

  const downloadBillingPDF = async () => {
    setLoading(true);
    try {
      const params = buildBillingParams();
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

  const downloadBillingExcel = async () => {
    setLoading(true);
    try {
      const params = buildBillingParams();
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

  const isMovements = reportType === 'movements';
  const isBilling = reportType === 'billing';

  return (
    <Layout>
      <div className="space-y-6" data-testid="reports-page">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900" style={{ fontFamily: 'Chivo, sans-serif' }}>
            Relatórios
          </h1>
          <p className="text-slate-500 mt-1">Gere e exporte relatórios das movimentações e faturamento</p>
        </div>

        <div className="border-t border-slate-200"></div>

        {/* Report Type Selector */}
        <div className="flex gap-3">
          <Button
            variant={isMovements ? 'default' : 'outline'}
            onClick={() => { setReportType('movements'); clearFilters(); }}
            className={`flex items-center gap-2 h-11 px-5 font-semibold ${isMovements ? 'bg-primary hover:bg-primary/90' : ''}`}
            data-testid="report-type-movements"
          >
            <BarChart3 className="w-4 h-4" />
            Relatório de Movimentações
          </Button>
          <Button
            variant={isBilling ? 'default' : 'outline'}
            onClick={() => { setReportType('billing'); clearFilters(); }}
            className={`flex items-center gap-2 h-11 px-5 font-semibold ${isBilling ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'border-amber-500 text-amber-700 hover:bg-amber-50'}`}
            data-testid="report-type-billing"
          >
            <DollarSign className="w-4 h-4" />
            Relatório de Faturamento
          </Button>
        </div>

        {/* Filters Card */}
        <Card className="shadow-sm">
          <CardHeader className="bg-slate-50/50 pb-4">
            <CardTitle className="flex items-center gap-2 text-base font-medium text-slate-700">
              <Calendar className="w-5 h-5" />
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {/* Row 1: Dates */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-36">
                <Label className="text-xs text-slate-500 mb-1 block">Data Início</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-11"
                  data-testid="report-date-from"
                />
              </div>
              <div className="w-36">
                <Label className="text-xs text-slate-500 mb-1 block">Data Fim</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-11"
                  data-testid="report-date-to"
                />
              </div>
              {hasFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearFilters}
                  className="h-11 text-slate-600"
                  data-testid="report-clear-filters"
                >
                  <X className="w-4 h-4 mr-1" />
                  Limpar
                </Button>
              )}
            </div>

            {/* Row 2: Filters */}
            <div className={`grid grid-cols-1 gap-3 ${isBilling ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
              {isMovements && (
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="h-11" data-testid="report-filter-type">
                    <SelectValue placeholder="Todas as Operações" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as Operações</SelectItem>
                    <SelectItem value="ENTRADA">Apenas Entradas</SelectItem>
                    <SelectItem value="SAIDA">Apenas Saídas</SelectItem>
                    <SelectItem value="ESTOQUE">Estoque Atual</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {isBilling && (
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="h-11" data-testid="report-billing-filter-type">
                    <SelectValue placeholder="Todas as Operações" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as Operações</SelectItem>
                    <SelectItem value="ENTRADA">Apenas Entradas</SelectItem>
                    <SelectItem value="SAIDA">Apenas Saídas</SelectItem>
                  </SelectContent>
                </Select>
              )}

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-11" data-testid="report-filter-status">
                  <SelectValue placeholder="Todos os Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="CHEIO">Cheio</SelectItem>
                  <SelectItem value="VAZIO">Vazio</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterClient} onValueChange={setFilterClient}>
                <SelectTrigger className="h-11" data-testid="report-filter-client">
                  <SelectValue placeholder="Todos os Clientes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Clientes</SelectItem>
                  {clients.map(client => (
                    <SelectItem key={client.id} value={client.name}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isBilling && (
                <Select value={billedFilter} onValueChange={setBilledFilter}>
                  <SelectTrigger className="h-11" data-testid="report-filter-billed">
                    <SelectValue placeholder="Faturamento" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="billed">Faturadas</SelectItem>
                    <SelectItem value="unbilled">Não Faturadas</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Download Cards */}
        {isMovements && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-l-4 border-l-primary shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-slate-700">
                  <FileText className="w-5 h-5 text-primary" />
                  Relatório PDF
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={downloadPDF}
                  disabled={loading}
                  className="w-full h-11 font-bold uppercase tracking-wide bg-primary hover:bg-primary/90"
                  data-testid="download-pdf-button"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {loading ? 'Gerando...' : 'Baixar PDF'}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-emerald-500 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-slate-700">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-500" />
                  Relatório Excel
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={downloadExcel}
                  disabled={loading}
                  variant="outline"
                  className="w-full h-11 font-bold uppercase tracking-wide border-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50"
                  data-testid="download-excel-button"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {loading ? 'Gerando...' : 'Baixar Excel'}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {isBilling && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-l-4 border-l-amber-500 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-slate-700">
                  <FileText className="w-5 h-5 text-amber-500" />
                  Faturamento PDF
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-slate-500 mb-3">
                  Gera relatório com dados financeiros: cliente, tipo de serviço, nota fiscal e valor da operação.
                </p>
                <Button
                  onClick={downloadBillingPDF}
                  disabled={loading}
                  className="w-full h-11 font-bold uppercase tracking-wide bg-amber-600 hover:bg-amber-700"
                  data-testid="download-billing-pdf-button"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {loading ? 'Gerando...' : 'Baixar PDF'}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-amber-400 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-medium text-slate-700">
                  <FileSpreadsheet className="w-5 h-5 text-amber-400" />
                  Faturamento Excel
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-slate-500 mb-3">
                  Exporta planilha com valores de operação e totais para controle financeiro.
                </p>
                <Button
                  onClick={downloadBillingExcel}
                  disabled={loading}
                  variant="outline"
                  className="w-full h-11 font-bold uppercase tracking-wide border-2 border-amber-500 text-amber-700 hover:bg-amber-50"
                  data-testid="download-billing-excel-button"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {loading ? 'Gerando...' : 'Baixar Excel'}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}
