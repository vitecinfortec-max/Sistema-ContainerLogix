import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, PlateTag, EmptyState, TablePagination, StatCard, StatGrid,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import { useCompanySettings } from '../lib/useCompanySettings';
import { motion } from '../components/Motion';
import { cn } from '../lib/utils';
import ChecklistFormDialog from '../components/checklist/ChecklistFormDialog';
import ChecklistDetailDialog from '../components/checklist/ChecklistDetailDialog';
import ChecklistPrintView from '../components/checklist/ChecklistPrintView';
import {
  RESULT_META, VEHICLE_TYPE_ICONS, VEHICLE_TYPE_LABELS, checklistItems, checklistResult, countAnswers,
} from '../components/checklist/checklistShared';
import {
  ClipboardCheck, Plus, Eye, Pencil, Trash2, Printer, X, CheckCircle2, XCircle, AlertTriangle,
  Camera, ShieldCheck, ShieldAlert, CircleDashed,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Toggle SIM/NÃO compacto por item
function SimNaoToggle({ value, onChange, testId }) {
  return (
    <div className="flex gap-1 flex-shrink-0">
      <button
        type="button"
        data-testid={testId ? `${testId}-sim` : undefined}
        onClick={() => onChange(value === 'SIM' ? null : 'SIM')}
        className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
          value === 'SIM'
            ? 'bg-green-600 border-green-600 text-white'
            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-green-400'
        }`}
      >
        Sim
      </button>
      <button
        type="button"
        data-testid={testId ? `${testId}-nao` : undefined}
        onClick={() => onChange(value === 'NAO' ? null : 'NAO')}
        className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
          value === 'NAO'
            ? 'bg-red-600 border-red-600 text-white'
            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-red-400'
        }`}
      >
        Não
      </button>
    </div>
  );
}

const emptyForm = {
  template: 'generic',
  expedidor: '',
  un: '',
  inspection_datetime: '',
  scheduling_code: '',
  un_address: '',
  phone: '',
  fax: '',
  client_id: '',
  client_name: '',
  orp_odp_number: '',
  nf_number: '',
  transport_company_id: '',
  transport_company_name: '',
  driver_id: '',
  driver_name: '',
  driver_cpf: '',
  products_description: '',
  cavalo_plate: '',
  cavalo_year: '',
  carreta1_plate: '',
  carreta1_year: '',
  carreta1_capacity: '',
  carreta2_plate: '',
  carreta2_year: '',
  carreta2_capacity: '',
  cnh_number: '',
  cnh_category: '',
  cnh_expiry: '',
  sap_code: '',
  documentos_items: [],
  vehicle_condition_items: [],
  epi_items: [],
  kit_items: [],
  tank_items: [],
  post_loading_items: [],
  products: [],
  kit_validity_1: '',
  kit_validity_2: '',
  kit_validity_3: '',
  last_trip_product_1: '',
  last_trip_product_2: '',
  last_trip_product_3: '',
  observations: '',
  transport_responsible_name: '',
  transport_responsible_rg: '',
  lvt_receiver_name: '',
  lvt_receiver_registration: '',
  inspection_responsible_name: '',
  inspection_responsible_registration: '',
  merit_record: '',
  occurrence_record: '',
  driver_document: '',
  release_datetime: '',
};

const SECTION_FIELD_BY_KEY = {
  documentos: 'documentos_items',
  vehicle_condition: 'vehicle_condition_items',
  epi: 'epi_items',
  kit: 'kit_items',
  tank: 'tank_items',
  post_loading: 'post_loading_items',
};

const PAGE_SIZE = 15;

const RESULT_FILTERS = [
  { value: '', label: 'Todos', stat: 'total' },
  { value: 'APROVADO', label: 'Aprovados', stat: 'approved' },
  { value: 'REPROVADO', label: 'Reprovados', stat: 'failed' },
  { value: 'PENDENTE', label: 'Pendentes', stat: 'pending' },
];

const resultBadge = (result) => (
  <StatusPill tone={RESULT_META[result]?.tone || 'slate'}>{RESULT_META[result]?.label || result}</StatusPill>
);

const formatWhen = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? format(date, 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-';
};

