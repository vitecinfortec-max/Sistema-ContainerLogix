import { useState, useEffect } from 'react';
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

// Bloco de endereço reutilizável (rua/número/bairro/CEP + cidade/UF em
// cascata, cidade filtrada pela UF via /api/locations). Value shape:
// { street, number, neighborhood, zip, city, state }.
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
          <Input value={v.zip || ''} onChange={(e) => set('zip', formatCEP(e.target.value))} className="h-9 text-sm font-mono" placeholder="00000-000" maxLength={9} />
        </div>
        <div>
          <FieldLabel>UF</FieldLabel>
          <Select value={v.state || '_empty'} onValueChange={setState}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="-- UF --" /></SelectTrigger>
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
          placeholder={v.state ? 'Digite para buscar a cidade...' : 'Selecione a UF primeiro'}
          className="h-9 text-sm"
        />
      </div>
    </div>
  );
}

export default AddressFields;
