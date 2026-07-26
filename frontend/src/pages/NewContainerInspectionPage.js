import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Save, Camera, Upload, X, Loader2, Plus } from 'lucide-react';
import { SUGGESTED_INSPECTION_ITEMS } from '../lib/inspectionItems';

export default function NewContainerInspectionPage() {
  const navigate = useNavigate();
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
    size_type: '20DC',
    collection_terminal: '',
    booking: '',
    client_id: '',
    client_name: '',
    shipping_line_id: '',
    shipping_line_name: '',
    observations: ''
  });

  const [noDamage, setNoDamage] = useState(false);
  const [damageItems, setDamageItems] = useState([]);
  const [customItem, setCustomItem] = useState('');

  const [photos, setPhotos] = useState({
    front: null,
    back: null,
    left: null,
    right: null,
    internal: null
  });

  const fileInputRefs = {
    front: useRef(null),
    back: useRef(null),
    left: useRef(null),
    right: useRef(null),
    internal: useRef(null)
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [clientsRes, shippingLinesRes] = await Promise.all([
        api.getClients(),
        api.getShippingLines()
      ]);
      setClients(clientsRes.data);
      setShippingLines(shippingLinesRes.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
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

  const handleToggleDamageItem = (item) => {
    setDamageItems(prev =>
      prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
    );
  };

  const handleAddCustomItem = () => {
    const value = customItem.trim();
    if (!value) return;
    if (!damageItems.includes(value)) {
      setDamageItems(prev => [...prev, value]);
    }
    setCustomItem('');
  };

  const handlePhotoSelect = (position, file) => {
    if (file) {
      setPhotos(prev => ({ ...prev, [position]: file }));
    }
  };

  const handlePhotoRemove = (position) => {
    setPhotos(prev => ({ ...prev, [position]: null }));
    if (fileInputRefs[position].current) {
      fileInputRefs[position].current.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.container_number) {
      toast.error('Número do container é obrigatório');
      return;
    }
    
    setSaving(true);
    
    try {
      // Criar inspeção
      const response = await api.createContainerInspection({
        container_number: formData.container_number,
        container_seal: formData.container_seal || null,
        size_type: formData.size_type || null,
        collection_terminal: formData.collection_terminal || null,
        booking: formData.booking || null,
        client_id: formData.client_id || null,
        shipping_line_id: formData.shipping_line_id || null,
        observations: formData.observations || null,
        no_damage: noDamage,
        damage_items: noDamage ? [] : damageItems
      });

      const inspectionId = response.data.id;
      
      // Upload das fotos
      const photoPositions = ['front', 'back', 'left', 'right', 'internal'];
      for (const position of photoPositions) {
        if (photos[position]) {
          await api.uploadContainerInspectionPhoto(inspectionId, position, photos[position]);
        }
      }
      
      toast.success('Vistoria criada com sucesso!');
      navigate(`/container-inspections/${inspectionId}`);
    } catch (error) {
      console.error('Erro ao criar vistoria:', error);
      toast.error('Erro ao criar vistoria');
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

  const photoLabels = {
    front: 'Frente',
    back: 'Traseira',
    left: 'Lateral Esquerda',
    right: 'Lateral Direita',
    internal: 'Interno'
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto" data-testid="new-container-inspection-page">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" onClick={() => navigate('/container-inspections')} data-testid="back-btn">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Chivo, sans-serif' }}>
              Nova Vistoria de Container
            </h1>
            <p className="text-muted-foreground mt-1">Preencha os dados da vistoria</p>
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
                  <Label htmlFor="container_seal">Numeração de Container</Label>
                  <Input
                    id="container_seal"
                    value={formData.container_seal}
                    onChange={(e) => handleInputChange('container_seal', e.target.value.toUpperCase())}
                    placeholder="Lacre / Numeração"
                    data-testid="container-seal-input"
                  />
                </div>

                <div>
                  <Label htmlFor="size_type">Tamanho/Tipo</Label>
                  <Select value={formData.size_type} onValueChange={(value) => handleInputChange('size_type', value)}>
                    <SelectTrigger id="size_type" data-testid="size-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20DC">20DC</SelectItem>
                      <SelectItem value="20RF">20RF</SelectItem>
                      <SelectItem value="20OT">20OT</SelectItem>
                      <SelectItem value="20FR">20FR</SelectItem>
                      <SelectItem value="40HC">40HC</SelectItem>
                      <SelectItem value="40RF">40RF</SelectItem>
                      <SelectItem value="40OT">40OT</SelectItem>
                      <SelectItem value="40FR">40FR</SelectItem>
                      <SelectItem value="40DRY">40DRY</SelectItem>
                    </SelectContent>
                  </Select>
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

          {/* Itens de Vistoria */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Itens de Vistoria</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="no_damage"
                  checked={noDamage}
                  onCheckedChange={(checked) => {
                    setNoDamage(checked === true);
                    if (checked) setDamageItems([]);
                  }}
                  data-testid="no-damage-checkbox"
                />
                <Label htmlFor="no_damage" className="cursor-pointer font-semibold">
                  Container sem avarias
                </Label>
              </div>

              {!noDamage && (
                <>
                  <div>
                    <Label className="mb-2 block">Marque os itens com avaria</Label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {Array.from(new Set([...SUGGESTED_INSPECTION_ITEMS, ...damageItems])).map(item => (
                        <div key={item} className="flex items-center gap-2">
                          <Checkbox
                            id={`damage-item-${item}`}
                            checked={damageItems.includes(item)}
                            onCheckedChange={() => handleToggleDamageItem(item)}
                          />
                          <Label htmlFor={`damage-item-${item}`} className="cursor-pointer font-normal">
                            {item}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Label htmlFor="custom_item">Adicionar item personalizado</Label>
                      <Input
                        id="custom_item"
                        value={customItem}
                        onChange={(e) => setCustomItem(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomItem();
                          }
                        }}
                        placeholder="Ex: Vazamento, Ferrugem localizada..."
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={handleAddCustomItem}>
                      <Plus className="w-4 h-4 mr-2" />
                      Adicionar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Fotos - Frente, Traseira, Interno */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Fotos do Container
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {['front', 'back', 'internal'].map(position => (
                  <div key={position} className="border rounded-lg p-4">
                    <h4 className="font-semibold mb-3">{photoLabels[position]}</h4>
                    {photos[position] ? (
                      <div className="relative">
                        <img
                          src={URL.createObjectURL(photos[position])}
                          alt={photoLabels[position]}
                          className="w-full h-48 object-contain rounded-lg bg-gray-50"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-2 right-2"
                          onClick={() => handlePhotoRemove(position)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="h-48 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 bg-gray-50">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => fileInputRefs[position].current?.click()}
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Importar
                        </Button>
                        <input
                          ref={fileInputRefs[position]}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handlePhotoSelect(position, e.target.files?.[0])}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              {/* Fotos Laterais */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {['left', 'right'].map(position => (
                  <div key={position} className="border rounded-lg p-4">
                    <h4 className="font-semibold mb-3">{photoLabels[position]}</h4>
                    {photos[position] ? (
                      <div className="relative">
                        <img
                          src={URL.createObjectURL(photos[position])}
                          alt={photoLabels[position]}
                          className="w-full h-48 object-contain rounded-lg bg-gray-50"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-2 right-2"
                          onClick={() => handlePhotoRemove(position)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="h-48 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 bg-gray-50">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => fileInputRefs[position].current?.click()}
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Importar
                        </Button>
                        <input
                          ref={fileInputRefs[position]}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handlePhotoSelect(position, e.target.files?.[0])}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Botões de ação */}
          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/container-inspections')}
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
                  Salvar Vistoria
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
