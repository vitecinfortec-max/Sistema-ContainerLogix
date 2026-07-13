import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';

export default function EditFlexTankMovementPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [destinationClientSearch, setDestinationClientSearch] = useState('');
  const [showDestinationClientDropdown, setShowDestinationClientDropdown] = useState(false);
  const [movementNumber, setMovementNumber] = useState(null);
  
  const [formData, setFormData] = useState({
    bag_number: '',
    bag_size: '',
    movement_date: '',
    movement_type: 'ENTRADA',
    client_id: '',
    client_name: '',
    destination_client_id: '',
    destination_client_name: '',
    container_number: '',
    observations: ''
  });

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const [movementRes, clientsRes] = await Promise.all([
        api.getFlexTankMovement(id),
        api.getClients()
      ]);
      
      const movement = movementRes.data;
      setMovementNumber(movement.movement_number);
      
      // Formatar data para input date
      const movementDate = new Date(movement.movement_date);
      const formattedDate = movementDate.toISOString().split('T')[0];
      
      setFormData({
        bag_number: movement.bag_number || '',
        bag_size: movement.bag_size || '',
        movement_date: formattedDate,
        movement_type: movement.movement_type || 'ENTRADA',
        client_id: movement.client_id || '',
        client_name: movement.client_name || '',
        destination_client_id: movement.destination_client_id || '',
        destination_client_name: movement.destination_client_name || '',
        container_number: movement.container_number || '',
        observations: movement.observations || ''
      });
      setClientSearch(movement.client_name || '');
      setDestinationClientSearch(movement.destination_client_name || '');
      
      setClients(clientsRes.data);
    } catch (error) {
      toast.error('Erro ao carregar movimentação');
      navigate('/flex-tank');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleClientSelect = (client) => {
    setFormData(prev => ({
      ...prev,
      client_id: client.id,
      client_name: client.name
    }));
    setClientSearch(client.name);
    setShowClientDropdown(false);
  };

  const handleDestinationClientSelect = (client) => {
    setFormData(prev => ({
      ...prev,
      destination_client_id: client.id,
      destination_client_name: client.name
    }));
    setDestinationClientSearch(client.name);
    setShowDestinationClientDropdown(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.bag_number) {
      toast.error('Número da bolsa é obrigatório');
      return;
    }
    
    if (!formData.bag_size) {
      toast.error('Tamanho da bolsa é obrigatório');
      return;
    }
    
    setSaving(true);
    
    try {
      await api.updateFlexTankMovement(id, {
        bag_number: formData.bag_number,
        bag_size: formData.bag_size,
        movement_date: new Date(formData.movement_date).toISOString(),
        movement_type: formData.movement_type,
        client_id: formData.client_id || null,
        destination_client_id: formData.destination_client_id || null,
        container_number: formData.container_number || null,
        observations: formData.observations || null
      });
      
      toast.success('Movimentação atualizada com sucesso!');
      navigate(`/flex-tank/movements/${id}`);
    } catch (error) {
      console.error('Erro ao atualizar movimentação:', error);
      toast.error('Erro ao atualizar movimentação');
    } finally {
      setSaving(false);
    }
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const filteredDestinationClients = clients.filter(c => 
    c.name.toLowerCase().includes(destinationClientSearch.toLowerCase())
  );

  const bagSizes = ['16.000L', '18.000L', '20.000L', '21.000L', '22.000L', '24.000L', 'Outro'];

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto" data-testid="edit-flex-tank-movement-page">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" onClick={() => navigate(`/flex-tank/movements/${id}`)} data-testid="back-btn">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Chivo, sans-serif' }}>
              Editar Movimentação #{movementNumber}
            </h1>
            <p className="text-muted-foreground mt-1">Edite os dados da movimentação</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Dados da Movimentação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="bag_number">Número da Bolsa *</Label>
                  <Input
                    id="bag_number"
                    value={formData.bag_number}
                    onChange={(e) => handleInputChange('bag_number', e.target.value.toUpperCase())}
                    placeholder="Ex: FT-001"
                    required
                    data-testid="bag-number-input"
                  />
                </div>
                
                <div>
                  <Label htmlFor="bag_size">Tamanho da Bolsa *</Label>
                  <Select
                    value={formData.bag_size}
                    onValueChange={(value) => handleInputChange('bag_size', value)}
                  >
                    <SelectTrigger data-testid="bag-size-select">
                      <SelectValue placeholder="Selecione o tamanho" />
                    </SelectTrigger>
                    <SelectContent>
                      {bagSizes.map(size => (
                        <SelectItem key={size} value={size}>{size}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="movement_date">Data *</Label>
                  <Input
                    id="movement_date"
                    type="date"
                    value={formData.movement_date}
                    onChange={(e) => handleInputChange('movement_date', e.target.value)}
                    required
                    data-testid="movement-date-input"
                  />
                </div>
                
                <div>
                  <Label htmlFor="movement_type">Tipo *</Label>
                  <Select
                    value={formData.movement_type}
                    onValueChange={(value) => handleInputChange('movement_type', value)}
                  >
                    <SelectTrigger data-testid="movement-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENTRADA">Entrada</SelectItem>
                      <SelectItem value="SAIDA">Saída</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="relative">
                  <Label htmlFor="client">Cliente</Label>
                  <Input
                    id="client"
                    value={clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      setShowClientDropdown(true);
                      if (!e.target.value) {
                        setFormData(prev => ({ ...prev, client_id: '', client_name: '' }));
                      }
                    }}
                    onFocus={() => setShowClientDropdown(true)}
                    onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                    placeholder="Buscar cliente..."
                    data-testid="client-input"
                  />
                  {showClientDropdown && filteredClients.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-auto">
                      {filteredClients.map(client => (
                        <div
                          key={client.id}
                          className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                          onMouseDown={() => handleClientSelect(client)}
                        >
                          {client.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                <div>
                  <Label htmlFor="container_number">Número do Container</Label>
                  <Input
                    id="container_number"
                    value={formData.container_number}
                    onChange={(e) => handleInputChange('container_number', e.target.value.toUpperCase())}
                    placeholder="Ex: MSKU1234567"
                    data-testid="container-number-input"
                  />
                </div>
                
                <div className="relative">
                  <Label htmlFor="destination_client">Cliente Destino</Label>
                  <Input
                    id="destination_client"
                    value={destinationClientSearch}
                    onChange={(e) => {
                      setDestinationClientSearch(e.target.value);
                      setShowDestinationClientDropdown(true);
                      if (!e.target.value) {
                        setFormData(prev => ({ ...prev, destination_client_id: '', destination_client_name: '' }));
                      }
                    }}
                    onFocus={() => setShowDestinationClientDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDestinationClientDropdown(false), 200)}
                    placeholder="Buscar cliente destino..."
                    data-testid="destination-client-input"
                  />
                  {showDestinationClientDropdown && filteredDestinationClients.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-auto">
                      {filteredDestinationClients.map(client => (
                        <div
                          key={client.id}
                          className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                          onMouseDown={() => handleDestinationClientSelect(client)}
                        >
                          {client.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                <Label htmlFor="observations">Observações</Label>
                <Textarea
                  id="observations"
                  value={formData.observations}
                  onChange={(e) => handleInputChange('observations', e.target.value)}
                  placeholder="Observações adicionais..."
                  rows={3}
                  data-testid="observations-input"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(`/flex-tank/movements/${id}`)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving} data-testid="save-btn">
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Salvar Alterações
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
