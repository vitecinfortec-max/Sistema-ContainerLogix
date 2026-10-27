import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageHeader from '../components/PageHeader';
import {
  StatCard, StatGrid, FilterCard, FilterField, SearchInput, DataCard, Toolbar, ToolbarButton, ToolbarPrimary,
  ToolbarDivider, StatusPill, EmptyState, TablePagination, usePagination,
} from '../components/DataPage';
import { Field } from '../components/FormKit';
import { AddressFields, CityStateFields } from '../components/AddressFields';
import { ClientNamePicker } from '../components/ClientNamePicker';
import { Autocomplete } from '../components/Autocomplete';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import {
  CFOP_OPTIONS, CTE_EDITABLE, CTE_STATUS_LABELS, CTE_STATUS_TONES, ICMS_CST_OPTIONS, ICMS_WITH_RATE,
  IE_TOMADOR_OPTIONS, TOMADOR_OPTIONS, UNIDADE_OPTIONS, accessKeyOk, cfopForRoute, downloadBlob, formatCnpjCpf,
  fromAddressFields, indicadorIe, onlyDigits, toAddressFields, waitWhilePending,
} from '../lib/fiscal';
import { parseFiscalXml } from '../lib/fiscalXml';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { format } from 'date-fns';
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronUp, Clock, Copy, FileCheck, FileCode, FileCog, FileUp, Loader2, MapPin,
  PackageCheck, Pencil, Plus, Printer, RefreshCw, Save, Send, Trash2, Truck, X, XCircle,
} from 'lucide-react';

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const toNumber = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
// Número digitado (pt-BR) a partir do valor salvo
const toInput = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const toMoneyInput = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));

// Seções da página de emissão (as pendências da conferência levam até elas)
const SECTION_LABELS = {
  basicos: 'Dados básicos', envolvidos: 'Envolvidos', viagem: 'Motorista e veículo', seguro: 'Seguro', documentos: 'Documentos',
  carga: 'Totais da carga', frete: 'Composição do frete', pedagio: 'Vale-pedágio',
};
// Componentes mais usados na composição do frete (o nome vai no CT-e, até 15 caracteres)
const COMPONENT_PRESETS = [['FRETE VALOR', 'Frete'], ['PEDAGIO', 'Pedágio'], ['SEGURO', 'Seguro'], ['OUTROS', 'Outros']];

const emptyParty = () => ({ client_id: null, nome: '', cnpj_cpf: '', ie: '', fone: '', email: '', endereco: {} });
const emptyDriver = () => ({ driver_id: null, nome: '', cpf: '' });
const emptyToll = () => ({ pago_por: 'EMITENTE', tipo: '01', fornecedor_nome: '', fornecedor_cnpj: '', numero_comprovante: '', valor: '' });
const normPlate = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const TOLL_PAYER_OPTIONS = [['EMITENTE', 'Emitente'], ['REMETENTE', 'Remetente'], ['DESTINATARIO', 'Destinatário'], ['TOMADOR', 'Tomador']];
const TOLL_TYPE_OPTIONS = [['01', 'TAG'], ['02', 'Cupom'], ['03', 'Cartão']];
// Seguro da carga: padrão da Configuração Fiscal (o mesmo do MDF-e)
const insuranceDefaults = (settings) => ({
  seguro_responsavel: String(settings?.seguro_responsavel || 1),
  seguradora_nome: settings?.seguradora_nome || '',
  seguradora_cnpj: settings?.seguradora_cnpj ? formatCnpjCpf(settings.seguradora_cnpj) : '',
  seguro_apolice: settings?.seguro_apolice || '',
  seguro_averbacao: '',
});

function buildEmpty(settings) {
  return {
    loading_order_id: null,
    loading_order_number: null,
    cfop: settings?.cfop_padrao || '5353',
    natureza_operacao: settings?.natureza_operacao || 'PRESTACAO DE SERVICO DE TRANSPORTE',
    tomador_papel: '0',
    indicador_ie_tomador: '1',
    remetente: emptyParty(),
    destinatario: emptyParty(),
    tomador: emptyParty(),
    // Início/fim da prestação seguem as cidades do remetente e do destinatário
    percurso_auto: true,
    origem: { cidade: '', uf: '' },
    destino: { cidade: '', uf: '' },
    valor_total: '',
    valor_receber: '',
    componentes: [],
    icms_cst: settings?.icms_cst || '00',
    icms_aliquota: toInput(settings?.icms_aliquota),
    valor_carga: '',
    produto_predominante: settings?.produto_predominante || 'CONTAINER',
    outras_caracteristicas: '',
    quantidades: [{ unidade: '01', tipo_medida: 'PESO BRUTO', quantidade: '' }],
    documentos: [{ tipo: 'NFE', chave: '', tipo_outros: '99', descricao: '', numero: '', data_emissao: '', valor: '' }],
    containers: [],
    observacoes: '',
    motorista: emptyDriver(),
    veiculo_placa: '',
    reboque_placas: ['', ''],
    ...insuranceDefaults(settings),
    vales_pedagio: [],
  };
}

const sameCity = (place, endereco) => (place?.cidade || '').trim().toUpperCase() === (endereco?.cidade || '').trim().toUpperCase()
  && (place?.uf || '') === (endereco?.uf || '');

// Documento salvo -> formulário (números viram texto pt-BR)
function toForm(doc, settings) {
  const base = buildEmpty(settings);
  const party = (p) => ({ ...emptyParty(), ...(p || {}), cnpj_cpf: p?.cnpj_cpf ? formatCnpjCpf(p.cnpj_cpf) : '' });
  const origem = doc.origem || base.origem;
  const destino = doc.destino || base.destino;
  return {
    ...base,
    ...doc,
    tomador_papel: String(doc.tomador_papel ?? 0),
    indicador_ie_tomador: String(doc.indicador_ie_tomador ?? 1),
    remetente: party(doc.remetente),
    destinatario: party(doc.destinatario),
    tomador: party(doc.tomador),
    percurso_auto: (!origem.cidade && !destino.cidade)
      || (sameCity(origem, doc.remetente?.endereco) && sameCity(destino, doc.destinatario?.endereco)),
    origem,
    destino,
    valor_total: toMoneyInput(doc.valor_total),
    valor_receber: toMoneyInput(doc.valor_receber),
    icms_cst: doc.icms_cst || base.icms_cst,
    icms_aliquota: toInput(doc.icms_aliquota ?? settings?.icms_aliquota),
    valor_carga: toMoneyInput(doc.valor_carga),
    componentes: (doc.componentes || []).map((c) => ({ ...c, valor: toMoneyInput(c.valor) })),
    quantidades: (doc.quantidades?.length ? doc.quantidades : base.quantidades).map((q) => ({ ...q, quantidade: toInput(q.quantidade) })),
    documentos: (doc.documentos?.length ? doc.documentos : base.documentos).map((d) => ({ ...base.documentos[0], ...d, valor: toMoneyInput(d.valor) })),
    containers: doc.containers || [],
    observacoes: doc.observacoes || '',
    motorista: { ...emptyDriver(), ...(doc.motorista || {}), cpf: doc.motorista?.cpf ? formatCnpjCpf(doc.motorista.cpf) : '' },
    veiculo_placa: doc.veiculo_placa || '',
    reboque_placas: [...(doc.reboque_placas || []), '', ''].slice(0, 2),
    seguro_responsavel: String(doc.seguro_responsavel || base.seguro_responsavel),
    seguradora_nome: doc.seguradora_nome ?? base.seguradora_nome,
    seguradora_cnpj: doc.seguradora_cnpj ? formatCnpjCpf(doc.seguradora_cnpj) : (doc.seguradora_nome ? '' : base.seguradora_cnpj),
    seguro_apolice: doc.seguro_apolice ?? base.seguro_apolice,
    seguro_averbacao: doc.seguro_averbacao || '',
    vales_pedagio: (doc.vales_pedagio || []).map((v) => ({
      ...emptyToll(), ...v, fornecedor_cnpj: v.fornecedor_cnpj ? formatCnpjCpf(v.fornecedor_cnpj) : '', valor: toMoneyInput(v.valor),
    })),
  };
}

const placeOf = (party) => {
  const e = party?.endereco || {};
  return { cidade: e.cidade || '', uf: e.uf || '', codigo_municipio: e.codigo_municipio || null };
};
const payerOf = (f) => ({ 0: f.remetente, 3: f.destinatario, 4: f.tomador })[f.tomador_papel];

/**
 * Preenchimentos automáticos a cada alteração do formulário: percurso pelos
 * envolvidos, CFOP 5/6 pelo percurso, indicador de IE pelo pagador do frete e
 * valor total pela soma da composição do frete.
 */
function derive(prev, next) {
  let f = next;
  if (f.percurso_auto) f = { ...f, origem: placeOf(f.remetente), destino: placeOf(f.destinatario) };
  const cfop = cfopForRoute(f.cfop, f.origem.uf, f.destino.uf);
  if (cfop !== f.cfop) f = { ...f, cfop };
  if (payerOf(f) !== payerOf(prev)) f = { ...f, indicador_ie_tomador: indicadorIe(payerOf(f)) };
  if (f.componentes !== prev.componentes) {
    const values = f.componentes.map((c) => toNumber(c.valor)).filter((v) => v !== null);
    if (values.length) f = { ...f, valor_total: values.reduce((a, b) => a + b, 0).toFixed(2).replace('.', ',') };
  }
  return f;
}

