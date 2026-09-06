import { useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { FileSpreadsheet } from 'lucide-react';

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

        {/* Barra de ações */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={downloadExcel}
            disabled={downloading}
            title="Baixar Excel"
            data-testid="download-stock-report-button"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <FileSpreadsheet className="w-4 h-4 text-green-600" />
          </Button>
        </div>
      </div>
    </Layout>
  );
}
