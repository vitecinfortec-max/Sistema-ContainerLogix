import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  DataCard, Toolbar, ToolbarButton, ToolbarPrimary, StatusPill, EmptyState,
} from '../components/DataPage';
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

  const barColor = level?.status === 'LOW' ? 'bg-red-500' : 'bg-primary';
  const badge = level?.status === 'LOW'
    ? { label: 'Nível baixo', tone: 'red' }
    : { label: 'Nível OK', tone: 'emerald' };

  return (
    <Layout>
      <div className="space-y-4" data-testid="fuel-tank-level-page">
        <PageHeader
          icon={Droplet}
          title="Nível do Tanque"
          subtitle="Combustível disponível no tanque próprio, descontado a cada Abastecimento vindo dele"
        />

        {/* Medidor */}
        <DataCard
          title="Medidor"
          meta={level?.configured && !loadingLevel ? <StatusPill tone={badge.tone}>{badge.label}</StatusPill> : null}
        >
          {loadingLevel ? (
            <EmptyState title="Carregando..." />
          ) : !level?.configured ? (
            <div className="px-6 py-10 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Settings className="w-6 h-6 text-slate-400 dark:text-slate-500" />
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">O tanque ainda não foi configurado</p>
              <p className="text-xs mt-1 mb-4 text-slate-400 dark:text-slate-500">Defina a capacidade e o alerta mínimo primeiro</p>
              <Link to="/tank-settings">
                <Button size="sm" data-testid="go-to-tank-settings-button">Configurar Tanque</Button>
              </Link>
            </div>
          ) : (
            <div className="p-5 space-y-3">
              <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Disponível agora</p>
                  <span className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmtLiters(level.current_liters)}</span>
                  <span className="text-sm text-slate-400 dark:text-slate-500 tabular-nums"> / {fmtLiters(level.capacity_liters)}</span>
                </div>
                <span className="text-2xl font-semibold tabular-nums text-slate-700 dark:text-slate-200">{level.percentage}%</span>
              </div>
              <div className="relative w-full h-6 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className={`h-full ${barColor} transition-all`} style={{ width: `${level.percentage}%` }} />
                {level.capacity_liters > 0 && (
                  // Marca do alerta mínimo em cima da barra
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500/70"
                    style={{ left: `${Math.min(100, (level.minimum_alert_liters / level.capacity_liters) * 100)}%` }}
                    title="Alerta mínimo"
                  />
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-0.5 bg-red-500/70" />
                Alerta mínimo: <span className="tabular-nums font-medium text-slate-700 dark:text-slate-200">{fmtLiters(level.minimum_alert_liters)}</span>
              </p>
            </div>
          )}
        </DataCard>

        {/* Histórico - só as Entradas (reabastecimentos) podem ser selecionadas;
            as Saídas vêm dos Abastecimentos e são excluídas por lá */}
        <DataCard
          title="Histórico"
          count={loadingLedger ? '...' : ledger.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Reabastecer tanque" onClick={openNewModal} testId="new-tank-refill-btn" />}
            >
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={handleDelete} disabled={selectedIds.size === 0} />
            </Toolbar>
          )}
        >
          {loadingLedger ? (
            <EmptyState title="Carregando..." />
          ) : ledger.length === 0 ? (
            <EmptyState icon={Droplet} title="Nenhuma movimentação de tanque registrada ainda" hint='Registre a primeira entrega pelo botão "Reabastecer tanque"' />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox
                        checked={ledger.some(l => l.type === 'ENTRADA') && ledger.filter(l => l.type === 'ENTRADA').every(l => selectedIds.has(l.id))}
                        onCheckedChange={toggleSelectAllOnPage}
                      />
                    </th>
                    <th>Tipo</th>
                    <th>Nº</th>
                    <th>Data</th>
                    <th className="!text-right">Litros</th>
                    <th>Fornecedor/Veículo</th>
                    <th>Observações</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((item) => {
                    const isEntrada = item.type === 'ENTRADA';
                    const isSelected = isEntrada && selectedIds.has(item.id);
                    return (
                      <tr
                        key={item.id}
                        data-selected={isSelected}
                        className={isEntrada ? 'cursor-pointer' : ''}
                        onClick={() => toggleSelect(item)}
                      >
                        <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                          {isEntrada && <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(item)} />}
                        </td>
                        <td>
                          <StatusPill tone={isEntrada ? 'primary' : 'amber'}>
                            {isEntrada ? 'Entrada' : 'Saída'}
                          </StatusPill>
                        </td>
                        <td className="cell-strong whitespace-nowrap tabular-nums">#{item.reference_number}</td>
                        <td className="whitespace-nowrap tabular-nums">{fmtDate(item.date)}</td>
                        <td className={`text-right whitespace-nowrap tabular-nums font-medium ${isEntrada ? 'text-primary' : 'text-amber-600 dark:text-amber-400'}`}>
                          {isEntrada ? '+' : '-'}{fmtLiters(item.liters)}
                        </td>
                        <td><div className="max-w-[240px] truncate" title={item.label || ''}>{item.label}</div></td>
                        <td><div className="max-w-[260px] truncate" title={item.observations || ''}>{item.observations || '-'}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
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
