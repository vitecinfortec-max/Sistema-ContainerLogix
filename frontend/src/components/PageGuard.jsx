import { Component, createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import axios from 'axios';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './ui/button';
import { reportError } from '../lib/monitoring';

// Proteção do miolo de cada tela (envolve o conteúdo em components/Layout.js).
//
// 1. Falha de carregamento: toda leitura (GET) que a tela faz e que falha fica
//    anotada para a tela aberta. Enquanto houver falha, o <EmptyState> mostra
//    "Não foi possível carregar" com "Tentar novamente" em vez de "Nenhum
//    registro", e os indicadores mostram "—" em vez de 0, para a tela não
//    dizer que está vazia quando na verdade o servidor não respondeu.
//    "Tentar novamente" remonta a tela, que refaz todas as leituras.
// 2. Erro de JavaScript: em vez de a tela inteira ficar branca, só o miolo
//    mostra o aviso; o menu e o cabeçalho continuam funcionando.

// Leituras do próprio sistema (menu, sino, busca, sessão) e consultas avulsas
// (CEP/CNPJ) não contam como carregamento da tela.
const IGNORED = ['/auth/', '/module-config', '/company-settings', '/alerts/summary', '/search', '/lookup/'];

let generation = 0;
let failures = new Map(); // caminho da requisição -> status
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

const pathOf = (url = '') => {
  try { return new URL(url, window.location.origin).pathname; } catch (e) { return url; }
};

const counts = (config) => {
  if (!config || (config.method || 'get').toLowerCase() !== 'get') return false;
  if (config.skipLoadError) return false;
  if (config.responseType === 'blob' || config.responseType === 'arraybuffer') return false;
  const path = pathOf(config.url);
  return !IGNORED.some((p) => path.includes(p));
};

axios.interceptors.request.use((config) => {
  config._pageGeneration = generation;
  return config;
});

axios.interceptors.response.use(
  (response) => {
    const { config } = response;
    if (counts(config) && config._pageGeneration === generation && failures.has(pathOf(config.url))) {
      failures = new Map(failures);
      failures.delete(pathOf(config.url));
      notify();
    }
    return response;
  },
  (error) => {
    const { config } = error || {};
    const status = error?.response?.status;
    if (!axios.isCancel(error) && status !== 401 && counts(config) && config._pageGeneration === generation) {
      failures = new Map(failures);
      failures.set(pathOf(config.url), status || 0);
      notify();
    }
    return Promise.reject(error);
  },
);

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => failures;

const LoadErrorContext = createContext({ failed: false, retry: null });

/** `{ failed, retry }` da tela aberta: usado pelo EmptyState e pelo StatCard. */
export function useLoadError() {
  return useContext(LoadErrorContext);
}

class CrashBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    console.error('Erro na tela:', error, info?.componentStack);
    reportError(error, { componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-card px-6 py-14 text-center" role="alert" data-testid="page-crash">
        <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-500" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Esta tela encontrou um erro e não pôde ser exibida</p>
        <p className="text-xs mt-1 text-slate-500 dark:text-slate-400">O restante do sistema continua funcionando. Se o erro se repetir, avise o suporte.</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" onClick={this.props.onRetry} data-testid="page-crash-retry">
            <RotateCw className="w-4 h-4 mr-1.5" />
            Tentar novamente
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { window.location.href = '/dashboard'; }}>
            Ir para o início
          </Button>
        </div>
      </div>
    );
  }
}

export function PageGuard({ children }) {
  const [attempt, setAttempt] = useState(0);
  const current = useSyncExternalStore(subscribe, snapshot);

  // Cada tela começa sem falhas anotadas. Precisa ser no render (e não num
  // efeito), porque os efeitos dos filhos, que fazem as leituras, rodam antes
  // dos efeitos do pai. O componente é remontado a cada troca de tela.
  const [startedAt] = useState(() => {
    generation += 1;
    failures = new Map();
    return generation;
  });
  useEffect(() => () => {
    if (generation === startedAt) { failures = new Map(); notify(); }
  }, [startedAt]);

  const retry = () => {
    generation += 1;
    failures = new Map();
    notify();
    setAttempt((n) => n + 1);
  };

  return (
    <LoadErrorContext.Provider value={{ failed: current.size > 0, retry }}>
      <CrashBoundary key={attempt} onRetry={retry}>
        {children}
      </CrashBoundary>
    </LoadErrorContext.Provider>
  );
}
