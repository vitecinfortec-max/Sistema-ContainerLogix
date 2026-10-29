import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatGrid, StatCard, FilterCard, FilterField, SearchInput, DataCard, StatusPill, EmptyState,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { toast } from 'sonner';
import { PiggyBank, Clock, AlertTriangle, CheckCircle2, Timer, Printer, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { todayISO, calendarDate } from '../lib/dates';
import { cn } from '../lib/utils';

const formatMoney = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDay = (value) => (value ? format(calendarDate(value), 'dd/MM/yyyy') : '-');

const AGING_TONES = {
  current: 'text-slate-700 dark:text-slate-200',
  d1_30: 'text-amber-600 dark:text-amber-400',
  d31_60: 'text-orange-600 dark:text-orange-400',
  d61_90: 'text-red-600 dark:text-red-400',
  d90: 'text-red-700 dark:text-red-300',
};

function situation(row) {
  if (row.status === 'PAGO') return <StatusPill tone="emerald">Recebida</StatusPill>;
  if (row.aging === 'current') return <StatusPill tone="amber">A vencer</StatusPill>;
  return <StatusPill tone="red">Vencida</StatusPill>;
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

export default function ReceivablesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('PENDENTE');
  const [clientQuery, setClientQuery] = useState('');
  const [dateField, setDateField] = useState('issue');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedClient = useDebouncedValue(clientQuery.trim());

  const params = () => {
    const p = { date_field: dateField };
    if (status) p.status = status;
    if (debouncedClient) p.client_name = debouncedClient;
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    return p;
  };

  useEffect(() => {
    setLoading(true);
    api.getReceivables(params())
      .then((res) => setData(res.data))
      .catch((error) => toast.error(error.response?.data?.detail || 'Erro ao carregar Contas a Receber'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, debouncedClient, dateField, dateFrom, dateTo]);

  const hasFilters = status !== 'PENDENTE' || !!(clientQuery || dateFrom || dateTo);
  const clearFilters = () => {
    setStatus('PENDENTE'); setClientQuery(''); setDateField('issue'); setDateFrom(''); setDateTo('');
  };

  const s = data?.summary;
  const rows = data?.rows || [];

  return (
    <Layout>
      <div className="space-y-4">
        <PageHeader icon={PiggyBank} title="Contas a Receber" subtitle="Faturas em aberto por tempo de atraso, por cliente, e o que já foi recebido" />

        <StatGrid>
          <StatCard label="Em aberto" value={formatMoney(s?.open_total)} icon={Clock} tone="blue" hint={s ? `${rows.filter((r) => r.status === 'PENDENTE').length} fatura(s)` : ''} testId="receivables-kpi-open" />
          <StatCard label="Vencido" value={formatMoney(s?.overdue_total)} icon={AlertTriangle} tone="red" hint="em aberto e já vencido" testId="receivables-kpi-overdue" />
          <StatCard label="Recebido" value={formatMoney(s?.paid_total)} icon={CheckCircle2} tone="emerald" hint={status === 'PENDENTE' ? 'mostre "Todas" ou "Recebidas"' : 'no filtro'} testId="receivables-kpi-paid" />
          <StatCard
            label="Prazo médio de recebimento"
            value={s?.avg_days_to_receive != null ? `${Math.round(s.avg_days_to_receive)} dias` : '-'}
            icon={Timer} tone="violet" hint="da emissão ao recebimento"
          />
        </StatGrid>

        <FilterCard
          hasFilters={hasFilters}
          onClear={clearFilters}
          actions={(
            <>
              <Button variant="outline" size="sm" onClick={() => download(api.downloadReceivablesPdf, params(), `contas_a_receber_${todayISO()}.pdf`)} data-testid="receivables-pdf">
                <Printer className="w-4 h-4 mr-1.5" /> PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => download(api.downloadReceivablesExcel, params(), `contas_a_receber_${todayISO()}.xlsx`)} data-testid="receivables-excel">
                <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <FilterField label="Situação">
              <Select value={status || 'ALL'} onValueChange={(v) => setStatus(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="receivables-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDENTE">Em aberto</SelectItem>
                  <SelectItem value="PAGO">Recebidas</SelectItem>
                  <SelectItem value="ALL">Todas (menos canceladas)</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Cliente">
              <SearchInput value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} data-testid="receivables-client" />
            </FilterField>
            <FilterField label="Período por">
              <Select value={dateField} onValueChange={setDateField}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="issue">Emissão</SelectItem>
                  <SelectItem value="due">Vencimento</SelectItem>
                  <SelectItem value="paid">Recebimento</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="De">
              <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </FilterField>
            <FilterField label="Até">
              <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </FilterField>
          </div>
        </FilterCard>

        {s && s.open_total > 0 && (
          <DataCard title="Em aberto por tempo de atraso">
            <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-slate-800">
              {s.aging.map((a) => (
                <div key={a.key} className="p-4" data-testid={`receivables-aging-${a.key}`}>
                  <p className="text-xs text-muted-foreground">{a.label}</p>
                  <p className={cn('text-lg font-semibold tabular-nums', AGING_TONES[a.key])}>{formatMoney(a.total)}</p>
                  <p className="text-xs text-muted-foreground">{a.count} fatura(s)</p>
                </div>
              ))}
            </div>
            {s.without_due_date > 0 && (
              <p className="px-4 pb-3 text-xs text-muted-foreground">
                {s.without_due_date} fatura(s) em aberto sem vencimento: o atraso conta da emissão. Informe o vencimento editando a fatura.
              </p>
            )}
          </DataCard>
        )}

        {data?.clients?.length > 0 && (
          <DataCard title="Por cliente" count={data.clients.length}>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className="!text-right">Faturas</th>
                    <th className="!text-right">Em aberto</th>
                    <th className="!text-right">Vencido</th>
                    <th className="!text-right">Recebido</th>
                  </tr>
                </thead>
                <tbody>
                  {data.clients.map((c) => (
                    <tr key={c.client_name} className="cursor-pointer" onClick={() => setClientQuery(c.client_name)} title="Filtrar por este cliente">
                      <td className="cell-strong">{c.client_name}</td>
                      <td className="text-right tabular-nums">{c.count}</td>
                      <td className="text-right tabular-nums">{formatMoney(c.open)}</td>
                      <td className={cn('text-right tabular-nums', c.overdue > 0 && 'text-destructive font-semibold')}>{formatMoney(c.overdue)}</td>
                      <td className="text-right tabular-nums">{formatMoney(c.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataCard>
        )}

        <DataCard title="Faturas" count={rows.length}>
          {loading ? (
            <EmptyState loading />
          ) : rows.length === 0 ? (
            <EmptyState icon={PiggyBank} title="Nenhuma fatura encontrada" hint={hasFilters ? 'Ajuste os filtros' : 'Nenhuma fatura em aberto'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Cliente</th>
                    <th>Emissão</th>
                    <th>Vencimento</th>
                    <th className="!text-right">Atraso</th>
                    <th>Recebida em</th>
                    <th>Situação</th>
                    <th className="!text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} data-testid="receivables-row">
                      <td className="cell-strong tabular-nums">#{r.invoice_number}</td>
                      <td>{r.client_name}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatDay(r.issue_date)}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatDay(r.due_date)}</td>
                      <td className={cn('text-right whitespace-nowrap tabular-nums', r.aging && AGING_TONES[r.aging])}>
                        {r.days_overdue ? `${r.days_overdue} dia(s)` : '-'}
                        {r.aging_from_issue && r.days_overdue ? <div className="text-[11px] text-muted-foreground">da emissão</div> : null}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{formatDay(r.paid_date)}</td>
                      <td>{situation(r)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">
                        {formatMoney(r.status === 'PENDENTE' ? r.open_value : r.total_value)}
                        {r.credit_applied > 0 && (
                          <div className="text-[11px] font-normal text-muted-foreground">
                            {r.status === 'PENDENTE' ? `de ${formatMoney(r.total_value)} · ` : ''}crédito {formatMoney(r.credit_applied)}
                          </div>
                        )}
                      </td>
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
