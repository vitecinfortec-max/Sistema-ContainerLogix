import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { HandCoins, CheckCircle2, RotateCcw, Pencil, Search, Download, FileSpreadsheet } from 'lucide-react';

const STATUS_LABELS = { PENDENTE: 'Pendente', PAGO: 'Pago', CANCELADO: 'Cancelado' };
const STATUS_BADGE_CLASS = {
  PENDENTE: 'bg-amber-100 text-amber-700',
  PAGO: 'bg-emerald-100 text-emerald-700',
  CANCELADO: 'bg-rose-100 text-rose-700',
};

const formatMoney = (value) => (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function FreightPaymentsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [drivers, setDrivers] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [driverFilterName, setDriverFilterName] = useState('');
  const [driverFilterId, setDriverFilterId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ freight_value: '', observations: '' });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [reportDriverName, setReportDriverName] = useState('');
  const [reportDriverId, setReportDriverId] = useState('');
  const [reportDateFrom, setReportDateFrom] = useState('');
  const [reportDateTo, setReportDateTo] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => { loadDrivers(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadList(); }, [driverFilterId, statusFilter, dateFrom, dateTo]);

  const loadDrivers = async () => {
    try {
      const r = await api.getDrivers();
      setDrivers(r.data || []);
    } catch (e) { /* ignore */ }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const params = {};
      if (driverFilterId) params.driver_id = driverFilterId;
      if (statusFilter) params.status = statusFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const r = await api.getFreightPayments(params);
      setList(r.data || []);
    } catch (e) {
      toast.error('Erro ao carregar pagamentos de frete');
    } finally {
      setLoading(false);
    }
  };

  const onSelectDriverFilter = (d) => {
    setDriverFilterName(d.name);
    setDriverFilterId(d.id);
  };

  const onChangeDriverFilterText = (v) => {
    setDriverFilterName(v);
    if (!v) setDriverFilterId('');
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = list.map((p) => p.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const singleSelected = selectedIds.size === 1 ? list.find((p) => p.id === [...selectedIds][0]) : null;

  const markStatus = async (id, status) => {
    try {
      await api.updateFreightPaymentStatus(id, status);
      toast.success(status === 'PAGO' ? 'Marcado como Pago' : 'Marcado como Pendente');
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao atualizar status');
    }
  };

  const openEdit = (payment) => {
    setEditingId(payment.id);
    setEditForm({ freight_value: payment.freight_value, observations: payment.observations || '' });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.updateFreightPayment(editingId, {
        freight_value: parseFloat(editForm.freight_value) || 0,
        observations: editForm.observations,
      });
      toast.success('Pagamento atualizado');
      setEditOpen(false);
      loadList();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Erro ao atualizar pagamento');
    } finally { setSaving(false); }
  };

  const onSelectReportDriver = (d) => {
    setReportDriverName(d.name);
    setReportDriverId(d.id);
  };

  const downloadReport = async (kind) => {
    if (!reportDriverId) {
      toast.error('Selecione um motorista');
      return;
    }
    setGenerating(true);
    try {
      const params = { driver_id: reportDriverId };
      if (reportDateFrom) params.date_from = reportDateFrom;
      if (reportDateTo) params.date_to = reportDateTo;
      const r = kind === 'pdf' ? await api.getFreightPaymentReportPDF(params) : await api.getFreightPaymentReportExcel(params);
      const ext = kind === 'pdf' ? 'pdf' : 'xlsx';
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `PrestacaoContas_${reportDriverName.replace(/\s+/g, '_')}.${ext}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Relatório gerado!');
    } catch (e) {
      toast.error('Erro ao gerar relatório');
    } finally { setGenerating(false); }
  };

  return (
    <Layout>
      <div className="space-y-5" data-testid="freight-payments-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <HandCoins className="w-4 h-4" />
            Pagamento Frete
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Lançamentos gerados a partir das Ordens de Coleta aprovadas em rotas cadastradas</p>
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-2 px-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Filtrar
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label className="mb-1 block text-xs">Motorista</Label>
                <Autocomplete
                  value={driverFilterName}
                  onChange={onChangeDriverFilterText}
                  onSelect={onSelectDriverFilter}
                  options={drivers}
                  displayField="name"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Status</Label>
                <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todos</SelectItem>
                    <SelectItem value="PENDENTE">Pendente</SelectItem>
                    <SelectItem value="PAGO">Pago</SelectItem>
                    <SelectItem value="CANCELADO">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs">De</Label>
                <Input type="date" className="h-9 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Até</Label>
                <Input type="date" className="h-9 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Barra de ações - marque um lançamento na tabela abaixo pra habilitar as ações. Sem
            botão "Adicionar": lançamentos só nascem automaticamente quando uma Ordem de Coleta
            numa Rota cadastrada é Aprovada. */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelected && markStatus(singleSelected.id, 'PAGO')}
            disabled={!singleSelected || singleSelected.status !== 'PENDENTE'}
            title="Marcar como Pago"
            data-testid="freight-payment-mark-paid"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelected && markStatus(singleSelected.id, 'PENDENTE')}
            disabled={!singleSelected || singleSelected.status !== 'PAGO'}
            title="Marcar como Pendente"
            data-testid="freight-payment-mark-pending"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <RotateCcw className="w-4 h-4 text-amber-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => singleSelected && openEdit(singleSelected)}
            disabled={!singleSelected || singleSelected.status !== 'PENDENTE'}
            title="Editar"
            data-testid="freight-payment-edit"
            className="h-9 w-9 p-0 disabled:opacity-30"
          >
            <Pencil className="w-4 h-4 text-blue-600" />
          </Button>
          {selectedIds.size > 0 && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 pl-1 pr-2">
              {selectedIds.size} selecionado{selectedIds.size > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <HandCoins className="w-4 h-4" />
              {loading ? 'Carregando...' : `Lançamentos (${list.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-800">
                    <TableHead className="w-9">
                      <Checkbox
                        checked={list.length > 0 && list.every((p) => selectedIds.has(p.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                        data-testid="select-all-checkbox"
                      />
                    </TableHead>
                    <TableHead className="text-[12px] font-semibold">Nº</TableHead>
                    <TableHead className="text-[12px] font-semibold">Ordem Nº</TableHead>
                    <TableHead className="text-[12px] font-semibold">Rota</TableHead>
                    <TableHead className="text-[12px] font-semibold">Motorista</TableHead>
                    <TableHead className="text-[12px] font-semibold">Transportadora</TableHead>
                    <TableHead className="text-[12px] font-semibold">Valor do Frete</TableHead>
                    <TableHead className="text-[12px] font-semibold">Status</TableHead>
                    <TableHead className="text-[12px] font-semibold">Aprovação</TableHead>
                    <TableHead className="text-[12px] font-semibold">Pagamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.length === 0 && !loading && (
                    <TableRow><TableCell colSpan={10} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">Nenhum lançamento encontrado.</TableCell></TableRow>
                  )}
                  {list.map((p) => (
                    <TableRow
                      key={p.id}
                      onClick={() => toggleSelect(p.id)}
                      className={`cursor-pointer transition-colors ${selectedIds.has(p.id) ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                      data-testid={`freight-payment-row-${p.payment_number}`}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(p.id)}
                          onCheckedChange={() => toggleSelect(p.id)}
                        />
                      </TableCell>
                      <TableCell className="text-[13px] font-semibold text-primary">Nº {p.payment_number}</TableCell>
                      <TableCell className="text-[13px]">Nº {p.order_number}</TableCell>
                      <TableCell className="text-[13px]">{p.route_name || '-'}</TableCell>
                      <TableCell className="text-[13px]">{p.driver_name || '-'}</TableCell>
                      <TableCell className="text-[13px]">{p.transport_company || '-'}</TableCell>
                      <TableCell className="text-[13px]">{formatMoney(p.freight_value)}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_BADGE_CLASS[p.status] || 'bg-slate-100 text-slate-600'}`}>
                          {STATUS_LABELS[p.status] || p.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-[12px]">{p.created_at ? format(new Date(p.created_at), 'dd/MM/yyyy HH:mm') : '-'}</TableCell>
                      <TableCell className="text-[12px]">{p.paid_at ? format(new Date(p.paid_at), 'dd/MM/yyyy HH:mm') : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Gerar Prestação de Contas</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-4 gap-3 items-end">
              <div>
                <Label className="mb-1 block text-xs">Motorista *</Label>
                <Autocomplete
                  value={reportDriverName}
                  onChange={(v) => { setReportDriverName(v); if (!v) setReportDriverId(''); }}
                  onSelect={onSelectReportDriver}
                  options={drivers}
                  displayField="name"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">De</Label>
                <Input type="date" className="h-9 text-sm" value={reportDateFrom} onChange={(e) => setReportDateFrom(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Até</Label>
                <Input type="date" className="h-9 text-sm" value={reportDateTo} onChange={(e) => setReportDateTo(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="h-9 text-[13px]" disabled={generating} onClick={() => downloadReport('pdf')} data-testid="freight-payment-report-pdf">
                  <Download className="w-4 h-4 mr-1.5" />PDF
                </Button>
                <Button variant="outline" className="h-9 text-[13px]" disabled={generating} onClick={() => downloadReport('excel')} data-testid="freight-payment-report-excel">
                  <FileSpreadsheet className="w-4 h-4 mr-1.5" />Excel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent data-testid="freight-payment-edit-dialog">
          <DialogHeader>
            <DialogTitle className="text-base">Editar Pagamento Frete</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Valor do Frete</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                className="h-10 text-[13px]"
                value={editForm.freight_value}
                onChange={(e) => setEditForm({ ...editForm, freight_value: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Observações</Label>
              <Textarea
                className="text-[13px] min-h-[60px]"
                value={editForm.observations}
                onChange={(e) => setEditForm({ ...editForm, observations: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleEditSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
