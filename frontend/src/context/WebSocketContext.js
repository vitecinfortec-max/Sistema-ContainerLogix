import { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';

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
  const lastMovementsHash = useRef('');
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

    const poll = async () => {
      try {
        const token = sessionStorage.getItem('token');
        if (!token) return;

        const response = await fetch(`${API_URL}/api/movements`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          let movements = await response.json();
          movements = movements.filter(m => !pendingDeletes.current.has(m.id));

          const newHash = JSON.stringify(movements.map(m => m.id).sort());

          if (lastMovementsHash.current !== newHash) {
            notifyListeners({ type: 'DATA_CHANGED', data: movements });
            lastMovementsHash.current = newHash;
          }
        }
      } catch (error) {
        console.error('Erro no polling:', error);
      }
    };

    poll();
    pollingInterval.current = setInterval(poll, 3000);
  }, [notifyListeners]);

  const connect = useCallback(() => {
    try {
      if (ws.current?.readyState === WebSocket.OPEN) {
        return;
      }

      const wsUrl = getWsUrl();
      if (!wsUrl) {
        // Sem token (usuário deslogado) — nada a sincronizar em tempo real ainda.
        return;
      }

      ws.current = new WebSocket(wsUrl);

      const connectionTimeout = setTimeout(() => {
        if (ws.current?.readyState !== WebSocket.OPEN) {
          console.log('WebSocket timeout - usando polling');
          ws.current?.close();
          startPolling();
        }
      }, 5000);

      ws.current.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket conectado');
        setIsConnected(true);
        usePolling.current = false;

        if (pollingInterval.current) {
          clearInterval(pollingInterval.current);
          pollingInterval.current = null;
        }

        pingInterval.current = setInterval(() => {
          if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send('ping');
          }
        }, 30000);
      };

      ws.current.onmessage = (event) => {
        if (event.data === 'pong') return;

        try {
          const message = JSON.parse(event.data);
          notifyListeners(message);
        } catch (error) {
          console.error('Erro ao parsear mensagem WebSocket:', error);
        }
      };

      ws.current.onclose = () => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket desconectado');
        setIsConnected(usePolling.current);
        clearInterval(pingInterval.current);

        if (!usePolling.current) {
          reconnectTimeout.current = setTimeout(() => {
            console.log('Tentando reconectar WebSocket...');
            connect();
          }, 3000);
        }
      };

      ws.current.onerror = (error) => {
        clearTimeout(connectionTimeout);
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
    try {
      const token = sessionStorage.getItem('token');
      if (!token) return;

      const response = await fetch(`${API_URL}/api/movements`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        let movements = await response.json();
        movements = movements.filter(m => !pendingDeletes.current.has(m.id));

        const newHash = JSON.stringify(movements.map(m => m.id).sort());
        lastMovementsHash.current = newHash;

        notifyListeners({ type: 'DATA_CHANGED', data: movements });
      }
    } catch (error) {
      console.error('Erro ao forçar refresh:', error);
    }
  }, [notifyListeners]);

  useEffect(() => {
    connect();

    return () => {
      clearTimeout(reconnectTimeout.current);
      clearInterval(pingInterval.current);
      clearInterval(pollingInterval.current);
      if (ws.current) {
        ws.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
