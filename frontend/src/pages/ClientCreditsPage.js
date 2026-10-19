import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatGrid, StatCard, FilterCard, FilterField, PeriodFilterFields, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Field } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { toast } from 'sonner';
import {
  Coins, Plus, Receipt, Undo2, RotateCcw, FileText, Wallet, Users, ArrowDownCircle, ArrowUpCircle, Printer, FileSpreadsheet, X,
} from 'lucide-react';
import { format } from 'date-fns';
import { todayISO, calendarDate } from '../lib/dates';

const PAGE_SIZE = 15;

const TYPES = {
  CREDITO: { label: 'Crédito', tone: 'emerald' },
  USO: { label: 'Uso em fatura', tone: 'blue' },
  DEVOLUCAO: { label: 'Devolução', tone: 'violet' },
  ESTORNO: { label: 'Estorno', tone: 'slate' },
};

const METHODS = {
  PIX: 'PIX', TED: 'TED/DOC', BOLETO: 'Boleto', DEPOSITO: 'Depósito', DINHEIRO: 'Dinheiro', CHEQUE: 'Cheque', OUTRO: 'Outro',
};

const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDay = (value) => (value ? format(calendarDate(value), 'dd/MM/yyyy') : '-');
const toCents = (value) => Math.round((Number(value) || 0) * 100);
const errorText = (error, fallback) => error.response?.data?.detail || fallback;