/**
 * XML importado -> formulário. Um CT-e (de outro sistema) vira a base do
 * formulário; as NF-e entram como documentos, somam valor e peso da carga e
 * preenchem remetente/destinatário que ainda estão em branco.
 */
function mergeXml(current, items, { settings, clients }) {
  const byCnpj = (p) => {
    const d = onlyDigits(p?.cnpj_cpf);
    const client = d && clients.find((c) => onlyDigits(c.cnpj) === d);
    return client ? { ...p, client_id: client.id } : p;
  };
  const warnings = [];
  const ctes = items.filter((x) => x.tipo === 'CTE');
  const nfes = items.filter((x) => x.tipo === 'NFE');
  let f = current;
  if (ctes.length) {
    // tipo/chave/numero são do CT-e de origem, não do novo
    const { tipo, chave, numero, nfes: keys, ...c } = ctes[0];
    if (ctes.length > 1) warnings.push(`Mais de um CT-e no arquivo: usado o nº ${numero || '-'}`);
    if (!['0', '3', '4'].includes(c.tomador_papel)) warnings.push('Tomador do CT-e original era expedidor/recebedor: confira o pagador do frete');
    const doc = toForm({
      ...c,
      tomador_papel: ['0', '3', '4'].includes(c.tomador_papel) ? c.tomador_papel : '0',
      remetente: byCnpj(c.remetente),
      destinatario: byCnpj(c.destinatario),
      tomador: c.tomador ? byCnpj(c.tomador) : null,
      cfop: c.cfop || current.cfop,
      icms_cst: c.icms_cst || current.icms_cst,
      componentes: c.componentes.filter((x) => x.nome),
      quantidades: c.quantidades.filter((q) => q.quantidade),
      documentos: keys.map((k) => ({ tipo: 'NFE', chave: k })),
      containers: current.containers,
    }, settings);
    f = { ...doc, loading_order_id: current.loading_order_id, loading_order_number: current.loading_order_number };
    f = { ...f, indicador_ie_tomador: indicadorIe(payerOf(f)) };
  }

  const known = new Set(f.documentos.map((d) => onlyDigits(d.chave)).filter(Boolean));
  const fresh = nfes.filter((n) => n.chave && !known.has(n.chave) && known.add(n.chave));
  const repeated = nfes.length - fresh.length;
  if (repeated) warnings.push(repeated === 1 ? 'Uma NF-e já estava no CT-e e foi ignorada' : `${repeated} NF-e já estavam no CT-e e foram ignoradas`);
  if (fresh.length) {
    const ref = fresh[0];
    const blank = (p) => !(p?.nome || '').trim();
    const newParties = blank(f.remetente) && blank(f.destinatario);
    const others = fresh.filter((n) => onlyDigits(n.remetente?.cnpj_cpf) !== onlyDigits(ref.remetente?.cnpj_cpf)
      || onlyDigits(n.destinatario?.cnpj_cpf) !== onlyDigits(ref.destinatario?.cnpj_cpf));
    if (others.length) warnings.push(`${others.length} NF-e com remetente ou destinatário diferente da primeira`);
    const peso = fresh.reduce((sum, n) => sum + n.peso_bruto, 0);
    const valor = fresh.reduce((sum, n) => sum + n.valor, 0);
    let quantidades = f.quantidades;
    if (peso > 0) {
      const i = quantidades.findIndex((q) => q.unidade === '01');
      const add = (q) => ({ ...q, quantidade: toInput(Math.round(((toNumber(q.quantidade) || 0) + peso) * 1000) / 1000) });
      quantidades = i >= 0
        ? quantidades.map((q, j) => (j === i ? add(q) : q))
        : [...quantidades, add({ unidade: '01', tipo_medida: 'PESO BRUTO', quantidade: '' })];
    }
    f = {
      ...f,
      remetente: blank(f.remetente) && ref.remetente ? byCnpj(ref.remetente) : f.remetente,
      destinatario: blank(f.destinatario) && ref.destinatario ? byCnpj(ref.destinatario) : f.destinatario,
      // Modalidade do frete na nota: 0 = por conta do remetente, 1 = do destinatário
      tomador_papel: newParties && ({ 0: '0', 1: '3' })[ref.mod_frete] ? ({ 0: '0', 1: '3' })[ref.mod_frete] : f.tomador_papel,
      documentos: [
        ...f.documentos.filter((d) => (d.tipo === 'NFE' ? onlyDigits(d.chave) : (d.descricao || d.numero))),
        ...fresh.map((n) => ({ ...buildEmpty().documentos[0], chave: n.chave })),
      ],
      valor_carga: toMoneyInput((toNumber(f.valor_carga) || 0) + valor),
      quantidades,
      produto_predominante: (f.produto_predominante || '').trim() || (ref.produto || '').slice(0, 60).toUpperCase(),
    };
  }
  if (!f.documentos.length) f = { ...f, documentos: buildEmpty().documentos };
  return { form: f, ctes: ctes.length ? 1 : 0, nfes: fresh.length, warnings };
}

