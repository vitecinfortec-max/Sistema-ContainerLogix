import '@/App.css';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { ModuleConfigProvider } from './context/ModuleConfigContext';
import { Toaster } from './components/ui/sonner';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';

// As demais páginas são carregadas sob demanda (um arquivo por tela), em vez
// de irem todas no download inicial. Login e "Esqueci a senha" ficam no
// pacote principal por serem a primeira tela de quem abre o sistema.
//
// Depois de uma publicação nova, os arquivos de página da versão anterior
// deixam de existir no servidor - uma aba que ficou aberta falharia ao
// navegar. Nesse caso recarrega a página uma vez pra pegar a versão nova (a
// marca no sessionStorage evita recarregar em loop se o erro for outro).
const RELOAD_FLAG = 'page-chunk-reloaded';
const lazyPage = (load) => lazy(async () => {
  try {
    const page = await load();
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch (e) { /* sem storage */ }
    return page;
  } catch (error) {
    let alreadyReloaded = true;
    try {
      alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
      sessionStorage.setItem(RELOAD_FLAG, '1');
    } catch (e) { /* sem storage: não arrisca um loop de recarga */ }
    if (!alreadyReloaded) {
      window.location.reload();
      return new Promise(() => {});
    }
    throw error;
  }
});

// A moldura também vem sob demanda (não pesa na tela de login)
const AppShell = lazyPage(() => import('./components/Layout').then((m) => ({ default: m.AppShell })));
const ChangePasswordPage = lazyPage(() => import('./pages/ChangePasswordPage'));
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'));
const MovementsPage = lazyPage(() => import('./pages/MovementsPage'));
const NewMovementPage = lazyPage(() => import('./pages/NewMovementPage'));
const MovementDetailPage = lazyPage(() => import('./pages/MovementDetailPage'));
const EditMovementPage = lazyPage(() => import('./pages/EditMovementPage'));
const ShippingLinesPage = lazyPage(() => import('./pages/ShippingLinesPage'));
const CadastroUnificadoPage = lazyPage(() => import('./pages/CadastroUnificadoPage'));
const ServiceTypesPage = lazyPage(() => import('./pages/ServiceTypesPage'));
const OSCategoriesPage = lazyPage(() => import('./pages/OSCategoriesPage'));
const EstoqueCadastrosPage = lazyPage(() => import('./pages/EstoqueCadastrosPage'));
const ServiceCatalogPage = lazyPage(() => import('./pages/ServiceCatalogPage'));
const ProductPage = lazyPage(() => import('./pages/ProductPage'));
const StockPage = lazyPage(() => import('./pages/StockPage'));
const StockEntriesPage = lazyPage(() => import('./pages/StockEntriesPage'));
const StockMovementsPage = lazyPage(() => import('./pages/StockMovementsPage'));
const EpiDeliveriesPage = lazyPage(() => import('./pages/EpiDeliveriesPage'));
const StockReportPage = lazyPage(() => import('./pages/StockReportPage'));
const ReportsMovementsPage = lazyPage(() => import('./pages/ReportsMovementsPage'));
const ReportsBillingPage = lazyPage(() => import('./pages/ReportsBillingPage'));
const BillingPage = lazyPage(() => import('./pages/BillingPage'));
const ContainerInspectionsPage = lazyPage(() => import('./pages/ContainerInspectionsPage'));
const NewContainerInspectionPage = lazyPage(() => import('./pages/NewContainerInspectionPage'));
const ContainerInspectionDetailPage = lazyPage(() => import('./pages/ContainerInspectionDetailPage'));
const EditContainerInspectionPage = lazyPage(() => import('./pages/EditContainerInspectionPage'));
const ContainerVistoriasPage = lazyPage(() => import('./pages/ContainerVistoriasPage'));
const NewContainerVistoriaPage = lazyPage(() => import('./pages/NewContainerVistoriaPage'));
const ContainerVistoriaDetailPage = lazyPage(() => import('./pages/ContainerVistoriaDetailPage'));
const EditContainerVistoriaPage = lazyPage(() => import('./pages/EditContainerVistoriaPage'));
const ContainerAuditsPage = lazyPage(() => import('./pages/ContainerAuditsPage'));
const NewContainerAuditPage = lazyPage(() => import('./pages/NewContainerAuditPage'));
const ContainerAuditDetailPage = lazyPage(() => import('./pages/ContainerAuditDetailPage'));
const ComercialCadastrosPage = lazyPage(() => import('./pages/ComercialCadastrosPage'));
const ServicePriceTablePage = lazyPage(() => import('./pages/ServicePriceTablePage'));
const ServicePriceTableClientPage = lazyPage(() => import('./pages/ServicePriceTableClientPage'));
const ClientRepresentativeLinksPage = lazyPage(() => import('./pages/ClientRepresentativeLinksPage'));
const ComercialProposalsPage = lazyPage(() => import('./pages/ComercialProposalsPage'));
const NewCommercialProposalPage = lazyPage(() => import('./pages/NewCommercialProposalPage'));
const EditCommercialProposalPage = lazyPage(() => import('./pages/EditCommercialProposalPage'));
const FlexTankPage = lazyPage(() => import('./pages/FlexTankPage'));
const NewFlexTankMovementPage = lazyPage(() => import('./pages/NewFlexTankMovementPage'));
const FlexTankMovementDetailPage = lazyPage(() => import('./pages/FlexTankMovementDetailPage'));
const EditFlexTankMovementPage = lazyPage(() => import('./pages/EditFlexTankMovementPage'));
const YardControlPage = lazyPage(() => import('./pages/YardControlPage'));
const FleetPage = lazyPage(() => import('./pages/FleetPage'));
const VehicleChecklistPage = lazyPage(() => import('./pages/VehicleChecklistPage'));
const LoadingSchedulePage = lazyPage(() => import('./pages/LoadingSchedulePage'));
const DailyRateRequestPage = lazyPage(() => import('./pages/DailyRateRequestPage'));
const CheckControlPage = lazyPage(() => import('./pages/CheckControlPage'));
const ExpenseReportsPage = lazyPage(() => import('./pages/ExpenseReportsPage'));
const DeliveryStatusPage = lazyPage(() => import('./pages/DeliveryStatusPage'));
const PortServicePage = lazyPage(() => import('./pages/PortServicePage'));
const ReportsPortServicesPage = lazyPage(() => import('./pages/ReportsPortServicesPage'));
const PortServiceShiftsPage = lazyPage(() => import('./pages/PortServiceShiftsPage'));
const PortServiceBillingPage = lazyPage(() => import('./pages/PortServiceBillingPage'));
const InternationalInvoicePage = lazyPage(() => import('./pages/InternationalInvoicePage'));
const UnitSegregationPage = lazyPage(() => import('./pages/UnitSegregationPage'));
const RPATerceiroPage = lazyPage(() => import('./pages/RPATerceiroPage'));
const OrdemServicoPage = lazyPage(() => import('./pages/OrdemServicoPage'));
const FuelSupplyPage = lazyPage(() => import('./pages/FuelSupplyPage'));
const OdometerReadingsPage = lazyPage(() => import('./pages/OdometerReadingsPage'));
const FuelConsumptionPage = lazyPage(() => import('./pages/FuelConsumptionPage'));
const FuelTankLevelPage = lazyPage(() => import('./pages/FuelTankLevelPage'));
const TankSettingsPage = lazyPage(() => import('./pages/TankSettingsPage'));
const ReportsFuelSupplyPage = lazyPage(() => import('./pages/ReportsFuelSupplyPage'));
const ReportsServiceOrdersPage = lazyPage(() => import('./pages/ReportsServiceOrdersPage'));
const FuelSupplyOrderPage = lazyPage(() => import('./pages/FuelSupplyOrderPage'));
const LoadingOrderPage = lazyPage(() => import('./pages/LoadingOrderPage'));
const FreightRoutesPage = lazyPage(() => import('./pages/FreightRoutesPage'));
const FreightPaymentsPage = lazyPage(() => import('./pages/FreightPaymentsPage'));
const ContainerRepresentativesPage = lazyPage(() => import('./pages/ContainerRepresentativesPage'));
const ContainerPurchasesPage = lazyPage(() => import('./pages/ContainerPurchasesPage'));
const ContainerSalesPage = lazyPage(() => import('./pages/ContainerSalesPage'));
const CompanySettingsPage = lazyPage(() => import('./pages/CompanySettingsPage'));
const UsersPage = lazyPage(() => import('./pages/UsersPage'));
const ModulesPage = lazyPage(() => import('./pages/ModulesPage'));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen" data-testid="page-loading-spinner">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
  </div>
);

