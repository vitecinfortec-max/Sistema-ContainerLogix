import { useEffect, useState } from 'react';

// Espera o usuário parar de digitar antes de consultar o servidor: as listas
// filtram sozinhas enquanto se digita, sem botão "Filtrar".
export function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default useDebouncedValue;
