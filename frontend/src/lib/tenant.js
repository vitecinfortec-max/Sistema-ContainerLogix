import axios from 'axios';

// Multi-cliente: um mesmo servidor atende várias empresas, e toda chamada
// diz de qual empresa ela é.
// - No navegador, pelo endereço aberto (ja.containerlogix.com.br...): o
//   servidor sabe de qual empresa é cada endereço (cabeçalho X-Tenant-Host).
// - No app do celular (sempre "localhost") a pessoa informa o "Código da
//   empresa" na tela de login; ele fica salvo neste aparelho (X-Tenant).
// Com o servidor de uma empresa só (como hoje), os cabeçalhos são ignorados.
const STORAGE_KEY = 'tenantCode';

export function getTenantCode() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function setTenantCode(code) {
  const clean = String(code || '').trim().toLowerCase();
  try {
    if (clean) localStorage.setItem(STORAGE_KEY, clean);
    else localStorage.removeItem(STORAGE_KEY);
  } catch (e) { /* sem storage: vale só nesta sessão */ }
  applyTenantHeaders(clean);
}

export function applyTenantHeaders(code = getTenantCode()) {
  const common = axios.defaults.headers.common;
  if (code) {
    common['X-Tenant'] = code;
    delete common['X-Tenant-Host'];
  } else {
    common['X-Tenant-Host'] = window.location.host;
    delete common['X-Tenant'];
  }
}

applyTenantHeaders();
