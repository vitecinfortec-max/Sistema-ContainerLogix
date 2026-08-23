import { createContext, useContext, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

const ThemeContext = createContext();

const STORAGE_KEY = 'theme';

const getInitialTheme = () => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  // No app Android, ignora o tema do sistema do aparelho e começa sempre claro
  // (aparência de marca consistente) - o usuário ainda pode trocar manualmente
  // pelo botão de tema, e a escolha fica salva normalmente depois disso.
  if (Capacitor.isNativePlatform()) return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
