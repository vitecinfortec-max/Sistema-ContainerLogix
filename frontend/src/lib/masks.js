// Máscaras de digitação usadas nos formulários (CPF, CNPJ, telefone, CEP e
// placa). Recebem o texto digitado e devolvem o texto já formatado.

export const formatCPF = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

export const formatCNPJ = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

// Campo único "CNPJ ou CPF": máscara de CPF até 11 dígitos (senão um CPF
// saía formatado como CNPJ, ex. "026.496.043/28" em vez de "026.496.043-28"),
// e de CNPJ a partir do 12º.
export const formatCnpjCpf = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 11 ? formatCNPJ(value) : formatCPF(value);
};

export const formatPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  // Fixo (10 dígitos): (85) 3456-7890 · Celular (11): (85) 98765-4321
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

export const formatCEP = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

/** Placa sem traço/espaço, para comparar "ABC1D23" com "ABC-1D23". */
export const plateKey = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Placa com o traço depois das 3 letras: ABC-1234 (antiga) ou ABC-1D23
// (Mercosul). Só formata o que tem cara de placa (3 letras + número); um
// código de equipamento como "EMPILHADEIRA 02" fica como foi digitado.
const PLATE_START = /^[A-Z]{3}[0-9]/;

export const formatPlate = (value) => {
  const text = String(value || '').toUpperCase();
  const key = plateKey(text);
  if (!PLATE_START.test(key) || key.length > 7) return text;
  return `${key.slice(0, 3)}-${key.slice(3)}`;
};
