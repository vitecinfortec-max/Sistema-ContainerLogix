import { useEffect, useRef, useCallback, useState } from 'react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const WS_BASE_URL = BACKEND_URL
  ? BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws'
  : (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
const API_URL = BACKEND_URL || '';

// O feed em tempo real transmite dados operacionais (motorista, contêiner,
// cliente) a cada movimentação — o backend agora exige o mesmo token JWT da
// API, passado por query string já que o WebSocket do navegador não permite
// cabeçalhos customizados no handshake. Lido a cada tentativa de conexão (não
// numa constante do módulo) porque o token pode mudar entre login/logout.
const getWsUrl = () => {
  const token = localStorage.getItem('token');
  return token ? `${WS_BASE_URL}?token=${encodeURIComponent(token)}` : null;
};

export function useWebSocket(onMessage) {
  const ws = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeout = useRef(null);
  const pingInterval = useRef(null);
  const pollingInterval = useRef(null);
  const lastMovementsHash = useRef('');
  const usePolling = useRef(false);
  const pendingDeletes = useRef(new Set()); // IDs que estão sendo deletados
  const pendingCreates = useRef(new Set()); // IDs que estão sendo criados

  // Métodos para marcar operações pendentes (expostos via return)
  const markPendingDelete = useCallback((id) => {
    pendingDeletes.current.add(id);
    // Limpar após 10 segundos (timeout de segurança)
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
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const response = await fetch(`${API_URL}/api/movements`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          let movements = await response.json();
          
          // Filtrar movimentações que estão sendo deletadas
          movements = movements.filter(m => !pendingDeletes.current.has(m.id));
          
          const newHash = JSON.stringify(movements.map(m => m.id).sort());
          
          // Notificar se houver mudança
          if (lastMovementsHash.current !== newHash) {
            if (onMessage) {
              onMessage({ type: 'DATA_CHANGED', data: movements });
            }
            lastMovementsHash.current = newHash;
          }
        }
      } catch (error) {
        console.error('Erro no polling:', error);
      }
    };
    
    // Executar imediatamente e depois a cada 3 segundos
    poll();
    pollingInterval.current = setInterval(poll, 3000);
  }, [onMessage]);

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

      // Timeout para fallback
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
        
        // Parar polling se estava ativo
        if (pollingInterval.current) {
          clearInterval(pollingInterval.current);
          pollingInterval.current = null;
        }
        
        // Enviar ping a cada 30 segundos para manter conexão
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
          if (onMessage) {
            onMessage(message);
          }
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
          // Tentar reconectar após 3 segundos ou usar polling
          reconnectTimeout.current = setTimeout(() => {
            console.log('Tentando reconectar WebSocket...');
            connect();
          }, 3000);
        }
      };

      ws.current.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.error('Erro WebSocket:', error);
        // Fallback para polling
        if (!usePolling.current) {
          startPolling();
        }
      };
    } catch (error) {
      console.error('Erro ao conectar WebSocket:', error);
      startPolling();
    }
  }, [onMessage, startPolling]);

  // Forçar atualização (útil após criar/deletar)
  const forceRefresh = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      
      const response = await fetch(`${API_URL}/api/movements`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        let movements = await response.json();
        movements = movements.filter(m => !pendingDeletes.current.has(m.id));
        
        const newHash = JSON.stringify(movements.map(m => m.id).sort());
        lastMovementsHash.current = newHash;
        
        if (onMessage) {
          onMessage({ type: 'DATA_CHANGED', data: movements });
        }
      }
    } catch (error) {
      console.error('Erro ao forçar refresh:', error);
    }
  }, [onMessage]);

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
  }, [connect]);

  return { 
    isConnected, 
    markPendingDelete, 
    markPendingCreate, 
    clearPending,
    forceRefresh 
  };
}

export default useWebSocket;
