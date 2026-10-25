import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary, StatusPill, EmptyState,
  TablePagination, usePagination,
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
import { formatMoney, errorDetail } from '../components/HRKit';
import { toast } from 'sonner';
import { BriefcaseBusiness, Pencil, Plus, Save, Trash2 } from 'lucide-react';

const EMPTY = { name: '', department: '', cbo: '', salary_min: '', salary_max: '', description: '', status: 'ATIVO' };

export default function HRPositionsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const listKey = `${debouncedSearch}|${statusFilter}`;
  const { pageItems, paginationProps } = usePagination(list, { resetKey: listKey });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setSelectedIds(new Set()); load(); }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      setList((await api.getHRPositions(params)).data || []);
    } catch (e) {
      toast.error('Erro ao carregar os cargos');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const single = selectedIds.size === 1 ? list.find((p) => selectedIds.has(p.id)) : null;
  const setField = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const openCreate = () => { setForm(EMPTY); setEditingId(null); setDialogOpen(true); };
  const openEdit = (p) => {
    setForm({
      name: p.name, department: p.department || '', cbo: p.cbo || '', salary_min: p.salary_min ?? '', salary_max: p.salary_max ?? '',
      description: p.description || '', status: p.status || 'ATIVO',
    });
    setEditingId(p.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Informe o nome do cargo'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        salary_min: form.salary_min === '' ? null : Number(form.salary_min),
        salary_max: form.salary_max === '' ? null : Number(form.salary_max),
      };
      if (editingId) await api.updateHRPosition(editingId, payload);
      else await api.createHRPosition(payload);
      toast.success(editingId ? 'Cargo atualizado' : 'Cargo cadastrado');
      setDialogOpen(false);
      setSelectedIds(new Set());
      load();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar o cargo'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!single || !(await confirm(`Excluir o cargo ${single.name}?`))) return;
    try {
      await api.deleteHRPosition(single.id);
      toast.success('Cargo excluído');
      setSelectedIds(new Set());
      load();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao excluir'));
    }
  };

  const hasFilters = !!(search || statusFilter);

  return (
    <Layout>
      <div className="space-y-4" data-testid="hr-positions-page">
        <PageHeader icon={BriefcaseBusiness} title="Cargos e Salários" subtitle="Cargos com setor, CBO e faixa salarial, usados na admissão" />

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setStatusFilter(''); }}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Cargo, setor ou CBO" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="hr-positions-search" />
            </FilterField>
            <FilterField label="Status">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  <SelectItem value="ATIVO">Ativo</SelectItem>
                  <SelectItem value="INATIVO">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Cargos"
          count={loading ? '...' : list.length}
          footer={<TablePagination {...paginationProps} />}
          toolbar={(
            <Toolbar selectedCount={selectedIds.size} primary={<ToolbarPrimary icon={Plus} label="Novo cargo" onClick={openCreate} testId="hr-position-new-btn" />}>
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && openEdit(single)} disabled={!single} testId="hr-position-edit-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={!single} testId="hr-position-delete-btn" />
            </Toolbar>
          )}
        >
          {list.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0" />
                    <th>Cargo</th>
                    <th>Setor</th>
                    <th>CBO</th>
                    <th className="!text-right">Faixa salarial</th>
                    <th className="!text-center">Contratos ativos</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((p) => (
                    <tr key={p.id} onClick={() => toggle(p.id)} data-selected={selectedIds.has(p.id)} className="cursor-pointer">
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                      </td>
                      <td className="cell-strong">{p.name}</td>
                      <td>{p.department || '-'}</td>
                      <td className="tabular-nums">{p.cbo || '-'}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {p.salary_min || p.salary_max ? `${p.salary_min ? formatMoney(p.salary_min) : '-'} a ${p.salary_max ? formatMoney(p.salary_max) : '-'}` : '-'}
                      </td>
                      <td className="text-center tabular-nums">{p.active_contracts}</td>
                      <td><StatusPill tone={p.status === 'ATIVO' ? 'emerald' : 'slate'}>{p.status === 'ATIVO' ? 'Ativo' : 'Inativo'}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={BriefcaseBusiness} loading={loading} title={hasFilters ? 'Nenhum cargo encontrado' : 'Nenhum cargo cadastrado'}
              hint={loading ? undefined : 'Cadastre os cargos pelo botão "Novo cargo"'} />
          )}
        </DataCard>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(v) => !saving && setDialogOpen(v)}>
        <DialogContent className="max-w-xl" data-testid="hr-position-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="text-base">{editingId ? 'Editar Cargo' : 'Novo Cargo'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Nome do cargo *</Label>
              <Input value={form.name} onChange={(e) => setField('name', e.target.value)} className="h-9 text-sm" data-testid="hr-position-name" />
            </div>
            <div>
              <Label className="mb-1.5 block">Setor</Label>
              <Input value={form.department} onChange={(e) => setField('department', e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1.5 block">CBO</Label>
              <Input value={form.cbo} onChange={(e) => setField('cbo', e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1.5 block">Salário mínimo da faixa (R$)</Label>
              <Input type="number" min="0" step="0.01" value={form.salary_min} onChange={(e) => setField('salary_min', e.target.value)} className="h-9 text-sm text-right" />
            </div>
            <div>
              <Label className="mb-1.5 block">Salário máximo da faixa (R$)</Label>
              <Input type="number" min="0" step="0.01" value={form.salary_max} onChange={(e) => setField('salary_max', e.target.value)} className="h-9 text-sm text-right" />
            </div>
            <div>
              <Label className="mb-1.5 block">Status</Label>
              <Select value={form.status} onValueChange={(v) => setField('status', v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ATIVO">Ativo</SelectItem>
                  <SelectItem value="INATIVO">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Atribuições / descrição</Label>
              <Textarea value={form.description} onChange={(e) => setField('description', e.target.value)} className="text-sm min-h-[70px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="hr-position-save-btn">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
