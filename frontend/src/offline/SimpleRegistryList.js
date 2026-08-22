import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../components/ui/dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

// Lista + formulário genéricos de CRUD local, usados pelas 4 abas de Cadastros
// Básicos no app Android offline (Motoristas, Transportadoras, Clientes, Armadores).
// `api` precisa expor { list, create, update, remove }; `fields` descreve os
// campos do formulário (key, label, required).
export default function SimpleRegistryList({ api, fields, titleField = 'name', emptyLabel }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      setItems(await api.list());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => {
    setEditing(null);
    setFormData({});
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setFormData(item);
    setShowForm(true);
  };

  const handleChange = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const missing = fields.find((f) => f.required && !formData[f.key]);
    if (missing) {
      toast.error(`${missing.label} é obrigatório`);
      return;
    }
    try {
      if (editing) {
        await api.update(editing.id, formData);
      } else {
        await api.create(formData);
      }
      setShowForm(false);
      load();
      toast.success('Salvo com sucesso!');
    } catch (e) {
      toast.error('Erro ao salvar');
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.remove(id);
      load();
      toast.success('Removido!');
    } catch (e) {
      toast.error('Erro ao remover');
    }
  };

  return (
    <div className="space-y-3">
      <Button onClick={openNew} className="w-full" data-testid="registry-add-btn">
        <Plus className="w-4 h-4 mr-2" />
        Adicionar
      </Button>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">{emptyLabel || 'Nenhum registro ainda.'}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <p className="font-medium">{item[titleField]}</p>
                {fields.slice(1).map((f) => item[f.key] ? (
                  <p key={f.key} className="text-xs text-muted-foreground">{f.label}: {item[f.key]}</p>
                ) : null)}
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => openEdit(item)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => handleDelete(item.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar' : 'Adicionar'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {fields.map((f) => (
              <div key={f.key}>
                <Label htmlFor={f.key}>{f.label}{f.required ? ' *' : ''}</Label>
                <Input
                  id={f.key}
                  value={formData[f.key] || ''}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
