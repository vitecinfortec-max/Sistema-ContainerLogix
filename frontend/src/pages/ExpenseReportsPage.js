import { FormSectionTitle } from '../components/FormKit';
import PeriodReportDialog from '../components/PeriodReportDialog';
import { FileBarChart, PieChart, Tags } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ExpenseGroupsDialog from '../components/ExpenseGroupsDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, PeriodFilterFields, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { compressImage } from '../lib/imageCompression';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import {
  Calculator, Plus, Eye, Trash2, Printer, Pencil, X,
  CheckCircle2, RotateCcw, Camera, Paperclip, Receipt, Banknote
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { todayISO } from '../lib/dates';

function newItemId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptyDeposit() {
  return { amount: '', date: todayISO(), sent_by: '' };
}

function createEmptyPurchase() {
  return {
    item_id: newItemId(),
    supplier_id: '',
    supplier_name: '',
    group_id: '',
    purchase_date: todayISO(),
    amount: '',
    observation: '',
    receipts: [],
    pendingFiles: []
  };
}

function balanceInfo(balance) {
  if (balance > 0.004) return { label: 'Valor a Ressarcir ao Funcionário', className: 'text-amber-600 dark:text-amber-400', value: balance };
  if (balance < -0.004) return { label: 'Saldo a Devolver pelo Funcionário', className: 'text-red-600 dark:text-red-400', value: Math.abs(balance) };
  return { label: 'Quitado', className: 'text-emerald-600 dark:text-emerald-400', value: 0 };
}

const brl = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Saldo que precisa de acerto (ressarcir ou devolver)
const hasBalance = (report) => Math.abs(report?.balance || 0) > 0.004;

