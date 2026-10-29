import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarDivider,
  ToolbarPrimary, StatusPill, EmptyState, TablePagination, usePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import PeriodReportDialog from '../components/PeriodReportDialog';
import { useConfirm } from '../hooks/useConfirm';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { api } from '../lib/api';
import { todayISO } from '../lib/dates';
import { activeRecords } from '../lib/cadastroStatus';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Award, Plus, Pencil, Trash2, Save, CheckCircle2, RotateCcw, Ban, Receipt, Clock, ListChecks, Users,
  FileBarChart, Briefcase,
} from 'lucide-react';

const TYPE_LABELS = { MOTORISTA: 'Motorista', FUNCIONARIO: 'Funcionário' };
const STATUS_LABELS = { PENDENTE: 'Pendente', PAGO: 'Pago', CANCELADO: 'Cancelado' };
const STATUS_TONES = { PENDENTE: 'amber', PAGO: 'emerald', CANCELADO: 'red' };
const PAYMENT_METHODS = ['PIX', 'Dinheiro', 'Transferência', 'Depósito', 'Cheque', 'Folha de pagamento'];

const formatMoney = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (v) => (v ? format(new Date(`${String(v).slice(0, 10)}T00:00:00`), 'dd/MM/yyyy') : '-');
const personKey = (g) => `${g.person_type}:${g.person_id}`;

function buildEmpty() {
  return {
    person_type: '', person_id: '', person_label: '',
    role: '', reference_date: todayISO(), amount: '', description: '', observations: '',
  };
}

