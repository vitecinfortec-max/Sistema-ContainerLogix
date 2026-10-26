import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { FormSection, FormActions } from '../components/FormKit';
import { EmptyState } from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useConfirm } from '../hooks/useConfirm';
import { api } from '../lib/api';
import { errorDetail, fmtDate } from '../components/HRKit';
import { toast } from 'sonner';
import { Percent, Save, RotateCcw, Plus, Trash2 } from 'lucide-react';

const SIMPLE_FIELDS = [
  ['Geral', [
    ['valid_from', 'Vigência a partir de', 'date'],
    ['min_wage', 'Salário mínimo (R$)'],
    ['monthly_hours', 'Jornada mensal (horas, divisor da hora)'],
    ['night_bonus_rate', 'Adicional noturno (%)'],
    ['vt_rate', 'Desconto do vale-transporte (%)'],
    ['salary_advance_rate', 'Adiantamento quinzenal (% do salário)'],
  ]],
  ['IRRF - deduções e redução (Lei 15.270/2025)', [
    ['irrf_dependent_deduction', 'Dedução por dependente (R$)'],
    ['irrf_simplified_discount', 'Desconto simplificado mensal (R$)'],
    ['irrf_reduction_full_up_to', 'Isenção total até (R$)'],
    ['irrf_reduction_full_max', 'Redução máxima na faixa isenta (R$)'],
    ['irrf_reduction_partial_up_to', 'Redução parcial até (R$)'],
    ['irrf_reduction_partial_a', 'Redução parcial: valor fixo (R$)'],
    ['irrf_reduction_partial_b', 'Redução parcial: fator do rendimento'],
  ]],
  ['FGTS e salário-família', [
    ['fgts_rate', 'FGTS (%)'],
    ['fgts_apprentice_rate', 'FGTS aprendiz (%)'],
    ['family_allowance_limit', 'Salário-família: remuneração até (R$)'],
    ['family_allowance_value', 'Salário-família: valor por filho (R$)'],
  ]],
  ['Encargos da empresa (custo da folha) e banco de horas', [
    ['employer_inss_rate', 'INSS patronal (%)'],
    ['rat_rate', 'RAT/GILRAT ajustado pelo FAP (%)'],
    ['third_party_rate', 'Terceiros - Sistema S, salário-educação (%)'],
    ['time_bank_months', 'Banco de horas: prazo para compensar (meses)'],
  ], 'Optante do Simples Nacional (anexos I a III e V): coloque 0 nos três encargos. O banco de horas vence em 6 meses no acordo individual e em até 12 no coletivo.'],
];

