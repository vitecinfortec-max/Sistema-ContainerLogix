import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, DataCard, EmptyState, StatusPill, PlateTag, TablePagination, usePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { todayISO } from '../lib/dates';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { FileText, FileSpreadsheet, Timer, Anchor, CheckCircle2, TrendingUp, TrendingDown, AlertTriangle, BadgeDollarSign } from 'lucide-react';

const TURNO_OPTIONS = [
  ['DIA', 'Dia'],
  ['NOITE', 'Noite'],
];

const STATUS = {
  NO_HORARIO: { label: 'No horário', tone: 'slate' },
  A_MAIS: { label: 'A mais', tone: 'emerald' },
  A_MENOS: { label: 'A menos', tone: 'red' },
  SEM_HORARIO: { label: 'Sem horário', tone: 'amber' },
};

/** Minutos -> '+01:15' / '-00:30' / '00:00'. */
export const fmtMinutes = (minutes) => {
  if (minutes === null || minutes === undefined) return '-';
  const sign = minutes === 0 ? '' : minutes > 0 ? '+' : '-';
  const m = Math.abs(minutes);
  return `${sign}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const diffClass = (minutes) => {
  if (minutes === null || minutes === undefined || minutes === 0) return 'text-slate-500 dark:text-slate-400';
  return minutes > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
};

function Diff({ minutes, strong = false }) {
  return <span className={`tabular-nums ${strong ? 'font-semibold' : ''} ${diffClass(minutes)}`}>{fmtMinutes(minutes)}</span>;
}

function Balance({ item }) {
  const status = STATUS[item.shift_status] || STATUS.SEM_HORARIO;
  if (item.balance === null || item.balance === undefined) return <StatusPill tone={status.tone}>{status.label}</StatusPill>;
  return <span title={status.label}><Diff minutes={item.balance} strong /></span>;
}

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Desconto possível do turno (só quando o saldo é negativo). */
function Discount({ value, className = '' }) {
  if (!value) return null;
  return <div className={`text-[11px] font-medium text-red-600 dark:text-red-400 tabular-nums ${className}`}>- {fmtMoney(value)}</div>;
}

const fmtDay = (iso) => (iso ? format(new Date(`${iso}T00:00:00`), 'dd/MM/yyyy') : '-');

const firstDayOfMonth = () => `${todayISO().slice(0, 8)}01`;

const EMPTY_SUMMARY = {
  count: 0, on_time_count: 0, extra_count: 0, extra_minutes: 0, less_count: 0, less_minutes: 0, missing_count: 0,
  with_observations_count: 0, balance_minutes: 0, schedule: null, shift_value: 0, discount_total: 0,
};

export default function PortServiceShiftsPage() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth);
  const [dateTo, setDateTo] = useState(todayISO);
  const [clientName, setClientName] = useState('');
  const [clientId, setClientId] = useState('');
  const [turno, setTurno] = useState('all');
  const [clients, setClients] = useState([]);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(null);

  const periodError = !dateFrom || !dateTo
    ? 'Informe a data inicial e a final'
    : dateFrom > dateTo ? 'A data inicial é posterior à data final' : null;

  const { pageItems, paginationProps } = usePagination(items, { pageSize: 15, resetKey: `${dateFrom}|${dateTo}|${clientId}|${turno}` });

  useEffect(() => {
    api.getClients({ per_page: 1000 }).then((r) => setClients(r.data || [])).catch(() => {});
  }, []);

  const buildParams = () => {
    const params = { date_from: dateFrom, date_to: dateTo };
    if (clientId) params.client_id = clientId;
    if (turno !== 'all') params.turno = turno;
    return params;
  };

  useEffect(() => {
    if (periodError) {
      setItems([]);
      setSummary(EMPTY_SUMMARY);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api.getPortServiceShifts(buildParams())
      .then((r) => {
        if (cancelled) return;
        setItems(r.data.items || []);
        setSummary(r.data.summary || EMPTY_SUMMARY);
      })
      .catch((e) => { if (!cancelled) toast.error(e.response?.data?.detail || 'Erro ao carregar a conferência de turnos'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, clientId, turno, periodError]);

  const download = async (kind) => {
    if (periodError) {
      toast.error(periodError);
      return;
    }
    setDownloading(kind);
    try {
      const response = kind === 'pdf'
        ? await api.downloadPortServiceShiftsPDF(buildParams())
        : await api.downloadPortServiceShiftsExcel(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `conferencia_turnos_${dateFrom}_a_${dateTo}.${kind === 'pdf' ? 'pdf' : 'xlsx'}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
      toast.success(`Conferência de Turnos ${kind === 'pdf' ? 'PDF' : 'Excel'} gerada!`);
    } catch (e) {
      toast.error(`Erro ao gerar a conferência de turnos em ${kind === 'pdf' ? 'PDF' : 'Excel'}`);
    } finally {
      setDownloading(null);
    }
  };

  const clearFilters = () => {
    setDateFrom(firstDayOfMonth());
    setDateTo(todayISO());
    setClientName('');
    setClientId('');
    setTurno('all');
  };

  const hasFilters = !!clientId || turno !== 'all' || dateFrom !== firstDayOfMonth() || dateTo !== todayISO();
  const sched = summary.schedule;

  return (
    <Layout>
      <div className="space-y-4" data-testid="port-service-shifts-page">
        <PageHeader
          icon={Timer}
          title="Conferência de Turnos"
          subtitle="Horários de entrada e saída dos Serviços Portuários comparados com o horário de cada turno"
        />

        <FilterCard
          hasFilters={hasFilters}
          onClear={clearFilters}
          clearLinkTestId="shifts-clear-filters"
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => download('pdf')} disabled={!!downloading || !!periodError} className="h-8 text-xs gap-1.5" data-testid="shifts-download-pdf">
                <FileText className="w-4 h-4 text-red-600" /> {downloading === 'pdf' ? 'Gerando...' : 'Baixar PDF'}
              </Button>
              <Button type="button" size="sm" onClick={() => download('excel')} disabled={!!downloading || !!periodError} className="h-8 text-xs gap-1.5" data-testid="shifts-download-excel">
                <FileSpreadsheet className="w-4 h-4" /> {downloading === 'excel' ? 'Gerando...' : 'Baixar Excel'}
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Data início *">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-sm" data-testid="shifts-date-from" />
            </FilterField>
            <FilterField label="Data fim *">
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-sm" data-testid="shifts-date-to" />
            </FilterField>
            <FilterField label="Cliente">
              <Autocomplete
                value={clientName}
                onChange={(val) => { setClientName(val); setClientId(''); }}
                onSelect={(c) => { setClientName(c.name); setClientId(c.id); }}
                options={clients}
                displayField="name"
                className="h-9 text-sm"
              />
            </FilterField>
            <FilterField label="Turno">
              <Select value={turno} onValueChange={setTurno}>
                <SelectTrigger className="h-9 text-sm" data-testid="shifts-filter-turno">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[13px]">Todos</SelectItem>
                  {TURNO_OPTIONS.map(([v, l]) => (
                    <SelectItem key={v} value={v} className="text-[13px]">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
          {sched && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400" data-testid="shifts-schedule">
              Horário previsto — <span className="font-semibold text-slate-700 dark:text-slate-200">Dia: {sched.DIA.entry} às {sched.DIA.exit}</span>
              {' • '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">Noite: {sched.NOITE.entry} às {sched.NOITE.exit}</span> (dia seguinte)
              {summary.shift_value > 0 && (
                <>
                  {' • '}
                  Valor do turno: <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtMoney(summary.shift_value)}</span>
                  {' '}(desconto proporcional aos minutos a menos)
                </>
              )}
            </p>
          )}
        </FilterCard>

        <StatGrid className="lg:grid-cols-3 2xl:grid-cols-6">
          <StatCard icon={Anchor} label="Serviços" value={summary.count} tone="blue" hint={`${summary.with_observations_count} com observação`} testId="shifts-kpi-count" />
          <StatCard icon={CheckCircle2} label="No horário" value={summary.on_time_count} tone="primary" testId="shifts-kpi-on-time" />
          <StatCard icon={TrendingUp} label="A mais" value={summary.extra_count} tone="emerald" hint={`${fmtMinutes(summary.extra_minutes)} no total`} testId="shifts-kpi-extra" />
          <StatCard icon={TrendingDown} label="A menos" value={summary.less_count} tone="red" hint={`${fmtMinutes(summary.less_minutes)} no total`} testId="shifts-kpi-less" />
          <StatCard icon={AlertTriangle} label="Sem horário" value={summary.missing_count} tone="amber" hint="entrada ou saída não lançada" testId="shifts-kpi-missing" />
          <StatCard icon={BadgeDollarSign} label="Desconto possível" value={fmtMoney(summary.discount_total)} tone="red" hint={`sobre ${fmtMoney(summary.shift_value)} por turno`} testId="shifts-kpi-discount" />
        </StatGrid>

        <DataCard
          title="Serviços do período"
          count={loading ? '...' : items.length}
          meta={items.length > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Saldo do período: <span className={`font-semibold tabular-nums ${diffClass(summary.balance_minutes)}`}>{fmtMinutes(summary.balance_minutes)}</span>
              {summary.discount_total > 0 && (
                <> • Desconto: <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">{fmtMoney(summary.discount_total)}</span></>
              )}
            </span>
          )}
          footer={<TablePagination {...paginationProps} />}
          testId="shifts-table-card"
        >
          {items.length === 0 ? (
            <EmptyState
              loading={loading}
              icon={Timer}
              title={periodError ? 'Período inválido' : 'Nenhum serviço portuário no período'}
              hint={periodError || 'Ajuste o período ou os filtros'}
            />
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
              <table className="data-table" data-testid="shifts-table">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Turno</th>
                    <th>Cliente</th>
                    <th>Motorista / Placa</th>
                    <th className="text-center">Entrada</th>
                    <th className="text-center">Saída</th>
                    <th className="text-center">Dif. entrada</th>
                    <th className="text-center">Dif. saída</th>
                    <th className="text-center" title="Saldo de horas e, embaixo, o desconto possível">Saldo</th>
                    <th>Observações</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((i) => (
                      <tr key={i.id} data-testid={`shifts-row-${i.service_number}`}>
                        <td className="cell-strong tabular-nums whitespace-nowrap">#{i.service_number}</td>
                        <td className="tabular-nums whitespace-nowrap">{fmtDay(i.service_date)}</td>
                        <td>
                          <StatusPill tone={i.turno === 'NOITE' ? 'violet' : 'blue'}>{i.turno === 'NOITE' ? 'Noite' : 'Dia'}</StatusPill>
                        </td>
                        <td><div className="max-w-[125px] truncate" title={i.client_name || ''}>{i.client_name || '-'}</div></td>
                        <td>
                          <div className="max-w-[125px] truncate" title={i.driver_name || ''}>{i.driver_name || '-'}</div>
                          <div className="mt-0.5"><PlateTag>{i.cavalo_plate}</PlateTag></div>
                        </td>
                        <td className="text-center tabular-nums whitespace-nowrap">
                          {i.entry_time || '-'}
                          <div className="text-[10px] text-slate-400">prev. {i.expected_entry || '-'}</div>
                        </td>
                        <td className="text-center tabular-nums whitespace-nowrap">
                          {i.exit_time || '-'}
                          <div className="text-[10px] text-slate-400">prev. {i.expected_exit || '-'}</div>
                        </td>
                        <td className="text-center whitespace-nowrap"><Diff minutes={i.entry_diff} /></td>
                        <td className="text-center whitespace-nowrap"><Diff minutes={i.exit_diff} /></td>
                        <td className="text-center whitespace-nowrap">
                          <Balance item={i} />
                          <Discount value={i.discount} className="mt-0.5" />
                        </td>
                        <td className="min-w-[170px] max-w-[300px] whitespace-pre-wrap text-[12px] text-slate-600 dark:text-slate-300">
                          {i.observations || <span className="text-slate-400">-</span>}
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="md:hidden divide-y divide-slate-200 dark:divide-slate-700" data-testid="shifts-cards">
              {pageItems.map((i) => (
                <li key={i.id} className="px-4 py-3 space-y-2" data-testid={`shifts-card-${i.service_number}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 tabular-nums">#{i.service_number}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{fmtDay(i.service_date)}</span>
                      <StatusPill tone={i.turno === 'NOITE' ? 'violet' : 'blue'}>{i.turno === 'NOITE' ? 'Noite' : 'Dia'}</StatusPill>
                    </div>
                    <div className="text-right">
                      <Balance item={i} />
                      <Discount value={i.discount} />
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 truncate">
                    {i.client_name || '-'} · {i.driver_name || '-'} · {i.cavalo_plate || '-'}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Entrada (prev. {i.expected_entry || '-'})</div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{i.entry_time || '-'}</span>
                        <Diff minutes={i.entry_diff} />
                      </div>
                    </div>
                    <div className="rounded-md bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Saída (prev. {i.expected_exit || '-'})</div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-800 dark:text-slate-100 tabular-nums">{i.exit_time || '-'}</span>
                        <Diff minutes={i.exit_diff} />
                      </div>
                    </div>
                  </div>
                  {i.observations && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap border-l-2 border-slate-200 dark:border-slate-600 pl-2">
                      {i.observations}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            </>
          )}
        </DataCard>
      </div>
    </Layout>
  );
}
