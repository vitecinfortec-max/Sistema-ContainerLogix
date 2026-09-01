import { useState, useEffect, Fragment } from 'react';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Autocomplete } from './Autocomplete';
import { api } from '../lib/api';

const UF_OPTIONS = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'],
  ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'],
  ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'],
  ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'],
  ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'],
  ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'],
  ['SE', 'Sergipe'], ['TO', 'Tocantins'],
];

const formatCEP = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

const FieldLabel = ({ children }) => (
  <Label className="text-[12px] text-slate-500 dark:text-slate-400 mb-1 block uppercase tracking-wide">{children}</Label>
);

// Cidade/UF em cascata sozinho (sem rua/número/bairro/CEP) - pra telas que
// já têm seu próprio campo de endereço/logradouro e só precisam estruturar
// cidade+UF (ex: Ordem de Serviço, Abastecimento). Value shape: { city, state }.
// `flat` renderiza sem wrapper de grid (2 <div> soltas) pra encaixar como
// duas células dentro de um grid externo já existente, no lugar dos dois
// campos de texto livre que ela substitui.
export function CityStateFields({ value, onChange, cityLabel = 'Cidade', stateLabel = 'UF', flat = false }) {
  const v = value || {};
  const [cities, setCities] = useState([]);

  useEffect(() => {
    if (!v.state) { setCities([]); return; }
    api.getCitiesByUF(v.state)
      .then((r) => setCities(r.data || []))
      .catch(() => setCities([]));
  }, [v.state]);

  const setState = (val) => {
    const uf = val === '_empty' ? '' : val;
    onChange({ ...v, state: uf, city: '' });
  };

  const stateField = (
    <div>
      <FieldLabel>{stateLabel}</FieldLabel>
      <Select value={v.state || '_empty'} onValueChange={setState}>
        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {UF_OPTIONS.map(([uf, nome]) => (
            <SelectItem key={uf} value={uf} className="text-sm">{uf} - {nome}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const cityField = (
    <div className={flat ? '' : 'col-span-2'}>
      <FieldLabel>{cityLabel}</FieldLabel>
      <Autocomplete
        value={v.city || ''}
        onChange={(val) => onChange({ ...v, city: val })}
        options={cities}
        displayField={(c) => c}
        className="h-9 text-sm"
      />
    </div>
  );

  if (flat) {
    return <Fragment>{cityField}{stateField}</Fragment>;
  }
  return (
    <div className="grid grid-cols-3 gap-3">
      {stateField}
      {cityField}
    </div>
  );
}

// Bloco de endereço completo reutilizável (rua/número/bairro/CEP + cidade/UF
// em cascata, cidade filtrada pela UF via /api/locations). Value shape:
// { street, number, neighborhood, zip, city, state }. Mantido self-contained
// (não reaproveita CityStateFields) pra não alterar o layout já testado na
// Fase 2 - a duplicação da lógica de busca de cidades é pequena e aceitável.
export function AddressFields({ value, onChange }) {
  const v = value || {};
  const [cities, setCities] = useState([]);

  useEffect(() => {
    if (!v.state) { setCities([]); return; }
    api.getCitiesByUF(v.state)
      .then((r) => setCities(r.data || []))
      .catch(() => setCities([]));
  }, [v.state]);

  const set = (field, val) => onChange({ ...v, [field]: val });

  const setState = (val) => {
    const uf = val === '_empty' ? '' : val;
    onChange({ ...v, state: uf, city: '' });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <FieldLabel>Rua/Rodovia</FieldLabel>
          <Input value={v.street || ''} onChange={(e) => set('street', e.target.value)} className="h-9 text-sm" />
        </div>
        <div>
          <FieldLabel>Número</FieldLabel>
          <Input value={v.number || ''} onChange={(e) => set('number', e.target.value)} className="h-9 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel>Bairro</FieldLabel>
          <Input value={v.neighborhood || ''} onChange={(e) => set('neighborhood', e.target.value)} className="h-9 text-sm" />
        </div>
        <div>
          <FieldLabel>CEP</FieldLabel>
          <Input value={v.zip || ''} onChange={(e) => set('zip', formatCEP(e.target.value))} className="h-9 text-sm font-mono" maxLength={9} />
        </div>
        <div>
          <FieldLabel>UF</FieldLabel>
          <Select value={v.state || '_empty'} onValueChange={setState}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UF_OPTIONS.map(([uf, nome]) => (
                <SelectItem key={uf} value={uf} className="text-sm">{uf} - {nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <FieldLabel>Cidade</FieldLabel>
        <Autocomplete
          value={v.city || ''}
          onChange={(val) => set('city', val)}
          options={cities}
          displayField={(c) => c}
          className="h-9 text-sm"
        />
      </div>
    </div>
  );
}

export default AddressFields;
