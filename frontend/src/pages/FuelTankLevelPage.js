import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { api } from '../lib/api';
import { sanitizeKmInput } from '../lib/utils';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Droplet, Plus, Trash2, Settings } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const fmtLiters = (v) => v === null || v === undefined ? '-' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;

const fmtDate = (d) => {
  if (!d) return '-';
  try {
    return format(new Date(d + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR });
  } catch (e) {
    return d;
  }
};

function createEmptyForm() {
  return {
    refill_date: new Date().toISOString().split('T')[0],
    liters: '',
    supplier_name: '',
    observations: '',
  };
}

export default function FuelTankLevelPage() {
  const { confirm, ConfirmDialog } = useConfirm();

  const [level, setLevel] = useState(null);
  const [loadingLevel, setLoadingLevel] = useState(true);

  const [ledger, setLedger] = useState([]);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(createEmptyForm());

  useEffect(() => {
    loadLevel();
    loadLedger();
  }, []);

  const loadLevel = async () => {
    setLoadingLevel(true);
    try {
      const response = await api.getTankLevel();
      setLevel(response.data);
    } catch (error) {
      toast.error('Erro ao carregar nível do tanque');
    } finally {
      setLoadingLevel(false);
    }
  };

  const loadLedger = async () => {
    setLoadingLedger(true);
    try {
      const response = await api.getTankLedger();
      setLedger(response.data || []);
    } catch (error) {
      toast.error('Erro ao carregar histórico do tanque');
    } finally {
      setLoadingLedger(false);
    }
  };

  const openNewModal = () => {
    setFormData(createEmptyForm());
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.refill_date || !formData.liters) {
      toast.error('Preencha Data e Litros');
      return;
    }
    setSaving(true);
    try {
      await api.createTankRefill({ ...formData, liters: Number(formData.liters) });
      toast.success('Reabastecimento registrado com sucesso!');
      setModalOpen(false);
      loadLevel();
      loadLedger();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao registrar reabastecimento');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirm(`Deseja realmente excluir ${selectedIds.size} reabastecimento(s)?`))) return;
    try {
      await Promise.all([...selectedIds].map(id => api.deleteTankRefill(id)));
      toast.success('Reabastecimento(s) excluído(s)');
      setSelectedIds(new Set());
      loadLevel();
      loadLedger();
    } catch (error) {
      toast.error('Erro ao excluir reabastecimento');
    }
  };

  const toggleSelect = (item) => {
    if (item.type !== 'ENTRADA') return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedIds(prev => {
      const pageIds = ledger.filter(l => l.type === 'ENTRADA').map(l => l.id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...pageIds]);
    });
  };

  const barColor = level?.status === 'LOW' ? 'bg-red-500' : 'bg-emerald-500';
  const badge = level?.status === 'LOW'
    ? { label: 'Baixo', color: 'bg-red-100 text-red-800' }
    : { label: 'OK', color: 'bg-green-100 text-green-800' };

  return (
    <Layout>
      <div className="space-y-5" data-testid="fuel-tank-level-page">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Nível do Tanque</h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Combustível disponível no tanque próprio, descontado a cada Abastecimento vindo dele</p>
        </div>

        {/* Medidor */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Droplet className="w-4 h-4" />
              Medidor
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {loadingLevel ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : !level?.configured ? (
              <div className="p-6 text-center text-muted-foreground">
                <Settings className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">O tanque ainda não foi configurado</p>
                <p className="text-xs mt-1 mb-3">Defina a capacidade e o alerta mínimo primeiro</p>
                <Link to="/tank-settings">
                  <Button size="sm" data-testid="go-to-tank-settings-button">Configurar Tanque</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-2xl font-bold text-slate-800 dark:text-slate-200">{fmtLiters(level.current_liters)}</span>
                    <span className="text-sm text-slate-400 dark:text-slate-500"> / {fmtLiters(level.capacity_liters)}</span>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${badge.color}`}>{badge.label}</span>
                </div>
                <div className="w-full h-8 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full ${barColor} transition-all flex items-center justify-end`}
                    style={{ width: `${level.percentage}%` }}
                  >
                    {level.percentage > 10 && (
                      <span className="text-[11px] font-semibold text-white pr-2">{level.percentage}%</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Alerta mínimo: {fmtLiters(level.minimum_alert_liters)}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 p-1 w-fit">
          <Button
            variant="ghost"
            size="sm"
            onClick={openNewModal}
            className="h-9 px-3 gap-2 text-[13px] font-medium"
            title="Reabastecer Tanque"
            data-testid="new-tank-refill-btn"
          >
            <Plus className="w-4 h-4 text-primary" />
            Reabastecer Tanque
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={selectedIds.size === 0}
            className="h-9 w-9 p-0 disabled:opacity-30"
            title="Excluir"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
          {selectedIds.size > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 pr-1">
              {selectedIds.size} selecionado(s)
            </span>
          )}
        </div>

        {/* Histórico */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Droplet className="w-4 h-4" />
              Histórico ({ledger.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingLedger ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : ledger.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                Nenhuma movimentação de tanque registrada ainda
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left w-10">
                        <Checkbox
                          checked={ledger.some(l => l.type === 'ENTRADA') && ledger.filter(l => l.type === 'ENTRADA').every(l => selectedIds.has(l.id))}
                          onCheckedChange={toggleSelectAllOnPage}
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tipo</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Litros</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Fornecedor/Veículo</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Observações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((item, idx) => {
                      const isEntrada = item.type === 'ENTRADA';
                      const isSelected = isEntrada && selectedIds.has(item.id);
                      return (
                        <tr
                          key={item.id}
                          className={`transition-colors ${isEntrada ? 'cursor-pointer' : ''} ${isSelected ? 'bg-primary/10 hover:bg-primary/15' : `${isEntrada ? 'hover:bg-slate-50 dark:hover:bg-slate-800/80' : ''} ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}`}
                          onClick={() => toggleSelect(item)}
                        >
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            {isEntrada && <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(item)} />}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${isEntrada ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {isEntrada ? 'Entrada' : 'Saída'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{item.reference_number}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtDate(item.date)}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{fmtLiters(item.liters)}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{item.label}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{item.observations || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal Reabastecer Tanque */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Droplet className="w-4 h-4 text-primary" />
              Reabastecer Tanque
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Data *</Label>
                <Input
                  type="date"
                  className="h-9"
                  value={formData.refill_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, refill_date: e.target.value }))}
                />
              </div>
              <div>
                <Label>Litros *</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  className="h-9"
                  value={formData.liters}
                  onChange={(e) => {
                    const v = sanitizeKmInput(e.target.value);
                    if (v !== null) setFormData(prev => ({ ...prev, liters: v }));
                  }}
                />
              </div>
              <div className="col-span-2">
                <Label>Fornecedor</Label>
                <Input
                  className="h-9"
                  value={formData.supplier_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, supplier_name: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <Label>Observações</Label>
                <Input
                  className="h-9"
                  value={formData.observations}
                  onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving} data-testid="save-tank-refill-btn">
              {saving ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </Layout>
  );
}
