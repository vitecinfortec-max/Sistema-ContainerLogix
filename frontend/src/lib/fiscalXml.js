/**
 * Leitura de XML de NF-e (nfeProc / NFe) e de CT-e (cteProc / CTe) para
 * preencher o CT-e. Roda no navegador: o arquivo não vai ao servidor.
 */
import { formatCnpjCpf } from './fiscal';

const all = (node, tag) => (node ? Array.from(node.getElementsByTagNameNS('*', tag)) : []);
const first = (node, tag) => all(node, tag)[0] || null;
const text = (node, tag) => (first(node, tag)?.textContent || '').trim();
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value) => (value === '' ? null : num(value));

// Envolvido da nota/conhecimento -> formato do formulário do CT-e
function party(node, addressTag) {
  if (!node) return null;
  const e = first(node, addressTag);
  return {
    client_id: null,
    nome: text(node, 'xNome'),
    cnpj_cpf: formatCnpjCpf(text(node, 'CNPJ') || text(node, 'CPF')),
    ie: text(node, 'IE'),
    fone: text(e, 'fone') || text(node, 'fone'),
    email: text(node, 'email'),
    endereco: {
      logradouro: text(e, 'xLgr'),
      numero: text(e, 'nro'),
      complemento: text(e, 'xCpl'),
      bairro: text(e, 'xBairro'),
      cep: text(e, 'CEP'),
      cidade: text(e, 'xMun'),
      uf: text(e, 'UF'),
      codigo_municipio: text(e, 'cMun') || null,
    },
  };
}

function parseNfe(doc) {
  const inf = first(doc, 'infNFe');
  const chave = text(doc, 'chNFe') || (inf?.getAttribute('Id') || '').replace(/^NFe/, '');
  const transp = first(inf, 'transp');
  return {
    tipo: 'NFE',
    chave,
    numero: text(first(inf, 'ide'), 'nNF'),
    remetente: party(first(inf, 'emit'), 'enderEmit'),
    destinatario: party(first(inf, 'dest'), 'enderDest'),
    // 0 = frete por conta do emitente (remetente), 1 = do destinatário
    mod_frete: text(transp, 'modFrete'),
    valor: num(text(first(inf, 'ICMSTot'), 'vNF')),
    peso_bruto: all(transp, 'vol').reduce((sum, v) => sum + num(text(v, 'pesoB')), 0),
    produto: text(first(first(inf, 'det'), 'prod'), 'xProd'),
  };
}

function parseCte(doc) {
  const inf = first(doc, 'infCte');
  const ide = first(inf, 'ide');
  const toma = first(ide, 'toma3') || first(ide, 'toma4');
  const carga = first(inf, 'infCarga');
  const icms = first(first(inf, 'imp'), 'ICMS');
  return {
    tipo: 'CTE',
    chave: text(doc, 'chCTe') || (inf?.getAttribute('Id') || '').replace(/^CTe/, ''),
    numero: text(ide, 'nCT'),
    cfop: text(ide, 'CFOP'),
    natureza_operacao: text(ide, 'natOp'),
    tomador_papel: text(toma, 'toma'),
    remetente: party(first(inf, 'rem'), 'enderReme'),
    destinatario: party(first(inf, 'dest'), 'enderDest'),
    tomador: first(ide, 'toma4') ? party(first(ide, 'toma4'), 'enderToma') : null,
    origem: { cidade: text(ide, 'xMunIni'), uf: text(ide, 'UFIni'), codigo_municipio: text(ide, 'cMunIni') || null },
    destino: { cidade: text(ide, 'xMunFim'), uf: text(ide, 'UFFim'), codigo_municipio: text(ide, 'cMunFim') || null },
    valor_total: num(text(first(inf, 'vPrest'), 'vTPrest')),
    valor_receber: numOrNull(text(first(inf, 'vPrest'), 'vRec')),
    componentes: all(first(inf, 'vPrest'), 'Comp').map((c) => ({ nome: text(c, 'xNome'), valor: num(text(c, 'vComp')) })),
    icms_cst: text(icms, 'CST'),
    icms_aliquota: numOrNull(text(icms, 'pICMS')),
    valor_carga: numOrNull(text(carga, 'vCarga')),
    produto_predominante: text(carga, 'proPred'),
    outras_caracteristicas: text(carga, 'xOutCat'),
    quantidades: all(carga, 'infQ').map((q) => ({ unidade: text(q, 'cUnid'), tipo_medida: text(q, 'tpMed'), quantidade: num(text(q, 'qCarga')) })),
    nfes: all(first(inf, 'infDoc'), 'infNFe').map((n) => text(n, 'chave')).filter(Boolean),
    observacoes: text(first(inf, 'compl'), 'xObs'),
  };
}

/** Texto do XML -> dados da NF-e ou do CT-e; erro com mensagem amigável quando não é nenhum dos dois. */
export function parseFiscalXml(xmlText) {
  const doc = new DOMParser().parseFromString(String(xmlText || '').replace(/^﻿/, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('arquivo não é um XML válido');
  if (first(doc, 'infNFe') && !first(doc, 'infCte')) return parseNfe(doc);
  if (first(doc, 'infCte')) return parseCte(doc);
  throw new Error('o XML não é de NF-e nem de CT-e');
}
