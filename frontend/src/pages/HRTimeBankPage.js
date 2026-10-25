import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  EmptyState, TablePagination, usePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useConfirm } from '../hooks/useConfirm';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { api } from '../lib/api';
import { todayISO } from '../lib/dates';
import { ContractPicker, errorDetail, fmtDate, fmtMinutes, parseHours, useContracts } from '../components/HRKit';
import { toast } from 'sonner';
import { Hourglass, Plus, Trash2, Save, TrendingUp, TrendingDown, Users } from 'lucide-react';

const EMPTY = { contract_id: '', date: todayISO(), kind: 'CREDITO', hours: '', description: '' };

export default function HRTimeBankPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const { contracts } = useContracts();
  const [entries, setEntries] = useState([]);
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const listKey = `${debouncedSearch}|${dateFrom}|${dateTo}`;
  const { pageItems, paginationProps } = usePagination(entries, { resetKey: listKey });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setSelectedIds(new Set()); load(); }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const [e, b] = await Promise.all([api.getTimeBank(params), api.getTimeBankBalances()]);
      setEntries(e.data || []);
      setBalances(b.data || []);
    } catch (e) {
      toast.error('Erro ao carregar o banco de horas');
    } finally {
      setLoading(false);
    }
  };
  const toggle = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const single = selectedIds.size === 1 ? entries.find((x) => selectedIds.has(x.id)) : null;
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.contract_id) { toast.error('Selecione o funcionário na lista'); return; }
    const minutes = parseHours(form.hours);
    if (!minutes) { toast.error('Informe as horas no formato H:MM (ex.: 2:30)'); return; }
    setSaving(true);
    try {
      await api.createTimeBank({ contract_id: form.contract_id, date: form.date, minutes: form.kind === 'DEBITO' ? -minutes : minutes, description: form.description || null });
      toast.success('Lançamento registrado');
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar'));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!single || !(await confirm(`Excluir o lançamento de ${fmtMinutes(single.minutes)} de ${single.person_name}?`))) return;
    try { await api.deleteTimeBank(single.id); toast.success('Lançamento excluído'); setSelectedIds(new Set()); load(); } catch (e) { toast.error(errorDetail(e, 'Erro ao excluir')); }
  };

  const filteredBalances = balances.filter((b) => !debouncedSearch || (b.person_name || '').toLowerCase().includes(debouncedSearch.toLowerCase()));
  const positive = filteredBalances.filter((b) => b.balance > 0).reduce((a, b) => a + b.balance, 0);
  const negative = filteredBalances.filter((b) => b.balance < 0).reduce((a, b) => a + b.balance, 0);
  const hasFilters = !!(search || dateFrom || dateTo);

  return (
    <Layout>
      <div className="space-y-4" data-testid="hr-time-bank-page">
        <PageHeader icon={Hourglass} title="Banco de Horas" subtitle="Horas a compensar (crédito) e horas devidas (débito) de cada funcionário" />

        <StatGrid>
          <StatCard label="Saldo a favor dos funcionários" value={fmtMinutes(positive)} icon={TrendingUp} tone="amber" hint="horas a compensar ou pagar" />
          <StatCard label="Saldo devedor" value={fmtMinutes(negative)} icon={TrendingDown} tone="blue" hint="horas devidas à empresa" />
          <StatCard label="Funcionários com saldo" value={filteredBalances.filter((b) => b.balance !== 0).length} icon={Users} tone="slate" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setDateFrom(''); setDateTo(''); }}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Funcionário ou descrição" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="hr-time-bank-search" />
            </FilterField>
            <FilterField label="Data - de">
              <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </FilterField>
            <FilterField label="até">
              <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </FilterField>
          </div>
        </FilterCard>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <DataCard title="Saldos" count={filteredBalances.length} className="xl:col-span-1">
            {filteredBalances.length > 0 ? (
              <table className="data-table">
                <thead><tr><th>Funcionário</th><th className="!text-right">Créditos</th><th className="!text-right">Débitos</th><th className="!text-right">Saldo</th></tr></thead>
                <tbody>
                  {filteredBalances.map((b) => (
                    <tr key={b.contract_id}>
                      <td className="cell-strong">{b.person_name}</td>
                      <td className="text-right tabular-nums">{fmtMinutes(b.credit)}</td>
                      <td className="text-right tabular-nums">{fmtMinutes(-b.debit)}</td>
                      <td className={`text-right tabular-nums cell-strong ${b.balance < 0 ? 'text-blue-600' : b.balance > 0 ? 'text-amber-600' : ''}`}>{fmtMinutes(b.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState icon={Hourglass} loading={loading} title="Nenhum saldo" />}
          </DataCard>

          <DataCard
            className="xl:col-span-2"
            title="Lançamentos"
            count={loading ? '...' : entries.length}
            footer={<TablePagination {...paginationProps} />}
            toolbar={(
              <Toolbar selectedCount={selectedIds.size} primary={<ToolbarPrimary icon={Plus} label="Lançar horas" onClick={() => { setForm({ ...EMPTY, date: todayISO() }); setDialogOpen(true); }} testId="hr-time-bank-new-btn" />}>
                <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={remove} disabled={!single} />
              </Toolbar>
            )}
          >
            {entries.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th className="w-10 pr-0" /><th>Data</th><th>Funcionário</th><th className="!text-right">Horas</th><th>Descrição</th><th>Lançado por</th></tr></thead>
                  <tbody>
                    {pageItems.map((e) => (
                      <tr key={e.id} onClick={() => toggle(e.id)} data-selected={selectedIds.has(e.id)} className="cursor-pointer">
                        <td className="pr-0" onClick={(ev) => ev.stopPropagation()}><Checkbox checked={selectedIds.has(e.id)} onCheckedChange={() => toggle(e.id)} /></td>
                        <td className="tabular-nums">{fmtDate(e.date)}</td>
                        <td className="cell-strong">{e.person_name}</td>
                        <td className={`text-right tabular-nums cell-strong ${e.minutes < 0 ? 'text-blue-600' : 'text-amber-600'}`}>{e.minutes > 0 ? '+' : ''}{fmtMinutes(e.minutes)}</td>
                        <td><div className="max-w-[260px] truncate">{e.description || '-'}</div></td>
                        <td className="text-slate-500">{e.created_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={Hourglass} loading={loading} title={hasFilters ? 'Nenhum lançamento encontrado' : 'Nenhum lançamento'} />}
          </DataCard>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(v) => !saving && setDialogOpen(v)}>
        <DialogContent className="max-w-md" data-testid="hr-time-bank-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Lançar Horas</DialogTitle>
            <DialogDescription>Crédito: horas trabalhadas a mais. Débito: horas compensadas ou não trabalhadas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1.5 block">Funcionário *</Label>
              <ContractPicker contracts={contracts} value={form.contract_id} onChange={(id) => setField('contract_id', id)} testId="hr-time-bank-contract" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="mb-1.5 block">Data *</Label>
                <Input type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="mb-1.5 block">Tipo *</Label>
                <Select value={form.kind} onValueChange={(v) => setField('kind', v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CREDITO">Crédito</SelectItem>
                    <SelectItem value="DEBITO">Débito</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Horas (H:MM) *</Label>
                <Input value={form.hours} onChange={(e) => setField('hours', e.target.value)} className="h-9 text-sm" data-testid="hr-time-bank-hours" />
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block">Descrição</Label>
              <Input value={form.description} onChange={(e) => setField('description', e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving} data-testid="hr-time-bank-save-btn"><Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Lançar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
