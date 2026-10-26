import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination, usePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useConfirm } from '../hooks/useConfirm';
import { api } from '../lib/api';
import { todayISO } from '../lib/dates';
import { competenceLabel, errorDetail, fmtDate, fmtNumber, formatMoney, saveBlob, useHRMeta } from '../components/HRKit';
import { toast } from 'sonner';
import {
  WalletCards, Plus, Trash2, FolderOpen, Printer, RefreshCw, Lock, LockOpen, CheckCircle2, RotateCcw, Pencil, Save, Percent,
  Users, Banknote, Landmark, Receipt,
} from 'lucide-react';

const STATUS_LABELS = { ABERTA: 'Aberta', FECHADA: 'Fechada', PAGA: 'Paga' };
const STATUS_TONES = { ABERTA: 'amber', FECHADA: 'blue', PAGA: 'emerald' };

function nextCompetence() {
  return todayISO().slice(0, 7);
}

export default function PayrollPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const runId = searchParams.get('folha');
  return runId
    ? <PayrollRunDetail runId={runId} onBack={() => setSearchParams({})} />
    : <PayrollRunList onOpen={(id) => setSearchParams({ folha: id })} onSettings={() => navigate('/rh/tabelas')} />;
}

function PayrollRunList({ onOpen, onSettings }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const { meta, label } = useHRMeta();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(todayISO().slice(0, 4));
  const [selectedId, setSelectedId] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ competence: nextCompetence(), run_type: 'MENSAL', payment_date: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true);
    try {
      setRuns((await api.getPayrollRuns(year ? { year } : {})).data || []);
      setSelectedId(null);
    } catch (e) {
      toast.error('Erro ao carregar as folhas');
    } finally {
      setLoading(false);
    }
  };

  const selected = runs.find((r) => r.id === selectedId);
  const create = async () => {
    if (!newForm.competence) { toast.error('Informe a competência'); return; }
    setCreating(true);
    try {
      const r = await api.createPayrollRun({ ...newForm, payment_date: newForm.payment_date || null });
      toast.success(`Folha gerada com ${r.data.totals?.count || 0} contracheque(s)`);
      setNewOpen(false);
      onOpen(r.data.id);
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao gerar a folha'));
    } finally {
      setCreating(false);
    }
  };
  const remove = async () => {
    if (!selected || !(await confirm(`Excluir a ${label('run_types', selected.run_type).toLowerCase()} de ${competenceLabel(selected.competence)}?`))) return;
    try {
      await api.deletePayrollRun(selected.id);
      toast.success('Folha excluída');
      load();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao excluir'));
    }
  };

  const paid = runs.filter((r) => r.status === 'PAGA');
  const sum = (rows, f) => rows.reduce((a, r) => a + ((r.totals || {})[f] || 0), 0);

  return (
    <Layout>
      <div className="space-y-4" data-testid="payroll-page">
        <PageHeader icon={WalletCards} title="Folha de Pagamento"
          subtitle="Folha mensal e 13º salário com INSS, IRRF e FGTS calculados pelas tabelas vigentes"
          actions={<Button variant="outline" size="sm" onClick={onSettings} data-testid="payroll-settings-btn"><Percent className="w-4 h-4 mr-1.5" />Tabelas de cálculo</Button>} />

        <StatGrid>
          <StatCard label="Folhas no ano" value={runs.length} icon={Receipt} tone="blue" />
          <StatCard label="Líquido pago" value={formatMoney(sum(paid, 'net'))} icon={Banknote} tone="emerald" hint="folhas pagas no ano" />
          <StatCard label="FGTS das folhas" value={formatMoney(sum(runs, 'fgts'))} icon={Landmark} tone="slate" />
          <StatCard label="Em aberto" value={runs.filter((r) => r.status !== 'PAGA').length} icon={Lock} tone="amber" hint="abertas ou fechadas sem pagamento" />
        </StatGrid>

        <FilterCard hasFilters={year !== todayISO().slice(0, 4)} onClear={() => setYear(todayISO().slice(0, 4))}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Ano">
              <Input type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(e.target.value)} className="h-9 text-sm" data-testid="payroll-year" />
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Folhas"
          count={loading ? '...' : runs.length}
          toolbar={(
            <Toolbar selectedCount={selectedId ? 1 : 0} primary={<ToolbarPrimary icon={Plus} label="Gerar folha" onClick={() => { setNewForm({ competence: nextCompetence(), run_type: 'MENSAL', payment_date: '' }); setNewOpen(true); }} testId="payroll-new-btn" />}>
              <ToolbarButton icon={FolderOpen} label="Abrir folha" tone="primary" onClick={() => selected && onOpen(selected.id)} disabled={!selected} testId="payroll-open-btn" />
              <ToolbarButton icon={Printer} label="Contracheques (PDF)" tone="emerald" disabled={!selected}
                onClick={() => saveBlob(() => api.getPayslipsPDF({ run_id: selected.id }), `Contracheques_${selected.competence}.pdf`)} testId="payroll-print-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={remove} disabled={!selected || selected.status !== 'ABERTA'} testId="payroll-delete-btn" />
            </Toolbar>
          )}
        >
          {runs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0" />
                    <th>Competência</th>
                    <th>Tipo</th>
                    <th className="!text-center">Contracheques</th>
                    <th className="!text-right">Proventos</th>
                    <th className="!text-right">Líquido</th>
                    <th className="!text-right">FGTS</th>
                    <th>Situação</th>
                    <th>Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} onClick={() => setSelectedId(r.id === selectedId ? null : r.id)} onDoubleClick={() => onOpen(r.id)}
                      data-selected={r.id === selectedId} className="cursor-pointer" data-testid={`payroll-row-${r.competence}-${r.run_type}`}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={r.id === selectedId} onCheckedChange={() => setSelectedId(r.id === selectedId ? null : r.id)} />
                      </td>
                      <td className="cell-strong whitespace-nowrap">{competenceLabel(r.competence)}</td>
                      <td>{label('run_types', r.run_type)}</td>
                      <td className="text-center tabular-nums">{r.totals?.count || 0}</td>
                      <td className="text-right tabular-nums">{formatMoney(r.totals?.gross)}</td>
                      <td className="text-right tabular-nums cell-strong">{formatMoney(r.totals?.net)}</td>
                      <td className="text-right tabular-nums">{formatMoney(r.totals?.fgts)}</td>
                      <td><StatusPill tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</StatusPill></td>
                      <td className="tabular-nums">{r.paid_at ? fmtDate(r.paid_at) : r.payment_date ? <span className="text-slate-400">prev. {fmtDate(r.payment_date)}</span> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={WalletCards} loading={loading} title="Nenhuma folha no ano" hint={loading ? undefined : 'Gere a folha do mês pelo botão "Gerar folha"'} testId="payroll-empty" />
          )}
        </DataCard>
      </div>

      <Dialog open={newOpen} onOpenChange={(v) => !creating && setNewOpen(v)}>
        <DialogContent className="max-w-md" data-testid="payroll-new-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Gerar Folha</DialogTitle>
            <DialogDescription>Os contracheques são gerados para todos os contratos vigentes (exceto PJ), com os lançamentos fixos e as faltas das ocorrências.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1.5 block">Tipo *</Label>
              <Select value={newForm.run_type} onValueChange={(v) => setNewForm((p) => ({ ...p, run_type: v }))}>
                <SelectTrigger className="h-9 text-sm" data-testid="payroll-new-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {meta.run_types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500 mt-1" data-testid="payroll-new-type-hint">
                {newForm.run_type === 'ADIANTAMENTO'
                  ? `Paga ${meta.salary_advance_rate ?? 40}% do salário a quem tem "Recebe adiantamento quinzenal" no contrato, sem nenhum desconto (INSS, IRRF, vale-transporte e lançamentos ficam na folha mensal).`
                  : newForm.run_type === 'MENSAL'
                    ? `Salário do mês com todos os descontos. Para quem recebeu o adiantamento, os ${meta.salary_advance_rate ?? 40}% já pagos são descontados e o líquido é o saldo (cerca de ${100 - (meta.salary_advance_rate ?? 40)}%). Gere e feche o adiantamento antes.`
                    : '13º salário calculado pelos avos do ano.'}
              </p>
            </div>
            <div>
              <Label className="mb-1.5 block">Competência *</Label>
              <Input type="month" value={newForm.competence} onChange={(e) => setNewForm((p) => ({ ...p, competence: e.target.value }))} className="h-9 text-sm" data-testid="payroll-new-competence" />
            </div>
            <div>
              <Label className="mb-1.5 block">Data prevista de pagamento</Label>
              <Input type="date" value={newForm.payment_date} onChange={(e) => setNewForm((p) => ({ ...p, payment_date: e.target.value }))} className="h-9 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={creating}>Cancelar</Button>
            <Button onClick={create} disabled={creating} data-testid="payroll-new-confirm"><Plus className="w-4 h-4 mr-2" />{creating ? 'Gerando...' : 'Gerar folha'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}

