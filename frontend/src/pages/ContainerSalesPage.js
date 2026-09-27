import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, EmptyState,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, CheckCircle2, RotateCcw, BadgeDollarSign, Clock } from 'lucide-react';

const STATUS_LABELS = { PENDENTE: 'Pendente', RECEBIDO: 'Recebido' };
const STATUS_TONES = {
  PENDENTE: 'amber',
  RECEBIDO: 'emerald',
};

const formatMoney = (value) => (value == null ? '-' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

function buildEmpty() {
  return {
    container_number: '',
    representative_id: '',
    representative_name: '',
    sale_value: '',
    received_value: '',
    observations: '',
  };
}

export default function ContainerSalesPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [representatives, setRepresentatives] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [statusFilter, setStatusFilter] = useState('');
  const [containerFilter, setContainerFilter] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingIsAuto, setEditingIsAuto] = useState(false);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadRepresentatives(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadList(); }, [statusFilter]);

  const loadRepresentatives = async () => {
    try {
      const r = await api.getContainerRepresentatives();
      setRepresentatives(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const r = await api.getContainerSales(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar registros de venda');
    } finally {
      setLoading(false);
    }
  };

  const filteredList = list.filter((s) => {
    const term = containerFilter.trim().toUpperCase();
    if (!term) return true;
    return s.container_number?.toUpperCase().includes(term);
  });

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = filteredList.map((s) => s.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const singleSelected = selectedIds.size === 1 ? filteredList.find((s) => s.id === [...selectedIds][0]) : null;

  const markStatus = async (id, status) => {
    try {
      await api.updateContainerSaleStatus(id, status);
      toast.success(status === 'RECEBIDO' ? 'Marcado como Recebido' : 'Marcado como Pendente');
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao atualizar status');
    }
  };

  const openCreate = () => {
    setForm(buildEmpty());
    setEditMode(false);
    setEditingId(null);
    setEditingIsAuto(false);
    setDialogOpen(true);
  };

  const openEdit = (sale) => {
    setForm({
      container_number: sale.container_number || '',
      representative_id: sale.representative_id || '',
      representative_name: sale.representative_name || '',
      sale_value: sale.sale_value ?? '',
      received_value: sale.received_value ?? '',
      observations: sale.observations || '',
    });
    setEditMode(true);
    setEditingId(sale.id);
    setEditingIsAuto(!!sale.loading_order_id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        container_number: form.container_number,
        representative_id: form.representative_id || null,
        representative_name: form.representative_name || null,
        sale_value: form.sale_value === '' ? null : parseFloat(form.sale_value),
        received_value: form.received_value === '' ? null : parseFloat(form.received_value),
        observations: form.observations || null,
      };
      if (editMode) {
        await api.updateContainerSale(editingId, payload);
        toast.success('Registro de Venda atualizado');
      } else {
        await api.createContainerSale(payload);
        toast.success('Registro de Venda cadastrado');
      }
      setDialogOpen(false);
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar registro de venda');
    } finally { setSaving(false); }
  };

  const handleDelete = async (sale) => {
    if (await confirm('Tem certeza que deseja excluir este Registro de Venda?')) {
      try {
        await api.deleteContainerSale(sale.id);
        toast.success('Registro de Venda excluído');
        setSelectedIds(prev => {
          if (!prev.has(sale.id)) return prev;
          const next = new Set(prev);
          next.delete(sale.id);
          return next;
        });
        loadList();
      } catch (e) {
        toast.error(e?.response?.data?.detail || 'Erro ao excluir registro de venda');
      }
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="container-sales-page">
        <PageHeader
          icon={BadgeDollarSign}
          title="Registro de Venda"
          subtitle="Lançamentos gerados a partir das Ordens de Entrega aprovadas, ou cadastrados manualmente, para controle de comissão dos vendedores"
        />

        <StatGrid className="lg:grid-cols-3">
          <StatCard label="A receber" value={formatMoney(filteredList.filter((s) => s.status === 'PENDENTE').reduce((acc, s) => acc + Number(s.sale_value || 0), 0))} icon={Clock} tone="amber" hint={`${filteredList.filter((s) => s.status === 'PENDENTE').length} venda(s) pendente(s)`} />
          <StatCard label="Recebido" value={formatMoney(filteredList.reduce((acc, s) => acc + Number(s.received_value || 0), 0))} icon={CheckCircle2} tone="emerald" />
          <StatCard label="Vendas" value={filteredList.length} icon={BadgeDollarSign} tone="blue" hint="com os filtros atuais" />
        </StatGrid>

        <FilterCard
          hasFilters={!!(containerFilter || statusFilter)}
          onClear={() => { setContainerFilter(''); setStatusFilter(''); }}
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Container">
              <SearchInput className="font-mono" value={containerFilter} onChange={(e) => setContainerFilter(e.target.value)} />
            </FilterField>
            <FilterField label="Status">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  <SelectItem value="PENDENTE">Pendente</SelectItem>
                  <SelectItem value="RECEBIDO">Recebido</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque uma venda pra habilitar as ações da barra */}
        <DataCard
          title="Vendas"
          count={loading ? '...' : filteredList.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova venda" onClick={openCreate} testId="add-container-sale-button" />}
            >
              <ToolbarButton icon={CheckCircle2} label="Marcar como Recebido" tone="emerald" onClick={() => singleSelected && markStatus(singleSelected.id, 'RECEBIDO')} disabled={!singleSelected || singleSelected.status !== 'PENDENTE'} testId="sale-mark-received" />
              <ToolbarButton icon={RotateCcw} label="Marcar como Pendente" tone="amber" onClick={() => singleSelected && markStatus(singleSelected.id, 'PENDENTE')} disabled={!singleSelected || singleSelected.status !== 'RECEBIDO'} testId="sale-mark-pending" />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelected && openEdit(singleSelected)} disabled={!singleSelected} testId="edit-container-sale-button" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelected && handleDelete(singleSelected)} disabled={!singleSelected} testId="delete-container-sale-button" />
            </Toolbar>
          )}
        >
          {filteredList.length === 0 && !loading ? (
            <EmptyState
              icon={BadgeDollarSign}
              title="Nenhuma venda encontrada"
              hint={containerFilter || statusFilter ? 'Ajuste os filtros' : 'As vendas aparecem aqui quando uma Ordem de Entrega é aprovada, ou pelo botão "Nova venda"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={filteredList.length > 0 && filteredList.every((s) => selectedIds.has(s.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Container</th>
                    <th>Booking</th>
                    <th>Terminal</th>
                    <th>Data entrada</th>
                    <th>Vendedor</th>
                    <th className="!text-right">Valor venda</th>
                    <th className="!text-right">Valor recebido</th>
                    <th>Status</th>
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredList.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => toggleSelect(s.id)}
                      data-selected={selectedIds.has(s.id)}
                      className="cursor-pointer"
                      data-testid="container-sale-row"
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(s.id)}
                          onCheckedChange={() => toggleSelect(s.id)}
                        />
                      </td>
                      <td className="font-mono whitespace-nowrap cell-strong">{s.container_number}</td>
                      <td className="whitespace-nowrap">{s.booking || '-'}</td>
                      <td><div className="max-w-[180px] truncate" title={s.origin_terminal || ''}>{s.origin_terminal || '-'}</div></td>
                      <td className="whitespace-nowrap tabular-nums">{s.entry_date ? format(new Date(s.entry_date), 'dd/MM/yyyy') : '-'}</td>
                      <td><div className="max-w-[180px] truncate" title={s.representative_name || ''}>{s.representative_name || '-'}</div></td>
                      <td className="text-right whitespace-nowrap tabular-nums">{formatMoney(s.sale_value)}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{formatMoney(s.received_value)}</td>
                      <td>
                        <StatusPill tone={STATUS_TONES[s.status] || 'slate'}>
                          {STATUS_LABELS[s.status] || s.status}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap">
                        {s.loading_order_id
                          ? <StatusPill tone="blue" dot={false}>Ordem #{s.order_number}</StatusPill>
                          : <StatusPill tone="slate" dot={false}>Manual</StatusPill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="container-sale-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">{editMode ? 'Editar Registro de Venda' : 'Cadastrar Registro de Venda'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Número do Container *</Label>
              <Input
                className="h-10 text-[13px] font-mono"
                value={form.container_number}
                onChange={(e) => setForm({ ...form, container_number: e.target.value.toUpperCase() })}
                disabled={editingIsAuto}
                data-testid="sale-container-number-input"
              />
              {!editMode && (
                <p className="text-xs text-slate-500">Se houver uma Compra Disponível para este container, Booking/Terminal/Data de Entrada serão preenchidos automaticamente.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Representante</Label>
              <Autocomplete
                value={form.representative_name}
                onChange={(v) => setForm({ ...form, representative_name: v })}
                onSelect={(r) => setForm({ ...form, representative_id: r.id, representative_name: r.name })}
                options={representatives}
                displayField="name"
                className="h-10 text-[13px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Valor da Venda</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-10 text-[13px]"
                  value={form.sale_value}
                  onChange={(e) => setForm({ ...form, sale_value: e.target.value })}
                  data-testid="sale-value-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">Valor Recebido</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-10 text-[13px]"
                  value={form.received_value}
                  onChange={(e) => setForm({ ...form, received_value: e.target.value })}
                  data-testid="sale-received-value-input"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Observações</Label>
              <Textarea
                className="text-[13px] min-h-[60px]"
                value={form.observations}
                onChange={(e) => setForm({ ...form, observations: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="submit-container-sale-button">
              {saving ? 'Salvando...' : (editMode ? 'Atualizar' : 'Cadastrar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
