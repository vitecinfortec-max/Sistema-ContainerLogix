import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatGrid, StatCard, FilterCard, FilterField, DataCard, EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Scale, ArrowDownCircle, ArrowUpCircle, Wallet, Hourglass, Printer, FileSpreadsheet, Info } from 'lucide-react';
import { todayISO } from '../lib/dates';
import { cn } from '../lib/utils';

const formatMoney = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

async function download(request, params, filename) {
  try {
    const response = await request(params);
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    toast.error('Erro ao gerar o arquivo');
  }
}

// Linhas de uma categoria com barra proporcional ao maior valor do bloco
function Lines({ rows, tone, testId }) {
  const max = Math.max(...rows.map((r) => r.total), 0);
  if (rows.length === 0) return <EmptyState title="Nenhum módulo contratado para este bloco" />;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{r.label}</span>
            <span className="text-sm font-semibold tabular-nums">{formatMoney(r.total)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div className={cn('h-full rounded-full', tone)} style={{ width: max ? `${(r.total / max) * 100}%` : 0 }} />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums w-24 text-right">{r.count} lançamento(s)</span>
          </div>
          {r.note && (
            <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground"><Info className="w-3 h-3 mt-0.5 shrink-0" />{r.note}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function FinancialSummaryPage() {
  const [[dateFrom, dateTo], setPeriod] = useState(() => monthRange(todayISO().slice(0, 7)));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    api.getFinancialSummary({ date_from: dateFrom, date_to: dateTo })
      .then((res) => setData(res.data))
      .catch((error) => toast.error(error.response?.data?.detail || 'Erro ao carregar o resumo'))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  const params = { date_from: dateFrom, date_to: dateTo };
  const s = data?.summary;

  return (
    <Layout>
      <div className="space-y-4">
        <PageHeader icon={Scale} title="Resumo Financeiro" subtitle="O que entrou e saiu no período, somando todos os módulos, e o que falta receber e pagar" />

        <FilterCard
          title="Período"
          actions={(
            <>
              <Button variant="outline" size="sm" onClick={() => download(api.downloadFinancialSummaryPdf, params, `resumo_financeiro_${dateFrom}_${dateTo}.pdf`)} data-testid="summary-pdf">
                <Printer className="w-4 h-4 mr-1.5" /> PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => download(api.downloadFinancialSummaryExcel, params, `resumo_financeiro_${dateFrom}_${dateTo}.xlsx`)} data-testid="summary-excel">
                <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
            <FilterField label="Mês">
              <Input type="month" className="h-9 text-sm" value={dateFrom.slice(0, 7) === dateTo.slice(0, 7) ? dateFrom.slice(0, 7) : ''}
                onChange={(e) => e.target.value && setPeriod(monthRange(e.target.value))} data-testid="summary-month" />
            </FilterField>
            <FilterField label="De">
              <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setPeriod([e.target.value, dateTo])} />
            </FilterField>
            <FilterField label="Até">
              <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setPeriod([dateFrom, e.target.value])} />
            </FilterField>
          </div>
        </FilterCard>

        <StatGrid>
          <StatCard label="Entradas" value={formatMoney(s?.inflow_total)} icon={ArrowDownCircle} tone="emerald" hint="recebido no período" testId="summary-inflow" />
          <StatCard label="Saídas" value={formatMoney(s?.outflow_total)} icon={ArrowUpCircle} tone="red" hint="pago no período" testId="summary-outflow" />
          <StatCard label="Saldo do período" value={formatMoney(s?.balance)} icon={Wallet} tone={(s?.balance || 0) >= 0 ? 'blue' : 'red'} hint="entradas - saídas" testId="summary-balance" />
          <StatCard label="A receber / a pagar" value={formatMoney((s?.receivable_total || 0) - (s?.payable_total || 0))} icon={Hourglass} tone="violet"
            hint={s ? `${formatMoney(s.receivable_total)} a receber · ${formatMoney(s.payable_total)} a pagar` : ''} />
        </StatGrid>

        {loading && !data ? (
          <DataCard title="Carregando"><EmptyState loading /></DataCard>
        ) : data && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <DataCard title="Entradas no período"><Lines rows={data.inflows} tone="bg-emerald-500" testId="summary-inflows" /></DataCard>
              <DataCard title="Saídas no período"><Lines rows={data.outflows} tone="bg-red-500" testId="summary-outflows" /></DataCard>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <DataCard title="A receber (posição de hoje)"><Lines rows={data.receivable} tone="bg-blue-500" /></DataCard>
              <DataCard title="A pagar (posição de hoje)"><Lines rows={data.payable} tone="bg-amber-500" /></DataCard>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