export default function ExpenseReportsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [reportOpen, setReportOpen] = useState(false);
  const [settlementReportOpen, setSettlementReportOpen] = useState(false);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  const [suppliers, setSuppliers] = useState([]);
  // Grupos de custo (Combustível, Alimentação...) de cada compra
  const [groups, setGroups] = useState([]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingReport, setEditingReport] = useState(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    period_start: '',
    period_end: '',
    deposits: [createEmptyDeposit()],
    purchases: [createEmptyPurchase()]
  });

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);

  // Estado de Seleção (toolbar)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // A busca é feita enquanto se digita (sem botão "Filtrar") e vale também
  // ao trocar de página e ao recarregar depois de salvar.
  const debouncedSearch = useDebouncedValue(searchQuery.trim());

  useEffect(() => {
    loadSuppliers();
    api.getExpenseGroups().then((r) => setGroups(r.data)).catch(() => toast.error('Erro ao carregar os grupos de custo'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [period, setPeriod] = useState(['', '']);
  const changePeriod = (value) => { setPeriod(value); setPagination(prev => ({ ...prev, page: 1 })); };

  useEffect(() => {
    loadReports();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, debouncedSearch, period]);

  const loadSuppliers = async () => {
    try {
      const response = await api.getSuppliers();
      setSuppliers(response.data);
    } catch (error) {
      console.error('Erro ao carregar fornecedores:', error);
      toast.error('Erro ao carregar fornecedores');
    }
  };

  const loadReports = async (search = debouncedSearch) => {
    try {
      const params = { page: pagination.page, per_page: 15 };
      if (search) params.search = search;
      if (period[0]) params.date_from = period[0];
      if (period[1]) params.date_to = period[1];

      const response = await api.getExpenseReports(params);
      setReports(response.data.items);
      setPagination(prev => ({
        ...prev,
        pages: response.data.pages,
        total: response.data.total
      }));
    } catch (error) {
      toast.error('Erro ao carregar prestações de contas');
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setPeriod(['', '']);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleSearchChange = (value) => {
    setSearchQuery(value);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const resetForm = () => {
    setFormData({
      period_start: '',
      period_end: '',
      deposits: [createEmptyDeposit()],
      purchases: [createEmptyPurchase()]
    });
    setEditingReport(null);
  };

  const openNewModal = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (report) => {
    if (report.status === 'CONCLUIDA') {
      toast.error('Reabra a prestação de contas antes de editar');
      return;
    }
    setEditingReport(report);
    setFormData({
      period_start: report.period_start || '',
      period_end: report.period_end || '',
      deposits: report.deposits?.length > 0
        ? report.deposits.map(d => ({ ...d }))
        : [createEmptyDeposit()],
      purchases: report.purchases?.length > 0
        ? report.purchases.map(p => ({ ...p, pendingFiles: [] }))
        : [createEmptyPurchase()]
    });
    setModalOpen(true);
  };

  // ===== Depósitos =====
  const handleDepositChange = (index, field, value) => {
    const newDeposits = [...formData.deposits];
    newDeposits[index] = { ...newDeposits[index], [field]: value };
    setFormData(prev => ({ ...prev, deposits: newDeposits }));
  };

  const addDeposit = () => {
    setFormData(prev => ({ ...prev, deposits: [...prev.deposits, createEmptyDeposit()] }));
  };

  const removeDeposit = (index) => {
    if (formData.deposits.length === 1) {
      toast.error('A prestação de contas deve ter pelo menos um depósito');
      return;
    }
    setFormData(prev => ({ ...prev, deposits: prev.deposits.filter((_, i) => i !== index) }));
  };

  // ===== Compras =====
  const handlePurchaseChange = (index, field, value) => {
    const newPurchases = [...formData.purchases];
    newPurchases[index] = { ...newPurchases[index], [field]: value };
    setFormData(prev => ({ ...prev, purchases: newPurchases }));
  };

  const addPurchase = () => {
    setFormData(prev => ({ ...prev, purchases: [...prev.purchases, createEmptyPurchase()] }));
  };

  const removePurchase = (index) => {
    if (formData.purchases.length === 1) {
      toast.error('A prestação de contas deve ter pelo menos um lançamento de compra');
      return;
    }
    setFormData(prev => ({ ...prev, purchases: prev.purchases.filter((_, i) => i !== index) }));
  };

  const handlePurchaseFilesSelected = async (index, fileList) => {
    if (!fileList || fileList.length === 0) return;
    // Resolução maior que a padrão: o texto do comprovante precisa continuar legível
    const files = await Promise.all(Array.from(fileList).map(file => compressImage(file, { maxDimension: 2000, quality: 0.85 })));
    const incoming = files.map(file => ({ localId: newItemId(), file, preview: URL.createObjectURL(file) }));
    setFormData(prev => ({
      ...prev,
      purchases: prev.purchases.map((purchase, i) => (
        i === index ? { ...purchase, pendingFiles: [...(purchase.pendingFiles || []), ...incoming] } : purchase
      ))
    }));
  };

  const removePendingFile = (index, localId) => {
    setFormData(prev => ({
      ...prev,
      purchases: prev.purchases.map((purchase, i) => {
        if (i !== index) return purchase;
        (purchase.pendingFiles || []).filter(f => f.localId === localId).forEach(f => URL.revokeObjectURL(f.preview));
        return { ...purchase, pendingFiles: (purchase.pendingFiles || []).filter(f => f.localId !== localId) };
      })
    }));
  };

  const removeSavedReceipt = async (index, receiptId) => {
    if (!editingReport) return;
    const purchase = formData.purchases[index];
    try {
      await api.deleteExpenseReportReceipt(editingReport.id, purchase.item_id, receiptId);
      const newPurchases = [...formData.purchases];
      newPurchases[index] = {
        ...newPurchases[index],
        receipts: (newPurchases[index].receipts || []).filter(r => r.id !== receiptId)
      };
      setFormData(prev => ({ ...prev, purchases: newPurchases }));
      toast.success('Recibo removido');
    } catch (error) {
      toast.error('Erro ao remover recibo');
    }
  };

  // ===== Totais ao vivo (preview) =====
  const totalDepositsPreview = formData.deposits.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
  const totalPurchasesPreview = formData.purchases.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const balancePreview = balanceInfo(totalPurchasesPreview - totalDepositsPreview);

  const handleSubmit = async () => {
    if (!formData.period_start || !formData.period_end) {
      toast.error('Informe o período da prestação de contas');
      return;
    }
    for (let i = 0; i < formData.deposits.length; i++) {
      const d = formData.deposits[i];
      if (!d.date || !d.sent_by || !d.amount) {
        toast.error(`Preencha os campos obrigatórios do depósito ${i + 1}`);
        return;
      }
    }
    for (let i = 0; i < formData.purchases.length; i++) {
      const p = formData.purchases[i];
      if (!p.supplier_name || !p.purchase_date || !p.amount) {
        toast.error(`Preencha os campos obrigatórios da compra ${i + 1}`);
        return;
      }
      if (!p.group_id) {
        toast.error(`Escolha o grupo de custo da compra ${i + 1}`);
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        period_start: formData.period_start,
        period_end: formData.period_end,
        deposits: formData.deposits.map(d => ({
          amount: parseFloat(d.amount) || 0,
          date: d.date,
          sent_by: d.sent_by
        })),
        purchases: formData.purchases.map(p => ({
          item_id: p.item_id,
          supplier_id: p.supplier_id || null,
          supplier_name: p.supplier_name || null,
          group_id: p.group_id || null,
          purchase_date: p.purchase_date,
          amount: parseFloat(p.amount) || 0,
          observation: p.observation || null
        }))
      };

      let reportId;
      if (editingReport) {
        const response = await api.updateExpenseReport(editingReport.id, payload);
        reportId = response.data.id;
        toast.success('Prestação de contas atualizada com sucesso!');
      } else {
        const response = await api.createExpenseReport(payload);
        reportId = response.data.id;
        toast.success('Prestação de contas criada com sucesso!');
      }

      // A prestação já está salva: se uma foto falhar, avisa e fecha. Ficar com a
      // janela aberta fazia o próximo clique em Salvar criar outra prestação.
      let failed = 0;
      for (const purchase of formData.purchases) {
        for (const pending of purchase.pendingFiles || []) {
          try {
            await api.uploadExpenseReportReceipt(reportId, purchase.item_id, pending.file);
          } catch (error) {
            failed += 1;
          }
        }
      }
      if (failed > 0) {
        toast.error(`${failed} comprovante(s) não foram enviados. Abra a prestação em Editar e bata de novo.`);
      }

      setModalOpen(false);
      resetForm();
      loadReports();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar prestação de contas');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Deseja realmente excluir esta prestação de contas?'))) return;

    try {
      await api.deleteExpenseReport(id);
      toast.success('Prestação de contas excluída');
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      loadReports();
    } catch (error) {
      toast.error('Erro ao excluir prestação de contas');
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
    setSelectedIds(prev => {
      const pageIds = reports.map(r => r.id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  };

  const singleSelectedReport = selectedIds.size === 1
    ? reports.find(r => r.id === [...selectedIds][0])
    : null;

  const handleComplete = async (id) => {
    if (!(await confirm('Concluir esta prestação de contas? A edição ficará bloqueada até reabrir.'))) return;
    try {
      await api.updateExpenseReportStatus(id, 'CONCLUIDA');
      toast.success('Prestação de contas concluída');
      loadReports();
    } catch (error) {
      toast.error('Erro ao concluir prestação de contas');
    }
  };

  // Acerto do saldo: data em que o ressarcimento foi pago (ou a devolução
  // recebida). Só com a prestação concluída; enquanto acertada não reabre.
  const [settlementReport, setSettlementReport] = useState(null);
  const [settlementDate, setSettlementDate] = useState('');
  const [settling, setSettling] = useState(false);

  const openSettlement = (report) => {
    setSettlementDate(todayISO());
    setSettlementReport(report);
  };

  const saveSettlement = async (settled) => {
    const report = settlementReport || (settled ? null : singleSelectedReport);
    if (!report) return;
    if (!settled && !(await confirm('Desfazer o acerto do saldo desta prestação? Ela volta a aparecer como pendente.'))) return;
    setSettling(true);
    try {
      const { data } = await api.setExpenseReportSettlement(report.id, settled, settled ? settlementDate : undefined);
      toast.success(settled ? 'Saldo marcado como acertado' : 'Acerto desfeito: saldo pendente');
      setSettlementReport(null);
      if (selectedReport?.id === data.id) setSelectedReport(data);
      loadReports();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar o acerto');
    } finally {
      setSettling(false);
    }
  };

  const handleReopen = async (id) => {
    try {
      await api.updateExpenseReportStatus(id, 'EM_ANDAMENTO');
      toast.success('Prestação de contas reaberta para edição');
      loadReports();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao reabrir prestação de contas');
    }
  };

  const handlePrintPDF = async (id) => {
    try {
      const response = await api.getExpenseReportPDF(id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `prestacao_contas_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao gerar PDF');
    }
  };

  const openDetails = (report) => {
    setSelectedReport(report);
    setDetailModalOpen(true);
  };

  const getStatusBadge = (status) => {
    const tones = { EM_ANDAMENTO: 'amber', CONCLUIDA: 'emerald' };
    const labels = { EM_ANDAMENTO: 'Em Andamento', CONCLUIDA: 'Concluída' };
    return <StatusPill tone={tones[status] || 'amber'}>{labels[status] || status}</StatusPill>;
  };

  const formatMoney = (value) => (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatPeriodDate = (value) => {
    if (!value) return '-';
    try {
      return format(new Date(`${value}T00:00:00`), 'dd/MM/yyyy', { locale: ptBR });
    } catch {
      return value;
    }
  };

  return (
    <Layout>
      <div className="space-y-4" data-testid="expense-reports-page">
        <PageHeader
          icon={Calculator}
          title="Prestação de Contas"
          subtitle="Controle de depósitos recebidos e compras realizadas por período"
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/expense-reports/dashboard')} data-testid="expense-dashboard-link">
                <PieChart className="w-4 h-4 mr-1.5" /> Custos por grupo
              </Button>
              <Button variant="outline" size="sm" onClick={() => setGroupsOpen(true)} data-testid="expense-groups-link">
                <Tags className="w-4 h-4 mr-1.5" /> Grupos de custo
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSettlementReportOpen(true)} data-testid="expense-settlement-report">
                <Banknote className="w-4 h-4 mr-1.5" /> Ressarcimentos
              </Button>
              <Button variant="outline" size="sm" onClick={() => setReportOpen(true)} data-testid="expense-period-report">
                <FileBarChart className="w-4 h-4 mr-1.5" /> Relatório do período
              </Button>
            </div>
          )}
        />

        <FilterCard hasFilters={!!(searchQuery || period[0] || period[1])} onClear={clearSearch}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Número ou fornecedor">
              <SearchInput
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                data-testid="search-expense-report-input"
              />
            </FilterField>
            <PeriodFilterFields value={period} onChange={changePeriod} testIdPrefix="expense" />
          </div>
        </FilterCard>

        {/* Lista - marque uma prestação pra habilitar as ações da barra. Concluir
            vira Reabrir quando a prestação selecionada já está concluída. */}
        <DataCard
          title="Prestações de contas"
          count={pagination.total}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Nova prestação" onClick={openNewModal} testId="new-expense-report-btn" />}
            >
              <ToolbarButton icon={Eye} label="Ver detalhes" tone="primary" onClick={() => singleSelectedReport && openDetails(singleSelectedReport)} disabled={!singleSelectedReport} />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => singleSelectedReport && openEditModal(singleSelectedReport)} disabled={!singleSelectedReport || singleSelectedReport.status !== 'EM_ANDAMENTO'} />
              {singleSelectedReport?.status === 'CONCLUIDA' ? (
                <ToolbarButton icon={RotateCcw} label="Reabrir" tone="amber" onClick={() => handleReopen(singleSelectedReport.id)} disabled={!!singleSelectedReport.settled_at} />
              ) : (
                <ToolbarButton icon={CheckCircle2} label="Concluir" tone="emerald" onClick={() => singleSelectedReport && handleComplete(singleSelectedReport.id)} disabled={!singleSelectedReport} />
              )}
              {singleSelectedReport?.settled_at ? (
                <ToolbarButton icon={RotateCcw} label="Desfazer acerto" tone="amber" onClick={() => saveSettlement(false)} disabled={settling} testId="expense-undo-settlement" />
              ) : (
                <ToolbarButton
                  icon={Banknote}
                  label="Acertar saldo"
                  tone="emerald"
                  onClick={() => singleSelectedReport && openSettlement(singleSelectedReport)}
                  disabled={!singleSelectedReport || singleSelectedReport.status !== 'CONCLUIDA' || !hasBalance(singleSelectedReport)}
                  testId="expense-settle"
                />
              )}
              <ToolbarButton icon={Printer} label="Baixar PDF" tone="emerald" onClick={() => singleSelectedReport && handlePrintPDF(singleSelectedReport.id)} disabled={!singleSelectedReport || singleSelectedReport.status !== 'CONCLUIDA'} />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => singleSelectedReport && handleDelete(singleSelectedReport.id)} disabled={!singleSelectedReport} />
            </Toolbar>
          )}
          footer={(
            <TablePagination
              currentPage={pagination.page}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              pageSize={15}
              onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            />
          )}
        >
          {loading ? (
            <EmptyState loading />
          ) : reports.length === 0 ? (
            <EmptyState
              icon={Calculator}
              title="Nenhuma prestação de contas encontrada"
              hint={searchQuery ? 'Ajuste a busca' : 'Registre a primeira pelo botão "Nova prestação"'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={reports.length > 0 && reports.every(r => selectedIds.has(r.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Nº</th>
                    <th>Período</th>
                    <th className="!text-right">Total compras</th>
                    <th className="!text-right">Saldo</th>
                    <th>Acerto</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => {
                    const bi = balanceInfo(report.balance || 0);
                    const isSelected = selectedIds.has(report.id);
                    return (
                      <tr
                        key={report.id}
                        data-selected={isSelected}
                        className="cursor-pointer"
                        onClick={() => toggleSelect(report.id)}
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(report.id)}
                          />
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{report.report_number_formatted}</td>
                        <td className="whitespace-nowrap tabular-nums">{formatPeriodDate(report.period_start)} a {formatPeriodDate(report.period_end)}</td>
                        <td className="text-right whitespace-nowrap tabular-nums">{formatMoney(report.total_purchases)}</td>
                        <td className={`text-right whitespace-nowrap tabular-nums font-semibold ${bi.className}`}>{formatMoney(bi.value)}</td>
                        <td className="whitespace-nowrap">
                          {!hasBalance(report) ? '-' : report.settled_at ? (
                            <StatusPill tone="emerald">Acertado {formatPeriodDate(report.settled_at)}</StatusPill>
                          ) : (
                            <StatusPill tone="amber">Pendente</StatusPill>
                          )}
                        </td>
                        <td>{getStatusBadge(report.status)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
      </div>

      {/* Modal Nova/Editar Prestação de Contas */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Calculator className="w-4 h-4 text-primary" />
              {editingReport ? `Editar Prestação de Contas #${editingReport.report_number_formatted}` : 'Nova Prestação de Contas'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Período */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">Período - Início *</Label>
                <Input type="date" className="h-9" value={formData.period_start} onChange={(e) => setFormData(prev => ({ ...prev, period_start: e.target.value }))} />
              </div>
              <div>
                <Label className="mb-1.5 block">Período - Fim *</Label>
                <Input type="date" className="h-9" value={formData.period_end} onChange={(e) => setFormData(prev => ({ ...prev, period_end: e.target.value }))} />
              </div>
            </div>

            {/* Depósitos Recebidos (antes das compras) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <FormSectionTitle bare>Depósitos Recebidos</FormSectionTitle>
                <Button type="button" variant="outline" size="sm" onClick={addDeposit}>
                  <Plus className="w-4 h-4 mr-1" /> Adicionar depósito
                </Button>
              </div>
              <div className="space-y-3">
                {formData.deposits.map((deposit, index) => (
                  <div key={index} className="border rounded-lg p-3 relative bg-muted/20">
                    <div className="absolute top-2 right-2">
                      <Button title="Remover" aria-label="Remover" type="button" variant="ghost" size="icon" onClick={() => removeDeposit(index)} className="h-6 w-6 text-destructive">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pr-8">
                      <div>
                        <Label className="mb-1.5 block">Valor Enviado (R$) *</Label>
                        <Input className="h-9" type="number" step="0.01" value={deposit.amount} onChange={(e) => handleDepositChange(index, 'amount', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Data *</Label>
                        <Input className="h-9" type="date" value={deposit.date} onChange={(e) => handleDepositChange(index, 'date', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Enviado Por *</Label>
                        <Input className="h-9" value={deposit.sent_by} onChange={(e) => handleDepositChange(index, 'sent_by', e.target.value)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-right text-sm font-semibold">
                Total de Depósitos: {formatMoney(totalDepositsPreview)}
              </div>
            </div>

            {/* Lançamentos de Compras */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <FormSectionTitle bare>Lançamentos de Compras</FormSectionTitle>
                <Button type="button" variant="outline" size="sm" onClick={addPurchase}>
                  <Plus className="w-4 h-4 mr-1" /> Adicionar compra
                </Button>
              </div>
              <div className="space-y-4">
                {formData.purchases.map((purchase, index) => (
                  <div key={purchase.item_id} className="border rounded-lg p-4 relative">
                    <div className="absolute top-2 right-2">
                      <Button title="Remover" aria-label="Remover" type="button" variant="ghost" size="icon" onClick={() => removePurchase(index)} className="h-6 w-6 text-destructive">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="text-sm font-medium text-muted-foreground mb-3">Compra #{index + 1}</div>

                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                      <div>
                        <Label className="mb-1.5 block">Grupo de custo *</Label>
                        <Select value={purchase.group_id || undefined} onValueChange={(v) => handlePurchaseChange(index, 'group_id', v)}>
                          <SelectTrigger className={`h-9 text-sm ${purchase.group_id ? '' : 'text-muted-foreground'}`} data-testid={`expense-purchase-group-${index}`}>
                            <SelectValue placeholder="Escolha o grupo" />
                          </SelectTrigger>
                          <SelectContent>
                            {groups.filter((g) => g.status === 'ATIVO' || g.id === purchase.group_id).map((g) => (
                              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Local de Compra (Fornecedor) *</Label>
                        <Autocomplete
                          value={purchase.supplier_name}
                          onChange={(val) => handlePurchaseChange(index, 'supplier_name', val)}
                          options={suppliers}
                          displayField="name"
                          valueField="id"
                          onSelect={(supplier) => {
                            handlePurchaseChange(index, 'supplier_id', supplier.id);
                            handlePurchaseChange(index, 'supplier_name', supplier.name);
                          }}
                        />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Data da Compra *</Label>
                        <Input className="h-9" type="date" value={purchase.purchase_date} onChange={(e) => handlePurchaseChange(index, 'purchase_date', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Valor da Compra (R$) *</Label>
                        <Input className="h-9" type="number" step="0.01" value={purchase.amount} onChange={(e) => handlePurchaseChange(index, 'amount', e.target.value)} />
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Observação</Label>
                        <Input className="h-9" value={purchase.observation || ''} onChange={(e) => handlePurchaseChange(index, 'observation', e.target.value)} />
                      </div>
                    </div>

                    {/* Recibos */}
                    <div className="mt-3">
                      <Label className="mb-1.5 block">Recibos / Comprovantes</Label>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {(purchase.receipts || []).map((receipt) => (
                          <div key={receipt.id} className="relative">
                            <img src={api.getFileUrl(receipt.url)} alt="Recibo" className="w-16 h-16 object-cover rounded border" />
                            <button aria-label="Remover recibo"
                              type="button"
                              onClick={() => removeSavedReceipt(index, receipt.id)}
                              className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                              title="Remover recibo"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        {(purchase.pendingFiles || []).map((pending) => (
                          <div key={pending.localId} className="relative">
                            <img src={pending.preview} alt="Recibo (pendente)" className="w-16 h-16 object-cover rounded border border-dashed border-primary" />
                            <button aria-label="Remover"
                              type="button"
                              onClick={() => removePendingFile(index, pending.localId)}
                              className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                              title="Remover"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        {/* capture="environment": no celular abre direto a câmera traseira */}
                        <label className="w-16 h-16 flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded cursor-pointer text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                          <Camera className="w-5 h-5" />
                          <span className="text-[10px] text-center leading-none">Bater foto</span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            data-testid={`receipt-camera-${index}`}
                            onChange={(e) => {
                              handlePurchaseFilesSelected(index, e.target.files);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        <label className="w-16 h-16 flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded cursor-pointer text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                          <Paperclip className="w-5 h-5" />
                          <span className="text-[10px]">Anexar</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            data-testid={`receipt-attach-${index}`}
                            className="hidden"
                            onChange={(e) => {
                              handlePurchaseFilesSelected(index, e.target.files);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="mt-3 text-right text-sm font-semibold">
                      Valor: {formatMoney(parseFloat(purchase.amount) || 0)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-right text-sm font-semibold">
                Total de Compras: {formatMoney(totalPurchasesPreview)}
              </div>
            </div>

            {/* Resumo / Saldo */}
            <div className="border-t pt-4 flex flex-col items-end gap-1">
              <div className="text-sm">Total de Compras: <span className="font-semibold">{formatMoney(totalPurchasesPreview)}</span></div>
              <div className="text-sm">Total de Depósitos: <span className="font-semibold">{formatMoney(totalDepositsPreview)}</span></div>
              <div className={`text-lg font-bold ${balancePreview.className}`}>
                {balancePreview.label}: {formatMoney(balancePreview.value)}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvando...' : (editingReport ? 'Salvar alterações' : 'Criar prestação de contas')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Prestação de Contas #{selectedReport?.report_number_formatted}
            </DialogTitle>
          </DialogHeader>

          {selectedReport && (
            <div className="space-y-5">
              <div className="flex items-center gap-4 text-sm">
                <span>Período: <strong>{formatPeriodDate(selectedReport.period_start)} a {formatPeriodDate(selectedReport.period_end)}</strong></span>
                {getStatusBadge(selectedReport.status)}
              </div>

              <div>
                <h4 className="font-semibold mb-2">Depósitos Recebidos ({selectedReport.deposits?.length || 0})</h4>
                <div className="border rounded overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Enviado Por</th>
                        <th className="!text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedReport.deposits?.map((d, idx) => (
                        <tr key={idx} className="border-t">
                          <td>{formatPeriodDate(d.date)}</td>
                          <td>{d.sent_by}</td>
                          <td className="text-right">{formatMoney(d.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Lançamentos de Compras ({selectedReport.purchases?.length || 0})</h4>
                <div className="space-y-3">
                  {selectedReport.purchases?.map((p, idx) => (
                    <div key={idx} className="border rounded p-3 text-sm">
                      <div className="flex justify-between font-medium">
                        <span>{p.supplier_name || '-'}</span>
                        <span>{formatMoney(p.amount)}</span>
                      </div>
                      <div className="mt-1">
                        <StatusPill tone={p.group_name ? 'blue' : 'amber'} dot={false} className="text-[10px]">{p.group_name || 'Sem grupo'}</StatusPill>
                      </div>
                      <div className="text-muted-foreground text-xs mt-1">{formatPeriodDate(p.purchase_date)}</div>
                      {p.observation && <div className="text-xs mt-1">{p.observation}</div>}
                      {p.receipts?.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {p.receipts.map((r) => (
                            <a key={r.id} href={api.getFileUrl(r.url)} target="_blank" rel="noreferrer">
                              <img src={api.getFileUrl(r.url)} alt="Recibo" className="w-14 h-14 object-cover rounded border" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t pt-3 flex flex-col items-end gap-1">
                <div className="text-sm">Total de Compras: <span className="font-semibold">{formatMoney(selectedReport.total_purchases)}</span></div>
                <div className="text-sm">Total de Depósitos: <span className="font-semibold">{formatMoney(selectedReport.total_deposits)}</span></div>
                {(() => {
                  const bi = balanceInfo(selectedReport.balance || 0);
                  return (
                    <div className={`text-lg font-bold ${bi.className}`}>
                      {bi.label}: {formatMoney(bi.value)}
                    </div>
                  );
                })()}
                {hasBalance(selectedReport) && (
                  <div className="text-sm text-muted-foreground">
                    {selectedReport.settled_at
                      ? `Saldo acertado em ${formatPeriodDate(selectedReport.settled_at)}${selectedReport.settled_by_name ? ` por ${selectedReport.settled_by_name}` : ''}`
                      : 'Saldo ainda não acertado'}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            {selectedReport?.status === 'EM_ANDAMENTO' ? (
              <Button variant="outline" onClick={() => handleComplete(selectedReport.id)}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Concluir
              </Button>
            ) : (
              <Button variant="outline" onClick={() => handleReopen(selectedReport?.id)} disabled={!!selectedReport?.settled_at}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Reabrir
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
            <Button
              onClick={() => handlePrintPDF(selectedReport?.id)}
              disabled={selectedReport?.status !== 'CONCLUIDA'}
              title={selectedReport?.status === 'CONCLUIDA' ? 'Gerar PDF' : 'Conclua a prestação de contas para gerar o PDF'}
            >
              <Printer className="w-4 h-4 mr-2" />
              Gerar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PeriodReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        title="Relatório de Prestação de Contas"
        description="Custo por grupo e as maiores compras do período, por fornecedor, com a lista das compras sem recibo anexado."
        periodLabel="Data da compra/depósito"
        statuses={[{ value: '', label: 'Todas' }, { value: 'EM_ANDAMENTO', label: 'Em andamento' }, { value: 'CONCLUIDA', label: 'Concluídas' }]}
        textFilters={[{ key: 'supplier', label: 'Fornecedor' }]}
        checkboxes={[{ key: 'only_without_receipt', label: 'Só compras sem recibo anexado' }]}
        selects={[{
          key: 'group',
          label: 'Grupo de custo',
          options: [{ value: 'TODOS', label: 'Todos os grupos' }, ...groups.map((g) => ({ value: g.id, label: g.name })),
            { value: 'SEM_GRUPO', label: '(sem grupo)' }],
        }]}
        load={api.getExpensesReport}
        summarize={(d) => [
          ['Compras', brl(d.summary.total_purchases)], ['Depósitos', brl(d.summary.total_deposits)],
          ['Maior grupo', d.groups?.[0] ? `${d.groups[0].group_name} · ${brl(d.groups[0].total)} (${d.groups[0].share}%)` : '-'],
          ['Saldo (compras - depósitos)', brl(d.summary.balance)],
          ['Sem recibo', `${d.summary.without_receipt_count} · ${brl(d.summary.without_receipt_total)}`],
        ]}
        downloadPdf={api.downloadExpensesReportPdf}
        downloadExcel={api.downloadExpensesReportExcel}
        filename="relatorio_prestacao_contas"
      />
      <Dialog open={!!settlementReport} onOpenChange={(v) => { if (!v) setSettlementReport(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Acertar saldo #{settlementReport?.report_number_formatted}</DialogTitle>
          </DialogHeader>
          {settlementReport && (() => {
            const bi = balanceInfo(settlementReport.balance || 0);
            return (
              <div className="space-y-3">
                <p className={`font-semibold ${bi.className}`}>{bi.label}: {formatMoney(bi.value)}</p>
                <div>
                  <Label className="mb-1.5 block">
                    {settlementReport.balance > 0 ? 'Data do ressarcimento ao funcionário' : 'Data da devolução recebida'}
                  </Label>
                  <Input type="date" className="h-9" value={settlementDate} onChange={(e) => setSettlementDate(e.target.value)} data-testid="expense-settlement-date" />
                </div>
                <p className="text-xs text-muted-foreground">Com o saldo acertado a prestação não pode ser reaberta; desfaça o acerto antes, se precisar.</p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlementReport(null)}>Cancelar</Button>
            <Button onClick={() => saveSettlement(true)} disabled={settling || !settlementDate} data-testid="expense-settlement-save">
              {settling ? 'Salvando...' : 'Marcar como acertado'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PeriodReportDialog
        open={settlementReportOpen}
        onOpenChange={setSettlementReportOpen}
        title="Ressarcimentos da Prestação de Contas"
        description="Saldo de cada prestação: o que falta ressarcir ao funcionário ou receber de volta, e o que já foi acertado."
        statuses={[{ value: '', label: 'Pendentes e acertadas' }, { value: 'PENDENTE', label: 'Pendentes' }, { value: 'ACERTADO', label: 'Acertadas' }]}
        statusParam="situation"
        selects={[{
          key: 'period_by',
          label: 'Período pela data',
          options: [{ value: 'report', label: 'Da prestação' }, { value: 'settlement', label: 'Do acerto (só as acertadas)' }],
        }]}
        load={api.getExpenseSettlementsReport}
        summarize={(d) => [
          ['A ressarcir (pendente)', brl(d.summary.pending_reimburse)], ['A devolver (pendente)', brl(d.summary.pending_return)],
          ['Ressarcido', brl(d.summary.settled_reimburse)], ['Devolvido', brl(d.summary.settled_return)],
          ['Pendentes', d.summary.pending_count], ['Acertadas', d.summary.settled_count],
        ]}
        downloadPdf={api.downloadExpenseSettlementsReportPdf}
        downloadExcel={api.downloadExpenseSettlementsReportExcel}
        filename="relatorio_ressarcimentos"
      />
      <ExpenseGroupsDialog open={groupsOpen} onOpenChange={setGroupsOpen} onChanged={setGroups} />
      <ConfirmDialog />
    </Layout>
  );
}
