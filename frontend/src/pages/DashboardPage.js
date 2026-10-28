import { useEffect, useMemo, useState, useCallback } from 'react';
import Layout from '../components/Layout';
import { PageSkeleton } from '../components/DataPage';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { api } from '../lib/api';
import {
  ArrowDownCircle, ArrowUpCircle, Container, Package, Plus, Calendar, ArrowRight,
  Receipt, Truck, Users, BarChart3, DollarSign, Ship, Building2,
  ClipboardList, Check, Settings2, Trophy, Medal, Award, AlertTriangle, CheckCircle2,
  Fuel, Wrench, Clock, FileCheck, PackageCheck, FileText, Car, Clipboard, Boxes, ArrowLeftRight,
  Calculator, HardHat, Scale, Percent, PiggyBank, FileSpreadsheet
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useModuleConfig } from '../context/ModuleConfigContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useWebSocket } from '../hooks/useWebSocket';
import { motion, Stagger, StaggerItem, AnimatedNumber, riseIn, staggerParent, EASE } from '../components/Motion';
import { DonutChart, Sparkline, CHART_COLORS, dailyChartData } from '../components/Charts';
import Stage3D from '../components/three/Stage3D';
import { yardScene, yardPlan } from '../components/three/yardScene';

const RANK_STYLES = [
  { icon: Trophy, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
  { icon: Medal, color: 'text-slate-400', bg: 'bg-slate-100 dark:bg-slate-700' },
  { icon: Award, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-500/10' },
];

const ALERT_TONES = {
  red: {
    pill: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20',
    dot: 'bg-red-500',
  },
  orange: {
    pill: 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300 dark:hover:bg-orange-500/20',
    dot: 'bg-orange-500',
  },
  amber: {
    pill: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20',
    dot: 'bg-amber-500',
  },
};

// Alerta clicável do Dashboard. Os críticos (vermelhos) têm um ponto pulsando
// pra chamar o olho; a seta aparece ao passar o mouse.
function AlertPill({ tone, icon: Icon, onClick, testId, children }) {
  const style = ALERT_TONES[tone];
  return (
    <motion.button
      type="button"
      variants={riseIn}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`group inline-flex items-center gap-1.5 rounded-full border py-1 pl-2 pr-2.5 text-xs font-semibold transition-colors ${style.pill}`}
      data-testid={testId}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {tone === 'red' && <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping motion-reduce:animate-none ${style.dot}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${style.dot}`} />
      </span>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="text-left">{children}</span>
      <ArrowRight className="w-3 h-3 shrink-0 -ml-1 opacity-0 transition-all group-hover:ml-0 group-hover:opacity-100" />
    </motion.button>
  );
}

// Linha da legenda do estoque: quantidade, participação e barra proporcional
function StockShare({ label, value, share, barClass, dotClass, testId }) {
  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <span className={`w-2.5 h-2.5 rounded-full inline-block ${dotClass}`} />
          {label}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-200"><AnimatedNumber value={value} /></span>
          <span className="w-9 text-right text-[11px] tabular-nums text-slate-400 dark:text-slate-500">{share}%</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${barClass}`}
          initial={{ width: 0 }}
          animate={{ width: `${share}%` }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.3 }}
        />
      </div>
    </div>
  );
}

