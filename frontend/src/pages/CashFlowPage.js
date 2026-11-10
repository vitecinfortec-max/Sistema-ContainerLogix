import { Fragment, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, FilterCard, FilterField, PeriodFilterFields, DataCard, EmptyState, StatusPill } from '../components/DataPage';
import { BarsChart, CHART_COLORS, CHART_SERIES } from '../components/Charts';
import { Field } from '../components/FormKit';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useUrlState } from '../hooks/useUrlState';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { todayISO } from '../lib/dates';
import { downloadBlob } from '../lib/fiscal';
import { formatDay, formatMoney, parseMoney } from '../lib/payables';
import { toast } from 'sonner';
import {
  LineChart, Landmark, ArrowDownCircle, ArrowUpCircle, TrendingDown, Wallet, FileDown, FileSpreadsheet, AlertTriangle, ChevronDown, ChevronRight,
} from 'lucide-react';

const GROUPS = { day: 'Dia', week: 'Semana', month: 'Mês' };
const OUT_COLOR = CHART_SERIES[4]; // vermelho da paleta dos gráficos
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const money = (v) => (v === null || v === undefined ? '-' : formatMoney(v));

// Saldo informado uma vez numa data: dali o sistema soma e subtrai
function OpeningBalanceDialog({ open, onOpenChange, settings, onSaved }) {
  const [form, setForm] = useState({ opening_date: todayISO(), opening_balance: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      opening_date: settings?.opening_date || todayISO(),
      opening_balance: settings?.opening_balance !== null && settings?.opening_balance !== undefined ? String(settings.opening_balance).replace('.', ',') : '',
    });
  }, [open, settings]);

  const save = async () => {
    const balance = parseMoney(form.opening_balance);
    if (balance === null || Number.isNaN(balance) || !form.opening_date) {
      toast.error('Informe a data e o saldo');
      return;
    }
    setSaving(true);
    try {
      await api.updateCashFlowSettings({ opening_date: form.opening_date, opening_balance: balance });
      toast.success('Saldo inicial salvo');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao salvar o saldo'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Saldo inicial</DialogTitle>
          <DialogDescription>
            Quanto havia em caixa e bancos no começo de um dia. O saldo dos outros dias é esse valor mais as entradas menos as saídas lançadas no sistema.
          </DialogDescription>
        </DialogHeader>
        <div className="form-dense grid grid-cols-2 gap-3">
          <Field label="No começo do dia" required>
            <Input type="date" value={form.opening_date} max={todayISO()} onChange={(e) => setForm({ ...form, opening_date: e.target.value })} data-testid="opening-date" />
          </Field>
          <Field label="Saldo (R$)" required hint="Negativo: use o sinal de menos.">
            <Input inputMode="decimal" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} data-testid="opening-balance" />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={save} disabled={saving} data-testid="opening-save-btn">{saving ? 'Salvando...' : 'Salvar saldo'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UndatedList({ title, items, tone }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Nada.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((u) => (
            <li key={u.label} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span>{u.label} <span className="text-xs text-slate-400 dark:text-slate-500">({u.count})</span></span>
              <span className={`tabular-nums font-medium ${tone}`}>{formatMoney(u.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CashFlowPage() {
  const today = todayISO();
  const [period, setPeriod] = useUrlState('period', [addDays(today, -7), addDays(today, 30)]);
  const [group, setGroup] = useUrlState('group', 'day');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);

  const params = { date_from: period[0], date_to: period[1], group };
  const load = () => {
    if (!period[0] || !period[1]) return;
    setLoading(true);
    api.getCashFlow(params)
      .then((r) => setData(r.data))
      .catch((error) => { setData(null); toast.error(apiErrorMessage(error, 'Erro ao carregar o fluxo de caixa')); })
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); setExpanded(null); }, [period[0], period[1], group]);

  const download = async (kind) => {
    setBusy(kind);
    try {
      const r = kind === 'pdf' ? await api.getCashFlowPdf(params) : await api.getCashFlowExcel(params);
      downloadBlob(r.data, `fluxo_caixa_${period[0]}_${period[1]}.${kind === 'pdf' ? 'pdf' : 'xlsx'}`);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao gerar o arquivo'));
    } finally {
      setBusy('');
    }
  };

  const s = data?.summary;
  const chartData = (data?.rows || []).map((r) => ({
    label: group === 'day' ? r.label.slice(0, 5) : r.label,
    entradas: r.realized_in + r.forecast_in,
    saidas: r.realized_out + r.forecast_out,
  }));
  // Por dia, os dias sem nenhum lançamento ficam de fora (o saldo deles é o do dia anterior); hoje sempre aparece
  const visibleRows = (data?.rows || []).filter((r) => group !== 'day' || !onlyActive || r.start === data.today
    || r.realized_in || r.realized_out || r.forecast_in || r.forecast_out);
  const eventsOf = (row) => (data?.events || []).filter((e) => e.date >= row.start && e.date <= row.end);

  return (
    <Layout>
      <div className="space-y-4" data-testid="cash-flow-page">
        <PageHeader
          icon={LineChart}
          title="Fluxo de Caixa"
          subtitle="Saldo dia a dia: o que já entrou e saiu e o que vence (faturas, contas a pagar e cheques)"
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setBalanceOpen(true)} data-testid="opening-balance-btn">
                <Landmark className="w-4 h-4 mr-1" /> Saldo inicial
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => download('pdf')} disabled={!!busy || !data} data-testid="cash-flow-pdf">
                <FileDown className="w-4 h-4 mr-1" /> PDF
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => download('excel')} disabled={!!busy || !data} data-testid="cash-flow-excel">
                <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
              </Button>
            </div>
          )}
        />

        {s && !s.has_balance && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="no-opening-balance">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Informe o <button type="button" className="underline font-medium" onClick={() => setBalanceOpen(true)}>saldo inicial</button> para
              ver o saldo de cada dia. Até lá aparecem só as entradas e saídas.
            </span>
          </div>
        )}

        <StatGrid>
          <StatCard label="Saldo hoje" value={money(s?.balance_today)} icon={Wallet} tone="blue" hint="só o que já entrou e saiu" />
          <StatCard label="Entradas no período" value={money(s && s.realized_in + s.forecast_in)} icon={ArrowDownCircle} tone="emerald"
            hint={s ? `previstas ${formatMoney(s.forecast_in)}${s.overdue_in ? ` · ${formatMoney(s.overdue_in)} atrasado` : ''}` : ''} />
          <StatCard label="Saídas no período" value={money(s && s.realized_out + s.forecast_out)} icon={ArrowUpCircle} tone="red"
            hint={s ? `previstas ${formatMoney(s.forecast_out)}${s.overdue_out ? ` · ${formatMoney(s.overdue_out)} atrasado` : ''}` : ''} />
          <StatCard label="Menor saldo previsto" value={money(s?.lowest_balance)} icon={TrendingDown}
            tone={s?.lowest_balance < 0 ? 'red' : 'amber'} hint={s?.lowest_balance_date ? `em ${formatDay(s.lowest_balance_date)} · fim do período ${money(s.closing_balance)}` : ''} />
        </StatGrid>

        <FilterCard hasFilters={false} onClear={() => {}}>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <PeriodFilterFields value={period} onChange={setPeriod} testIdPrefix="cash-flow" />
            <FilterField label="Agrupar por">
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger className="h-9 text-sm" data-testid="cash-flow-group"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(GROUPS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </FilterField>
            {group === 'day' && (
              <label className="flex items-end gap-2 pb-2 text-sm cursor-pointer sm:col-span-2">
                <Checkbox checked={onlyActive} onCheckedChange={(v) => setOnlyActive(!!v)} data-testid="cash-flow-only-active" />
                Só dias com lançamentos
              </label>
            )}
          </div>
        </FilterCard>

        {loading && !data ? (
          <DataCard title="Fluxo"><EmptyState loading /></DataCard>
        ) : !data ? (
          <DataCard title="Fluxo"><EmptyState icon={LineChart} title="Não foi possível carregar o fluxo" hint="Confira o período" /></DataCard>
        ) : (
          <>
            <DataCard title="Entradas e saídas" meta={<span className="text-xs text-slate-500 dark:text-slate-400">realizado + previsto</span>}>
              <div className="p-3">
                <BarsChart animated={false} valueFormat={formatMoney} data={chartData} className="h-60"
                  series={[{ key: 'entradas', name: 'Entradas', color: CHART_COLORS.emerald }, { key: 'saidas', name: 'Saídas', color: OUT_COLOR }]} />
              </div>
            </DataCard>

            <DataCard title={`Por ${GROUPS[group].toLowerCase()}`} count={visibleRows.length}
              meta={<span className="text-xs text-slate-500 dark:text-slate-400">Saldo no início {money(s.opening_balance)} · clique numa linha para ver os lançamentos</span>}>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{GROUPS[group]}</th>
                      <th className="!text-right">Entradas</th>
                      <th className="!text-right">Saídas</th>
                      <th className="hidden md:table-cell !text-right">Resultado</th>
                      <th className="!text-right">Saldo no fim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => {
                      const open = expanded === r.start;
                      const events = open ? eventsOf(r) : [];
                      const isToday = r.start <= data.today && data.today <= r.end;
                      const ins = r.realized_in + r.forecast_in;
                      const outs = r.realized_out + r.forecast_out;
                      return (
                        <Fragment key={r.start}>
                          <tr onClick={() => setExpanded(open ? null : r.start)} className={`cursor-pointer ${isToday ? 'bg-primary/5' : ''}`} data-testid={`cash-row-${r.start}`}>
                            <td className="whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                                <span className="tabular-nums">{r.label}</span>
                                {isToday && <StatusPill tone="blue">hoje</StatusPill>}
                                {r.projected && !isToday && <span className="text-xs text-slate-400 dark:text-slate-500">previsto</span>}
                              </span>
                            </td>
                            <td className="text-right tabular-nums whitespace-nowrap text-emerald-700 dark:text-emerald-400">{ins ? formatMoney(ins) : '-'}</td>
                            <td className="text-right tabular-nums whitespace-nowrap text-red-600 dark:text-red-400">{outs ? formatMoney(outs) : '-'}</td>
                            <td className="hidden md:table-cell text-right tabular-nums whitespace-nowrap">{r.net ? formatMoney(r.net) : '-'}</td>
                            <td className={`text-right tabular-nums whitespace-nowrap font-medium ${r.balance_end < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{money(r.balance_end)}</td>
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={5} className="bg-slate-50 dark:bg-slate-800/50">
                                {events.length === 0 ? (
                                  <p className="text-sm text-slate-500 dark:text-slate-400 py-1">Nenhum lançamento.</p>
                                ) : (
                                  <ul className="divide-y divide-slate-200/70 dark:divide-slate-700">
                                    {events.map((e, i) => (
                                      <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm">
                                        <span className="w-20 tabular-nums text-slate-500 dark:text-slate-400">{formatDay(e.date)}</span>
                                        <StatusPill tone={e.kind === 'REALIZADO' ? 'slate' : e.overdue ? 'red' : 'amber'}>
                                          {e.kind === 'REALIZADO' ? 'Realizado' : e.overdue ? `Atrasado (venceu ${formatDay(e.due_date)})` : 'Previsto'}
                                        </StatusPill>
                                        <span className="text-slate-500 dark:text-slate-400">{e.source}</span>
                                        <span className="flex-1 min-w-[160px] truncate">{e.description}</span>
                                        <span className={`tabular-nums font-medium ${e.direction === 'ENTRADA' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                          {e.direction === 'ENTRADA' ? '+' : '-'} {formatMoney(e.amount)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </DataCard>

            <DataCard title="Sem vencimento" meta={<span className="text-xs text-slate-500 dark:text-slate-400">não entram no saldo previsto: lance o vencimento para entrarem</span>}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4">
                <UndatedList title="A receber" items={data.undated.receivable} tone="text-emerald-700 dark:text-emerald-400" />
                <UndatedList title="A pagar" items={data.undated.payable} tone="text-red-600 dark:text-red-400" />
              </div>
            </DataCard>
          </>
        )}
      </div>
      <OpeningBalanceDialog open={balanceOpen} onOpenChange={setBalanceOpen} settings={data?.settings} onSaved={load} />
    </Layout>
  );
}
