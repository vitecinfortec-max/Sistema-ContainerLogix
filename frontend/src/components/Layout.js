import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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
  Users,
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
  Anchor
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Button } from './ui/button';

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/movements': 'Movimentações',
  '/movements/new': 'Nova Movimentação',
  '/yard-control': 'Controle de Pátio',
  '/fleet': 'Frota',
  '/fleet/rpa-terceiro': 'RPA Terceiro',
  '/fleet/rpa-terceiro/new': 'Novo RPA Terceiro',
  '/fleet/ordem-servico': 'Ordem de Serviço',
  '/drivers': 'Pessoas',
  '/companies': 'Transportadoras',
  '/clients': 'Clientes',
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
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [movimentacoesOpen, setMovimentacoesOpen] = useState(false);
  const [cadastroOpen, setCadastroOpen] = useState(false);
  const [financeiroOpen, setFinanceiroOpen] = useState(false);
  const [frotaOpen, setFrotaOpen] = useState(false);
  const [operacionalOpen, setOperacionalOpen] = useState(false);
  const [flexTankOpen, setFlexTankOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('sidebarOpen');
    if (saved !== null) setSidebarOpen(JSON.parse(saved));
    const savedMovimentacoes = localStorage.getItem('movimentacoesOpen');
    if (savedMovimentacoes !== null) setMovimentacoesOpen(JSON.parse(savedMovimentacoes));
    const savedFinanceiro = localStorage.getItem('financeiroOpen');
    if (savedFinanceiro !== null) setFinanceiroOpen(JSON.parse(savedFinanceiro));
    const savedFrota = localStorage.getItem('frotaOpen');
    if (savedFrota !== null) setFrotaOpen(JSON.parse(savedFrota));
    const savedOperacional = localStorage.getItem('operacionalOpen');
    if (savedOperacional !== null) setOperacionalOpen(JSON.parse(savedOperacional));
    const savedFlexTank = localStorage.getItem('flexTankOpen');
    if (savedFlexTank !== null) setFlexTankOpen(JSON.parse(savedFlexTank));
    const savedTerminal = localStorage.getItem('terminalOpen');
    if (savedTerminal !== null) setTerminalOpen(JSON.parse(savedTerminal));
  }, []);

  const isMovimentacoesActive = location.pathname === '/movements' || location.pathname === '/movements/new' || location.pathname.startsWith('/movements/') || location.pathname === '/reports/movements' || location.pathname === '/yard-control';
  const isCadastroActive = ['/drivers', '/companies', '/clients', '/shipping-lines', '/service-types'].includes(location.pathname);
  const isFinanceiroActive = location.pathname === '/billing' || location.pathname === '/reports/billing' || location.pathname === '/international-invoices';
  const isFrotaActive = location.pathname === '/fleet' || location.pathname === '/fleet/vehicles' || location.pathname === '/fleet/revisions' || location.pathname.startsWith('/fleet/rpa-terceiro') || location.pathname.startsWith('/fleet/ordem-servico');
  const isOperacionalActive = location.pathname === '/loading-schedules' || location.pathname === '/delivery-status';
  const isFlexTankActive = location.pathname === '/flex-tank' || location.pathname.startsWith('/flex-tank/');
  const isContainerInspectionsActive = location.pathname === '/container-inspections' || location.pathname.startsWith('/container-inspections/');
  const isTerminalActive = isFlexTankActive || isContainerInspectionsActive;

  useEffect(() => {
    if (isMovimentacoesActive && !movimentacoesOpen) setMovimentacoesOpen(true);
    if (isCadastroActive && !cadastroOpen) setCadastroOpen(true);
    if (isFinanceiroActive && !financeiroOpen) setFinanceiroOpen(true);
    if (isFrotaActive && !frotaOpen) setFrotaOpen(true);
    if (isOperacionalActive && !operacionalOpen) setOperacionalOpen(true);
    if (isFlexTankActive && !flexTankOpen) setFlexTankOpen(true);
    if (isTerminalActive && !terminalOpen) setTerminalOpen(true);
  }, [location.pathname]);

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

  const toggleFrota = () => {
    const newState = !frotaOpen;
    setFrotaOpen(newState);
    localStorage.setItem('frotaOpen', JSON.stringify(newState));
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

  const toggleTerminal = () => {
    const newState = !terminalOpen;
    setTerminalOpen(newState);
    localStorage.setItem('terminalOpen', JSON.stringify(newState));
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const mainNavItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ];

  const terminalItems = [
    { path: '/container-inspections', label: 'Vistoria de Container', icon: ClipboardCheck },
  ];

  const flexTankItems = [
    { path: '/flex-tank', label: 'Movimentações', icon: List },
    { path: '/flex-tank?tab=reports', label: 'Relatórios', icon: BarChart3 },
  ];

  const movimentacoesItems = [
    { path: '/movements', label: 'Movimentações', icon: List },
    { path: '/unit-segregation', label: 'Segregação de Unidade', icon: Package },
    { path: '/yard-control', label: 'Controle de Pátio', icon: Clock },
    { path: '/reports/movements', label: 'Relatório de Movimentação', icon: BarChart3 },
  ];

  const frotaItems = [
    { path: '/fleet', label: 'Cadastro de Veículos', icon: Car },
    { path: '/fleet?tab=revisions', label: 'Controle de Revisão', icon: Wrench },
    { path: '/fleet/rpa-terceiro', label: 'RPA Terceiro', icon: FileText },
    { path: '/fleet/ordem-servico', label: 'Ordem de Serviço', icon: ClipboardList },
  ];

  const cadastroItems = [
    { path: '/drivers', label: 'Pessoas', icon: Truck },
    { path: '/companies', label: 'Transportadora', icon: Building2 },
    { path: '/clients', label: 'Cliente', icon: Users },
    { path: '/shipping-lines', label: 'Armador', icon: Ship },
    { path: '/service-types', label: 'Tipos de Serviço', icon: ClipboardList },
  ];

  const financeiroItems = [
    { path: '/billing', label: 'Faturas', icon: Receipt },
    { path: '/international-invoices', label: 'Invoice Internacional', icon: Globe },
    { path: '/reports/billing', label: 'Relatório de Faturamento', icon: BarChart3 },
  ];

  const operacionalItems = [
    { path: '/loading-schedules', label: 'Programação de Carregamento', icon: Calendar },
    { path: '/delivery-status', label: 'Status de Entrega', icon: ClipboardCheck },
  ];

  const allSearchableItems = useMemo(() => [
    ...mainNavItems, ...terminalItems, ...flexTankItems, ...movimentacoesItems, ...frotaItems, ...cadastroItems, ...financeiroItems, ...operacionalItems,
  ], []);

  const filteredItems = searchQuery
    ? allSearchableItems.filter(item => item.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : null;

  const pageTitle = useMemo(() => {
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
  }, [location.pathname]);

  // Expand sidebar when clicking a group while collapsed
  const handleGroupClickCollapsed = (toggleFn) => {
    setSidebarOpen(true);
    localStorage.setItem('sidebarOpen', JSON.stringify(true));
    toggleFn();
  };

  // Bsoft-style nav item
  const renderNavItem = (item, isSubItem = false, deepIndent = false) => {
    const Icon = item.icon;
    // Para comparação, considerar pathname + search para URLs com query strings
    const currentFullPath = location.pathname + location.search;
    const isActive = location.pathname === item.path || currentFullPath === item.path;

    if (!sidebarOpen) {
      return (
        <Link
          key={item.path}
          to={item.path}
          data-testid={`nav-${item.path.replace(/\//g, '-').slice(1)}`}
          title={item.label}
          className={`flex items-center justify-center h-11 border-b border-slate-100 transition-colors ${
            isActive ? 'text-primary' : 'text-slate-700 hover:text-primary'
          }`}
        >
          <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-primary' : 'text-slate-800'}`} strokeWidth={isActive ? 2.2 : 1.8} />
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
          className={`flex items-center py-3 transition-colors border-b border-slate-100 ${
            isActive ? 'text-primary font-semibold' : 'text-slate-700 hover:text-primary'
          } ${deepIndent ? 'pl-14' : 'pl-10'} pr-5 text-[13px] gap-2`}
        >
          <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-primary' : 'text-slate-400'}`} />
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
        className={`flex items-center py-3 transition-colors border-b border-slate-100 ${
          isActive ? 'text-primary font-semibold' : 'text-slate-700 hover:text-primary'
        } px-5 gap-3 text-[13px]`}
      >
        <Icon className={`flex-shrink-0 w-[18px] h-[18px] ${isActive ? 'text-primary' : 'text-slate-800'}`} strokeWidth={isActive ? 2.2 : 1.8} />
        <span>{item.label}</span>
      </Link>
    );
  };

  // Bsoft-style group header
  const renderGroupHeader = (label, icon, isOpen, toggle, isActive, testId, nested = false) => {
    const Icon = icon;
    if (!sidebarOpen) {
      // Subgrupos aninhados (ex: Flex Tank dentro de Terminal) só aparecem com a
      // sidebar expandida — no modo recolhido só o grupo de topo mostra ícone.
      if (nested) return null;
      return (
        <div
          className="flex items-center justify-center h-11 cursor-pointer border-b border-slate-100 transition-colors hover:text-primary"
          title={label}
          onClick={() => handleGroupClickCollapsed(toggle)}
          data-testid={testId}
        >
          <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-primary' : 'text-slate-800'}`} strokeWidth={1.8} />
        </div>
      );
    }
    return (
      <button
        onClick={toggle}
        className={`w-full flex items-center justify-between ${nested ? 'pl-9 pr-5' : 'px-5'} py-3 transition-colors border-b border-slate-100 text-[13px] ${
          isActive ? 'text-primary font-semibold' : 'text-slate-700 hover:text-primary'
        }`}
        data-testid={testId}
      >
        <div className="flex items-center gap-3">
          <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? 'text-primary' : 'text-slate-800'}`} strokeWidth={isActive ? 2.2 : 1.8} />
          <span>{label}</span>
        </div>
        <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''} ${isActive ? 'text-primary' : 'text-slate-400'}`} />
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top Header Bar */}
      <header className={`no-print hidden md:flex items-center justify-between h-12 bg-white border-b border-slate-200 fixed top-0 right-0 z-30 transition-all duration-300 ${
        sidebarOpen ? 'left-[260px]' : 'left-16'
      }`} data-testid="top-header">
        <div className="flex items-center h-full px-6">
          <h1 className="text-[15px] font-semibold text-slate-800" style={{ fontFamily: 'Chivo, sans-serif' }} data-testid="page-title">
            {pageTitle}
          </h1>
        </div>
        <div className="flex items-center gap-1 px-4">
          <button className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors" title="Notificações" data-testid="header-notifications">
            <Bell className="w-[18px] h-[18px]" />
          </button>
          <button className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors" title="Configurações" data-testid="header-settings">
            <Settings className="w-[18px] h-[18px]" />
          </button>
          <div className="w-px h-5 bg-slate-200 mx-2"></div>
          <div className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-slate-50 transition-colors cursor-default" data-testid="header-user-info">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-sm text-slate-700">{user?.name?.split(' ').slice(0, 2).join(' ')}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar - Desktop */}
        <aside 
          className={`no-print hidden md:flex flex-col bg-white border-r border-slate-200 fixed left-0 top-0 h-screen z-40 transition-all duration-300 ${
            sidebarOpen ? 'w-[260px]' : 'w-16'
          }`}
          data-testid="sidebar"
        >
          {/* Logo */}
          <div className={`flex items-center h-14 border-b border-slate-200 ${sidebarOpen ? 'px-5 gap-3' : 'justify-center px-2'}`}>
            <Link to="/dashboard" className="flex items-center gap-2.5" data-testid="logo-link">
              <img 
                src="/logo-containerlogix.png"
                alt="ContainerLogix"
                className="h-9 w-auto"
              />
              {sidebarOpen && (
                <span className="font-bold text-[15px] text-primary" style={{ fontFamily: 'Chivo, sans-serif' }}>
                  ContainerLogix
                </span>
              )}
            </Link>
          </div>

          {/* Search */}
          {sidebarOpen && (
            <div className="px-4 py-3 border-b border-slate-200">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Pesquisar (Ctrl+K)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-3 pr-8 text-sm bg-slate-50 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 placeholder:text-slate-400"
                  data-testid="sidebar-search"
                />
                {searchQuery ? (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <X className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                )}
              </div>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto">
            {filteredItems ? (
              <div>
                <p className="px-5 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Resultados</p>
                {filteredItems.length > 0 ? (
                  filteredItems.map((item) => renderNavItem(item))
                ) : (
                  <p className="px-5 py-3 text-sm text-slate-400">Nenhum resultado</p>
                )}
              </div>
            ) : (
              <div>
                {mainNavItems.map((item) => renderNavItem(item))}

                {/* Terminal */}
                {renderGroupHeader('Terminal', Anchor, terminalOpen, toggleTerminal, isTerminalActive, 'nav-terminal-toggle')}
                {terminalOpen && sidebarOpen && (
                  <div>
                    {terminalItems.map((item) => renderNavItem(item, true, true))}
                    {renderGroupHeader('Flex Tank', Package, flexTankOpen, toggleFlexTank, isFlexTankActive, 'nav-flex-tank-toggle', true)}
                    {flexTankOpen && (
                      <div>{flexTankItems.map((item) => renderNavItem(item, true, true))}</div>
                    )}
                  </div>
                )}

                {/* Movimentações */}
                {renderGroupHeader('Movimentações', Container, movimentacoesOpen, toggleMovimentacoes, isMovimentacoesActive, 'nav-movimentacoes-toggle')}
                {movimentacoesOpen && sidebarOpen && (
                  <div>{movimentacoesItems.map((item) => renderNavItem(item, true))}</div>
                )}

                {/* Frota */}
                {renderGroupHeader('Frota', Truck, frotaOpen, toggleFrota, isFrotaActive, 'nav-frota-toggle')}
                {frotaOpen && sidebarOpen && (
                  <div>{frotaItems.map((item) => renderNavItem(item, true))}</div>
                )}

                {/* Cadastro */}
                {renderGroupHeader('Cadastro', FolderOpen, cadastroOpen, toggleCadastro, isCadastroActive, 'nav-cadastro-toggle')}
                {cadastroOpen && sidebarOpen && (
                  <div>{cadastroItems.map((item) => renderNavItem(item, true))}</div>
                )}

                {/* Financeiro */}
                {renderGroupHeader('Financeiro', DollarSign, financeiroOpen, toggleFinanceiro, isFinanceiroActive, 'nav-financeiro-toggle')}
                {financeiroOpen && sidebarOpen && (
                  <div>{financeiroItems.map((item) => renderNavItem(item, true))}</div>
                )}

                {/* Operacional */}
                {renderGroupHeader('Operacional', Clipboard, operacionalOpen, toggleOperacional, isOperacionalActive, 'nav-operacional-toggle')}
                {operacionalOpen && sidebarOpen && (
                  <div>{operacionalItems.map((item) => renderNavItem(item, true))}</div>
                )}
              </div>
            )}
          </nav>

          {/* Footer */}
          <div className="border-t border-slate-200 px-3 py-2">
            <div className="flex items-center justify-between">
              <button 
                onClick={handleLogout} 
                data-testid="logout-button"
                className={`flex items-center gap-2 text-slate-500 hover:text-red-600 transition-colors text-[13px] py-1.5 px-2 rounded ${!sidebarOpen ? 'justify-center w-full' : ''}`}
                title={!sidebarOpen ? 'Sair' : undefined}
              >
                <LogOut className="w-[18px] h-[18px]" />
                {sidebarOpen && <span>Sair</span>}
              </button>
              <button
                onClick={toggleSidebar}
                data-testid="toggle-sidebar"
                className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded"
              >
                {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </aside>

        {/* Mobile Header */}
        <nav className="no-print md:hidden bg-white border-b border-slate-200 fixed top-0 left-0 right-0 z-50 shadow-sm" data-testid="mobile-navigation">
          <div className="px-4">
            <div className="flex items-center justify-between h-14">
              <Link to="/dashboard" className="flex items-center gap-2">
                <img 
                  src="/logo-containerlogix.png"
                  alt="ContainerLogix"
                  className="h-8 w-auto"
                />
                <span className="font-bold text-sm text-primary" style={{ fontFamily: 'Chivo, sans-serif' }}>ContainerLogix</span>
              </Link>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 hidden sm:block">{user?.name?.split(' ')[0]}</span>
                <button
                  className="p-2 rounded-md hover:bg-slate-100 text-slate-600"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  data-testid="mobile-menu-toggle"
                >
                  {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {mobileMenuOpen && (
              <div className="py-1 border-t border-slate-200 max-h-[calc(100vh-56px)] overflow-y-auto -mx-4 px-2 pb-4 bg-white" data-testid="mobile-menu">
                {mainNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Link key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 text-sm border-b border-slate-100 ${
                        isActive ? 'text-primary font-semibold' : 'text-slate-700'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'text-slate-800'}`} strokeWidth={1.8} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}

                {/* Movimentações Mobile */}
                <button onClick={toggleMovimentacoes}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm border-b border-slate-100 ${
                    isMovimentacoesActive ? 'text-primary font-semibold' : 'text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Container className="w-5 h-5 text-slate-800" strokeWidth={1.8} />
                    <span>Movimentações</span>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${movimentacoesOpen ? 'rotate-90' : ''}`} />
                </button>
                {movimentacoesOpen && movimentacoesItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-2 pl-10 pr-4 py-2.5 text-[13px] border-b border-slate-100 ${
                        isActive ? 'text-primary font-semibold' : 'text-slate-700'
                      }`}
                    >
                      <ChevronRight className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}

                {/* Cadastro Mobile */}
                <button onClick={toggleCadastro}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm border-b border-slate-100 ${
                    isCadastroActive ? 'text-primary font-semibold' : 'text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <FolderOpen className="w-5 h-5 text-slate-800" strokeWidth={1.8} />
                    <span>Cadastro</span>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${cadastroOpen ? 'rotate-90' : ''}`} />
                </button>
                {cadastroOpen && cadastroItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-2 pl-10 pr-4 py-2.5 text-[13px] border-b border-slate-100 ${
                        isActive ? 'text-primary font-semibold' : 'text-slate-700'
                      }`}
                    >
                      <ChevronRight className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}

                {/* Financeiro Mobile */}
                <button onClick={toggleFinanceiro}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm border-b border-slate-100 ${
                    isFinanceiroActive ? 'text-primary font-semibold' : 'text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <DollarSign className="w-5 h-5 text-slate-800" strokeWidth={1.8} />
                    <span>Financeiro</span>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${financeiroOpen ? 'rotate-90' : ''}`} />
                </button>
                {financeiroOpen && financeiroItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-2 pl-10 pr-4 py-2.5 text-[13px] border-b border-slate-100 ${
                        isActive ? 'text-primary font-semibold' : 'text-slate-700'
                      }`}
                    >
                      <ChevronRight className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}

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
          sidebarOpen ? 'md:ml-[260px]' : 'md:ml-16'
        } mt-14 md:mt-12`}>
          <div className="max-w-screen-2xl mx-auto px-4 py-5 md:px-6 md:py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
