import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Autocomplete } from '../components/Autocomplete';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Save, Loader2, Camera, Upload, X } from 'lucide-react';
import { formatContainerNumber } from '../lib/containerNumber';
import { compressImage } from '../lib/imageCompression';
import { VISTORIA_PHOTO_TYPES, MAX_VISTORIA_PHOTOS } from './NewContainerVistoriaPage';

const PHOTO_LABELS = VISTORIA_PHOTO_TYPES.reduce((acc, { value, label }) => {
  acc[value] = label;
  return acc;
}, {});

export default function EditContainerVistoriaPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [transportCompanies, setTransportCompanies] = useState([]);
  const [repairServices, setRepairServices] = useState([]);
  const [serviceSearch, setServiceSearch] = useState('');

  const [formData, setFormData] = useState({
    container_number: '',
    client_name: '',
    shipping_line: '',
    truck_plate: '',
    trailer_plate: '',
    transport_company: '',
    size_type: '20DC',
    tare: '',
    observations: '',
  });

  const [noDamage, setNoDamage] = useState(false);
  const [damageItems, setDamageItems] = useState([]);

  const [vistoriaNumber, setVistoriaNumber] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [newPhotoType, setNewPhotoType] = useState('front');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const [vistoriaRes, clientsRes, shippingLinesRes, vehiclesRes, companiesRes, serviceTypesRes] = await Promise.all([
        api.getContainerVistoria(id),
        api.getClients(),
        api.getShippingLines(),
        api.getVehicles({ per_page: 1000 }),
        api.getTransportCompanies(),
        api.getServiceTypes({ per_page: 1000 }),
      ]);

      const vistoria = vistoriaRes.data;
      setVistoriaNumber(vistoria.vistoria_number);
      setFormData({
        container_number: vistoria.container_number || '',
        client_name: vistoria.client_name || '',
        shipping_line: vistoria.shipping_line || '',
        truck_plate: vistoria.truck_plate || '',
        trailer_plate: vistoria.trailer_plate || '',
        transport_company: vistoria.transport_company || '',
        size_type: vistoria.size_type || '20DC',
        tare: vistoria.tare || '',
        observations: vistoria.observations || '',
      });
      setNoDamage(vistoria.no_damage || false);
      setDamageItems(vistoria.damage_items || []);
      setPhotos(vistoria.photos || []);

      setClients(clientsRes.data);
      setShippingLines(shippingLinesRes.data);
      setVehicles(Array.isArray(vehiclesRes.data) ? vehiclesRes.data : (vehiclesRes.data?.items || []));
      setTransportCompanies(companiesRes.data);
      setRepairServices(serviceTypesRes.data?.items || []);
    } catch (error) {
      toast.error('Erro ao carregar vistoria');
      navigate('/container-vistorias');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addService = (service) => {
    if (!service?.name) return;
    if (!damageItems.includes(service.name)) {
      setDamageItems(prev => [...prev, service.name]);
    }
    setServiceSearch('');
  };

  const removeService = (name) => {
    setDamageItems(prev => prev.filter((s) => s !== name));
  };

  const handleAddPhoto = async (file) => {
    if (!file) return;
    if (photos.length >= MAX_VISTORIA_PHOTOS) {
      toast.error(`Máximo de ${MAX_VISTORIA_PHOTOS} fotos por vistoria`);
      return;
    }

    setUploadingPhoto(true);
    try {
      const compressed = await compressImage(file);
      const response = await api.uploadContainerVistoriaPhoto(id, newPhotoType, compressed);
      setPhotos(prev => [...prev, response.data]);
      toast.success('Foto adicionada!');
    } catch (error) {
      toast.error('Erro ao enviar foto');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async (photoId) => {
    try {
      await api.deleteContainerVistoriaPhoto(id, photoId);
      setPhotos(prev => prev.filter(p => p.id !== photoId));
      toast.success('Foto removida!');
    } catch (error) {
      toast.error('Erro ao remover foto');
    }
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
      await api.updateContainerVistoria(id, {
        container_number: formData.container_number,
        client_name: formData.client_name || null,
        shipping_line: formData.shipping_line || null,
        truck_plate: formData.truck_plate || null,
        trailer_plate: formData.trailer_plate || null,
        transport_company: formData.transport_company || null,
        size_type: formData.size_type || null,
        tare: formData.tare || null,
        observations: formData.observations || null,
        no_damage: noDamage,
        damage_items: noDamage ? [] : damageItems,
      });

      toast.success('Vistoria atualizada com sucesso!');
      navigate(`/container-vistorias/${id}`);
    } catch (error) {
      console.error('Erro ao atualizar vistoria:', error);
      toast.error('Erro ao atualizar vistoria');
    } finally {
      setSaving(false);
    }
  };

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
      <div className="max-w-4xl mx-auto" data-testid="edit-container-vistoria-page">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" onClick={() => navigate(`/container-vistorias/${id}`)} data-testid="back-btn">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Editar Vistoria de Container #{vistoriaNumber}
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Edite as informações da vistoria</p>
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
                    onBlur={(e) => handleInputChange('container_number', formatContainerNumber(e.target.value))}
                    required
                    data-testid="container-number-input"
                  />
                </div>

                <div>
                  <Label htmlFor="client_name">Cliente</Label>
                  <Autocomplete
                    value={formData.client_name}
                    onChange={(v) => handleInputChange('client_name', v)}
                    onSelect={(c) => handleInputChange('client_name', c.name)}
                    options={clients}
                    displayField="name"
                  />
                </div>

                <div>
                  <Label htmlFor="shipping_line">Armador</Label>
                  <Select value={formData.shipping_line} onValueChange={(value) => handleInputChange('shipping_line', value)}>
                    <SelectTrigger id="shipping_line" data-testid="shipping-line-select">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {shippingLines.map((line) => (
                        <SelectItem key={line.id} value={line.name}>{line.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                  <Label htmlFor="tare">Tara</Label>
                  <Input
                    id="tare"
                    value={formData.tare}
                    onChange={(e) => handleInputChange('tare', e.target.value)}
                    data-testid="tare-input"
                  />
                </div>

                <div>
                  <Label htmlFor="truck_plate">Placa do Cavalo</Label>
                  <Autocomplete
                    value={formData.truck_plate}
                    onChange={(v) => handleInputChange('truck_plate', v.toUpperCase())}
                    onSelect={(v) => handleInputChange('truck_plate', v.plate)}
                    options={vehicles}
                    displayField="plate"
                  />
                </div>

                <div>
                  <Label htmlFor="trailer_plate">Carreta</Label>
                  <Autocomplete
                    value={formData.trailer_plate}
                    onChange={(v) => handleInputChange('trailer_plate', v.toUpperCase())}
                    onSelect={(v) => handleInputChange('trailer_plate', v.plate)}
                    options={vehicles}
                    displayField="plate"
                  />
                </div>

                <div>
                  <Label htmlFor="transport_company">Transportadora</Label>
                  <Autocomplete
                    value={formData.transport_company}
                    onChange={(v) => handleInputChange('transport_company', v)}
                    onSelect={(c) => handleInputChange('transport_company', c.name)}
                    options={transportCompanies}
                    displayField="name"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="observations">Observações</Label>
                <Textarea
                  id="observations"
                  value={formData.observations}
                  onChange={(e) => handleInputChange('observations', e.target.value)}
                  rows={4}
                  data-testid="observations-input"
                />
              </div>
            </CardContent>
          </Card>

          {/* Estado do Container */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Estado do Container</CardTitle>
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
                  Sem Avarias
                </Label>
              </div>

              {!noDamage && (
                <div>
                  <Label className="text-sm font-medium mb-2 block">Tipo de Serviços</Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Busque e adicione os serviços de reparo constatados na vistoria.
                  </p>
                  <Autocomplete
                    value={serviceSearch}
                    onChange={setServiceSearch}
                    onSelect={addService}
                    options={repairServices}
                    displayField="name"
                  />
                  {damageItems.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {damageItems.map((name) => (
                        <span
                          key={name}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-800 font-semibold text-sm"
                        >
                          {name}
                          <button type="button" onClick={() => removeService(name)} data-testid={`remove-service-${name}`}>
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Fotos da Vistoria */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Fotos da Vistoria ({photos.length}/{MAX_VISTORIA_PHOTOS})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-2 mb-4">
                <div className="w-56">
                  <Label htmlFor="new_photo_type">Tipo da foto</Label>
                  <Select value={newPhotoType} onValueChange={setNewPhotoType}>
                    <SelectTrigger id="new_photo_type" data-testid="new-photo-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VISTORIA_PHOTO_TYPES.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => triggerFileInput(true)}
                  disabled={uploadingPhoto || photos.length >= MAX_VISTORIA_PHOTOS}
                >
                  {uploadingPhoto ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                  Câmera
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => triggerFileInput(false)}
                  disabled={uploadingPhoto || photos.length >= MAX_VISTORIA_PHOTOS}
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
                          src={api.getFileUrl(photo.url)}
                          alt={PHOTO_LABELS[photo.type]}
                          className="w-full h-32 object-cover rounded-lg bg-gray-50 dark:bg-slate-800"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6"
                          onClick={() => handleRemovePhoto(photo.id)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-center font-medium mt-1">{PHOTO_LABELS[photo.type]}</p>
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
              onClick={() => navigate(`/container-vistorias/${id}`)}
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
