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

export const CONTAINER_INSPECTION_PHOTO_TYPES = [
  { value: 'front', label: 'Frente' },
  { value: 'back', label: 'Traseira' },
  { value: 'internal', label: 'Interno' },
  { value: 'left', label: 'Lateral Esquerda' },
  { value: 'right', label: 'Lateral Direita' },
];

export const MAX_CONTAINER_INSPECTION_PHOTOS = 8;

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

  const [photos, setPhotos] = useState([]); // { id, type, file }
  const [newPhotoType, setNewPhotoType] = useState('front');
  const fileInputRef = useRef(null);

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
      toast.error('Erro ao carregar dados');
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

  const handleAddPhoto = (file) => {
    if (!file) return;
    if (photos.length >= MAX_CONTAINER_INSPECTION_PHOTOS) {
      toast.error(`Máximo de ${MAX_CONTAINER_INSPECTION_PHOTOS} fotos por vistoria`);
      return;
    }
    setPhotos(prev => [...prev, { id: `local-${Date.now()}-${Math.random()}`, type: newPhotoType, file }]);
  };

  const handlePhotoRemove = (id) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
  };

  const triggerFileInput = (useCamera) => {
    const input = fileInputRef.current;
    if (!input) return;
    if (useCamera) {
      input.setAttribute('capture', 'environment');
    } else {
      input.removeAttribute('capture');
    }
    input.click();
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

      // Upload das fotos, cada uma com o tipo informado
      for (const photo of photos) {
        await api.uploadContainerInspectionPhoto(inspectionId, photo.type, photo.file);
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

  const photoLabels = CONTAINER_INSPECTION_PHOTO_TYPES.reduce((acc, { value, label }) => {
    acc[value] = label;
    return acc;
  }, {});

  return (
    <Layout>
      <div className="max-w-5xl mx-auto" data-testid="new-container-inspection-page">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" onClick={() => navigate('/container-inspections')} data-testid="back-btn">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Nova Vistoria de Container
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Preencha os dados da vistoria</p>
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
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-900 border rounded-md shadow-lg max-h-48 overflow-auto">
                      {filteredClients.map(client => (
                        <div
                          key={client.id}
                          className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer"
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
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-900 border rounded-md shadow-lg max-h-48 overflow-auto">
                      {filteredShippingLines.map(line => (
                        <div
                          key={line.id}
                          className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer"
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

          {/* Fotos do Container */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Fotos do Container ({photos.length}/{MAX_CONTAINER_INSPECTION_PHOTOS})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Adicione até {MAX_CONTAINER_INSPECTION_PHOTOS} fotos e informe o que cada uma representa.
              </p>

              <div className="flex flex-wrap items-end gap-2 mb-4">
                <div className="w-56">
                  <Label htmlFor="new_photo_type">Tipo da foto</Label>
                  <Select value={newPhotoType} onValueChange={setNewPhotoType}>
                    <SelectTrigger id="new_photo_type" data-testid="new-photo-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTAINER_INSPECTION_PHOTO_TYPES.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => triggerFileInput(true)}
                  disabled={photos.length >= MAX_CONTAINER_INSPECTION_PHOTOS}
                >
                  <Camera className="w-4 h-4 mr-2" />
                  Câmera
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => triggerFileInput(false)}
                  disabled={photos.length >= MAX_CONTAINER_INSPECTION_PHOTOS}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Galeria
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    handleAddPhoto(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                  data-testid="new-photo-input"
                />
              </div>

              {photos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma foto adicionada.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {photos.map((photo) => (
                    <div key={photo.id} className="border rounded-lg p-2">
                      <div className="relative">
                        <img
                          src={URL.createObjectURL(photo.file)}
                          alt={photoLabels[photo.type]}
                          className="w-full h-32 object-cover rounded-lg bg-gray-50 dark:bg-slate-800"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6"
                          onClick={() => handlePhotoRemove(photo.id)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-center font-medium mt-1">{photoLabels[photo.type]}</p>
                    </div>
                  ))}
                </div>
              )}
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
