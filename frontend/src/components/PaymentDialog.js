import { useEffect, useState } from 'react';
import { Field } from './FormKit';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/errors';
import { todayISO } from '../lib/dates';
import { PAYMENT_METHODS, formatDay, formatMoney, parseMoney, payableLabel, receivableLabel } from '../lib/payables';
import { toast } from 'sonner';

// Pagar (Contas a Pagar) e receber (títulos do Contas a Receber) são a mesma
// baixa: data, forma e, com um título só, juros e desconto.
const MODES = {
  pay: {
    submit: (data) => api.payPayables(data).then((r) => r.data.paid),
    title: (n) => (n === 1 ? 'Pagar conta' : `Pagar ${n} contas`),
    label: payableLabel, party: (p) => p.supplier_name,
    many: 'Todas recebem a mesma data e forma de pagamento.',
    date: 'Data do pagamento', method: 'Forma de pagamento', total: 'Valor pago', confirm: 'Confirmar pagamento',
    done: (n) => (n === 1 ? 'Conta paga' : `${n} contas pagas`),
    tooMuch: 'O desconto não pode ser maior que o valor da conta', failed: 'Erro ao registrar o pagamento',
  },
  receive: {
    submit: (data) => api.receiveReceivableTitles(data).then((r) => r.data.received),
    title: (n) => (n === 1 ? 'Receber título' : `Receber ${n} títulos`),
    // vindo do painel Contas a Receber, a linha já traz o "Nº 12 - 1/3" pronto
    label: (t) => t.number_label || receivableLabel(t), party: (t) => t.client_name,
    many: 'Todos recebem a mesma data e forma de recebimento.',
    date: 'Data do recebimento', method: 'Forma de recebimento', total: 'Valor recebido', confirm: 'Confirmar recebimento',
    done: (n) => (n === 1 ? 'Título recebido' : `${n} títulos recebidos`),
    tooMuch: 'O desconto não pode ser maior que o valor do título', failed: 'Erro ao registrar o recebimento',
  },
};

export default function PaymentDialog({ mode = 'pay', items, onOpenChange, onDone }) {
  const m = MODES[mode];
  const single = items.length === 1;
  const [form, setForm] = useState({ paid_date: todayISO(), payment_method: 'PIX', interest: '', discount: '', payment_notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (items.length) setForm({ paid_date: todayISO(), payment_method: 'PIX', interest: '', discount: '', payment_notes: '' });
  }, [items]);

  const amount = items.reduce((sum, p) => sum + (p.amount || 0), 0);
  const interest = single ? parseMoney(form.interest) || 0 : 0;
  const discount = single ? parseMoney(form.discount) || 0 : 0;
  const total = amount + interest - discount;

  const save = async () => {
    if (Number.isNaN(interest) || Number.isNaN(discount) || interest < 0 || discount < 0) {
      toast.error('Juros ou desconto inválido');
      return;
    }
    if (total <= 0) {
      toast.error(m.tooMuch);
      return;
    }
    setSaving(true);
    try {
      const count = await m.submit({
        ids: items.map((p) => p.id), paid_date: form.paid_date, payment_method: form.payment_method,
        interest, discount, payment_notes: form.payment_notes,
      });
      toast.success(m.done(count));
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(apiErrorMessage(error, m.failed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={items.length > 0} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.title(items.length)}</DialogTitle>
          <DialogDescription>
            {single ? `${m.label(items[0])} · ${m.party(items[0]) || ''} · vence ${formatDay(items[0].due_date)}` : m.many}
          </DialogDescription>
        </DialogHeader>
        <div className="form-dense grid grid-cols-2 gap-3">
          <Field label={m.date} required>
            <Input type="date" value={form.paid_date} max={todayISO()} onChange={(e) => setForm({ ...form, paid_date: e.target.value })} data-testid="pay-date" />
          </Field>
          <Field label={m.method} required>
            <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
              <SelectTrigger data-testid="pay-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PAYMENT_METHODS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {single && (
            <>
              <Field label="Juros / multa (R$)">
                <Input inputMode="decimal" value={form.interest} onChange={(e) => setForm({ ...form, interest: e.target.value })} data-testid="pay-interest" />
              </Field>
              <Field label="Desconto (R$)">
                <Input inputMode="decimal" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} data-testid="pay-discount" />
              </Field>
            </>
          )}
          <Field label="Observação" className="col-span-2">
            <Textarea rows={2} value={form.payment_notes} onChange={(e) => setForm({ ...form, payment_notes: e.target.value })} />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-md bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
          <span className="text-slate-500 dark:text-slate-400">{m.total}</span>
          <span className="font-semibold tabular-nums" data-testid="pay-total">{formatMoney(total)}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={save} disabled={saving} data-testid="pay-save-btn">{saving ? 'Salvando...' : m.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
