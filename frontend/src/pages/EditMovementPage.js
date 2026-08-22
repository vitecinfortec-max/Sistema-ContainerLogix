import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Save, ArrowLeft, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import ContainerPhotoUpload from '../components/ContainerPhotoUpload';

export default function EditMovementPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingAux, setLoadingAux] = useState(true);
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [containerPhotos, setContainerPhotos] = useState(null);
  const [containerDamages, setContainerDamages] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientInputRef = useRef(null);
  const { register, handleSubmit, setValue, watch } = useForm();

  const operationType = watch('operation_type');
  const status = watch('status');
  const sizeType = watch('size_type');
  const shippingLine = watch('shipping_line');
  const clientName = watch('client_name');
  const serviceType = watch('service_type');

  useEffect(() => {
    loadMovement();
    loadAuxData();
  }, [id]);

  // Fechar dropdown quando clicar fora
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (clientInputRef.current && !clientInputRef.current.contains(event.target)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadMovement = async () => {
    try {
      const response = await api.getMovement(id);
      const movement = response.data;
      
      Object.keys(movement).forEach(key => {
        setValue(key, movement[key]);
      });
      
      // Carregar fotos existentes
      if (movement.container_photos) {
        setContainerPhotos(movement.container_photos);
      }

      // Carregar vistoria (avarias) existente
      if (movement.container_damages) {
        setContainerDamages(movement.container_damages);
      }
      
      // Atualizar o campo de busca do cliente
      if (movement.client_name) {
        setClientSearch(movement.client_name);
      }
    } catch (error) {
      console.error('[EditMovementPage] Erro ao carregar movimentação:', error);
      toast.error('Erro ao carregar movimentação');
      navigate('/movements');
    } finally {
      setLoadingData(false);
    }
  };

  const loadAuxData = async () => {
    setLoadingAux(true);
    try {
      const [clientsRes, shippingLinesRes, serviceTypesRes, vehiclesRes] = await Promise.all([
        api.getClients(),
        api.getShippingLines(),
        api.getServiceTypes(),
        api.getVehicles({ per_page: 1000 })
      ]);

      const clientsData = Array.isArray(clientsRes.data) ? clientsRes.data : [];
      const shippingLinesData = Array.isArray(shippingLinesRes.data) ? shippingLinesRes.data : [];
      const serviceTypesData = Array.isArray(serviceTypesRes.data) ? serviceTypesRes.data : [];
      const vehiclesData = Array.isArray(vehiclesRes.data?.items) ? vehiclesRes.data.items : [];

      setClients(clientsData);
      setShippingLines(shippingLinesData);
      setServiceTypes(serviceTypesData);
      setVehicles(vehiclesData);
    } catch (error) {
      console.error('[EditMovementPage] Erro ao carregar dados auxiliares:', error);
      toast.error('Erro ao carregar dados auxiliares');
    } finally {
      setLoadingAux(false);
    }
  };

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      // Determinar moeda baseada no cliente
      const currency = data.client_name === 'CARU Containers Brasil Locação' ? 'USD' : 'BRL';
      
      // Incluir fotos e moeda no payload
      const payload = {
        ...data,
        currency,
        container_photos: containerPhotos,
        container_damages: containerDamages
      };
      await api.updateMovement(id, payload);
      toast.success('Movimentação atualizada com sucesso!');
      navigate(`/movements/${id}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar movimentação');
    } finally {
      setLoading(false);
    }
  };

  const cavaloVehicles = vehicles.filter(v => v.vehicle_type === 'CAVALO');
  const carretaVehicles = vehicles.filter(v => v.vehicle_type === 'CARRETA');

  const handleTruckPlateChange = (plate) => {
    const upper = plate.toUpperCase();
    setValue('truck_plate', upper);
    const vehicle = cavaloVehicles.find(v => v.plate.toUpperCase() === upper);
    if (vehicle) {
      toast.success('Placa encontrada no cadastro de veículos');
    }
  };

  const handleTrailerPlateChange = (plate) => {
    const upper = plate.toUpperCase();
    setValue('trailer_plate_1', upper);
    const vehicle = carretaVehicles.find(v => v.plate.toUpperCase() === upper);
    if (vehicle) {
      toast.success('Placa encontrada no cadastro de veículos');
    }
  };

  if (loadingData) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto" data-testid="edit-movement-page">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Editar Movimentação
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Atualize as informações da movimentação</p>
          </div>
          <Button variant="outline" onClick={() => navigate(`/movements/${id}`)} data-testid="back-button">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader className="bg-slate-50 dark:bg-slate-800">
              <CardTitle className="text-lg">Tipo de Operação</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="operation_type">Tipo de Operação *</Label>
                  <Select value={operationType} onValueChange={(value) => setValue('operation_type', value)}>
                    <SelectTrigger id="operation_type" className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENTRADA">ENTRADA</SelectItem>
                      <SelectItem value="SAIDA">SAÍDA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status *</Label>
                  <Select value={status} onValueChange={(value) => setValue('status', value)}>
                    <SelectTrigger id="status" className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CHEIO">CHEIO</SelectItem>
                      <SelectItem value="VAZIO">VAZIO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-slate-50 dark:bg-slate-800">
              <CardTitle className="text-lg">Informações do Veículo e Motorista</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="driver_name">Nome do Motorista *</Label>
                  <Input id="driver_name" {...register('driver_name', { required: true })} className="h-12" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="driver_cpf">CPF *</Label>
                  <Input id="driver_cpf" {...register('driver_cpf', { required: true })} className="h-12 font-mono" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="truck_plate">Placa do Cavalo *</Label>
                  <Input
                    id="truck_plate"
                    {...register('truck_plate', { required: true })}
                    onChange={(e) => handleTruckPlateChange(e.target.value)}
                    className="h-12 font-mono uppercase"
                    list="trucks-list"
                  />
                  <datalist id="trucks-list">
                    {cavaloVehicles.map(vehicle => (
                      <option key={vehicle.id} value={vehicle.plate} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="trailer_plate_1">Placa Carreta *</Label>
                  <Input
                    id="trailer_plate_1"
                    {...register('trailer_plate_1', { required: true })}
                    onChange={(e) => handleTrailerPlateChange(e.target.value)}
                    className="h-12 font-mono uppercase"
                    list="trailers-list"
                  />
                  <datalist id="trailers-list">
                    {carretaVehicles.map(vehicle => (
                      <option key={vehicle.id} value={vehicle.plate} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transport_company">Transportadora *</Label>
                  <Input id="transport_company" {...register('transport_company', { required: true })} className="h-12" />
                </div>
                <div className="space-y-2 relative" ref={clientInputRef}>
                  <Label htmlFor="client_name">Cliente</Label>
                  <div className="relative">
                    <Input 
                      id="client_name" 
                      data-testid="client-name-input"
                      className="h-12 pr-10"
                      placeholder="Digite para buscar cliente..."
                      value={clientSearch}
                      onChange={(e) => {
                        setClientSearch(e.target.value);
                        setShowClientDropdown(true);
                        if (e.target.value === '') {
                          setValue('client_name', '');
                        }
                      }}
                      onFocus={() => setShowClientDropdown(true)}
                    />
                    {clientSearch && (
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-400"
                        onClick={() => {
                          setClientSearch('');
                          setValue('client_name', '');
                          setShowClientDropdown(false);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {showClientDropdown && clientSearch && (
                    <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-auto">
                      {clients
                        .filter(client => 
                          client.name.toLowerCase().includes(clientSearch.toLowerCase())
                        )
                        .slice(0, 10)
                        .map(client => (
                          <div
                            key={client.id}
                            className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer text-sm"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setClientSearch(client.name);
                              setValue('client_name', client.name);
                              setShowClientDropdown(false);
                            }}
                          >
                            {client.name}
                          </div>
                        ))
                      }
                      {clients.filter(client => 
                        client.name.toLowerCase().includes(clientSearch.toLowerCase())
                      ).length === 0 && (
                        <div className="px-4 py-2 text-sm text-gray-500 dark:text-slate-400">
                          Nenhum cliente encontrado
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Este campo aparece na impressão</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-slate-50 dark:bg-slate-800">
              <CardTitle className="text-lg">Informações do Contêiner</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="container_number">Nº Container *</Label>
                  <Input id="container_number" {...register('container_number', { required: true })} className="h-12 font-mono uppercase" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="size_type">Tamanho/Tipo *</Label>
                  <Select value={sizeType} onValueChange={(value) => setValue('size_type', value)}>
                    <SelectTrigger id="size_type" className="h-12">
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
                <div className="space-y-2">
                  <Label htmlFor="tare">Tara</Label>
                  <Input id="tare" {...register('tare')} className="h-12 font-mono" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="shipping_line">Armador *</Label>
                    <span className="text-xs text-muted-foreground">
                      {shippingLines.length > 0 ? `(${shippingLines.length} cadastrados)` : ''}
                    </span>
                  </div>
                  <Select value={shippingLine || ''} onValueChange={(value) => setValue('shipping_line', value)}>
                    <SelectTrigger id="shipping_line" data-testid="shipping-line-select" className="h-12">
                      <SelectValue placeholder={loadingAux ? "Carregando armadores..." : (shippingLines.length === 0 ? "Nenhum armador cadastrado" : "Selecione o armador")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-80 overflow-y-auto">
                      {loadingAux ? (
                        <SelectItem value="loading" disabled>Carregando...</SelectItem>
                      ) : shippingLines.length === 0 && !shippingLine ? (
                        <SelectItem value="none" disabled>Cadastre armadores primeiro</SelectItem>
                      ) : (
                        <>
                          {/* Se o armador atual não estiver na lista, adiciona como primeira opção */}
                          {shippingLine && !shippingLines.some(l => l.name === shippingLine) && (
                            <SelectItem key="current" value={shippingLine}>{shippingLine} (atual)</SelectItem>
                          )}
                          {shippingLines.map(line => (
                            <SelectItem key={line.id} value={line.name}>{line.name}</SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  {shippingLines.length === 0 && !shippingLine && (
                    <p className="text-xs text-amber-600">Nenhum armador cadastrado. Vá em "Cadastro de Armadores" para adicionar.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seal">Lacre</Label>
                  <Input id="seal" {...register('seal')} className="h-12 font-mono" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="genset">Genset</Label>
                  <Input id="genset" {...register('genset')} className="h-12 font-mono" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="booking">Booking</Label>
                  <Input id="booking" {...register('booking')} className="h-12 font-mono" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="service_value">
                    Valor do Serviço ({clientName === 'CARU Containers Brasil Locação' ? 'US$' : 'R$'})
                  </Label>
                  <Input
                    id="service_value"
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('service_value', { valueAsNumber: true })}
                    className="h-12 font-mono"
                    placeholder="0,00"
                  />
                  <p className="text-xs text-muted-foreground">Este valor aparecerá apenas no relatório de faturamento</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="service_type">Tipo de Serviço</Label>
                    <span className="text-xs text-muted-foreground">
                      {serviceTypes.length > 0 ? `(${serviceTypes.length} cadastrados)` : ''}
                    </span>
                  </div>
                  <Select value={serviceType || 'none'} onValueChange={(value) => setValue('service_type', value === 'none' ? '' : value)}>
                    <SelectTrigger id="service_type" data-testid="service-type-select" className="h-12">
                      <SelectValue placeholder={serviceTypes.length === 0 ? "Nenhum tipo cadastrado" : "Selecione o tipo de serviço"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-80 overflow-y-auto">
                      <SelectItem value="none">Nenhum</SelectItem>
                      {serviceTypes.map(st => (
                        <SelectItem key={st.id} value={st.name}>{st.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Este campo aparecerá no relatório de faturamento</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice_number">Nota Fiscal</Label>
                  <Input
                    id="invoice_number"
                    {...register('invoice_number')}
                    className="h-12 font-mono"
                    placeholder="Número da NF (opcional)"
                  />
                  <p className="text-xs text-muted-foreground">Este campo aparecerá no relatório de faturamento</p>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="observations">Observações</Label>
                  <textarea
                    id="observations"
                    data-testid="observations-input"
                    {...register('observations')}
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                    placeholder="Observações adicionais sobre a movimentação (opcional)"
                    rows={3}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <ContainerPhotoUpload
            photos={containerPhotos}
            onChange={setContainerPhotos}
            damages={containerDamages}
            onDamagesChange={setContainerDamages}
            disabled={loading}
          />

          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => navigate(`/movements/${id}`)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="h-12 font-bold uppercase tracking-wide px-8">
              {loading ? 'Salvando...' : (
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