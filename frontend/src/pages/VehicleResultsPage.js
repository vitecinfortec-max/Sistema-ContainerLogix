import { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, DataCard, EmptyState, StatusPill, TablePagination, usePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Autocomplete } from '../components/Autocomplete';
import { BarsChart, CHART_COLORS } from '../components/Charts';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  FileText, FileSpreadsheet, Truck, TrendingUp, TrendingDown, Wallet, Percent, BarChart3, ArrowLeft,
} from 'lucide-react';

// Custo e Faturamento por Veículo: tudo vem de lançamentos já feitos em
// outras telas (Serviço Portuário, Ordem de Carregamento, Abastecimento, OS,
// Saída de estoque pro veículo e Solicitação de Diária), agrupado pela placa.

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMargin = (v) => (v === null || v === undefined ? '-' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const fmtDate = (d) => {
  if (!d) return '-';
  try {
    return format(new Date(`${d}T00:00:00`), 'dd/MM/yyyy');
  } catch (e) {
    return d;
  }
};

const plateKey = (p) => (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const MONTHLY_SERIES = [
  { key: 'revenue', name: 'Faturamento', color: CHART_COLORS.emerald },
  { key: 'cost', name: 'Custo', color: '#ef4444' },
];

const EMPTY = { revenue: 0, cost: 0, result: 0, margin: null, by_category: [], monthly: [], vehicles: [], rows: [] };

const startOfYear = () => `${new Date().getFullYear()}-01-01`;

function monthlyChartData(points) {
  return (points || []).map((m) => {
    const day = new Date(`${m.month}-01T00:00:00`);
    return {
      ...m,
      label: format(day, 'MMM/yy', { locale: ptBR }),
      fullLabel: format(day, "MMMM 'de' yyyy", { locale: ptBR }),
    };
  });
}

// Composição do faturamento ou do custo: uma barra por categoria,
// proporcional ao total daquele lado
function Breakdown({ title, icon: Icon, items, total, tone, testId }) {
  const bar = tone === 'emerald' ? 'bg-emerald-500' : 'bg-red-500';
  return (
    <DataCard
      title={(<span className="flex items-center gap-2"><Icon className={`w-4 h-4 ${tone === 'emerald' ? 'text-emerald-600' : 'text-red-600'}`} />{title}</span>)}
      meta={<span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtMoney(total)}</span>}
      testId={testId}
    >
      <div className="p-4 space-y-3">
        {items.map((c) => {
          const pct = total > 0 ? (c.value / total) * 100 : 0;
          return (
            <div key={c.category}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {c.category}
                  <span className="ml-1.5 font-normal text-slate-400 dark:text-slate-500">{c.count} lanç.</span>
                </span>
                <span className="tabular-nums text-slate-600 dark:text-slate-300">
                  {fmtMoney(c.value)}
                  <span className="ml-1.5 text-slate-400 dark:text-slate-500">{pct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </DataCard>
  );
}

export default function VehicleResultsPage() {
  const [dateFrom, setDateFrom] = useState(startOfYear);
  const [dateTo, setDateTo] = useState('');
  const [plateText, setPlateText] = useState('');
  const [plate, setPlate] = useState('');
  const [vehicles, setVehicles] = useState([]);
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const tableRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.getVehicles({ per_page: 1000 });
        setVehicles(r.data?.items || r.data || []);
      } catch (e) { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api.getVehicleResults(buildParams());
        if (!cancelled) setData({ ...EMPTY, ...r.data });
      } catch (e) {
        if (!cancelled) toast.error('Erro ao carregar custo e faturamento');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, plate]);

  const buildParams = () => {
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (plate) params.plate = plate;
    return params;
  };

  // Placas pra busca: cadastradas + as que só aparecem nos lançamentos
  const plateOptions = useMemo(() => {
    const seen = new Map();
    vehicles.forEach((v) => {
      if (v.plate) seen.set(plateKey(v.plate), { plate: v.plate, label: [v.plate, v.brand, v.model].filter(Boolean).join(' · ') });
    });
    (data.vehicles || []).forEach((v) => {
      if (!seen.has(v.plate_key)) seen.set(v.plate_key, { plate: v.plate, label: v.plate });
    });
    return [...seen.values()].sort((a, b) => a.plate.localeCompare(b.plate));
  }, [vehicles, data.vehicles]);

  const selectPlate = (p) => {
    setPlate(p || '');
    setPlateText(p ? (plateOptions.find((o) => plateKey(o.plate) === plateKey(p))?.label || p) : '');
  };

  const clearFilters = () => {
    setDateFrom(startOfYear());
    setDateTo('');
    selectPlate('');
  };
  const hasFilters = !!plate || dateFrom !== startOfYear() || !!dateTo;

  const download = async (kind) => {
    setDownloading(true);
    try {
      const call = kind === 'pdf' ? api.downloadVehicleResultsPDF : api.downloadVehicleResultsExcel;
      const response = await call(buildParams());
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const suffix = plate ? plateKey(plate) : 'frota';
      link.setAttribute('download', `custo_faturamento_${suffix}_${format(new Date(), 'dd-MM-yyyy_HH-mm')}.${kind === 'pdf' ? 'pdf' : 'xlsx'}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      toast.error(`Erro ao gerar o ${kind === 'pdf' ? 'PDF' : 'Excel'}`);
    } finally {
      setDownloading(false);
    }
  };

  const revenueCats = data.by_category.filter((c) => c.kind === 'RECEITA');
  const costCats = data.by_category.filter((c) => c.kind === 'CUSTO');
  const negative = data.result < 0;
  const hasData = data.revenue > 0 || data.cost > 0;

  const listItems = plate ? data.rows : data.vehicles;
  const { pageItems, paginationProps } = usePagination(listItems, { pageSize: 15, resetKey: `${plate}|${dateFrom}|${dateTo}`, scrollRef: tableRef });

  return (
    <Layout>
      <div className="space-y-4" data-testid="vehicle-results-page">
        <PageHeader
          icon={Truck}
          title="Custo e Faturamento por Veículo"
          subtitle="Resultado de cada placa: Serviço Portuário e Ordem de Carregamento contra Abastecimento, OS, peças e diárias"
        />

        <FilterCard
          hasFilters={hasFilters}
          onClear={clearFilters}
          clearLinkTestId="vehicle-results-clear-filters"
          actions={(
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => download('pdf')} disabled={downloading} className="h-8 text-xs gap-1.5" data-testid="vehicle-results-pdf">
                <FileText className="w-4 h-4 text-red-600" /> Baixar PDF
              </Button>
              <Button type="button" size="sm" onClick={() => download('excel')} disabled={downloading} className="h-8 text-xs gap-1.5" data-testid="vehicle-results-excel">
                <FileSpreadsheet className="w-4 h-4" /> Baixar Excel
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <FilterField label="Placa do veículo">
                <Autocomplete
                  value={plateText}
                  onChange={(text) => {
                    setPlateText(text);
                    if (!text.trim()) setPlate('');
                  }}
                  onSelect={(o) => selectPlate(o.plate)}
                  options={plateOptions}
                  displayField="label"
                  valueField="plate"
                  className="h-9 text-sm"
                  testId="vehicle-results-plate"
                />
              </FilterField>
            </div>
            <FilterField label="Data início">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 text-sm" data-testid="vehicle-results-date-from" />
            </FilterField>
            <FilterField label="Data fim">
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 text-sm" data-testid="vehicle-results-date-to" />
            </FilterField>
          </div>
        </FilterCard>

        {plate && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="px-2.5 py-1 rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-bold tracking-wider" data-testid="vehicle-results-plate-badge">
                {data.plate || plate}
              </span>
              {data.vehicle && <span className="text-sm text-slate-600 dark:text-slate-300 truncate">{data.vehicle}</span>}
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={() => selectPlate('')}>
              <ArrowLeft className="w-3.5 h-3.5" /> Ver toda a frota
            </Button>
          </div>
        )}

        <StatGrid>
          <StatCard icon={TrendingUp} label="Faturamento" value={fmtMoney(data.revenue)} tone="emerald" testId="vehicle-results-revenue" />
          <StatCard icon={TrendingDown} label="Custo" value={fmtMoney(data.cost)} tone="red" testId="vehicle-results-cost" />
          <StatCard icon={Wallet} label="Resultado" value={fmtMoney(data.result)} tone={negative ? 'red' : 'primary'} testId="vehicle-results-result" />
          <StatCard icon={Percent} label="Margem" value={fmtMargin(data.margin)} tone={negative ? 'red' : 'blue'} hint="Resultado sobre o faturamento" testId="vehicle-results-margin" />
        </StatGrid>

        {loading && !hasData ? (
          <DataCard><EmptyState loading /></DataCard>
        ) : !hasData ? (
          <DataCard>
            <EmptyState
              icon={Truck}
              title={plate ? 'Nenhum lançamento desta placa no período' : 'Nenhum lançamento com placa no período'}
              hint="Ajuste o período ou confira se os lançamentos têm a placa preenchida"
            />
          </DataCard>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Breakdown title="Faturamento por origem" icon={TrendingUp} items={revenueCats} total={data.revenue} tone="emerald" testId="vehicle-results-revenue-breakdown" />
              <Breakdown title="Custo por categoria" icon={TrendingDown} items={costCats} total={data.cost} tone="red" testId="vehicle-results-cost-breakdown" />
            </div>

            <DataCard
              title={(<span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />Faturamento x custo por mês</span>)}
              testId="vehicle-results-monthly-card"
            >
              <div className="p-4">
                {/* A quantidade de meses muda com o filtro: sem animação */}
                <BarsChart
                  animated={false}
                  testId="vehicle-results-monthly-chart"
                  data={monthlyChartData(data.monthly)}
                  series={MONTHLY_SERIES}
                  valueFormat={fmtMoney}
                  allowDecimals
                />
              </div>
            </DataCard>
          </>
        )}

        {hasData && (
          <div ref={tableRef} className="scroll-mt-20">
            {plate ? (
              <DataCard title="Lançamentos" count={data.rows.length} footer={<TablePagination {...paginationProps} />} testId="vehicle-results-rows">
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Tipo</th>
                        <th>Categoria</th>
                        <th>Documento</th>
                        <th>Descrição</th>
                        <th className="!text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((r, i) => {
                        const revenue = r.kind === 'RECEITA';
                        return (
                          <tr key={`${r.document}-${r.date}-${i}`}>
                            <td className="whitespace-nowrap tabular-nums">{fmtDate(r.date)}</td>
                            <td><StatusPill tone={revenue ? 'emerald' : 'red'}>{revenue ? 'Faturamento' : 'Custo'}</StatusPill></td>
                            <td className="whitespace-nowrap">{r.category}</td>
                            <td className="whitespace-nowrap cell-strong">{r.document}</td>
                            <td><div className="max-w-[280px] truncate" title={r.description || ''}>{r.description || '-'}</div></td>
                            <td className={`text-right whitespace-nowrap tabular-nums font-medium ${revenue ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                              {revenue ? '+' : '-'}{fmtMoney(r.value)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </DataCard>
            ) : (
              <DataCard
                title="Resultado por veículo"
                count={data.vehicles.length}
                meta={<span className="text-xs text-slate-400 dark:text-slate-500">clique numa placa para ver os lançamentos</span>}
                footer={<TablePagination {...paginationProps} />}
                testId="vehicle-results-ranking"
              >
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Placa</th>
                        <th>Veículo</th>
                        <th className="!text-right">Lançamentos</th>
                        <th className="!text-right">Faturamento</th>
                        <th className="!text-right">Custo</th>
                        <th className="!text-right">Resultado</th>
                        <th className="!text-right">Margem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((v) => (
                        <tr key={v.plate_key} className="cursor-pointer" onClick={() => selectPlate(v.plate)}>
                          <td className="whitespace-nowrap cell-strong tracking-wide">{v.plate}</td>
                          <td>
                            {v.vehicle || (v.registered ? '-' : <span className="text-xs text-amber-600 dark:text-amber-400" title="Placa usada nos lançamentos mas sem cadastro em Veículos">sem cadastro</span>)}
                          </td>
                          <td className="text-right tabular-nums">{v.count}</td>
                          <td className="text-right whitespace-nowrap tabular-nums text-emerald-600 dark:text-emerald-400">{fmtMoney(v.revenue)}</td>
                          <td className="text-right whitespace-nowrap tabular-nums text-red-600 dark:text-red-400">{fmtMoney(v.cost)}</td>
                          <td className={`text-right whitespace-nowrap tabular-nums font-semibold ${v.result < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>{fmtMoney(v.result)}</td>
                          <td className="text-right whitespace-nowrap tabular-nums">{fmtMargin(v.margin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DataCard>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
