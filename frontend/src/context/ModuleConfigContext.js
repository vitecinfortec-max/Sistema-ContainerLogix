import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';

const ModuleConfigContext = createContext();

// Controla quais grupos/itens do menu estão liberados nesta instância -
// permite ao dono do sistema (superadmin) bloquear módulos que o cliente
// ainda não contratou, e liberar aos poucos conforme ele for contratando.
export const ModuleConfigProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [disabledModules, setDisabledModules] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await api.getModuleConfig();
      setDisabledModules(response.data.disabled_modules || []);
    } catch (error) {
      // Se falhar, não bloqueia nada por segurança contra travar o app -
      // o backend ainda aplica a trava real em cada rota de qualquer forma.
      setDisabledModules([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      reload();
    } else {
      setDisabledModules([]);
      setLoaded(false);
    }
  }, [isAuthenticated, reload]);

  const isModuleEnabled = (moduleKey) => {
    if (!moduleKey) return true;
    const group = moduleKey.split('.')[0];
    if (disabledModules.includes(group)) return false;
    if (disabledModules.includes(moduleKey)) return false;
    return true;
  };

  return (
    <ModuleConfigContext.Provider value={{ disabledModules, isModuleEnabled, loaded, reload }}>
      {children}
    </ModuleConfigContext.Provider>
  );
};

export const useModuleConfig = () => {
  const context = useContext(ModuleConfigContext);
  if (!context) {
    throw new Error('useModuleConfig must be used within a ModuleConfigProvider');
  }
  return context;
};
