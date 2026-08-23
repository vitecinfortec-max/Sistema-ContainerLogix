import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useModuleConfig } from '../context/ModuleConfigContext';

export default function ProtectedRoute({ children, adminOnly = false, superadminOnly = false, moduleKey }) {
  const { isAuthenticated, loading, user } = useAuth();
  const { isModuleEnabled, loaded: modulesLoaded } = useModuleConfig();

  if (loading || (isAuthenticated && moduleKey && !modulesLoaded)) {
    return (
      <div className="flex items-center justify-center min-h-screen" data-testid="loading-spinner">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" />;
  if (adminOnly && user?.role !== 'admin') return <Navigate to="/dashboard" />;
  if (superadminOnly && !user?.is_superadmin) return <Navigate to="/dashboard" />;
  // Módulo ainda não contratado pelo cliente - o backend também bloqueia a
  // API, isso aqui só evita mostrar a tela vazia/quebrada por trás.
  if (moduleKey && !isModuleEnabled(moduleKey)) return <Navigate to="/dashboard" />;

  return children;
}