import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { DataCard, EmptyState, FilterCard, FilterField } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { api } from '../lib/api';
import { todayISO } from '../lib/dates';
import { errorDetail, fmtDate, fmtNumber, formatMoney, saveBlob, useHRMeta } from '../components/HRKit';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { BarChart3, Users, WalletCards, TreePalm, MessageSquareWarning, FileBadge, Hourglass, Cake, Printer, FileSpreadsheet } from 'lucide-react';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// filtros de cada relatório: period = de/até; months = competência de/até
const REPORTS = [
  { kind: 'headcount', title: 'Quadro de Funcionários', icon: Users, desc: 'Contratos por setor, com cargo, admissão e salário', filters: ['department', 'contractStatus'] },
  { kind: 'payroll-cost', title: 'Custo da Folha', icon: WalletCards, desc: 'Proventos, descontos, líquido, INSS, IRRF e FGTS por competência e setor', filters: ['months', 'department'] },
  { kind: 'vacations', title: 'Férias', icon: TreePalm, desc: 'Saldos em aberto (vencidos e a vencer) e férias do período', filters: ['period', 'department'] },
  { kind: 'occurrences', title: 'Ocorrências', icon: MessageSquareWarning, desc: 'Advertências, atestados, faltas e afastamentos do período', filters: ['period', 'occurrenceType', 'department'] },
  { kind: 'documents', title: 'Documentos e ASO', icon: FileBadge, desc: 'Validade dos exames, treinamentos e documentos', filters: ['docStatus', 'department'] },
  { kind: 'time-bank', title: 'Banco de Horas', icon: Hourglass, desc: 'Saldo de horas por funcionário e os lançamentos', filters: ['period'] },
  { kind: 'birthdays', title: 'Aniversariantes', icon: Cake, desc: 'Aniversariantes do mês', filters: ['month'] },
];

