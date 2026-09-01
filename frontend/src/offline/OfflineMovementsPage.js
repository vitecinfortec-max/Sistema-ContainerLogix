import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  offlineMovements, offlineDrivers, offlineTransportCompanies, offlineClients, offlineShippingLines,
} from '../lib/offlineDb';

const SIZE_TYPES = ['20DC', '20RF', '20OT', '20FR', '40HC', '40RF', '40OT', '40FR', '40DRY'];

const EMPTY_FORM = {
  operation_type: 'ENTRADA',
  driver_name: '',
  driver_cpf: '',
  truck_plate: '',
  trailer_plate_1: '',
  transport_company: '',
  client_name: '',
  container_number: '',
  status: 'CHEIO',
  size_type: '20DC',
  shipping_line: '',
  seal: '',
  booking: '',
  observations: '',
};

export default function OfflineMovementsPage() {
  const [movements, setMovements] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);

  const load = async () => {
    setLoading(true);
    try {
      const [m, d, c, cl, sl] = await Promise.all([
        offlineMovements.list(),
        offlineDrivers.list(),
        offlineTransportCompanies.list(),
        offlineClients.list(),
        offlineShippingLines.list(),
      ]);
      setMovements(m);
      setDrivers(d);
      setCompanies(c);
      setClients(cl);
      setShippingLines(sl);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => {
    setEditing(null);
    setFormData(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (mv) => {
    setEditing(mv);
    setFormData({ ...EMPTY_FORM, ...mv });
    setShowForm(true);
  };

  const handleChange = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!formData.container_number) {
      toast.error('Número do container é obrigatório');
      return;
    }
    try {
      if (editing) {
        await offlineMovements.update(editing.id, formData);
      } else {
        await offlineMovements.create(formData);
      }
      setShowForm(false);
      load();
      toast.success('Registro salvo!');
    } catch (e) {
      toast.error('Erro ao salvar registro');
    }
  };

  const handleDelete = async (id) => {
    try {
      await offlineMovements.remove(id);
      load();
      toast.success('Removida!');
    } catch (e) {
      toast.error('Erro ao remover');
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Registro de Gate</h1>
      </div>

      <Button onClick={openNew} className="w-full" data-testid="movement-add-btn">
        <Plus className="w-4 h-4 mr-2" />
        Novo Registro
      </Button>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
      ) : movements.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Nenhum registro cadastrado ainda.</p>
      ) : (
        <div className="space-y-2">
          {movements.map((mv) => (
            <div key={mv.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={mv.operation_type === 'ENTRADA' ? 'default' : 'secondary'}>
                      {mv.operation_type === 'ENTRADA' ? 'ENTRADA' : 'SAÍDA'}
                    </Badge>
                    <span className="font-semibold">{mv.container_number}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {mv.status} • {mv.size_type} {mv.transport_company ? `• ${mv.transport_company}` : ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(mv)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(mv.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Registro' : 'Novo Registro'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={formData.operation_type} onValueChange={(v) => handleChange('operation_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ENTRADA">ENTRADA</SelectItem>
                  <SelectItem value="SAIDA">SAÍDA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Número do Container *</Label>
              <Input
                value={formData.container_number}
                onChange={(e) => handleChange('container_number', e.target.value.toUpperCase())}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(v) => handleChange('status', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHEIO">CHEIO</SelectItem>
                    <SelectItem value="VAZIO">VAZIO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tamanho/Tipo</Label>
                <Select value={formData.size_type} onValueChange={(v) => handleChange('size_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SIZE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Motorista</Label>
              <Select
                value={formData.driver_name || ''}
                onValueChange={(v) => {
                  const d = drivers.find((x) => x.name === v);
                  handleChange('driver_name', v);
                  handleChange('driver_cpf', d ? d.cpf : '');
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Placa Cavalo</Label>
                <Input value={formData.truck_plate} onChange={(e) => handleChange('truck_plate', e.target.value.toUpperCase())} />
              </div>
              <div>
                <Label>Placa Carreta</Label>
                <Input value={formData.trailer_plate_1} onChange={(e) => handleChange('trailer_plate_1', e.target.value.toUpperCase())} />
              </div>
            </div>

            <div>
              <Label>Transportadora</Label>
              <Select value={formData.transport_company || ''} onValueChange={(v) => handleChange('transport_company', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Cliente</Label>
              <Select value={formData.client_name || ''} onValueChange={(v) => handleChange('client_name', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Armador</Label>
              <Select value={formData.shipping_line || ''} onValueChange={(v) => handleChange('shipping_line', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {shippingLines.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Lacre</Label>
                <Input value={formData.seal} onChange={(e) => handleChange('seal', e.target.value)} />
              </div>
              <div>
                <Label>Booking</Label>
                <Input value={formData.booking} onChange={(e) => handleChange('booking', e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea value={formData.observations} onChange={(e) => handleChange('observations', e.target.value)} />
            </div>
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
