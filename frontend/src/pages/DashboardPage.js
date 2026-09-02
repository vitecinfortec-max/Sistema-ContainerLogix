import { useEffect, useState, useCallback } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import {
  ArrowDownCircle, ArrowUpCircle, Container, Package, Plus, Calendar, ArrowRight,
  FileText, Receipt, Truck, Users, BarChart3, DollarSign, Ship, Building2,
  ClipboardList, X, Check, Settings2, Trophy, Medal, Award, AlertTriangle, CheckCircle2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell
} from 'recharts';

const RANK_STYLES = [
  { icon: Trophy, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
  { icon: Medal, color: 'text-slate-400', bg: 'bg-slate-100 dark:bg-slate-700' },
  { icon: Award, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-500/10' },
];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} style={{ color: entry.color }} className="font-medium">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

const ALL_SHORTCUTS = [
  { id: 'new-movement', label: 'Novo Registro', icon: Plus, path: '/movements/new', color: 'text-primary', bg: 'bg-primary/10' },
  { id: 'movements', label: 'Gate', icon: Container, path: '/movements', color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-700' },
  { id: 'report-movements', label: 'Rel. Movimentações', icon: BarChart3, path: '/reports/movements', color: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'report-billing', label: 'Rel. Faturamento', icon: DollarSign, path: '/reports/billing', color: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'invoices', label: 'Faturas', icon: Receipt, path: '/billing', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'clients', label: 'Clientes', icon: Users, path: '/clients', color: 'text-violet-600', bg: 'bg-violet-50' },
  { id: 'drivers', label: 'Motoristas', icon: Truck, path: '/drivers', color: 'text-orange-600', bg: 'bg-orange-50' },
  { id: 'companies', label: 'Transportadoras', icon: Building2, path: '/companies', color: 'text-cyan-600', bg: 'bg-cyan-50' },
  { id: 'shipping-lines', label: 'Armadores', icon: Ship, path: '/shipping-lines', color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'service-types', label: 'Tipos de Serviço', icon: ClipboardList, path: '/service-types', color: 'text-pink-600', bg: 'bg-pink-50' },
];

const DEFAULT_SHORTCUT_IDS = ['new-movement', 'movements', 'report-movements', 'report-billing', 'invoices', 'clients'];

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState({ over_30: 0, over_60: 0, over_90: 0 });
  const [userShortcuts, setUserShortcuts] = useState(DEFAULT_SHORTCUT_IDS);
  const [showEditor, setShowEditor] = useState(false);
  const [editorSelection, setEditorSelection] = useState([]);
  const navigate = useNavigate();

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

  const activeShortcuts = ALL_SHORTCUTS.filter(s => userShortcuts.includes(s.id));

  const currentMonth = format(new Date(), 'MMMM', { locale: ptBR });
  const capitalizedMonth = currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64" data-testid="dashboard-loading">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5" data-testid="dashboard-container">
        {/* Atalhos */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider" data-testid="shortcuts-title">Atalhos</h2>
            <button
              onClick={openEditor}
              className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-primary transition-colors"
              data-testid="edit-shortcuts-button"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Personalizar
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {activeShortcuts.map((shortcut) => {
              const Icon = shortcut.icon;
              return (
                <button
                  key={shortcut.id}
                  onClick={() => navigate(shortcut.path)}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-primary/40 hover:shadow-sm transition-all group cursor-pointer"
                  data-testid={`shortcut-${shortcut.id}`}
                >
                  <div className={`w-10 h-10 rounded-lg ${shortcut.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <Icon className={`w-5 h-5 ${shortcut.color}`} />
                  </div>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400 text-center leading-tight">{shortcut.label}</span>
                </button>
              );
            })}

            {/* Add shortcut button */}
            <button
              onClick={openEditor}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
              data-testid="add-shortcut-button"
            >
              <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                <Plus className="w-5 h-5 text-slate-400 dark:text-slate-500" />
              </div>
              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Adicionar</span>
            </button>
          </div>
        </div>

        {/* Shortcuts Editor Modal */}
        {showEditor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" data-testid="shortcuts-editor-modal">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">Personalizar Atalhos</h3>
                <button onClick={() => setShowEditor(false)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Selecione os atalhos que deseja exibir no dashboard:</p>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_SHORTCUTS.map((shortcut) => {
                    const Icon = shortcut.icon;
                    const isSelected = editorSelection.includes(shortcut.id);
                    return (
                      <button
                        key={shortcut.id}
                        onClick={() => toggleShortcut(shortcut.id)}
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                        data-testid={`editor-shortcut-${shortcut.id}`}
                      >
                        <div className={`w-8 h-8 rounded-md ${shortcut.bg} flex items-center justify-center flex-shrink-0`}>
                          <Icon className={`w-4 h-4 ${shortcut.color}`} />
                        </div>
                        <span className={`text-sm font-medium flex-1 ${isSelected ? 'text-primary' : 'text-slate-600 dark:text-slate-400'}`}>
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
              <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                <span className="text-xs text-slate-400 dark:text-slate-500">{editorSelection.length} selecionados</span>
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
            </div>
          </div>
        )}

        {/* Stats Grid - 4 cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none hover:border-primary/30 transition-colors" data-testid="stat-entries-today">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <ArrowDownCircle className="w-5 h-5 text-primary" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{stats?.entries_today || 0}</div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Entradas Hoje</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none hover:border-amber-300 transition-colors" data-testid="stat-exits-today">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
                  <ArrowUpCircle className="w-5 h-5 text-amber-500" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{stats?.exits_today || 0}</div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Saídas Hoje</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none hover:border-emerald-300 transition-colors" data-testid="stat-stock-full">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <Package className="w-5 h-5 text-emerald-500" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{stats?.stock_full || 0}</div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Estoque Cheios</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none hover:border-slate-300 dark:hover:border-slate-600 transition-colors" data-testid="stat-stock-empty">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                  <Container className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{stats?.stock_empty || 0}</div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Estoque Vazios</p>
            </CardContent>
          </Card>
        </div>

        {/* Monthly Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border border-primary/20 shadow-none" data-testid="stat-entries-month">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-primary">Entradas no Mês</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-bold text-slate-800 dark:text-slate-200">{stats?.entries_month || 0}</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{capitalizedMonth}</p>
                </div>
                <ArrowDownCircle className="w-10 h-10 text-primary/20" />
              </div>
            </CardContent>
          </Card>

          <Card className="border border-amber-200 shadow-none" data-testid="stat-exits-month">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-600">Saídas no Mês</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-bold text-slate-800 dark:text-slate-200">{stats?.exits_month || 0}</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{capitalizedMonth}</p>
                </div>
                <ArrowUpCircle className="w-10 h-10 text-amber-500/20" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Alertas do Sistema */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="system-alerts-card">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Alertas do Sistema</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {(alerts.over_30 + alerts.over_60 + alerts.over_90) > 0 ? (
              <div className="flex flex-wrap gap-2">
                {alerts.over_30 > 0 && (
                  <button
                    onClick={() => navigate('/yard-control?min_days=31')}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                    data-testid="alert-over-30"
                  >
                    {alerts.over_30} container{alerts.over_30 > 1 ? 's' : ''} há mais de 30 dias no pátio
                  </button>
                )}
                {alerts.over_60 > 0 && (
                  <button
                    onClick={() => navigate('/yard-control?min_days=61')}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors"
                    data-testid="alert-over-60"
                  >
                    {alerts.over_60} container{alerts.over_60 > 1 ? 's' : ''} há mais de 60 dias no pátio
                  </button>
                )}
                {alerts.over_90 > 0 && (
                  <button
                    onClick={() => navigate('/yard-control?min_days=91')}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                    data-testid="alert-over-90"
                  >
                    {alerts.over_90} container{alerts.over_90 > 1 ? 's' : ''} há mais de 90 dias no pátio
                  </button>
                )}
              </div>
            ) : (
              <div className="p-4 text-center text-slate-400 dark:text-slate-500">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhum alerta no momento</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Driver Ranking + Stock Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                          <span className="font-semibold text-slate-700 dark:text-slate-300 w-6 text-right">{driver.total}</span>
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

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none" data-testid="stock-distribution-card">
            <CardHeader className="border-b border-slate-100 dark:border-slate-800 py-3 px-4">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-500" />
                <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Estoque Atual no Pátio</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {(stats?.stock_full || 0) + (stats?.stock_empty || 0) > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="h-52 w-1/2" data-testid="stock-distribution-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Cheios', value: stats?.stock_full || 0 },
                            { name: 'Vazios', value: stats?.stock_empty || 0 },
                          ]}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={45}
                          outerRadius={75}
                          paddingAngle={3}
                        >
                          <Cell fill="#10b981" />
                          <Cell fill="#94a3b8" />
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                        Cheios
                      </span>
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{stats?.stock_full || 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" />
                        Vazios
                      </span>
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{stats?.stock_empty || 0}</span>
                    </div>
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-sm text-slate-500 dark:text-slate-400">Total</span>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                        {(stats?.stock_full || 0) + (stats?.stock_empty || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-slate-400 dark:text-slate-500">
                  <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Nenhum container em estoque</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Movements Table */}
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
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data/Hora</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tipo</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Container</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Motorista</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recent_movements.map((movement, idx) => (
                      <tr 
                        key={movement.id} 
                        className={`hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}
                        data-testid="movement-row"
                      >
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">
                          {format(new Date(movement.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                            movement.operation_type === 'ENTRADA' 
                              ? 'bg-primary/10 text-primary' 
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {movement.operation_type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm font-mono font-medium text-slate-800 dark:text-slate-200">{movement.container_number}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{movement.driver_name}</td>
                        <td className="px-4 py-2.5">
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
      </div>
    </Layout>
  );
}
