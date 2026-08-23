import { useEffect } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';

// Mesma API de antes (isConnected, markPendingDelete, markPendingCreate,
// clearPending, forceRefresh) - agora só se inscreve na conexão única mantida
// pelo WebSocketProvider (ver context/WebSocketContext.js) em vez de abrir uma
// conexão própria. Layout, Dashboard e Movimentações continuam chamando
// useWebSocket(onMessage) exatamente como antes, sem nenhuma mudança neles.
export function useWebSocket(onMessage) {
  const ctx = useWebSocketContext();

  useEffect(() => {
    if (!ctx || !onMessage) return undefined;
    return ctx.subscribe(onMessage);
  }, [ctx, onMessage]);

  if (!ctx) {
    // Só ocorre se algum componente usar o hook fora do WebSocketProvider.
    return {
      isConnected: false,
      markPendingDelete: () => {},
      markPendingCreate: () => {},
      clearPending: () => {},
      forceRefresh: async () => {}
    };
  }

  const { isConnected, markPendingDelete, markPendingCreate, clearPending, forceRefresh } = ctx;
  return { isConnected, markPendingDelete, markPendingCreate, clearPending, forceRefresh };
}

export default useWebSocket;