export default function PayrollSettingsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      const r = await api.getPayrollSettings();
      setData(r.data);
      setForm(JSON.parse(JSON.stringify(r.data.settings)));
    } catch (e) {
      toast.error('Erro ao carregar as tabelas');
    }
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setBracket = (table, i, k, v) => setForm((f) => ({ ...f, [table]: f[table].map((b, j) => (j === i ? { ...b, [k]: v } : b)) }));

  const save = async () => {
    setSaving(true);
    try {
      const num = (v) => (v === '' || v === null ? null : Number(v));
      const payload = { ...form };
      SIMPLE_FIELDS.forEach(([, fields]) => fields.forEach(([k, , type]) => { if (type !== 'date') payload[k] = num(form[k]); }));
      payload.inss_brackets = form.inss_brackets.map((b) => ({ up_to: num(b.up_to), rate: num(b.rate) }));
      payload.irrf_brackets = form.irrf_brackets.map((b) => ({ up_to: num(b.up_to), rate: num(b.rate), deduction: num(b.deduction) || 0 }));
      const r = await api.updatePayrollSettings(payload);
      setData(r.data);
      setForm(JSON.parse(JSON.stringify(r.data.settings)));
      toast.success('Tabelas atualizadas. Folhas abertas precisam ser recalculadas.');
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar as tabelas'));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!(await confirm('Voltar para as tabelas padrão de 2026 que vêm com o sistema?'))) return;
    try {
      const r = await api.resetPayrollSettings();
      setData(r.data);
      setForm(JSON.parse(JSON.stringify(r.data.settings)));
      toast.success('Tabelas padrão restauradas');
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao restaurar'));
    }
  };

  if (!form) {
    return <Layout><div className="space-y-4"><PageHeader icon={Percent} title="Tabelas de Cálculo" backTo="/rh/folha" /><EmptyState icon={Percent} loading title="Carregando" /></div></Layout>;
  }

  return (
    <Layout>
      <div className="space-y-4" data-testid="payroll-settings-page">
        <PageHeader icon={Percent} title="Tabelas de Cálculo" backTo="/rh/folha"
          subtitle={data?.is_default ? 'Tabelas padrão de 2026 (INSS: Portaria MPS/MF 13/2026; IRRF: Lei 15.270/2025)' : `Atualizadas em ${fmtDate(data?.updated_at)} por ${data?.updated_by_name || '-'}`} />

        <FormSection title="INSS - faixas progressivas">
          <BracketTable rows={form.inss_brackets} onChange={(i, k, v) => setBracket('inss_brackets', i, k, v)}
            onRemove={(i) => setForm((f) => ({ ...f, inss_brackets: f.inss_brackets.filter((_, j) => j !== i) }))}
            onAdd={() => setForm((f) => ({ ...f, inss_brackets: [...f.inss_brackets, { up_to: '', rate: '' }] }))}
            hint="O último limite é o teto do INSS." />
        </FormSection>

        <FormSection title="IRRF - tabela mensal">
          <BracketTable rows={form.irrf_brackets} withDeduction onChange={(i, k, v) => setBracket('irrf_brackets', i, k, v)}
            onRemove={(i) => setForm((f) => ({ ...f, irrf_brackets: f.irrf_brackets.filter((_, j) => j !== i) }))}
            onAdd={() => setForm((f) => ({ ...f, irrf_brackets: [...f.irrf_brackets.slice(0, -1), { up_to: '', rate: '', deduction: '' }, f.irrf_brackets[f.irrf_brackets.length - 1]] }))}
            hint="A última faixa não tem limite (deixe em branco)." />
        </FormSection>

        {SIMPLE_FIELDS.map(([title, fields, hint]) => (
          <FormSection key={title} title={title}>
            {hint && <p className="text-[12px] text-slate-500 mb-3">{hint}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {fields.map(([k, lbl, type]) => (
                <div key={k}>
                  <Label className="mb-1.5 block">{lbl}</Label>
                  <Input type={type || 'number'} step="any" value={form[k] ?? ''} onChange={(e) => setField(k, e.target.value)} className="h-9 text-sm" data-testid={`payroll-setting-${k}`} />
                </div>
              ))}
            </div>
          </FormSection>
        ))}

        <FormActions>
          <Button variant="outline" onClick={reset}><RotateCcw className="w-4 h-4 mr-2" />Restaurar padrão 2026</Button>
          <Button onClick={save} disabled={saving} data-testid="payroll-settings-save"><Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Salvar tabelas'}</Button>
        </FormActions>
      </div>
      <ConfirmDialog />
    </Layout>
  );
}

function BracketTable({ rows, onChange, onRemove, onAdd, withDeduction = false, hint }) {
  return (
    <div className="space-y-2">
      <table className="data-table">
        <thead>
          <tr>
            <th>Faixa</th>
            <th>Até (R$)</th>
            <th>Alíquota (%)</th>
            {withDeduction && <th>Parcela a deduzir (R$)</th>}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((b, i) => (
            <tr key={i}>
              <td className="tabular-nums">{i + 1}ª</td>
              <td><Input type="number" step="0.01" value={b.up_to ?? ''} onChange={(e) => onChange(i, 'up_to', e.target.value)} className="h-8 text-sm" /></td>
              <td><Input type="number" step="0.01" value={b.rate ?? ''} onChange={(e) => onChange(i, 'rate', e.target.value)} className="h-8 text-sm" /></td>
              {withDeduction && <td><Input type="number" step="0.01" value={b.deduction ?? ''} onChange={(e) => onChange(i, 'deduction', e.target.value)} className="h-8 text-sm" /></td>}
              <td>
                {rows.length > 1 && (
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" aria-label="Remover faixa" title="Remover" onClick={() => onRemove(i)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">{hint}</span>
        <Button variant="outline" size="sm" onClick={onAdd}><Plus className="w-4 h-4 mr-1" />Adicionar faixa</Button>
      </div>
    </div>
  );
}