// Barra da conferência: verde = itens conformes, vermelho = reprovados, o
// resto (cinza) = ainda sem resposta
function AnswerBar({ counts }) {
  if (!counts.total) return <span className="text-slate-400">-</span>;
  const width = (n) => `${(n / counts.total) * 100}%`;
  return (
    <div className="flex min-w-[130px] items-center gap-2" title={`${counts.ok} conforme(s), ${counts.failed} reprovado(s), ${counts.pending} sem resposta`}>
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <motion.div className="h-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: width(counts.ok) }} transition={{ duration: 0.5, ease: 'easeOut' }} />
        <motion.div className="h-full bg-red-500" initial={{ width: 0 }} animate={{ width: width(counts.failed) }} transition={{ duration: 0.5, ease: 'easeOut' }} />
      </div>
      <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{counts.answered}/{counts.total}</span>
    </div>
  );
}

const share = (part, total) => (total ? `${Math.round((part / total) * 100)}% do total` : undefined);

export default function VehicleChecklistPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const company = useCompanySettings();
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');       // o que está no campo
  const [appliedSearch, setAppliedSearch] = useState('');   // o que a lista usa (pouco depois de parar de digitar)
  const [resultFilter, setResultFilter] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [stats, setStats] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const requestSeq = useRef(0);

  const [clients, setClients] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [template, setTemplate] = useState([]);

  // Modal legado (LVT/ANTT/Manuport) - só usado hoje pra editar/consultar
  // checklists antigos já existentes. Checklists novos (e a edição dos do
  // modelo atual) usam o ChecklistFormDialog.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingChecklist, setEditingChecklist] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(emptyForm);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedChecklist, setSelectedChecklist] = useState(null);

  // Modelo atual: formulário em etapas e impressão pelo navegador
  const [formOpen, setFormOpen] = useState(false);
  const [formChecklist, setFormChecklist] = useState(null);
  const [printJob, setPrintJob] = useState(null);

  useEffect(() => {
    loadSelectData();
  }, []);

  // Busca enquanto digita (com uma pequena espera)
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(searchQuery.trim());
      setPagination((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    loadChecklists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, appliedSearch, resultFilter]);

  const loadSelectData = async () => {
    try {
      const [clientsRes, companiesRes, driversRes, vehiclesRes, templateRes] = await Promise.all([
        api.getClients(),
        api.getCompanies(),
        api.getDrivers(),
        api.getVehicles({ per_page: 1000 }),
        api.getVehicleChecklistTemplate(),
      ]);
      setClients(clientsRes.data);
      setCompanies(companiesRes.data);
      setDrivers(driversRes.data);
      setVehicles(vehiclesRes.data.items || []);
      setTemplate(templateRes.data.sections || []);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      toast.error('Erro ao carregar dados');
    }
  };

  const loadChecklists = async () => {
    requestSeq.current += 1;
    const seq = requestSeq.current;
    setLoading(true);
    try {
      const params = { page: pagination.page, per_page: PAGE_SIZE };
      if (appliedSearch) params.search = appliedSearch;
      if (resultFilter) params.result = resultFilter;
      const [response, statsResponse] = await Promise.all([
        api.getVehicleChecklists(params),
        // Os indicadores são um extra: se falharem, a lista continua funcionando
        api.getVehicleChecklistStats(appliedSearch ? { search: appliedSearch } : {}).catch(() => null),
      ]);
      if (seq !== requestSeq.current) return; // chegou depois de uma busca mais nova
      setChecklists(response.data.items);
      setPagination(prev => ({ ...prev, pages: response.data.pages, total: response.data.total }));
      setStats(statsResponse && typeof statsResponse.data?.total === 'number' ? statsResponse.data : null);
    } catch (error) {
      if (seq === requestSeq.current) toast.error('Erro ao carregar checklists');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setResultFilter('');
  };

  const applyResultFilter = (value) => {
    setResultFilter(value);
    setPagination((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
  };

  const cavalos = vehicles.filter(v => v.vehicle_type === 'CAVALO' || v.vehicle_type === 'CAMINHÃO');
  const carretas = vehicles.filter(v => v.vehicle_type === 'CARRETA');

  const buildItemsFromTemplate = () => {
    const result = {};
    template.forEach(section => {
      result[SECTION_FIELD_BY_KEY[section.key]] = section.items.map(text => ({ text, answer: null, expiry: null }));
    });
    return result;
  };

  const resetForm = () => {
    setFormData({ ...emptyForm, ...buildItemsFromTemplate() });
    setEditingChecklist(null);
  };

  const openEditModal = (checklist) => {
    setEditingChecklist(checklist);
    setFormData({ ...emptyForm, ...checklist });
    setModalOpen(true);
  };

  const viewDetails = (checklist) => {
    setSelectedChecklist(checklist);
    setDetailModalOpen(true);
  };

  const updateItem = (sectionField, index, patch) => {
    setFormData(prev => {
      const items = [...prev[sectionField]];
      items[index] = { ...items[index], ...patch };
      return { ...prev, [sectionField]: items };
    });
  };

  const addProduct = () => {
    setFormData(prev => ({ ...prev, products: [...prev.products, { product: '', un_number: '', risk_number: '', subclass: '' }] }));
  };

  const updateProduct = (index, field, value) => {
    setFormData(prev => {
      const products = [...prev.products];
      products[index] = { ...products[index], [field]: value };
      return { ...prev, products };
    });
  };

  const removeProduct = (index) => {
    setFormData(prev => ({ ...prev, products: prev.products.filter((_, i) => i !== index) }));
  };

  const handleSubmit = async () => {
    if (!formData.driver_name || !formData.cavalo_plate) {
      toast.error('Preencha ao menos o motorista e a placa do cavalo');
      return;
    }
    setSaving(true);
    try {
      if (editingChecklist) {
        await api.updateVehicleChecklist(editingChecklist.id, formData);
        toast.success('Checklist atualizado com sucesso!');
      } else {
        await api.createVehicleChecklist(formData);
        toast.success('Checklist criado com sucesso!');
      }
      setModalOpen(false);
      resetForm();
      loadChecklists();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar checklist');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir este checklist?'))) return;
    try {
      await api.deleteVehicleChecklist(id);
      toast.success('Checklist excluído!');
      setSelectedIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadChecklists();
    } catch (error) {
      toast.error('Erro ao excluir');
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = checklists.map((c) => c.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handlePrint = async (id) => {
    try {
      const response = await api.getVehicleChecklistPDF(id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `checklist_veiculo_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    }
  };

  const renderItemsSection = (sectionKey, label) => {
    const fieldName = SECTION_FIELD_BY_KEY[sectionKey];
    const items = formData[fieldName] || [];
    if (items.length === 0) return null;
    const hasExpiry = sectionKey === 'documentos';

    return (
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-primary/10 px-4 py-2">
          <h4 className="text-sm font-semibold text-primary">{label}</h4>
        </div>
        <div className="divide-y">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-xs text-slate-400 dark:text-slate-500 w-5 flex-shrink-0">{idx + 1}</span>
              <span className="text-sm flex-1">{item.text}</span>
              {hasExpiry && (
                <Input
                  type="date"
                  value={item.expiry || ''}
                  onChange={(e) => updateItem(fieldName, idx, { expiry: e.target.value })}
                  className="h-8 w-40 text-xs flex-shrink-0"
                  data-testid={`checklist-item-expiry-${sectionKey}-${idx}`}
                />
              )}
              <SimNaoToggle
                value={item.answer}
                onChange={(v) => updateItem(fieldName, idx, { answer: v })}
                testId={`checklist-item-${sectionKey}-${idx}`}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ===== Modelo atual =====

  const openNewChecklist = () => {
    setFormChecklist(null);
    setFormOpen(true);
  };

  const openEdit = (checklist) => {
    setDetailModalOpen(false);
    if (checklist.checklist_kind === 'simple') {
      setFormChecklist(checklist);
      setFormOpen(true);
    } else {
      openEditModal(checklist);
    }
  };

  const printChecklist = (checklist) => {
    if (checklist.checklist_kind !== 'simple') {
      handlePrint(checklist.id);
      return;
    }
    // Fecha os detalhes antes: a janela fica fora da área .no-print e sairia
    // por cima do documento. A impressão dispara quando as fotos carregam.
    setDetailModalOpen(false);
    setPrintJob({ checklist, key: Date.now() });
  };

  const singleSelectedChecklist = selectedIds.size === 1 ? checklists.find((c) => c.id === [...selectedIds][0]) : null;
  const hasFilters = !!searchQuery || !!resultFilter;
  const detailIsSimple = selectedChecklist?.checklist_kind === 'simple';

  return (
    <Layout>
      {printJob && (
        <ChecklistPrintView key={printJob.key} checklist={printJob.checklist} company={company} onReady={() => window.print()} />
      )}

      <div className="space-y-4 no-print">
        <PageHeader icon={ClipboardCheck} title="Checklist de Veículo" subtitle="Conferência do veículo e registro fotográfico antes da viagem" />

        {stats && (
          <StatGrid>
            <StatCard label="Checklists" value={stats.total} icon={ClipboardCheck} tone="primary" hint={appliedSearch ? 'Dentro da busca' : undefined} testId="checklist-stat-total" />
            <StatCard label="Aprovados" value={stats.approved} icon={ShieldCheck} tone="emerald" hint={share(stats.approved, stats.total)} testId="checklist-stat-approved" />
            <StatCard label="Reprovados" value={stats.failed} icon={ShieldAlert} tone="red" hint={share(stats.failed, stats.total)} testId="checklist-stat-failed" />
            <StatCard label="Pendentes" value={stats.pending} icon={CircleDashed} tone="amber" hint={share(stats.pending, stats.total)} testId="checklist-stat-pending" />
          </StatGrid>
        )}

        <FilterCard hasFilters={hasFilters} onClear={clearFilters}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <FilterField label="Placa, motorista, vistoriador ou cliente">
              <SearchInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="checklist-search"
              />
            </FilterField>
            <FilterField label="Resultado" className="lg:col-span-2">
              <div className="flex flex-wrap gap-1.5" role="group" data-testid="checklist-result-filter">
                {RESULT_FILTERS.map(({ value, label, stat }) => {
                  const active = resultFilter === value;
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => applyResultFilter(value)}
                      data-testid={`checklist-result-${value || 'all'}`}
                      className={cn(
                        'relative h-9 rounded-md border px-3 text-[13px] font-medium transition-colors',
                        active
                          ? 'border-primary text-primary'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600',
                      )}
                    >
                      {active && <motion.span layoutId="checklist-result-pill" className="absolute inset-0 rounded-md bg-primary/10" />}
                      <span className="relative">
                        {label}
                        {stats && <span className="ml-1.5 tabular-nums text-xs opacity-70">{stats[stat]}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </FilterField>
          </div>
        </FilterCard>

        {/* Lista - marque um checklist pra habilitar as ações da barra (ou dê dois cliques pra ver os detalhes) */}
        <DataCard
          title="Checklists"
          count={loading && checklists.length === 0 ? '...' : pagination.total}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo checklist" onClick={openNewChecklist} testId="new-checklist-button" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedChecklist && viewDetails(singleSelectedChecklist)} disabled={!singleSelectedChecklist} />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedChecklist && openEdit(singleSelectedChecklist)} disabled={!singleSelectedChecklist} />
              <ToolbarButton icon={Printer} label="Imprimir" tone="emerald" onClick={() => singleSelectedChecklist && printChecklist(singleSelectedChecklist)} disabled={!singleSelectedChecklist} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedChecklist && handleDelete(singleSelectedChecklist.id)} disabled={!singleSelectedChecklist} />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            />
          )}
        >
          {loading && checklists.length === 0 ? (
            <EmptyState title="Carregando..." />
          ) : checklists.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Nenhum checklist encontrado"
              hint={hasFilters ? 'Ajuste a busca ou o filtro de resultado' : 'Registre o primeiro pelo botão "Novo checklist"'}
            />
          ) : (
            <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={checklists.length > 0 && checklists.every((c) => selectedIds.has(c.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th>Nº</th>
                    <th>Data</th>
                    <th>Placa</th>
                    <th>Tipo / Cliente</th>
                    <th>Motorista</th>
                    <th>Vistoriador</th>
                    <th>Conferência</th>
                    <th>Fotos</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {checklists.map((c) => {
                    const isSimple = c.checklist_kind === 'simple';
                    const TypeIcon = VEHICLE_TYPE_ICONS[c.vehicle_type];
                    return (
                      <tr
                        key={c.id}
                        onClick={() => toggleSelect(c.id)}
                        onDoubleClick={() => viewDetails(c)}
                        data-selected={selectedIds.has(c.id)}
                        className="cursor-pointer"
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(c.id)}
                            onCheckedChange={() => toggleSelect(c.id)}
                            data-testid="checklist-row-checkbox"
                          />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{c.checklist_number}</td>
                        <td className="whitespace-nowrap tabular-nums">{formatWhen(c.inspection_datetime || c.created_at)}</td>
                        <td><PlateTag>{isSimple ? c.vehicle_plate : c.cavalo_plate}</PlateTag></td>
                        <td>
                          {isSimple ? (
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                              {TypeIcon && <TypeIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" />}
                              {VEHICLE_TYPE_LABELS[c.vehicle_type] || '-'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <span className="max-w-[200px] truncate" title={c.client_name || ''}>{c.client_name || '-'}</span>
                              {c.template === 'petrobras_lvt' && (
                                <StatusPill tone="emerald" dot={false} className="text-[10px] px-1.5">LVT</StatusPill>
                              )}
                            </span>
                          )}
                        </td>
                        <td><div className="max-w-[200px] truncate" title={c.driver_name || ''}>{c.driver_name || '-'}</div></td>
                        <td><div className="max-w-[160px] truncate" title={c.vistoriador_name || ''}>{c.vistoriador_name || '-'}</div></td>
                        <td><AnswerBar counts={countAnswers(checklistItems(c))} /></td>
                        <td className="whitespace-nowrap">
                          {isSimple ? (
                            <span className="inline-flex items-center gap-1 tabular-nums text-slate-500 dark:text-slate-400">
                              <Camera className="h-3.5 w-3.5" /> {(c.photos || []).length}
                            </span>
                          ) : <span className="text-slate-400">-</span>}
                        </td>
                        <td>{resultBadge(checklistResult(c))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      {/* Criar/editar e detalhes - modelo atual */}
      <ChecklistFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        checklist={formChecklist}
        drivers={drivers}
        vehicles={vehicles}
        onSaved={loadChecklists}
      />
      <ChecklistDetailDialog
        open={detailModalOpen && detailIsSimple}
        onOpenChange={setDetailModalOpen}
        checklist={detailIsSimple ? selectedChecklist : null}
        onEdit={openEdit}
        onPrint={printChecklist}
      />

      {/* Modal Criar/Editar legado (LVT/ANTT) - só reaproveitado hoje pra editar
          checklists antigos já existentes (ver openEditModal) */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) resetForm(); setModalOpen(open); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              {editingChecklist ? 'Editar Checklist de Veículo' : 'Novo Checklist de Veículo'}
              {formData.template === 'petrobras_lvt' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-800">
                  Modelo Petrobras (LVT)
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Informações Gerais */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Informações Gerais</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Expedidor</Label>
                  <Input
                    value={formData.expedidor}
                    onChange={(e) => setFormData(prev => ({ ...prev, expedidor: e.target.value }))}
                    disabled={formData.template === 'petrobras_lvt'}
                  />
                </div>
                <div>
                  <Label>UN</Label>
                  <Input value={formData.un} onChange={(e) => setFormData(prev => ({ ...prev, un: e.target.value }))} />
                </div>
                <div>
                  <Label>Cód. Agendamento</Label>
                  <Input value={formData.scheduling_code} onChange={(e) => setFormData(prev => ({ ...prev, scheduling_code: e.target.value }))} />
                </div>
                <div>
                  <Label>Data e Hora da Vistoria</Label>
                  <Input type="datetime-local" value={formData.inspection_datetime} onChange={(e) => setFormData(prev => ({ ...prev, inspection_datetime: e.target.value }))} />
                </div>
                <div>
                  <Label>Endereço da UN</Label>
                  <Input value={formData.un_address} onChange={(e) => setFormData(prev => ({ ...prev, un_address: e.target.value }))} />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input value={formData.phone} onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))} />
                </div>
                <div>
                  <Label>Fax</Label>
                  <Input value={formData.fax} onChange={(e) => setFormData(prev => ({ ...prev, fax: e.target.value }))} />
                </div>
                <div>
                  <Label>Cliente</Label>
                  <Autocomplete
                    value={formData.client_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, client_name: val, client_id: '' }))}
                    options={clients}
                    displayField="name"
                    onSelect={(c) => setFormData(prev => ({ ...prev, client_id: c.id, client_name: c.name }))}
                  />
                </div>
                <div>
                  <Label>Transportadora</Label>
                  <Autocomplete
                    value={formData.transport_company_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, transport_company_name: val, transport_company_id: '' }))}
                    options={companies}
                    displayField="name"
                    onSelect={(c) => setFormData(prev => ({ ...prev, transport_company_id: c.id, transport_company_name: c.name }))}
                  />
                </div>
                <div>
                  <Label>Número ORP / ODP</Label>
                  <Input value={formData.orp_odp_number} onChange={(e) => setFormData(prev => ({ ...prev, orp_odp_number: e.target.value }))} />
                </div>
                <div>
                  <Label>Número da NF (Descarga)</Label>
                  <Input value={formData.nf_number} onChange={(e) => setFormData(prev => ({ ...prev, nf_number: e.target.value }))} />
                </div>
                <div>
                  <Label>Produto(s)</Label>
                  <Input value={formData.products_description} onChange={(e) => setFormData(prev => ({ ...prev, products_description: e.target.value }))} />
                </div>
                <div>
                  <Label>Código SAP</Label>
                  <Input value={formData.sap_code} onChange={(e) => setFormData(prev => ({ ...prev, sap_code: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Motorista e Veículo */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Motorista e Veículo</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Motorista *</Label>
                  <Autocomplete
                    value={formData.driver_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, driver_name: val, driver_id: '' }))}
                    options={drivers}
                    displayField="name"
                    onSelect={(d) => setFormData(prev => ({ ...prev, driver_id: d.id, driver_name: d.name, driver_cpf: d.cpf || '' }))}
                  />
                </div>
                <div>
                  <Label>CPF do Motorista</Label>
                  <Input value={formData.driver_cpf} onChange={(e) => setFormData(prev => ({ ...prev, driver_cpf: e.target.value }))} />
                </div>
                <div>
                  <Label>Nº CNH / Categoria</Label>
                  <div className="flex gap-2">
                    <Input value={formData.cnh_number} onChange={(e) => setFormData(prev => ({ ...prev, cnh_number: e.target.value }))} />
                    <Input value={formData.cnh_category} onChange={(e) => setFormData(prev => ({ ...prev, cnh_category: e.target.value.toUpperCase() }))} className="w-20" />
                  </div>
                </div>
                <div>
                  <Label>Vencimento CNH</Label>
                  <Input type="date" value={formData.cnh_expiry} onChange={(e) => setFormData(prev => ({ ...prev, cnh_expiry: e.target.value }))} />
                </div>
                <div>
                  <Label>Placa do Cavalo *</Label>
                  <Autocomplete
                    value={formData.cavalo_plate}
                    onChange={(val) => setFormData(prev => ({ ...prev, cavalo_plate: val.toUpperCase() }))}
                    options={cavalos}
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    onSelect={(v) => setFormData(prev => ({ ...prev, cavalo_plate: v.plate, cavalo_year: v.year ? String(v.year) : prev.cavalo_year }))}
                  />
                </div>
                <div>
                  <Label>Ano de Fabricação do Cavalo</Label>
                  <Input value={formData.cavalo_year} onChange={(e) => setFormData(prev => ({ ...prev, cavalo_year: e.target.value }))} />
                </div>
                <div>
                  <Label>Placa Carreta 1</Label>
                  <Autocomplete
                    value={formData.carreta1_plate}
                    onChange={(val) => setFormData(prev => ({ ...prev, carreta1_plate: val.toUpperCase() }))}
                    options={carretas}
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    onSelect={(v) => setFormData(prev => ({ ...prev, carreta1_plate: v.plate, carreta1_year: v.year ? String(v.year) : prev.carreta1_year }))}
                  />
                </div>
                <div>
                  <Label>Ano Carreta 1</Label>
                  <Input value={formData.carreta1_year} onChange={(e) => setFormData(prev => ({ ...prev, carreta1_year: e.target.value }))} />
                </div>
                <div>
                  <Label>Capacidade Carreta 1</Label>
                  <Input value={formData.carreta1_capacity} onChange={(e) => setFormData(prev => ({ ...prev, carreta1_capacity: e.target.value }))} />
                </div>
                <div>
                  <Label>Placa Carreta 2</Label>
                  <Autocomplete
                    value={formData.carreta2_plate}
                    onChange={(val) => setFormData(prev => ({ ...prev, carreta2_plate: val.toUpperCase() }))}
                    options={carretas}
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    onSelect={(v) => setFormData(prev => ({ ...prev, carreta2_plate: v.plate, carreta2_year: v.year ? String(v.year) : prev.carreta2_year }))}
                  />
                </div>
                <div>
                  <Label>Ano Carreta 2</Label>
                  <Input value={formData.carreta2_year} onChange={(e) => setFormData(prev => ({ ...prev, carreta2_year: e.target.value }))} />
                </div>
                <div>
                  <Label>Capacidade Carreta 2</Label>
                  <Input value={formData.carreta2_capacity} onChange={(e) => setFormData(prev => ({ ...prev, carreta2_capacity: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Itens do checklist */}
            <div className="space-y-4">
              <h3 className="font-semibold">Itens de Verificação</h3>
              {renderItemsSection('documentos', 'Documentos')}
              {renderItemsSection('vehicle_condition', 'Condições do Veículo')}
              {renderItemsSection('epi', 'EPI')}
              {renderItemsSection('kit', 'Kit')}
              {renderItemsSection('tank', 'Condições do Tanque / Carreta')}
              {renderItemsSection('post_loading', 'Documentos Pós Carregamento')}
            </div>

            {/* Produtos */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Produtos Transportados</h3>
                <Button type="button" variant="outline" size="sm" onClick={addProduct}>
                  <Plus className="w-4 h-4 mr-1" />
                  Adicionar Produto
                </Button>
              </div>
              {formData.products.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum produto adicionado</p>
              ) : (
                <div className="space-y-2">
                  {formData.products.map((p, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <Input className="col-span-5 h-9" value={p.product} onChange={(e) => updateProduct(idx, 'product', e.target.value)} />
                      <Input className="col-span-2 h-9" value={p.un_number} onChange={(e) => updateProduct(idx, 'un_number', e.target.value)} />
                      <Input className="col-span-2 h-9" value={p.risk_number} onChange={(e) => updateProduct(idx, 'risk_number', e.target.value)} />
                      <Input className="col-span-2 h-9" value={p.subclass} onChange={(e) => updateProduct(idx, 'subclass', e.target.value)} />
                      <Button type="button" variant="ghost" size="sm" className="col-span-1 h-9 w-9 p-0" onClick={() => removeProduct(idx)}>
                        <X className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Kit / Últimas viagens */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Kit de Emergência e Histórico</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Validade Calço/Extintor 1</Label>
                  <Input type="date" value={formData.kit_validity_1} onChange={(e) => setFormData(prev => ({ ...prev, kit_validity_1: e.target.value }))} />
                </div>
                <div>
                  <Label>Validade 2</Label>
                  <Input type="date" value={formData.kit_validity_2} onChange={(e) => setFormData(prev => ({ ...prev, kit_validity_2: e.target.value }))} />
                </div>
                <div>
                  <Label>Validade 3</Label>
                  <Input type="date" value={formData.kit_validity_3} onChange={(e) => setFormData(prev => ({ ...prev, kit_validity_3: e.target.value }))} />
                </div>
                <div>
                  <Label>Últ. Viagem - Produto 1</Label>
                  <Input value={formData.last_trip_product_1} onChange={(e) => setFormData(prev => ({ ...prev, last_trip_product_1: e.target.value }))} />
                </div>
                <div>
                  <Label>Produto 2</Label>
                  <Input value={formData.last_trip_product_2} onChange={(e) => setFormData(prev => ({ ...prev, last_trip_product_2: e.target.value }))} />
                </div>
                <div>
                  <Label>Produto 3</Label>
                  <Input value={formData.last_trip_product_3} onChange={(e) => setFormData(prev => ({ ...prev, last_trip_product_3: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Observações */}
            <div>
              <Label>Observações</Label>
              <Textarea value={formData.observations} onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))} />
            </div>

            {/* Responsáveis */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Responsáveis</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Responsável da Transportadora</Label>
                  <Input value={formData.transport_responsible_name} onChange={(e) => setFormData(prev => ({ ...prev, transport_responsible_name: e.target.value }))} />
                </div>
                <div>
                  <Label>RG</Label>
                  <Input value={formData.transport_responsible_rg} onChange={(e) => setFormData(prev => ({ ...prev, transport_responsible_rg: e.target.value }))} />
                </div>
                <div>
                  <Label>Recebedor da LVT</Label>
                  <Input value={formData.lvt_receiver_name} onChange={(e) => setFormData(prev => ({ ...prev, lvt_receiver_name: e.target.value }))} />
                </div>
                <div>
                  <Label>Matrícula</Label>
                  <Input value={formData.lvt_receiver_registration} onChange={(e) => setFormData(prev => ({ ...prev, lvt_receiver_registration: e.target.value }))} />
                </div>
                <div>
                  <Label>Responsável pela Vistoria</Label>
                  <Input value={formData.inspection_responsible_name} onChange={(e) => setFormData(prev => ({ ...prev, inspection_responsible_name: e.target.value }))} />
                </div>
                <div>
                  <Label>Matrícula</Label>
                  <Input value={formData.inspection_responsible_registration} onChange={(e) => setFormData(prev => ({ ...prev, inspection_responsible_registration: e.target.value }))} />
                </div>
                <div>
                  <Label>Registro de Mérito</Label>
                  <Input value={formData.merit_record} onChange={(e) => setFormData(prev => ({ ...prev, merit_record: e.target.value }))} />
                </div>
                <div>
                  <Label>Registro de Ocorrências</Label>
                  <Input value={formData.occurrence_record} onChange={(e) => setFormData(prev => ({ ...prev, occurrence_record: e.target.value }))} />
                </div>
                <div>
                  <Label>Documento do Condutor</Label>
                  <Input value={formData.driver_document} onChange={(e) => setFormData(prev => ({ ...prev, driver_document: e.target.value }))} />
                </div>
                <div>
                  <Label>Data/Hora da Liberação do Veículo</Label>
                  <Input type="datetime-local" value={formData.release_datetime} onChange={(e) => setFormData(prev => ({ ...prev, release_datetime: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvando...' : (editingChecklist ? 'Salvar Alterações' : 'Criar Checklist')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalhes - modelo antigo (LVT/ANTT) */}
      <Dialog open={detailModalOpen && !detailIsSimple} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              Checklist #{selectedChecklist?.checklist_number}
              {selectedChecklist && resultBadge(checklistResult(selectedChecklist))}
            </DialogTitle>
          </DialogHeader>

          {selectedChecklist && !detailIsSimple && (
            <div className="space-y-4">
              {checklistResult(selectedChecklist) === 'REPROVADO' && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Há item(ns) reprovado(s) — o carregamento deve ser cancelado.
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Motorista</p>
                  <p className="font-medium">{selectedChecklist.driver_name || '-'}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Placa do Cavalo</p>
                  <p className="font-medium">{selectedChecklist.cavalo_plate || '-'}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Cliente</p>
                  <p className="font-medium">{selectedChecklist.client_name || '-'}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded">
                  <p className="text-sm text-muted-foreground">Transportadora</p>
                  <p className="font-medium">{selectedChecklist.transport_company_name || '-'}</p>
                </div>
              </div>

              {[
                ['documentos_items', 'Documentos'],
                ['vehicle_condition_items', 'Condições do Veículo'],
                ['epi_items', 'EPI'],
                ['kit_items', 'Kit'],
                ['tank_items', 'Condições do Tanque / Carreta'],
                ['post_loading_items', 'Documentos Pós Carregamento'],
              ].map(([field, label]) => (
                (selectedChecklist[field] || []).length > 0 && (
                  <div key={field} className="border rounded-lg overflow-hidden">
                    <div className="bg-primary/10 px-4 py-2">
                      <h4 className="text-sm font-semibold text-primary">{label}</h4>
                    </div>
                    <div className="divide-y">
                      {selectedChecklist[field].map((item, idx) => (
                        <div key={idx} className="flex items-center gap-3 px-4 py-2 text-sm">
                          <span className="flex-1">{item.text}</span>
                          {item.answer === 'SIM' && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
                          {item.answer === 'NAO' && <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                          {!item.answer && <span className="text-xs text-slate-400">-</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ))}

              {selectedChecklist.observations && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block mb-1">Observações</span>
                  <span className="text-sm">{selectedChecklist.observations}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
            <Button onClick={() => selectedChecklist && printChecklist(selectedChecklist)}>
              <Printer className="w-4 h-4 mr-2" />
              Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
