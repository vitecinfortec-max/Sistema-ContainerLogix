import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from './ui/alert-dialog';

// Aviso de alterações não salvas, valendo pro sistema todo sem mexer em cada
// tela. Digitar num formulário da página (dentro de <form> ou de um
// FormSection) ou dentro de uma janela marca aquilo como alterado; qualquer
// gravação que dá certo no servidor (POST/PUT/PATCH/DELETE) limpa a marca.
// Com a marca: sair pelo menu, pelo Voltar do cabeçalho, recarregar ou
// fechar a aba pergunta antes; numa janela, Esc, clique fora e o X também.
// Fechar a janela pelo próprio código (depois de salvar) nunca pergunta.
// [data-unsaved-ignore] tira um trecho da conta (ex.: parâmetros de relatório).

let pageDirty = false;
const dirtyDialogs = new WeakSet();
let ask = null; // abre o diálogo de confirmação (montado pelo UnsavedChangesGuard)

const PAGE_SCOPE = 'form, [data-unsaved-guard]';

function markFromEvent(event) {
  const el = event.target;
  if (!(el instanceof Element) || el.closest('[data-unsaved-ignore]')) return;
  if (!el.matches('input, textarea, select, [contenteditable="true"]')) return;
  const dialog = el.closest('[role="dialog"]');
  if (dialog) {
    dirtyDialogs.add(dialog);
    return;
  }
  if (el.closest('main') && el.closest(PAGE_SCOPE)) pageDirty = true;
}

function clearAll() {
  pageDirty = false;
  document.querySelectorAll('[role="dialog"]').forEach((d) => dirtyDialogs.delete(d));
}

/** Pergunta se pode descartar; resolve true sem perguntar quando não há alteração. */
export function confirmLeavePage() {
  if (!pageDirty || !ask) return Promise.resolve(true);
  return ask().then((ok) => {
    if (ok) pageDirty = false;
    return ok;
  });
}

export function isDialogDirty(dialogEl) {
  return !!dialogEl && dirtyDialogs.has(dialogEl);
}

export function confirmCloseDialog(dialogEl) {
  if (!isDialogDirty(dialogEl) || !ask) return Promise.resolve(true);
  return ask().then((ok) => {
    if (ok) dirtyDialogs.delete(dialogEl);
    return ok;
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('input', markFromEvent, true);
  document.addEventListener('change', markFromEvent, true);
  axios.interceptors.response.use((response) => {
    const method = (response.config?.method || 'get').toLowerCase();
    if (method !== 'get' && method !== 'head') clearAll();
    return response;
  });
}

export function UnsavedChangesGuard() {
  const [pending, setPending] = useState(null); // resolve da pergunta aberta
  const returnFocus = useRef(null); // campo em edição, pra voltar a ele em "Continuar editando"
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    ask = () => new Promise((resolve) => {
      returnFocus.current = document.activeElement;
      setPending(() => resolve);
    });
    return () => { ask = null; };
  }, []);

  // Trocou de tela (pelo próprio código ou depois de confirmar): marca zerada
  useEffect(() => { pageDirty = false; }, [location.pathname]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!pageDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    // Links internos (menu lateral, atalhos): segura o clique e pergunta
    const onClick = (event) => {
      if (!pageDirty || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element && event.target.closest('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      confirmLeavePage().then((ok) => { if (ok) navigate(url.pathname + url.search + url.hash); });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [navigate]);

  const settle = (value) => {
    pending?.(value);
    setPending(null);
  };

  return (
    <AlertDialog open={!!pending} onOpenChange={(open) => { if (!open) settle(false); }}>
      <AlertDialogContent
        data-testid="unsaved-changes-dialog"
        onCloseAutoFocus={(event) => {
          const el = returnFocus.current;
          returnFocus.current = null;
          if (el && el.isConnected && el !== document.body) {
            event.preventDefault();
            el.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Alterações Não Salvas</AlertDialogTitle>
          <AlertDialogDescription>Há alterações que ainda não foram salvas. Deseja realmente sair e descartá-las?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)} data-testid="unsaved-stay">Continuar editando</AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)} data-testid="unsaved-discard">Sair sem salvar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
