import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useModuleConfig } from '../context/ModuleConfigContext';

export default function ProtectedRoute({ children, adminOnly = false, superadminOnly = false, moduleKey }) {
  const { isAuthenticated, loading, user } = useAuth();
  const { isModuleEnabled, loaded: modulesLoaded } = useModuleConfig();
  const location = useLocation();

  if (loading || (isAuthenticated && moduleKey && !modulesLoaded)) {
    return (
      <div className="flex items-center justify-center min-h-screen" data-testid="loading-spinner">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" />;
  // Senha provisória pendente: o backend recusa qualquer outra rota até a
  // troca, então a única tela que funciona é a de trocar a senha.
  if (user?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (adminOnly && user?.role !== 'admin') return <Navigate to="/dashboard" />;
  if (superadminOnly && !user?.is_superadmin) return <Navigate to="/dashboard" />;
  // Módulo ainda não contratado pelo cliente - o backend também bloqueia a
  // API, isso aqui só evita mostrar a tela vazia/quebrada por trás.
  if (moduleKey && !isModuleEnabled(moduleKey)) return <Navigate to="/dashboard" />;

  return children;
}