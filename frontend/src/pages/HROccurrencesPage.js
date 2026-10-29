import { useEffect, useRef, useState } from 'react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useConfirm } from '../hooks/useConfirm';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { api } from '../lib/api';
import { todayISO } from '../lib/dates';
import { ContractPicker, errorDetail, fmtDate, saveBlob, useContracts, useHRMeta } from '../components/HRKit';
import { toast } from 'sonner';
import { MessageSquareWarning, Plus, Pencil, Trash2, Save, FileSignature, Paperclip, X, Stethoscope, Ban, ShieldAlert } from 'lucide-react';

const TONES = {
  ADVERTENCIA: 'amber', SUSPENSAO: 'red', ATESTADO: 'blue', FALTA_JUSTIFICADA: 'slate', FALTA_INJUSTIFICADA: 'red',
  AFASTAMENTO_INSS: 'amber', ACIDENTE_TRABALHO: 'red', LICENCA_MATERNIDADE: 'blue', LICENCA_PATERNIDADE: 'blue', ELOGIO: 'emerald', OUTRO: 'slate',
};
const EMPTY = { contract_id: '', occurrence_type: 'ADVERTENCIA', start_date: todayISO(), end_date: '', days: '', cid: '', description: '', attachments: [] };

export default function HROccurrencesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const { meta, label } = useHRMeta();
  const { contracts } = useContracts(true);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const listKey = `${debouncedSearch}|${typeFilter}|${dateFrom}|${dateTo}`;
  const { pageItems, paginationProps } = usePagination(list, { resetKey: listKey });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { setSelectedIds(new Set()); load(); }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (typeFilter) params.occurrence_type = typeFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      setList((await api.getHROccurrences(params)).data || []);
    } catch (e) {
      toast.error('Erro ao carregar as ocorrências');
    } finally {
      setLoading(false);
    }
  };
  const reload = () => { setSelectedIds(new Set()); load(); };
  const toggle = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const single = selectedIds.size === 1 ? list.find((o) => selectedIds.has(o.id)) : null;
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => { setForm({ ...EMPTY, start_date: todayISO() }); setEditingId(null); setDialogOpen(true); };
  const openEdit = (o) => {
    setForm({ contract_id: o.contract_id, occurrence_type: o.occurrence_type, start_date: o.start_date, end_date: o.end_date || '',
      days: o.end_date ? '' : (o.days ?? ''), cid: o.cid || '', description: o.description || '', attachments: o.attachments || [] });
    setEditingId(o.id);
    setDialogOpen(true);
  };

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await api.uploadHRFile(file);
      setForm((f) => ({ ...f, attachments: [...f.attachments, r.data.url] }));
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao enviar o arquivo'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (!form.contract_id) { toast.error('Selecione o funcionário na lista'); return; }
    if (!form.start_date) { toast.error('Informe a data'); return; }
    setSaving(true);
    try {
      const payload = { ...form, end_date: form.end_date || null, days: form.end_date || form.days === '' ? null : Number(form.days),
        cid: form.cid || null, description: form.description || null };
      if (editingId) await api.updateHROccurrence(editingId, payload);
      else await api.createHROccurrence(payload);
      toast.success(editingId ? 'Ocorrência atualizada' : 'Ocorrência registrada');
      setDialogOpen(false);
      reload();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar a ocorrência'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!single || !(await confirm(`Excluir a ocorrência Nº ${single.occurrence_number} de ${single.person_name}?`))) return;
    try { await api.deleteHROccurrence(single.id); toast.success('Ocorrência excluída'); reload(); } catch (e) { toast.error(errorDetail(e, 'Erro ao excluir')); }
  };

  const count = (types) => list.filter((o) => types.includes(o.occurrence_type)).length;
  const hasFilters = !!(search || typeFilter || dateFrom || dateTo);
  const affectsPayroll = ['FALTA_INJUSTIFICADA', 'SUSPENSAO'].includes(form.occurrence_type);
  const isLeave = ['AFASTAMENTO_INSS', 'ACIDENTE_TRABALHO'].includes(form.occurrence_type);

  return (
    <Layout>
      <div className="space-y-4" data-testid="hr-occurrences-page">
        <PageHeader icon={MessageSquareWarning} title="Ocorrências"
          subtitle="Advertências, suspensões, atestados, faltas e afastamentos. Faltas injustificadas e suspensões descontam na folha" />

        <StatGrid>
          <StatCard label="Advertências" value={count(['ADVERTENCIA', 'SUSPENSAO'])} icon={ShieldAlert} tone="amber" hint="e suspensões, com os filtros" />
          <StatCard label="Atestados" value={count(['ATESTADO'])} icon={Stethoscope} tone="blue" />
          <StatCard label="Faltas injustificadas" value={count(['FALTA_INJUSTIFICADA'])} icon={Ban} tone="red" />
          <StatCard label="Afastamentos" value={count(['AFASTAMENTO_INSS', 'ACIDENTE_TRABALHO', 'LICENCA_MATERNIDADE', 'LICENCA_PATERNIDADE'])} icon={MessageSquareWarning} tone="slate" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setTypeFilter(''); setDateFrom(''); setDateTo(''); }}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Nome, descrição ou CID" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="hr-occurrences-search" />
            </FilterField>
            <FilterField label="Tipo">
              <Select value={typeFilter || '_all'} onValueChange={(v) => setTypeFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {meta.occurrence_types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Data - de">
              <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </FilterField>
            <FilterField label="até">
              <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Ocorrências"
          count={loading ? '...' : list.length}
          footer={<TablePagination {...paginationProps} />}
          toolbar={(
            <Toolbar selectedCount={selectedIds.size} primary={<ToolbarPrimary icon={Plus} label="Nova ocorrência" onClick={openCreate} testId="hr-occurrence-new-btn" />}>
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && openEdit(single)} disabled={!single} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={remove} disabled={!single} />
              <ToolbarDivider />
              <ToolbarButton icon={FileSignature} label="Termo de advertência/suspensão (PDF)" tone="primary"
                disabled={!single || !['ADVERTENCIA', 'SUSPENSAO'].includes(single.occurrence_type)}
                onClick={() => saveBlob(() => api.getHROccurrencePDF(single.id), `Termo_${single.person_name}.pdf`)} testId="hr-occurrence-pdf-btn" />
            </Toolbar>
          )}
        >
          {list.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0" />
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Funcionário</th>
                    <th>Tipo</th>
                    <th className="!text-center">Dias</th>
                    <th>Descrição</th>
                    <th className="!text-center">Anexos</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((o) => (
                    <tr key={o.id} onClick={() => toggle(o.id)} data-selected={selectedIds.has(o.id)} className="cursor-pointer" data-testid={`hr-occurrence-row-${o.occurrence_number}`}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}><Checkbox checked={selectedIds.has(o.id)} onCheckedChange={() => toggle(o.id)} /></td>
                      <td className="tabular-nums cell-strong">#{o.occurrence_number}</td>
                      <td className="tabular-nums whitespace-nowrap">{fmtDate(o.start_date)}{o.end_date && o.end_date !== o.start_date ? ` a ${fmtDate(o.end_date)}` : ''}</td>
                      <td className="cell-strong">{o.person_name}</td>
                      <td><StatusPill tone={TONES[o.occurrence_type] || 'slate'}>{label('occurrence_types', o.occurrence_type)}</StatusPill></td>
                      <td className="text-center tabular-nums">{o.days ?? '-'}</td>
                      <td><div className="max-w-[300px] truncate" title={o.description || ''}>{o.cid ? `CID ${o.cid} · ` : ''}{o.description || '-'}</div></td>
                      <td className="text-center" onClick={(e) => e.stopPropagation()}>
                        {(o.attachments || []).map((url, i) => (
                          <a key={url} href={api.getFileUrl(url)} target="_blank" rel="noreferrer" className="text-primary text-xs underline mr-1">{i + 1}</a>
                        ))}
                        {!(o.attachments || []).length && '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={MessageSquareWarning} loading={loading} title={hasFilters ? 'Nenhuma ocorrência encontrada' : 'Nenhuma ocorrência registrada'} />
          )}
        </DataCard>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(v) => !saving && setDialogOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="hr-occurrence-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="text-base">{editingId ? 'Editar Ocorrência' : 'Nova Ocorrência'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Funcionário *</Label>
              <ContractPicker contracts={contracts} value={form.contract_id} onChange={(id) => setField('contract_id', id)} disabled={!!editingId} testId="hr-occurrence-contract" />
            </div>
            <div>
              <Label className="mb-1.5 block">Tipo *</Label>
              <Select value={form.occurrence_type} onValueChange={(v) => setField('occurrence_type', v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="hr-occurrence-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {meta.occurrence_types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">Data *</Label>
              <Input type="date" value={form.start_date} onChange={(e) => setField('start_date', e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1.5 block">Até (data final)</Label>
              <Input type="date" value={form.end_date} onChange={(e) => setField('end_date', e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1.5 block">Dias</Label>
              <Input type="number" min="0" step="0.5" value={form.end_date ? '' : form.days} disabled={!!form.end_date}
                onChange={(e) => setField('days', e.target.value)} className="h-9 text-sm" />
              <p className="text-[11px] text-slate-500 mt-1">{form.end_date ? 'Calculado pelas datas.' : 'Sem data final: informe os dias.'}</p>
            </div>
            {['ATESTADO', 'AFASTAMENTO_INSS', 'ACIDENTE_TRABALHO'].includes(form.occurrence_type) && (
              <div>
                <Label className="mb-1.5 block">CID</Label>
                <Input value={form.cid} onChange={(e) => setField('cid', e.target.value)} className="h-9 text-sm" />
              </div>
            )}
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Descrição / motivo</Label>
              <Textarea value={form.description} onChange={(e) => setField('description', e.target.value)} className="text-sm min-h-[70px]" />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Anexos (atestado, documento assinado...)</Label>
              <div className="flex flex-wrap items-center gap-2">
                {form.attachments.map((url, i) => (
                  <span key={url} className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs">
                    <a href={api.getFileUrl(url)} target="_blank" rel="noreferrer" className="text-primary underline">Anexo {i + 1}</a>
                    <button type="button" aria-label="Remover anexo" onClick={() => setForm((f) => ({ ...f, attachments: f.attachments.filter((u) => u !== url) }))}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Paperclip className="w-4 h-4 mr-1" />{uploading ? 'Enviando...' : 'Anexar arquivo'}
                </Button>
              </div>
            </div>
          </div>
          {affectsPayroll && <p className="text-[12px] text-amber-600">Os dias desta ocorrência serão descontados na folha do mês.</p>}
          {isLeave && <p className="text-[12px] text-amber-600">A empresa paga os 15 primeiros dias; a partir do 16º o salário sai da folha (benefício do INSS).</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving || uploading} data-testid="hr-occurrence-save-btn"><Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
