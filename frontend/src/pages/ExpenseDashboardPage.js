import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, DataCard, EmptyState, FilterCard, FilterField, PeriodFilterFields, StatusPill } from '../components/DataPage';
import { BarsChart, CHART_COLORS, DonutChart } from '../components/Charts';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import ExpenseGroupsDialog from '../components/ExpenseGroupsDialog';
import { api } from '../lib/api';
import { todayISO } from '../lib/dates';
import { toast } from 'sonner';
import { PieChart, Wallet, Receipt, Layers, AlertTriangle, FileText, FileSpreadsheet, Tags, TrendingUp, TrendingDown } from 'lucide-react';

const COLORS = [CHART_COLORS.primary, CHART_COLORS.amber, CHART_COLORS.emerald, '#6366f1', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', CHART_COLORS.slate];
const brl = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDay = (v) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '-');
const fmtMonth = (v) => `${v.slice(5, 7)}/${v.slice(0, 4)}`;

function lastMonths(n) {
  const today = todayISO();
  const d = new Date(`${today}T12:00:00`);
  d.setMonth(d.getMonth() - (n - 1), 1);
  return [d.toISOString().slice(0, 10), today];
}

async function saveFile(request, filename) {
  try {
    const r = await request();
    const url = window.URL.createObjectURL(new Blob([r.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    toast.error('Erro ao gerar o relatório');
  }
}

// Dashboard da Prestação de Contas: custo por grupo no período, a comparação
// com o período anterior, a evolução mês a mês e os maiores custos.
export default function ExpenseDashboardPage() {
  const [period, setPeriod] = useState(() => lastMonths(3));
  const [status, setStatus] = useState('TODAS');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [groupsOpen, setGroupsOpen] = useState(false);

  const params = useMemo(() => {
    const p = {};
    if (period[0]) p.date_from = period[0];
    if (period[1]) p.date_to = period[1];
    if (status !== 'TODAS') p.status = status;
    return p;
  }, [period, status]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getExpenseDashboard(params);
      setData(r.data);
    } catch (e) {
      toast.error('Erro ao carregar o dashboard');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = data?.summary || {};
  const groups = data?.groups || [];
  const colorOf = Object.fromEntries(groups.map((g, i) => [g.group_name, COLORS[i % COLORS.length]]));
  // evolução mensal: os 5 maiores grupos e o resto somado em "Demais"
  const topNames = groups.slice(0, 5).map((g) => g.group_name);
  const monthly = (data?.by_month || []).map((m) => {
    const row = { label: fmtMonth(m.month) };
    let rest = m.total;
    topNames.forEach((name, i) => { row[`g${i}`] = m[name] || 0; rest -= m[name] || 0; });
    row.rest = Math.max(0, Math.round(rest * 100) / 100);
    return row;
  });
  const monthlySeries = [
    ...topNames.map((name, i) => ({ key: `g${i}`, name, color: colorOf[name] })),
    ...(groups.length > 5 ? [{ key: 'rest', name: 'Demais grupos', color: CHART_COLORS.slate }] : []),
  ];
  const reportName = `custos_por_grupo_${period[0] || 'inicio'}_${period[1] || 'hoje'}`;

  return (
    <Layout>
      <div className="space-y-4" data-testid="expense-dashboard-page">
        <PageHeader icon={PieChart} title="Custos por Grupo" backTo="/expense-reports"
          subtitle="Prestação de Contas: quanto foi gasto em cada grupo de custo e onde estão os maiores custos"
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setGroupsOpen(true)}><Tags className="w-4 h-4 mr-1.5" />Grupos de custo</Button>
              <Button variant="outline" size="sm" onClick={() => saveFile(() => api.downloadExpensesReportPdf(params), `${reportName}.pdf`)} data-testid="expense-dashboard-pdf">
                <FileText className="w-4 h-4 mr-1.5" />Relatório (PDF)
              </Button>
              <Button variant="outline" size="sm" onClick={() => saveFile(() => api.downloadExpensesReportExcel(params), `${reportName}.xlsx`)}>
                <FileSpreadsheet className="w-4 h-4 mr-1.5" />Relatório (Excel)
              </Button>
            </div>
          )} />

        <FilterCard>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <PeriodFilterFields value={period} onChange={setPeriod} testIdPrefix="expense-dashboard" />
            <FilterField label="Prestações">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas</SelectItem>
                  <SelectItem value="EM_ANDAMENTO">Em andamento</SelectItem>
                  <SelectItem value="CONCLUIDA">Concluídas</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Atalhos" className="col-span-2 lg:col-span-3">
              <div className="flex flex-wrap gap-2">
                {[['Este mês', 1], ['3 meses', 3], ['6 meses', 6], ['12 meses', 12]].map(([label, n]) => (
                  <Button key={label} variant="outline" size="sm" className="h-9" onClick={() => setPeriod(lastMonths(n))}>{label}</Button>
                ))}
              </div>
            </FilterField>
          </div>
        </FilterCard>

        <StatGrid>
          <StatCard label="Total gasto" value={brl(s.total_purchases)} icon={Wallet} tone="blue"
            hint={data?.previous_period ? `Período anterior: ${brl(data.previous_period.total)}` : undefined} />
          <StatCard label="Compras" value={s.purchases_count || 0} icon={Receipt} tone="slate"
            hint={s.purchases_count ? `Média ${brl(s.total_purchases / s.purchases_count)} por compra` : undefined} />
          <StatCard label="Grupos com gasto" value={s.groups_count || 0} icon={Layers} tone="emerald"
            hint={groups[0] ? `Maior: ${groups[0].group_name} (${groups[0].share}%)` : undefined} />
          <StatCard label="Sem grupo" value={brl(s.without_group_total)} icon={AlertTriangle} tone={s.without_group_total ? 'amber' : 'slate'}
            hint={s.without_group_total ? 'Edite as prestações e escolha o grupo' : 'Todas as compras têm grupo'} />
        </StatGrid>

        {!loading && !groups.length ? (
          <DataCard title="Custo por grupo"><EmptyState icon={PieChart} title="Nenhuma compra no período" hint="Ajuste o período ou lance as compras nas prestações de contas" /></DataCard>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <DataCard title="Participação de cada grupo">
                {groups.length ? (
                  <div className="p-3">
                    <DonutChart data={groups.map((g) => ({ name: g.group_name, value: g.total, color: colorOf[g.group_name] }))} centerLabel="Total" />
                  </div>
                ) : <EmptyState loading={loading} />}
              </DataCard>
              <DataCard title="Total por grupo (maior para o menor)" className="xl:col-span-2">
                {groups.length ? (
                  <div className="p-3">
                    <BarsChart animated={false} valueFormat={brl} data={groups.map((g) => ({ label: g.group_name, value: g.total }))}
                      series={[{ key: 'value', name: 'Total', color: CHART_COLORS.primary }]} />
                  </div>
                ) : <EmptyState loading={loading} />}
              </DataCard>
            </div>

            <DataCard title="Ranking dos grupos" count={groups.length}>
              <div className="overflow-x-auto">
                <table className="data-table" data-testid="expense-dashboard-groups">
                  <thead>
                    <tr>
                      <th>#</th><th>Grupo</th><th className="!text-right">Total</th><th className="!text-right">% do total</th>
                      <th className="!text-right">Compras</th><th className="!text-right">Média</th><th className="!text-right">Maior compra</th>
                      <th className="!text-right">Período anterior</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g, i) => (
                      <tr key={g.group_name}>
                        <td className="tabular-nums">{i + 1}</td>
                        <td className="cell-strong">
                          <span className="inline-block w-2.5 h-2.5 rounded-[3px] mr-2 align-middle" style={{ background: colorOf[g.group_name] }} />
                          {g.group_name}
                        </td>
                        <td className="text-right tabular-nums cell-strong">{brl(g.total)}</td>
                        <td className="text-right tabular-nums">
                          <span className="inline-flex items-center gap-2">
                            <span className="hidden sm:inline-block h-1.5 w-16 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <span className="block h-full bg-primary" style={{ width: `${Math.min(100, g.share)}%` }} />
                            </span>
                            {String(g.share).replace('.', ',')}%
                          </span>
                        </td>
                        <td className="text-right tabular-nums">{g.count}</td>
                        <td className="text-right tabular-nums">{brl(g.average)}</td>
                        <td className="text-right tabular-nums">{brl(g.largest)}</td>
                        <td className="text-right tabular-nums">
                          {g.variation == null ? <span className="text-slate-400">-</span> : (
                            <StatusPill tone={g.variation > 0 ? 'red' : 'emerald'} dot={false} className="text-[11px]" title={`Período anterior: ${brl(g.previous_total)}`}>
                              {g.variation > 0 ? <TrendingUp className="w-3 h-3 mr-1 inline" /> : <TrendingDown className="w-3 h-3 mr-1 inline" />}
                              {g.variation > 0 ? '+' : ''}{String(g.variation).replace('.', ',')}%
                            </StatusPill>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DataCard>

            {monthly.length > 1 && (
              <DataCard title="Evolução mês a mês">
                <div className="p-3"><BarsChart animated={false} valueFormat={brl} data={monthly} series={monthlySeries} /></div>
              </DataCard>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <DataCard title="Maiores compras" count={data?.top_purchases?.length || 0}>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Data</th><th>Grupo</th><th>Fornecedor</th><th>Prestação</th><th className="!text-right">Valor</th></tr></thead>
                    <tbody>
                      {(data?.top_purchases || []).map((p, i) => (
                        <tr key={i} title={p.observation || ''}>
                          <td className="tabular-nums whitespace-nowrap">{fmtDay(p.purchase_date)}</td>
                          <td>{p.group_name}</td>
                          <td className="max-w-[200px] truncate">{p.supplier_name}</td>
                          <td className="tabular-nums">{p.report}</td>
                          <td className="text-right tabular-nums cell-strong">{brl(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DataCard>
              <DataCard title="Fornecedores com mais gasto" count={data?.top_suppliers?.length || 0}>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Fornecedor</th><th className="!text-right">Compras</th><th className="!text-right">Total</th></tr></thead>
                    <tbody>
                      {(data?.top_suppliers || []).map((x) => (
                        <tr key={x.supplier_name}>
                          <td className="cell-strong max-w-[260px] truncate">{x.supplier_name}</td>
                          <td className="text-right tabular-nums">{x.count}</td>
                          <td className="text-right tabular-nums">{brl(x.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DataCard>
            </div>
          </>
        )}
      </div>
      <ExpenseGroupsDialog open={groupsOpen} onOpenChange={setGroupsOpen} onChanged={() => {}} />
    </Layout>
  );
}
