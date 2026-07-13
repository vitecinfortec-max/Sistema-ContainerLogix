import { useState, useEffect, useCallback } from 'react';

export function useNotifications() {
  const [permission, setPermission] = useState('default');
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported('Notification' in window && 'serviceWorker' in navigator);
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!isSupported) return false;

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === 'granted';
    } catch (error) {
      console.error('Erro ao solicitar permissão de notificação:', error);
      return false;
    }
  }, [isSupported]);

  const showNotification = useCallback(async (title, body, url = '/movements') => {
    if (!isSupported || permission !== 'granted') {
      console.log('Notificações não permitidas');
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      
      if (registration.active) {
        registration.active.postMessage({
          type: 'SHOW_NOTIFICATION',
          title,
          body,
          url
        });
        return true;
      }
      
      // Fallback para notificação direta
      new Notification(title, {
        body,
        icon: '/logo192.png',
        badge: '/logo192.png'
      });
      return true;
    } catch (error) {
      console.error('Erro ao mostrar notificação:', error);
      return false;
    }
  }, [isSupported, permission]);

  const notifyNewMovement = useCallback((movement) => {
    const operationType = movement.operation_type === 'ENTRADA' ? 'Entrada' : 'Saída';
    const title = `Nova ${operationType} Registrada`;
    const body = `Container: ${movement.container_number}\nMotorista: ${movement.driver_name}\nStatus: ${movement.status}`;
    
    return showNotification(title, body, `/movements/${movement.id}`);
  }, [showNotification]);

  return {
    permission,
    isSupported,
    requestPermission,
    showNotification,
    notifyNewMovement
  };
}

export default useNotifications;
