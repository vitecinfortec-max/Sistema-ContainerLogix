import { useCallback, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '../components/ui/alert-dialog';

// Substitui window.confirm por um dialog no estilo do app, mantendo a mesma
// API assíncrona (await confirm('mensagem') -> true/false).
export function useConfirm() {
  const [state, setState] = useState({ open: false, title: 'Confirmar ação', message: '' });
  const resolveRef = useRef(null);

  const confirm = useCallback((message, title = 'Confirmar ação') => {
    setState({ open: true, title, message });
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = (value) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setState((s) => ({ ...s, open: false }));
  };

  const ConfirmDialog = () => (
    <AlertDialog open={state.open} onOpenChange={(open) => { if (!open) settle(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.title}</AlertDialogTitle>
          <AlertDialogDescription>{state.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>Confirmar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, ConfirmDialog };
}
