import { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import { useAuth } from './AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const WS_BASE_URL = BACKEND_URL
  ? BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws'
  : (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
const API_URL = BACKEND_URL || '';

// O feed em tempo real transmite dados operacionais (motorista, contêiner,
// cliente) a cada movimentação — o backend exige o mesmo token JWT da API,
// passado por query string já que o WebSocket do navegador não permite
// cabeçalhos customizados no handshake. Lido a cada tentativa de conexão (não
// numa constante do módulo) porque o token pode mudar entre login/logout.
const getWsUrl = () => {
  const token = sessionStorage.getItem('token');
  return token ? `${WS_BASE_URL}?token=${encodeURIComponent(token)}` : null;
};

const WebSocketContext = createContext(null);

// Mantém UMA única conexão (WebSocket ou polling de fallback) para o app inteiro.
// Antes, cada página que chamava useWebSocket() abria sua própria conexão -
// Layout, Dashboard e Movimentações ficavam com 3 conexões simultâneas, cada
// uma com seu próprio ping (30s) e fallback de polling (3s) rodando em paralelo.
// Agora o Provider fica uma vez no topo do app (App.js) e cada chamador só se
// inscreve para receber as mensagens, sem abrir nada novo.
export function WebSocketProvider({ children }) {
  const ws = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeout = useRef(null);
  const pingInterval = useRef(null);
  const pollingInterval = useRef(null);
  const lastSyncState = useRef(null);
  // Sessão encerrada pelo próprio app (logout/troca de token) ou recusada pelo
  // servidor (código 1008) - nesses casos o onclose não deve tentar reconectar.
  const stopped = useRef(true);
  const { token } = useAuth();
  const usePolling = useRef(false);
  const pendingDeletes = useRef(new Set());
  const pendingCreates = useRef(new Set());
  const listeners = useRef(new Set());

  const notifyListeners = useCallback((message) => {
    listeners.current.forEach((listener) => {
      try {
        listener(message);
      } catch (error) {
        console.error('Erro em listener de WebSocket:', error);
      }
    });
  }, []);

  const subscribe = useCallback((listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const markPendingDelete = useCallback((id) => {
    pendingDeletes.current.add(id);
    setTimeout(() => pendingDeletes.current.delete(id), 10000);
  }, []);

  const markPendingCreate = useCallback((id) => {
    pendingCreates.current.add(id);
    setTimeout(() => pendingCreates.current.delete(id), 10000);
  }, []);

  const clearPending = useCallback((id) => {
    pendingDeletes.current.delete(id);
    pendingCreates.current.delete(id);
  }, []);

  // Fallback para polling se WebSocket não funcionar
  const startPolling = useCallback(() => {
    if (pollingInterval.current) return;

    console.log('Iniciando polling como fallback...');
    usePolling.current = true;
    setIsConnected(true);

    // Consulta só um resumo barato (quantidade + data da última alteração) a
    // cada ciclo e avisa as telas quando ele muda - antes o histórico inteiro
    // era transferido a cada 3s, e a comparação só por IDs deixava passar as
    // edições.
    const poll = async () => {
      try {
        const token = sessionStorage.getItem('token');
        if (!token) return;
        const headers = { 'Authorization': `Bearer ${token}` };

        const stateResponse = await fetch(`${API_URL}/api/movements/sync-state`, { headers });
        if (stateResponse.status === 401 || stateResponse.status === 403) {
          // Sessão inválida ou módulo indisponível - não adianta insistir.
          clearInterval(pollingInterval.current);
          pollingInterval.current = null;
          usePolling.current = false;
          setIsConnected(false);
          return;
        }
        if (!stateResponse.ok) return;

        const syncState = JSON.stringify(await stateResponse.json());
        if (lastSyncState.current === syncState) return;
        const isFirstCheck = lastSyncState.current === null;
        lastSyncState.current = syncState;
        // Na primeira consulta só guarda a referência: a página já carregou
        // a lista por conta própria.
        if (isFirstCheck) return;

        // Só avisa que mudou: cada tela recarrega o que ela mesma mostra
        // (a de Movimentações busca de novo só a página atual da lista).
        notifyListeners({ type: 'DATA_CHANGED' });
      } catch (error) {
        console.error('Erro no polling:', error);
      }
    };

    poll();
    pollingInterval.current = setInterval(poll, 3000);
  }, [notifyListeners]);

  const connect = useCallback(() => {
    try {
      if (stopped.current || ws.current?.readyState === WebSocket.OPEN) {
        return;
      }

      const wsUrl = getWsUrl();
      if (!wsUrl) {
        // Sem token (usuário deslogado) — nada a sincronizar em tempo real ainda.
        return;
      }

      const socket = new WebSocket(wsUrl);
      ws.current = socket;

      const connectionTimeout = setTimeout(() => {
        if (stopped.current || ws.current !== socket) return;
        if (socket.readyState !== WebSocket.OPEN) {
          console.log('WebSocket timeout - usando polling');
          socket.close();
          startPolling();
        }
      }, 5000);

      socket.onopen = () => {
        clearTimeout(connectionTimeout);
        if (stopped.current || ws.current !== socket) return;
        console.log('WebSocket conectado');
        setIsConnected(true);
        usePolling.current = false;

        if (pollingInterval.current) {
          clearInterval(pollingInterval.current);
          pollingInterval.current = null;
        }

        clearInterval(pingInterval.current);
        pingInterval.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send('ping');
          }
        }, 30000);
      };

      socket.onmessage = (event) => {
        if (event.data === 'pong') return;

        try {
          const message = JSON.parse(event.data);
          notifyListeners(message);
        } catch (error) {
          console.error('Erro ao parsear mensagem WebSocket:', error);
        }
      };

      socket.onclose = (event) => {
        clearTimeout(connectionTimeout);
        // Conexão antiga (já substituída) ou encerrada pelo próprio app.
        if (stopped.current || ws.current !== socket) return;
        console.log('WebSocket desconectado');
        clearInterval(pingInterval.current);

        // 1008: o servidor recusou a sessão (token expirado, conta desativada
        // ou módulo indisponível) - reconectar com o mesmo token não resolve.
        if (event.code === 1008) {
          stopped.current = true;
          clearInterval(pollingInterval.current);
          pollingInterval.current = null;
          usePolling.current = false;
          setIsConnected(false);
          return;
        }
        setIsConnected(usePolling.current);

        if (!usePolling.current) {
          reconnectTimeout.current = setTimeout(() => {
            console.log('Tentando reconectar WebSocket...');
            connect();
          }, 3000);
        }
      };

      socket.onerror = (error) => {
        clearTimeout(connectionTimeout);
        if (stopped.current || ws.current !== socket) return;
        console.error('Erro WebSocket:', error);
        if (!usePolling.current) {
          startPolling();
        }
      };
    } catch (error) {
      console.error('Erro ao conectar WebSocket:', error);
      startPolling();
    }
  }, [startPolling, notifyListeners]);

  const forceRefresh = useCallback(async () => {
    notifyListeners({ type: 'DATA_CHANGED' });
  }, [notifyListeners]);

  // A conexão acompanha a sessão: abre quando há token (inclusive logo após o
  // login, sem precisar recarregar a página) e fecha no logout. Antes só
  // tentava conectar uma vez, ao montar o app - quem abria o sistema deslogado
  // ficava sem tempo real até dar F5.
  useEffect(() => {
    if (!token) return undefined;

    stopped.current = false;
    connect();

    return () => {
      stopped.current = true;
      clearTimeout(reconnectTimeout.current);
      clearInterval(pingInterval.current);
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
      usePolling.current = false;
      lastSyncState.current = null;
      if (ws.current) {
        ws.current.close();
        ws.current = null;
      }
      setIsConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const value = {
    isConnected,
    subscribe,
    markPendingDelete,
    markPendingCreate,
    clearPending,
    forceRefresh
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketContext() {
  return useContext(WebSocketContext);
}
