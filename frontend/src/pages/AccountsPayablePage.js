import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, PeriodFilterFields, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider,
  ToolbarPrimary, StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import PeriodReportDialog from '../components/PeriodReportDialog';
import PaymentDialog from '../components/PaymentDialog';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useConfirm } from '../hooks/useConfirm';
import { useUrlState } from '../hooks/useUrlState';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { PAYABLE_STATUS, formatDay, formatMoney, payableLabel, payableStatus } from '../lib/payables';
import { toast } from 'sonner';
import {
  Wallet, Plus, Pencil, Trash2, CheckCircle2, Undo2, Ban, FileBarChart, ListTree, AlertTriangle, CalendarClock, CalendarDays, Paperclip,
} from 'lucide-react';

const STATUS_FILTERS = {
  A_VENCER: 'A vencer', VENCIDO: 'Vencidas', ABERTO: 'Em aberto (todas)', PAGO: 'Pagas', CANCELADO: 'Canceladas',
};
const DATE_FIELDS = { due_date: 'Vencimento', paid_date: 'Pagamento', issue_date: 'Emissão' };
// Os selects do relatório não aceitam valor vazio: "Todas" vai como ALL e sai aqui
const reportParams = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== 'ALL'));

export default function AccountsPayablePage() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [sums, setSums] = useState({ open: 0, paid: 0 });
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useUrlState('term', '');
  const [statusFilter, setStatusFilter] = useUrlState('status', '');
  const [accountFilter, setAccountFilter] = useUrlState('account', '');
  const [centerFilter, setCenterFilter] = useUrlState('center', '');
  const [dateField, setDateField] = useUrlState('date_field', 'due_date');
  const [period, setPeriod] = useUrlState('period', ['', '']);
  const debouncedSearch = useDebouncedValue(searchTerm.trim());
  const filterKey = `${debouncedSearch}|${statusFilter}|${accountFilter}|${centerFilter}|${dateField}|${period.join('|')}`;
  const requestSeq = useRef(0);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pagination, setPagination] = useState({ page: 1, perPage: 20, total: 0, totalPages: 0 });
  const [paying, setPaying] = useState([]);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    api.getChartAccounts().then((r) => setAccounts(r.data || [])).catch(() => {});
    api.getCostCenters().then((r) => setCenters(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setPagination((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
  }, [filterKey]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, filterKey]);

  const load = async () => {
    api.getPayablesSummary().then((r) => setSummary(r.data)).catch(() => {});
    try {
      const seq = ++requestSeq.current;
      const params = { page: pagination.page, per_page: pagination.perPage, date_field: dateField };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      if (accountFilter) params.account_id = accountFilter;
      if (centerFilter) params.cost_center_id = centerFilter;
      if (period[0]) params.date_from = period[0];
      if (period[1]) params.date_to = period[1];
      const { data } = await api.getPayables(params);
      if (seq !== requestSeq.current) return;
      setItems(data.items);
      setSums(data.sums);
      setPagination((prev) => ({ ...prev, total: data.total, totalPages: data.pages }));
      // Seleção só do que ainda está na tela
      setSelectedIds((prev) => new Set([...prev].filter((id) => data.items.some((i) => i.id === id))));
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao carregar as contas a pagar'));
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAllOnPage = () => {
    const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));
    setSelectedIds(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  };
  const selected = items.filter((i) => selectedIds.has(i.id));
  const single = selected.length === 1 ? selected[0] : null;
  const openSelected = selected.filter((i) => i.status === 'ABERTO');

  const run = async (action, success) => {
    try {
      await action();
      toast.success(success);
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível concluir'));
    }
  };

  const handleUnpay = async () => {
    if (!single || !(await confirm(`Estornar o pagamento da conta ${payableLabel(single)}? Ela volta para em aberto.`))) return;
    run(() => api.unpayPayable(single.id), 'Pagamento estornado');
  };
  const handleCancel = async () => {
    if (!single) return;
    const cancelling = single.status !== 'CANCELADO';
    if (!(await confirm(cancelling ? `Cancelar a conta ${payableLabel(single)}? Ela deixa de contar como a pagar.` : `Reativar a conta ${payableLabel(single)}?`))) return;
    run(() => api.cancelPayable(single.id, cancelling), cancelling ? 'Conta cancelada' : 'Conta reativada');
  };
  const handleDelete = async () => {
    if (!single) return;
    let wholeGroup = false;
    if (single.installments_total > 1) {
      wholeGroup = await confirm(
        `A conta ${payableLabel(single)} faz parte de um lançamento de ${single.installments_total} parcelas. Excluir todas as parcelas do lançamento? (Cancelar exclui só esta)`,
        'Excluir o lançamento inteiro?',
      );
    }
    if (!(await confirm(wholeGroup ? `Excluir as ${single.installments_total} parcelas do lançamento Nº ${single.payable_number}?` : `Excluir a conta ${payableLabel(single)}?`))) return;
    run(async () => { await api.deletePayable(single.id, wholeGroup); setSelectedIds(new Set()); }, 'Conta excluída');
  };

  const card = (key) => summary?.[key] || { count: 0, total: 0 };
  const hasFilters = !!(searchTerm || statusFilter || accountFilter || centerFilter || period[0] || period[1]);

  return (
    <Layout>
      <div className="space-y-4" data-testid="accounts-payable-page">
        <PageHeader icon={Wallet} title="Contas a Pagar" subtitle="Fornecedores, despesas fixas e parcelas, com plano de contas e centro de custo" />

        <StatGrid>
          <StatCard label="Vencidas" value={formatMoney(card('overdue').total)} icon={AlertTriangle} tone="red" hint={`${card('overdue').count} conta(s)`} testId="stat-overdue" />
          <StatCard label="Vencem hoje" value={formatMoney(card('today').total)} icon={CalendarClock} tone="amber" hint={`${card('today').count} conta(s)`} />
          <StatCard label="Próximos 7 dias" value={formatMoney(card('next_7_days').total)} icon={CalendarDays} tone="blue" hint={`${card('next_7_days').count} conta(s)`} />
          <StatCard label="Pagas no mês" value={formatMoney(card('paid_this_month').total)} icon={CheckCircle2} tone="emerald" hint={`${card('paid_this_month').count} conta(s)`} />
        </StatGrid>

        <FilterCard
          hasFilters={hasFilters}
          onClear={() => { setSearchTerm(''); setStatusFilter(''); setAccountFilter(''); setCenterFilter(''); setPeriod(['', '']); }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Nº, fornecedor, descrição ou documento" className="sm:col-span-2">
              <SearchInput value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="search-payable" />
            </FilterField>
            <FilterField label="Situação">
              <Select value={statusFilter || 'ALL'} onValueChange={(v) => setStatusFilter(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="payable-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  {Object.entries(STATUS_FILTERS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Plano de contas">
              <Select value={accountFilter || 'ALL'} onValueChange={(v) => setAccountFilter(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="payable-account-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Centro de custo">
              <Select value={centerFilter || 'ALL'} onValueChange={(v) => setCenterFilter(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="payable-center-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Período por">
              <Select value={dateField} onValueChange={setDateField}>
                <SelectTrigger className="h-9 text-sm" data-testid="payable-date-field"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DATE_FIELDS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <PeriodFilterFields value={period} onChange={setPeriod} testIdPrefix="payable" />
          </div>
        </FilterCard>

        <DataCard
          title="Contas"
          count={pagination.total.toLocaleString('pt-BR')}
          meta={<span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">Em aberto {formatMoney(sums.open)} · Pago {formatMoney(sums.paid)}</span>}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova conta" onClick={() => navigate('/accounts-payable/new')} testId="new-payable-btn" />}
            >
              <ToolbarButton icon={CheckCircle2} label={openSelected.length > 1 ? `Pagar ${openSelected.length}` : 'Pagar'} tone="primary"
                onClick={() => setPaying(openSelected)} disabled={openSelected.length === 0 || openSelected.length !== selected.length} testId="pay-payable-btn" />
              <ToolbarButton icon={Pencil} label="Editar" onClick={() => single && navigate(`/accounts-payable/${single.id}/edit`)} disabled={!single} testId="edit-payable-btn" />
              <ToolbarButton icon={Undo2} label="Estornar pagamento" onClick={handleUnpay} disabled={!single || single.status !== 'PAGO'} testId="unpay-payable-btn" />
              <ToolbarButton icon={Ban} label={single?.status === 'CANCELADO' ? 'Reativar' : 'Cancelar conta'} onClick={handleCancel}
                disabled={!single || !['ABERTO', 'CANCELADO'].includes(single.status)} testId="cancel-payable-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={!single || single.status === 'PAGO'} testId="delete-payable-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={FileBarChart} label="Relatório" onClick={() => setReportOpen(true)} testId="payable-report-btn" />
              <ToolbarButton icon={ListTree} label="Plano de contas e centros de custo" onClick={() => navigate('/chart-of-accounts')} testId="chart-accounts-btn" />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.total}
              pageSize={pagination.perPage}
              onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
            />
          )}
        >
          {loading ? (
            <EmptyState loading />
          ) : items.length === 0 ? (
            <EmptyState icon={Wallet} title="Nenhuma conta encontrada" hint={hasFilters ? 'Ajuste os filtros' : 'Lance a primeira conta em Nova conta'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox checked={items.length > 0 && items.every((i) => selectedIds.has(i.id))} onCheckedChange={toggleSelectAllOnPage} aria-label="Selecionar todas da página" />
                    </th>
                    <th>Nº</th>
                    <th>Vencimento</th>
                    <th>Fornecedor</th>
                    <th className="hidden md:table-cell">Descrição</th>
                    <th className="hidden 2xl:table-cell">Plano de contas</th>
                    <th className="hidden 2xl:table-cell">Centro de custo</th>
                    <th className="!text-right">Valor</th>
                    <th className="hidden xl:table-cell">Pagamento</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => {
                    const status = payableStatus(p);
                    return (
                      <tr key={p.id} onClick={() => toggleSelect(p.id)} onDoubleClick={() => navigate(`/accounts-payable/${p.id}/edit`)}
                        data-selected={selectedIds.has(p.id)} className="cursor-pointer">
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} aria-label={`Selecionar a conta ${payableLabel(p)}`} />
                        </td>
                        <td className="cell-strong tabular-nums whitespace-nowrap">
                          {p.payable_number}{p.installments_total > 1 && <span className="text-slate-400 dark:text-slate-500 font-normal"> {p.installment}/{p.installments_total}</span>}
                        </td>
                        <td className={`whitespace-nowrap tabular-nums ${status === 'VENCIDO' ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}>{formatDay(p.due_date)}</td>
                        <td><div className="max-w-[200px] truncate" title={p.supplier_name}>{p.supplier_name || '-'}</div></td>
                        <td className="hidden md:table-cell">
                          <div className="flex items-center gap-1.5 max-w-[260px]">
                            <span className="truncate" title={p.description}>{p.description}</span>
                            {p.document_number && <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">· {p.document_number}</span>}
                            {p.attachments?.length > 0 && <Paperclip className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-label={`${p.attachments.length} anexo(s)`} />}
                          </div>
                        </td>
                        <td className="hidden 2xl:table-cell"><div className="max-w-[200px] truncate">{p.account_name || '-'}</div></td>
                        <td className="hidden 2xl:table-cell">{p.cost_center_name || '-'}</td>
                        <td className="text-right tabular-nums whitespace-nowrap">{formatMoney(p.amount)}</td>
                        <td className="hidden xl:table-cell whitespace-nowrap tabular-nums">
                          {p.status === 'PAGO' ? <>{formatDay(p.paid_date)} <span className="text-slate-400 dark:text-slate-500">· {formatMoney(p.paid_amount)}</span></> : '-'}
                        </td>
                        <td><StatusPill tone={PAYABLE_STATUS[status].tone}>{PAYABLE_STATUS[status].label}</StatusPill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <PaymentDialog items={paying} onOpenChange={(open) => !open && setPaying([])} onDone={() => { setSelectedIds(new Set()); load(); }} />

      <PeriodReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Relatório de Contas a Pagar"
        description="Contas do período com os totais por conta do plano de contas e por centro de custo."
        statuses={[{ value: '', label: 'Todas' }, ...Object.entries(STATUS_FILTERS).map(([value, label]) => ({ value, label }))]}
        selects={[
          { key: 'date_field', label: 'Período por', options: Object.entries(DATE_FIELDS).map(([value, label]) => ({ value, label })) },
          { key: 'account_id', label: 'Plano de contas', options: [{ value: 'ALL', label: 'Todas' }, ...accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))] },
          { key: 'cost_center_id', label: 'Centro de custo', options: [{ value: 'ALL', label: 'Todos' }, ...centers.map((c) => ({ value: c.id, label: c.name }))] },
        ]}
        textFilters={[{ key: 'search', label: 'Fornecedor, descrição ou documento' }]}
        load={(p) => api.getPayablesReport(reportParams(p))}
        summarize={(d) => [
          ['Contas', d.summary.total],
          ['Em aberto', formatMoney(d.summary.open)],
          ['Vencido', formatMoney(d.summary.overdue)],
          ['Pago', formatMoney(d.summary.paid)],
        ]}
        downloadPdf={(p) => api.getPayablesReportPdf(reportParams(p))}
        downloadExcel={(p) => api.getPayablesReportExcel(reportParams(p))}
        filename="relatorio_contas_pagar"
      />
      <ConfirmDialog />
    </Layout>
  );
}
