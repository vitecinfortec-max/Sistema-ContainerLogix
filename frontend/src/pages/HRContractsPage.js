import { useEffect, useMemo, useState } from 'react';
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
import { Switch } from '../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { useConfirm } from '../hooks/useConfirm';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { api } from '../lib/api';
import { todayISO } from '../lib/dates';
import { activeRecords } from '../lib/cadastroStatus';
import {
  CONTRACT_STATUS, CONTRACT_STATUS_TONES, PERSON_TYPES, errorDetail, fmtDate, formatMoney, saveBlob, useHRMeta,
} from '../components/HRKit';
import { toast } from 'sonner';
import {
  UserPlus, Pencil, Trash2, Save, UserX, Undo2, FileText, FileSignature, PauseCircle, PlayCircle, Users, Wallet,
  Hourglass, Plus, Calculator,
} from 'lucide-react';

function emptyForm() {
  return {
    person_type: '', person_id: '', person_label: '',
    new_person: false, new_name: '', new_cpf: '', new_birth: '', new_phone: '',
    position_id: '', department: '', contract_type: 'CLT', admission_date: todayISO(), experience_days: 0,
    base_salary: '', weekly_hours: 44, work_schedule: '',
    insalubridade_grade: 0, periculosidade: false, vt_opt_in: false, vt_monthly_cost: '', salary_advance: false,
    pis: '', ctps_number: '', ctps_series: '', bank_name: '', bank_agency: '', bank_account: '', pix_key: '',
    dependents: [], recurring_events: [], vacation_settled_until: '', observations: '',
  };
}

const EMPTY_TERMINATION = { termination_date: todayISO(), termination_type: 'SEM_JUSTA_CAUSA', notice_type: 'INDENIZADO', fgts_balance: '', reason: '' };