// Atalhos do painel. "kind" separa telas de trabalho (ferramentas) de
// relatórios - são os filtros Todos / Ferramentas / Relatórios do bloco.
// Os ids antigos foram mantidos porque ficam gravados no usuário.
const ALL_SHORTCUTS = [
  { id: 'new-movement', label: 'Novo Registro', icon: Plus, path: '/movements/new', kind: 'tool', moduleKey: 'terminal.movimentacoes' },
  { id: 'movements', label: 'Gate', icon: Container, path: '/movements', kind: 'tool', moduleKey: 'terminal.movimentacoes' },
  { id: 'cte', label: 'Emissão de CT-e', icon: FileCheck, path: '/fiscal/cte', kind: 'tool', moduleKey: 'fiscal.cte' },
  { id: 'mdfe', label: 'Manifesto (MDF-e)', icon: Truck, path: '/fiscal/mdfe', kind: 'tool', moduleKey: 'fiscal.mdfe' },
  { id: 'loading-orders', label: 'Ordem de Carregamento', icon: PackageCheck, path: '/loading-orders', kind: 'tool', moduleKey: 'operacional.ordem_carregamento' },
  { id: 'loading-schedules', label: 'Programação de Carregamento', icon: Calendar, path: '/loading-schedules', kind: 'tool', moduleKey: 'operacional.programacao_carregamento' },
  { id: 'freight-contract', label: 'Contrato de Frete', icon: FileText, path: '/fleet/rpa-terceiro', kind: 'tool', moduleKey: 'financeiro.rpa_terceiro' },
  { id: 'vehicles', label: 'Lista de Veículos', icon: Car, path: '/fleet', kind: 'tool', moduleKey: 'frota.veiculos' },
  { id: 'fuel-order', label: 'Ordem de Abastecimento', icon: Clipboard, path: '/fleet/ordem-abastecimento', kind: 'tool', moduleKey: 'frota.ordem_abastecimento' },
  { id: 'fuel-supply', label: 'Abastecimento', icon: Fuel, path: '/fleet/abastecimento', kind: 'tool', moduleKey: 'frota.abastecimento' },
  { id: 'service-order', label: 'Ordens de Serviço', icon: Wrench, path: '/fleet/ordem-servico', kind: 'tool', moduleKey: 'frota.ordem_servico' },
  { id: 'stock', label: 'Estoque de Produtos', icon: Boxes, path: '/estoque', kind: 'tool', moduleKey: 'estoque.consulta' },
  { id: 'stock-movement', label: 'Movimentação de Estoque', icon: ArrowLeftRight, path: '/estoque/movimentacao', kind: 'tool', moduleKey: 'estoque.movimentacao' },
  { id: 'products', label: 'Produtos Cadastrados', icon: Package, path: '/estoque/produtos', kind: 'tool', moduleKey: 'estoque.produto' },
  { id: 'invoices', label: 'Faturas', icon: Receipt, path: '/billing', kind: 'tool', moduleKey: 'financeiro.faturas', adminOnly: true },
  { id: 'expense-reports', label: 'Prestação de Contas', icon: Calculator, path: '/expense-reports', kind: 'tool', moduleKey: 'financeiro.prestacao_contas', adminOnly: true },
  { id: 'service-providers', label: 'Prestadores de Serviço', icon: HardHat, path: '/service-providers', kind: 'tool', moduleKey: 'financeiro.prestadores_servico', adminOnly: true },
  { id: 'commission', label: 'Comissão', icon: Percent, path: '/comercial/comissao', kind: 'tool', moduleKey: 'comercial.comissao' },
  { id: 'clients', label: 'Clientes', icon: Users, path: '/clients', kind: 'tool' },
  { id: 'drivers', label: 'Motoristas', icon: Truck, path: '/drivers', kind: 'tool' },
  { id: 'companies', label: 'Transportadoras', icon: Building2, path: '/companies', kind: 'tool' },
  { id: 'shipping-lines', label: 'Armadores', icon: Ship, path: '/shipping-lines', kind: 'tool', moduleKey: 'cadastro.armador' },
  { id: 'service-types', label: 'Tipos de Serviço', icon: ClipboardList, path: '/service-types', kind: 'tool', moduleKey: 'cadastro.tipos_servico' },
  { id: 'report-movements', label: 'Rel. Movimentações', icon: BarChart3, path: '/reports/movements', kind: 'report', moduleKey: 'terminal.movimentacoes' },
  { id: 'report-billing', label: 'Rel. Faturamento', icon: DollarSign, path: '/reports/billing', kind: 'report', moduleKey: 'financeiro.relatorio_faturamento', adminOnly: true },
  { id: 'report-fuel', label: 'Rel. Abastecimento', icon: Fuel, path: '/reports/fuel-supply', kind: 'report', moduleKey: 'frota.relatorio_abastecimento' },
  { id: 'report-services', label: 'Rel. Ordens de Serviço', icon: Wrench, path: '/reports/service-orders', kind: 'report', moduleKey: 'frota.relatorio_servicos' },
  { id: 'report-stock', label: 'Rel. do Estoque', icon: FileSpreadsheet, path: '/estoque/relatorio', kind: 'report', moduleKey: 'estoque.relatorio' },
  { id: 'receivables', label: 'Contas a Receber', icon: PiggyBank, path: '/reports/receivables', kind: 'report', moduleKey: 'financeiro.faturas', adminOnly: true },
  { id: 'financial-summary', label: 'Resumo Financeiro', icon: Scale, path: '/financial-summary', kind: 'report', moduleKey: 'financeiro', adminOnly: true },
];