function monthStart(offset = 0) {
  const d = new Date(`${todayISO().slice(0, 7)}-01T00:00:00`);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function cellText(value, kind) {
  if (value === null || value === undefined || value === '') return '-';
  if (kind === 'money') return typeof value === 'number' ? formatMoney(value) : value;
  if (kind === 'day') return fmtDate(value);
  if (kind === 'int') return typeof value === 'number' ? fmtNumber(value, 2) : value;
  return String(value);
}

export default function HRReportsPage() {
  const { meta } = useHRMeta();
  const [kind, setKind] = useState('headcount');
  const report = REPORTS.find((r) => r.kind === kind);
  const [filters, setFilters] = useState({
    department: '', contractStatus: 'VIGENTE', monthFrom: monthStart(-5), monthTo: monthStart(0),
    dateFrom: `${monthStart(0)}-01`, dateTo: todayISO(), occurrenceType: '', docStatus: '', month: String(new Date().getMonth() + 1),
  });
  const debounced = useDebouncedValue(filters, 400);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const params = (f = debounced) => {
    const p = {};
    const has = (name) => report.filters.includes(name);
    if (has('department') && f.department.trim()) p.department = f.department.trim();
    if (has('contractStatus')) p.status = f.contractStatus;
    if (has('months')) { p.date_from = `${f.monthFrom}-01`; p.date_to = `${f.monthTo}-01`; }
    if (has('period')) { if (f.dateFrom) p.date_from = f.dateFrom; if (f.dateTo) p.date_to = f.dateTo; }
    if (has('occurrenceType') && f.occurrenceType) p.status = f.occurrenceType;
    if (has('docStatus') && f.docStatus) p.status = f.docStatus;
    if (has('month')) p.month = Number(f.month);
    return p;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getHRReport(kind, params())
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) { setData(null); toast.error(errorDetail(e, 'Erro ao carregar o relatório')); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const download = async (type) => {
    setBusy(type);
    const fn = type === 'pdf' ? api.downloadHRReportPdf : api.downloadHRReportExcel;
    await saveBlob(() => fn(kind, params(filters)), `rh_${kind}.${type === 'pdf' ? 'pdf' : 'xlsx'}`);
    setBusy('');
  };
  const has = (name) => report.filters.includes(name);

  return (
    <Layout>
      <div className="space-y-4" data-testid="hr-reports-page">
        <PageHeader icon={BarChart3} title="Relatórios de RH" subtitle="Escolha o relatório, ajuste os filtros e baixe em PDF ou Excel" />

        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
          {REPORTS.map((r) => (
            <button key={r.kind} type="button" onClick={() => setKind(r.kind)} data-testid={`hr-report-${r.kind}`}
              className={cn('rounded-lg border p-3 text-left transition-colors',
                r.kind === kind ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-slate-200 dark:border-slate-700 hover:border-primary/50 bg-card')}>
              <r.icon className={cn('w-5 h-5 mb-1.5', r.kind === kind ? 'text-primary' : 'text-slate-400')} />
              <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 leading-tight">{r.title}</div>
            </button>
          ))}
        </div>

        <FilterCard title={report.title}>
          <p className="text-[12px] text-slate-500 mb-3">{report.desc}</p>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            {has('months') && (
              <>
                <FilterField label="Competência - de"><Input type="month" className="h-9 text-sm" value={filters.monthFrom} onChange={(e) => setF('monthFrom', e.target.value)} /></FilterField>
                <FilterField label="até"><Input type="month" className="h-9 text-sm" value={filters.monthTo} onChange={(e) => setF('monthTo', e.target.value)} /></FilterField>
              </>
            )}
            {has('period') && (
              <>
                <FilterField label="Período - de"><Input type="date" className="h-9 text-sm" value={filters.dateFrom} onChange={(e) => setF('dateFrom', e.target.value)} /></FilterField>
                <FilterField label="até"><Input type="date" className="h-9 text-sm" value={filters.dateTo} onChange={(e) => setF('dateTo', e.target.value)} /></FilterField>
              </>
            )}
            {has('month') && (
              <FilterField label="Mês">
                <Select value={filters.month} onValueChange={(v) => setF('month', v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </FilterField>
            )}
            {has('contractStatus') && (
              <FilterField label="Situação">
                <Select value={filters.contractStatus} onValueChange={(v) => setF('contractStatus', v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VIGENTE">Vigentes</SelectItem>
                    <SelectItem value="ATIVO">Ativos</SelectItem>
                    <SelectItem value="AFASTADO">Afastados</SelectItem>
                    <SelectItem value="DESLIGADO">Desligados</SelectItem>
                    <SelectItem value="TODOS">Todos</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            )}
            {has('occurrenceType') && (
              <FilterField label="Tipo">
                <Select value={filters.occurrenceType || '_all'} onValueChange={(v) => setF('occurrenceType', v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todos</SelectItem>
                    {meta.occurrence_types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FilterField>
            )}
            {has('docStatus') && (
              <FilterField label="Validade">
                <Select value={filters.docStatus || '_all'} onValueChange={(v) => setF('docStatus', v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todas</SelectItem>
                    <SelectItem value="VENCIDO">Vencidos</SelectItem>
                    <SelectItem value="A_VENCER">Vencem em 30 dias</SelectItem>
                    <SelectItem value="VALIDO">Válidos</SelectItem>
                    <SelectItem value="SEM_VALIDADE">Sem validade</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            )}
            {has('department') && (
              <FilterField label="Setor"><Input className="h-9 text-sm" value={filters.department} onChange={(e) => setF('department', e.target.value)} /></FilterField>
            )}
            <div className="flex gap-2 col-span-2 lg:col-span-2 lg:col-start-5 justify-end">
              <Button variant="outline" size="sm" className="h-9" onClick={() => download('pdf')} disabled={!!busy} data-testid="hr-report-pdf">
                <Printer className="w-4 h-4 mr-1.5" />{busy === 'pdf' ? 'Gerando...' : 'PDF'}
              </Button>
              <Button variant="outline" size="sm" className="h-9" onClick={() => download('excel')} disabled={!!busy} data-testid="hr-report-excel">
                <FileSpreadsheet className="w-4 h-4 mr-1.5" />{busy === 'excel' ? 'Gerando...' : 'Excel'}
              </Button>
            </div>
          </div>
        </FilterCard>

        {data && (
          <div className="flex flex-wrap gap-2" data-testid="hr-report-summary">
            {data.info.map(([k, v]) => (
              <span key={k} className="rounded-md border border-slate-200 dark:border-slate-700 bg-card px-3 py-1.5 text-[12px]">
                <span className="text-slate-500">{k}: </span><b className="text-slate-800 dark:text-slate-100">{v}</b>
              </span>
            ))}
          </div>
        )}

        {loading && !data && <EmptyState icon={BarChart3} loading title="Carregando" />}
        {data && data.sections.map((s) => (
          <DataCard key={s.title} title={s.title} count={s.count}>
            {s.rows.length ? (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>{s.columns.map((c) => <th key={c.label} className={c.kind === 'money' ? '!text-right' : ''}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {s.rows.map((row, i) => (
                      <tr key={i}>{row.map((v, j) => (
                        <td key={j} className={cn(s.columns[j].kind === 'money' && 'text-right', ['money', 'int', 'day'].includes(s.columns[j].kind) && 'tabular-nums')}>
                          {cellText(v, s.columns[j].kind)}
                        </td>
                      ))}</tr>
                    ))}
                  </tbody>
                  {s.total && (
                    <tfoot>
                      <tr>{s.total.map((v, j) => <td key={j} className={cn(s.columns[j].kind === 'money' && 'text-right', 'tabular-nums')}>{v === null ? '' : cellText(v, s.columns[j].kind)}</td>)}</tr>
                    </tfoot>
                  )}
                </table>
                {s.count > s.rows.length && <p className="px-4 py-2 text-[11px] text-slate-500">Mostrando {s.rows.length} de {s.count}. O PDF e o Excel trazem tudo.</p>}
              </div>
            ) : <EmptyState icon={report.icon} title="Nada a mostrar com esses filtros" />}
          </DataCard>
        ))}
      </div>
    </Layout>
  );
}
