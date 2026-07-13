import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Camera, Upload, X, Save, Loader2 } from 'lucide-react';

export default function NewPhotoRegistryPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
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
    shipping_line_name: ''
  });
  
  const [photos, setPhotos] = useState({
    front: null,
    back: null,
    left: null,
    right: null
  });
  
  const [photoFiles, setPhotoFiles] = useState({
    front: null,
    back: null,
    left: null,
    right: null
  });
  
  const fileInputRefs = {
    front: useRef(null),
    back: useRef(null),
    left: useRef(null),
    right: useRef(null)
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

  const handlePhotoCapture = async (position) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      
      // Criar elemento de vídeo
      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();
      
      // Esperar o vídeo estar pronto
      await new Promise(resolve => {
        video.onloadedmetadata = resolve;
      });
      
      // Criar canvas e capturar frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      // Parar stream
      stream.getTracks().forEach(track => track.stop());
      
      // Converter para blob
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      const file = new File([blob], `${position}.jpg`, { type: 'image/jpeg' });
      
      // Criar URL para preview
      const url = URL.createObjectURL(blob);
      
      setPhotos(prev => ({ ...prev, [position]: url }));
      setPhotoFiles(prev => ({ ...prev, [position]: file }));
      
      toast.success('Foto capturada com sucesso!');
    } catch (error) {
      console.error('Erro ao capturar foto:', error);
      toast.error('Erro ao acessar câmera. Tente importar uma imagem.');
    }
  };

  const handleFileSelect = (position, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      toast.error('Por favor, selecione uma imagem');
      return;
    }
    
    const url = URL.createObjectURL(file);
    setPhotos(prev => ({ ...prev, [position]: url }));
    setPhotoFiles(prev => ({ ...prev, [position]: file }));
  };

  const handleRemovePhoto = (position) => {
    if (photos[position]) {
      URL.revokeObjectURL(photos[position]);
    }
    setPhotos(prev => ({ ...prev, [position]: null }));
    setPhotoFiles(prev => ({ ...prev, [position]: null }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.container_number) {
      toast.error('Número do container é obrigatório');
      return;
    }
    
    setSaving(true);
    
    try {
      // Criar registro
      const response = await api.createPhotoRegistry({
        container_number: formData.container_number,
        container_seal: formData.container_seal || null,
        collection_terminal: formData.collection_terminal || null,
        booking: formData.booking || null,
        client_id: formData.client_id || null,
        shipping_line_id: formData.shipping_line_id || null
      });
      
      const registryId = response.data.id;
      
      // Upload das fotos
      const uploadPromises = [];
      for (const [position, file] of Object.entries(photoFiles)) {
        if (file) {
          uploadPromises.push(
            api.uploadPhotoRegistryPhoto(registryId, position, file)
          );
        }
      }
      
      if (uploadPromises.length > 0) {
        await Promise.all(uploadPromises);
      }
      
      toast.success('Registro fotográfico criado com sucesso!');
      navigate(`/photo-registries/${registryId}`);
    } catch (error) {
      console.error('Erro ao criar registro:', error);
      toast.error('Erro ao criar registro fotográfico');
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

  const photoPositions = [
    { key: 'front', label: 'Frente' },
    { key: 'back', label: 'Traseira' },
    { key: 'left', label: 'Lateral Esquerda' },
    { key: 'right', label: 'Lateral Direita' }
  ];

  return (
    <Layout>
      <div className="max-w-4xl mx-auto" data-testid="new-photo-registry-page">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" onClick={() => navigate('/photo-registries')} data-testid="back-btn">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Chivo, sans-serif' }}>
              Novo Registro Fotográfico
            </h1>
            <p className="text-muted-foreground mt-1">Cadastre um novo registro de fotos</p>
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
            </CardContent>
          </Card>

          {/* Fotos */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Registro Fotográfico
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {photoPositions.map(({ key, label }) => (
                  <div key={key} className="border rounded-lg p-4">
                    <h4 className="font-semibold mb-3">{label}</h4>
                    
                    {photos[key] ? (
                      <div className="relative">
                        <img
                          src={photos[key]}
                          alt={label}
                          className="w-full h-48 object-cover rounded-lg"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-2 right-2"
                          onClick={() => handleRemovePhoto(key)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="h-48 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-4 bg-gray-50">
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handlePhotoCapture(key)}
                            data-testid={`capture-${key}-btn`}
                          >
                            <Camera className="w-4 h-4 mr-2" />
                            Tirar Foto
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => fileInputRefs[key].current?.click()}
                            data-testid={`upload-${key}-btn`}
                          >
                            <Upload className="w-4 h-4 mr-2" />
                            Importar
                          </Button>
                        </div>
                        <input
                          ref={fileInputRefs[key]}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleFileSelect(key, e)}
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
              onClick={() => navigate('/photo-registries')}
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
                  Salvar Registro
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