// Moldura comum a todas as telas internas (components/Layout.js): o menu e o
// cabeçalho ficam na tela enquanto o arquivo da próxima tela carrega. Sem
// sessão, ou com troca de senha pendente, não há moldura - o ProtectedRoute
// de cada rota manda para o login / troca de senha.
function ShellRoute() {
  const { isAuthenticated, loading, user } = useAuth();
  if (loading || !isAuthenticated || user?.must_change_password) return <Outlet />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
    <WebSocketProvider>
    <ModuleConfigProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/change-password" element={
            <ProtectedRoute>
              <ChangePasswordPage />
            </ProtectedRoute>
          } />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route element={<ShellRoute />}>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/movements"
            element={
              <ProtectedRoute moduleKey="terminal.movimentacoes">
                <MovementsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/movements/new"
            element={
              <ProtectedRoute moduleKey="terminal.movimentacoes">
                <NewMovementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/movements/:id"
            element={
              <ProtectedRoute moduleKey="terminal.movimentacoes">
                <MovementDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/movements/:id/edit"
            element={
              <ProtectedRoute moduleKey="terminal.movimentacoes">
                <EditMovementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/yard-control"
            element={
              <ProtectedRoute moduleKey="terminal.movimentacoes">
                <YardControlPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet"
            element={
              <ProtectedRoute moduleKey="frota.veiculos">
                <FleetPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/rpa-terceiro"
            element={
              <ProtectedRoute adminOnly moduleKey="financeiro.rpa_terceiro">
                <RPATerceiroPage rpaType="terceiro" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/hodometro"
            element={
              <ProtectedRoute moduleKey="frota.hodometro">
                <OdometerReadingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/controle-media"
            element={
              <ProtectedRoute moduleKey="frota.controle_media">
                <FuelConsumptionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/ordem-servico"
            element={
              <ProtectedRoute moduleKey="frota.ordem_servico">
                <OrdemServicoPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/checklist"
            element={
              <ProtectedRoute moduleKey="frota.checklist">
                <VehicleChecklistPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/ordem-abastecimento"
            element={
              <ProtectedRoute moduleKey="frota.ordem_abastecimento">
                <FuelSupplyOrderPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/abastecimento"
            element={
              <ProtectedRoute moduleKey="frota.abastecimento">
                <FuelSupplyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/nivel-tanque"
            element={
              <ProtectedRoute moduleKey="abastecimento.nivel_tanque">
                <FuelTankLevelPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tank-settings"
            element={
              <ProtectedRoute adminOnly moduleKey="abastecimento.configuracao_tanque">
                <TankSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/fuel-supply"
            element={
              <ProtectedRoute adminOnly moduleKey="frota.relatorio_abastecimento">
                <ReportsFuelSupplyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/service-orders"
            element={
              <ProtectedRoute adminOnly moduleKey="frota.relatorio_servicos">
                <ReportsServiceOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/loading-orders"
            element={
              <ProtectedRoute moduleKey="operacional.ordem_carregamento">
                <LoadingOrderPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/freight-routes"
            element={
              <ProtectedRoute adminOnly moduleKey="cadastro.rota">
                <FreightRoutesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/freight-payments"
            element={
              <ProtectedRoute adminOnly moduleKey="financeiro.pagamento_frete">
                <FreightPaymentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-representatives"
            element={
              <ProtectedRoute adminOnly moduleKey="gestao_container.representante">
                <ContainerRepresentativesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-purchases"
            element={
              <ProtectedRoute adminOnly moduleKey="gestao_container.compra">
                <ContainerPurchasesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-sales"
            element={
              <ProtectedRoute adminOnly moduleKey="gestao_container.venda">
                <ContainerSalesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cadastro"
            element={
              <ProtectedRoute>
                <CadastroUnificadoPage />
              </ProtectedRoute>
            }
          />
          <Route path="/drivers" element={<Navigate to="/cadastro?type=motorista" replace />} />
          <Route path="/clients" element={<Navigate to="/cadastro?type=cliente" replace />} />
          <Route path="/suppliers" element={<Navigate to="/cadastro?type=fornecedor" replace />} />
          <Route path="/terminals" element={<Navigate to="/cadastro?type=terminal" replace />} />
          <Route path="/companies" element={<Navigate to="/cadastro?type=transportadora" replace />} />
          <Route
            path="/company-settings"
            element={
              <ProtectedRoute>
                <CompanySettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute adminOnly>
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/modules"
            element={
              <ProtectedRoute superadminOnly>
                <ModulesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/shipping-lines"
            element={
              <ProtectedRoute moduleKey="cadastro.armador">
                <ShippingLinesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/service-types"
            element={
              <ProtectedRoute moduleKey="cadastro.tipos_servico">
                <ServiceTypesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/os-categories"
            element={
              <ProtectedRoute moduleKey="frota.cadastro_categoria">
                <OSCategoriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/estoque/cadastros"
            element={
              <ProtectedRoute>
                <EstoqueCadastrosPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/estoque/servicos"
            element={
              <ProtectedRoute moduleKey="estoque.cadastro_servico">
                <ServiceCatalogPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/estoque/produtos"
            element={
              <ProtectedRoute moduleKey="estoque.produto">
                <ProductPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/estoque"
            element={
              <ProtectedRoute moduleKey="estoque.consulta">
                <StockPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/estoque/entradas"
            element={
              <ProtectedRoute moduleKey="estoque.entradas">
                <StockEntriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/estoque/movimentacao"
            element={
              <ProtectedRoute moduleKey="estoque.movimentacao">
                <StockMovementsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/estoque/entrega-epi"
            element={
              <ProtectedRoute moduleKey="estoque.entrega_epi">
                <EpiDeliveriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/estoque/relatorio"
            element={
              <ProtectedRoute moduleKey="estoque.relatorio">
                <StockReportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={<Navigate to="/reports/movements" replace />}
          />
          <Route
            path="/reports/movements"
            element={
              <ProtectedRoute moduleKey="terminal.movimentacoes">
                <ReportsMovementsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/billing"
            element={
              <ProtectedRoute adminOnly moduleKey="financeiro.relatorio_faturamento">
                <ReportsBillingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/billing"
            element={
              <ProtectedRoute adminOnly moduleKey="financeiro.faturas">
                <BillingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-inspections"
            element={
              <ProtectedRoute moduleKey="terminal.vistoria">
                <ContainerInspectionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-inspections/new"
            element={
              <ProtectedRoute moduleKey="terminal.vistoria">
                <NewContainerInspectionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-inspections/:id"
            element={
              <ProtectedRoute moduleKey="terminal.vistoria">
                <ContainerInspectionDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-inspections/:id/edit"
            element={
              <ProtectedRoute moduleKey="terminal.vistoria">
                <EditContainerInspectionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-vistorias"
            element={
              <ProtectedRoute moduleKey="terminal.vistoria_container">
                <ContainerVistoriasPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-vistorias/new"
            element={
              <ProtectedRoute moduleKey="terminal.vistoria_container">
                <NewContainerVistoriaPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-vistorias/:id"
            element={
              <ProtectedRoute moduleKey="terminal.vistoria_container">
                <ContainerVistoriaDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-vistorias/:id/edit"
            element={
              <ProtectedRoute moduleKey="terminal.vistoria_container">
                <EditContainerVistoriaPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-audits"
            element={
              <ProtectedRoute moduleKey="terminal.auditoria">
                <ContainerAuditsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-audits/new"
            element={
              <ProtectedRoute moduleKey="terminal.auditoria">
                <NewContainerAuditPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-audits/:id"
            element={
              <ProtectedRoute moduleKey="terminal.auditoria">
                <ContainerAuditDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/comercial/cadastros"
            element={
              <ProtectedRoute moduleKey="comercial.representante">
                <ComercialCadastrosPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/comercial/tabela-servicos"
            element={
              <ProtectedRoute moduleKey="comercial.tabela_servicos">
                <ServicePriceTablePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/comercial/tabela-servicos/:clientId"
            element={
              <ProtectedRoute moduleKey="comercial.tabela_servicos">
                <ServicePriceTableClientPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/comercial/vinculo-clientes"
            element={
              <ProtectedRoute moduleKey="comercial.vinculo_clientes">
                <ClientRepresentativeLinksPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/comercial/proposta"
            element={
              <ProtectedRoute moduleKey="comercial.proposta">
                <ComercialProposalsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/comercial/proposta/new"
            element={
              <ProtectedRoute moduleKey="comercial.proposta">
                <NewCommercialProposalPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/comercial/proposta/:id/edit"
            element={
              <ProtectedRoute moduleKey="comercial.proposta">
                <EditCommercialProposalPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flex-tank"
            element={
              <ProtectedRoute moduleKey="terminal.flex_tank">
                <FlexTankPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flex-tank/movements/new"
            element={
              <ProtectedRoute moduleKey="terminal.flex_tank">
                <NewFlexTankMovementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flex-tank/movements/:id"
            element={
              <ProtectedRoute moduleKey="terminal.flex_tank">
                <FlexTankMovementDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flex-tank/movements/:id/edit"
            element={
              <ProtectedRoute moduleKey="terminal.flex_tank">
                <EditFlexTankMovementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/loading-schedules"
            element={
              <ProtectedRoute moduleKey="operacional.programacao_carregamento">
                <LoadingSchedulePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/daily-rate-requests"
            element={
              <ProtectedRoute adminOnly moduleKey="financeiro.diaria">
                <DailyRateRequestPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/checks"
            element={
              <ProtectedRoute adminOnly moduleKey="financeiro.controle_cheque">
                <CheckControlPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/expense-reports"
            element={
              <ProtectedRoute adminOnly moduleKey="financeiro.prestacao_contas">
                <ExpenseReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/delivery-status"
            element={
              <ProtectedRoute moduleKey="operacional.status_entrega">
                <DeliveryStatusPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/port-services"
            element={
              <ProtectedRoute moduleKey="operacional.servico_portuario">
                <PortServicePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/port-services"
            element={
              <ProtectedRoute adminOnly moduleKey="operacional.relatorio_servico_portuario">
                <ReportsPortServicesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/port-service-shifts"
            element={
              <ProtectedRoute moduleKey="operacional.conferencia_turnos">
                <PortServiceShiftsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/port-services-billing"
            element={
              <ProtectedRoute adminOnly moduleKey="financeiro.faturamento_portuario">
                <PortServiceBillingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/unit-segregation"
            element={
              <ProtectedRoute moduleKey="terminal.movimentacoes">
                <UnitSegregationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/international-invoices"
            element={
              <ProtectedRoute adminOnly moduleKey="financeiro.invoice_internacional">
                <InternationalInvoicePage />
              </ProtectedRoute>
            }
          />
          </Route>
        </Routes>
        </Suspense>
        <Toaster position="top-right" richColors />
      </BrowserRouter>
    </ModuleConfigProvider>
    </WebSocketProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}

export default App;