import { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';
import '../lib/tenant'; // empresa em toda chamada (multi-cliente)

const AuthContext = createContext();

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Sessão expirada ou token inválido: limpa a sessão e manda pro login a partir de
// qualquer tela. Fica aqui (fora de componente) porque chamadas de API disparam de
// qualquer lugar do app, não só de dentro da árvore React.
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || '';
    const isAuthFlow = ['/auth/login', '/auth/forgot-password', '/auth/reset-password'].some((p) => url.includes(p));
    if (status === 401 && !isAuthFlow) {
      sessionStorage.removeItem('token');
      delete axios.defaults.headers.common['Authorization'];
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Token que api.getFileUrl acrescenta à URL dos anexos. Buscado antes de a
// tela ser liberada, pra nenhuma imagem ser pedida sem ele; se falhar, o app
// segue normalmente (só os anexos restritos deixam de abrir).
const loadFileToken = async () => {
  try {
    const response = await axios.get(`${API}/auth/file-token`);
    sessionStorage.setItem('fileToken', response.data.file_token);
  } catch (error) {
    sessionStorage.removeItem('fileToken');
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(sessionStorage.getItem('token'));

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchUser();
    } else {
      setLoading(false);
    }
  }, [token]);

  const fetchUser = async () => {
    try {
      const response = await axios.get(`${API}/auth/me`);
      await loadFileToken();
      setUser(response.data);
    } catch (error) {
      console.error('Error fetching user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const response = await axios.post(`${API}/auth/login`, { email, password });
    const { access_token, user: userData } = response.data;
    sessionStorage.setItem('token', access_token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    await loadFileToken();
    setToken(access_token);
    setUser(userData);
    return userData;
  };

  // Troca o token da sessão em andamento - a troca de senha encerra o token
  // antigo no backend e devolve um novo.
  const updateToken = (newToken) => {
    sessionStorage.setItem('token', newToken);
    axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    setToken(newToken);
  };

  const logout = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('fileToken');
    setToken(null);
    setUser(null);
    delete axios.defaults.headers.common['Authorization'];
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, updateToken, loading, token, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};