function PayrollRunDetail({ runId, onBack }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const { meta, label } = useHRMeta();
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [payDate, setPayDate] = useState(todayISO());
  const [editing, setEditing] = useState(null);

  useEffect(() => { load(); }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true);
    try {
      setRun((await api.getPayrollRun(runId)).data);
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao carregar a folha'));
      onBack();
    } finally {
      setLoading(false);
    }
  };

  const slips = (run?.payslips || []).filter((p) => !search.trim() || (p.person_name || '').toLowerCase().includes(search.trim().toLowerCase()));
  const { pageItems, paginationProps } = usePagination(slips, { resetKey: search });
  const toggle = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => {
    const ids = pageItems.map((p) => p.id);
    const all = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });
  };
  const single = selectedIds.size === 1 ? run?.payslips.find((p) => selectedIds.has(p.id)) : null;
  const open = run?.status === 'ABERTA';

  const action = async (fn, success, message) => {
    if (message && !(await confirm(message))) return;
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      await load();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao atualizar a folha'));
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!payDate) { toast.error('Informe a data do pagamento'); return; }
    await action(() => api.payPayrollRun(runId, { payment_date: payDate }), 'Pagamento registrado');
    setPayOpen(false);
  };

  if (!run) {
    return <Layout><div className="space-y-4"><PageHeader icon={WalletCards} title="Folha de Pagamento" backTo={onBack} /><EmptyState icon={WalletCards} loading={loading} title="Carregando" /></div></Layout>;
  }

  const t = run.totals || {};
  const title = `${label('run_types', run.run_type)} · ${competenceLabel(run.competence)}`;

  return (
    <Layout>
      <div className="space-y-4" data-testid="payroll-detail-page">
        <PageHeader icon={WalletCards} title={title} backTo={onBack} backTestId="payroll-back"
          meta={<StatusPill tone={STATUS_TONES[run.status]}>{STATUS_LABELS[run.status]}</StatusPill>}
          subtitle={run.paid_at ? `Paga em ${fmtDate(run.paid_at)}` : run.payment_date ? `Pagamento previsto: ${fmtDate(run.payment_date)}` : undefined} />

        <StatGrid>
          <StatCard label="Contracheques" value={t.count || 0} icon={Users} tone="blue" />
          <StatCard label="Proventos" value={formatMoney(t.gross)} icon={Receipt} tone="slate" hint={`Descontos: ${formatMoney(t.deductions)}`} />
          <StatCard label={t.advance_paid ? 'Saldo a pagar (com descontos)' : run.run_type === 'ADIANTAMENTO' ? 'Adiantamento a pagar (sem descontos)' : 'Líquido a pagar'}
            value={formatMoney(t.net)} icon={Banknote} tone="emerald"
            hint={t.advance_paid ? `Adiantamento já pago: ${formatMoney(t.advance_paid)}` : undefined} />
          <StatCard label="FGTS (8%)" value={formatMoney(t.fgts)} icon={Landmark} tone="amber" hint={`INSS ${formatMoney(t.inss)} · IRRF ${formatMoney(t.irrf)}`} />
        </StatGrid>

        <FilterCard hasFilters={!!search} onClear={() => setSearch('')}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Funcionário" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="payroll-detail-search" />
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Contracheques"
          count={slips.length}
          footer={<TablePagination {...paginationProps} />}
          toolbar={(
            <Toolbar selectedCount={selectedIds.size}>
              <ToolbarButton icon={Pencil} label="Lançamentos do contracheque" tone="blue" onClick={() => single && setEditing(single)} disabled={!single} testId="payslip-edit-btn" />
              <ToolbarButton icon={Printer} label="Contracheques selecionados (PDF)" tone="emerald" disabled={!selectedIds.size}
                onClick={() => saveBlob(() => api.getPayslipsPDF({ ids: [...selectedIds].join(',') }), `Contracheques_${run.competence}.pdf`)} testId="payslip-print-selected-btn" />
              <ToolbarButton icon={Receipt} label="Todos os contracheques (PDF)" tone="primary"
                onClick={() => saveBlob(() => api.getPayslipsPDF({ run_id: run.id }), `Contracheques_${run.competence}.pdf`)} testId="payslip-print-all-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={RefreshCw} label="Recalcular (contratos, ocorrências e tabelas atuais)" tone="blue" disabled={!open || busy}
                onClick={() => action(() => api.recalculatePayrollRun(run.id), 'Folha recalculada')} testId="payroll-recalc-btn" />
              <ToolbarButton icon={Lock} label="Fechar folha" tone="primary" disabled={!open || busy}
                onClick={() => action(() => api.closePayrollRun(run.id), 'Folha fechada', 'Fechar a folha? Os contracheques ficam travados para edição.')} testId="payroll-close-btn" />
              <ToolbarButton icon={LockOpen} label="Reabrir folha" tone="amber" disabled={run.status !== 'FECHADA' || busy}
                onClick={() => action(() => api.reopenPayrollRun(run.id), 'Folha reaberta')} testId="payroll-reopen-btn" />
              <ToolbarButton icon={CheckCircle2} label="Registrar pagamento" tone="emerald" disabled={run.status !== 'FECHADA' || busy}
                onClick={() => { setPayDate(run.payment_date || todayISO()); setPayOpen(true); }} testId="payroll-pay-btn" />
              <ToolbarButton icon={RotateCcw} label="Estornar pagamento" tone="amber" disabled={run.status !== 'PAGA' || busy}
                onClick={() => action(() => api.unpayPayrollRun(run.id), 'Pagamento estornado', 'Estornar o pagamento desta folha?')} testId="payroll-unpay-btn" />
            </Toolbar>
          )}
        >
          {slips.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox checked={pageItems.length > 0 && pageItems.every((p) => selectedIds.has(p.id))} onCheckedChange={toggleAll} />
                    </th>
                    <th>Funcionário</th>
                    <th>Cargo</th>
                    <th className="!text-center">{['MENSAL', 'ADIANTAMENTO'].includes(run.run_type) ? 'Dias' : 'Avos'}</th>
                    <th className="!text-right">Salário base</th>
                    <th className="!text-right">Proventos</th>
                    <th className="!text-right">Descontos</th>
                    <th className="!text-right">Líquido</th>
                    <th className="!text-right">FGTS</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((p) => (
                    <tr key={p.id} onClick={() => toggle(p.id)} onDoubleClick={() => setEditing(p)} data-selected={selectedIds.has(p.id)} className="cursor-pointer"
                      data-testid={`payslip-row-${p.contract_number}`}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                      </td>
                      <td className="cell-strong">
                        {p.person_name}
                        {(p.inputs || []).length > 0 && <span className="ml-2 text-[11px] text-slate-400">{p.inputs.length} lançamento(s)</span>}
                      </td>
                      <td>{p.position_name || '-'}</td>
                      <td className="text-center tabular-nums">
                        {['MENSAL', 'ADIANTAMENTO'].includes(run.run_type) ? p.days_worked : `${p.months_13th}/12`}
                        {p.vacation_days > 0 && <span className="block text-[10px] text-blue-600">{p.vacation_days}d férias</span>}
                      </td>
                      <td className="text-right tabular-nums">{formatMoney(p.base_salary)}</td>
                      <td className="text-right tabular-nums">{formatMoney(p.totals?.gross)}</td>
                      <td className="text-right tabular-nums text-destructive">{formatMoney(p.totals?.deductions)}</td>
                      <td className="text-right tabular-nums cell-strong">{formatMoney(p.totals?.net)}</td>
                      <td className="text-right tabular-nums">{formatMoney(p.totals?.fgts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Users} title="Nenhum contracheque" hint={run.empty_reason || 'Cadastre contratos em Admissão e Contratos e clique em Recalcular'}
              testId="payroll-detail-empty" />
          )}
        </DataCard>
      </div>

      {editing && (
        <PayslipDialog slip={editing} run={run} events={meta.events} onClose={() => setEditing(null)}
          onSaved={async (updated) => { setEditing(updated); await load(); }} />
      )}

      <Dialog open={payOpen} onOpenChange={(v) => !busy && setPayOpen(v)}>
        <DialogContent className="max-w-sm" data-testid="payroll-pay-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Registrar Pagamento</DialogTitle>
            <DialogDescription>Líquido da folha: {formatMoney(t.net)}</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block">Data do pagamento *</Label>
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="h-9 text-sm" data-testid="payroll-pay-date" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={pay} disabled={busy} data-testid="payroll-pay-confirm"><CheckCircle2 className="w-4 h-4 mr-2" />Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}

function PayslipDialog({ slip, run, events, onClose, onSaved }) {
  const editable = run.status === 'ABERTA';
  const [inputs, setInputs] = useState(() => (slip.inputs || []).map((i) => ({ ...i, quantity: i.quantity ?? '', value: i.value ?? '', description: i.description || '' })));
  const [daysOverride, setDaysOverride] = useState(slip.days_override ?? '');
  const [observations, setObservations] = useState(slip.observations || '');
  const [saving, setSaving] = useState(false);
  const inputOf = (code) => events.find((e) => e.code === code)?.input;
  const update = (i, k, v) => setInputs((list) => list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const save = async () => {
    const bad = inputs.find((i) => !i.code || !(Number(inputOf(i.code) === 'VALUE' ? i.value : i.quantity) > 0));
    if (bad) { toast.error('Preencha o lançamento e a quantidade/valor de cada linha'); return; }
    setSaving(true);
    try {
      const r = await api.updatePayslip(slip.id, {
        inputs: inputs.map((i) => ({
          code: i.code, description: i.description || null,
          quantity: inputOf(i.code) === 'VALUE' ? null : Number(i.quantity),
          value: inputOf(i.code) === 'VALUE' ? Number(i.value) : null,
        })),
        days_worked: daysOverride === '' ? null : Number(daysOverride),
        observations: observations || null,
      });
      toast.success('Contracheque recalculado');
      onSaved(r.data);
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar o contracheque'));
    } finally {
      setSaving(false);
    }
  };

  const t = slip.totals || {};
  return (
    <Dialog open onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="payslip-dialog">
        <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
          <DialogTitle className="text-base">{slip.person_name}</DialogTitle>
          <DialogDescription>
            {slip.position_name || 'Sem cargo'} · salário {formatMoney(slip.base_salary)} · {competenceLabel(slip.competence)}
            {slip.absence_days > 0 && ` · ${slip.absence_days} falta(s) das ocorrências`}
            {slip.vacation_days > 0 && ` · ${slip.vacation_days} dia(s) de férias`}
          </DialogDescription>
        </DialogHeader>

        <table className="data-table">
          <thead><tr><th>Cód.</th><th>Descrição</th><th>Ref.</th><th className="!text-right">Vencimentos</th><th className="!text-right">Descontos</th></tr></thead>
          <tbody>
            {(slip.events || []).map((e, i) => (
              <tr key={i}>
                <td className="tabular-nums">{e.number}</td>
                <td>{e.label}{!e.auto && <span className="ml-1 text-[10px] text-blue-600">lançado</span>}</td>
                <td className="tabular-nums">{e.reference}</td>
                <td className="text-right tabular-nums">{e.kind === 'P' ? formatMoney(e.value) : ''}</td>
                <td className="text-right tabular-nums text-destructive">{e.kind === 'D' ? formatMoney(e.value) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Totais · líquido {formatMoney(t.net)}</td><td className="text-right tabular-nums">{formatMoney(t.gross)}</td><td className="text-right tabular-nums">{formatMoney(t.deductions)}</td></tr>
          </tfoot>
        </table>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
          <div className="rounded-md bg-muted p-2"><div className="text-slate-500">Base INSS</div><div className="font-semibold">{formatMoney(t.inss_base)}</div></div>
          <div className="rounded-md bg-muted p-2"><div className="text-slate-500">Base IRRF</div><div className="font-semibold">{formatMoney(t.irrf_base)}{t.irrf_simplified ? ' (simpl.)' : ''}</div></div>
          <div className="rounded-md bg-muted p-2"><div className="text-slate-500">Redução IR (Lei 15.270)</div><div className="font-semibold">{formatMoney(t.irrf_reduction)}</div></div>
          <div className="rounded-md bg-muted p-2"><div className="text-slate-500">FGTS ({fmtNumber(t.fgts_rate)}%)</div><div className="font-semibold">{formatMoney(t.fgts)}</div></div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Lançamentos do mês</p>
          {inputs.map((inp, i) => {
            const kind = inputOf(inp.code);
            return (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                <div className="col-span-2 sm:col-span-5">
                  <Select value={inp.code || undefined} onValueChange={(v) => update(i, 'code', v)} disabled={!editable}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {events.map((e) => <SelectItem key={e.code} value={e.code}>{e.number} - {e.label} ({e.kind === 'P' ? 'provento' : 'desconto'})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label className="mb-1 block text-xs">{kind === 'VALUE' ? 'Valor (R$)' : kind === 'DAYS' ? 'Dias' : 'Horas'}</Label>
                  <Input type="number" min="0" step="0.01" disabled={!editable} value={kind === 'VALUE' ? inp.value : inp.quantity}
                    onChange={(e) => update(i, kind === 'VALUE' ? 'value' : 'quantity', e.target.value)} className="h-9 text-sm text-right" />
                </div>
                <div className="sm:col-span-4">
                  <Label className="mb-1 block text-xs">Descrição</Label>
                  <Input disabled={!editable} value={inp.description} onChange={(e) => update(i, 'description', e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="sm:col-span-1 flex justify-end">
                  {editable && (
                    <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive" aria-label="Remover lançamento" title="Remover"
                      onClick={() => setInputs((list) => list.filter((_, j) => j !== i))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {editable && run.run_type !== 'ADIANTAMENTO' && (
            <Button variant="outline" size="sm" onClick={() => setInputs((list) => [...list, { code: '', quantity: '', value: '', description: '' }])} data-testid="payslip-add-input">
              <Plus className="w-4 h-4 mr-1" />Adicionar lançamento
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {['MENSAL', 'ADIANTAMENTO'].includes(run.run_type) && (
            <div>
              <Label className="mb-1.5 block">Dias pagos (0 a 30)</Label>
              <Input type="number" min="0" max="30" disabled={!editable} value={daysOverride} onChange={(e) => setDaysOverride(e.target.value)} className="h-9 text-sm" />
              <p className="text-[11px] text-slate-500 mt-1">Vazio: calculado ({slip.days_override == null ? slip.days_worked : 'admissão, férias e afastamentos'}).</p>
            </div>
          )}
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block">Observações (saem no contracheque)</Label>
            <Textarea disabled={!editable} value={observations} onChange={(e) => setObservations(e.target.value)} className="text-sm min-h-[60px]" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Fechar</Button>
          <Button variant="outline" onClick={() => saveBlob(() => api.getPayslipsPDF({ ids: slip.id }), `Contracheque_${slip.competence}_${slip.person_name}.pdf`)}>
            <Printer className="w-4 h-4 mr-2" />Contracheque
          </Button>
          {editable && (
            <Button onClick={save} disabled={saving} data-testid="payslip-save-btn"><Save className="w-4 h-4 mr-2" />{saving ? 'Calculando...' : 'Salvar e recalcular'}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
