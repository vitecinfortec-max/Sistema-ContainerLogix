import { useEffect, useState, useRef } from 'react';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  StatusPill, EmptyState, TablePagination,
} from '../components/DataPage';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import {
  Calculator, Plus, Eye, Trash2, Printer, Pencil, X,
  CheckCircle2, RotateCcw, Camera, Receipt
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function newItemId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptyDeposit() {
  return { amount: '', date: new Date().toISOString().split('T')[0], sent_by: '' };
}

function createEmptyPurchase() {
  return {
    item_id: newItemId(),
    supplier_id: '',
    supplier_name: '',
    purchase_date: new Date().toISOString().split('T')[0],
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

export default function ExpenseReportsPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  const [suppliers, setSuppliers] = useState([]);

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

  useEffect(() => {
    loadReports();
    loadSuppliers();
    setSelectedIds(new Set());
  }, [pagination.page]);

  const loadSuppliers = async () => {
    try {
      const response = await api.getSuppliers();
      setSuppliers(response.data);
    } catch (error) {
      console.error('Erro ao carregar fornecedores:', error);
      toast.error('Erro ao carregar fornecedores');
    }
  };

  const loadReports = async (search = '') => {
    setLoading(true);
    try {
      const params = { page: pagination.page, per_page: 15 };
      if (search) params.search = search;

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

  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadReports(searchQuery);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setPagination(prev => ({ ...prev, page: 1 }));
    loadReports('');
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

  const handlePurchaseFilesSelected = (index, fileList) => {
    if (!fileList || fileList.length === 0) return;
    const newPurchases = [...formData.purchases];
    const purchase = { ...newPurchases[index] };
    const incoming = Array.from(fileList).map(file => ({ localId: newItemId(), file }));
    purchase.pendingFiles = [...(purchase.pendingFiles || []), ...incoming];
    newPurchases[index] = purchase;
    setFormData(prev => ({ ...prev, purchases: newPurchases }));
  };

  const removePendingFile = (index, localId) => {
    const newPurchases = [...formData.purchases];
    const purchase = { ...newPurchases[index] };
    purchase.pendingFiles = (purchase.pendingFiles || []).filter(f => f.localId !== localId);
    newPurchases[index] = purchase;
    setFormData(prev => ({ ...prev, purchases: newPurchases }));
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

      for (const purchase of formData.purchases) {
        for (const pending of purchase.pendingFiles || []) {
          await api.uploadExpenseReportReceipt(reportId, purchase.item_id, pending.file);
        }
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

  const handleReopen = async (id) => {
    try {
      await api.updateExpenseReportStatus(id, 'EM_ANDAMENTO');
      toast.success('Prestação de contas reaberta para edição');
      loadReports();
    } catch (error) {
      toast.error('Erro ao reabrir prestação de contas');
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

  const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
        <PageHeader icon={Calculator} title="Prestação de Contas" subtitle="Controle de depósitos recebidos e compras realizadas por período" />

        <FilterCard hasFilters={!!searchQuery} onClear={clearSearch} onApply={handleSearch}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Número ou fornecedor">
              <SearchInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                data-testid="search-expense-report-input"
              />
            </FilterField>
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
                <ToolbarButton icon={RotateCcw} label="Reabrir" tone="amber" onClick={() => handleReopen(singleSelectedReport.id)} />
              ) : (
                <ToolbarButton icon={CheckCircle2} label="Concluir" tone="emerald" onClick={() => singleSelectedReport && handleComplete(singleSelectedReport.id)} disabled={!singleSelectedReport} />
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
            <EmptyState title="Carregando..." />
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
                <Label className="text-xs mb-1 block">Período - Início *</Label>
                <Input type="date" className="h-9" value={formData.period_start} onChange={(e) => setFormData(prev => ({ ...prev, period_start: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Período - Fim *</Label>
                <Input type="date" className="h-9" value={formData.period_end} onChange={(e) => setFormData(prev => ({ ...prev, period_end: e.target.value }))} />
              </div>
            </div>

            {/* Depósitos Recebidos (antes das compras) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Depósitos Recebidos</h3>
                <Button type="button" variant="outline" size="sm" onClick={addDeposit}>
                  <Plus className="w-4 h-4 mr-1" /> Adicionar Depósito
                </Button>
              </div>
              <div className="space-y-3">
                {formData.deposits.map((deposit, index) => (
                  <div key={index} className="border rounded-lg p-3 relative bg-muted/20">
                    <div className="absolute top-2 right-2">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeDeposit(index)} className="h-6 w-6 text-red-500">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pr-8">
                      <div>
                        <Label className="text-xs mb-1 block">Valor Enviado (R$) *</Label>
                        <Input className="h-9" type="number" step="0.01" value={deposit.amount} onChange={(e) => handleDepositChange(index, 'amount', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Data *</Label>
                        <Input className="h-9" type="date" value={deposit.date} onChange={(e) => handleDepositChange(index, 'date', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Enviado Por *</Label>
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
                <h3 className="font-semibold">Lançamentos de Compras</h3>
                <Button type="button" variant="outline" size="sm" onClick={addPurchase}>
                  <Plus className="w-4 h-4 mr-1" /> Adicionar Compra
                </Button>
              </div>
              <div className="space-y-4">
                {formData.purchases.map((purchase, index) => (
                  <div key={purchase.item_id} className="border rounded-lg p-4 relative">
                    <div className="absolute top-2 right-2">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removePurchase(index)} className="h-6 w-6 text-red-500">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="text-sm font-medium text-muted-foreground mb-3">Compra #{index + 1}</div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div>
                        <Label className="text-xs mb-1 block">Local de Compra (Fornecedor) *</Label>
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
                        <Label className="text-xs mb-1 block">Data da Compra *</Label>
                        <Input className="h-9" type="date" value={purchase.purchase_date} onChange={(e) => handlePurchaseChange(index, 'purchase_date', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Valor da Compra (R$) *</Label>
                        <Input className="h-9" type="number" step="0.01" value={purchase.amount} onChange={(e) => handlePurchaseChange(index, 'amount', e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs mb-1 block">Observação</Label>
                        <Input className="h-9" value={purchase.observation} onChange={(e) => handlePurchaseChange(index, 'observation', e.target.value)} />
                      </div>
                    </div>

                    {/* Recibos */}
                    <div className="mt-3">
                      <Label className="text-xs mb-1 block">Recibos / Comprovantes</Label>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {(purchase.receipts || []).map((receipt) => (
                          <div key={receipt.id} className="relative">
                            <img src={api.getFileUrl(receipt.url)} alt="Recibo" className="w-16 h-16 object-cover rounded border" />
                            <button
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
                            <img src={URL.createObjectURL(pending.file)} alt="Recibo (pendente)" className="w-16 h-16 object-cover rounded border border-dashed border-primary" />
                            <button
                              type="button"
                              onClick={() => removePendingFile(index, pending.localId)}
                              className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                              title="Remover"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        <label className="w-16 h-16 flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded cursor-pointer text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                          <Camera className="w-5 h-5" />
                          <span className="text-[10px]">Anexar</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
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
              {saving ? 'Salvando...' : (editingReport ? 'Salvar Alterações' : 'Criar Prestação de Contas')}
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
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2">Data</th>
                        <th className="text-left p-2">Enviado Por</th>
                        <th className="text-right p-2">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedReport.deposits?.map((d, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{formatPeriodDate(d.date)}</td>
                          <td className="p-2">{d.sent_by}</td>
                          <td className="p-2 text-right">{formatMoney(d.amount)}</td>
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
              <Button variant="outline" onClick={() => handleReopen(selectedReport?.id)}>
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
      <ConfirmDialog />
    </Layout>
  );
}
