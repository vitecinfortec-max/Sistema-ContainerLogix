import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import { PageSkeleton, StatusPill } from '../components/DataPage';
import { Field, FormSection, FormActions } from '../components/FormKit';
import { Autocomplete } from '../components/Autocomplete';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useConfirm } from '../hooks/useConfirm';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { todayISO } from '../lib/dates';
import {
  PAYABLE_STATUS, PAYMENT_METHODS, RECURRENCE, buildInstallments, formatDay, formatMoney, parseMoney, payableLabel, payableStatus,
} from '../lib/payables';
import { toast } from 'sonner';
import { Wallet, FileText, CalendarDays, Paperclip, Upload, Trash2, Download, Plus, Lock } from 'lucide-react';

const MAX_ATTACHMENTS = 5; // mesmo limite do servidor (routers/payables.py)
const ATTACH_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';

const emptyForm = () => ({
  supplier_id: '', supplier_name: '', description: '', document_number: '', issue_date: todayISO(),
  account_id: '', cost_center_id: '', notes: '',
  // só no lançamento novo
  recurrence: 'UNICA', amount: '', count: '2', first_due: todayISO(),
  // só na edição (uma parcela)
  due_date: '',
});

// Nova conta (/accounts-payable/new) e edição de uma parcela (/accounts-payable/:id/edit)
export default function AccountsPayableFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const backToList = () => navigate('/accounts-payable');
  const { confirm, ConfirmDialog } = useConfirm();
  const fileRef = useRef(null);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [record, setRecord] = useState(null); // a parcela carregada (edição)
  const [installments, setInstallments] = useState([]); // lançamento novo: parcelas geradas (editáveis)
  const [staged, setStaged] = useState([]); // anexos escolhidos antes de salvar (vão para a 1ª parcela)
  const [attachBusy, setAttachBusy] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [centers, setCenters] = useState([]);

  useEffect(() => {
    api.getSuppliers().then((r) => setSuppliers(Array.isArray(r.data) ? r.data : (r.data.items || []))).catch(() => setSuppliers([]));
    api.getChartAccounts().then((r) => setAccounts(r.data || [])).catch(() => {});
    api.getCostCenters().then((r) => setCenters(r.data || [])).catch(() => {});
    if (!isEdit) return;
    api.getPayable(id)
      .then(({ data }) => {
        setRecord(data);
        setForm({
          ...emptyForm(),
          supplier_id: data.supplier_id || '', supplier_name: data.supplier_name || '', description: data.description,
          document_number: data.document_number || '', issue_date: data.issue_date, account_id: data.account_id || '',
          cost_center_id: data.cost_center_id || '', notes: data.notes || '', due_date: data.due_date,
          amount: String(data.amount).replace('.', ','),
        });
      })
      .catch((error) => {
        toast.error(apiErrorMessage(error, 'Erro ao carregar a conta'));
        backToList();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const readOnly = isEdit && record && record.status !== 'ABERTO';

  // Lançamento novo: as parcelas saem do tipo, valor, quantidade e 1º vencimento
  const generated = useMemo(() => (isEdit ? [] : buildInstallments({
    recurrence: form.recurrence, count: form.count, firstDue: form.first_due, amount: parseMoney(form.amount),
  })), [isEdit, form.recurrence, form.count, form.first_due, form.amount]);
  useEffect(() => { if (!isEdit) setInstallments(generated); }, [isEdit, generated]);

  const changeInstallment = (index, field, value) => setInstallments((prev) => prev.map((inst, i) => (i === index ? { ...inst, [field]: value } : inst)));
  const installmentsTotal = installments.reduce((sum, i) => sum + (parseMoney(i.amount) || 0), 0);

  // Contas de receita não entram em Contas a Pagar; a que já está na conta continua aparecendo
  const accountOptions = accounts.filter((a) => (a.kind === 'DESPESA' && a.active) || a.id === form.account_id);
  const centerOptions = centers.filter((c) => c.active || c.id === form.cost_center_id);

  const handleSubmit = async () => {
    if (!form.supplier_name.trim() || !form.description.trim() || !form.issue_date) {
      toast.error('Preencha o fornecedor, a descrição e a data do documento');
      return;
    }
    const common = {
      supplier_id: form.supplier_id || null, supplier_name: form.supplier_name, description: form.description,
      document_number: form.document_number, issue_date: form.issue_date,
      account_id: form.account_id || null, cost_center_id: form.cost_center_id || null, notes: form.notes,
    };
    setSaving(true);
    try {
      if (isEdit) {
        const amount = parseMoney(form.amount);
        if (!form.due_date || !(amount > 0)) {
          toast.error('Informe o vencimento e o valor');
          return;
        }
        await api.updatePayable(id, { ...common, due_date: form.due_date, amount });
        toast.success('Conta atualizada');
      } else {
        const list = installments.map((i) => ({ due_date: i.due_date, amount: parseMoney(i.amount) }));
        if (list.length === 0 || list.some((i) => !i.due_date || !(i.amount > 0))) {
          toast.error('Informe o valor e o vencimento das parcelas');
          return;
        }
        const { data } = await api.createPayable({ ...common, recurrence: form.recurrence, installments: list });
        toast.success(data.length > 1 ? `Conta Nº ${data[0].payable_number} lançada em ${data.length} parcelas` : `Conta Nº ${data[0].payable_number} lançada`);
        // Os anexos escolhidos vão para a 1ª parcela
        const results = await Promise.allSettled(staged.map((file) => api.uploadPayableAttachment(data[0].id, file)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) toast.error(`${failed} anexo(s) não foram enviados. Abra a conta e envie de novo.`);
      }
      backToList();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao salvar a conta'));
    } finally {
      setSaving(false);
    }
  };

  const attachments = isEdit ? record?.attachments || [] : staged.map((file, i) => ({ id: `staged-${i}`, name: file.name, file }));

  const addAttachment = async (file) => {
    if (!file) return;
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.error(`No máximo ${MAX_ATTACHMENTS} anexos por conta`);
      return;
    }
    if (!isEdit) {
      setStaged((prev) => [...prev, file]);
      return;
    }
    setAttachBusy(true);
    try {
      const { data } = await api.uploadPayableAttachment(id, file);
      setRecord(data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao enviar o anexo'));
    } finally {
      setAttachBusy(false);
    }
  };

  const removeAttachment = async (attachment) => {
    if (attachment.file) {
      setStaged((prev) => prev.filter((f) => f !== attachment.file));
      return;
    }
    if (!(await confirm(`Remover o anexo "${attachment.name}"?`))) return;
    setAttachBusy(true);
    try {
      const { data } = await api.deletePayableAttachment(id, attachment.id);
      setRecord(data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Erro ao remover o anexo'));
    } finally {
      setAttachBusy(false);
    }
  };

  const downloadAttachment = (attachment) => api.downloadFile(attachment.url, attachment.name.replace(/\.[a-z0-9]+$/i, ''))
    .catch(() => toast.error('Erro ao baixar o anexo'));

  const status = record ? payableStatus(record) : null;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4" data-testid="accounts-payable-form-page">
        <PageHeader
          backTo={backToList}
          icon={Wallet}
          title={isEdit ? `Conta a pagar ${record ? payableLabel(record) : ''}` : 'Nova conta a pagar'}
          subtitle={isEdit ? 'Cada parcela é alterada à parte; paga ou cancelada fica só para consulta' : 'Conta única, parcelada (divide o total) ou recorrente (repete o valor todo mês)'}
          actions={status && <StatusPill tone={PAYABLE_STATUS[status].tone}>{PAYABLE_STATUS[status].label}</StatusPill>}
        />

        {loading ? (
          <PageSkeleton />
        ) : (
          <div className="space-y-4">
            {readOnly && (
              <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" data-testid="payable-read-only">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {record.status === 'PAGO'
                    ? `Paga em ${formatDay(record.paid_date)} · ${formatMoney(record.paid_amount)} · ${PAYMENT_METHODS[record.payment_method] || record.payment_method}${record.interest ? ` · juros ${formatMoney(record.interest)}` : ''}${record.discount ? ` · desconto ${formatMoney(record.discount)}` : ''}. Para alterar, estorne o pagamento na lista.`
                    : 'Conta cancelada. Para alterar, reative na lista.'}
                </span>
              </div>
            )}
            {record?.origin === 'NFE' && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Gerada pela importação da NF-e {record.document_number} em Entradas de Estoque.</p>
            )}

            <fieldset disabled={readOnly} className="space-y-4">
              <FormSection title="Conta" icon={FileText}>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Field label="Fornecedor" required className="col-span-2" hint="Escolha do cadastro ou digite só o nome.">
                    <Autocomplete
                      value={form.supplier_name}
                      onChange={(v) => setForm((prev) => ({ ...prev, supplier_name: v, supplier_id: '' }))}
                      onSelect={(s) => setForm((prev) => ({ ...prev, supplier_name: s.name, supplier_id: s.id }))}
                      options={suppliers}
                      displayField="name"
                      testId="payable-supplier"
                    />
                  </Field>
                  <Field label="Nº do documento" hint="NF, boleto, contrato...">
                    <Input value={form.document_number} onChange={(e) => onChange('document_number', e.target.value)} data-testid="payable-document" />
                  </Field>
                  <Field label="Data do documento" required>
                    <Input type="date" value={form.issue_date} onChange={(e) => onChange('issue_date', e.target.value)} data-testid="payable-issue-date" />
                  </Field>
                  <Field label="Descrição" required className="col-span-2">
                    <Input value={form.description} onChange={(e) => onChange('description', e.target.value)} data-testid="payable-description" />
                  </Field>
                  <Field label="Plano de contas">
                    <Select value={form.account_id || 'NONE'} onValueChange={(v) => onChange('account_id', v === 'NONE' ? '' : v)}>
                      <SelectTrigger data-testid="payable-account"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Sem conta</SelectItem>
                        {accountOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} {a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Centro de custo">
                    <Select value={form.cost_center_id || 'NONE'} onValueChange={(v) => onChange('cost_center_id', v === 'NONE' ? '' : v)}>
                      <SelectTrigger data-testid="payable-center"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Sem centro de custo</SelectItem>
                        {centerOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field label="Observações">
                  <Textarea rows={2} value={form.notes} onChange={(e) => onChange('notes', e.target.value)} />
                </Field>
              </FormSection>

              <FormSection title={isEdit ? 'Vencimento e valor' : 'Parcelas'} icon={CalendarDays}>
                {isEdit ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <Field label="Vencimento" required>
                        <Input type="date" value={form.due_date} onChange={(e) => onChange('due_date', e.target.value)} data-testid="payable-due-date" />
                      </Field>
                      <Field label="Valor (R$)" required>
                        <Input inputMode="decimal" value={form.amount} onChange={(e) => onChange('amount', e.target.value)} data-testid="payable-amount" />
                      </Field>
                    </div>
                    {record?.group?.length > 1 && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Parcelas do lançamento Nº {record.payable_number}</p>
                        <div className="flex flex-wrap gap-2">
                          {record.group.map((g) => (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => g.id !== record.id && navigate(`/accounts-payable/${g.id}/edit`)}
                              className={`rounded-md border px-2.5 py-1.5 text-left text-xs tabular-nums ${g.id === record.id ? 'border-primary bg-primary/10' : 'border-slate-200 dark:border-slate-700 hover:border-primary/60'}`}
                            >
                              <span className="font-semibold">{g.installment}/{record.installments_total}</span> · {formatDay(g.due_date)} · {formatMoney(g.amount)}
                              <span className="block text-slate-500 dark:text-slate-400">{g.status === 'PAGO' ? `paga ${formatDay(g.paid_date)}` : g.status === 'CANCELADO' ? 'cancelada' : 'em aberto'}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <Field label="Tipo">
                        <Select value={form.recurrence} onValueChange={(v) => onChange('recurrence', v)}>
                          <SelectTrigger data-testid="payable-recurrence"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(RECURRENCE).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label={form.recurrence === 'PARCELADA' ? 'Valor total (R$)' : form.recurrence === 'RECORRENTE' ? 'Valor por mês (R$)' : 'Valor (R$)'} required>
                        <Input inputMode="decimal" value={form.amount} onChange={(e) => onChange('amount', e.target.value)} data-testid="payable-amount" />
                      </Field>
                      {form.recurrence !== 'UNICA' && (
                        <Field label={form.recurrence === 'PARCELADA' ? 'Nº de parcelas' : 'Nº de meses'} required>
                          <Input inputMode="numeric" value={form.count} onChange={(e) => onChange('count', e.target.value.replace(/\D/g, '').slice(0, 3))} data-testid="payable-count" />
                        </Field>
                      )}
                      <Field label={form.recurrence === 'UNICA' ? 'Vencimento' : '1º vencimento'} required>
                        <Input type="date" value={form.first_due} onChange={(e) => onChange('first_due', e.target.value)} data-testid="payable-first-due" />
                      </Field>
                    </div>
                    {installments.length > 1 && (
                      <>
                        <p className="text-xs text-slate-500 dark:text-slate-400">As parcelas vencem todo mês no mesmo dia. Ajuste uma data ou valor se precisar.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {installments.map((inst, i) => (
                            <div key={i} className="flex items-center gap-2" data-testid={`payable-installment-${i}`}>
                              <span className="w-12 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{i + 1}/{installments.length}</span>
                              <Input type="date" value={inst.due_date} onChange={(e) => changeInstallment(i, 'due_date', e.target.value)} aria-label={`Vencimento da parcela ${i + 1}`} />
                              <Input inputMode="decimal" value={inst.amount} onChange={(e) => changeInstallment(i, 'amount', e.target.value)} className="w-28" aria-label={`Valor da parcela ${i + 1}`} />
                            </div>
                          ))}
                        </div>
                        <p className="text-right text-xs text-slate-500 dark:text-slate-400">
                          Total: <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{formatMoney(installmentsTotal)}</span>
                        </p>
                      </>
                    )}
                  </div>
                )}
              </FormSection>
            </fieldset>

            <FormSection
              title={`Anexos (${attachments.length}/${MAX_ATTACHMENTS})`}
              icon={Paperclip}
              actions={(
                <>
                  <input ref={fileRef} type="file" accept={ATTACH_ACCEPT} className="hidden"
                    onChange={(e) => { addAttachment(e.target.files?.[0]); e.target.value = ''; }} data-testid="payable-attachment-input" />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}
                    disabled={attachBusy || saving || attachments.length >= MAX_ATTACHMENTS} data-testid="payable-attach-btn">
                    {attachments.length ? <Plus className="w-4 h-4 mr-1" /> : <Upload className="w-4 h-4 mr-1" />} Anexar boleto ou nota
                  </Button>
                </>
              )}
            >
              {attachments.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">PDF ou foto do boleto, da nota ou do recibo{isEdit ? '' : '. No lançamento parcelado, os anexos ficam na 1ª parcela'}.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
                      <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="flex-1 truncate" title={a.name}>{a.name}</span>
                      {!a.file && (
                        <Button type="button" variant="ghost" size="icon" onClick={() => downloadAttachment(a)} aria-label={`Baixar ${a.name}`} title="Baixar">
                          <Download className="w-4 h-4" />
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeAttachment(a)} disabled={attachBusy} aria-label={`Remover ${a.name}`} title="Remover">
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </FormSection>

            <FormActions sticky>
              <Button type="button" variant="outline" onClick={backToList}>{readOnly ? 'Voltar' : 'Cancelar'}</Button>
              {!readOnly && (
                <Button type="button" onClick={handleSubmit} disabled={saving || attachBusy} data-testid="payable-save-btn">
                  {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Lançar conta'}
                </Button>
              )}
            </FormActions>
          </div>
        )}
      </div>
      <ConfirmDialog />
    </Layout>
  );
}