function downloadBlob(data, filename) {
  const url = window.URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function GratificationsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [roles, setRoles] = useState([]);
  const [people, setPeople] = useState([]);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const listKey = `${debouncedSearch}|${roleFilter}|${statusFilter}|${dateFrom}|${dateTo}`;
  const { pageItems, paginationProps } = usePagination(list, { resetKey: listKey });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [saving, setSaving] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ payment_date: todayISO(), payment_method: '' });
  const [paying, setPaying] = useState(false);

  const [rolesOpen, setRolesOpen] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [savingRole, setSavingRole] = useState(false);

  const [reportOpen, setReportOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => { loadRoles(); loadPeople(); }, []);
  // Filtro mudou: a seleção é zerada, senão um lançamento escondido pelo
  // filtro entraria no pagamento ou no recibo sem aparecer.
  useEffect(() => {
    setSelectedIds(new Set());
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  const loadRoles = () => api.getGratificationRoles().then((r) => setRoles(r.data || [])).catch(() => toast.error('Erro ao carregar as funções'));

  // Motoristas + Funcionários numa lista só
  const loadPeople = async () => {
    const [drivers, employees] = await Promise.all([
      api.getDrivers().then((r) => r.data || []).catch(() => []),
      api.getEmployees({ per_page: 1000 }).then((r) => r.data || []).catch(() => []),
    ]);
    setPeople([
      ...employees.map((p) => ({ ...p, _type: 'FUNCIONARIO' })),
      ...drivers.map((p) => ({ ...p, _type: 'MOTORISTA' })),
    ].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')));
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.status = statusFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const r = await api.getGratifications(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar as gratificações');
    } finally {
      setLoading(false);
    }
  };

  const reload = () => { setSelectedIds(new Set()); loadList(); };

  // ===== Seleção =====
  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    const ids = pageItems.map((g) => g.id);
    const all = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const selectedItems = list.filter((g) => selectedIds.has(g.id));
  const single = selectedItems.length === 1 ? selectedItems[0] : null;
  const canPay = selectedItems.length > 0 && selectedItems.every((g) => g.status === 'PENDENTE');
  // Recibo: só gratificações pagas, todas da mesma pessoa
  const samePerson = selectedItems.length > 0 && new Set(selectedItems.map(personKey)).size === 1;
  const allPaid = selectedItems.length > 0 && selectedItems.every((g) => g.status === 'PAGO');
  const canReceipt = samePerson && allPaid;
  const receiptHint = selectedItems.length === 0 ? null
    : !samePerson ? 'Recibo: selecione gratificações de uma única pessoa'
      : !allPaid ? 'Recibo: só gratificações pagas' : null;

  // ===== Indicadores =====
  const sumBy = (status) => list.filter((g) => g.status === status).reduce((acc, g) => acc + (g.amount || 0), 0);
  const pendingCount = list.filter((g) => g.status === 'PENDENTE').length;
  const peopleCount = new Set(list.filter((g) => g.status !== 'CANCELADO').map(personKey)).size;
  const hasFilters = !!(search || roleFilter || statusFilter || dateFrom || dateTo);
  const clearFilters = () => { setSearch(''); setRoleFilter(''); setStatusFilter(''); setDateFrom(''); setDateTo(''); };

  // ===== Cadastro =====
  const personLabel = (p) => `${p.name}${p.cpf ? ` - ${p.cpf}` : ''} (${TYPE_LABELS[p._type]})`;
  const pickerPeople = editingId ? people : activeRecords(people);
  const roleNames = useMemo(() => roles.map((r) => r.name), [roles]);
  const matchRole = (name) => roleNames.find((r) => r.toLowerCase() === (name || '').trim().toLowerCase());

  const setField = (field, value) => setForm((p) => ({ ...p, [field]: value }));
  const onPersonInput = (value) => setForm((p) => ({ ...p, person_label: value, person_id: '', person_type: '' }));
  // A função vem do cadastro: motorista é Motorista; funcionário, o cargo dele
  // quando bate com uma função cadastrada. Pode ser trocada no formulário.
  const onPersonSelect = (person) => setForm((p) => ({
    ...p,
    person_label: personLabel(person),
    person_id: person.id,
    person_type: person._type,
    role: (person._type === 'MOTORISTA' ? matchRole('Motorista') : matchRole(person.position)) || p.role,
  }));

  const openCreate = () => {
    setForm(buildEmpty());
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (g) => {
    const person = people.find((p) => p.id === g.person_id && p._type === g.person_type);
    setForm({
      person_type: g.person_type,
      person_id: g.person_id,
      person_label: person ? personLabel(person) : `${g.person_name} (${TYPE_LABELS[g.person_type]})`,
      role: g.role,
      reference_date: g.reference_date,
      amount: g.amount,
      description: g.description || '',
      observations: g.observations || '',
    });
    setEditingId(g.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.person_id) { toast.error('Selecione o Motorista ou Funcionário na lista'); return; }
    if (!form.role) { toast.error('Selecione a função'); return; }
    if (!form.reference_date) { toast.error('Informe a data de referência'); return; }
    if (!(Number(form.amount) > 0)) { toast.error('Informe o valor da gratificação'); return; }
    setSaving(true);
    try {
      const payload = {
        person_type: form.person_type,
        person_id: form.person_id,
        role: form.role,
        reference_date: form.reference_date,
        amount: Number(form.amount),
        description: form.description || null,
        observations: form.observations || null,
      };
      if (editingId) await api.updateGratification(editingId, payload);
      else await api.createGratification(payload);
      toast.success(editingId ? 'Gratificação atualizada' : 'Gratificação lançada');
      setDialogOpen(false);
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao salvar a gratificação');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!single) return;
    if (!(await confirm(`Excluir a gratificação Nº ${single.gratification_number} de ${single.person_name}?`))) return;
    try {
      await api.deleteGratification(single.id);
      toast.success('Gratificação excluída');
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao excluir');
    }
  };

  // ===== Pagamento =====
  const openPay = () => {
    setPayForm({ payment_date: todayISO(), payment_method: '' });
    setPayOpen(true);
  };

  const handlePay = async () => {
    if (!payForm.payment_date) { toast.error('Informe a data do pagamento'); return; }
    setPaying(true);
    try {
      await api.payGratifications({
        ids: selectedItems.map((g) => g.id),
        payment_date: payForm.payment_date,
        payment_method: payForm.payment_method || null,
      });
      toast.success(selectedItems.length === 1 ? 'Gratificação paga' : `${selectedItems.length} gratificações pagas`);
      setPayOpen(false);
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao registrar o pagamento');
    } finally {
      setPaying(false);
    }
  };

  const changeStatus = async (status) => {
    if (!single) return;
    const message = status === 'PENDENTE'
      ? `Estornar o pagamento da gratificação Nº ${single.gratification_number}? Ela volta para Pendente.`
      : `Cancelar a gratificação Nº ${single.gratification_number} de ${single.person_name}?`;
    if (!(await confirm(message))) return;
    try {
      await api.updateGratificationStatus(single.id, status);
      toast.success(status === 'PENDENTE' ? 'Pagamento estornado' : 'Gratificação cancelada');
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao atualizar a situação');
    }
  };

  const downloadReceipt = async () => {
    if (!canReceipt || downloading) return;
    setDownloading(true);
    try {
      const r = await api.getGratificationReceiptPDF(selectedItems.map((g) => g.id));
      const name = (selectedItems[0].person_name || 'pessoa').replace(/[^A-Za-z0-9]+/g, '_');
      downloadBlob(r.data, `Recibo_Gratificacao_${name}.pdf`);
    } catch (e) {
      let detail = null;
      try { detail = JSON.parse(await e?.response?.data?.text())?.detail; } catch (_) { /* resposta não é JSON */ }
      toast.error(detail || 'Erro ao gerar o recibo');
    } finally {
      setDownloading(false);
    }
  };

  // ===== Funções =====
  const handleAddRole = async () => {
    const name = newRole.trim();
    if (!name) return;
    setSavingRole(true);
    try {
      await api.createGratificationRole({ name });
      setNewRole('');
      loadRoles();
      toast.success(`Função ${name} cadastrada`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao cadastrar a função');
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (role) => {
    if (!(await confirm(`Excluir a função ${role.name}?`))) return;
    try {
      await api.deleteGratificationRole(role.id);
      loadRoles();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao excluir a função');
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="gratifications-page">
        <PageHeader
          icon={Award}
          title="Controle de Gratificação"
          subtitle="Gratificações de motoristas e funcionários por função, com pagamento, recibo e relatório do período"
          actions={(
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setRolesOpen(true)} data-testid="gratification-roles-btn">
                <Briefcase className="w-4 h-4 mr-1.5" /> Funções
              </Button>
              <Button variant="outline" size="sm" onClick={() => setReportOpen(true)} data-testid="gratification-report-btn">
                <FileBarChart className="w-4 h-4 mr-1.5" /> Relatório
              </Button>
            </div>
          )}
        />

        <StatGrid>
          <StatCard label="A pagar" value={formatMoney(sumBy('PENDENTE'))} icon={Clock} tone="amber" hint={`${pendingCount} gratificaç${pendingCount === 1 ? 'ão pendente' : 'ões pendentes'}`} />
          <StatCard label="Pago" value={formatMoney(sumBy('PAGO'))} icon={CheckCircle2} tone="emerald" hint="com os filtros atuais" />
          <StatCard label="Lançamentos" value={list.length} icon={ListChecks} tone="blue" hint="com os filtros atuais" />
          <StatCard label="Pessoas" value={peopleCount} icon={Users} tone="slate" hint="com gratificação" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={clearFilters}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Nome, CPF ou descrição" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="gratification-search" />
            </FilterField>
            <FilterField label="Função">
              <Select value={roleFilter || '_all'} onValueChange={(v) => setRoleFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="gratification-role-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  {roleNames.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Situação">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  <SelectItem value="PENDENTE">Pendente</SelectItem>
                  <SelectItem value="PAGO">Pago</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Referência - de">
              <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </FilterField>
            <FilterField label="até">
              <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </FilterField>
          </div>
        </FilterCard>

        {/* Marque 1+ gratificações para as ações. Pagar aceita várias de uma vez
            (de pessoas diferentes também); o recibo aceita várias, desde que
            todas estejam pagas e sejam da mesma pessoa. */}
        <DataCard
          title="Gratificações"
          count={loading ? '...' : list.length}
          meta={receiptHint && <span className="hidden md:inline text-xs text-amber-600 dark:text-amber-400" data-testid="gratification-receipt-hint">{receiptHint}</span>}
          footer={<TablePagination {...paginationProps} />}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova gratificação" onClick={openCreate} testId="gratification-new-btn" />}
            >
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && openEdit(single)} disabled={!single || single.status !== 'PENDENTE'} testId="gratification-edit-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={!single || single.status === 'PAGO'} testId="gratification-delete-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={CheckCircle2} label="Marcar como pago" tone="emerald" onClick={openPay} disabled={!canPay} testId="gratification-pay-btn" />
              <ToolbarButton icon={RotateCcw} label="Estornar pagamento" tone="amber" onClick={() => changeStatus('PENDENTE')} disabled={!single || single.status !== 'PAGO'} testId="gratification-unpay-btn" />
              <ToolbarButton icon={Ban} label="Cancelar" tone="red" onClick={() => changeStatus('CANCELADO')} disabled={!single || single.status !== 'PENDENTE'} testId="gratification-cancel-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={Receipt} label="Recibo (PDF)" tone="primary" onClick={downloadReceipt} disabled={!canReceipt || downloading} testId="gratification-receipt-btn" />
            </Toolbar>
          )}
        >
          {list.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={pageItems.length > 0 && pageItems.every((g) => selectedIds.has(g.id))}
                        onCheckedChange={toggleSelectAll}
                        data-testid="gratification-select-all"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Referência</th>
                    <th>Nome</th>
                    <th>Função</th>
                    <th>Descrição</th>
                    <th className="!text-right">Valor</th>
                    <th>Situação</th>
                    <th>Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((g) => (
                    <tr
                      key={g.id}
                      onClick={() => toggleSelect(g.id)}
                      data-selected={selectedIds.has(g.id)}
                      className="cursor-pointer"
                      data-testid={`gratification-row-${g.gratification_number}`}
                    >
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(g.id)} onCheckedChange={() => toggleSelect(g.id)} />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">#{g.gratification_number}</td>
                      <td className="whitespace-nowrap tabular-nums">{fmtDate(g.reference_date)}</td>
                      <td>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="cell-strong max-w-[220px] truncate" title={g.person_name}>{g.person_name}</span>
                          <StatusPill tone={g.person_type === 'FUNCIONARIO' ? 'blue' : 'slate'} dot={false} className="text-[10px] px-1.5">
                            {TYPE_LABELS[g.person_type]}
                          </StatusPill>
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{g.role}</td>
                      <td><div className="max-w-[260px] truncate" title={g.description || ''}>{g.description || '-'}</div></td>
                      <td className="text-right tabular-nums whitespace-nowrap cell-strong">{formatMoney(g.amount)}</td>
                      <td><StatusPill tone={STATUS_TONES[g.status] || 'slate'}>{STATUS_LABELS[g.status] || g.status}</StatusPill></td>
                      <td className="whitespace-nowrap tabular-nums">
                        {g.payment_date ? fmtDate(g.payment_date) : '-'}
                        {g.payment_method && <span className="text-slate-400 dark:text-slate-500"> · {g.payment_method}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Award}
              loading={loading}
              title={hasFilters ? 'Nenhuma gratificação encontrada' : 'Nenhuma gratificação lançada'}
              hint={loading ? undefined : (hasFilters ? 'Ajuste os filtros' : 'Lance a primeira pelo botão "Nova gratificação"')}
              testId="gratification-empty"
            />
          )}
        </DataCard>
      </div>

      {/* Lançar / editar */}
      <Dialog open={dialogOpen} onOpenChange={(v) => !saving && setDialogOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="gratification-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Award className="w-5 h-5 text-primary" />
              {editingId ? 'Editar gratificação' : 'Nova gratificação'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Motorista ou Funcionário *</Label>
              <Autocomplete
                value={form.person_label}
                onChange={onPersonInput}
                onSelect={onPersonSelect}
                options={pickerPeople}
                displayField={personLabel}
                className="text-sm"
                testId="gratification-person-input"
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Função *</Label>
              <div className="flex gap-2">
                <Select value={form.role || undefined} onValueChange={(v) => setField('role', v)}>
                  <SelectTrigger className="h-9 text-sm" data-testid="gratification-role-select"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {roleNames.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="sm" className="h-9 px-2.5" title="Cadastrar outra função" aria-label="Cadastrar outra função" onClick={() => setRolesOpen(true)}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block">Data de referência *</Label>
              <Input type="date" value={form.reference_date} onChange={(e) => setField('reference_date', e.target.value)} className="h-9 text-sm" data-testid="gratification-date-input" />
            </div>
            <div>
              <Label className="mb-1.5 block">Valor (R$) *</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} className="h-9 text-sm text-right" data-testid="gratification-amount-input" />
            </div>
            <div>
              <Label className="mb-1.5 block">Descrição / motivo</Label>
              <Input value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Ex.: meta de outubro" className="h-9 text-sm" data-testid="gratification-description-input" />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Observações</Label>
              <Textarea value={form.observations} onChange={(e) => setField('observations', e.target.value)} className="text-sm min-h-[60px]" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="gratification-save-btn">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : editingId ? 'Atualizar' : 'Lançar gratificação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pagamento */}
      <Dialog open={payOpen} onOpenChange={(v) => !paying && setPayOpen(v)}>
        <DialogContent className="max-w-md" data-testid="gratification-pay-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Registrar pagamento</DialogTitle>
            <DialogDescription>
              {selectedItems.length === 1 ? '1 gratificação' : `${selectedItems.length} gratificações`} · total {formatMoney(selectedItems.reduce((acc, g) => acc + (g.amount || 0), 0))}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1.5 block">Data do pagamento *</Label>
              <Input type="date" value={payForm.payment_date} onChange={(e) => setPayForm((p) => ({ ...p, payment_date: e.target.value }))} className="h-9 text-sm" data-testid="gratification-pay-date" />
            </div>
            <div>
              <Label className="mb-1.5 block">Forma de pagamento</Label>
              <Select value={payForm.payment_method || '_none'} onValueChange={(v) => setPayForm((p) => ({ ...p, payment_method: v === '_none' ? '' : v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Não informar</SelectItem>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paying}>Cancelar</Button>
            <Button onClick={handlePay} disabled={paying} data-testid="gratification-pay-confirm">
              <CheckCircle2 className="w-4 h-4 mr-2" />{paying ? 'Salvando...' : 'Confirmar pagamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Funções */}
      <Dialog open={rolesOpen} onOpenChange={setRolesOpen}>
        <DialogContent className="max-w-md" data-testid="gratification-roles-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Funções</DialogTitle>
            <DialogDescription>As funções padrão já vêm cadastradas; inclua outras se precisar.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddRole(); }}
              placeholder="Nova função"
              className="h-9 text-sm"
              data-testid="gratification-new-role-input"
            />
            <Button onClick={handleAddRole} disabled={savingRole || !newRole.trim()} className="h-9" data-testid="gratification-add-role-btn">
              <Plus className="w-4 h-4 mr-1" />Incluir
            </Button>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-md border border-slate-200 dark:border-slate-700 max-h-72 overflow-y-auto">
            {roles.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  {r.name}
                  {r.is_default && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Padrão</Badge>}
                </span>
                {!r.is_default && (
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" aria-label={`Excluir ${r.name}`} title="Excluir" onClick={() => handleDeleteRole(r)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRolesOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PeriodReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Relatório de Gratificações"
        description="Gratificações do período por pessoa, por função e item a item: o que já foi pago e o que está pendente."
        selects={[{
          key: 'period_by',
          label: 'Período pela data de',
          options: [{ value: 'reference', label: 'Referência' }, { value: 'payment', label: 'Pagamento (só as pagas)' }],
        }]}
        statuses={[{ value: '', label: 'Pendentes e pagas' }, { value: 'PENDENTE', label: 'Pendentes' }, { value: 'PAGO', label: 'Pagas' }, { value: 'CANCELADO', label: 'Canceladas' }]}
        textFilters={[{ key: 'person', label: 'Nome ou CPF' }, { key: 'role', label: 'Função' }]}
        load={api.getGratificationsReport}
        summarize={(d) => [
          ['Gratificações', d.summary.count], ['Pessoas', d.summary.people],
          ['Total', formatMoney(d.summary.total)], ['Pago', formatMoney(d.summary.paid)], ['A pagar', formatMoney(d.summary.pending)],
        ]}
        downloadPdf={api.downloadGratificationsReportPdf}
        downloadExcel={api.downloadGratificationsReportExcel}
        filename="relatorio_gratificacoes"
      />
      <ConfirmDialog />
    </Layout>
  );
}
