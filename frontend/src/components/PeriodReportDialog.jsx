import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Field } from './FormKit';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { todayISO } from '../lib/dates';
import { toast } from 'sonner';
import { FileSpreadsheet, Loader2, Printer } from 'lucide-react';

// Primeiro e último dia do mês corrente, 'YYYY-MM-DD'
function currentMonth() {
  const today = todayISO();
  const [y, m] = today.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${today.slice(0, 7)}-01`, `${today.slice(0, 7)}-${String(last).padStart(2, '0')}`];
}

async function saveBlob(request, params, filename) {
  const response = await request(params);
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * Relatório de conferência de um período (Diárias, Prestação de Contas...):
 * período (padrão: mês atual), situação, filtros de texto e opções, prévia
 * dos totais e download em PDF/Excel com os mesmos filtros.
 * - `statuses`: [{ value, label }] - o primeiro é o padrão ('' = sem filtro);
 *   vai no parâmetro `statusParam`, com o rótulo `statusLabel`
 * - `textFilters`: [{ key, label }]; `checkboxes`: [{ key, label }]
 * - `load(params)`: busca a prévia; `summarize(data)`: [[rótulo, valor], ...]
 */
export default function PeriodReportDialog({
  open, onOpenChange, title, description, periodLabel = 'Período', statuses = [], textFilters = [], checkboxes = [],
  load, summarize, downloadPdf, downloadExcel, filename, statusParam = 'status', statusLabel = 'Situação',
}) {
  const [[dateFrom, dateTo], setPeriod] = useState(currentMonth);
  const [status, setStatus] = useState(statuses[0]?.value ?? '');
  const [texts, setTexts] = useState({});
  const [flags, setFlags] = useState({});
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState('');
  const debouncedTexts = useDebouncedValue(texts);

  const params = () => {
    const p = {};
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (status) p[statusParam] = status;
    Object.entries(debouncedTexts).forEach(([k, v]) => { if (v && v.trim()) p[k] = v.trim(); });
    Object.entries(flags).forEach(([k, v]) => { if (v) p[k] = true; });
    return p;
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSummary(null);
    load(params())
      .then((res) => { if (!cancelled) setSummary(summarize(res.data)); })
      .catch((error) => { if (!cancelled) toast.error(error.response?.data?.detail || 'Erro ao carregar o relatório'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dateFrom, dateTo, status, debouncedTexts, flags]);

  const download = async (kind) => {
    setBusy(kind);
    try {
      const ext = kind === 'pdf' ? 'pdf' : 'xlsx';
      await saveBlob(kind === 'pdf' ? downloadPdf : downloadExcel, params(), `${filename}_${dateFrom || 'inicio'}_${dateTo || 'hoje'}.${ext}`);
    } catch (error) {
      toast.error('Erro ao gerar o arquivo');
    } finally {
      setBusy('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`${periodLabel} - de`}>
            <Input type="date" className="h-9" value={dateFrom} onChange={(e) => setPeriod([e.target.value, dateTo])} data-testid="period-report-from" />
          </Field>
          <Field label="até">
            <Input type="date" className="h-9" value={dateTo} onChange={(e) => setPeriod([dateFrom, e.target.value])} data-testid="period-report-to" />
          </Field>
          {statuses.length > 0 && (
            <Field label={statusLabel}>
              <Select value={status || 'ALL'} onValueChange={(v) => setStatus(v === 'ALL' ? '' : v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => <SelectItem key={s.value || 'ALL'} value={s.value || 'ALL'}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          {textFilters.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input className="h-9" value={texts[f.key] || ''} onChange={(e) => setTexts((prev) => ({ ...prev, [f.key]: e.target.value }))} />
            </Field>
          ))}
          {checkboxes.map((c) => (
            <label key={c.key} className="col-span-2 flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={!!flags[c.key]} onCheckedChange={(v) => setFlags((prev) => ({ ...prev, [c.key]: !!v }))} />
              {c.label}
            </label>
          ))}
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 min-h-[72px]" data-testid="period-report-summary">
          {summary ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {summary.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Calculando...</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button variant="outline" onClick={() => download('excel')} disabled={!!busy} data-testid="period-report-excel">
            <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel
          </Button>
          <Button onClick={() => download('pdf')} disabled={!!busy} data-testid="period-report-pdf">
            <Printer className="w-4 h-4 mr-1.5" /> PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
