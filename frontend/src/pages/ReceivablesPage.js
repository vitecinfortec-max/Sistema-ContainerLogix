import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatGrid, StatCard, FilterCard, FilterField, SearchInput, DataCard, StatusPill, EmptyState,
  Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
} from '../components/DataPage';
import PaymentDialog from '../components/PaymentDialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../hooks/useConfirm';
import { toast } from 'sonner';
import {
  PiggyBank, Clock, AlertTriangle, CheckCircle2, Timer, Printer, FileSpreadsheet, Plus, Pencil, Undo2, Ban, Trash2, ExternalLink, ListTree,
} from 'lucide-react';
import { format } from 'date-fns';
import { todayISO, calendarDate } from '../lib/dates';
import { cn } from '../lib/utils';

import { useUrlState } from '../hooks/useUrlState';
import { apiErrorMessage } from '../lib/errors';
const formatMoney = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDay = (value) => (value ? format(calendarDate(value), 'dd/MM/yyyy') : '-');

const AGING_TONES = {
  current: 'text-slate-700 dark:text-slate-200',
  d1_30: 'text-amber-600 dark:text-amber-400',
  d31_60: 'text-orange-600 dark:text-orange-400',
  d61_90: 'text-red-600 dark:text-red-400',
  d90: 'text-red-700 dark:text-red-300',
};

// Mesmas chaves de SOURCE_LABELS em backend/routers/receivables.py
const SOURCES = { FATURA: 'Faturas', PORTUARIO: 'Faturamento Portuário', VENDA: 'Venda de container', TITULO: 'Títulos avulsos' };
// Onde se dá baixa em cada origem (os títulos avulsos, aqui mesmo)
const SOURCE_PATHS = {
  FATURA: (row) => `/billing/${row.id}/edit`,
  PORTUARIO: () => '/port-services-billing',
  VENDA: () => '/container-sales',
};

function situation(row) {
  if (row.status === 'PAGO') return <StatusPill tone="emerald">Recebido</StatusPill>;
  if (row.aging === 'current') return <StatusPill tone="amber">A vencer</StatusPill>;
  return <StatusPill tone="red">Vencido</StatusPill>;
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
    toast.error(apiErrorMessage(error, 'Erro ao gerar o arquivo'));
  }
}

