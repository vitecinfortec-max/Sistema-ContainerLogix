// Opções e conversões compartilhadas pelas telas Fiscal (Configuração Fiscal
// e CT-e). O backend guarda os endereços no formato do layout fiscal
// (logradouro/numero/bairro/cep/cidade/uf); o componente AddressFields usa
// street/number/neighborhood/zip/city/state - daí as duas funções abaixo. O
// código IBGE do município é resolvido pelo servidor (cidade + UF).

export const CRT_OPTIONS = [
  ['1', '1 - Simples Nacional'],
  ['2', '2 - Simples Nacional (excesso de sublimite)'],
  ['3', '3 - Regime Normal'],
  ['4', '4 - MEI'],
];

export const AMBIENTE_OPTIONS = [
  ['homologacao', 'Homologação (testes, sem valor fiscal)'],
  ['producao', 'Produção'],
];

export const ICMS_CST_OPTIONS = [
  ['00', '00 - Tributação normal'],
  ['40', '40 - Isenção'],
  ['41', '41 - Não tributado'],
  ['51', '51 - Diferimento'],
  ['60', '60 - Cobrado por substituição tributária'],
  ['90', '90 - Outros'],
  ['SN', 'Simples Nacional'],
];
export const ICMS_WITH_RATE = ['00', '60', '90'];

export const CFOP_OPTIONS = [
  ['5351', '5351 - Transporte p/ execução de serviço da mesma natureza'],
  ['5352', '5352 - Transporte a estabelecimento industrial'],
  ['5353', '5353 - Transporte a estabelecimento comercial'],
  ['5356', '5356 - Transporte a estabelecimento de produtor rural'],
  ['5357', '5357 - Transporte a não contribuinte'],
  ['5932', '5932 - Transporte iniciado em UF diversa'],
  ['6351', '6351 - (Interestadual) Transporte p/ execução de serviço da mesma natureza'],
  ['6352', '6352 - (Interestadual) Transporte a estabelecimento industrial'],
  ['6353', '6353 - (Interestadual) Transporte a estabelecimento comercial'],
  ['6356', '6356 - (Interestadual) Transporte a estabelecimento de produtor rural'],
  ['6357', '6357 - (Interestadual) Transporte a não contribuinte'],
  ['6932', '6932 - (Interestadual) Transporte iniciado em UF diversa'],
  ['7358', '7358 - Transporte (exportação)'],
];

export const TOMADOR_OPTIONS = [
  ['0', 'Remetente'],
  ['3', 'Destinatário'],
  ['4', 'Outros (informar abaixo)'],
];

export const IE_TOMADOR_OPTIONS = [
  ['1', 'Contribuinte de ICMS'],
  ['2', 'Contribuinte isento de inscrição'],
  ['9', 'Não contribuinte'],
];

export const UNIDADE_OPTIONS = [
  ['01', 'KG'], ['02', 'TON'], ['03', 'UNIDADE'], ['00', 'M3'], ['04', 'LITROS'],
];

export const CTE_STATUS_LABELS = {
  RASCUNHO: 'Rascunho',
  ENVIANDO: 'Enviando',
  PENDENTE: 'Pendente',
  AUTORIZADO: 'Autorizado',
  REJEITADO: 'Rejeitado',
  DENEGADO: 'Denegado',
  CANCELADO: 'Cancelado',
  ERRO: 'Erro',
};
export const CTE_STATUS_TONES = {
  RASCUNHO: 'slate',
  ENVIANDO: 'blue',
  PENDENTE: 'amber',
  AUTORIZADO: 'emerald',
  REJEITADO: 'red',
  DENEGADO: 'red',
  CANCELADO: 'slate',
  ERRO: 'red',
};
export const CTE_EDITABLE = ['RASCUNHO', 'REJEITADO', 'ERRO'];

// MDF-e
export const MDFE_STATUS_LABELS = { ...CTE_STATUS_LABELS, ENCERRADO: 'Encerrado' };
export const MDFE_STATUS_TONES = { ...CTE_STATUS_TONES, ENCERRADO: 'blue' };

export const TIPO_RODADO_OPTIONS = [
  ['03', 'Cavalo mecânico'], ['01', 'Truck'], ['02', 'Toco'], ['04', 'VAN'], ['05', 'Utilitário'], ['06', 'Outros'],
];
export const TIPO_CARROCERIA_OPTIONS = [
  ['00', 'Não aplicável'], ['04', 'Porta container'], ['01', 'Aberta'], ['02', 'Fechada/Baú'], ['03', 'Graneleira'], ['05', 'Sider'],
];
export const TIPO_CARGA_OPTIONS = [
  ['04', '04 - Conteinerizada'], ['05', '05 - Carga geral'], ['01', '01 - Granel sólido'], ['02', '02 - Granel líquido'],
  ['03', '03 - Frigorificada'], ['06', '06 - Neogranel'], ['07', '07 - Perigosa (granel sólido)'],
  ['08', '08 - Perigosa (granel líquido)'], ['09', '09 - Perigosa (frigorificada)'], ['10', '10 - Perigosa (conteinerizada)'],
  ['11', '11 - Perigosa (carga geral)'],
];
export const TIPO_PROPRIETARIO_OPTIONS = [['1', 'TAC - Independente'], ['0', 'TAC - Agregado'], ['2', 'Outros']];
export const SEGURO_RESPONSAVEL_OPTIONS = [['1', 'Emitente do MDF-e'], ['2', 'Contratante do transporte']];
export const UF_LIST = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/** Endereço fiscal -> formato do AddressFields. */
export function toAddressFields(endereco) {
  const e = endereco || {};
  return {
    street: e.logradouro || '',
    number: e.numero || '',
    neighborhood: e.bairro || '',
    zip: e.cep || '',
    city: e.cidade || '',
    state: e.uf || '',
  };
}

/** Formato do AddressFields -> endereço fiscal (o código IBGE muda junto com cidade/UF). */
export function fromAddressFields(value, previous) {
  const v = value || {};
  const p = previous || {};
  const sameCity = (v.city || '') === (p.cidade || '') && (v.state || '') === (p.uf || '');
  return {
    ...p,
    logradouro: v.street || '',
    numero: v.number || '',
    bairro: v.neighborhood || '',
    cep: v.zip || '',
    cidade: v.city || '',
    uf: v.state || '',
    codigo_municipio: sameCity ? (p.codigo_municipio || null) : null,
  };
}

export const onlyDigits = (value) => String(value || '').replace(/\D/g, '');

export function formatCnpjCpf(value) {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

export function downloadBlob(data, filename) {
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
