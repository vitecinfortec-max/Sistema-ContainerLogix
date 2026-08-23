import { useEffect, useState } from 'react';
import { api } from './api';

// Mesmos valores padrão do backend (backend/reports.py DEFAULT_COMPANY) — usados
// enquanto "Dados da Empresa" ainda não foi preenchido, para o cabeçalho impresso
// no navegador nunca ficar em branco.
export const DEFAULT_COMPANY = {
  name: 'Sua Empresa',
  logo_filename: null,
};

// Busca os dados de "Dados da Empresa" para usar nos cabeçalhos impressos
// (Vistoria de Container, Movimentação, Registro Fotográfico), com fallback
// para os valores padrão em qualquer campo ainda não cadastrado.
export function useCompanySettings() {
  const [company, setCompany] = useState(DEFAULT_COMPANY);

  useEffect(() => {
    api.getCompanySettings()
      .then((res) => {
        const data = res.data || {};
        const filled = Object.fromEntries(Object.entries(data).filter(([, v]) => v));
        setCompany({ ...DEFAULT_COMPANY, ...filled });
      })
      .catch(() => {});
  }, []);

  return company;
}

export function getCompanyLogoUrl(company) {
  if (company?.logo_filename) {
    return api.getFileUrl(`/api/uploads/${company.logo_filename}`);
  }
  return '/logo-containerlogix.png';
}
