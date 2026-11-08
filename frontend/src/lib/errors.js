// Texto do toast de erro: o motivo que o servidor mandou (ex.: "registro em
// uso") quando houver, senão a mensagem padrão da tela.
export function apiErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  // Validação do FastAPI (422) vem como lista em inglês; fica a mensagem da tela
  if (error && !error.response && error.request) {
    return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  }
  return fallback;
}
