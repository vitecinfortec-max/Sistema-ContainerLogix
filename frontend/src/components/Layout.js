import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from './ui/breadcrumb';
import { 
  LayoutDashboard, 
  Truck, 
  Building2, 
  FileText, 
  LogOut, 
  Menu, 
  X, 
  Container, 
  Ship,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Receipt,
  ClipboardList,
  FolderOpen,
  BarChart3,
  DollarSign,
  Search,
  Bell,
  User,
  Settings,
  Plus,
  List,
  ClipboardCheck,
  Package,
  Clock,
  Wrench,
  Car,
  Calendar,
  Clipboard,
  Globe,
  Anchor,
  Wallet,
  Calculator,
  Sun,
  Moon,
  ShieldCheck,
  LayoutGrid,
  Cog,
  Fuel,
  PackageCheck,
  Tag,
  Boxes,
  Warehouse,
  Layers,
  FileSpreadsheet
} from 'lucide-react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from './ui/button';
import { useWebSocket } from '../hooks/useWebSocket';
import { useModuleConfig } from '../context/ModuleConfigContext';
import { api } from '../lib/api';
import CommandPalette from './CommandPalette';

// Intervalo de checagem do alerta de containers parados no pátio
const YARD_ALERT_POLL_MS = 5 * 60 * 1000;

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/movements': 'Movimentações',
  '/movements/new': 'Nova Movimentação',
  '/yard-control': 'Controle de Pátio',
  '/fleet/rpa-terceiro': 'Contrato de Frete',
  '/fleet/rpa-terceiro/new': 'Novo Contrato de Frete',
  '/fleet/ordem-servico': 'Ordem de Serviço',
  '/fleet/ordem-abastecimento': 'Ordem de Abastecimento',
  '/fleet/abastecimento': 'Abastecimento',
  '/fleet/os-categories': 'Cadastro de Categoria',
  '/estoque/cadastros': 'Cadastro',
  '/estoque/servicos': 'Cadastro de Serviço',
  '/estoque/produtos': 'Produto',
  '/estoque': 'Estoque',
  '/estoque/relatorio': 'Relatório de Estoque',
  '/loading-orders': 'Ordem de Carregamento',
  '/fleet/checklist': 'Checklist',
  '/cadastro': 'Cadastro',
  '/companies': 'Transportadoras',
  '/company-settings': 'Dados da Empresa',
  '/users': 'Gestão de Usuários',
  '/modules': 'Módulos Contratados',
  '/shipping-lines': 'Armadores',
  '/service-types': 'Tipos de Serviço',
  '/reports/movements': 'Relatório de Movimentação',
  '/reports/billing': 'Relatório de Faturamento',
  '/billing': 'Faturamento',
  '/international-invoices': 'Invoice Internacional',
  '/photo-registries': 'Registro Fotográfico',
  '/photo-registries/new': 'Novo Registro Fotográfico',
  '/container-inspections': 'Vistoria de Container',
  '/container-inspections/new': 'Nova Vistoria de Container',
  '/flex-tank': 'Flex Tank',
  '/flex-tank/movements/new': 'Nova Movimentação Flex Tank',
  '/loading-schedules': 'Programação de Carregamento',
  '/delivery-status': 'Status de Entrega',
  '/daily-rate-requests': 'Solicitação de Diária',
  '/expense-reports': 'Prestação de Contas',
};

// Cor de destaque por grupo de topo do menu lateral (subgrupos aninhados como
// "Movimentações"/"Flex Tank" dentro de Terminal não entram aqui de propósito -
// continuam com a cor binária ativo/inativo de sempre).
// Alguns itens do menu apontam pra mesma rota, diferenciados só pela query
// string `?tab=` (abas dentro de uma página, ex: Manutenção/Transporte e Flex Tank) - comparar
// só o pathname faria o item "sem aba" (ex: Cadastro de Veículo, path=/fleet)
// ficar sempre marcado como ativo mesmo com outra aba selecionada. Comparar
// especificamente o parâmetro `tab` (ignorando outras query strings, como o
// `min_days` usado em deep links de alerta) resolve isso sem quebrar nada.
function isNavItemActive(item, location) {
  const [itemPath, itemQuery] = item.path.split('?');
  if (location.pathname !== itemPath) return false;
  // Compara todos os parâmetros de query (não só um fixo) pra suportar
  // várias páginas compartilhadas por query string (?tab=, ?type=, etc.)
  // sem cada item acender junto quando outro está selecionado.
  const itemParams = new URLSearchParams(itemQuery || '');
  const currentParams = new URLSearchParams(location.search);
  const keys = new Set([...itemParams.keys(), ...currentParams.keys()]);
  for (const key of keys) {
    if (itemParams.get(key) !== currentParams.get(key)) return false;
  }
  return true;
}