const SHORTCUT_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'tool', label: 'Ferramentas', icon: Wrench },
  { id: 'report', label: 'Relatórios', icon: BarChart3 },
];

const DEFAULT_SHORTCUT_IDS = [
  'new-movement', 'movements', 'cte', 'mdfe', 'loading-orders', 'freight-contract', 'vehicles', 'fuel-supply',
  'service-order', 'stock', 'invoices', 'clients', 'report-movements', 'report-billing', 'report-fuel',
];

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState({ over_30: 0, over_60: 0, over_90: 0, maintenance_due_soon: 0, maintenance_overdue: 0, tank_low: false });
  const [userShortcuts, setUserShortcuts] = useState(DEFAULT_SHORTCUT_IDS);
  const [showEditor, setShowEditor] = useState(false);
  const [editorSelection, setEditorSelection] = useState([]);
  const [shortcutFilter, setShortcutFilter] = useState('all');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isModuleEnabled } = useModuleConfig();
  const isAdmin = user?.role === 'admin';

  const handleWebSocketMessage = useCallback((message) => {
    if (message.type === 'MOVEMENT_CREATED' || message.type === 'MOVEMENT_DELETED') {
      loadStats();
      loadAlerts();
    }
  }, []);

  useWebSocket(handleWebSocketMessage);

  useEffect(() => {
    loadStats();
    loadShortcuts();
    loadAlerts();
  }, []);

  const loadStats = async () => {
    try {
      const response = await api.getDashboardStats();
      setStats(response.data);
    } catch (error) {
      toast.error('Erro ao carregar estatísticas');
    } finally {
      setLoading(false);
    }
  };

  const loadAlerts = async () => {
    try {
      const response = await api.getAlertsSummary();
      setAlerts({
        over_30: response.data.yard_over_30_days || 0,
        over_60: response.data.yard_over_60_days || 0,
        over_90: response.data.yard_over_90_days || 0,
        maintenance_due_soon: response.data.maintenance_due_soon || 0,
        maintenance_overdue: response.data.maintenance_overdue || 0,
        tank_low: !!response.data.tank_low,
      });
    } catch (error) {
      console.error('Erro ao carregar alertas:', error);
    }
  };

  const loadShortcuts = async () => {
    try {
      const response = await api.getUserShortcuts();
      if (response.data.shortcuts) {
        setUserShortcuts(response.data.shortcuts);
      }
    } catch (error) {
      console.error('Erro ao carregar atalhos:', error);
      toast.error('Erro ao carregar atalhos personalizados');
    }
  };

  const saveShortcuts = async (ids) => {
    try {
      await api.updateUserShortcuts(ids);
      setUserShortcuts(ids);
      setShowEditor(false);
      toast.success('Atalhos atualizados!');
    } catch (error) {
      toast.error('Erro ao salvar atalhos');
    }
  };

  const openEditor = () => {
    setEditorSelection([...userShortcuts]);
    setShowEditor(true);
  };

  const toggleShortcut = (id) => {
    setEditorSelection(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  // Só aparecem os atalhos de módulos contratados (e os do Financeiro só pro
  // administrador, como no menu)
  const availableShortcuts = ALL_SHORTCUTS.filter((s) => isModuleEnabled(s.moduleKey) && (!s.adminOnly || isAdmin));
  const pinnedShortcuts = availableShortcuts.filter((s) => userShortcuts.includes(s.id));
  const activeShortcuts = pinnedShortcuts.filter((s) => shortcutFilter === 'all' || s.kind === shortcutFilter);
  const alertCount = alerts.over_30 + alerts.over_60 + alerts.over_90 + alerts.maintenance_due_soon + alerts.maintenance_overdue + (alerts.tank_low ? 1 : 0);

  const currentMonth = format(new Date(), 'MMMM', { locale: ptBR });
  const capitalizedMonth = currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1);

  const dailyTrend = useMemo(() => dailyChartData(stats?.daily_chart), [stats?.daily_chart]);
  const stockFull = stats?.stock_full || 0;
  const stockEmpty = stats?.stock_empty || 0;
  const stockTotal = stockFull + stockEmpty;
  // Participação em % inteiros que somam 100 (arredondar os dois lados dava 101)
  const fullShare = stockTotal > 0 ? Math.round((stockFull / stockTotal) * 100) : 0;
  const emptyShare = stockTotal > 0 ? 100 - fullShare : 0;
  const yardUnit = yardPlan(stockFull, stockEmpty).unit;
  const rankingMax = Math.max(1, ...(stats?.driver_ranking || []).map((d) => d.total || 0));

  if (loading) {
    return (
      <Layout>
        <PageSkeleton testId="dashboard-loading" />
      </Layout>
    );
  }

  return (
    <Layout>
      <Stagger className="space-y-5 no-card-in" stagger={0.07} data-testid="dashboard-container">
        {/* Atalhos (à esquerda) e Alertas do Sistema (coluna da direita). O
            painel abre direto nas telas de trabalho do dia, filtradas por
            Ferramentas/Relatórios; os alertas ficam sempre à vista do lado. */}
        <StaggerItem className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="shortcuts-card">
            <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-100" data-testid="shortcuts-title">Atalhos</CardTitle>
                <Button variant="outline" size="sm" onClick={openEditor} className="h-8 gap-1.5 text-[13px]" data-testid="edit-shortcuts-button">
                  <Settings2 className="w-4 h-4 text-primary" />
                  Personalizar atalhos
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap" role="tablist" aria-label="Tipo de atalho">
                {SHORTCUT_FILTERS.map((f) => {
                  const FilterIcon = f.icon;
                  const active = shortcutFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setShortcutFilter(f.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-[13px] font-medium transition-colors ${
                        active
                          ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                      data-testid={`shortcut-filter-${f.id}`}
                    >
                      {FilterIcon && <FilterIcon className={`w-3.5 h-3.5 ${active ? '' : 'text-primary'}`} />}
                      {f.label}
                    </button>
                  );
                })}
              </div>
              <motion.div variants={staggerParent(0.03)} className="grid grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-2.5">
                {activeShortcuts.map((shortcut) => {
                  const Icon = shortcut.icon;
                  return (
                    <motion.button
                      key={shortcut.id}
                      variants={riseIn}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => navigate(shortcut.path)}
                      className="group flex items-center gap-2.5 sm:gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 sm:px-3 py-2.5 text-left hover:border-primary/50 hover:bg-primary/[0.03] hover:shadow-sm transition-[border-color,background-color,box-shadow] cursor-pointer"
                      data-testid={`shortcut-${shortcut.id}`}
                    >
                      <span className="relative w-9 h-9 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                        <Icon className="w-[18px] h-[18px] text-primary" />
                        {shortcut.kind === 'report' && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white dark:bg-slate-900 flex items-center justify-center">
                            <BarChart3 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                          </span>
                        )}
                      </span>
                      <span className="text-[13px] font-medium leading-tight text-slate-700 dark:text-slate-200">{shortcut.label}</span>
                    </motion.button>
                  );
                })}

                <motion.button
                  variants={riseIn}
                  whileTap={{ scale: 0.98 }}
                  onClick={openEditor}
                  className="flex items-center gap-3 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 px-3 py-2 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer"
                  data-testid="add-shortcut-button"
                >
                  <span className="w-9 h-9 shrink-0 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                    <Plus className="w-[18px] h-[18px] text-slate-400 dark:text-slate-500" />
                  </span>
                  <span className="text-[13px] font-medium text-slate-400 dark:text-slate-500">Adicionar atalho</span>
                </motion.button>
              </motion.div>
              {activeShortcuts.length === 0 && pinnedShortcuts.length > 0 && (
                <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">Nenhum atalho desse tipo. Use "Personalizar atalhos" para incluir.</p>
              )}
            </CardContent>
          </Card>

          <Card className="order-first lg:order-none border border-slate-200 dark:border-slate-700 shadow-none" data-testid="system-alerts-card">
            <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-100">Alertas do Sistema</CardTitle>
                {alertCount > 0 && (
                  <span className="ml-auto rounded-full bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300 text-[11px] font-semibold px-2 py-0.5 tabular-nums">{alertCount}</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-4 py-3">
              {alertCount > 0 ? (
                <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="flex flex-col items-start gap-2">
                  {alerts.tank_low && (
                    <AlertPill tone="red" icon={Fuel} onClick={() => navigate('/fleet/nivel-tanque')} testId="alert-tank-low">
                      Tanque de combustível abaixo do mínimo
                    </AlertPill>
                  )}
                  {alerts.maintenance_overdue > 0 && (
                    <AlertPill tone="red" icon={Wrench} onClick={() => navigate('/fleet/hodometro')} testId="alert-maintenance-overdue">
                      {alerts.maintenance_overdue} veículo{alerts.maintenance_overdue > 1 ? 's' : ''} com manutenção vencida
                    </AlertPill>
                  )}
                  {alerts.maintenance_due_soon > 0 && (
                    <AlertPill tone="amber" icon={Wrench} onClick={() => navigate('/fleet/hodometro')} testId="alert-maintenance-due-soon">
                      {alerts.maintenance_due_soon} veículo{alerts.maintenance_due_soon > 1 ? 's' : ''} com manutenção próxima
                    </AlertPill>
                  )}
                  {alerts.over_30 > 0 && (
                    <AlertPill tone="amber" icon={Clock} onClick={() => navigate('/yard-control?min_days=31')} testId="alert-over-30">
                      {alerts.over_30} container{alerts.over_30 > 1 ? 's' : ''} há mais de 30 dias no pátio
                    </AlertPill>
                  )}
                  {alerts.over_60 > 0 && (
                    <AlertPill tone="orange" icon={Clock} onClick={() => navigate('/yard-control?min_days=61')} testId="alert-over-60">
                      {alerts.over_60} container{alerts.over_60 > 1 ? 's' : ''} há mais de 60 dias no pátio
                    </AlertPill>
                  )}
                  {alerts.over_90 > 0 && (
                    <AlertPill tone="red" icon={Clock} onClick={() => navigate('/yard-control?min_days=91')} testId="alert-over-90">
                      {alerts.over_90} container{alerts.over_90 > 1 ? 's' : ''} há mais de 90 dias no pátio
                    </AlertPill>
                  )}
                </motion.div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-6 text-sm text-slate-500 dark:text-slate-400">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  Nenhum alerta no momento
                </div>
              )}
            </CardContent>
          </Card>
        </StaggerItem>

        {/* Personalizar atalhos - Dialog padrão: prende o foco, fecha com Esc e
            é anunciado como diálogo pelo leitor de tela */}
        <Dialog open={showEditor} onOpenChange={setShowEditor}>
          <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden" data-testid="shortcuts-editor-modal">
            <div className="px-5 py-4 pr-12 border-b border-slate-100 dark:border-slate-800">
              <DialogTitle className="text-base font-semibold text-slate-800 dark:text-slate-200">Personalizar Atalhos</DialogTitle>
            </div>
            <div className="p-5 max-h-[65vh] overflow-y-auto">
              <DialogDescription className="text-sm text-slate-500 dark:text-slate-400 mb-4">Selecione as telas e relatórios que deseja ter à mão no painel:</DialogDescription>
              {['tool', 'report'].map((kind) => (
              <div key={kind} className="mb-4 last:mb-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">{kind === 'tool' ? 'Ferramentas' : 'Relatórios'}</p>
              <div className="grid grid-cols-2 gap-2">
                {availableShortcuts.filter((x) => x.kind === kind).map((shortcut) => {
                  const Icon = shortcut.icon;
                  const isSelected = editorSelection.includes(shortcut.id);
                  return (
                    <button
                      key={shortcut.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggleShortcut(shortcut.id)}
                      className={`flex items-center gap-2.5 p-2.5 rounded-lg border-2 text-left transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                      data-testid={`editor-shortcut-${shortcut.id}`}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-4 h-4 text-primary" />
                      </div>
                      <span className={`text-[13px] font-medium leading-tight flex-1 ${isSelected ? 'text-primary' : 'text-slate-600 dark:text-slate-400'}`}>
                        {shortcut.label}
                      </span>
                      {isSelected && (
                        <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
              </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <span className="text-xs text-slate-400 dark:text-slate-500">{editorSelection.filter((id) => availableShortcuts.some((x) => x.id === id)).length} selecionados</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEditor(false)}
                  className="h-9"
                  data-testid="editor-cancel-button"
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveShortcuts(editorSelection)}
                  className="h-9 bg-primary hover:bg-primary/90"
                  data-testid="editor-save-button"
                >
                  Salvar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Stats Grid - 4 cards */}
        <motion.div variants={staggerParent(0.05)} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div variants={riseIn}>
  <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="stat-entries-today">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <ArrowDownCircle className="w-5 h-5 text-primary" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-slate-800 dark:text-slate-200 tabular-nums"><AnimatedNumber value={stats?.entries_today || 0} /></div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Entradas Hoje</p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={riseIn}>
  <Card className="border border-slate-200 dark:border-slate-700 shadow-none hover:border-amber-300 transition-colors" data-testid="stat-exits-today">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                    <ArrowUpCircle className="w-5 h-5 text-amber-500" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-slate-800 dark:text-slate-200 tabular-nums"><AnimatedNumber value={stats?.exits_today || 0} /></div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Saídas Hoje</p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={riseIn}>
  <Card className="border border-slate-200 dark:border-slate-700 shadow-none hover:border-emerald-300 transition-colors" data-testid="stat-stock-full">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                    <Package className="w-5 h-5 text-emerald-500" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-slate-800 dark:text-slate-200 tabular-nums"><AnimatedNumber value={stats?.stock_full || 0} /></div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Estoque Cheios</p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={riseIn}>
  <Card className="border border-slate-200 dark:border-slate-700 shadow-none hover:border-slate-300 dark:hover:border-slate-600 transition-colors" data-testid="stat-stock-empty">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <Container className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-slate-800 dark:text-slate-200 tabular-nums"><AnimatedNumber value={stats?.stock_empty || 0} /></div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Estoque Vazios</p>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>

        {/* Recent Movements Table */}
        <StaggerItem>
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="recent-movements-card">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Registros de Gate Recentes</CardTitle>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => navigate('/movements')}
                className="text-xs text-primary hover:text-primary hover:bg-primary/5 h-7 px-2"
                data-testid="view-all-movements-button"
              >
                Ver todas
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {stats?.recent_movements && stats.recent_movements.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Data/Hora</th>
                      <th>Tipo</th>
                      <th>Container</th>
                      <th>Motorista</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recent_movements.map((movement, idx) => (
                      <tr 
                        key={movement.id} 
                        className={`hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}
                        data-testid="movement-row"
                      >
                        <td className="text-sm text-slate-600 dark:text-slate-400">
                          {format(new Date(movement.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                        </td>
                        <td>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                            movement.operation_type === 'ENTRADA' 
                              ? 'bg-primary/10 text-primary' 
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                          }`}>
                            {movement.operation_type}
                          </span>
                        </td>
                        <td className="text-sm font-mono font-medium text-slate-800 dark:text-slate-200">{movement.container_number}</td>
                        <td className="text-sm text-slate-600 dark:text-slate-400">{movement.driver_name}</td>
                        <td>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            movement.status === 'CHEIO' 
                              ? 'bg-emerald-50 text-emerald-700' 
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                          }`}>
                            {movement.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-400 dark:text-slate-500" data-testid="no-movements">
                <Container className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Nenhum registro cadastrado ainda</p>
              </div>
            )}
          </CardContent>
        </Card>
        </StaggerItem>
        {/* Monthly Stats */}
        <motion.div variants={staggerParent(0.05)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <motion.div variants={riseIn}>
  <Card className="border border-primary/20 shadow-none" data-testid="stat-entries-month">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-primary">Entradas no Mês</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-3xl font-bold text-slate-800 dark:text-slate-200 tabular-nums"><AnimatedNumber value={stats?.entries_month || 0} /></div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{capitalizedMonth}</p>
                  </div>
                  {dailyTrend.length > 1 ? (
                    <div className="text-right" data-testid="entries-trend">
                      <Sparkline data={dailyTrend} dataKey="entries" name="Entradas" color={CHART_COLORS.primary} className="h-12 w-32 sm:w-44" />
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">últimos 14 dias</p>
                    </div>
                  ) : (
                    <ArrowDownCircle className="w-10 h-10 text-primary/20" />
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={riseIn}>
  <Card className="border border-amber-200 dark:border-amber-500/30 shadow-none" data-testid="stat-exits-month">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-medium text-amber-600">Saídas no Mês</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-3xl font-bold text-slate-800 dark:text-slate-200 tabular-nums"><AnimatedNumber value={stats?.exits_month || 0} /></div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{capitalizedMonth}</p>
                  </div>
                  {dailyTrend.length > 1 ? (
                    <div className="text-right" data-testid="exits-trend">
                      <Sparkline data={dailyTrend} dataKey="exits" name="Saídas" color={CHART_COLORS.amber} className="h-12 w-32 sm:w-44" />
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">últimos 14 dias</p>
                    </div>
                  ) : (
                    <ArrowUpCircle className="w-10 h-10 text-amber-500/20" />
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>

        {/* Driver Ranking + Stock Distribution */}
        <StaggerItem className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="driver-ranking-card">
            <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" />
                <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Ranking de Motoristas</CardTitle>
                <span className="text-xs text-slate-400 dark:text-slate-500">({capitalizedMonth})</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {stats?.driver_ranking && stats.driver_ranking.length > 0 ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
                  {stats.driver_ranking.map((driver, idx) => {
                    const rankStyle = RANK_STYLES[idx];
                    const RankIcon = rankStyle?.icon;
                    return (
                      <div
                        key={driver.driver_name}
                        className="flex items-center gap-3 px-4 py-2.5"
                        data-testid="driver-ranking-row"
                      >
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                          rankStyle ? rankStyle.bg : 'bg-slate-50 dark:bg-slate-800'
                        } ${rankStyle ? rankStyle.color : 'text-slate-400 dark:text-slate-500'}`}>
                          {RankIcon ? <RankIcon className="w-3.5 h-3.5" /> : idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{driver.driver_name}</p>
                          {/* Entradas + saídas, na proporção do primeiro colocado */}
                          <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <motion.div
                              className="flex h-full rounded-full overflow-hidden"
                              initial={{ width: 0 }}
                              animate={{ width: `${((driver.total || 0) / rankingMax) * 100}%` }}
                              transition={{ duration: 0.7, ease: EASE, delay: 0.25 + Math.min(idx, 10) * 0.05 }}
                            >
                              <span className="h-full bg-primary" style={{ flexGrow: driver.entries || 0 }} />
                              <span className="h-full bg-amber-500" style={{ flexGrow: driver.exits || 0 }} />
                            </motion.div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs flex-shrink-0">
                          <span className="flex items-center gap-1 text-primary" title="Entradas">
                            <ArrowDownCircle className="w-3.5 h-3.5" />
                            {driver.entries}
                          </span>
                          <span className="flex items-center gap-1 text-amber-600" title="Saídas">
                            <ArrowUpCircle className="w-3.5 h-3.5" />
                            {driver.exits}
                          </span>
                          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-300 w-6 text-right">{driver.total}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 text-center text-slate-400 dark:text-slate-500" data-testid="no-driver-ranking">
                  <Trophy className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Nenhum registro cadastrado neste mês</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none flex flex-col" data-testid="stock-distribution-card">
            <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-500" />
                <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Estoque Atual no Pátio</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 flex-1 flex items-center">
              {stockTotal > 0 ? (
                <div className="w-full flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Mini-pátio 3D; sem WebGL entra a rosca no lugar */}
                  <div className="h-60 sm:h-72 w-full sm:w-[60%] shrink-0" data-testid="stock-distribution-chart">
                    <Stage3D
                      scene={yardScene}
                      params={{ full: stockFull, empty: stockEmpty }}
                      className="h-full w-full"
                      ariaLabel={`Pátio com ${stockFull} contêineres cheios e ${stockEmpty} vazios`}
                      testId="stock-yard-3d"
                      fallback={(
                        <DonutChart
                          className="h-full"
                          data={[
                            { name: 'Cheios', value: stockFull, color: CHART_COLORS.emerald },
                            { name: 'Vazios', value: stockEmpty, color: CHART_COLORS.slate },
                          ]}
                        />
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-3">
                    <StockShare label="Cheios" value={stockFull} share={fullShare} barClass="bg-emerald-500" dotClass="bg-emerald-500" testId="stock-share-full" />
                    <StockShare label="Vazios" value={stockEmpty} share={emptyShare} barClass="bg-slate-400" dotClass="bg-slate-400" testId="stock-share-empty" />
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-sm text-slate-500 dark:text-slate-400">Total</span>
                      <span className="text-lg font-bold tabular-nums text-slate-800 dark:text-slate-200" data-testid="stock-total">
                        <AnimatedNumber value={stockTotal} />
                      </span>
                    </div>
                    {yardUnit > 1 && (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">
                        No modelo, cada contêiner representa {yardUnit} unidades.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-full p-8 text-center text-slate-400 dark:text-slate-500">
                  <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Nenhum container em estoque</p>
                </div>
              )}
            </CardContent>
          </Card>
        </StaggerItem>

      </Stagger>
    </Layout>
  );
}
