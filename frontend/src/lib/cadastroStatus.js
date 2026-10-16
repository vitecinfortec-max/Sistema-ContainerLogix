// Status do Cadastro (Motorista, Cliente, Transportadora, Terminal...):
// Inativo/Bloqueado (e Afastado/Desligado, de Funcionário) não aparecem nas
// listas de seleção das telas de lançamento novo. Edições continuam vendo
// todos, pra não sumir o valor de um registro antigo.
const UNUSABLE_STATUSES = new Set(['INATIVO', 'BLOQUEADO', 'AFASTADO', 'DESLIGADO']);

export const isUsableRecord = (record) => !UNUSABLE_STATUSES.has(record?.status);

export const activeRecords = (list) => (Array.isArray(list) ? list : []).filter(isUsableRecord);
