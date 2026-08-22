// Ponto de entrada do app Android offline: sem login, sem servidor — só os 3
// módulos habilitados (Movimentação, Vistoria, Cadastros Básicos) + Backup,
// gravando tudo em SQLite local (ver ../lib/offlineDb.js).
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '../components/ui/sonner';
import OfflineLayout from './OfflineLayout';
import OfflineHomePage from './OfflineHomePage';
import OfflineMovementsPage from './OfflineMovementsPage';
import OfflineInspectionsPage from './OfflineInspectionsPage';
import OfflineRegistriesPage from './OfflineRegistriesPage';
import OfflineBackupPage from './OfflineBackupPage';

export default function OfflineApp() {
  return (
    <HashRouter>
      <OfflineLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<OfflineHomePage />} />
          <Route path="/movements" element={<OfflineMovementsPage />} />
          <Route path="/inspections" element={<OfflineInspectionsPage />} />
          <Route path="/registries" element={<OfflineRegistriesPage />} />
          <Route path="/backup" element={<OfflineBackupPage />} />
        </Routes>
      </OfflineLayout>
      <Toaster position="top-right" richColors />
    </HashRouter>
  );
}