const GROUP_COLORS = {
  Terminal: 'chart-1',
  Manutenção: 'chart-2',
  Cadastro: 'chart-3',
  Financeiro: 'chart-4',
  Operacional: 'chart-5',
  Transporte: 'chart-6',
  'Opções do Sistema': 'chart-7',
  Estoque: 'chart-8',
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isSuperadmin = !!user?.is_superadmin;
  const { isModuleEnabled } = useModuleConfig();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [movimentacoesOpen, setMovimentacoesOpen] = useState(false);
  const [cadastroOpen, setCadastroOpen] = useState(false);
  const [financeiroOpen, setFinanceiroOpen] = useState(false);
  const [manutencaoOpen, setManutencaoOpen] = useState(false);
  const [operacionalOpen, setOperacionalOpen] = useState(false);
  const [flexTankOpen, setFlexTankOpen] = useState(false);
  const [terminalCadastroOpen, setTerminalCadastroOpen] = useState(false);
  const [manutencaoCadastroOpen, setManutencaoCadastroOpen] = useState(false);
  const [estoqueOpen, setEstoqueOpen] = useState(false);
  const [estoqueCadastroOpen, setEstoqueCadastroOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [transporteOpen, setTransporteOpen] = useState(false);
  const [opcoesSistemaOpen, setOpcoesSistemaOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef(null);
  const [yardAlert, setYardAlert] = useState({ over_60: 0, over_90: 0 });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchYardAlert = async () => {
      try {
        const res = await api.getAlertsSummary();
        if (!cancelled) {
          setYardAlert({
            over_60: res.data.yard_over_60_days || 0,
            over_90: res.data.yard_over_90_days || 0,
          });
        }
      } catch (err) {
        // Falha ao buscar alertas não deve quebrar a navegação — só não mostra o aviso
      }
    };
    fetchYardAlert();
    const interval = setInterval(fetchYardAlert, YARD_ALERT_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const handleWsNotification = useCallback((message) => {
    if (message.type === 'MOVEMENT_CREATED') {
      const d = message.data || {};
      const opLabel = d.operation_type === 'ENTRADA' ? 'Entrada' : d.operation_type === 'SAIDA' ? 'Saída' : (d.operation_type || 'Movimentação');
      setNotifications((prev) => [
        {
          id: `created-${d.id}-${Date.now()}`,
          title: 'Nova movimentação',
          description: `${opLabel} · Container ${d.container_number || '-'}`,
          path: d.id ? `/movements/${d.id}` : '/movements',
          timestamp: new Date(),
          read: false,
        },
        ...prev,
      ].slice(0, 30));
    } else if (message.type === 'MOVEMENT_DELETED') {
      setNotifications((prev) => [
        {
          id: `deleted-${message.data?.id}-${Date.now()}`,
          title: 'Movimentação removida',
          description: 'Uma movimentação foi excluída',
          path: '/movements',
          timestamp: new Date(),
          read: false,
        },
        ...prev,
      ].slice(0, 30));
    }
  }, []);

  useWebSocket(handleWsNotification);

  const hasYardAlert = yardAlert.over_60 > 0;
  const unreadNotificationsCount = notifications.filter((n) => !n.read).length + (hasYardAlert ? 1 : 0);

  const toggleNotifications = () => {
    setNotificationsOpen((prev) => {
      const next = !prev;
      if (next) {
        setNotifications((list) => list.map((n) => ({ ...n, read: true })));
      }
      return next;
    });
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notificationsRef.current && !notificationsRef.current.contains(e.target)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('sidebarOpen');
    if (saved !== null) setSidebarOpen(JSON.parse(saved));
    const savedMovimentacoes = localStorage.getItem('movimentacoesOpen');
    if (savedMovimentacoes !== null) setMovimentacoesOpen(JSON.parse(savedMovimentacoes));
    const savedFinanceiro = localStorage.getItem('financeiroOpen');
    if (savedFinanceiro !== null) setFinanceiroOpen(JSON.parse(savedFinanceiro));
    const savedManutencao = localStorage.getItem('manutencaoOpen');
    if (savedManutencao !== null) setManutencaoOpen(JSON.parse(savedManutencao));
    const savedOperacional = localStorage.getItem('operacionalOpen');
    if (savedOperacional !== null) setOperacionalOpen(JSON.parse(savedOperacional));
    const savedFlexTank = localStorage.getItem('flexTankOpen');
    if (savedFlexTank !== null) setFlexTankOpen(JSON.parse(savedFlexTank));
    const savedTerminalCadastro = localStorage.getItem('terminalCadastroOpen');
    if (savedTerminalCadastro !== null) setTerminalCadastroOpen(JSON.parse(savedTerminalCadastro));
    const savedManutencaoCadastro = localStorage.getItem('manutencaoCadastroOpen');
    if (savedManutencaoCadastro !== null) setManutencaoCadastroOpen(JSON.parse(savedManutencaoCadastro));
    const savedEstoque = localStorage.getItem('estoqueOpen');
    if (savedEstoque !== null) setEstoqueOpen(JSON.parse(savedEstoque));
    const savedEstoqueCadastro = localStorage.getItem('estoqueCadastroOpen');
    if (savedEstoqueCadastro !== null) setEstoqueCadastroOpen(JSON.parse(savedEstoqueCadastro));
    const savedTerminal = localStorage.getItem('terminalOpen');
    if (savedTerminal !== null) setTerminalOpen(JSON.parse(savedTerminal));
    const savedTransporte = localStorage.getItem('transporteOpen');
    if (savedTransporte !== null) setTransporteOpen(JSON.parse(savedTransporte));
    const savedOpcoesSistema = localStorage.getItem('opcoesSistemaOpen');
    if (savedOpcoesSistema !== null) setOpcoesSistemaOpen(JSON.parse(savedOpcoesSistema));
  }, []);

  const isMovimentacoesActive = location.pathname === '/movements' || location.pathname === '/movements/new' || location.pathname.startsWith('/movements/') || location.pathname === '/reports/movements' || location.pathname === '/yard-control';
  const isCadastroActive = ['/cadastro', '/companies'].includes(location.pathname);
  const isFinanceiroActive = location.pathname === '/billing' || location.pathname === '/reports/billing' || location.pathname === '/international-invoices' || location.pathname === '/daily-rate-requests' || location.pathname === '/expense-reports';
  // '/fleet' é compartilhado por Manutenção (aba Controle de Revisão) e Transporte
  // (Cadastro de Veículo, aba padrão) - só o parâmetro `tab` diferencia qual
  // grupo deve acender, senão os dois grupos ficariam ativos ao mesmo tempo.
  const fleetTab = new URLSearchParams(location.search).get('tab');
  const isManutencaoCadastroActive = location.pathname === '/fleet/os-categories';
  const isEstoqueCadastroActive = location.pathname === '/estoque/cadastros';
  const isEstoqueActive = isEstoqueCadastroActive || ['/estoque', '/estoque/servicos', '/estoque/produtos', '/estoque/relatorio'].includes(location.pathname);
  const isManutencaoActive = (location.pathname === '/fleet' && fleetTab === 'revisions') || location.pathname.startsWith('/fleet/ordem-servico') || location.pathname === '/fleet/checklist' || location.pathname === '/fleet/abastecimento' || location.pathname === '/fleet/ordem-abastecimento' || isManutencaoCadastroActive;
  const isTransporteActive = (location.pathname === '/fleet' && fleetTab !== 'revisions') || location.pathname.startsWith('/fleet/rpa-terceiro') || location.pathname === '/loading-orders';
  const isOpcoesSistemaActive = location.pathname === '/users' || location.pathname === '/modules';
  const isOperacionalActive = location.pathname === '/loading-schedules' || location.pathname === '/delivery-status';
  const isFlexTankActive = location.pathname === '/flex-tank' || location.pathname.startsWith('/flex-tank/');
  const isContainerInspectionsActive = location.pathname === '/container-inspections' || location.pathname.startsWith('/container-inspections/');
  const isTerminalCadastroActive = location.pathname === '/shipping-lines' || location.pathname === '/service-types';
  const isTerminalActive = isFlexTankActive || isContainerInspectionsActive || isMovimentacoesActive || isTerminalCadastroActive;

  useEffect(() => {
    if (isMovimentacoesActive && !movimentacoesOpen) setMovimentacoesOpen(true);
    if (isCadastroActive && !cadastroOpen) setCadastroOpen(true);
    if (isFinanceiroActive && !financeiroOpen) setFinanceiroOpen(true);
    if (isManutencaoActive && !manutencaoOpen) setManutencaoOpen(true);
    if (isTransporteActive && !transporteOpen) setTransporteOpen(true);
    if (isOpcoesSistemaActive && !opcoesSistemaOpen) setOpcoesSistemaOpen(true);
    if (isOperacionalActive && !operacionalOpen) setOperacionalOpen(true);
    if (isFlexTankActive && !flexTankOpen) setFlexTankOpen(true);
    if (isTerminalCadastroActive && !terminalCadastroOpen) setTerminalCadastroOpen(true);
    if (isManutencaoCadastroActive && !manutencaoCadastroOpen) setManutencaoCadastroOpen(true);
    if (isEstoqueActive && !estoqueOpen) setEstoqueOpen(true);
    if (isEstoqueCadastroActive && !estoqueCadastroOpen) setEstoqueCadastroOpen(true);
    if (isTerminalActive && !terminalOpen) setTerminalOpen(true);
  }, [location.pathname]);

  // Atalho global Ctrl+K / Cmd+K abre a busca global (funciona em qualquer tela, sidebar aberta ou não)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);


  const toggleSidebar = () => {
    const newState = !sidebarOpen;
    setSidebarOpen(newState);
    localStorage.setItem('sidebarOpen', JSON.stringify(newState));
  };

  const toggleMovimentacoes = () => {
    const newState = !movimentacoesOpen;
    setMovimentacoesOpen(newState);
    localStorage.setItem('movimentacoesOpen', JSON.stringify(newState));
  };

  const toggleCadastro = () => {
    const newState = !cadastroOpen;
    setCadastroOpen(newState);
    localStorage.setItem('cadastroOpen', JSON.stringify(newState));
  };

  const toggleFinanceiro = () => {
    const newState = !financeiroOpen;
    setFinanceiroOpen(newState);
    localStorage.setItem('financeiroOpen', JSON.stringify(newState));
  };

  const toggleManutencao = () => {
    const newState = !manutencaoOpen;
    setManutencaoOpen(newState);
    localStorage.setItem('manutencaoOpen', JSON.stringify(newState));
  };

  const toggleOperacional = () => {
    const newState = !operacionalOpen;
    setOperacionalOpen(newState);
    localStorage.setItem('operacionalOpen', JSON.stringify(newState));
  };

  const toggleFlexTank = () => {
    const newState = !flexTankOpen;
    setFlexTankOpen(newState);
    localStorage.setItem('flexTankOpen', JSON.stringify(newState));
  };

  const toggleTerminalCadastro = () => {
    const newState = !terminalCadastroOpen;
    setTerminalCadastroOpen(newState);
    localStorage.setItem('terminalCadastroOpen', JSON.stringify(newState));
  };

  const toggleManutencaoCadastro = () => {
    const newState = !manutencaoCadastroOpen;
    setManutencaoCadastroOpen(newState);
    localStorage.setItem('manutencaoCadastroOpen', JSON.stringify(newState));
  };

  const toggleEstoque = () => {
    const newState = !estoqueOpen;
    setEstoqueOpen(newState);
    localStorage.setItem('estoqueOpen', JSON.stringify(newState));
  };

  const toggleEstoqueCadastro = () => {
    const newState = !estoqueCadastroOpen;
    setEstoqueCadastroOpen(newState);
    localStorage.setItem('estoqueCadastroOpen', JSON.stringify(newState));
  };

  const toggleTerminal = () => {
    const newState = !terminalOpen;
    setTerminalOpen(newState);
    localStorage.setItem('terminalOpen', JSON.stringify(newState));
  };

  const toggleTransporte = () => {
    const newState = !transporteOpen;
    setTransporteOpen(newState);
    localStorage.setItem('transporteOpen', JSON.stringify(newState));
  };

  const toggleOpcoesSistema = () => {
    const newState = !opcoesSistemaOpen;
    setOpcoesSistemaOpen(newState);
    localStorage.setItem('opcoesSistemaOpen', JSON.stringify(newState));
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const mainNavItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ];

  // Módulos contratados: itens sem moduleKey (Dados da Empresa, Usuários,
  // Módulos) nunca são bloqueados por essa trava - são gestão da própria
  // conta, não um serviço que se contrata à parte.
  const terminalItems = [
    { path: '/container-inspections', label: 'Vistoria de Container', icon: ClipboardCheck, moduleKey: 'terminal.vistoria' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  const flexTankItems = [
    { path: '/flex-tank', label: 'Movimentações', icon: List, moduleKey: 'terminal.flex_tank' },
    { path: '/flex-tank?tab=reports', label: 'Relatórios', icon: BarChart3, moduleKey: 'terminal.flex_tank' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  const movimentacoesItems = [
    { path: '/movements', label: 'Movimentações', icon: List, moduleKey: 'terminal.movimentacoes' },
    { path: '/unit-segregation', label: 'Segregação de Unidade', icon: Package, moduleKey: 'terminal.movimentacoes' },
    { path: '/yard-control', label: 'Controle de Pátio', icon: Clock, moduleKey: 'terminal.movimentacoes' },
    { path: '/reports/movements', label: 'Relatório de Movimentação', icon: BarChart3, moduleKey: 'terminal.movimentacoes' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  // Cadastros voltados especificamente pro Terminal (usados em Vistoria/
  // Movimentação) - separados do grupo geral "Cadastro" pra ficarem à mão
  // de quem trabalha no Terminal, sem precisar sair do grupo.
  const terminalCadastroItems = [
    { path: '/shipping-lines', label: 'Armador', icon: Ship, moduleKey: 'cadastro.armador' },
    { path: '/service-types', label: 'Tipos de Serviço', icon: ClipboardList, moduleKey: 'cadastro.tipos_servico' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  const manutencaoItems = [
    { path: '/fleet?tab=revisions', label: 'Controle de Revisão', icon: Wrench, moduleKey: 'frota.revisao' },
    { path: '/fleet/ordem-servico', label: 'Ordem de Serviço', icon: ClipboardList, moduleKey: 'frota.ordem_servico' },
    { path: '/fleet/checklist', label: 'Checklist', icon: ClipboardCheck, moduleKey: 'frota.checklist' },
    { path: '/fleet/ordem-abastecimento', label: 'Ordem de Abastecimento', icon: Clipboard, moduleKey: 'frota.ordem_abastecimento' },
    { path: '/fleet/abastecimento', label: 'Abastecimento', icon: Fuel, moduleKey: 'frota.abastecimento' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  const manutencaoCadastroItems = [
    { path: '/fleet/os-categories', label: 'Cadastro de Categoria', icon: Tag, moduleKey: 'frota.cadastro_categoria' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  const estoqueItems = [
    { path: '/estoque', label: 'Estoque', icon: Boxes, moduleKey: 'estoque.consulta' },
    { path: '/estoque/produtos', label: 'Produto', icon: Package, moduleKey: 'estoque.produto' },
    { path: '/estoque/servicos', label: 'Cadastro de Serviço', icon: Wrench, moduleKey: 'estoque.cadastro_servico' },
    { path: '/estoque/relatorio', label: 'Relatório de Estoque', icon: FileSpreadsheet, moduleKey: 'estoque.relatorio' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  const estoqueCadastroItems = [
    { path: '/estoque/cadastros?type=almoxarifado', label: 'Almoxarifado', icon: Warehouse, moduleKey: 'estoque.almoxarifado' },
    { path: '/estoque/cadastros?type=familia-produto', label: 'Família de Produto', icon: Package, moduleKey: 'estoque.familia_produto' },
    { path: '/estoque/cadastros?type=familia-servico', label: 'Família de Serviço', icon: Layers, moduleKey: 'estoque.familia_servico' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  const transporteItems = [
    { path: '/fleet', label: 'Cadastro de Veículo', icon: Car, moduleKey: 'frota.veiculos' },
    { path: '/fleet/rpa-terceiro', label: 'Contrato de Frete', icon: FileText, moduleKey: 'financeiro.rpa_terceiro' },
    { path: '/loading-orders', label: 'Ordem de Carregamento', icon: PackageCheck, moduleKey: 'operacional.ordem_carregamento' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  const cadastroItems = [
    { path: '/cadastro', label: 'Cadastro', icon: FolderOpen },
    { path: '/companies', label: 'Transportadora', icon: Building2, moduleKey: 'cadastro.transportadora' },
    { path: '/company-settings', label: 'Dados da Empresa', icon: Settings },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  // Só admins veem o link de Usuários - o backend também bloqueia, mas não
  // faz sentido mostrar pra quem não pode usar. "Módulos" é ainda mais
  // restrito: só a conta do dono do sistema (superadmin) enxerga.
  const opcoesSistemaItems = [
    isAdmin ? [{ path: '/users', label: 'Usuários', icon: ShieldCheck }] : [],
    isSuperadmin ? [{ path: '/modules', label: 'Módulos Contratados', icon: LayoutGrid }] : [],
  ].flat();

  const financeiroItems = [
    { path: '/billing', label: 'Faturas', icon: Receipt, moduleKey: 'financeiro.faturas' },
    { path: '/international-invoices', label: 'Invoice Internacional', icon: Globe, moduleKey: 'financeiro.invoice_internacional' },
    { path: '/reports/billing', label: 'Relatório de Faturamento', icon: BarChart3, moduleKey: 'financeiro.relatorio_faturamento' },
    { path: '/daily-rate-requests', label: 'Solicitação de Diária', icon: Wallet, moduleKey: 'financeiro.diaria' },
    { path: '/expense-reports', label: 'Prestação de Contas', icon: Calculator, moduleKey: 'financeiro.prestacao_contas' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  const operacionalItems = [
    { path: '/loading-schedules', label: 'Programação de Carregamento', icon: Calendar, moduleKey: 'operacional.programacao_carregamento' },
    { path: '/delivery-status', label: 'Status de Entrega', icon: ClipboardCheck, moduleKey: 'operacional.status_entrega' },
  ].filter((item) => isModuleEnabled(item.moduleKey));

  // Esconde o grupo inteiro do menu quando todo módulo dentro dele foi
  // desativado (senão o grupo aparece vazio ao expandir). Cadastro nunca
  // some porque "Dados da Empresa" nunca é bloqueado por módulo contratado.
  const isTerminalGroupVisible = terminalItems.length > 0 || movimentacoesItems.length > 0 || flexTankItems.length > 0;
  const isManutencaoGroupVisible = manutencaoItems.length > 0;
  const isTransporteGroupVisible = transporteItems.length > 0;
  const isFinanceiroGroupVisible = financeiroItems.length > 0;
  const isOperacionalGroupVisible = operacionalItems.length > 0;
  const isEstoqueGroupVisible = estoqueItems.length > 0 || estoqueCadastroItems.length > 0;
  const isOpcoesSistemaGroupVisible = opcoesSistemaItems.length > 0;

  const allSearchableItems = useMemo(() => [
    ...mainNavItems, ...terminalItems, ...flexTankItems, ...movimentacoesItems, ...manutencaoItems, ...manutencaoCadastroItems, ...transporteItems, ...cadastroItems,
    ...(isAdmin ? financeiroItems : []), ...operacionalItems, ...opcoesSistemaItems, ...estoqueItems, ...estoqueCadastroItems,
  ], [isAdmin]);

  const filteredItems = searchQuery
    ? allSearchableItems.filter(item => item.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : null;

  const pageTitle = useMemo(() => {
    // '/fleet' é compartilhado por duas abas com nomes diferentes (Cadastro de
    // Veículo é a aba padrão, Controle de Revisão só quando ?tab=revisions) -
    // não dá pra usar um título fixo em PAGE_TITLES pra essa rota.
    if (location.pathname === '/fleet') {
      return new URLSearchParams(location.search).get('tab') === 'revisions' ? 'Controle de Revisão' : 'Cadastro de Veículo';
    }
    const exactMatch = PAGE_TITLES[location.pathname];
    if (exactMatch) return exactMatch;
    if (location.pathname.includes('/movements/') && location.pathname.includes('/edit')) return 'Editar Movimentação';
    if (location.pathname.includes('/movements/')) return 'Detalhes da Movimentação';
    if (location.pathname.includes('/photo-registries/') && location.pathname !== '/photo-registries/new') return 'Detalhes do Registro Fotográfico';
    if (location.pathname.includes('/container-inspections/') && location.pathname.includes('/edit')) return 'Editar Vistoria de Container';
    if (location.pathname.includes('/container-inspections/') && location.pathname !== '/container-inspections/new') return 'Detalhes da Vistoria de Container';
    if (location.pathname.includes('/flex-tank/movements/') && location.pathname.includes('/edit')) return 'Editar Movimentação Flex Tank';
    if (location.pathname.includes('/flex-tank/movements/') && location.pathname !== '/flex-tank/movements/new') return 'Detalhes da Movimentação Flex Tank';
    return 'ContainerLogix';
  }, [location.pathname, location.search]);

  const breadcrumbGroup = useMemo(() => {
    if (isTerminalActive) return 'Terminal';
    if (isManutencaoActive) return 'Manutenção';
    if (isTransporteActive) return 'Transporte';
    if (isCadastroActive) return 'Cadastro';
    if (isFinanceiroActive) return 'Financeiro';
    if (isOperacionalActive) return 'Operacional';
    if (isOpcoesSistemaActive) return 'Opções do Sistema';
    return null;
  }, [isTerminalActive, isManutencaoActive, isTransporteActive, isCadastroActive, isFinanceiroActive, isOperacionalActive, isOpcoesSistemaActive]);

  // Expand sidebar when clicking a group while collapsed
  const handleGroupClickCollapsed = (toggleFn) => {
    setSidebarOpen(true);
    localStorage.setItem('sidebarOpen', JSON.stringify(true));
    toggleFn();
  };

  // Bsoft-style nav item
  const renderNavItem = (item, isSubItem = false, deepIndent = false) => {
    const Icon = item.icon;
    const isActive = isNavItemActive(item, location);

    if (!sidebarOpen) {
      return (
        <Link
          key={item.path}
          to={item.path}
          data-testid={`nav-${item.path.replace(/\//g, '-').slice(1)}`}
          title={item.label}
          className={`flex items-center justify-center h-11 border-b border-slate-100 dark:border-slate-800 transition-colors ${
            isActive ? 'text-primary' : 'text-[#1B4965] dark:text-slate-300 hover:text-primary'
          }`}
        >
          <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-primary' : 'text-slate-800 dark:text-slate-200'}`} strokeWidth={isActive ? 2.2 : 1.8} />
        </Link>
      );
    }

    // Sub-items: chevron on the left
    if (isSubItem) {
      return (
        <Link
          key={item.path}
          to={item.path}
          data-testid={`nav-${item.path.replace(/\//g, '-').slice(1)}`}
          className={`flex items-center py-3 transition-colors border-b border-slate-100 dark:border-slate-800 ${
            isActive ? 'text-primary font-semibold' : 'text-[#1B4965] dark:text-slate-300 hover:text-primary'
          } ${deepIndent ? 'pl-14' : 'pl-10'} pr-5 text-[13px] gap-2`}
        >
          <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`} />
          <span>{item.label}</span>
        </Link>
      );
    }

    // Main items (like Dashboard): icon on left, no chevron (not expandable)
    return (
      <Link
        key={item.path}
        to={item.path}
        data-testid={`nav-${item.path.replace(/\//g, '-').slice(1)}`}
        className={`flex items-center py-3 transition-colors border-b border-slate-100 dark:border-slate-800 ${
          isActive ? 'text-primary font-semibold' : 'text-[#1B4965] dark:text-slate-300 hover:text-primary'
        } px-5 gap-3 text-[13px]`}
      >
        <Icon className={`flex-shrink-0 w-[18px] h-[18px] ${isActive ? 'text-primary' : 'text-slate-800 dark:text-slate-200'}`} strokeWidth={isActive ? 2.2 : 1.8} />
        <span>{item.label}</span>
      </Link>
    );
  };

  // Mobile: item de navegação simples
  const renderMobileNavItem = (item, nested = false) => {
    const isActive = isNavItemActive(item, location);
    return (
      <Link key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)}
        className={`flex items-center gap-2 ${nested ? 'pl-14' : 'pl-10'} pr-4 py-2.5 text-[13px] border-b border-slate-100 dark:border-slate-800 ${
          isActive ? 'text-primary font-semibold' : 'text-[#1B4965] dark:text-slate-300'
        }`}
      >
        <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`} />
        <span>{item.label}</span>
      </Link>
    );
  };

  // Mobile: cabeçalho de grupo expansível
  const renderMobileGroupToggle = (label, icon, isOpen, toggle, isActive, nested = false) => {
    const Icon = icon;
    const accentVar = GROUP_COLORS[label];
    return (
      <button onClick={toggle}
        className={`w-full flex items-center justify-between ${nested ? 'pl-9 pr-4' : 'px-4'} py-3 text-sm border-b border-slate-100 dark:border-slate-800 ${
          isActive ? 'text-primary font-semibold' : 'text-[#1B4965] dark:text-slate-300'
        }`}
      >
        <div className="flex items-center gap-3">
          <Icon
            className={accentVar ? 'w-5 h-5' : 'w-5 h-5 text-slate-800 dark:text-slate-200'}
            style={accentVar ? { color: `hsl(var(--${accentVar}))` } : undefined}
            strokeWidth={1.8}
          />
          <span>{label}</span>
        </div>
        <ChevronRight className={`w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
    );
  };

  // Bsoft-style group header
  const renderGroupHeader = (label, icon, isOpen, toggle, isActive, testId, nested = false) => {
    const Icon = icon;
    const accentVar = GROUP_COLORS[label];
    const accentStyle = accentVar ? { color: `hsl(var(--${accentVar}))` } : undefined;
    if (!sidebarOpen) {
      // Subgrupos aninhados (ex: Flex Tank dentro de Terminal) só aparecem com a
      // sidebar expandida — no modo recolhido só o grupo de topo mostra ícone.
      if (nested) return null;
      return (
        <div
          className="flex items-center justify-center h-11 cursor-pointer border-b border-slate-100 dark:border-slate-800 transition-colors hover:text-primary"
          title={label}
          onClick={() => handleGroupClickCollapsed(toggle)}
          data-testid={testId}
        >
          <Icon
            className={accentVar ? 'w-[18px] h-[18px]' : `w-[18px] h-[18px] ${isActive ? 'text-primary' : 'text-slate-800 dark:text-slate-200'}`}
            style={accentStyle}
            strokeWidth={1.8}
          />
        </div>
      );
    }
    return (
      <button
        onClick={toggle}
        className={`w-full flex items-center justify-between ${nested ? 'pl-9 pr-5' : 'px-5'} py-3 transition-colors border-b border-slate-100 dark:border-slate-800 text-[13px] ${
          isActive ? 'text-primary font-semibold' : 'text-[#1B4965] dark:text-slate-300 hover:text-primary'
        }`}
        data-testid={testId}
      >
        <div className="flex items-center gap-3">
          <Icon
            className={accentVar ? 'w-[18px] h-[18px] flex-shrink-0' : `w-[18px] h-[18px] flex-shrink-0 ${isActive ? 'text-primary' : 'text-slate-800 dark:text-slate-200'}`}
            style={accentStyle}
            strokeWidth={isActive ? 2.2 : 1.8}
          />
          <span>{label}</span>
        </div>
        <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''} ${isActive ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`} />
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 flex flex-col">
      {/* Top Header Bar */}
      <header className={`no-print hidden md:flex items-center justify-between h-12 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 fixed top-0 right-0 z-30 transition-all duration-300 ${
        sidebarOpen ? 'left-[225px]' : 'left-16'
      }`} data-testid="top-header">
        <div className="flex items-center h-full px-6">
          <Breadcrumb data-testid="page-title">
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem>
                <BreadcrumbLink asChild className="text-[13px] text-slate-500 dark:text-slate-400">
                  <Link to="/dashboard">ContainerLogix</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {breadcrumbGroup && (
                <>
                  <BreadcrumbSeparator className="text-slate-400 dark:text-slate-500" />
                  <BreadcrumbItem>
                    <span className="text-[13px] text-slate-500 dark:text-slate-400">{breadcrumbGroup}</span>
                  </BreadcrumbItem>
                </>
              )}
              <BreadcrumbSeparator className="text-slate-400 dark:text-slate-500" />
              <BreadcrumbItem>
                <BreadcrumbPage className="text-[15px] font-semibold text-slate-800 dark:text-slate-200">
                  {pageTitle}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex items-center gap-1 px-4">
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex items-center gap-2 h-8 px-3 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors text-xs"
            title="Busca global"
            data-testid="header-search"
          >
            <Search className="w-[15px] h-[15px]" />
            <span className="hidden lg:inline">Buscar</span>
            <kbd className="hidden lg:inline text-[10px] text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5">Ctrl+K</kbd>
          </button>
          <div className="relative" ref={notificationsRef}>
            <button
              onClick={toggleNotifications}
              className="relative p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors"
              title="Notificações"
              data-testid="header-notifications"
            >
              <Bell className="w-[18px] h-[18px]" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute top-0.5 right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
                  {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50" data-testid="notifications-panel">
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Notificações</span>
                  {notifications.length > 0 && (
                    <button
                      onClick={() => setNotifications([])}
                      className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400"
                    >
                      Limpar
                    </button>
                  )}
                </div>
                {hasYardAlert && (
                  <button
                    onClick={() => { navigate('/yard-control?min_days=61'); setNotificationsOpen(false); }}
                    className="w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-amber-50 hover:bg-amber-100 transition-colors"
                    data-testid="yard-alert-item"
                  >
                    <p className="text-sm text-amber-800 font-medium">
                      {yardAlert.over_60} container{yardAlert.over_60 > 1 ? 's' : ''} parado{yardAlert.over_60 > 1 ? 's' : ''} no pátio há mais de 60 dias
                    </p>
                    {yardAlert.over_90 > 0 && (
                      <p className="text-xs text-amber-700 mt-0.5">{yardAlert.over_90} deles já passam de 90 dias</p>
                    )}
                  </button>
                )}
                {notifications.length === 0 && !hasYardAlert ? (
                  <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500 text-center">Nenhuma notificação por enquanto</p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => { navigate(n.path); setNotificationsOpen(false); }}
                      className="w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <p className="text-sm text-slate-700 dark:text-slate-300 font-medium">{n.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{n.description}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{format(n.timestamp, 'HH:mm', { locale: ptBR })}</p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => navigate('/company-settings')}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 dark:text-slate-400 dark:dark:text-slate-500 transition-colors"
            title="Configurações"
            data-testid="header-settings"
          >
            <Settings className="w-[18px] h-[18px]" />
          </button>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 dark:text-slate-400 dark:dark:text-slate-500 transition-colors"
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            data-testid="header-theme-toggle"
          >
            {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
          </button>
          <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-2"></div>
          <div className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-default" data-testid="header-user-info">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-sm text-slate-700 dark:text-slate-300">{user?.name?.split(' ').slice(0, 2).join(' ')}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar - Desktop */}
        <aside 
          className={`no-print hidden md:flex flex-col bg-[#F9FAFB] dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 fixed left-0 top-0 h-screen z-40 transition-all duration-300 ${
            sidebarOpen ? 'w-[225px]' : 'w-16'
          }`}
          data-testid="sidebar"
        >
          {/* Logo */}
          <div className={`flex items-center h-14 border-b border-slate-200 dark:border-slate-700 ${sidebarOpen ? 'px-5 gap-3' : 'justify-center px-2'}`}>
            <Link to="/dashboard" className="flex items-center gap-2.5" data-testid="logo-link">
              <img 
                src="/logo-containerlogix.png"
                alt="ContainerLogix"
                className="h-9 w-auto"
              />
              {sidebarOpen && (
                <span className="font-bold text-[15px] text-primary">
                  ContainerLogix
                </span>
              )}
            </Link>
          </div>

          {/* Search */}
          {sidebarOpen && (
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Pesquisar"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-3 pr-8 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  data-testid="sidebar-search"
                />
                {searchQuery ? (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <X className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 dark:text-slate-600" />
                )}
              </div>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto">
            {filteredItems ? (
              <div>
                <p className="px-5 py-2 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Resultados</p>
                {filteredItems.length > 0 ? (
                  filteredItems.map((item) => renderNavItem(item))
                ) : (
                  <p className="px-5 py-3 text-sm text-slate-400 dark:text-slate-500">Nenhum resultado</p>
                )}
              </div>
            ) : (
              <div>
                {mainNavItems.map((item) => renderNavItem(item))}

                {/* Terminal */}
                {isTerminalGroupVisible && renderGroupHeader('Terminal', Anchor, terminalOpen, toggleTerminal, isTerminalActive, 'nav-terminal-toggle')}
                {isTerminalGroupVisible && terminalOpen && sidebarOpen && (
                  <div>
                    {terminalItems.map((item) => renderNavItem(item, true, true))}
                    {movimentacoesItems.length > 0 && renderGroupHeader('Movimentações', Container, movimentacoesOpen, toggleMovimentacoes, isMovimentacoesActive, 'nav-movimentacoes-toggle', true)}
                    {movimentacoesItems.length > 0 && movimentacoesOpen && (
                      <div>{movimentacoesItems.map((item) => renderNavItem(item, true, true))}</div>
                    )}
                    {flexTankItems.length > 0 && renderGroupHeader('Flex Tank', Package, flexTankOpen, toggleFlexTank, isFlexTankActive, 'nav-flex-tank-toggle', true)}
                    {flexTankItems.length > 0 && flexTankOpen && (
                      <div>{flexTankItems.map((item) => renderNavItem(item, true, true))}</div>
                    )}
                    {terminalCadastroItems.length > 0 && renderGroupHeader('Cadastro', FolderOpen, terminalCadastroOpen, toggleTerminalCadastro, isTerminalCadastroActive, 'nav-terminal-cadastro-toggle', true)}
                    {terminalCadastroItems.length > 0 && terminalCadastroOpen && (
                      <div>{terminalCadastroItems.map((item) => renderNavItem(item, true, true))}</div>
                    )}
                  </div>
                )}

                {/* Manutenção */}
                {isManutencaoGroupVisible && renderGroupHeader('Manutenção', Truck, manutencaoOpen, toggleManutencao, isManutencaoActive, 'nav-manutencao-toggle')}
                {isManutencaoGroupVisible && manutencaoOpen && sidebarOpen && (
                  <div>
                    {manutencaoItems.map((item) => renderNavItem(item, true))}
                    {manutencaoCadastroItems.length > 0 && renderGroupHeader('Cadastro', FolderOpen, manutencaoCadastroOpen, toggleManutencaoCadastro, isManutencaoCadastroActive, 'nav-manutencao-cadastro-toggle', true)}
                    {manutencaoCadastroItems.length > 0 && manutencaoCadastroOpen && (
                      <div>{manutencaoCadastroItems.map((item) => renderNavItem(item, true, true))}</div>
                    )}
                  </div>
                )}

                {/* Transporte */}
                {isTransporteGroupVisible && renderGroupHeader('Transporte', Car, transporteOpen, toggleTransporte, isTransporteActive, 'nav-transporte-toggle')}
                {isTransporteGroupVisible && transporteOpen && sidebarOpen && (
                  <div>{transporteItems.map((item) => renderNavItem(item, true))}</div>
                )}

                {/* Cadastro */}
                {renderGroupHeader('Cadastro', FolderOpen, cadastroOpen, toggleCadastro, isCadastroActive, 'nav-cadastro-toggle')}
                {cadastroOpen && sidebarOpen && (
                  <div>{cadastroItems.map((item) => renderNavItem(item, true))}</div>
                )}

                {/* Financeiro */}
                {isAdmin && isFinanceiroGroupVisible && renderGroupHeader('Financeiro', DollarSign, financeiroOpen, toggleFinanceiro, isFinanceiroActive, 'nav-financeiro-toggle')}
                {isAdmin && isFinanceiroGroupVisible && financeiroOpen && sidebarOpen && (
                  <div>{financeiroItems.map((item) => renderNavItem(item, true))}</div>
                )}

                {/* Operacional */}
                {isOperacionalGroupVisible && renderGroupHeader('Operacional', Clipboard, operacionalOpen, toggleOperacional, isOperacionalActive, 'nav-operacional-toggle')}
                {isOperacionalGroupVisible && operacionalOpen && sidebarOpen && (
                  <div>{operacionalItems.map((item) => renderNavItem(item, true))}</div>
                )}

                {/* Estoque */}
                {isEstoqueGroupVisible && renderGroupHeader('Estoque', Boxes, estoqueOpen, toggleEstoque, isEstoqueActive, 'nav-estoque-toggle')}
                {isEstoqueGroupVisible && estoqueOpen && sidebarOpen && (
                  <div>
                    {estoqueItems.map((item) => renderNavItem(item, true))}
                    {estoqueCadastroItems.length > 0 && renderGroupHeader('Cadastro', FolderOpen, estoqueCadastroOpen, toggleEstoqueCadastro, isEstoqueCadastroActive, 'nav-estoque-cadastro-toggle', true)}
                    {estoqueCadastroItems.length > 0 && estoqueCadastroOpen && (
                      <div>{estoqueCadastroItems.map((item) => renderNavItem(item, true, true))}</div>
                    )}
                  </div>
                )}

                {/* Opções do Sistema */}
                {isOpcoesSistemaGroupVisible && renderGroupHeader('Opções do Sistema', Cog, opcoesSistemaOpen, toggleOpcoesSistema, isOpcoesSistemaActive, 'nav-opcoes-sistema-toggle')}
                {isOpcoesSistemaGroupVisible && opcoesSistemaOpen && sidebarOpen && (
                  <div>{opcoesSistemaItems.map((item) => renderNavItem(item, true))}</div>
                )}
              </div>
            )}
          </nav>

          {/* Footer */}
          <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2">
            <div className="flex items-center justify-between">
              <button 
                onClick={handleLogout} 
                data-testid="logout-button"
                className={`flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-red-600 transition-colors text-[13px] py-1.5 px-2 rounded ${!sidebarOpen ? 'justify-center w-full' : ''}`}
                title={!sidebarOpen ? 'Sair' : undefined}
              >
                <LogOut className="w-[18px] h-[18px]" />
                {sidebarOpen && <span>Sair</span>}
              </button>
              <button
                onClick={toggleSidebar}
                data-testid="toggle-sidebar"
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400 transition-colors p-1.5 rounded"
              >
                {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </aside>

        {/* Mobile Header */}
        <nav className="no-print md:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 fixed top-0 left-0 right-0 z-50 shadow-sm" data-testid="mobile-navigation">
          <div className="px-4">
            <div className="flex items-center justify-between h-14">
              <Link to="/dashboard" className="flex items-center gap-2">
                <img 
                  src="/logo-containerlogix.png"
                  alt="ContainerLogix"
                  className="h-8 w-auto"
                />
                <span className="font-bold text-sm text-primary">ContainerLogix</span>
              </Link>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">{user?.name?.split(' ')[0]}</span>
                <button
                  className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  data-testid="mobile-menu-toggle"
                >
                  {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {mobileMenuOpen && (
              <div className="py-1 border-t border-slate-200 dark:border-slate-700 max-h-[calc(100vh-56px)] overflow-y-auto -mx-4 px-2 pb-4 bg-white dark:bg-slate-900" data-testid="mobile-menu">
                {mainNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Link key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 text-sm border-b border-slate-100 dark:border-slate-800 ${
                        isActive ? 'text-primary font-semibold' : 'text-[#1B4965] dark:text-slate-300'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'text-slate-800 dark:text-slate-200'}`} strokeWidth={1.8} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}

                {/* Terminal Mobile */}
                {isTerminalGroupVisible && renderMobileGroupToggle('Terminal', Anchor, terminalOpen, toggleTerminal, isTerminalActive)}
                {isTerminalGroupVisible && terminalOpen && (
                  <div>
                    {terminalItems.map((item) => renderMobileNavItem(item, true))}
                    {movimentacoesItems.length > 0 && renderMobileGroupToggle('Movimentações', Container, movimentacoesOpen, toggleMovimentacoes, isMovimentacoesActive, true)}
                    {movimentacoesItems.length > 0 && movimentacoesOpen && movimentacoesItems.map((item) => renderMobileNavItem(item, true))}
                    {flexTankItems.length > 0 && renderMobileGroupToggle('Flex Tank', Package, flexTankOpen, toggleFlexTank, isFlexTankActive, true)}
                    {flexTankItems.length > 0 && flexTankOpen && flexTankItems.map((item) => renderMobileNavItem(item, true))}
                    {terminalCadastroItems.length > 0 && renderMobileGroupToggle('Cadastro', FolderOpen, terminalCadastroOpen, toggleTerminalCadastro, isTerminalCadastroActive, true)}
                    {terminalCadastroItems.length > 0 && terminalCadastroOpen && terminalCadastroItems.map((item) => renderMobileNavItem(item, true))}
                  </div>
                )}

                {/* Manutenção Mobile */}
                {isManutencaoGroupVisible && renderMobileGroupToggle('Manutenção', Truck, manutencaoOpen, toggleManutencao, isManutencaoActive)}
                {isManutencaoGroupVisible && manutencaoOpen && (
                  <div>
                    {manutencaoItems.map((item) => renderMobileNavItem(item))}
                    {manutencaoCadastroItems.length > 0 && renderMobileGroupToggle('Cadastro', FolderOpen, manutencaoCadastroOpen, toggleManutencaoCadastro, isManutencaoCadastroActive, true)}
                    {manutencaoCadastroItems.length > 0 && manutencaoCadastroOpen && manutencaoCadastroItems.map((item) => renderMobileNavItem(item, true))}
                  </div>
                )}

                {/* Transporte Mobile */}
                {isTransporteGroupVisible && renderMobileGroupToggle('Transporte', Car, transporteOpen, toggleTransporte, isTransporteActive)}
                {isTransporteGroupVisible && transporteOpen && transporteItems.map((item) => renderMobileNavItem(item))}

                {/* Cadastro Mobile */}
                {renderMobileGroupToggle('Cadastro', FolderOpen, cadastroOpen, toggleCadastro, isCadastroActive)}
                {cadastroOpen && cadastroItems.map((item) => renderMobileNavItem(item))}

                {/* Financeiro Mobile */}
                {isAdmin && isFinanceiroGroupVisible && renderMobileGroupToggle('Financeiro', DollarSign, financeiroOpen, toggleFinanceiro, isFinanceiroActive)}
                {isAdmin && isFinanceiroGroupVisible && financeiroOpen && financeiroItems.map((item) => renderMobileNavItem(item))}

                {/* Operacional Mobile */}
                {isOperacionalGroupVisible && renderMobileGroupToggle('Operacional', Clipboard, operacionalOpen, toggleOperacional, isOperacionalActive)}
                {isOperacionalGroupVisible && operacionalOpen && operacionalItems.map((item) => renderMobileNavItem(item))}

                {/* Estoque Mobile */}
                {isEstoqueGroupVisible && renderMobileGroupToggle('Estoque', Boxes, estoqueOpen, toggleEstoque, isEstoqueActive)}
                {isEstoqueGroupVisible && estoqueOpen && (
                  <div>
                    {estoqueItems.map((item) => renderMobileNavItem(item))}
                    {estoqueCadastroItems.length > 0 && renderMobileGroupToggle('Cadastro', FolderOpen, estoqueCadastroOpen, toggleEstoqueCadastro, isEstoqueCadastroActive, true)}
                    {estoqueCadastroItems.length > 0 && estoqueCadastroOpen && estoqueCadastroItems.map((item) => renderMobileNavItem(item, true))}
                  </div>
                )}

                {/* Opções do Sistema Mobile */}
                {isOpcoesSistemaGroupVisible && renderMobileGroupToggle('Opções do Sistema', Cog, opcoesSistemaOpen, toggleOpcoesSistema, isOpcoesSistemaActive)}
                {isOpcoesSistemaGroupVisible && opcoesSistemaOpen && opcoesSistemaItems.map((item) => renderMobileNavItem(item))}

                <button onClick={handleLogout}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-red-600 w-full"
                >
                  <LogOut className="w-5 h-5" strokeWidth={1.8} />
                  <span>Sair</span>
                </button>
              </div>
            )}
          </div>
        </nav>

        {/* Main Content */}
        <main className={`flex-1 transition-all duration-300 ${
          sidebarOpen ? 'md:ml-[225px]' : 'md:ml-16'
        } mt-14 md:mt-12`}>
          <div className="max-w-screen-2xl mx-auto px-4 py-5 md:px-6 md:py-6">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        items={allSearchableItems}
      />
    </div>
  );
}