async function saveBlob(request, filename) {
  const response = await request();
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// Texto da coluna "Histórico" de um lançamento
function describe(entry) {
  if (entry.entry_type === 'USO') return `Baixa na fatura #${entry.invoice_number}`;
  if (entry.entry_type === 'ESTORNO') {
    const of = `Estorno do lançamento #${entry.reverses_entry_number}${entry.invoice_number ? ` (fatura #${entry.invoice_number})` : ''}`;
    return entry.reason ? `${of} - ${entry.reason}` : of;
  }
  return [METHODS[entry.payment_method], entry.reference].filter(Boolean).join(' · ') || TYPES[entry.entry_type].label;
}

const emptyCredit = (type = 'CREDITO', client = null) => ({
  entry_type: type,
  client_id: client?.client_id || '',
  client_name: client?.client_name || '',
  amount: '',
  entry_date: todayISO(),
  payment_method: 'PIX',
  reference: '',
  notes: '',
});

export default function ClientCreditsPage() {
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountSearch, setAccountSearch] = useState('');
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [clients, setClients] = useState([]);

  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [typeFilter, setTypeFilter] = useState('');
  const [period, setPeriod] = useState(['', '']);
  const [entrySearch, setEntrySearch] = useState('');
  const debouncedEntrySearch = useDebouncedValue(entrySearch.trim());
  const [selectedEntryId, setSelectedEntryId] = useState('');

  const [creditForm, setCreditForm] = useState(null);
  const [applyState, setApplyState] = useState(null);
  const [reverseState, setReverseState] = useState(null);
  const [statement, setStatement] = useState(null);
  const [saving, setSaving] = useState(false);

  const selectedAccount = accounts.find((a) => a.client_id === selectedClientId) || null;
  const selectedEntry = entries.find((e) => e.id === selectedEntryId) || null;

  const loadSummary = () => api.getClientCreditSummary().then((r) => setSummary(r.data)).catch(() => {});
  const loadAccounts = () => {
    setAccountsLoading(true);
    return api.getClientCreditAccounts({ only_with_balance: onlyWithBalance || undefined })
      .then((r) => setAccounts(r.data))
      .catch((error) => toast.error(errorText(error, 'Erro ao carregar os saldos')))
      .finally(() => setAccountsLoading(false));
  };
  const loadEntries = () => {
    setEntriesLoading(true);
    const params = { page: pagination.page, per_page: PAGE_SIZE };
    if (selectedClientId) params.client_id = selectedClientId;
    if (typeFilter) params.entry_type = typeFilter;
    if (period[0]) params.date_from = period[0];
    if (period[1]) params.date_to = period[1];
    if (debouncedEntrySearch) params.search = debouncedEntrySearch;
    return api.getClientCreditEntries(params)
      .then((r) => {
        setEntries(r.data.items);
        setPagination((prev) => ({ ...prev, pages: r.data.pages, total: r.data.total }));
      })
      .catch((error) => toast.error(errorText(error, 'Erro ao carregar os lançamentos')))
      .finally(() => setEntriesLoading(false));
  };
  const reloadAll = () => Promise.all([loadSummary(), loadAccounts(), loadEntries()]);

  useEffect(() => {
    loadSummary();
    api.getClients().then((r) => setClients(r.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAccounts(); }, [onlyWithBalance]);
  useEffect(() => {
    loadEntries();
    setSelectedEntryId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, selectedClientId, typeFilter, period, debouncedEntrySearch]);

  const resetPage = () => setPagination((prev) => ({ ...prev, page: 1 }));
  const filteredAccounts = useMemo(() => {
    const term = accountSearch.trim().toLowerCase();
    if (!term) return accounts;
    return accounts.filter((a) => (a.client_name || '').toLowerCase().includes(term) || (a.client_cnpj || '').includes(term));
  }, [accounts, accountSearch]);

  const selectClient = (clientId) => {
    setSelectedClientId((prev) => (prev === clientId ? '' : clientId));
    resetPage();
  };

  // ---------- Crédito / Devolução
  const saveCredit = async () => {
    if (!creditForm.client_id) return toast.error('Escolha o cliente da lista');
    if (toCents(creditForm.amount) <= 0) return toast.error('Informe o valor');
    setSaving(true);
    try {
      await api.createClientCreditEntry({
        client_id: creditForm.client_id, entry_type: creditForm.entry_type, amount: Number(creditForm.amount),
        entry_date: creditForm.entry_date, payment_method: creditForm.payment_method || null,
        reference: creditForm.reference, notes: creditForm.notes,
      });
      toast.success(creditForm.entry_type === 'CREDITO' ? 'Crédito lançado' : 'Devolução lançada');
      setCreditForm(null);
      reloadAll();
    } catch (error) {
      toast.error(errorText(error, 'Erro ao salvar'));
    } finally {
      setSaving(false);
    }
  };

  // ---------- Baixa em faturas
  const openApply = async (account) => {
    try {
      const r = await api.getClientCreditOpenInvoices(account.client_id);
      setApplyState({ ...r.data, amounts: {}, entry_date: todayISO(), notes: '' });
    } catch (error) {
      toast.error(errorText(error, 'Erro ao carregar as faturas'));
    }
  };
  const applyTotalCents = applyState ? Object.values(applyState.amounts).reduce((acc, v) => acc + toCents(v), 0) : 0;
  const setAmount = (invoiceId, value) => setApplyState((prev) => ({ ...prev, amounts: { ...prev.amounts, [invoiceId]: value } }));
  // Usa o saldo nas faturas mais antigas primeiro, até acabar
  const distribute = () => {
    let left = toCents(applyState.balance);
    const amounts = {};
    applyState.invoices.forEach((inv) => {
      const part = Math.min(left, toCents(inv.open_value));
      if (part > 0) amounts[inv.invoice_id] = (part / 100).toFixed(2);
      left -= part;
    });
    setApplyState((prev) => ({ ...prev, amounts }));
  };
  const saveApply = async () => {
    const allocations = Object.entries(applyState.amounts)
      .filter(([, v]) => toCents(v) > 0)
      .map(([invoice_id, v]) => ({ invoice_id, amount: Number(v) }));
    if (!allocations.length) return toast.error('Informe quanto usar em pelo menos uma fatura');
    if (applyTotalCents > toCents(applyState.balance)) return toast.error('A baixa passa do saldo do cliente');
    setSaving(true);
    try {
      await api.applyClientCredit({ client_id: applyState.client.id, entry_date: applyState.entry_date, notes: applyState.notes, allocations });
      toast.success('Baixa registrada nas faturas');
      setApplyState(null);
      reloadAll();
    } catch (error) {
      toast.error(errorText(error, 'Erro ao dar baixa'));
    } finally {
      setSaving(false);
    }
  };

  // ---------- Estorno
  const saveReverse = async () => {
    if (!reverseState.reason.trim()) return toast.error('Informe o motivo do estorno');
    setSaving(true);
    try {
      await api.reverseClientCreditEntry(reverseState.entry.id, reverseState.reason.trim());
      toast.success('Lançamento estornado');
      setReverseState(null);
      reloadAll();
    } catch (error) {
      toast.error(errorText(error, 'Erro ao estornar'));
    } finally {
      setSaving(false);
    }
  };

  // ---------- Extrato
  const loadStatement = async (clientId, [from, to]) => {
    const params = {};
    if (from) params.date_from = from;
    if (to) params.date_to = to;
    try {
      const r = await api.getClientCreditStatement(clientId, params);
      setStatement({ clientId, period: [from, to], data: r.data });
    } catch (error) {
      toast.error(errorText(error, 'Erro ao carregar o extrato'));
    }
  };
  const statementParams = () => {
    const p = {};
    if (statement.period[0]) p.date_from = statement.period[0];
    if (statement.period[1]) p.date_to = statement.period[1];
    return p;
  };

  const hasEntryFilters = !!(typeFilter || period[0] || period[1] || entrySearch || selectedClientId);

  return (
    <Layout>
      <div className="space-y-4" data-testid="client-credits-page">
        <PageHeader
          icon={Coins}
          title="Crédito de Cliente"
          subtitle="Adiantamentos e valores a favor do cliente, abatidos nas faturas conforme forem sendo usados"
        />

        <StatGrid>
          <StatCard label="Saldo em crédito" value={formatMoney(summary?.balance_total)} icon={Wallet} tone="emerald" hint="a usar em faturas ou devolver" testId="credit-balance-total" />
          <StatCard label="Clientes com saldo" value={summary?.clients_with_balance ?? '-'} icon={Users} tone="blue" />
          <StatCard label="Recebido no mês" value={formatMoney(summary?.received_month)} icon={ArrowDownCircle} tone="primary" hint="créditos lançados" />
          <StatCard label="Usado no mês" value={formatMoney(summary?.used_month)} icon={ArrowUpCircle} tone="violet" hint="baixado em faturas" />
        </StatGrid>

        {/* Saldos - selecione um cliente para agir sobre ele e filtrar os lançamentos */}
        <DataCard
          title="Saldos por cliente"
          count={filteredAccounts.length}
          meta={(
            <div className="flex items-center gap-3 ml-2">
              <div className="w-56"><SearchInput value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} placeholder="Cliente ou CNPJ" data-testid="credit-account-search" /></div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer whitespace-nowrap">
                <Checkbox checked={onlyWithBalance} onCheckedChange={(v) => setOnlyWithBalance(!!v)} /> Só com saldo
              </label>
            </div>
          )}
          toolbar={(
            <Toolbar
              selectedCount={selectedAccount ? 1 : 0}
              primary={<ToolbarPrimary icon={Plus} label="Lançar crédito" onClick={() => setCreditForm(emptyCredit('CREDITO', selectedAccount))} testId="new-credit-btn" />}
            >
              <ToolbarButton icon={Receipt} label="Usar em faturas" tone="primary" onClick={() => openApply(selectedAccount)}
                disabled={!selectedAccount || selectedAccount.balance <= 0} testId="apply-credit-btn" />
              <ToolbarButton icon={Undo2} label="Devolver ao cliente" tone="violet" onClick={() => setCreditForm(emptyCredit('DEVOLUCAO', selectedAccount))}
                disabled={!selectedAccount || selectedAccount.balance <= 0} testId="refund-credit-btn" />
              <ToolbarButton icon={FileText} label="Extrato" onClick={() => loadStatement(selectedAccount.client_id, ['', ''])}
                disabled={!selectedAccount} testId="statement-btn" />
            </Toolbar>
          )}
        >
          {accountsLoading && accounts.length === 0 ? (
            <EmptyState loading />
          ) : filteredAccounts.length === 0 ? (
            <EmptyState icon={Coins} title="Nenhum cliente com crédito" hint="Use “Lançar crédito” para registrar um adiantamento do cliente" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0" />
                    <th>Cliente</th>
                    <th className="text-right">Saldo</th>
                    <th className="text-right">Faturas em aberto</th>
                    <th className="hidden md:table-cell text-right">Recebido</th>
                    <th className="hidden md:table-cell text-right">Usado</th>
                    <th className="hidden lg:table-cell text-right">Devolvido</th>
                    <th className="hidden sm:table-cell">Último lançamento</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((a) => (
                    <tr key={a.client_id} onClick={() => selectClient(a.client_id)} data-selected={a.client_id === selectedClientId}
                      className="cursor-pointer" data-testid={`credit-account-${a.client_id}`}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={a.client_id === selectedClientId} onCheckedChange={() => selectClient(a.client_id)} />
                      </td>
                      <td>
                        <div className="cell-strong max-w-[280px] truncate" title={a.client_name}>{a.client_name}</div>
                        {a.client_cnpj && <div className="text-xs text-muted-foreground">{a.client_cnpj}</div>}
                      </td>
                      <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${a.balance > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}`}>
                        {formatMoney(a.balance)}
                      </td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {a.open_invoices > 0 ? (
                          <span title={a.balance > 0 ? 'O cliente tem saldo e faturas em aberto: use o crédito nelas' : ''}>
                            {formatMoney(a.open_invoices)}
                            {a.balance > 0 && <StatusPill tone="amber" className="ml-1.5" dot={false}>pode usar</StatusPill>}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="hidden md:table-cell text-right tabular-nums">{formatMoney(a.total_credited)}</td>
                      <td className="hidden md:table-cell text-right tabular-nums">{formatMoney(a.total_used)}</td>
                      <td className="hidden lg:table-cell text-right tabular-nums">{formatMoney(a.total_refunded)}</td>
                      <td className="hidden sm:table-cell tabular-nums">{formatDay(a.last_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        <FilterCard
          title="Filtros dos lançamentos"
          hasFilters={hasEntryFilters}
          onClear={() => { setTypeFilter(''); setPeriod(['', '']); setEntrySearch(''); setSelectedClientId(''); resetPage(); }}
        >
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <FilterField label="Documento, observação ou nº da fatura" className="col-span-2">
              <SearchInput value={entrySearch} onChange={(e) => { setEntrySearch(e.target.value); resetPage(); }} data-testid="credit-entry-search" />
            </FilterField>
            <FilterField label="Tipo">
              <Select value={typeFilter || 'ALL'} onValueChange={(v) => { setTypeFilter(v === 'ALL' ? '' : v); resetPage(); }}>
                <SelectTrigger className="h-9 text-sm" data-testid="credit-type-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  {Object.entries(TYPES).map(([value, t]) => <SelectItem key={value} value={value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <PeriodFilterFields value={period} onChange={(value) => { setPeriod(value); resetPage(); }} testIdPrefix="credit" />
          </div>
          {selectedAccount && (
            <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
              Mostrando só os lançamentos de <span className="font-semibold text-slate-700 dark:text-slate-200">{selectedAccount.client_name}</span>
              <button type="button" className="inline-flex items-center text-primary hover:underline" onClick={() => selectClient(selectedAccount.client_id)}>
                <X className="w-3 h-3" /> todos os clientes
              </button>
            </p>
          )}
        </FilterCard>

        <DataCard
          title="Lançamentos"
          count={pagination.total.toLocaleString('pt-BR')}
          toolbar={(
            <Toolbar selectedCount={selectedEntry ? 1 : 0}>
              <ToolbarButton icon={RotateCcw} label="Estornar" tone="red" onClick={() => setReverseState({ entry: selectedEntry, reason: '' })}
                disabled={!selectedEntry?.reversible} testId="reverse-entry-btn" />
            </Toolbar>
          )}
          footer={(
            <TablePagination currentPage={pagination.page} totalPages={pagination.pages} totalItems={pagination.total} pageSize={PAGE_SIZE}
              onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))} />
          )}
        >
          {entriesLoading && entries.length === 0 ? (
            <EmptyState loading />
          ) : entries.length === 0 ? (
            <EmptyState icon={Coins} title="Nenhum lançamento encontrado" hint="Ajuste os filtros ou lance um crédito" />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0" />
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th>Tipo</th>
                    <th className="hidden md:table-cell">Histórico</th>
                    <th className="text-right">Valor</th>
                    <th className="hidden lg:table-cell">Lançado por</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const signed = e.signed_amount;
                    const reversed = e.reversed_amount > 0;
                    return (
                      <tr key={e.id} onClick={() => setSelectedEntryId((prev) => (prev === e.id ? '' : e.id))} data-selected={e.id === selectedEntryId}
                        className="cursor-pointer" data-testid={`credit-entry-${e.entry_number}`}>
                        <td className="pr-0" onClick={(ev) => ev.stopPropagation()}>
                          <Checkbox checked={e.id === selectedEntryId} onCheckedChange={() => setSelectedEntryId((prev) => (prev === e.id ? '' : e.id))} />
                        </td>
                        <td className="cell-strong tabular-nums">#{e.entry_number}</td>
                        <td className="tabular-nums whitespace-nowrap">{formatDay(e.entry_date)}</td>
                        <td><div className="max-w-[220px] truncate" title={e.client_name}>{e.client_name}</div></td>
                        <td className="whitespace-nowrap">
                          <StatusPill tone={TYPES[e.entry_type]?.tone}>{TYPES[e.entry_type]?.label}</StatusPill>
                          {reversed && (
                            <StatusPill tone="red" dot={false} className="ml-1"
                              title={`Estornado: ${formatMoney(e.reversed_amount)}`}>
                              {e.reversed_amount >= e.amount ? 'estornado' : 'estorno parcial'}
                            </StatusPill>
                          )}
                        </td>
                        <td className="hidden md:table-cell">
                          <div className="max-w-[340px] truncate" title={[describe(e), e.notes].filter(Boolean).join(' · ')}>
                            {describe(e)}{e.notes && e.entry_type !== 'ESTORNO' ? <span className="text-muted-foreground"> · {e.notes}</span> : null}
                          </div>
                        </td>
                        <td className={`text-right tabular-nums font-semibold whitespace-nowrap ${signed >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {signed >= 0 ? '+' : '-'} {formatMoney(Math.abs(signed))}
                        </td>
                        <td className="hidden lg:table-cell text-slate-500">{e.created_by_name}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      {/* Lançar crédito / devolução */}
      <Dialog open={!!creditForm} onOpenChange={(open) => !open && setCreditForm(null)}>
        <DialogContent className="max-w-lg">
          {creditForm && (
            <>
              <DialogHeader>
                <DialogTitle>{creditForm.entry_type === 'CREDITO' ? 'Lançar crédito do cliente' : 'Devolver crédito ao cliente'}</DialogTitle>
                <DialogDescription>
                  {creditForm.entry_type === 'CREDITO'
                    ? 'Valor recebido do cliente que ainda não virou fatura (adiantamento, pagamento a maior...).'
                    : 'Valor do saldo devolvido em dinheiro ao cliente. Sai do saldo e não pode passar dele.'}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cliente" required className="col-span-2">
                  <Autocomplete
                    value={creditForm.client_name}
                    onChange={(v) => setCreditForm((f) => ({ ...f, client_name: v, client_id: '' }))}
                    options={clients}
                    displayField="name"
                    valueField="id"
                    onSelect={(c) => setCreditForm((f) => ({ ...f, client_name: c.name, client_id: c.id }))}
                    testId="credit-client-input"
                  />
                </Field>
                <Field label="Valor (R$)" required>
                  <Input className="h-9" type="number" step="0.01" min="0" value={creditForm.amount}
                    onChange={(e) => setCreditForm((f) => ({ ...f, amount: e.target.value }))} data-testid="credit-amount-input" />
                </Field>
                <Field label="Data" required>
                  <Input className="h-9" type="date" max={todayISO()} value={creditForm.entry_date}
                    onChange={(e) => setCreditForm((f) => ({ ...f, entry_date: e.target.value }))} />
                </Field>
                <Field label="Forma">
                  <Select value={creditForm.payment_method || 'NONE'} onValueChange={(v) => setCreditForm((f) => ({ ...f, payment_method: v === 'NONE' ? '' : v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Não informar</SelectItem>
                      {Object.entries(METHODS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Documento / comprovante">
                  <Input className="h-9" value={creditForm.reference} placeholder="ID do PIX, nº do depósito..."
                    onChange={(e) => setCreditForm((f) => ({ ...f, reference: e.target.value }))} />
                </Field>
                <Field label="Observação" className="col-span-2">
                  <Textarea className="min-h-[60px] text-[13px]" value={creditForm.notes}
                    onChange={(e) => setCreditForm((f) => ({ ...f, notes: e.target.value }))} />
                </Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreditForm(null)}>Cancelar</Button>
                <Button onClick={saveCredit} disabled={saving} data-testid="save-credit-btn">{saving ? 'Salvando...' : 'Salvar'}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Baixa em faturas */}
      <Dialog open={!!applyState} onOpenChange={(open) => !open && setApplyState(null)}>
        <DialogContent className="max-w-3xl">
          {applyState && (
            <>
              <DialogHeader>
                <DialogTitle>Usar crédito em faturas</DialogTitle>
                <DialogDescription>
                  {applyState.client.name} · saldo disponível <span className="font-semibold text-emerald-700 dark:text-emerald-400">{formatMoney(applyState.balance)}</span>.
                  {' '}A fatura coberta por inteiro passa a Paga na data da baixa.
                </DialogDescription>
              </DialogHeader>
              {applyState.invoices.length === 0 ? (
                <EmptyState icon={Receipt} title="Nenhuma fatura em aberto deste cliente" />
              ) : (
                <div className="max-h-[360px] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Fatura</th>
                        <th>Emissão</th>
                        <th>Vencimento</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Em aberto</th>
                        <th className="text-right w-40">Usar (R$)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applyState.invoices.map((inv) => {
                        const over = toCents(applyState.amounts[inv.invoice_id]) > toCents(inv.open_value);
                        return (
                          <tr key={inv.invoice_id}>
                            <td className="cell-strong">#{inv.invoice_number}</td>
                            <td className="tabular-nums">{formatDay(inv.issue_date)}</td>
                            <td className="tabular-nums">{formatDay(inv.due_date)}</td>
                            <td className="text-right tabular-nums">
                              {formatMoney(inv.total_value)}
                              {inv.credit_applied > 0 && <div className="text-[11px] text-muted-foreground">crédito já usado {formatMoney(inv.credit_applied)}</div>}
                            </td>
                            <td className="text-right tabular-nums font-semibold">{formatMoney(inv.open_value)}</td>
                            <td className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Input className={`h-8 w-24 text-right ${over ? 'border-red-500' : ''}`} type="number" step="0.01" min="0"
                                  value={applyState.amounts[inv.invoice_id] || ''} onChange={(e) => setAmount(inv.invoice_id, e.target.value)}
                                  data-testid={`apply-amount-${inv.invoice_number}`} />
                                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" title="Usar o que falta desta fatura (até o saldo)"
                                  onClick={() => {
                                    const others = applyTotalCents - toCents(applyState.amounts[inv.invoice_id]);
                                    const part = Math.max(Math.min(toCents(inv.open_value), toCents(applyState.balance) - others), 0);
                                    setAmount(inv.invoice_id, part ? (part / 100).toFixed(2) : '');
                                  }}>
                                  máx.
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex items-end gap-3">
                  <Field label="Data da baixa">
                    <Input className="h-9 w-40" type="date" max={todayISO()} value={applyState.entry_date}
                      onChange={(e) => setApplyState((s) => ({ ...s, entry_date: e.target.value }))} />
                  </Field>
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={distribute} disabled={!applyState.invoices.length} data-testid="distribute-credit-btn">
                    Distribuir saldo (mais antigas primeiro)
                  </Button>
                </div>
                <div className="text-right text-sm">
                  <div>Total da baixa: <span className={`font-semibold tabular-nums ${applyTotalCents > toCents(applyState.balance) ? 'text-red-600' : ''}`}>{formatMoney(applyTotalCents / 100)}</span></div>
                  <div className="text-xs text-muted-foreground">Saldo depois: {formatMoney((toCents(applyState.balance) - applyTotalCents) / 100)}</div>
                </div>
              </div>
              <Field label="Observação">
                <Input className="h-9" value={applyState.notes} onChange={(e) => setApplyState((s) => ({ ...s, notes: e.target.value }))} />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => setApplyState(null)}>Cancelar</Button>
                <Button onClick={saveApply} disabled={saving || applyTotalCents <= 0} data-testid="save-apply-btn">{saving ? 'Salvando...' : 'Dar baixa'}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Estorno */}
      <Dialog open={!!reverseState} onOpenChange={(open) => !open && setReverseState(null)}>
        <DialogContent className="max-w-md">
          {reverseState && (
            <>
              <DialogHeader>
                <DialogTitle>Estornar lançamento #{reverseState.entry.entry_number}</DialogTitle>
                <DialogDescription>
                  {reverseState.entry.entry_type === 'USO'
                    ? `O valor volta ao saldo do cliente e a fatura #${reverseState.entry.invoice_number} volta a ter esse valor em aberto.`
                    : reverseState.entry.entry_type === 'CREDITO'
                      ? 'O crédito sai do saldo. Só é possível se ele ainda não foi usado em faturas.'
                      : 'O valor devolvido volta ao saldo do cliente.'}
                  {' '}O lançamento original continua no extrato, marcado como estornado.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm">Valor a estornar: <span className="font-semibold">{formatMoney(reverseState.entry.amount - reverseState.entry.reversed_amount)}</span></p>
              <Field label="Motivo" required>
                <Textarea className="min-h-[70px] text-[13px]" value={reverseState.reason} onChange={(e) => setReverseState((s) => ({ ...s, reason: e.target.value }))}
                  data-testid="reverse-reason-input" />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReverseState(null)}>Cancelar</Button>
                <Button variant="destructive" onClick={saveReverse} disabled={saving} data-testid="confirm-reverse-btn">{saving ? 'Estornando...' : 'Estornar'}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Extrato */}
      <Dialog open={!!statement} onOpenChange={(open) => !open && setStatement(null)}>
        <DialogContent className="max-w-4xl">
          {statement && (
            <>
              <DialogHeader>
                <DialogTitle>Extrato de crédito - {statement.data.client.name}</DialogTitle>
                <DialogDescription>Saldo atual: <span className="font-semibold">{formatMoney(statement.data.current_balance)}</span></DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="grid grid-cols-2 gap-3 w-full sm:w-auto">
                  <PeriodFilterFields value={statement.period} onChange={(value) => loadStatement(statement.clientId, value)} testIdPrefix="statement" />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => saveBlob(() => api.downloadClientCreditStatementExcel(statement.clientId, statementParams()), 'extrato_credito.xlsx').catch(() => toast.error('Erro ao gerar o arquivo'))}>
                    <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel
                  </Button>
                  <Button size="sm" onClick={() => saveBlob(() => api.downloadClientCreditStatementPdf(statement.clientId, statementParams()), 'extrato_credito.pdf').catch(() => toast.error('Erro ao gerar o arquivo'))}>
                    <Printer className="w-4 h-4 mr-1.5" /> PDF
                  </Button>
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
                <table className="data-table">
                  <thead>
                    <tr><th>Nº</th><th>Data</th><th>Histórico</th><th className="text-right">Entrada</th><th className="text-right">Saída</th><th className="text-right">Saldo</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td /><td /><td className="font-medium">Saldo anterior</td><td /><td />
                      <td className="text-right tabular-nums font-semibold">{formatMoney(statement.data.opening_balance)}</td>
                    </tr>
                    {statement.data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="tabular-nums">#{r.entry_number}</td>
                        <td className="tabular-nums whitespace-nowrap">{formatDay(r.entry_date)}</td>
                        <td>{describe(r)}{r.notes && r.entry_type !== 'ESTORNO' ? <span className="text-muted-foreground"> · {r.notes}</span> : null}</td>
                        <td className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.signed_amount > 0 ? formatMoney(r.amount) : ''}</td>
                        <td className="text-right tabular-nums text-red-600 dark:text-red-400">{r.signed_amount < 0 ? formatMoney(r.amount) : ''}</td>
                        <td className="text-right tabular-nums font-semibold">{formatMoney(r.balance)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td /><td /><td>Saldo final</td>
                      <td className="text-right tabular-nums">{formatMoney(statement.data.period_in)}</td>
                      <td className="text-right tabular-nums">{formatMoney(statement.data.period_out)}</td>
                      <td className="text-right tabular-nums">{formatMoney(statement.data.closing_balance)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
