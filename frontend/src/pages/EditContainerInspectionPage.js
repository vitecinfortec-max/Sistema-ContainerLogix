import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';

export default function EditContainerInspectionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [shippingLineSearch, setShippingLineSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [showShippingLineDropdown, setShowShippingLineDropdown] = useState(false);
  
  const [formData, setFormData] = useState({
    container_number: '',
    container_seal: '',
    collection_terminal: '',
    booking: '',
    client_id: '',
    client_name: '',
    shipping_line_id: '',
    shipping_line_name: '',
    observations: ''
  });
  
  const [inspectionNumber, setInspectionNumber] = useState(null);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const [inspectionRes, clientsRes, shippingLinesRes] = await Promise.all([
        api.getContainerInspection(id),
        api.getClients(),
        api.getShippingLines()
      ]);
      
      const inspection = inspectionRes.data;
      setInspectionNumber(inspection.inspection_number);
      setFormData({
        container_number: inspection.container_number || '',
        container_seal: inspection.container_seal || '',
        collection_terminal: inspection.collection_terminal || '',
        booking: inspection.booking || '',
        client_id: inspection.client_id || '',
        client_name: inspection.client_name || '',
        shipping_line_id: inspection.shipping_line_id || '',
        shipping_line_name: inspection.shipping_line_name || '',
        observations: inspection.observations || ''
      });
      setClientSearch(inspection.client_name || '');
      setShippingLineSearch(inspection.shipping_line_name || '');
      
      setClients(clientsRes.data);
      setShippingLines(shippingLinesRes.data);
    } catch (error) {
      toast.error('Erro ao carregar vistoria');
      navigate('/container-inspections');
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

  const handleShippingLineSelect = (line) => {
    setFormData(prev => ({
      ...prev,
      shipping_line_id: line.id,
      shipping_line_name: line.name
    }));
    setShippingLineSearch(line.name);
    setShowShippingLineDropdown(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.container_number) {
      toast.error('Número do container é obrigatório');
      return;
    }
    
    setSaving(true);
    
    try {
      await api.updateContainerInspection(id, {
        container_number: formData.container_number,
        container_seal: formData.container_seal || null,
        collection_terminal: formData.collection_terminal || null,
        booking: formData.booking || null,
        client_id: formData.client_id || null,
        shipping_line_id: formData.shipping_line_id || null,
        observations: formData.observations || null
      });
      
      toast.success('Vistoria atualizada com sucesso!');
      navigate(`/container-inspections/${id}`);
    } catch (error) {
      console.error('Erro ao atualizar vistoria:', error);
      toast.error('Erro ao atualizar vistoria');
    } finally {
      setSaving(false);
    }
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const filteredShippingLines = shippingLines.filter(l => 
    l.name.toLowerCase().includes(shippingLineSearch.toLowerCase())
  );

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
      <div className="max-w-4xl mx-auto" data-testid="edit-container-inspection-page">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" onClick={() => navigate(`/container-inspections/${id}`)} data-testid="back-btn">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Chivo, sans-serif' }}>
              Editar Vistoria #{inspectionNumber}
            </h1>
            <p className="text-muted-foreground mt-1">Edite as informações da vistoria de container</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Informações do Container */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Informações do Container</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="container_number">Número do Container *</Label>
                  <Input
                    id="container_number"
                    value={formData.container_number}
                    onChange={(e) => handleInputChange('container_number', e.target.value.toUpperCase())}
                    placeholder="Ex: MSKU1234567"
                    required
                    data-testid="container-number-input"
                  />
                </div>
                
                <div>
                  <Label htmlFor="container_seal">Numeração do Container</Label>
                  <Input
                    id="container_seal"
                    value={formData.container_seal}
                    onChange={(e) => handleInputChange('container_seal', e.target.value.toUpperCase())}
                    placeholder="Lacre / Numeração"
                    data-testid="container-seal-input"
                  />
                </div>
                
                <div>
                  <Label htmlFor="collection_terminal">Terminal de Coleta</Label>
                  <Input
                    id="collection_terminal"
                    value={formData.collection_terminal}
                    onChange={(e) => handleInputChange('collection_terminal', e.target.value)}
                    placeholder="Ex: Terminal Santos"
                    data-testid="collection-terminal-input"
                  />
                </div>
                
                <div>
                  <Label htmlFor="booking">Booking</Label>
                  <Input
                    id="booking"
                    value={formData.booking}
                    onChange={(e) => handleInputChange('booking', e.target.value)}
                    placeholder="Número do booking"
                    data-testid="booking-input"
                  />
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
                
                <div className="relative">
                  <Label htmlFor="shipping_line">Armador</Label>
                  <Input
                    id="shipping_line"
                    value={shippingLineSearch}
                    onChange={(e) => {
                      setShippingLineSearch(e.target.value);
                      setShowShippingLineDropdown(true);
                      if (!e.target.value) {
                        setFormData(prev => ({ ...prev, shipping_line_id: '', shipping_line_name: '' }));
                      }
                    }}
                    onFocus={() => setShowShippingLineDropdown(true)}
                    onBlur={() => setTimeout(() => setShowShippingLineDropdown(false), 200)}
                    placeholder="Buscar armador..."
                    data-testid="shipping-line-input"
                  />
                  {showShippingLineDropdown && filteredShippingLines.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-auto">
                      {filteredShippingLines.map(line => (
                        <div
                          key={line.id}
                          className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                          onMouseDown={() => handleShippingLineSelect(line)}
                        >
                          {line.name}
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
                  placeholder="Observações sobre a vistoria..."
                  rows={4}
                  data-testid="observations-input"
                />
              </div>
            </CardContent>
          </Card>

          {/* Botões de ação */}
          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(`/container-inspections/${id}`)}
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
