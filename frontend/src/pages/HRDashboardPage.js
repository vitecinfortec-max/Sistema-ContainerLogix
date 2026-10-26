import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { StatCard, StatGrid, DataCard, EmptyState, StatusPill } from '../components/DataPage';
import { BarsChart, CHART_COLORS, DonutChart } from '../components/Charts';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { competenceLabel, fmtDate, fmtMinutes, formatMoney } from '../components/HRKit';
import { toast } from 'sonner';
import {
  Contact, Users, PauseCircle, Plane, Wallet, UserPlus, UserMinus, Hourglass, TreePalm, FileBadge, Cake, WalletCards,
} from 'lucide-react';

const DONUT_COLORS = [CHART_COLORS.primary, CHART_COLORS.amber, CHART_COLORS.emerald, '#6366f1', '#ef4444', CHART_COLORS.slate];

function AlertList({ title, icon: Icon, items, empty, render, onMore, testId }) {
  return (
    <DataCard title={title} count={items.length} testId={testId}
      toolbar={onMore && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onMore}>Ver tudo</Button>}>
      {items.length ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.slice(0, 8).map((item, i) => <li key={i} className="px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 flex items-center justify-between gap-3">{render(item)}</li>)}
        </ul>
      ) : <EmptyState icon={Icon} title={empty} />}
    </DataCard>
  );
}

