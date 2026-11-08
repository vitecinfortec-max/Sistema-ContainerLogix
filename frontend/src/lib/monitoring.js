import { getTenantCode } from './tenant';

// Monitoramento de erros (Sentry): só liga com REACT_APP_SENTRY_DSN no build.
// O SDK vem da CDN oficial, versão fixa e conferida pelo hash (integrity),
// sem pacote no projeto. Cada erro leva a empresa (tag "empresa"); e-mail e
// IP dos usuários não são enviados.
const DSN = process.env.REACT_APP_SENTRY_DSN;
const SDK_URL = 'https://browser.sentry-cdn.com/8.55.0/bundle.min.js';
const SDK_INTEGRITY = 'sha384-BlRl+vkcjdIA/AKRb8zWtiqlVVXepUsSv0+vho7ZMUTsNudEyQjGUKo9W86Hc1EC';

export function startMonitoring() {
  if (!DSN || window.Sentry) return;
  const script = document.createElement('script');
  script.src = SDK_URL;
  script.integrity = SDK_INTEGRITY;
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    window.Sentry.init({
      dsn: DSN,
      environment: process.env.REACT_APP_SENTRY_ENVIRONMENT || 'producao',
      sendDefaultPii: false,
    });
    window.Sentry.setTag('empresa', getTenantCode() || window.location.host);
  };
  document.head.appendChild(script);
}

/** Erro já tratado pela tela (ex.: proteção contra tela branca) que deve chegar ao monitor. */
export function reportError(error, extra) {
  window.Sentry?.captureException?.(error, extra ? { extra } : undefined);
}
