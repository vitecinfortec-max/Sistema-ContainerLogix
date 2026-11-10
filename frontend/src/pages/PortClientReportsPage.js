import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, FilterCard, FilterField, DataCard, EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { FileBarChart, FileText, FileSpreadsheet, ListChecks, Users, Truck, Clock, CalendarRange } from 'lucide-react';
import { cn } from '../lib/utils';
import { STATUS_LABELS, fmtLocalDateTime } from './PortClientOrderPage';

const REPORTS = [
  { kind: 'periodo', label: 'Ordens por período', icon: ListChecks },
  { kind: 'faturamento-cliente', label: 'Faturamento por cliente', icon: Users },
  { kind: 'producao', label: 'Produção por motorista/placa', icon: Truck },
  { kind: 'em-aberto', label: 'Em aberto / em trânsito', icon: Clock },
  { kind: 'resumo-mensal', label: 'Resumo mensal', icon: CalendarRange },
];

const TONE_TEXT = { red: '!text-red-600 dark:!text-red-400', emerald: '!text-emerald-600 dark:!text-emerald-400', amber: '!text-amber-600', blue: '!text-blue-600' };

// Mesma formatação do PDF (reports.tabular_fmt)
function fmtCell(value, type) {
  if (value === null || value === undefined || value === '') return '-';
  switch (type) {
    case 'money': return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    case 'int': return Number(value).toLocaleString('pt-BR');
    case 'datetime': return fmtLocalDateTime(value);
    case 'date': return fmtLocalDateTime(value).slice(0, 10);
    case 'pct': return `${value > 0 ? '+' : ''}${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    case 'month': { const [y, m] = String(value).split('-'); return `${m}/${y}`; }
    default: return String(value);
  }
}

const alignOf = (type) => (['money', 'int', 'pct'].includes(type) ? 'text-right' : ['date', 'datetime', 'month'].includes(type) ? 'text-center' : '');

function totalLabelIndex(total) {
  const first = total.findIndex((v) => v !== null && v !== undefined);
  return Math.max((first === -1 ? total.length : first) - 1, 0);
}

function SectionTable({ section }) {
  if (!section.rows.length) {
    return <EmptyState icon={FileBarChart} title={section.empty_message || 'Nenhuma ordem encontrada para os filtros selecionados.'} />;
  }
  const labelIdx = section.total ? totalLabelIndex(section.total) : -1;
  return (
    <div className="overflow-x-auto">
      <table className="data-table [&_td]:!px-2 [&_th]:!px-2 [&_td]:!text-xs">
        <thead>
          <tr>{section.columns.map((c) => <th key={c.label} className={cn(alignOf(c.type) === 'text-right' && '!text-right')}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {section.rows.map((row, r) => (
            <tr key={r}>
              {row.map((v, i) => {
                const tone = section.tone_col === i ? section.row_tones?.[r] : null;
                return (
                  <td key={i} className={cn(section.columns[i].type === 'text' ? 'min-w-[80px] max-w-[220px]' : 'whitespace-nowrap tabular-nums', alignOf(section.columns[i].type), tone && `font-semibold ${TONE_TEXT[tone] || ''}`)}>
                    {fmtCell(v, section.columns[i].type)}
                  </td>
                );
              })}
            </tr>
          ))}
          {section.total && (
            <tr className="bg-primary/5 font-semibold" data-testid="report-total-row">
              {section.total.map((v, i) => (
                <td key={i} className={cn('whitespace-nowrap tabular-nums', v !== null ? alignOf(section.columns[i].type) : 'text-right')}>
                  {v !== null && v !== undefined ? fmtCell(v, section.columns[i].type) : (i === labelIdx ? (section.total_label || 'TOTAL') : '')}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function PortClientReportsPage() {
  const [kind, setKind] = useState('periodo');
  const [filters, setFilters] = useState({ date_from: '', date_to: '', client_id: '', operation_type: '', status: '' });
  const [clientName, setClientName] = useState('');
  const [clients, setClients] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.getClients({ per_page: 1000 }).then((r) => setClients(r.data || [])).catch(() => {});
  }, []);

  const params = () => {
    const p = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) p[k] = v; });
    if (!filters.client_id && clientName.trim()) p.client_name = clientName.trim();
    return p;
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.getPortClientReport(kind, params())
        .then((r) => { if (alive) setReport(r.data); })
        .catch(() => { if (alive) toast.error('Erro ao carregar o relatório'); })
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, filters, clientName]);

  const setFilter = (key) => (value) => setFilters((p) => ({ ...p, [key]: value === '_all' ? '' : value }));
  const hasFilters = Object.values(filters).some(Boolean) || !!clientName;
  const clearFilters = () => {
    setFilters({ date_from: '', date_to: '', client_id: '', operation_type: '', status: '' });
    setClientName('');
  };

  const download = async (fmt) => {
    setDownloading(true);
    try {
      const r = await api.downloadPortClientReport(kind, fmt, params());
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `os_cliente_${kind}_${format(new Date(), 'dd-MM-yyyy_HH-mm')}.${fmt === 'pdf' ? 'pdf' : 'xlsx'}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`Erro ao gerar o ${fmt === 'pdf' ? 'PDF' : 'Excel'}`);
    } finally {
      setDownloading(false);
    }
  };

  const current = REPORTS.find((r) => r.kind === kind);

  return (
    <Layout>
      <div className="space-y-4" data-testid="port-client-reports-page">
        <PageHeader icon={FileBarChart} title="Relatórios – Ordem de Serviço - Cliente" subtitle="Faturamento de frete das ordens de serviço feitas direto entre porto e cliente, separado das operações do terminal" />

        <div className="flex flex-wrap gap-2" role="tablist">
          {REPORTS.map((r) => (
            <Button
              key={r.kind}
              type="button"
              size="sm"
              variant={kind === r.kind ? 'default' : 'outline'}
              onClick={() => setKind(r.kind)}
              className="h-8 text-xs gap-1.5"
              data-testid={`pcr-tab-${r.kind}`}
            >
              <r.icon className="w-4 h-4" /> {r.label}
            </Button>
          ))}
        </div>

        <FilterCard
          hasFilters={hasFilters}
          onClear={clearFilters}
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => download('pdf')} disabled={downloading} className="h-8 text-xs gap-1.5" data-testid="pcr-pdf">
                <FileText className="w-4 h-4 text-red-600" /> Baixar PDF
              </Button>
              <Button type="button" size="sm" onClick={() => download('excel')} disabled={downloading} className="h-8 text-xs gap-1.5" data-testid="pcr-excel">
                <FileSpreadsheet className="w-4 h-4" /> Baixar Excel
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <FilterField label="Prevista de">
              <Input type="date" className="h-9 text-sm" value={filters.date_from} onChange={(e) => setFilter('date_from')(e.target.value)} data-testid="pcr-date-from" />
            </FilterField>
            <FilterField label="Até">
              <Input type="date" className="h-9 text-sm" value={filters.date_to} onChange={(e) => setFilter('date_to')(e.target.value)} data-testid="pcr-date-to" />
            </FilterField>
            <FilterField label="Cliente">
              <Autocomplete
                value={clientName}
                onChange={(v) => { setClientName(v); setFilter('client_id')(''); }}
                onSelect={(c) => { setClientName(c.name); setFilter('client_id')(c.id); }}
                options={clients}
                displayField="name"
                className="h-9 text-sm"
                testId="pcr-client"
              />
            </FilterField>
            <FilterField label="Operação">
              <Select value={filters.operation_type || '_all'} onValueChange={setFilter('operation_type')}>
                <SelectTrigger className="h-9 text-sm" data-testid="pcr-operation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  <SelectItem value="ENTREGA">Entrega</SelectItem>
                  <SelectItem value="COLETA">Coleta</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Status">
              <Select value={filters.status || '_all'} onValueChange={setFilter('status')}>
                <SelectTrigger className="h-9 text-sm" data-testid="pcr-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
          {kind !== 'periodo' && kind !== 'em-aberto' && (
            <p className="mt-2 text-xs text-slate-500">Ordens canceladas não entram neste relatório (a não ser que o filtro de status seja “Cancelada”).</p>
          )}
        </FilterCard>

        {report && (
          <StatGrid>
            {report.summary.slice(0, 4).map(([label, value], i) => (
              <StatCard key={label} label={label} value={value} icon={current.icon} tone={['blue', 'emerald', 'primary', 'amber'][i]} testId={`pcr-kpi-${i}`} />
            ))}
          </StatGrid>
        )}

        {loading && !report ? (
          <DataCard title={current.label}><EmptyState loading /></DataCard>
        ) : report && report.sections.map((section) => (
          <DataCard
            key={section.sheet}
            title={section.title ? `${current.label} – ${section.title}` : current.label}
            count={section.rows.length}
            meta={<span className="text-xs text-slate-400 dark:text-slate-500">{report.filters_text}</span>}
            testId={`pcr-section-${section.sheet}`}
          >
            <SectionTable section={section} />
          </DataCard>
        ))}

        {report?.totals?.length > 0 && (
          <div className="flex justify-end">
            <div className="w-full sm:w-80 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-sm" data-testid="pcr-totals">
              {report.totals.map(([label, value, type], i) => {
                const grand = i === report.totals.length - 1;
                return (
                  <div key={label} className={cn('flex justify-between px-3 py-2', grand ? 'bg-primary text-white font-semibold' : 'border-b border-slate-100 dark:border-slate-800')}>
                    <span>{label}</span><span className="tabular-nums">{fmtCell(value, type)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
