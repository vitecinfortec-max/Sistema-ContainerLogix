import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { Toaster } from './components/ui/sonner';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import DashboardPage from './pages/DashboardPage';
import MovementsPage from './pages/MovementsPage';
import NewMovementPage from './pages/NewMovementPage';
import MovementDetailPage from './pages/MovementDetailPage';
import EditMovementPage from './pages/EditMovementPage';
import DriversPage from './pages/DriversPage';
import CompaniesPage from './pages/CompaniesPage';
import ShippingLinesPage from './pages/ShippingLinesPage';
import ClientsPage from './pages/ClientsPage';
import SuppliersPage from './pages/SuppliersPage';
import ServiceTypesPage from './pages/ServiceTypesPage';
import ReportsMovementsPage from './pages/ReportsMovementsPage';
import ReportsBillingPage from './pages/ReportsBillingPage';
import BillingPage from './pages/BillingPage';
import PhotoRegistriesPage from './pages/PhotoRegistriesPage';
import NewPhotoRegistryPage from './pages/NewPhotoRegistryPage';
import PhotoRegistryDetailPage from './pages/PhotoRegistryDetailPage';
import EditPhotoRegistryPage from './pages/EditPhotoRegistryPage';
import ContainerInspectionsPage from './pages/ContainerInspectionsPage';
import NewContainerInspectionPage from './pages/NewContainerInspectionPage';
import ContainerInspectionDetailPage from './pages/ContainerInspectionDetailPage';
import EditContainerInspectionPage from './pages/EditContainerInspectionPage';
import FlexTankPage from './pages/FlexTankPage';
import NewFlexTankMovementPage from './pages/NewFlexTankMovementPage';
import FlexTankMovementDetailPage from './pages/FlexTankMovementDetailPage';
import EditFlexTankMovementPage from './pages/EditFlexTankMovementPage';
import YardControlPage from './pages/YardControlPage';
import FleetPage from './pages/FleetPage';
import VehicleChecklistPage from './pages/VehicleChecklistPage';
import LoadingSchedulePage from './pages/LoadingSchedulePage';
import DailyRateRequestPage from './pages/DailyRateRequestPage';
import ExpenseReportsPage from './pages/ExpenseReportsPage';
import DeliveryStatusPage from './pages/DeliveryStatusPage';
import InternationalInvoicePage from './pages/InternationalInvoicePage';
import UnitSegregationPage from './pages/UnitSegregationPage';
import RPATerceiroPage from './pages/RPATerceiroPage';
import OrdemServicoPage from './pages/OrdemServicoPage';
import CompanySettingsPage from './pages/CompanySettingsPage';

function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
    <WebSocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/change-password" element={
            <ProtectedRoute>
              <ChangePasswordPage />
            </ProtectedRoute>
          } />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
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
              <ProtectedRoute>
                <MovementsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/movements/new"
            element={
              <ProtectedRoute>
                <NewMovementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/movements/:id"
            element={
              <ProtectedRoute>
                <MovementDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/movements/:id/edit"
            element={
              <ProtectedRoute>
                <EditMovementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/yard-control"
            element={
              <ProtectedRoute>
                <YardControlPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet"
            element={
              <ProtectedRoute>
                <FleetPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/rpa-terceiro"
            element={
              <ProtectedRoute adminOnly>
                <RPATerceiroPage rpaType="terceiro" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/ordem-servico"
            element={
              <ProtectedRoute>
                <OrdemServicoPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/fleet/checklist"
            element={
              <ProtectedRoute>
                <VehicleChecklistPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/drivers"
            element={
              <ProtectedRoute>
                <DriversPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/companies"
            element={
              <ProtectedRoute>
                <CompaniesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/company-settings"
            element={
              <ProtectedRoute>
                <CompanySettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/shipping-lines"
            element={
              <ProtectedRoute>
                <ShippingLinesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/clients"
            element={
              <ProtectedRoute>
                <ClientsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/suppliers"
            element={
              <ProtectedRoute>
                <SuppliersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/service-types"
            element={
              <ProtectedRoute>
                <ServiceTypesPage />
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
              <ProtectedRoute>
                <ReportsMovementsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/billing"
            element={
              <ProtectedRoute adminOnly>
                <ReportsBillingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/billing"
            element={
              <ProtectedRoute adminOnly>
                <BillingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/photo-registries"
            element={
              <ProtectedRoute>
                <PhotoRegistriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/photo-registries/new"
            element={
              <ProtectedRoute>
                <NewPhotoRegistryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/photo-registries/:id"
            element={
              <ProtectedRoute>
                <PhotoRegistryDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/photo-registries/:id/edit"
            element={
              <ProtectedRoute>
                <EditPhotoRegistryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-inspections"
            element={
              <ProtectedRoute>
                <ContainerInspectionsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-inspections/new"
            element={
              <ProtectedRoute>
                <NewContainerInspectionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-inspections/:id"
            element={
              <ProtectedRoute>
                <ContainerInspectionDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/container-inspections/:id/edit"
            element={
              <ProtectedRoute>
                <EditContainerInspectionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flex-tank"
            element={
              <ProtectedRoute>
                <FlexTankPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flex-tank/movements/new"
            element={
              <ProtectedRoute>
                <NewFlexTankMovementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flex-tank/movements/:id"
            element={
              <ProtectedRoute>
                <FlexTankMovementDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/flex-tank/movements/:id/edit"
            element={
              <ProtectedRoute>
                <EditFlexTankMovementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/loading-schedules"
            element={
              <ProtectedRoute>
                <LoadingSchedulePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/daily-rate-requests"
            element={
              <ProtectedRoute adminOnly>
                <DailyRateRequestPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/expense-reports"
            element={
              <ProtectedRoute adminOnly>
                <ExpenseReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/delivery-status"
            element={
              <ProtectedRoute>
                <DeliveryStatusPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/unit-segregation"
            element={
              <ProtectedRoute>
                <UnitSegregationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/international-invoices"
            element={
              <ProtectedRoute adminOnly>
                <InternationalInvoicePage />
              </ProtectedRoute>
            }
          />
        </Routes>
        <Toaster position="top-right" richColors />
      </BrowserRouter>
    </WebSocketProvider>
    </AuthProvider>
    </ThemeProvider>
  );
}

export default App;