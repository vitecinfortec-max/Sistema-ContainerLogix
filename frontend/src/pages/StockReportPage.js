import { useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Download, FileSpreadsheet } from 'lucide-react';

export default function StockReportPage() {
  const [downloading, setDownloading] = useState(false);

  const downloadExcel = async () => {
    setDownloading(true);
    try {
      const r = await api.getStockReportExcel();
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'relatorio_estoque.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório gerado!');
    } catch (e) {
      toast.error('Erro ao gerar relatório');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-5" data-testid="stock-report-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Relatório de Estoque</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Exporte o relatório completo do estoque atual</p>
        </div>

        <Card className="max-w-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] font-medium flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              Relatório Excel
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-4">
              Gera uma planilha com todos os produtos cadastrados: código, almoxarifado, descrição, quantidade e valor.
            </p>
            <Button onClick={downloadExcel} disabled={downloading} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="download-stock-report-button">
              <Download className="w-4 h-4 mr-2" />
              {downloading ? 'Gerando...' : 'Baixar Excel'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