export default function HRContractsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const { meta, label } = useHRMeta();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [positions, setPositions] = useState([]);
  const [people, setPeople] = useState([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('VIGENTE');
  const [typeFilter, setTypeFilter] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const listKey = `${debouncedSearch}|${statusFilter}|${typeFilter}`;
  const { pageItems, paginationProps } = usePagination(list, { resetKey: listKey });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [tab, setTab] = useState('pessoa');
  const [saving, setSaving] = useState(false);

  const [termOpen, setTermOpen] = useState(false);
  const [extendDays, setExtendDays] = useState(null);  // prorrogação da experiência: prazo total
  const [termForm, setTermForm] = useState(EMPTY_TERMINATION);
  const [termPreview, setTermPreview] = useState(null);
  const [termBusy, setTermBusy] = useState(false);

  useEffect(() => { loadPositions(); loadPeople(); }, []);
  useEffect(() => { setSelectedIds(new Set()); load(); }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPositions = () => api.getHRPositions().then((r) => setPositions(r.data || [])).catch(() => {});
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

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter && statusFilter !== 'TODOS') params.status = statusFilter;
      if (typeFilter) params.contract_type = typeFilter;
      setList((await api.getHRContracts(params)).data || []);
    } catch (e) {
      toast.error('Erro ao carregar os contratos');
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
  const single = selectedIds.size === 1 ? list.find((c) => selectedIds.has(c.id)) : null;

  // ===== Indicadores =====
  const today = todayISO();
  const in15 = useMemo(() => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const vigentes = list.filter((c) => c.status !== 'DESLIGADO');
  const experienceSoon = vigentes.filter((c) => c.experience_end && c.experience_end >= today && c.experience_end <= in15).length;

  // ===== Formulário =====
  const setField = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const personLabel = (p) => `${p.name}${p.cpf ? ` - ${p.cpf}` : ''} (${PERSON_TYPES[p._type]})`;
  const selectedPosition = positions.find((p) => p.id === form.position_id);

  const openCreate = () => { setForm(emptyForm()); setEditingId(null); setTab('pessoa'); setDialogOpen(true); };
  const openEdit = (c) => {
    setForm({
      ...emptyForm(),
      person_type: c.person_type, person_id: c.person_id,
      person_label: `${c.person_name}${c.person_cpf ? ` - ${c.person_cpf}` : ''} (${PERSON_TYPES[c.person_type]})`,
      position_id: c.position_id || '', department: c.department || '', contract_type: c.contract_type,
      admission_date: c.admission_date, experience_days: c.experience_days || 0,
      base_salary: c.base_salary, weekly_hours: c.weekly_hours ?? '', work_schedule: c.work_schedule || '',
      insalubridade_grade: c.insalubridade_grade || 0, periculosidade: !!c.periculosidade,
      vt_opt_in: !!c.vt_opt_in, vt_monthly_cost: c.vt_monthly_cost ?? '', salary_advance: !!c.salary_advance,
      pis: c.pis || '', ctps_number: c.ctps_number || '', ctps_series: c.ctps_series || '',
      bank_name: c.bank_name || '', bank_agency: c.bank_agency || '', bank_account: c.bank_account || '', pix_key: c.pix_key || '',
      dependents: (c.dependents || []).map((d) => ({ ...d, cpf: d.cpf || '', birth_date: d.birth_date || '', relationship: d.relationship || '' })),
      recurring_events: (c.recurring_events || []).map((e) => ({ ...e, quantity: e.quantity ?? '', value: e.value ?? '', description: e.description || '' })),
      vacation_settled_until: c.vacation_settled_until || '',
      observations: c.observations || '',
    });
    setEditingId(c.id);
    setTab('pessoa');
    setDialogOpen(true);
  };

  const onPositionChange = (id) => {
    const p = positions.find((x) => x.id === id);
    setForm((f) => ({
      ...f, position_id: id,
      department: f.department || p?.department || '',
      base_salary: f.base_salary || p?.salary_min || '',
    }));
  };

  const updateDependent = (i, k, v) => setForm((f) => ({ ...f, dependents: f.dependents.map((d, j) => (j === i ? { ...d, [k]: v } : d)) }));
  const updateEvent = (i, k, v) => setForm((f) => ({ ...f, recurring_events: f.recurring_events.map((d, j) => (j === i ? { ...d, [k]: v } : d)) }));
  const eventInput = (code) => meta.events.find((e) => e.code === code)?.input;

  const handleSave = async () => {
    if (!editingId && form.new_person) {
      if (!form.new_name.trim() || !form.new_cpf.trim()) { setTab('pessoa'); toast.error('Informe nome e CPF do novo funcionário'); return; }
    } else if (!form.person_id) { setTab('pessoa'); toast.error('Selecione o funcionário ou motorista na lista'); return; }
    if (!form.admission_date) { setTab('pessoa'); toast.error('Informe a data de admissão'); return; }
    if (!(Number(form.base_salary) > 0)) { setTab('remuneracao'); toast.error('Informe o salário'); return; }
    if (form.dependents.some((d) => !d.name.trim())) { setTab('dependentes'); toast.error('Informe o nome de cada dependente'); return; }
    setSaving(true);
    try {
      let personType = form.person_type;
      let personId = form.person_id;
      if (!editingId && form.new_person) {
        const created = await api.createEmployee({
          name: form.new_name.trim(), cpf: form.new_cpf.trim(), birth_date: form.new_birth || null, phone: form.new_phone || null,
        });
        personType = 'FUNCIONARIO';
        personId = created.data.id;
      }
      const payload = {
        person_type: personType, person_id: personId,
        position_id: form.position_id || null, department: form.department || null,
        contract_type: form.contract_type, admission_date: form.admission_date, experience_days: Number(form.experience_days) || 0,
        base_salary: Number(form.base_salary), weekly_hours: form.weekly_hours === '' ? null : Number(form.weekly_hours),
        work_schedule: form.work_schedule || null,
        insalubridade_grade: Number(form.insalubridade_grade) || 0, periculosidade: form.periculosidade,
        vt_opt_in: form.vt_opt_in, vt_monthly_cost: form.vt_monthly_cost === '' ? null : Number(form.vt_monthly_cost),
        salary_advance: form.salary_advance,
        pis: form.pis || null, ctps_number: form.ctps_number || null, ctps_series: form.ctps_series || null,
        bank_name: form.bank_name || null, bank_agency: form.bank_agency || null, bank_account: form.bank_account || null, pix_key: form.pix_key || null,
        dependents: form.dependents.map((d) => ({ ...d, cpf: d.cpf || null, birth_date: d.birth_date || null, relationship: d.relationship || null })),
        recurring_events: form.recurring_events.filter((e) => e.code).map((e) => ({
          code: e.code, description: e.description || null,
          quantity: eventInput(e.code) === 'VALUE' ? null : Number(e.quantity) || null,
          value: eventInput(e.code) === 'VALUE' ? Number(e.value) || null : null,
        })),
        vacation_settled_until: form.vacation_settled_until || null,
        observations: form.observations || null,
      };
      if (editingId) await api.updateHRContract(editingId, payload);
      else await api.createHRContract(payload);
      toast.success(editingId ? 'Contrato atualizado' : 'Admissão registrada');
      setDialogOpen(false);
      if (form.new_person) loadPeople();
      reload();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao salvar o contrato'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!single || !(await confirm(`Excluir o contrato de ${single.person_name}? Use só para um lançamento feito por engano.`))) return;
    try {
      await api.deleteHRContract(single.id);
      toast.success('Contrato excluído');
      reload();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao excluir'));
    }
  };

  const toggleLeave = async () => {
    if (!single) return;
    const next = single.status === 'AFASTADO' ? 'ATIVO' : 'AFASTADO';
    const msg = next === 'AFASTADO' ? `Marcar ${single.person_name} como afastado(a)?` : `Registrar o retorno de ${single.person_name} ao trabalho?`;
    if (!(await confirm(msg))) return;
    try {
      await api.updateHRContractStatus(single.id, next);
      toast.success('Situação atualizada');
      reload();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao atualizar'));
    }
  };

  // ===== Desligamento =====
  const openTermination = () => { setTermForm(EMPTY_TERMINATION); setTermPreview(null); setTermOpen(true); };
  const termPayload = (confirmIt) => ({
    termination_date: termForm.termination_date, termination_type: termForm.termination_type, notice_type: termForm.notice_type,
    reason: termForm.reason || null, fgts_balance: termForm.fgts_balance === '' ? null : Number(termForm.fgts_balance), confirm: confirmIt,
  });
  const simulate = async () => {
    setTermBusy(true);
    try {
      setTermPreview((await api.terminateHRContract(single.id, termPayload(false))).data);
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao simular a rescisão'));
    } finally {
      setTermBusy(false);
    }
  };
  // Mudou algum campo: a simulação mostrada deixa de valer
  const setTerm = (k, v) => { setTermForm((p) => ({ ...p, [k]: v })); setTermPreview(null); };
  const confirmTermination = async () => {
    if (!(await confirm(`Registrar o desligamento de ${single.person_name}? O contrato sai da folha e as férias programadas são canceladas.`))) return;
    setTermBusy(true);
    try {
      await api.terminateHRContract(single.id, termPayload(true));
      toast.success('Desligamento registrado');
      const id = single.id;
      setTermOpen(false);
      reload();
      saveBlob(() => api.getHRTerminationPDF(id), `Rescisao_${single.person_name}.pdf`);
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao registrar o desligamento'));
    } finally {
      setTermBusy(false);
    }
  };
  const reinstate = async () => {
    if (!single || !(await confirm(`Desfazer o desligamento de ${single.person_name}? O contrato volta a ficar ativo.`))) return;
    try {
      await api.reinstateHRContract(single.id);
      toast.success('Desligamento desfeito');
      reload();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao desfazer'));
    }
  };

  // Adiantamento quinzenal (vale) para os contratos selecionados
  const selectedList = list.filter((c) => selectedIds.has(c.id));
  const allAdvance = selectedList.length > 0 && selectedList.every((c) => c.salary_advance);
  const toggleAdvance = async () => {
    const enabled = !allAdvance;
    const n = selectedList.length;
    const msg = enabled
      ? `Ligar o adiantamento quinzenal (vale) para ${n} contrato(s)? Eles passam a entrar na folha "Adiantamento quinzenal".`
      : `Tirar o adiantamento quinzenal de ${n} contrato(s)?`;
    if (!(await confirm(msg))) return;
    try {
      const r = await api.setHRSalaryAdvance({ contract_ids: selectedList.map((c) => c.id), enabled });
      toast.success(`${r.data.updated} contrato(s) atualizado(s)`);
      reload();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao atualizar'));
    }
  };

  // Prorroga a experiência uma vez, antes do fim, até 90 dias no total
  const canExtend = !!(single && single.status !== 'DESLIGADO' && single.experience_days && !single.experience_initial_days
    && single.experience_end >= today && single.experience_days < 90);
  const extendExperience = async () => {
    try {
      await api.extendHRExperience(single.id, { total_days: Number(extendDays) });
      toast.success('Experiência prorrogada. O termo de prorrogação sai no Contrato de trabalho (PDF).');
      setExtendDays(null);
      reload();
    } catch (e) {
      toast.error(errorDetail(e, 'Erro ao prorrogar'));
    }
  };

  const hasFilters = !!(search || statusFilter !== 'VIGENTE' || typeFilter);
  const pickerPeople = activeRecords(people);
  const isVigente = single && single.status !== 'DESLIGADO';
  const noticeOptions = meta.notice_types.filter((n) => {
    if (termForm.termination_type === 'PEDIDO') return ['TRABALHADO', 'NAO_CUMPRIDO', 'DISPENSADO'].includes(n.value);
    if (['SEM_JUSTA_CAUSA', 'ACORDO'].includes(termForm.termination_type)) return ['TRABALHADO', 'INDENIZADO'].includes(n.value);
    return n.value === 'TRABALHADO';
  });
  useEffect(() => {
    if (noticeOptions.length && !noticeOptions.some((n) => n.value === termForm.notice_type)) {
      setTermForm((p) => ({ ...p, notice_type: noticeOptions[0].value }));
    }
  }, [termForm.termination_type, meta.notice_types]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout>
      <div className="space-y-4" data-testid="hr-contracts-page">
        <PageHeader icon={UserPlus} title="Admissão e Contratos"
          subtitle="Contrato de trabalho de cada funcionário: cargo, salário, adicionais, dependentes e desligamento" />

        <StatGrid>
          <StatCard label="Ativos" value={vigentes.filter((c) => c.status === 'ATIVO').length} icon={Users} tone="emerald" hint="com os filtros atuais" />
          <StatCard label="Afastados" value={vigentes.filter((c) => c.status === 'AFASTADO').length} icon={PauseCircle} tone="amber" />
          <StatCard label="Experiência vencendo" value={experienceSoon} icon={Hourglass} tone="blue" hint="nos próximos 15 dias" />
          <StatCard label="Salários base" value={formatMoney(vigentes.reduce((a, c) => a + (c.base_salary || 0), 0))} icon={Wallet} tone="slate" hint="contratos vigentes" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setStatusFilter('VIGENTE'); setTypeFilter(''); }}>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Nome, CPF ou cargo" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="hr-contracts-search" />
            </FilterField>
            <FilterField label="Situação">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-sm" data-testid="hr-contracts-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIGENTE">Vigentes</SelectItem>
                  <SelectItem value="ATIVO">Ativos</SelectItem>
                  <SelectItem value="AFASTADO">Afastados</SelectItem>
                  <SelectItem value="DESLIGADO">Desligados</SelectItem>
                  <SelectItem value="TODOS">Todos</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Tipo de contrato">
              <Select value={typeFilter || '_all'} onValueChange={(v) => setTypeFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {meta.contract_types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Contratos"
          count={loading ? '...' : list.length}
          footer={<TablePagination {...paginationProps} />}
          toolbar={(
            <Toolbar selectedCount={selectedIds.size} primary={<ToolbarPrimary icon={UserPlus} label="Nova admissão" onClick={openCreate} testId="hr-contract-new-btn" />}>
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => single && openEdit(single)} disabled={!isVigente} testId="hr-contract-edit-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={!single} testId="hr-contract-delete-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={single?.status === 'AFASTADO' ? PlayCircle : PauseCircle} label={single?.status === 'AFASTADO' ? 'Retorno ao trabalho' : 'Afastar'}
                tone="amber" onClick={toggleLeave} disabled={!isVigente} testId="hr-contract-leave-btn" />
              <ToolbarButton icon={UserX} label="Desligar (simular rescisão)" tone="red" onClick={openTermination} disabled={!isVigente} testId="hr-contract-terminate-btn" />
              <ToolbarButton icon={Undo2} label="Desfazer desligamento" tone="amber" onClick={reinstate} disabled={!single || single.status !== 'DESLIGADO'} testId="hr-contract-reinstate-btn" />
              <ToolbarButton icon={Hourglass} label="Prorrogar experiência" tone="amber" onClick={() => setExtendDays(90)} disabled={!canExtend} testId="hr-contract-extend-btn" />
              <ToolbarButton icon={Wallet} label={allAdvance ? 'Tirar adiantamento quinzenal' : 'Adiantamento quinzenal'} tone="blue"
                onClick={toggleAdvance} disabled={!selectedIds.size} testId="hr-contract-advance-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={FileSignature} label="Contrato de trabalho (PDF)" tone="primary"
                disabled={!single || !['CLT', 'EXPERIENCIA'].includes(single.contract_type)}
                onClick={() => saveBlob(() => api.getHRWorkContractPDF(single.id), `Contrato_${single.person_name}.pdf`)} testId="hr-work-contract-btn" />
              <ToolbarButton icon={FileText} label="Ficha do funcionário (PDF)" tone="primary" disabled={!single}
                onClick={() => saveBlob(() => api.getHRContractSheetPDF(single.id), `Ficha_${single.person_name}.pdf`)} testId="hr-contract-sheet-btn" />
              <ToolbarButton icon={FileSignature} label="Demonstrativo de rescisão (PDF)" tone="emerald" disabled={!single || single.status !== 'DESLIGADO'}
                onClick={() => saveBlob(() => api.getHRTerminationPDF(single.id), `Rescisao_${single.person_name}.pdf`)} testId="hr-contract-termination-pdf-btn" />
            </Toolbar>
          )}
        >
          {list.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0" />
                    <th>Mat.</th>
                    <th>Nome</th>
                    <th>Cargo</th>
                    <th>Setor</th>
                    <th>Tipo</th>
                    <th>Admissão</th>
                    <th className="!text-right">Salário</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((c) => (
                    <tr key={c.id} onClick={() => toggle(c.id)} data-selected={selectedIds.has(c.id)} className="cursor-pointer" data-testid={`hr-contract-row-${c.contract_number}`}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                      </td>
                      <td className="tabular-nums cell-strong">{c.contract_number}</td>
                      <td>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="cell-strong max-w-[220px] truncate" title={c.person_name}>{c.person_name}</span>
                          {c.person_type === 'MOTORISTA' && <StatusPill tone="slate" dot={false} className="text-[10px] px-1.5">Motorista</StatusPill>}
                          {c.salary_advance && <StatusPill tone="blue" dot={false} className="text-[10px] px-1.5" title="Recebe adiantamento quinzenal">Vale</StatusPill>}
                        </div>
                      </td>
                      <td>{c.position_name || '-'}</td>
                      <td>{c.department || '-'}</td>
                      <td className="whitespace-nowrap">{label('contract_types', c.contract_type)}</td>
                      <td className="tabular-nums whitespace-nowrap">
                        {fmtDate(c.admission_date)}
                        {c.experience_end && c.status !== 'DESLIGADO' && c.experience_end >= today && (
                          <span className="block text-[11px] text-amber-600 dark:text-amber-400">experiência até {fmtDate(c.experience_end)}</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums cell-strong whitespace-nowrap">{formatMoney(c.base_salary)}</td>
                      <td>
                        <StatusPill tone={CONTRACT_STATUS_TONES[c.status]}>{CONTRACT_STATUS[c.status]}</StatusPill>
                        {c.termination && <span className="block text-[11px] text-slate-500">{fmtDate(c.termination.termination_date)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={UserPlus} loading={loading} title={hasFilters ? 'Nenhum contrato encontrado' : 'Nenhuma admissão registrada'}
              hint={loading ? undefined : 'Registre a primeira pelo botão "Nova admissão"'} testId="hr-contracts-empty" />
          )}
        </DataCard>
      </div>

      {/* Admissão / edição */}
      <Dialog open={dialogOpen} onOpenChange={(v) => !saving && setDialogOpen(v)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="hr-contract-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <UserPlus className="w-5 h-5 text-primary" />{editingId ? 'Editar Contrato' : 'Nova Admissão'}
            </DialogTitle>
          </DialogHeader>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex flex-wrap h-auto">
              <TabsTrigger value="pessoa">Pessoa e cargo</TabsTrigger>
              <TabsTrigger value="remuneracao">Remuneração</TabsTrigger>
              <TabsTrigger value="documentos">Documentos e banco</TabsTrigger>
              <TabsTrigger value="dependentes">Dependentes ({form.dependents.length})</TabsTrigger>
              <TabsTrigger value="fixos">Lançamentos fixos ({form.recurring_events.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="pessoa" className="pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!editingId && (
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <Switch checked={form.new_person} onCheckedChange={(v) => setField('new_person', v)} data-testid="hr-contract-new-person" />
                    <span className="text-sm text-slate-600 dark:text-slate-300">Funcionário ainda não cadastrado (cadastrar agora)</span>
                  </div>
                )}
                {form.new_person && !editingId ? (
                  <>
                    <div className="sm:col-span-2">
                      <Label className="mb-1.5 block">Nome completo *</Label>
                      <Input value={form.new_name} onChange={(e) => setField('new_name', e.target.value)} className="h-9 text-sm" data-testid="hr-contract-new-name" />
                    </div>
                    <div>
                      <Label className="mb-1.5 block">CPF *</Label>
                      <Input value={form.new_cpf} onChange={(e) => setField('new_cpf', e.target.value)} className="h-9 text-sm" data-testid="hr-contract-new-cpf" />
                    </div>
                    <div>
                      <Label className="mb-1.5 block">Data de nascimento</Label>
                      <Input type="date" value={form.new_birth} onChange={(e) => setField('new_birth', e.target.value)} className="h-9 text-sm" />
                    </div>
                    <div>
                      <Label className="mb-1.5 block">Telefone</Label>
                      <Input value={form.new_phone} onChange={(e) => setField('new_phone', e.target.value)} className="h-9 text-sm" />
                    </div>
                  </>
                ) : (
                  <div className="sm:col-span-2">
                    <Label className="mb-1.5 block">Funcionário ou Motorista *</Label>
                    {editingId ? (
                      <div className="h-9 px-3 flex items-center rounded-md border border-input bg-muted text-sm">{form.person_label}</div>
                    ) : (
                      <Autocomplete
                        value={form.person_label}
                        onChange={(v) => setForm((p) => ({ ...p, person_label: v, person_id: '', person_type: '' }))}
                        onSelect={(p) => setForm((f) => ({ ...f, person_label: personLabel(p), person_id: p.id, person_type: p._type }))}
                        options={pickerPeople}
                        displayField={personLabel}
                        className="text-sm"
                        testId="hr-contract-person-input"
                      />
                    )}
                  </div>
                )}
                <div>
                  <Label className="mb-1.5 block">Cargo</Label>
                  <Select value={form.position_id || '_none'} onValueChange={(v) => onPositionChange(v === '_none' ? '' : v)}>
                    <SelectTrigger className="h-9 text-sm" data-testid="hr-contract-position"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sem cargo cadastrado</SelectItem>
                      {positions.filter((p) => p.status === 'ATIVO' || p.id === form.position_id).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Setor</Label>
                  <Input value={form.department} onChange={(e) => setField('department', e.target.value)} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Tipo de contrato *</Label>
                  <Select value={form.contract_type} onValueChange={(v) => setField('contract_type', v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {meta.contract_types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Data de admissão *</Label>
                  <Input type="date" value={form.admission_date} onChange={(e) => setField('admission_date', e.target.value)} className="h-9 text-sm" data-testid="hr-contract-admission" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Contrato de experiência</Label>
                  <Select value={String(form.experience_days)} onValueChange={(v) => setField('experience_days', Number(v))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[0, 30, 45, 60, 90].map((d) => <SelectItem key={d} value={String(d)}>{d ? `${d} dias` : 'Sem experiência'}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Jornada semanal (horas)</Label>
                  <Input type="number" min="0" value={form.weekly_hours} onChange={(e) => setField('weekly_hours', e.target.value)} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Horário de trabalho</Label>
                  <Input value={form.work_schedule} onChange={(e) => setField('work_schedule', e.target.value)} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Férias quitadas até</Label>
                  <Input type="date" value={form.vacation_settled_until} onChange={(e) => setField('vacation_settled_until', e.target.value)} className="h-9 text-sm" data-testid="hr-contract-vacation-settled" />
                  <p className="text-[11px] text-slate-500 mt-1">Para quem já trabalhava antes do sistema: períodos aquisitivos que terminam até essa data já tiveram as férias tiradas.</p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="remuneracao" className="pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block">Salário mensal (R$) *</Label>
                  <Input type="number" min="0" step="0.01" value={form.base_salary} onChange={(e) => setField('base_salary', e.target.value)} className="h-9 text-sm text-right" data-testid="hr-contract-salary" />
                  {selectedPosition && (selectedPosition.salary_min || selectedPosition.salary_max) && (
                    <p className="text-[11px] text-slate-500 mt-1">Faixa do cargo: {formatMoney(selectedPosition.salary_min)} a {formatMoney(selectedPosition.salary_max)}</p>
                  )}
                </div>
                <div>
                  <Label className="mb-1.5 block">Insalubridade</Label>
                  <Select value={String(form.insalubridade_grade)} onValueChange={(v) => setField('insalubridade_grade', Number(v))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Não</SelectItem>
                      <SelectItem value="10">Grau mínimo (10% do salário mínimo)</SelectItem>
                      <SelectItem value="20">Grau médio (20%)</SelectItem>
                      <SelectItem value="40">Grau máximo (40%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Switch checked={form.periculosidade} onCheckedChange={(v) => setField('periculosidade', v)} />
                  <span className="text-sm">Periculosidade (30% do salário)</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Switch checked={form.salary_advance} onCheckedChange={(v) => setField('salary_advance', v)} data-testid="hr-contract-advance" />
                  <span className="text-sm">Recebe adiantamento quinzenal (vale, % nas Tabelas de Cálculo)</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Switch checked={form.vt_opt_in} onCheckedChange={(v) => setField('vt_opt_in', v)} data-testid="hr-contract-vt" />
                  <span className="text-sm">Optante pelo vale-transporte (desconto de até 6%)</span>
                </div>
                {form.vt_opt_in && (
                  <div>
                    <Label className="mb-1.5 block">Custo mensal das passagens (R$)</Label>
                    <Input type="number" min="0" step="0.01" value={form.vt_monthly_cost} onChange={(e) => setField('vt_monthly_cost', e.target.value)} className="h-9 text-sm text-right" />
                    <p className="text-[11px] text-slate-500 mt-1">O desconto não passa desse valor.</p>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <Label className="mb-1.5 block">Observações</Label>
                  <Textarea value={form.observations} onChange={(e) => setField('observations', e.target.value)} className="text-sm min-h-[60px]" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="documentos" className="pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="mb-1.5 block">PIS/PASEP</Label>
                  <Input value={form.pis} onChange={(e) => setField('pis', e.target.value)} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="mb-1.5 block">CTPS (número)</Label>
                  <Input value={form.ctps_number} onChange={(e) => setField('ctps_number', e.target.value)} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="mb-1.5 block">CTPS (série)</Label>
                  <Input value={form.ctps_series} onChange={(e) => setField('ctps_series', e.target.value)} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Banco</Label>
                  <Input value={form.bank_name} onChange={(e) => setField('bank_name', e.target.value)} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Agência</Label>
                  <Input value={form.bank_agency} onChange={(e) => setField('bank_agency', e.target.value)} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Conta</Label>
                  <Input value={form.bank_account} onChange={(e) => setField('bank_account', e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="sm:col-span-3">
                  <Label className="mb-1.5 block">Chave PIX</Label>
                  <Input value={form.pix_key} onChange={(e) => setField('pix_key', e.target.value)} className="h-9 text-sm" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="dependentes" className="pt-3 space-y-2">
              {form.dependents.map((d, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end border-b border-slate-100 dark:border-slate-800 pb-2">
                  <div className="col-span-2 sm:col-span-4">
                    <Label className="mb-1 block text-xs">Nome *</Label>
                    <Input value={d.name} onChange={(e) => updateDependent(i, 'name', e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="mb-1 block text-xs">Parentesco</Label>
                    <Input value={d.relationship} onChange={(e) => updateDependent(i, 'relationship', e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="mb-1 block text-xs">Nascimento</Label>
                    <Input type="date" value={d.birth_date} onChange={(e) => updateDependent(i, 'birth_date', e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div className="sm:col-span-2 flex flex-col gap-1 text-xs">
                    <label className="flex items-center gap-1.5"><Checkbox checked={d.irrf} onCheckedChange={(v) => updateDependent(i, 'irrf', !!v)} />Deduz IRRF</label>
                    <label className="flex items-center gap-1.5"><Checkbox checked={d.family_allowance} onCheckedChange={(v) => updateDependent(i, 'family_allowance', !!v)} />Salário-família</label>
                  </div>
                  <div className="sm:col-span-2 flex justify-end">
                    <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive" aria-label="Remover dependente" title="Remover"
                      onClick={() => setForm((f) => ({ ...f, dependents: f.dependents.filter((_, j) => j !== i) }))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, dependents: [...f.dependents, { name: '', cpf: '', birth_date: '', relationship: '', irrf: true, family_allowance: false }] }))}
                data-testid="hr-contract-add-dependent">
                <Plus className="w-4 h-4 mr-1" />Adicionar dependente
              </Button>
              <p className="text-[11px] text-slate-500">O salário-família vale para filhos de até 14 anos, enquanto a remuneração estiver dentro do limite da tabela.</p>
            </TabsContent>

            <TabsContent value="fixos" className="pt-3 space-y-2">
              <p className="text-[12px] text-slate-500">Lançamentos que entram em toda folha mensal (plano de saúde, pensão, vale-refeição...). Podem ser ajustados em cada contracheque.</p>
              {form.recurring_events.map((ev, i) => {
                const input = eventInput(ev.code);
                return (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                    <div className="col-span-2 sm:col-span-5">
                      <Label className="mb-1 block text-xs">Lançamento</Label>
                      <Select value={ev.code || undefined} onValueChange={(v) => updateEvent(i, 'code', v)}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {meta.events.map((e) => <SelectItem key={e.code} value={e.code}>{e.number} - {e.label} ({e.kind === 'P' ? 'provento' : 'desconto'})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="mb-1 block text-xs">{input === 'VALUE' ? 'Valor (R$)' : input === 'DAYS' ? 'Dias' : 'Horas'}</Label>
                      <Input type="number" min="0" step="0.01" value={input === 'VALUE' ? ev.value : ev.quantity}
                        onChange={(e) => updateEvent(i, input === 'VALUE' ? 'value' : 'quantity', e.target.value)} className="h-9 text-sm text-right" />
                    </div>
                    <div className="sm:col-span-4">
                      <Label className="mb-1 block text-xs">Descrição no contracheque</Label>
                      <Input value={ev.description} onChange={(e) => updateEvent(i, 'description', e.target.value)} className="h-9 text-sm" />
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive" aria-label="Remover lançamento" title="Remover"
                        onClick={() => setForm((f) => ({ ...f, recurring_events: f.recurring_events.filter((_, j) => j !== i) }))}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              <Button variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, recurring_events: [...f.recurring_events, { code: '', quantity: '', value: '', description: '' }] }))}>
                <Plus className="w-4 h-4 mr-1" />Adicionar lançamento fixo
              </Button>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="hr-contract-save-btn">
              <Save className="w-4 h-4 mr-2" />{saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Registrar admissão'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Desligamento */}
      <Dialog open={extendDays !== null} onOpenChange={(v) => !v && setExtendDays(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Prorrogar experiência</DialogTitle>
            <DialogDescription>
              {single?.person_name}: {single?.experience_days} dias, até {fmtDate(single?.experience_end)}. A prorrogação é feita uma única vez,
              antes do fim, e o total não passa de 90 dias.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block">Prazo total da experiência (dias)</Label>
            <Input type="number" min={(single?.experience_days || 0) + 1} max={90} value={extendDays ?? ''}
              onChange={(e) => setExtendDays(e.target.value)} className="h-9 text-sm" data-testid="hr-extend-days" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendDays(null)}>Cancelar</Button>
            <Button onClick={extendExperience} data-testid="hr-extend-confirm"><Hourglass className="w-4 h-4 mr-2" />Prorrogar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={termOpen} onOpenChange={(v) => !termBusy && setTermOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="hr-termination-dialog">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base"><UserX className="w-5 h-5 text-destructive" />Desligamento</DialogTitle>
            <DialogDescription>{single?.person_name} · admissão em {fmtDate(single?.admission_date)}. Simule a rescisão antes de confirmar.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block">Data do desligamento *</Label>
              <Input type="date" value={termForm.termination_date} onChange={(e) => setTerm('termination_date', e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="mb-1.5 block">Motivo *</Label>
              <Select value={termForm.termination_type} onValueChange={(v) => setTerm('termination_type', v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="hr-termination-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {meta.termination_types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">Aviso prévio</Label>
              <Select value={termForm.notice_type} onValueChange={(v) => setTerm('notice_type', v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {noticeOptions.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">Saldo do FGTS (R$)</Label>
              <Input type="number" min="0" step="0.01" value={termForm.fgts_balance} onChange={(e) => setTerm('fgts_balance', e.target.value)} className="h-9 text-sm text-right" />
              <p className="text-[11px] text-slate-500 mt-1">Vazio: estimado pelas folhas e férias pagas no sistema.</p>
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block">Observações</Label>
              <Textarea value={termForm.reason} onChange={(e) => setTerm('reason', e.target.value)} className="text-sm min-h-[50px]" />
            </div>
          </div>

          {termPreview && (
            <div className="space-y-2" data-testid="hr-termination-preview">
              {termPreview.calc.early_experience && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  Experiência encerrada antes do prazo ({termPreview.calc.experience_remaining_days} dias restantes): não há aviso prévio.
                  {termForm.termination_type === 'PEDIDO'
                    ? ' O empregado indeniza metade dos dias restantes (art. 480) só se o aviso estiver como "Não cumprido".'
                    : ' A empresa indeniza metade dos dias restantes (art. 479).'}
                </p>
              )}
              <table className="data-table">
                <thead><tr><th>Verba</th><th>Ref.</th><th className="!text-right">Vencimentos</th><th className="!text-right">Descontos</th></tr></thead>
                <tbody>
                  {termPreview.calc.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.label}</td>
                      <td className="tabular-nums">{it.reference || ''}</td>
                      <td className="text-right tabular-nums">{it.kind === 'P' ? formatMoney(it.value) : ''}</td>
                      <td className="text-right tabular-nums text-destructive">{it.kind === 'D' ? formatMoney(it.value) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Líquido a pagar</td>
                    <td className="text-right tabular-nums">{formatMoney(termPreview.calc.gross)}</td>
                    <td className="text-right tabular-nums">{formatMoney(termPreview.calc.net)}</td>
                  </tr>
                </tfoot>
              </table>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                <div className="rounded-md bg-muted p-2"><div className="text-slate-500">Dias de aviso</div><div className="font-semibold">{termPreview.calc.notice_days}</div></div>
                <div className="rounded-md bg-muted p-2"><div className="text-slate-500">FGTS considerado</div><div className="font-semibold">{formatMoney(termPreview.calc.fgts_balance)}</div></div>
                <div className="rounded-md bg-muted p-2"><div className="text-slate-500">Multa FGTS ({termPreview.calc.fgts_fine_rate}%)</div><div className="font-semibold">{formatMoney(termPreview.calc.fgts_fine)}</div></div>
                <div className="rounded-md bg-muted p-2"><div className="text-slate-500">Saque FGTS</div><div className="font-semibold">{termPreview.calc.fgts_withdraw}</div></div>
              </div>
              <p className="text-[11px] text-slate-500">Simulação para conferência: médias de variáveis e multas específicas devem ser conferidas pela contabilidade.</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTermOpen(false)} disabled={termBusy}>Cancelar</Button>
            <Button variant="outline" onClick={simulate} disabled={termBusy} data-testid="hr-termination-simulate">
              <Calculator className="w-4 h-4 mr-2" />Simular rescisão
            </Button>
            <Button variant="destructive" onClick={confirmTermination} disabled={termBusy || !termPreview} data-testid="hr-termination-confirm">
              <UserX className="w-4 h-4 mr-2" />Confirmar desligamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