export default function HRDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.getHRDashboard().then((r) => setData(r.data)).catch(() => toast.error('Erro ao carregar o painel do RH'));
  }, []);

  if (!data) {
    return <Layout><div className="space-y-4"><PageHeader icon={Contact} title="Painel do RH" /><EmptyState icon={Contact} loading title="Carregando" /></div></Layout>;
  }

  return (
    <Layout>
      <div className="space-y-4" data-testid="hr-dashboard-page">
        <PageHeader icon={Contact} title="Painel do RH" subtitle="Quadro de pessoal, alertas de experiência, férias e documentos, aniversariantes do mês"
          actions={<Button size="sm" onClick={() => navigate('/rh/contratos')}><UserPlus className="w-4 h-4 mr-1.5" />Nova admissão</Button>} />

        <StatGrid>
          <StatCard label="Funcionários" value={data.headcount} icon={Users} tone="primary" hint={`${data.active} ativos`} testId="hr-dash-headcount" />
          <StatCard label="Afastados" value={data.on_leave} icon={PauseCircle} tone="amber" />
          <StatCard label="Em férias hoje" value={data.on_vacation} icon={Plane} tone="blue" />
          <StatCard label="Salários base" value={formatMoney(data.payroll_base)} icon={Wallet} tone="slate" hint="soma dos contratos vigentes" />
          <StatCard label="Admitidos no mês" value={data.admitted_month} icon={UserPlus} tone="emerald" />
          <StatCard label="Desligados no mês" value={data.terminated_month} icon={UserMinus} tone="red" />
        </StatGrid>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DataCard title="Funcionários por setor" count={data.by_department.length}>
            {data.by_department.length ? (
              <div className="p-3">
                <BarsChart animated={false} data={data.by_department.map((d) => ({ label: d.label, value: d.value }))}
                  series={[{ key: 'value', name: 'Funcionários', color: CHART_COLORS.primary }]} />
              </div>
            ) : <EmptyState icon={Users} title="Nenhum contrato" />}
          </DataCard>
          <DataCard title="Por tipo de contrato" count={data.by_type.length}>
            {data.by_type.length ? (
              <div className="p-3"><DonutChart data={data.by_type.map((d, i) => ({ name: d.label, value: d.value, color: DONUT_COLORS[i % DONUT_COLORS.length] }))} centerLabel="Contratos" /></div>
            ) : <EmptyState icon={Users} title="Nenhum contrato" />}
          </DataCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AlertList title="Contratos de experiência vencendo" icon={Hourglass} items={data.experiences} empty="Nenhum vencendo nos próximos 15 dias"
            onMore={() => navigate('/rh/contratos')} testId="hr-dash-experiences"
            render={(e) => (
              <>
                <span className="truncate"><span className="font-medium">{e.person_name}</span> <span className="text-slate-500 dark:text-slate-400">{e.position_name || ''}</span></span>
                <StatusPill tone={e.days_left < 0 ? 'red' : 'amber'}>{e.days_left < 0 ? 'vencido' : e.days_left === 0 ? 'vence hoje' : `${e.days_left} dia(s)`} · {fmtDate(e.experience_end)}</StatusPill>
              </>
            )} />
          <AlertList title="Férias vencidas ou vencendo" icon={TreePalm} items={data.vacations} empty="Nenhum período perto do prazo"
            onMore={() => navigate('/rh/ferias')} testId="hr-dash-vacations"
            render={(v) => (
              <>
                <span className="truncate"><span className="font-medium">{v.person_name}</span> <span className="text-slate-500 dark:text-slate-400">{v.available_days} dias disponíveis</span></span>
                <StatusPill tone={v.overdue ? 'red' : 'amber'}>{v.overdue ? `${v.overdue} vencido(s)` : `conceder até ${fmtDate(v.next_deadline)}`}</StatusPill>
              </>
            )} />
          <AlertList title="Documentos e ASO vencidos ou vencendo" icon={FileBadge} items={data.documents} empty="Nenhum documento perto do vencimento"
            onMore={() => navigate('/rh/documentos')} testId="hr-dash-documents"
            render={(d) => (
              <>
                <span className="truncate"><span className="font-medium">{d.person_name}</span> <span className="text-slate-500 dark:text-slate-400">{d.description || d.doc_type.replace(/_/g, ' ').toLowerCase()}</span></span>
                <StatusPill tone={d.status === 'VENCIDO' ? 'red' : 'amber'}>{d.status === 'VENCIDO' ? 'vencido' : 'vence'} {fmtDate(d.expiry_date)}</StatusPill>
              </>
            )} />
          <AlertList title="Banco de horas vencido ou vencendo" icon={Hourglass} items={data.time_bank || []} empty="Nenhuma hora perto do prazo"
            onMore={() => navigate('/rh/banco-horas')} testId="hr-dash-time-bank"
            render={(b) => (
              <>
                <span className="truncate"><span className="font-medium">{b.person_name}</span> <span className="text-slate-500 dark:text-slate-400">saldo {fmtMinutes(b.balance)}</span></span>
                <StatusPill tone={b.expired ? 'red' : 'amber'}>{b.expired ? `${fmtMinutes(b.expired)} vencidas` : `${fmtMinutes(b.expiring)} vencem ${fmtDate(b.next_expiry)}`}</StatusPill>
              </>
            )} />
          <AlertList title="Aniversariantes do mês" icon={Cake} items={data.birthdays} empty="Nenhum aniversariante este mês" testId="hr-dash-birthdays"
            render={(b) => (
              <>
                <span className="truncate"><span className="font-medium">{b.person_name}</span> <span className="text-slate-500 dark:text-slate-400">{b.department || ''}</span></span>
                <StatusPill tone="blue" dot={false}>dia {b.day}</StatusPill>
              </>
            )} />
        </div>

        {data.last_payroll && (
          <DataCard title="Última folha mensal" toolbar={<Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => navigate(`/rh/folha?folha=${data.last_payroll.id}`)}>Abrir</Button>}>
            <div className="px-4 py-3 flex flex-wrap gap-6 text-sm">
              <span className="flex items-center gap-2"><WalletCards className="w-4 h-4 text-primary" />{competenceLabel(data.last_payroll.competence)}</span>
              <span>Contracheques: <b>{data.last_payroll.totals?.count || 0}</b></span>
              <span>Líquido: <b>{formatMoney(data.last_payroll.totals?.net)}</b></span>
              <span>FGTS: <b>{formatMoney(data.last_payroll.totals?.fgts)}</b></span>
              <span>Situação: <b>{{ ABERTA: 'Aberta', FECHADA: 'Fechada', PAGA: 'Paga' }[data.last_payroll.status]}</b></span>
            </div>
          </DataCard>
        )}
      </div>
    </Layout>
  );
}
