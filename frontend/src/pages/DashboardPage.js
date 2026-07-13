import { useEffect, useState, useCallback } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { 
  ArrowDownCircle, ArrowUpCircle, Container, Package, Plus, Calendar, ArrowRight, 
  FileText, Receipt, Truck, Users, BarChart3, DollarSign, Ship, Building2, 
  ClipboardList, X, Check, Settings2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useWebSocket } from '../hooks/useWebSocket';

const ALL_SHORTCUTS = [
  { id: 'new-movement', label: 'Nova Movimentação', icon: Plus, path: '/movements/new', color: 'text-primary', bg: 'bg-primary/10' },
  { id: 'movements', label: 'Movimentações', icon: Container, path: '/movements', color: 'text-slate-600', bg: 'bg-slate-100' },
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
  const [userShortcuts, setUserShortcuts] = useState(DEFAULT_SHORTCUT_IDS);
  const [showEditor, setShowEditor] = useState(false);
  const [editorSelection, setEditorSelection] = useState([]);
  const navigate = useNavigate();

  const handleWebSocketMessage = useCallback((message) => {
    if (message.type === 'MOVEMENT_CREATED' || message.type === 'MOVEMENT_DELETED') {
      loadStats();
    }
  }, []);

  useWebSocket(handleWebSocketMessage);

  useEffect(() => {
    loadStats();
    loadShortcuts();
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

  const loadShortcuts = async () => {
    try {
      const response = await api.getUserShortcuts();
      if (response.data.shortcuts) {
        setUserShortcuts(response.data.shortcuts);
      }
    } catch (error) {
      console.error('Erro ao carregar atalhos:', error);
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
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider" data-testid="shortcuts-title">Atalhos</h2>
            <button
              onClick={openEditor}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-primary transition-colors"
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
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-slate-200 bg-white hover:border-primary/40 hover:shadow-sm transition-all group cursor-pointer"
                  data-testid={`shortcut-${shortcut.id}`}
                >
                  <div className={`w-10 h-10 rounded-lg ${shortcut.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <Icon className={`w-5 h-5 ${shortcut.color}`} />
                  </div>
                  <span className="text-xs font-medium text-slate-600 text-center leading-tight">{shortcut.label}</span>
                </button>
              );
            })}

            {/* Add shortcut button */}
            <button
              onClick={openEditor}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed border-slate-200 bg-white hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
              data-testid="add-shortcut-button"
            >
              <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center">
                <Plus className="w-5 h-5 text-slate-400" />
              </div>
              <span className="text-xs font-medium text-slate-400">Adicionar</span>
            </button>
          </div>
        </div>

        {/* Shortcuts Editor Modal */}
        {showEditor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" data-testid="shortcuts-editor-modal">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h3 className="text-base font-semibold text-slate-800">Personalizar Atalhos</h3>
                <button onClick={() => setShowEditor(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5">
                <p className="text-sm text-slate-500 mb-4">Selecione os atalhos que deseja exibir no dashboard:</p>
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
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                        data-testid={`editor-shortcut-${shortcut.id}`}
                      >
                        <div className={`w-8 h-8 rounded-md ${shortcut.bg} flex items-center justify-center flex-shrink-0`}>
                          <Icon className={`w-4 h-4 ${shortcut.color}`} />
                        </div>
                        <span className={`text-sm font-medium flex-1 ${isSelected ? 'text-primary' : 'text-slate-600'}`}>
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
              <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 bg-slate-50/50">
                <span className="text-xs text-slate-400">{editorSelection.length} selecionados</span>
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
          <Card className="border border-slate-200 shadow-none hover:border-primary/30 transition-colors" data-testid="stat-entries-today">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <ArrowDownCircle className="w-5 h-5 text-primary" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-800">{stats?.entries_today || 0}</div>
              <p className="text-xs text-slate-500 mt-0.5">Entradas Hoje</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 shadow-none hover:border-amber-300 transition-colors" data-testid="stat-exits-today">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
                  <ArrowUpCircle className="w-5 h-5 text-amber-500" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-800">{stats?.exits_today || 0}</div>
              <p className="text-xs text-slate-500 mt-0.5">Saídas Hoje</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 shadow-none hover:border-emerald-300 transition-colors" data-testid="stat-stock-full">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <Package className="w-5 h-5 text-emerald-500" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-800">{stats?.stock_full || 0}</div>
              <p className="text-xs text-slate-500 mt-0.5">Estoque Cheios</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 shadow-none hover:border-slate-300 transition-colors" data-testid="stat-stock-empty">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Container className="w-5 h-5 text-slate-500" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-800">{stats?.stock_empty || 0}</div>
              <p className="text-xs text-slate-500 mt-0.5">Estoque Vazios</p>
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
                  <div className="text-3xl font-bold text-slate-800">{stats?.entries_month || 0}</div>
                  <p className="text-xs text-slate-500 mt-0.5">{capitalizedMonth}</p>
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
                  <div className="text-3xl font-bold text-slate-800">{stats?.exits_month || 0}</div>
                  <p className="text-xs text-slate-500 mt-0.5">{capitalizedMonth}</p>
                </div>
                <ArrowUpCircle className="w-10 h-10 text-amber-500/20" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Movements Table */}
        <Card className="border border-slate-200 shadow-none" data-testid="recent-movements-card">
          <CardHeader className="border-b border-slate-100 py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-700">Movimentações Recentes</CardTitle>
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
                    <tr className="border-b border-slate-100">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Data/Hora</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tipo</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Container</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Motorista</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recent_movements.map((movement, idx) => (
                      <tr 
                        key={movement.id} 
                        className={`hover:bg-slate-50/80 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/40'}`}
                        data-testid="movement-row"
                      >
                        <td className="px-4 py-2.5 text-sm text-slate-600">
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
                        <td className="px-4 py-2.5 text-sm font-mono font-medium text-slate-800">{movement.container_number}</td>
                        <td className="px-4 py-2.5 text-sm text-slate-600">{movement.driver_name}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            movement.status === 'CHEIO' 
                              ? 'bg-emerald-50 text-emerald-700' 
                              : 'bg-slate-100 text-slate-600'
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
              <div className="p-8 text-center text-slate-400" data-testid="no-movements">
                <Container className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Nenhuma movimentação registrada ainda</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
