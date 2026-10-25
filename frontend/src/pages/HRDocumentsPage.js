import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
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
import { ContractPicker, errorDetail, fmtDate, useContracts, useHRMeta } from '../components/HRKit';
import { toast } from 'sonner';
import { FileBadge, Plus, Pencil, Trash2, Save, Paperclip, X, AlertTriangle, Clock, CheckCircle2, ExternalLink } from 'lucide-react';

const STATUS_LABELS = { VENCIDO: 'Vencido', A_VENCER: 'Vence em até 30 dias', VALIDO: 'Válido', SEM_VALIDADE: 'Sem validade' };
const STATUS_TONES = { VENCIDO: 'red', A_VENCER: 'amber', VALIDO: 'emerald', SEM_VALIDADE: 'slate' };
const EMPTY = { contract_id: '', doc_type: 'ASO_PERIODICO', description: '', issue_date: todayISO(), expiry_date: '', file_url: '', observations: '' };

export default function HRDocumentsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const { meta, label } = useHRMeta();
  const { contracts } = useContracts();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const listKey = `${debouncedSearch}|${typeFilter}|${statusFilter}`;
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
      if (typeFilter) params.doc_type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      setList((await api.getHRDocuments(params)).data || []);
    } catch (e) {
      toast.error('Erro ao carregar os documentos');
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
  const single = selectedIds.size === 1 ? list.find((d) => selectedIds.has(d.id)) : null;
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => { setForm({ ...EMPTY, issue_date: todayISO() }); setEditingId(null); setDialogOpen(true); };
  const openEdit = (d) => {
    setForm({ contract_id: d.contract_id, doc_type: d.doc_type, description: d.description || '', issue_date: d.issue_date || '',
      expiry_date: d.expiry_date || '', file_url: d.file_url || '', observations: d.observations || '' });
    setEditingId(d.id);
    setDialogOpen(true);
  };

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await api.uploadHRFile(file);
      setField('file_url', r.data.url);
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao enviar o arquivo'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (!form.contract_id) { toast.error('Selecione o funcionário na lista'); return; }
    setSaving(true);
    try {
      const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
      if (editingId) await api.updateHRDocument(editingId, payload);
      else await api.createHRDocument(payload);
      toast.success(editingId ? 'Documento atualizado' : 'Documento registrado');
      setDialogOpen(false);
      reload();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar o documento'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!single || !(await confirm(`Excluir o documento ${label('document_types', single.doc_type)} de ${single.person_name}?`))) return;
    try { await api.deleteHRDocument(single.id); toast.success('Documento excluído'); reload(); } catch (e) { toast.error(errorDetail(e, 'Erro ao excluir')); }
  };

  const count = (s) => list.filter((d) => d.status === s).length;
  const hasFilters = !!(search || typeFilter || statusFilter);

  return (
    <Layout>
      <div className="space-y-4" data-testid="hr-documents-page">
        <PageHeader icon={FileBadge} title="Documentos e ASO"
          subtitle="Exames ocupacionais, treinamentos (NR), CNH e outros documentos com controle de validade" />

        <StatGrid>
          <StatCard label="Vencidos" value={count('VENCIDO')} icon={AlertTriangle} tone="red" />
          <StatCard label="Vencem em 30 dias" value={count('A_VENCER')} icon={Clock} tone="amber" />
          <StatCard label="Válidos" value={count('VALIDO')} icon={CheckCircle2} tone="emerald" />
          <StatCard label="Documentos" value={list.length} icon={FileBadge} tone="slate" hint="com os filtros atuais" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setTypeFilter(''); setStatusFilter(''); }}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Funcionário ou descrição" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="hr-documents-search" />
            </FilterField>
            <FilterField label="Documento">
              <Select value={typeFilter || '_all'} onValueChange={(v) => setTypeFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {meta.document_types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Validade">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="hr-documents-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Documentos"
          count={loading ? '...' : list.length}
          footer={<TablePagination {...paginationProps} />}
          toolbar={(
            <Toolbar selectedCount={selectedIds.size} primary={<ToolbarPrimary icon={Plus} label="Novo documento" onClick={openCreate} testId="hr-document-new-btn" />}>
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && openEdit(single)} disabled={!single} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={remove} disabled={!single} />
              <ToolbarButton icon={ExternalLink} label="Abrir arquivo" tone="primary" disabled={!single?.file_url}
                onClick={() => window.open(api.getFileUrl(single.file_url), '_blank', 'noopener')} />
            </Toolbar>
          )}
        >
          {list.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0" />
                    <th>Funcionário</th>
                    <th>Documento</th>
                    <th>Descrição</th>
                    <th>Emissão</th>
                    <th>Validade</th>
                    <th>Situação</th>
                    <th className="!text-center">Arquivo</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((d) => (
                    <tr key={d.id} onClick={() => toggle(d.id)} data-selected={selectedIds.has(d.id)} className="cursor-pointer">
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}><Checkbox checked={selectedIds.has(d.id)} onCheckedChange={() => toggle(d.id)} /></td>
                      <td className="cell-strong">{d.person_name}</td>
                      <td>{label('document_types', d.doc_type)}</td>
                      <td><div className="max-w-[240px] truncate">{d.description || '-'}</div></td>
                      <td className="tabular-nums">{fmtDate(d.issue_date)}</td>
                      <td className="tabular-nums">{fmtDate(d.expiry_date)}</td>
                      <td><StatusPill tone={STATUS_TONES[d.status]}>{STATUS_LABELS[d.status]}</StatusPill></td>
                      <td className="text-center" onClick={(e) => e.stopPropagation()}>
                        {d.file_url ? <a href={api.getFileUrl(d.file_url)} target="_blank" rel="noreferrer" className="text-primary text-xs underline">Abrir</a> : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={FileBadge} loading={loading} title={hasFilters ? 'Nenhum documento encontrado' : 'Nenhum documento registrado'} />
          )}
        </DataCard>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(v) => !saving && setDialogOpen(v)}>
        <DialogContent className="max-w-xl" data-testid="hr-document-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="text-base">{editingId ? 'Editar Documento' : 'Novo Documento'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Funcionário *</Label>
              <ContractPicker contracts={contracts} value={form.contract_id} onChange={(id) => setField('contract_id', id)} disabled={!!editingId} testId="hr-document-contract" />
            </div>
            <div>
              <Label className="mb-1.5 block">Documento *</Label>
              <Select value={form.doc_type} onValueChange={(v) => setField('doc_type', v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {meta.document_types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">Descrição</Label>
              <Input value={form.description} onChange={(e) => setField('description', e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1.5 block">Emissão / realização</Label>
              <Input type="date" value={form.issue_date} onChange={(e) => setField('issue_date', e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1.5 block">Validade</Label>
              <Input type="date" value={form.expiry_date} onChange={(e) => setField('expiry_date', e.target.value)} className="h-9 text-sm" data-testid="hr-document-expiry" />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Arquivo (imagem ou PDF)</Label>
              <div className="flex items-center gap-2">
                {form.file_url && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs">
                    <a href={api.getFileUrl(form.file_url)} target="_blank" rel="noreferrer" className="text-primary underline">Arquivo anexado</a>
                    <button type="button" aria-label="Remover arquivo" onClick={() => setField('file_url', '')}><X className="w-3 h-3" /></button>
                  </span>
                )}
                <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Paperclip className="w-4 h-4 mr-1" />{uploading ? 'Enviando...' : form.file_url ? 'Trocar arquivo' : 'Anexar arquivo'}
                </Button>
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Observações</Label>
              <Textarea value={form.observations} onChange={(e) => setField('observations', e.target.value)} className="text-sm min-h-[50px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving || uploading} data-testid="hr-document-save-btn"><Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