function cnpjCpfOk(value) {
  const d = onlyDigits(value);
  if (!/^(\d{11}|\d{14})$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (base, weights) => {
    const sum = base.split('').reduce((acc, n, i) => acc + Number(n) * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  if (d.length === 11) {
    const w = (n) => Array.from({ length: n }, (_, i) => n + 1 - i);
    return dv(d.slice(0, 9), w(9)) === Number(d[9]) && dv(d.slice(0, 10), w(10)) === Number(d[10]);
  }
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(d.slice(0, 12), w1) === Number(d[12]) && dv(d.slice(0, 13), [6, ...w1]) === Number(d[13]);
}

/** Conferência local antes de transmitir (as mesmas regras do backend, sem ir à Sefaz). */
function validateCte(f, settings) {
  const issues = [];
  const add = (section, msg) => issues.push({ section, msg });
  if (settings && (!settings.provider_configured || !settings.provider_synced_at || !settings.certificate)) {
    add('basicos', 'Configuração Fiscal incompleta (emissor, cadastro da empresa ou certificado A1)');
  }
  if (!/^\d{4}$/.test(f.cfop || '')) add('basicos', 'Escolha o CFOP');
  if (!(f.natureza_operacao || '').trim()) add('basicos', 'Informe a Natureza da Operação');

  const parties = [['Remetente', f.remetente], ['Destinatário', f.destinatario]];
  if (f.tomador_papel === '4') parties.push(['Tomador', f.tomador]);
  parties.forEach(([label, p]) => {
    const e = p?.endereco || {};
    if ((p?.nome || '').trim().length < 2) add('envolvidos', `${label}: informe o nome / razão social`);
    if (!cnpjCpfOk(p?.cnpj_cpf)) add('envolvidos', `${label}: CNPJ/CPF inválido`);
    if ((e.logradouro || '').trim().length < 2 || !(e.numero || '').trim() || (e.bairro || '').trim().length < 2) {
      add('envolvidos', `${label}: endereço incompleto (logradouro, número e bairro)`);
    }
    if ((e.cidade || '').trim().length < 2 || !e.uf) add('envolvidos', `${label}: informe a cidade e a UF do endereço`);
  });
  [['Início da prestação', f.origem], ['Término da prestação', f.destino]].forEach(([label, p]) => {
    if ((p?.cidade || '').trim().length < 2 || !p?.uf) add('envolvidos', `${label}: informe a cidade e a UF`);
  });

  if (!(f.produto_predominante || '').trim()) add('carga', 'Informe o produto predominante');
  if (!f.quantidades.some((q) => toNumber(q.quantidade) > 0)) add('carga', 'Informe ao menos uma quantidade da carga (ex.: peso bruto)');
  const keys = [];
  let docs = 0;
  f.documentos.forEach((d, i) => {
    if (d.tipo === 'NFE' && onlyDigits(d.chave)) {
      docs += 1;
      keys.push(onlyDigits(d.chave));
      if (!accessKeyOk(d.chave, '55')) add('documentos', `NF-e ${i + 1}: chave inválida (44 dígitos, confira o dígito verificador)`);
    }
    if (d.tipo === 'OUTROS' && (d.descricao || d.numero)) {
      docs += 1;
      if (d.tipo_outros === '99' && !(d.descricao || '').trim()) add('documentos', `Documento ${i + 1}: informe a descrição`);
    }
  });
  if (!docs) add('documentos', 'Informe ao menos um documento transportado (chave da NF-e ou outro documento)');
  if (new Set(keys).size !== keys.length) add('documentos', 'A mesma chave de NF-e aparece mais de uma vez');

  const total = toNumber(f.valor_total) || 0;
  if (total <= 0) add('frete', 'Informe o valor total da prestação (ou a composição do frete)');
  const receber = toNumber(f.valor_receber);
  if (receber !== null && receber > total) add('frete', 'Valor a receber maior que o valor total');
  if (f.componentes.some((c) => toNumber(c.valor) && !(c.nome || '').trim())) add('frete', 'Componente do frete sem nome');
  if (ICMS_WITH_RATE.includes(f.icms_cst)) {
    const rate = toNumber(f.icms_aliquota);
    if (!rate || rate <= 0 || rate > 100) add('frete', 'Informe a alíquota do ICMS');
  }

  const cpf = onlyDigits(f.motorista?.cpf);
  if (cpf && !cnpjCpfOk(cpf)) add('viagem', 'Motorista: CPF inválido');
  if ((f.motorista?.nome || '').trim() && !cpf) add('viagem', 'Motorista: informe o CPF');
  if (onlyDigits(f.seguradora_cnpj) && !cnpjCpfOk(f.seguradora_cnpj)) add('seguro', 'Seguro: CNPJ da seguradora inválido');
  f.vales_pedagio.forEach((v, i) => {
    const n = f.vales_pedagio.length > 1 ? ` ${i + 1}` : '';
    if (!cnpjCpfOk(v.fornecedor_cnpj) || onlyDigits(v.fornecedor_cnpj).length !== 14) add('pedagio', `Vale-pedágio${n}: CNPJ da fornecedora inválido`);
    if (!(v.numero_comprovante || '').trim()) add('pedagio', `Vale-pedágio${n}: informe o número do comprovante`);
    if (!(toNumber(v.valor) > 0)) add('pedagio', `Vale-pedágio${n}: informe o valor`);
  });
  return issues;
}

function toPayload(form) {
  const party = (p) => ({ ...p, nome: (p.nome || '').trim(), cnpj_cpf: p.cnpj_cpf || null });
  const papel = Number(form.tomador_papel);
  return {
    loading_order_id: form.loading_order_id || null,
    loading_order_number: form.loading_order_number || null,
    cfop: form.cfop,
    natureza_operacao: (form.natureza_operacao || '').trim(),
    tomador_papel: papel,
    indicador_ie_tomador: Number(form.indicador_ie_tomador),
    remetente: party(form.remetente),
    destinatario: party(form.destinatario),
    tomador: papel === 4 ? party(form.tomador) : null,
    origem: form.origem,
    destino: form.destino,
    valor_total: toNumber(form.valor_total),
    valor_receber: toNumber(form.valor_receber),
    componentes: form.componentes.filter((c) => (c.nome || '').trim()).map((c) => ({ nome: c.nome.trim(), valor: toNumber(c.valor) || 0 })),
    icms_cst: form.icms_cst,
    icms_aliquota: ICMS_WITH_RATE.includes(form.icms_cst) ? toNumber(form.icms_aliquota) : null,
    valor_carga: toNumber(form.valor_carga),
    produto_predominante: (form.produto_predominante || '').trim(),
    outras_caracteristicas: (form.outras_caracteristicas || '').trim() || null,
    quantidades: form.quantidades.filter((q) => toNumber(q.quantidade)).map((q) => ({ ...q, quantidade: toNumber(q.quantidade) })),
    documentos: form.documentos
      .filter((d) => (d.tipo === 'NFE' ? (d.chave || '').replace(/\D/g, '') : (d.descricao || d.numero)))
      .map((d) => ({
        tipo: d.tipo,
        chave: d.tipo === 'NFE' ? (d.chave || '').replace(/\D/g, '') : null,
        tipo_outros: d.tipo === 'OUTROS' ? (d.tipo_outros || '99') : null,
        descricao: d.tipo === 'OUTROS' ? (d.descricao || '').trim() || null : null,
        numero: d.tipo === 'OUTROS' ? (d.numero || '').trim() || null : null,
        data_emissao: d.tipo === 'OUTROS' ? d.data_emissao || null : null,
        valor: d.tipo === 'OUTROS' ? toNumber(d.valor) : null,
      })),
    containers: form.containers.filter((c) => (c.numero || '').trim()).map((c) => ({ numero: c.numero.trim().toUpperCase(), lacre: (c.lacre || '').trim() || null })),
    observacoes: (form.observacoes || '').trim() || null,
    motorista: (form.motorista?.nome || '').trim()
      ? { driver_id: form.motorista.driver_id || null, nome: form.motorista.nome.trim(), cpf: onlyDigits(form.motorista.cpf) || null }
      : null,
    veiculo_placa: normPlate(form.veiculo_placa) || null,
    reboque_placas: form.reboque_placas.map(normPlate).filter(Boolean),
    seguro_responsavel: Number(form.seguro_responsavel) || null,
    seguradora_nome: (form.seguradora_nome || '').trim() || null,
    seguradora_cnpj: onlyDigits(form.seguradora_cnpj) || null,
    seguro_apolice: (form.seguro_apolice || '').trim() || null,
    seguro_averbacao: (form.seguro_averbacao || '').trim() || null,
    vales_pedagio: form.vales_pedagio
      .filter((v) => (v.numero_comprovante || '').trim() || toNumber(v.valor) || onlyDigits(v.fornecedor_cnpj))
      .map((v) => ({
        pago_por: v.pago_por, tipo: v.tipo, fornecedor_nome: (v.fornecedor_nome || '').trim() || null,
        fornecedor_cnpj: onlyDigits(v.fornecedor_cnpj) || null, numero_comprovante: (v.numero_comprovante || '').trim() || null,
        valor: toNumber(v.valor),
      })),
  };
}

/**
 * Remetente / Destinatário / Tomador numa linha (cadastro de clientes ou
 * digitado); endereço e contato ficam recolhidos e só abrem sozinhos quando
 * o endereço está incompleto.
 */
function PartyFields({ title, value, onChange, clients, testId }) {
  const [open, setOpen] = useState(null);
  const v = value || emptyParty();
  const e = v.endereco || {};
  const set = (field, val) => onChange({ ...v, [field]: val });
  const pick = (client) => {
    const d = client.address_details || {};
    onChange({
      client_id: client.id,
      nome: client.name || '',
      cnpj_cpf: client.cnpj ? formatCnpjCpf(client.cnpj) : '',
      ie: client.state_registration || '',
      fone: client.phone || '',
      email: client.email || '',
      endereco: fromAddressFields({ street: d.street, number: d.number, neighborhood: d.neighborhood, zip: d.zip, city: d.city, state: d.state }, {}),
    });
  };
  const incomplete = !((e.logradouro || '').trim() && (e.numero || '').trim() && (e.bairro || '').trim() && e.cidade && e.uf);
  const expanded = open ?? (incomplete && !!(v.nome || '').trim());
  const summary = [[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro, e.cidade && `${e.cidade}/${e.uf || ''}`]
    .filter(Boolean).join(' - ');
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2" data-testid={testId}>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <Field label={title} required className="md:col-span-6">
          <ClientNamePicker
            testId={testId ? `${testId}-name` : undefined}
            text={v.nome || ''}
            onTextChange={(text) => onChange({ ...v, nome: text, client_id: null })}
            onPick={pick}
            onClear={() => onChange(emptyParty())}
            clients={clients}
          />
        </Field>
        <Field label="CNPJ / CPF" required className="md:col-span-3">
          <Input value={v.cnpj_cpf || ''} onChange={(ev) => set('cnpj_cpf', formatCnpjCpf(ev.target.value))} className="font-mono" />
        </Field>
        <Field label="Inscrição Estadual" className="md:col-span-3">
          <Input value={v.ie || ''} placeholder='ou "ISENTO"' onChange={(ev) => set('ie', ev.target.value.toUpperCase())} />
        </Field>
      </div>
      <button type="button" onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-1.5 text-left text-xs text-slate-500 hover:text-primary" data-testid={testId ? `${testId}-address-toggle` : undefined}>
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{summary || 'Endereço não informado'}</span>
        {incomplete && (v.nome || '').trim() && <span className="shrink-0 font-medium text-amber-600">· endereço incompleto</span>}
        <span className="ml-auto flex shrink-0 items-center gap-0.5 font-medium">
          {expanded ? 'Ocultar' : 'Endereço e contato'} {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>
      {expanded && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Telefone">
              <Input value={v.fone || ''} onChange={(ev) => set('fone', ev.target.value)} />
            </Field>
            <Field label="E-mail" className="md:col-span-3">
              <Input value={v.email || ''} onChange={(ev) => set('email', ev.target.value)} />
            </Field>
          </div>
          <AddressFields value={toAddressFields(v.endereco)} onChange={(addr) => set('endereco', fromAddressFields(addr, v.endereco))} />
        </div>
      )}
    </div>
  );
}

function RowRemove({ onClick }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-slate-400 hover:text-red-600" onClick={onClick} aria-label="Remover">
      <X className="w-4 h-4" />
    </Button>
  );
}

function IssueCount({ n }) {
  if (!n) return null;
  return <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">{n}</span>;
}

/** Bloco da página de emissão: título com as pendências do bloco e ações à direita. */
function Section({ id, title, count, actions, children }) {
  return (
    <section id={`cte-sec-${id}`} className="scroll-mt-3 space-y-3" data-testid={`cte-sec-${id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-1.5 dark:border-slate-700">
        <h3 className="flex items-center text-sm font-semibold text-slate-800 dark:text-slate-100">{title}<IssueCount n={count} /></h3>
        {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export default function CtePage() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [settings, setSettings] = useState(null);
  const [clients, setClients] = useState([]);
  const [orders, setOrders] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(buildEmpty());
  const [formKey, setFormKey] = useState(0);
  const [emitted, setEmitted] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [orderText, setOrderText] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const debounceRef = useRef(null);
  const activeRef = useRef(true);
  const xmlInputRef = useRef(null);

  const filtered = statusFilter ? list.filter((c) => c.status === statusFilter) : list;
  const { pageItems, paginationProps } = usePagination(filtered, { resetKey: `${search}|${statusFilter}` });
  const issues = useMemo(() => validateCte(form, settings), [form, settings]);
  const issuesIn = (section) => issues.filter((i) => i.section === section).length;
  // Rola a página do formulário até a seção (depois do diálogo abrir/renderizar)
  const scrollToSection = (id) => setTimeout(() => {
    document.getElementById(`cte-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);

  useEffect(() => {
    api.getFiscalSettings().then((r) => setSettings(r.data)).catch(() => setSettings({}));
    api.getClients().then((r) => setClients((r.data || []).filter((c) => c.status !== 'INATIVO'))).catch(() => {});
    api.getLoadingOrders().then((r) => setOrders(r.data || [])).catch(() => {});
    api.getDrivers().then((r) => setDrivers((r.data || []).filter((d) => d.status !== 'INATIVO'))).catch(() => {});
    api.getVehicles({ per_page: 1000 }).then((r) => setVehicles(r.data?.items || r.data || [])).catch(() => {});
    return () => { activeRef.current = false; };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadList(); }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const loadList = async () => {
    setLoading(true);
    try {
      const r = await api.getCtes(search ? { search } : {});
      setList(r.data || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao carregar os CT-e');
    } finally {
      setLoading(false);
    }
  };

  const replaceInList = (doc) => setList((prev) => prev.map((c) => (c.id === doc.id ? doc : c)));
  const update = (fn) => setForm((prev) => derive(prev, fn(prev)));
  const set = (field, value) => update((prev) => ({ ...prev, [field]: value }));
  const setRow = (field, index, patch) => update((prev) => ({
    ...prev, [field]: prev[field].map((row, i) => (i === index ? { ...row, ...patch } : row)),
  }));
  const addRow = (field, row) => update((prev) => ({ ...prev, [field]: [...prev[field], row] }));
  const removeRow = (field, index) => update((prev) => ({ ...prev, [field]: prev[field].filter((_, i) => i !== index) }));
  const setTrailer = (index, plate) => update((prev) => ({ ...prev, reboque_placas: prev.reboque_placas.map((p, i) => (i === index ? plate : p)) }));

  // Motorista escolhido: cavalo e carreta padrão dele, se ainda não há placa
  const pickDriver = (driver) => update((prev) => ({
    ...prev,
    motorista: { driver_id: driver.id, nome: driver.name || '', cpf: driver.cpf ? formatCnpjCpf(driver.cpf) : '' },
    veiculo_placa: prev.veiculo_placa || normPlate(driver.default_truck_plate),
    reboque_placas: prev.reboque_placas.some(Boolean) ? prev.reboque_placas : [normPlate(driver.default_trailer_plate), ''],
  }));
  // Cavalo escolhido: motorista vinculado e a carreta dele, se ainda estão vazios
  const pickTraction = (vehicle) => update((prev) => {
    const plate = normPlate(vehicle.plate);
    const driver = drivers.find((d) => d.id === vehicle.driver_id) || drivers.find((d) => normPlate(d.default_truck_plate) === plate);
    const next = { ...prev, veiculo_placa: plate };
    if (!driver) return next;
    return {
      ...next,
      motorista: (prev.motorista?.nome || '').trim() ? prev.motorista
        : { driver_id: driver.id, nome: driver.name || '', cpf: driver.cpf ? formatCnpjCpf(driver.cpf) : '' },
      reboque_placas: prev.reboque_placas.some(Boolean) ? prev.reboque_placas : [normPlate(driver.default_trailer_plate), ''],
    };
  });

  const openForm = (f, { id = null, focus = null } = {}) => {
    setEditingId(id);
    setEmitted(null);
    setForm(derive(f, f));
    if (focus) scrollToSection(focus);
    setFormKey((k) => k + 1);
    setDialogOpen(true);
  };

  const openCreate = () => openForm(buildEmpty(settings));
  const openEdit = (doc) => openForm(toForm(doc, settings), { id: doc.id });

  const openFromOrder = async (order) => {
    if (!order) return;
    try {
      const r = await api.getCteDraftFromLoadingOrder(order.id);
      const f = toForm(r.data, settings);
      setOrderDialogOpen(false);
      setOrderText('');
      openForm({ ...f, indicador_ie_tomador: indicadorIe(payerOf(f)) });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao carregar a Ordem de Carregamento');
    }
  };

  // Novo CT-e com as partes, o percurso e o frete de um já emitido; documentos e carga mudam a cada viagem
  const openDuplicate = (doc) => {
    if (!doc) return;
    const base = buildEmpty(settings);
    const f = toForm(doc, settings);
    openForm({
      ...f,
      loading_order_id: null,
      loading_order_number: null,
      documentos: base.documentos,
      containers: [],
      quantidades: f.quantidades.map((q) => ({ ...q, quantidade: '' })),
      valor_carga: '',
      observacoes: doc.loading_order_id ? '' : f.observacoes,
      motorista: emptyDriver(),
      veiculo_placa: '',
      reboque_placas: ['', ''],
      seguro_averbacao: '',
      vales_pedagio: [],
    }, { focus: 'documentos' });
    toast.info(`Cópia do CT-e nº ${doc.numero || '-'}: informe os documentos e a carga desta viagem`);
  };

  // XML de NF-e / CT-e: com o formulário aberto completa o CT-e em edição; na lista, abre um novo
  const importXml = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const items = [];
    const failed = [];
    await Promise.all(files.map(async (file) => {
      try {
        items.push(parseFiscalXml(await file.text()));
      } catch (e) {
        failed.push(`${file.name}: ${e.message}`);
      }
    }));
    failed.forEach((msg) => toast.error(`XML não importado - ${msg}`));
    if (!items.length) return;
    const ctx = { settings, clients };
    const editing = dialogOpen && !emitted;
    const result = mergeXml(editing ? form : buildEmpty(settings), items, ctx);
    if (editing) setForm(derive(form, result.form));
    else openForm({ ...result.form, indicador_ie_tomador: indicadorIe(payerOf(result.form)) });
    const parts = [result.ctes && 'dados do CT-e', result.nfes && `${result.nfes} NF-e`].filter(Boolean);
    if (parts.length) toast.success(`Importado: ${parts.join(' e ')}. Confira antes de transmitir.`);
    result.warnings.forEach((w) => toast.warning(w));
  };

  const save = async ({ silent = false } = {}) => {
    if (saving) return null;
    setSaving(true);
    try {
      const payload = toPayload(form);
      const r = editingId ? await api.updateCte(editingId, payload) : await api.createCte(payload);
      setEditingId(r.data.id);
      if (!silent) toast.success('CT-e salvo');
      await loadList();
      return r.data;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar o CT-e');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const download = async (doc, kind) => {
    setBusy(kind);
    try {
      const r = kind === 'pdf' ? await api.getCtePDF(doc.id) : await api.getCteXML(doc.id);
      downloadBlob(r.data, `CTe_${doc.numero}_${doc.chave || doc.id}.${kind}`);
    } catch (e) {
      toast.error(kind === 'pdf' ? 'Erro ao baixar o DACTE' : 'Erro ao baixar o XML');
    } finally {
      setBusy('');
    }
  };

  const notifyResult = (doc) => {
    if (doc.status === 'AUTORIZADO') {
      toast.success(`CT-e nº ${doc.numero} autorizado`, { action: { label: 'DACTE', onClick: () => download(doc, 'pdf') } });
    } else if (doc.status === 'PENDENTE') {
      toast.info('A Sefaz ainda não respondeu: use "Atualizar situação" em instantes');
    } else {
      toast.error(`CT-e ${CTE_STATUS_LABELS[doc.status] || doc.status}: ${doc.motivo || ''}`, { duration: 12000 });
    }
  };

  const emit = async (doc) => {
    if (!doc) return null;
    const ambiente = settings?.ambiente === 'producao' ? 'PRODUÇÃO (com valor fiscal)' : 'homologação (teste, sem valor fiscal)';
    if (!(await confirm(`Transmitir este CT-e para a Sefaz em ${ambiente}?`))) return null;
    setBusy('emit');
    try {
      let result = (await api.emitCte(doc.id)).data;
      replaceInList(result);
      if (result.status === 'PENDENTE') {
        setBusy('wait');
        result = await waitWhilePending(result, api.refreshCte, { onUpdate: replaceInList, isActive: () => activeRef.current });
      }
      notifyResult(result);
      return result;
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao transmitir o CT-e', { duration: 12000 });
      loadList();
      return null;
    } finally {
      setBusy('');
    }
  };

  const saveAndEmit = async () => {
    if (issues.length) {
      scrollToSection('conferencia');
      toast.error(`Há ${issues.length} pendência(s) antes de transmitir`);
      return;
    }
    const doc = await save({ silent: true });
    if (!doc) return;
    const result = await emit(doc);
    if (!result) return;
    if (CTE_EDITABLE.includes(result.status)) scrollToSection('conferencia');
    else setEmitted(result);
  };

  const refresh = async (doc) => {
    setBusy('refresh');
    try {
      const r = await api.refreshCte(doc.id);
      replaceInList(r.data);
      setEmitted((prev) => (prev?.id === r.data.id ? r.data : prev));
      toast.success(`Situação: ${CTE_STATUS_LABELS[r.data.status] || r.data.status}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao consultar a situação');
    } finally {
      setBusy('');
    }
  };

  const submitCancel = async (doc) => {
    setBusy('cancel');
    try {
      const r = await api.cancelCte(doc.id, justificativa);
      replaceInList(r.data);
      setCancelOpen(false);
      setJustificativa('');
      toast.success(r.data.status === 'CANCELADO' ? 'CT-e cancelado' : 'Cancelamento enviado, aguardando a Sefaz');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao cancelar o CT-e');
    } finally {
      setBusy('');
    }
  };

  const remove = async (doc) => {
    const note = doc.numero ? ` O número ${doc.numero} ficará sem uso.` : '';
    if (!(await confirm(`Excluir este CT-e (${CTE_STATUS_LABELS[doc.status]})?${note}`))) return;
    try {
      await api.deleteCte(doc.id);
      setSelectedIds(new Set());
      toast.success('CT-e excluído');
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao excluir');
    }
  };

  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAllOnPage = () => {
    const pageIds = pageItems.map((c) => c.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const selected = selectedIds.size === 1 ? list.find((c) => c.id === [...selectedIds][0]) : null;
  const isEditable = selected && CTE_EDITABLE.includes(selected.status);
  const isDone = selected && ['AUTORIZADO', 'CANCELADO'].includes(selected.status);
  // MDF-e: um ou mais CT-es autorizados da mesma viagem
  const selectedDocs = list.filter((c) => selectedIds.has(c.id));
  const canManifest = selectedDocs.length > 0 && selectedDocs.every((c) => c.status === 'AUTORIZADO');
  const count = (statuses) => filtered.filter((c) => statuses.includes(c.status)).length;
  const hasFilters = !!(search || statusFilter);
  const editingDoc = editingId ? list.find((c) => c.id === editingId) : null;
  const emittedDoc = emitted ? (list.find((c) => c.id === emitted.id) || emitted) : null;
  const notReady = settings && (!settings.provider_configured || !settings.provider_synced_at || !settings.certificate);

  const hasComponents = form.componentes.some((c) => toNumber(c.valor) !== null);
  const total = toNumber(form.valor_total) || 0;
  const icmsRate = ICMS_WITH_RATE.includes(form.icms_cst) ? (toNumber(form.icms_aliquota) || 0) : 0;
  const icmsValue = Math.round(total * icmsRate) / 100;
  const nfeCount = form.documentos.filter((d) => d.tipo === 'NFE' && onlyDigits(d.chave)).length;
  const otherDocCount = form.documentos.filter((d) => d.tipo === 'OUTROS' && (d.descricao || d.numero)).length;
  // Peso bruto total pelas quantidades em KG e TON
  const pesoKg = form.quantidades.reduce((sum, q) => sum + (toNumber(q.quantidade) || 0) * ({ '01': 1, '02': 1000 }[q.unidade] || 0), 0);
  const placeLabel = (p) => (p?.cidade ? `${p.cidade}/${p.uf}` : '-');
  const emitting = busy === 'emit' || busy === 'wait';

  return (
    <Layout>
      <div className="space-y-4" data-testid="cte-page">
        <input ref={xmlInputRef} type="file" accept=".xml,text/xml,application/xml" multiple className="hidden" data-testid="cte-xml-input"
          onChange={(e) => { importXml(e.target.files); e.target.value = ''; }} />
        <PageHeader
          icon={FileCheck}
          title="CT-e"
          subtitle="Conhecimento de Transporte Eletrônico emitido pela Focus NFe"
          actions={(
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/fiscal/mdfe')}><Truck className="w-4 h-4 mr-1.5" /> MDF-e</Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/fiscal/configuracao')} data-testid="cte-settings-btn">
                <FileCog className="w-4 h-4 mr-1.5" /> Configuração Fiscal
              </Button>
            </div>
          )}
        />

        {notReady && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 text-sm text-amber-900 dark:text-amber-200" data-testid="cte-not-ready">
            Antes de emitir, complete a <button type="button" className="underline font-semibold" onClick={() => navigate('/fiscal/configuracao')}>Configuração Fiscal</button>
            {!settings.provider_configured ? ' (emissor ainda não configurado no servidor)' : !settings.provider_synced_at ? ' (envie o cadastro da empresa ao emissor)' : ' (envie o certificado A1)'}.
          </div>
        )}
        {settings && settings.ambiente !== 'producao' && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Ambiente de <b>homologação</b>: os CT-e emitidos aqui não têm valor fiscal.</p>
        )}

        <StatGrid>
          <StatCard label="CT-e" value={filtered.length} icon={FileCheck} tone="blue" hint={hasFilters ? 'com os filtros atuais' : 'cadastrados'} />
          <StatCard label="Autorizados" value={count(['AUTORIZADO'])} icon={CheckCircle2} tone="primary" />
          <StatCard label="A transmitir / com pendência" value={count(['RASCUNHO', 'PENDENTE', 'REJEITADO', 'ERRO', 'ENVIANDO'])} icon={Clock} tone="amber" />
          <StatCard label="Cancelados" value={count(['CANCELADO', 'DENEGADO'])} icon={XCircle} tone="red" />
        </StatGrid>

        <FilterCard hasFilters={hasFilters} onClear={() => { setSearch(''); setStatusFilter(''); }}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Nº, cliente, container, chave ou nº da ordem" className="col-span-2">
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} data-testid="cte-search" />
            </FilterField>
            <FilterField label="Situação">
              <Select value={statusFilter || '_all'} onValueChange={(v) => setStatusFilter(v === '_all' ? '' : v)}>
                <SelectTrigger className="h-9 text-sm" data-testid="cte-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  {Object.entries(CTE_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </FilterCard>

        <DataCard
          title="Conhecimentos de transporte"
          count={loading ? '...' : filtered.length}
          toolbar={(
            <Toolbar
              selectedCount={selectedIds.size}
              primary={<ToolbarPrimary icon={Plus} label="Novo CT-e" onClick={openCreate} testId="cte-new-btn" />}
            >
              <ToolbarButton icon={PackageCheck} label="Da Ordem de Carregamento" tone="violet" onClick={() => setOrderDialogOpen(true)} testId="cte-from-order-btn" />
              <ToolbarButton icon={FileUp} label="Importar XML" tone="blue" onClick={() => xmlInputRef.current?.click()} testId="cte-import-xml-btn" />
              <ToolbarButton icon={Copy} label="Duplicar" tone="blue" onClick={() => openDuplicate(selected)} disabled={!selected} testId="cte-duplicate-btn" />
              <ToolbarDivider />
              <ToolbarButton icon={Pencil} label="Editar" tone="blue" onClick={() => openEdit(selected)} disabled={!isEditable} testId="cte-edit-btn" />
              <ToolbarButton icon={Send} label="Transmitir" tone="emerald" onClick={() => emit(selected)} disabled={!isEditable || !!busy} testId="cte-emit-btn" />
              <ToolbarButton icon={RefreshCw} label="Atualizar situação" tone="slate" onClick={() => refresh(selected)} disabled={!selected?.provider_id || !!busy} testId="cte-refresh-btn" />
              <ToolbarButton icon={Printer} label="DACTE" tone="emerald" onClick={() => download(selected, 'pdf')} disabled={!isDone || !!busy} testId="cte-pdf-btn" />
              <ToolbarButton icon={FileCode} label="XML" tone="slate" onClick={() => download(selected, 'xml')} disabled={!isDone || !!busy} testId="cte-xml-btn" />
              <ToolbarButton icon={Truck} label="Gerar MDF-e" tone="violet" onClick={() => navigate(`/fiscal/mdfe?ctes=${selectedDocs.map((c) => c.id).join(',')}`)} disabled={!canManifest} testId="cte-mdfe-btn" />
              <ToolbarButton icon={Ban} label="Cancelar CT-e" tone="red" onClick={() => setCancelOpen(true)} disabled={selected?.status !== 'AUTORIZADO'} testId="cte-cancel-btn" />
              <ToolbarButton icon={Trash2} label="Excluir" tone="red" onClick={() => remove(selected)} disabled={!isEditable} testId="cte-delete-btn" />
            </Toolbar>
          )}
          footer={<TablePagination {...paginationProps} />}
        >
          {filtered.length === 0 && !loading ? (
            <EmptyState
              icon={FileCheck}
              title={hasFilters ? 'Nenhum CT-e encontrado' : 'Nenhum CT-e emitido'}
              hint={hasFilters ? 'Ajuste os filtros' : 'Crie o primeiro pelo "Novo CT-e" ou a partir de uma Ordem de Carregamento'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 pr-0">
                      <Checkbox checked={pageItems.length > 0 && pageItems.every((c) => selectedIds.has(c.id))} onCheckedChange={toggleSelectAllOnPage} />
                    </th>
                    <th>Nº</th>
                    <th>Remetente</th>
                    <th>Destinatário</th>
                    <th>Percurso</th>
                    <th className="text-right">Valor</th>
                    <th>Situação</th>
                    <th>Ordem</th>
                    <th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((c) => (
                    <tr key={c.id} onClick={() => toggleSelect(c.id)} onDoubleClick={() => CTE_EDITABLE.includes(c.status) && openEdit(c)}
                      data-selected={selectedIds.has(c.id)} className="cursor-pointer" data-testid={`cte-row-${c.id}`}>
                      <td className="pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleSelect(c.id)} />
                      </td>
                      <td className="cell-strong whitespace-nowrap tabular-nums">
                        {c.numero ? `${c.numero}` : '-'}
                        {c.serie !== null && c.serie !== undefined && <span className="text-xs text-slate-400"> / {c.serie}</span>}
                      </td>
                      <td><div className="max-w-[200px] truncate" title={c.remetente?.nome || ''}>{c.remetente?.nome || '-'}</div></td>
                      <td><div className="max-w-[200px] truncate" title={c.destinatario?.nome || ''}>{c.destinatario?.nome || '-'}</div></td>
                      <td className="whitespace-nowrap">
                        {c.origem?.cidade ? `${c.origem.cidade}/${c.origem.uf}` : '-'} → {c.destino?.cidade ? `${c.destino.cidade}/${c.destino.uf}` : '-'}
                      </td>
                      <td className="text-right tabular-nums whitespace-nowrap">{fmtMoney(c.valor_total)}</td>
                      <td>
                        <StatusPill tone={CTE_STATUS_TONES[c.status] || 'slate'} title={c.motivo || c.chave || ''}>
                          {CTE_STATUS_LABELS[c.status] || c.status}
                        </StatusPill>
                        {c.ambiente === 'homologacao' && <span className="ml-1 text-[10px] text-slate-400 uppercase">homolog.</span>}
                        {c.mdfe_numero && <div className="text-[11px] text-slate-500">MDF-e nº {c.mdfe_numero}</div>}
                      </td>
                      <td className="tabular-nums">{c.loading_order_number ? `#${c.loading_order_number}` : '-'}</td>
                      <td className="whitespace-nowrap tabular-nums">{c.created_at ? format(new Date(c.created_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>
        {selected?.motivo && ['REJEITADO', 'ERRO', 'DENEGADO'].includes(selected.status) && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-4 py-3 text-sm text-red-800 dark:text-red-200" data-testid="cte-motivo">
            <b>Retorno da Sefaz / emissor:</b> {selected.motivo}
          </div>
        )}
        {selected?.chave && (
          <p className="text-xs text-slate-500 font-mono" data-testid="cte-chave">Chave: {selected.chave}{selected.protocolo ? ` · Protocolo: ${selected.protocolo}` : ''}</p>
        )}
      </div>

      {/* Escolha da Ordem de Carregamento */}
      <Dialog open={orderDialogOpen} onOpenChange={setOrderDialogOpen}>
        <DialogContent className="max-w-lg" data-testid="cte-order-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><PackageCheck className="w-5 h-5 text-primary" /> CT-e a partir da Ordem de Carregamento</DialogTitle>
          </DialogHeader>
          <Field label="Ordem de Carregamento" hint="Digite o número, o cliente ou o container">
            <Autocomplete
              value={orderText}
              onChange={setOrderText}
              options={orders.filter((o) => o.status !== 'CANCELADA')}
              displayField={(o) => `#${o.order_number} · ${o.client_name || 'sem cliente'} · ${(o.items || []).map((i) => i.container_number).filter(Boolean).join(', ') || '-'}`}
              onSelect={openFromOrder}
              testId="cte-order-input"
            />
          </Field>
        </DialogContent>
      </Dialog>

      {/* Cancelamento */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-lg" data-testid="cte-cancel-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Ban className="w-5 h-5 text-red-600" /> Cancelar CT-e nº {selected?.numero}</DialogTitle>
          </DialogHeader>
          <Field label="Justificativa" required hint={`${justificativa.trim().length}/255 - mínimo 15 caracteres. O prazo de cancelamento na Sefaz é curto (em geral 7 dias).`}>
            <Textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value.slice(0, 255))} rows={3} data-testid="cte-cancel-reason" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Voltar</Button>
            <Button variant="destructive" onClick={() => submitCancel(selected)} disabled={busy === 'cancel' || justificativa.trim().length < 15} data-testid="cte-cancel-confirm">
              {busy === 'cancel' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Cancelar CT-e
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Formulário: uma página só, na ordem do conhecimento */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!emitting) setDialogOpen(open); }}>
        <DialogContent className="max-w-6xl max-h-[94vh] flex flex-col gap-0 p-0" data-testid="cte-dialog">
          <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <FileCheck className="w-5 h-5 text-primary" />
              {emittedDoc ? `CT-e nº ${emittedDoc.numero || '-'}` : editingId ? 'Editar CT-e' : 'Novo CT-e'}
              {!emittedDoc && form.loading_order_number && <span className="text-sm font-normal text-slate-500">· Ordem de Carregamento #{form.loading_order_number}</span>}
              {!emittedDoc && settings && settings.ambiente !== 'producao' && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Homologação</span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4" key={formKey}>
            {emittedDoc ? (
              <div className="py-6 space-y-5 text-center" data-testid="cte-emitted">
                {emittedDoc.status === 'AUTORIZADO'
                  ? <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600" />
                  : <Clock className="w-12 h-12 mx-auto text-amber-500" />}
                <div className="space-y-1">
                  <p className="text-lg font-semibold">
                    {emittedDoc.status === 'AUTORIZADO' ? `CT-e nº ${emittedDoc.numero} autorizado` : `CT-e ${(CTE_STATUS_LABELS[emittedDoc.status] || emittedDoc.status).toLowerCase()}`}
                  </p>
                  {emittedDoc.status === 'PENDENTE' && <p className="text-sm text-slate-500">A Sefaz ainda não respondeu. Consulte de novo em instantes.</p>}
                  {emittedDoc.chave && <p className="text-xs font-mono text-slate-500 break-all">Chave: {emittedDoc.chave}{emittedDoc.protocolo ? ` · Protocolo: ${emittedDoc.protocolo}` : ''}</p>}
                  {emittedDoc.motivo && emittedDoc.status !== 'AUTORIZADO' && <p className="text-sm text-red-700 dark:text-red-300">{emittedDoc.motivo}</p>}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {emittedDoc.status === 'AUTORIZADO' ? (
                    <>
                      <Button onClick={() => download(emittedDoc, 'pdf')} disabled={!!busy} data-testid="cte-emitted-pdf">
                        {busy === 'pdf' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Printer className="w-4 h-4 mr-1.5" />} DACTE
                      </Button>
                      <Button variant="outline" onClick={() => download(emittedDoc, 'xml')} disabled={!!busy}><FileCode className="w-4 h-4 mr-1.5" /> XML</Button>
                      <Button variant="outline" onClick={() => navigate(`/fiscal/mdfe?ctes=${emittedDoc.id}`)} data-testid="cte-emitted-mdfe"><Truck className="w-4 h-4 mr-1.5" /> Gerar MDF-e</Button>
                    </>
                  ) : (
                    <Button variant="outline" onClick={() => refresh(emittedDoc)} disabled={!!busy}>
                      {busy === 'refresh' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />} Atualizar situação
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => openDuplicate(emittedDoc)} data-testid="cte-emitted-duplicate"><Copy className="w-4 h-4 mr-1.5" /> Duplicar</Button>
                  <Button variant="outline" onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" /> Novo CT-e</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-7">
                {editingDoc?.motivo && ['REJEITADO', 'ERRO'].includes(editingDoc.status) && (
                  <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-800 dark:text-red-200">
                    <b>Último retorno:</b> {editingDoc.motivo}
                  </div>
                )}

                <Section id="basicos" title="Dados básicos" count={issuesIn('basicos')}
                  actions={(
                    <Button type="button" variant="outline" size="sm" onClick={() => xmlInputRef.current?.click()} data-testid="cte-form-import-xml">
                      <FileUp className="w-3.5 h-3.5 mr-1" /> Enviar XML (NF-e / CT-e)
                    </Button>
                  )}>
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <Field label="CFOP" required className="md:col-span-5" hint="5xxx/6xxx ajustado pelo percurso (dentro da UF / interestadual)">
                      <Select value={form.cfop} onValueChange={(v) => set('cfop', v)}>
                        <SelectTrigger data-testid="cte-cfop"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CFOP_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Natureza da Operação" required className="md:col-span-5">
                      <Input value={form.natureza_operacao} onChange={(e) => set('natureza_operacao', e.target.value.toUpperCase())} maxLength={60} />
                    </Field>
                    <Field label="Ordem de Carregamento" className="md:col-span-2">
                      <Input value={form.loading_order_number ? `#${form.loading_order_number}` : ''} placeholder="Sem vínculo" readOnly className="bg-slate-50 dark:bg-slate-800" />
                    </Field>
                  </div>
                </Section>

                <Section id="envolvidos" title="Envolvidos" count={issuesIn('envolvidos')}>
                  <PartyFields title="Remetente" value={form.remetente} onChange={(v) => set('remetente', v)} clients={clients} testId="cte-remetente" />
                  <PartyFields title="Destinatário" value={form.destinatario} onChange={(v) => set('destinatario', v)} clients={clients} testId="cte-destinatario" />
                  {form.tomador_papel === '4' && (
                    <PartyFields title="Tomador (outro)" value={form.tomador} onChange={(v) => set('tomador', v)} clients={clients} testId="cte-tomador-outros" />
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <Field label="Pagador do frete" required className="md:col-span-8">
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 min-h-9">
                        <RadioGroup value={form.tomador_papel} onValueChange={(v) => set('tomador_papel', v)} className="flex flex-wrap gap-x-5 gap-y-2" data-testid="cte-tomador">
                          {TOMADOR_OPTIONS.map(([v, l]) => (
                            <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                              <RadioGroupItem value={v} data-testid={`cte-tomador-${v}`} /> {v === '4' ? 'Outro' : l}
                            </label>
                          ))}
                        </RadioGroup>
                        <label className="flex items-center gap-2 text-sm cursor-pointer sm:border-l sm:border-slate-200 sm:pl-5 dark:sm:border-slate-700">
                          <Checkbox checked={!form.percurso_auto} onCheckedChange={(c) => set('percurso_auto', !c)} data-testid="cte-percurso-manual" />
                          Início/Fim da Prestação
                        </label>
                      </div>
                    </Field>
                    <Field label="Tomador perante o ICMS" required className="md:col-span-4" hint="Sugerido pela IE do pagador">
                      <Select value={form.indicador_ie_tomador} onValueChange={(v) => set('indicador_ie_tomador', v)}>
                        <SelectTrigger data-testid="cte-ie-tomador"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {IE_TOMADOR_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  {form.percurso_auto ? (
                    <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="cte-percurso">
                      <MapPin className="inline w-4 h-4 mr-1 text-primary" />
                      Prestação: {placeLabel(form.origem)} → {placeLabel(form.destino)}
                      <span className="text-xs text-slate-500"> (cidades do remetente e do destinatário)</span>
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <div>
                        <p className="text-xs font-semibold text-slate-500 mb-1.5">Início da prestação</p>
                        <CityStateFields value={{ city: form.origem.cidade, state: form.origem.uf }}
                          onChange={(v) => set('origem', { cidade: v.city || '', uf: v.state || '', codigo_municipio: null })} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 mb-1.5">Fim da prestação</p>
                        <CityStateFields value={{ city: form.destino.cidade, state: form.destino.uf }}
                          onChange={(v) => set('destino', { cidade: v.city || '', uf: v.state || '', codigo_municipio: null })} />
                      </div>
                    </div>
                  )}
                </Section>

                <Section id="viagem" title="Motorista e veículo" count={issuesIn('viagem')}>
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <Field label="Motorista" className="md:col-span-6">
                      <Autocomplete value={form.motorista.nome || ''} options={drivers} displayField={(d) => d.name}
                        onChange={(t) => set('motorista', { ...form.motorista, nome: t.toUpperCase(), driver_id: null })}
                        onSelect={pickDriver} testId="cte-motorista" />
                    </Field>
                    <Field label="CPF do motorista" className="md:col-span-3">
                      <Input value={form.motorista.cpf || ''} onChange={(e) => set('motorista', { ...form.motorista, cpf: formatCnpjCpf(e.target.value).slice(0, 14) })} className="font-mono" data-testid="cte-motorista-cpf" />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Veículo principal (placa)">
                      <Autocomplete value={form.veiculo_placa || ''} options={vehicles} displayField={(v) => v.plate}
                        onChange={(t) => set('veiculo_placa', normPlate(t).slice(0, 7))} onSelect={pickTraction} testId="cte-veiculo" />
                    </Field>
                    {[0, 1].map((i) => (
                      <Field key={i} label={`Vinculado 0${i + 1} (placa)`}>
                        <Autocomplete value={form.reboque_placas[i] || ''} options={vehicles} displayField={(v) => v.plate}
                          onChange={(t) => setTrailer(i, normPlate(t).slice(0, 7))} onSelect={(v) => setTrailer(i, normPlate(v.plate))} testId={`cte-reboque-${i}`} />
                      </Field>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">O leiaute do CT-e não tem campo próprio para motorista, veículo, seguro e vale-pedágio: eles saem nas observações do DACTE e preenchem o MDF-e gerado deste CT-e.</p>
                </Section>

                <Section id="seguro" title="Seguro" count={issuesIn('seguro')}>
                  <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
                    <Field label="Responsável" className="md:col-span-2">
                      <Select value={form.seguro_responsavel} onValueChange={(v) => set('seguro_responsavel', v)}>
                        <SelectTrigger data-testid="cte-seguro-responsavel"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Emitente</SelectItem>
                          <SelectItem value="2">Contratante</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Seguradora" className="col-span-2 md:col-span-4">
                      <Input value={form.seguradora_nome || ''} onChange={(e) => set('seguradora_nome', e.target.value.toUpperCase())} maxLength={60} data-testid="cte-seguradora" />
                    </Field>
                    <Field label="CNPJ da seguradora" className="md:col-span-2">
                      <Input value={form.seguradora_cnpj || ''} onChange={(e) => set('seguradora_cnpj', formatCnpjCpf(e.target.value))} className="font-mono" />
                    </Field>
                    <Field label="Nº apólice" className="md:col-span-2">
                      <Input value={form.seguro_apolice || ''} onChange={(e) => set('seguro_apolice', e.target.value)} maxLength={20} />
                    </Field>
                    <Field label="Nº averbação" className="md:col-span-2">
                      <Input value={form.seguro_averbacao || ''} onChange={(e) => set('seguro_averbacao', e.target.value)} maxLength={40} data-testid="cte-averbacao" />
                    </Field>
                  </div>
                </Section>

                <Section id="documentos" title={`Documentos${nfeCount + otherDocCount ? ` (${nfeCount} NF-e${otherDocCount ? ` + ${otherDocCount} outro(s)` : ''})` : ''}`} count={issuesIn('documentos')}
                  actions={(
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => addRow('documentos', { tipo: 'NFE', chave: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> NF-e</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => addRow('documentos', { tipo: 'OUTROS', tipo_outros: '99', descricao: '', numero: '', data_emissao: '', valor: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Outro documento</Button>
                    </>
                  )}>
                  {form.documentos.map((d, i) => {
                    const key = onlyDigits(d.chave);
                    const keyState = d.tipo !== 'NFE' || !key ? null : accessKeyOk(key, '55') ? 'ok' : key.length < 44 ? 'short' : 'bad';
                    return (
                      <div key={i} className="flex gap-2 items-end">
                        {d.tipo === 'NFE' ? (
                          <Field label="NF-e - Chave de acesso (44 dígitos)" className="flex-1"
                            hint={keyState === 'ok' ? `NF-e nº ${Number(key.slice(25, 34))} · série ${Number(key.slice(22, 25))}` : keyState === 'short' ? `${key.length}/44 dígitos` : keyState === 'bad' ? 'Chave inválida: confira os dígitos' : undefined}>
                            <div className="relative">
                              <Input value={d.chave || ''} onChange={(e) => setRow('documentos', i, { chave: onlyDigits(e.target.value).slice(0, 44) })}
                                className={`font-mono pr-8 ${keyState === 'bad' ? 'border-red-400' : ''}`} data-testid={`cte-nfe-${i}`} />
                              {keyState === 'ok' && <CheckCircle2 className="absolute right-2.5 top-2.5 w-4 h-4 text-emerald-600" />}
                              {keyState === 'bad' && <AlertTriangle className="absolute right-2.5 top-2.5 w-4 h-4 text-red-500" />}
                            </div>
                          </Field>
                        ) : (
                          <>
                            <Field label="Tipo" className="w-36">
                              <Select value={d.tipo_outros || '99'} onValueChange={(v) => setRow('documentos', i, { tipo_outros: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="99">Outros</SelectItem>
                                  <SelectItem value="00">Declaração</SelectItem>
                                </SelectContent>
                              </Select>
                            </Field>
                            <Field label="Descrição" className="flex-1">
                              <Input value={d.descricao || ''} maxLength={100} onChange={(e) => setRow('documentos', i, { descricao: e.target.value })} />
                            </Field>
                            <Field label="Número" className="w-32">
                              <Input value={d.numero || ''} maxLength={20} onChange={(e) => setRow('documentos', i, { numero: e.target.value })} />
                            </Field>
                            <Field label="Emissão" className="w-40">
                              <Input type="date" value={d.data_emissao || ''} onChange={(e) => setRow('documentos', i, { data_emissao: e.target.value })} />
                            </Field>
                            <Field label="Valor (R$)" className="w-32">
                              <Input inputMode="decimal" value={d.valor || ''} onChange={(e) => setRow('documentos', i, { valor: e.target.value.replace(/[^\d,.]/g, '') })} />
                            </Field>
                          </>
                        )}
                        <RowRemove onClick={() => removeRow('documentos', i)} />
                      </div>
                    );
                  })}
                </Section>

                <Section id="carga" title="Totais da carga transportada" count={issuesIn('carga')}>
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-4">
                    <div className="lg:col-span-7 grid grid-cols-2 md:grid-cols-4 gap-3 content-start">
                      <Field label="Peso (kg)">
                        <Input value={pesoKg ? pesoKg.toLocaleString('pt-BR') : '0'} readOnly className="bg-slate-50 dark:bg-slate-800 text-right tabular-nums" data-testid="cte-peso-kg" />
                      </Field>
                      <Field label="Peso (ton)">
                        <Input value={(pesoKg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} readOnly className="bg-slate-50 dark:bg-slate-800 text-right tabular-nums" />
                      </Field>
                      <Field label="Valor total (R$)" className="col-span-2">
                        <Input inputMode="decimal" value={form.valor_carga} onChange={(e) => set('valor_carga', e.target.value.replace(/[^\d,.]/g, ''))} className="text-right" data-testid="cte-valor-carga" />
                      </Field>
                      <Field label="Produto predominante" required className="col-span-2">
                        <Input value={form.produto_predominante} onChange={(e) => set('produto_predominante', e.target.value.toUpperCase())} maxLength={60} />
                      </Field>
                      <Field label="Outras características" className="col-span-2">
                        <Input value={form.outras_caracteristicas || ''} onChange={(e) => set('outras_caracteristicas', e.target.value.toUpperCase())} maxLength={30} />
                      </Field>
                    </div>
                    <div className="lg:col-span-5 space-y-2 lg:border-l lg:border-slate-200 lg:pl-6 dark:lg:border-slate-700">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Quantidades <span className="text-red-500">*</span></p>
                        <Button type="button" variant="outline" size="sm" onClick={() => addRow('quantidades', { unidade: '01', tipo_medida: 'PESO BRUTO', quantidade: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Quantidade</Button>
                      </div>
                      {form.quantidades.map((q, i) => (
                        <div key={i} className="flex gap-2">
                          <Select value={q.unidade} onValueChange={(v) => setRow('quantidades', i, { unidade: v })}>
                            <SelectTrigger className="w-28" aria-label="Unidade"><SelectValue /></SelectTrigger>
                            <SelectContent>{UNIDADE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                          </Select>
                          <Input value={q.tipo_medida} maxLength={20} onChange={(e) => setRow('quantidades', i, { tipo_medida: e.target.value.toUpperCase() })} className="flex-1 min-w-0" aria-label="Tipo da medida" />
                          <Input inputMode="decimal" value={q.quantidade} onChange={(e) => setRow('quantidades', i, { quantidade: e.target.value.replace(/[^\d,.]/g, '') })} className="w-32 text-right" aria-label="Quantidade" data-testid={`cte-qtd-${i}`} />
                          <RowRemove onClick={() => removeRow('quantidades', i)} />
                        </div>
                      ))}
                    </div>
                  </div>
                </Section>

                <Section id="containers" title="Contêineres"
                  actions={<Button type="button" variant="outline" size="sm" onClick={() => addRow('containers', { numero: '', lacre: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Contêiner</Button>}>
                  {form.containers.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum contêiner. Os informados vão no CT-e como unidades de carga.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                      {form.containers.map((c, i) => (
                        <div key={i} className="flex gap-2 items-end">
                          <Field label={i === 0 ? 'Número' : undefined} className="flex-1">
                            <Input value={c.numero} onChange={(e) => setRow('containers', i, { numero: e.target.value.toUpperCase() })} className="font-mono" maxLength={20} aria-label="Container" />
                          </Field>
                          <Field label={i === 0 ? 'Lacre' : undefined} className="w-44">
                            <Input value={c.lacre || ''} onChange={(e) => setRow('containers', i, { lacre: e.target.value.toUpperCase() })} className="font-mono" maxLength={20} aria-label="Lacre" />
                          </Field>
                          <RowRemove onClick={() => removeRow('containers', i)} />
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section id="frete" title="Composição do frete" count={issuesIn('frete')}
                  actions={(
                    <>
                      {COMPONENT_PRESETS.filter(([nome]) => !form.componentes.some((c) => c.nome === nome)).map(([nome, label]) => (
                        <Button key={nome} type="button" variant="outline" size="sm" onClick={() => addRow('componentes', { nome, valor: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> {label}</Button>
                      ))}
                      <Button type="button" variant="ghost" size="sm" onClick={() => addRow('componentes', { nome: '', valor: '' })}><Plus className="w-3.5 h-3.5 mr-1" /> Nome livre</Button>
                    </>
                  )}>
                  {form.componentes.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {form.componentes.map((c, i) => (
                        <div key={i} className="flex gap-1 items-end">
                          <div className="flex-1 space-y-1.5 min-w-0">
                            <Input value={c.nome} maxLength={15} onChange={(e) => setRow('componentes', i, { nome: e.target.value.toUpperCase() })} className="h-7 text-xs font-semibold" aria-label="Nome do componente" />
                            <Input inputMode="decimal" value={c.valor} placeholder="0,00" onChange={(e) => setRow('componentes', i, { valor: e.target.value.replace(/[^\d,.]/g, '') })} className="text-right" aria-label="Valor do componente" data-testid={`cte-comp-${i}`} />
                          </div>
                          <RowRemove onClick={() => removeRow('componentes', i)} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                    <Field label="Total da prestação (R$)" required hint={hasComponents ? 'Soma da composição' : 'Ou use a composição'}>
                      <Input inputMode="decimal" value={form.valor_total} readOnly={hasComponents}
                        className={`text-right font-semibold ${hasComponents ? 'bg-slate-50 dark:bg-slate-800' : ''}`}
                        onChange={(e) => set('valor_total', e.target.value.replace(/[^\d,.]/g, ''))} data-testid="cte-valor-total" />
                    </Field>
                    <Field label="Valor a receber (R$)" hint="Vazio = igual ao total">
                      <Input inputMode="decimal" value={form.valor_receber} className="text-right" onChange={(e) => set('valor_receber', e.target.value.replace(/[^\d,.]/g, ''))} />
                    </Field>
                    <Field label="CST do ICMS" required className="col-span-2">
                      <Select value={form.icms_cst} onValueChange={(v) => set('icms_cst', v)}>
                        <SelectTrigger data-testid="cte-icms-cst"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ICMS_CST_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Alíquota (%)" required={ICMS_WITH_RATE.includes(form.icms_cst)}>
                      <Input inputMode="decimal" value={form.icms_aliquota} disabled={!ICMS_WITH_RATE.includes(form.icms_cst)} className="text-right"
                        onChange={(e) => set('icms_aliquota', e.target.value.replace(/[^\d,.]/g, ''))} data-testid="cte-icms-aliquota" />
                    </Field>
                    <Field label="Valor do ICMS" hint={icmsRate ? `Base ${fmtMoney(total)}` : undefined}>
                      <Input value={icmsRate ? fmtMoney(icmsValue) : '-'} readOnly className="bg-slate-50 dark:bg-slate-800 text-right tabular-nums" data-testid="cte-icms-valor" />
                    </Field>
                  </div>
                </Section>

                <Section id="pedagio" title="Vale-pedágio" count={issuesIn('pedagio')}
                  actions={<Button type="button" variant="outline" size="sm" onClick={() => addRow('vales_pedagio', emptyToll())} data-testid="cte-add-pedagio"><Plus className="w-3.5 h-3.5 mr-1" /> Vale-pedágio</Button>}>
                  {form.vales_pedagio.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum vale-pedágio nesta viagem.</p>
                  ) : form.vales_pedagio.map((v, i) => (
                    <div key={i} className="flex flex-wrap md:flex-nowrap gap-2 items-end">
                      <Field label={i === 0 ? 'Pago por' : undefined} className="w-36">
                        <Select value={v.pago_por} onValueChange={(val) => setRow('vales_pedagio', i, { pago_por: val })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{TOLL_PAYER_OPTIONS.map(([val, l]) => <SelectItem key={val} value={val}>{l}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                      <Field label={i === 0 ? 'Dispositivo' : undefined} className="w-28">
                        <Select value={v.tipo} onValueChange={(val) => setRow('vales_pedagio', i, { tipo: val })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{TOLL_TYPE_OPTIONS.map(([val, l]) => <SelectItem key={val} value={val}>{l}</SelectItem>)}</SelectContent>
                        </Select>
                      </Field>
                      <Field label={i === 0 ? 'Fornecedora' : undefined} className="flex-1 min-w-[10rem]">
                        <Input value={v.fornecedor_nome || ''} onChange={(e) => setRow('vales_pedagio', i, { fornecedor_nome: e.target.value.toUpperCase() })} maxLength={60} />
                      </Field>
                      <Field label={i === 0 ? 'CNPJ fornecedora' : undefined} className="w-44">
                        <Input value={v.fornecedor_cnpj || ''} onChange={(e) => setRow('vales_pedagio', i, { fornecedor_cnpj: formatCnpjCpf(e.target.value) })} className="font-mono" data-testid={`cte-pedagio-cnpj-${i}`} />
                      </Field>
                      <Field label={i === 0 ? 'Nº comprovante' : undefined} className="w-40">
                        <Input value={v.numero_comprovante || ''} onChange={(e) => setRow('vales_pedagio', i, { numero_comprovante: e.target.value })} maxLength={20} data-testid={`cte-pedagio-numero-${i}`} />
                      </Field>
                      <Field label={i === 0 ? 'Valor (R$)' : undefined} className="w-32">
                        <Input inputMode="decimal" value={v.valor || ''} onChange={(e) => setRow('vales_pedagio', i, { valor: e.target.value.replace(/[^\d,.]/g, '') })} className="text-right" data-testid={`cte-pedagio-valor-${i}`} />
                      </Field>
                      <RowRemove onClick={() => removeRow('vales_pedagio', i)} />
                    </div>
                  ))}
                </Section>

                <Section id="observacoes" title="Observações do conhecimento">
                  <Textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value.slice(0, 2000))} rows={3} />
                </Section>

                <Section id="conferencia" title="Conferência antes de transmitir">
                  {issues.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" data-testid="cte-conferencia-ok">
                      <CheckCircle2 className="w-4 h-4 shrink-0" /> Tudo certo para transmitir.
                    </div>
                  ) : (
                    <ul className="space-y-1.5" data-testid="cte-issues">
                      {issues.map((it, i) => (
                        <li key={i}>
                          <button type="button" onClick={() => scrollToSection(it.section)}
                            className="flex w-full items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span className="flex-1">{it.msg}</span>
                            <span className="shrink-0 text-xs opacity-80">{SECTION_LABELS[it.section]} ↑</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>
            )}
          </div>

          <DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 space-x-0 sm:space-x-0 border-t border-slate-100 px-4 sm:px-6 py-3 dark:border-slate-800">
            {!emittedDoc && (
              issues.length ? (
                <button type="button" onClick={() => scrollToSection('conferencia')} className="mr-auto flex items-center gap-1.5 text-sm font-medium text-amber-700 hover:underline dark:text-amber-300" data-testid="cte-issues-count">
                  <AlertTriangle className="w-4 h-4" /> {issues.length} pendência(s)
                </button>
              ) : (
                <span className="mr-auto flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="w-4 h-4" /> Pronto para transmitir</span>
              )
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={emitting}>Fechar</Button>
            {!emittedDoc && (
              <>
                <Button variant="outline" onClick={() => save()} disabled={saving || !!busy} data-testid="cte-save-btn">
                  {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />} Salvar rascunho
                </Button>
                <Button onClick={saveAndEmit} disabled={saving || !!busy} data-testid="cte-save-emit-btn">
                  {emitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
                  {busy === 'wait' ? 'Aguardando a Sefaz...' : 'Salvar e transmitir'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