export default function ReceivablesPage() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useUrlState('status', 'PENDENTE');
  const [source, setSource] = useUrlState('source', '');
  const [clientQuery, setClientQuery] = useUrlState('clientQuery', '');
  const [dateField, setDateField] = useUrlState('dateField', 'issue');
  const [dateFrom, setDateFrom] = useUrlState('dateFrom', '');
  const [dateTo, setDateTo] = useUrlState('dateTo', '');
  const debouncedClient = useDebouncedValue(clientQuery.trim());
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [receiving, setReceiving] = useState([]);

  const params = () => {
    const p = { date_field: dateField };
    if (status) p.status = status;
    if (source) p.source = source;
    if (debouncedClient) p.client_name = debouncedClient;
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    return p;
  };

  useEffect(() => {
    setLoading(true);
    api.getReceivables(params())
      .then((res) => {
        setData(res.data);
        // Seleção só do que ainda está na tela
        setSelectedIds((prev) => new Set([...prev].filter((id) => res.data.rows.some((r) => r.id === id))));
      })
      .catch((error) => toast.error(apiErrorMessage(error, 'Erro ao carregar Contas a Receber')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, source, debouncedClient, dateField, dateFrom, dateTo, reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);

  const hasFilters = status !== 'PENDENTE' || !!(source || clientQuery || dateFrom || dateTo);
  const clearFilters = () => {
    setStatus('PENDENTE'); setSource(''); setClientQuery(''); setDateField('issue'); setDateFrom(''); setDateTo('');
  };

  const s = data?.summary;
  const rows = data?.rows || [];

  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
    setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  };
  const selected = rows.filter((r) => selectedIds.has(r.id));
  const single = selected.length === 1 ? selected[0] : null;
  const singleTitle = single?.source === 'TITULO' ? single : null;
  // Recebe-se aqui só título avulso em aberto; fatura, portuário e venda têm a baixa na tela deles
  const openTitles = selected.filter((r) => r.source === 'TITULO' && r.status === 'PENDENTE');
  const toReceive = openTitles.map((r) => ({ id: r.id, amount: r.open_value, due_date: r.due_date, client_name: r.client_name, number_label: r.number_label }));

  const run = async (action, success) => {
    try {
      await action();
      toast.success(success);
      setSelectedIds(new Set());
      reload();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível concluir'));
    }
  };
  const handleUnreceive = async () => {
    if (!singleTitle || !(await confirm(`Estornar o recebimento do título ${singleTitle.number_label}? Ele volta para em aberto.`))) return;
    run(() => api.unreceiveReceivableTitle(singleTitle.id), 'Recebimento estornado');
  };
  const handleCancel = async () => {
    if (!singleTitle || !(await confirm(`Cancelar o título ${singleTitle.number_label}? Ele deixa de contar como a receber e sai desta lista.`))) return;
    run(() => api.cancelReceivableTitle(singleTitle.id, true), 'Título cancelado');
  };
  const handleDelete = async () => {
    if (!singleTitle) return;
    const { data: title } = await api.getReceivableTitle(singleTitle.id);
    let wholeGroup = false;
    if (title.installments_total > 1) {
      wholeGroup = await confirm(
        `O título ${title.label} faz parte de um lançamento de ${title.installments_total} parcelas. Excluir todas as parcelas do lançamento? (Cancelar exclui só esta)`,
        'Excluir o lançamento inteiro?',
      );
    }
    if (!(await confirm(wholeGroup ? `Excluir as ${title.installments_total} parcelas do lançamento Nº ${title.receivable_number}?` : `Excluir o título ${title.label}?`))) return;
    run(() => api.deleteReceivableTitle(title.id, wholeGroup), 'Título excluído');
  };
  const openRow = (row) => {
    if (row.source === 'TITULO') navigate(`/accounts-receivable/${row.id}/edit`);
    else navigate(SOURCE_PATHS[row.source](row));
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="receivables-page">
        <PageHeader icon={PiggyBank} title="Contas a Receber" subtitle="Faturas, Faturamento Portuário, vendas de container e títulos avulsos: o que está em aberto, há quanto tempo, e o que já foi recebido" />

        <StatGrid>
          <StatCard label="Em aberto" value={formatMoney(s?.open_total)} icon={Clock} tone="blue" hint={s ? `${rows.filter((r) => r.status === 'PENDENTE').length} título(s)` : ''} testId="receivables-kpi-open" />
          <StatCard label="Vencido" value={formatMoney(s?.overdue_total)} icon={AlertTriangle} tone="red" hint="em aberto e já vencido" testId="receivables-kpi-overdue" />
          <StatCard label="Recebido" value={formatMoney(s?.paid_total)} icon={CheckCircle2} tone="emerald" hint={status === 'PENDENTE' ? 'mostre "Todos" ou "Recebidos"' : 'no filtro'} testId="receivables-kpi-paid" />
          <StatCard
            label="Prazo médio"
            value={s?.avg_days_to_receive != null ? `${Math.round(s.avg_days_to_receive)} dias` : '-'}
            icon={Timer} tone="violet" hint="de recebimento, da emissão à baixa"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Situação">
              <Select value={status || 'ALL'} onValueChange={(v) => setStatus(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="receivables-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDENTE">Em aberto</SelectItem>
                  <SelectItem value="PAGO">Recebidos</SelectItem>
                  <SelectItem value="ALL">Todos (menos cancelados)</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Origem">
              <Select value={source || 'ALL'} onValueChange={(v) => setSource(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="receivables-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  {Object.entries(SOURCES).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
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
            <FilterField label="Data inicial">
              <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </FilterField>
            <FilterField label="Data final">
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
                  <p className="text-xs text-muted-foreground">{a.count} título(s)</p>
                </div>
              ))}
            </div>
            {s.without_due_date > 0 && (
              <p className="px-4 pb-3 text-xs text-muted-foreground">
                {s.without_due_date} em aberto sem vencimento (Faturas antigas, Faturamento Portuário e vendas de container): o atraso conta da emissão.
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
                    <th className="!text-right">Títulos</th>
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

        <DataCard
          title="Títulos"
          count={rows.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo título" onClick={() => navigate('/accounts-receivable/new')} testId="new-receivable-btn" />}
            >
              <ToolbarButton icon={CheckCircle2} label={openTitles.length > 1 ? `Receber ${openTitles.length}` : 'Receber'} tone="primary"
                onClick={() => setReceiving(toReceive)} disabled={openTitles.length === 0 || openTitles.length !== selected.length} testId="receive-title-btn" />
              <ToolbarButton icon={Pencil} label="Editar" onClick={() => singleTitle && navigate(`/accounts-receivable/${singleTitle.id}/edit`)}
                disabled={!singleTitle || singleTitle.status !== 'PENDENTE'} testId="edit-title-btn" />
              <ToolbarButton icon={Undo2} label="Estornar recebimento" onClick={handleUnreceive} disabled={!singleTitle || singleTitle.status !== 'PAGO'} testId="unreceive-title-btn" />
              <ToolbarButton icon={Ban} label="Cancelar título" onClick={handleCancel} disabled={!singleTitle || singleTitle.status !== 'PENDENTE'} testId="cancel-title-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={!singleTitle || singleTitle.status !== 'PENDENTE'} testId="delete-title-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={ExternalLink} label="Abrir origem" onClick={() => single && openRow(single)} disabled={!single || single.source === 'TITULO'} testId="open-source-btn" />
              <ToolbarButton icon={ListTree} label="Plano de contas e centros de custo" onClick={() => navigate('/chart-of-accounts')} testId="chart-accounts-btn" />
            </Toolbar>
          )}
        >
          {loading ? (
            <EmptyState loading />
          ) : rows.length === 0 ? (
            <EmptyState icon={PiggyBank} title="Nada a receber encontrado" hint={hasFilters ? 'Ajuste os filtros' : 'Nenhum título em aberto'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox checked={rows.length > 0 && rows.every((r) => selectedIds.has(r.id))} onCheckedChange={toggleSelectAll} aria-label="Selecionar todos" />
                    </th>
                    <th>Origem</th>
                    <th>Nº</th>
                    <th>Cliente</th>
                    <th className="hidden lg:table-cell">Emissão</th>
                    <th>Vencimento</th>
                    <th className="!text-right">Atraso</th>
                    <th className="hidden xl:table-cell">Recebido em</th>
                    <th>Situação</th>
                    <th className="!text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} data-testid="receivables-row" onClick={() => toggleSelect(r.id)} onDoubleClick={() => openRow(r)}
                      data-selected={selectedIds.has(r.id)} className="cursor-pointer" title={r.source === 'TITULO' ? 'Duplo clique abre o título' : 'Duplo clique abre a origem'}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} aria-label={`Selecionar ${r.source_label} ${r.number_label}`} />
                      </td>
                      <td className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{r.source_label}</td>
                      <td className="cell-strong tabular-nums whitespace-nowrap">{r.source === 'FATURA' || r.source === 'PORTUARIO' ? `#${r.number_label}` : r.number_label}</td>
                      <td>
                        <div className="max-w-[240px] truncate" title={r.client_name}>{r.client_name}</div>
                        {r.description && <div className="max-w-[240px] truncate text-[0.6875rem] text-muted-foreground" title={r.description}>{r.description}</div>}
                      </td>
                      <td className="hidden lg:table-cell whitespace-nowrap tabular-nums">{formatDay(r.issue_date)}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatDay(r.due_date)}</td>
                      <td className={cn('text-right whitespace-nowrap tabular-nums', r.aging && AGING_TONES[r.aging])}>
                        {r.days_overdue ? `${r.days_overdue} dia(s)` : '-'}
                        {r.aging_from_issue && r.days_overdue ? <div className="text-[0.6875rem] text-muted-foreground">da emissão</div> : null}
                      </td>
                      <td className="hidden xl:table-cell whitespace-nowrap tabular-nums">{formatDay(r.paid_date)}</td>
                      <td>{situation(r)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums cell-strong">
                        {formatMoney(r.status === 'PENDENTE' ? r.open_value : r.total_value)}
                        {r.credit_applied > 0 && (
                          <div className="text-[0.6875rem] font-normal text-muted-foreground">
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

      <PaymentDialog mode="receive" items={receiving} onOpenChange={(open) => !open && setReceiving([])} onDone={() => { setSelectedIds(new Set()); reload(); }} />
      <ConfirmDialog />
    </Layout>
  );
}
