import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { Save, ArrowLeft, Check, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNotifications } from '../hooks/useNotifications';
import ContainerPhotoUpload from '../components/ContainerPhotoUpload';
import { Autocomplete } from '../components/Autocomplete';

const AUTO_SAVE_KEY = 'containerlogix_movement_draft';

export default function NewMovementPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [drivers, setDrivers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [autoSaved, setAutoSaved] = useState(false);
  const [terminals, setTerminals] = useState([]);
  const [containerPhotos, setContainerPhotos] = useState(null);
  const [containerDamages, setContainerDamages] = useState([]);
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientInputRef = useRef(null);
  const { notifyNewMovement, requestPermission, permission } = useNotifications();
  
  const savedDraft = localStorage.getItem(AUTO_SAVE_KEY);
  const defaultValues = savedDraft ? JSON.parse(savedDraft) : {
    operation_type: 'ENTRADA',
    status: 'CHEIO',
    size_type: '20DC'
  };

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm({
    defaultValues
  });

  const formData = watch();
  const operationType = watch('operation_type');
  const status = watch('status');
  const sizeType = watch('size_type');
  const shippingLine = watch('shipping_line');
  const clientName = watch('client_name');
  const serviceType = watch('service_type');

  useEffect(() => {
    loadData();
    if (savedDraft) {
      toast.info('Rascunho recuperado automaticamente');
    }
    // Solicitar permissão de notificação ao entrar na página
    if (permission === 'default') {
      requestPermission();
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(formData));
      setAutoSaved(true);
      setTimeout(() => setAutoSaved(false), 2000);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [formData]);

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

  const loadData = async () => {
    setLoadingData(true);
    try {
      // Carregar todos os dados em paralelo
      const [driversRes, companiesRes, clientsRes, shippingLinesRes, serviceTypesRes, vehiclesRes, terminalsRes] = await Promise.all([
        api.getDrivers(),
        api.getTransportCompanies(),
        api.getClients(),
        api.getShippingLines(),
        api.getServiceTypes(),
        api.getVehicles({ per_page: 1000 }),
        api.getTerminals()
      ]);

      // Definir os dados com validação
      const driversData = Array.isArray(driversRes.data) ? driversRes.data : [];
      const companiesData = Array.isArray(companiesRes.data) ? companiesRes.data : [];
      const clientsData = Array.isArray(clientsRes.data) ? clientsRes.data : [];
      const shippingLinesData = Array.isArray(shippingLinesRes.data) ? shippingLinesRes.data : [];
      const serviceTypesData = Array.isArray(serviceTypesRes.data) ? serviceTypesRes.data : [];
      const vehiclesData = Array.isArray(vehiclesRes.data?.items) ? vehiclesRes.data.items : [];
      const terminalsData = Array.isArray(terminalsRes.data) ? terminalsRes.data : [];

      setDrivers(driversData);
      setCompanies(companiesData);
      setClients(clientsData);
      setShippingLines(shippingLinesData);
      setServiceTypes(serviceTypesData);
      setVehicles(vehiclesData);
      setTerminals(terminalsData);
      
      if (shippingLinesData.length === 0) {
        console.warn('[NewMovementPage] Nenhum armador encontrado!');
      }
    } catch (error) {
      console.error('[NewMovementPage] ERRO ao carregar dados:', error);
      console.error('[NewMovementPage] Detalhes:', error.response?.data || error.message);
      toast.error('Erro ao carregar dados. Por favor, recarregue a página.');
    } finally {
      setLoadingData(false);
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
        container_damages: containerDamages,
        inspection_notes: inspectionNotes
      };
      const response = await api.createMovement(payload);
      localStorage.removeItem(AUTO_SAVE_KEY);
      toast.success('Registro cadastrado com sucesso!');
      
      // Enviar notificação push
      notifyNewMovement(response.data);
      
      // Redireciona para a página de detalhes com parâmetro para abrir impressão automaticamente
      navigate(`/movements/${response.data.id}?autoprint=true`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao cadastrar registro');
    } finally {
      setLoading(false);
    }
  };

  const handleDriverChange = (driverName) => {
    setValue('driver_name', driverName);
    const driver = drivers.find(d => d.name.toLowerCase() === driverName.toLowerCase());
    if (driver) {
      setValue('driver_cpf', driver.cpf);

      // Veículo(s) cadastrados com esse motorista como responsável (Cadastro de Veículos)
      const driverVehicles = vehicles.filter(v => v.driver_id === driver.id);
      const truckVehicle = driverVehicles.find(v => v.vehicle_type === 'CAVALO' || v.vehicle_type === 'CAMINHÃO');
      const trailerVehicle = driverVehicles.find(v => v.vehicle_type === 'CARRETA');
      if (truckVehicle) setValue('truck_plate', truckVehicle.plate);
      if (trailerVehicle) setValue('trailer_plate_1', trailerVehicle.plate);

      if (truckVehicle || trailerVehicle) {
        toast.success('CPF e placas do veículo preenchidos automaticamente');
      } else {
        toast.success('CPF preenchido automaticamente');
      }
    }
  };

  const handleContainerNumberBlur = async (e) => {
    if (operationType !== 'SAIDA') return;
    const containerNumber = e.target.value.trim().toUpperCase();
    if (!containerNumber) return;
    try {
      const response = await api.getOpenEntryForContainer(containerNumber);
      const entry = response.data?.entry;
      if (!entry) return;

      setValue('size_type', entry.size_type);
      setValue('shipping_line', entry.shipping_line);
      if (entry.client_name) {
        setValue('client_name', entry.client_name);
        setClientSearch(entry.client_name);
      }
      if (entry.tare) setValue('tare', entry.tare);
      if (entry.booking) setValue('booking', entry.booking);
      if (entry.service_type) setValue('service_type', entry.service_type);

      toast.success(`Dados da entrada #${entry.transaction_id} preenchidos automaticamente`);
    } catch (error) {
      // Sem entrada em aberto para esse container — segue com preenchimento manual
    }
  };

  const handleCompanyChange = (companyName) => {
    setValue('transport_company', companyName);
    const company = companies.find(c => c.name.toLowerCase() === companyName.toLowerCase());
    if (company) {
      toast.success('Transportadora encontrada no cadastro');
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

  return (
    <Layout>
      {loadingData ? (
        <div className="flex items-center justify-center h-64" data-testid="loading-data">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Carregando dados...</p>
          </div>
        </div>
      ) : (
      <div className="max-w-5xl mx-auto" data-testid="new-movement-page">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Novo Registro
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[13px] text-slate-500 dark:text-slate-400">Registre uma nova entrada ou saída de contêiner</p>
              {autoSaved && (
                <span className="inline-flex items-center text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                  <Check className="w-3 h-3 mr-1" />
                  Salvo automaticamente
                </span>
              )}
            </div>
          </div>
          <Button variant="outline" onClick={() => navigate('/movements')} data-testid="back-button">
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
                    <SelectTrigger id="operation_type" data-testid="operation-type-select" className="h-12">
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
                    <SelectTrigger id="status" data-testid="status-select" className="h-12">
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
                  <Autocomplete
                    value={watch('driver_name') || ''}
                    onChange={handleDriverChange}
                    onSelect={(d) => handleDriverChange(d.name)}
                    options={drivers}
                    displayField="name"
                    placeholder="Digite para buscar motorista..."
                    className="h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="driver_cpf">CPF *</Label>
                  <Input
                    id="driver_cpf"
                    data-testid="driver-cpf-input"
                    {...register('driver_cpf', { required: true })}
                    className="h-12 font-mono"
                    placeholder="000.000.000-00"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="truck_plate">Placa do Cavalo *</Label>
                  <Autocomplete
                    value={watch('truck_plate') || ''}
                    onChange={handleTruckPlateChange}
                    onSelect={(v) => handleTruckPlateChange(v.plate)}
                    options={cavaloVehicles}
                    displayField="plate"
                    placeholder="Digite para buscar a placa..."
                    className="h-12 font-mono uppercase"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trailer_plate_1">Placa Carreta *</Label>
                  <Autocomplete
                    value={watch('trailer_plate_1') || ''}
                    onChange={handleTrailerPlateChange}
                    onSelect={(v) => handleTrailerPlateChange(v.plate)}
                    options={carretaVehicles}
                    displayField="plate"
                    placeholder="Digite para buscar a placa..."
                    className="h-12 font-mono uppercase"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="transport_company">Transportadora *</Label>
                  <Autocomplete
                    value={watch('transport_company') || ''}
                    onChange={handleCompanyChange}
                    onSelect={(c) => handleCompanyChange(c.name)}
                    options={companies}
                    displayField="name"
                    placeholder="Digite para buscar a transportadora..."
                    className="h-12"
                  />
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
                  <Input
                    id="container_number"
                    data-testid="container-number-input"
                    {...register('container_number', { required: true, onBlur: handleContainerNumberBlur })}
                    className="h-12 font-mono uppercase"
                    placeholder="ABCD1234567"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="size_type">Tamanho/Tipo *</Label>
                  <Select value={sizeType} onValueChange={(value) => setValue('size_type', value)}>
                    <SelectTrigger id="size_type" data-testid="size-type-select" className="h-12">
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
                  <Input
                    id="tare"
                    data-testid="tare-input"
                    {...register('tare')}
                    className="h-12 font-mono"
                    placeholder="Peso (opcional)"
                  />
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
                      <SelectValue placeholder={shippingLines.length === 0 ? "Nenhum armador cadastrado" : "Selecione o armador"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-80 overflow-y-auto">
                      {shippingLines.length === 0 ? (
                        <SelectItem value="none" disabled>Cadastre armadores primeiro</SelectItem>
                      ) : (
                        <>
                          {/* Se o armador atual (do rascunho) não estiver na lista, adiciona como opção */}
                          {shippingLine && !shippingLines.some(l => l.name === shippingLine) && (
                            <SelectItem key="current" value={shippingLine}>{shippingLine}</SelectItem>
                          )}
                          {shippingLines.map(line => (
                            <SelectItem key={line.id} value={line.name}>{line.name}</SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  {shippingLines.length === 0 && (
                    <p className="text-xs text-amber-600">Nenhum armador cadastrado. Vá em "Cadastro de Armadores" para adicionar.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="seal">Lacre</Label>
                  <Input
                    id="seal"
                    data-testid="seal-input"
                    {...register('seal')}
                    className="h-12 font-mono"
                    placeholder="Número do lacre (opcional)"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="genset">Genset</Label>
                  <Input
                    id="genset"
                    data-testid="genset-input"
                    {...register('genset')}
                    className="h-12 font-mono"
                    placeholder="Genset (opcional)"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="booking">Booking</Label>
                  <Input
                    id="booking"
                    data-testid="booking-input"
                    {...register('booking')}
                    className="h-12 font-mono"
                    placeholder="Número de booking (opcional)"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="origin_terminal">Terminal de Origem</Label>
                  <Autocomplete
                    value={watch('origin_terminal') || ''}
                    onChange={(v) => setValue('origin_terminal', v)}
                    onSelect={(t) => setValue('origin_terminal', t.name)}
                    options={terminals}
                    displayField="name"
                    placeholder="Digite para buscar o terminal..."
                    className="h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="service_value">
                    Valor do Serviço ({clientName === 'CARU Containers Brasil Locação' ? 'US$' : 'R$'})
                  </Label>
                  <Input
                    id="service_value"
                    data-testid="service-value-input"
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('service_value', { valueAsNumber: true })}
                    className="h-12 font-mono"
                    placeholder="0,00 (opcional)"
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
                    data-testid="invoice-number-input"
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
                    placeholder="Observações adicionais sobre o registro (opcional)"
                    rows={3}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <ContainerPhotoUpload
            damages={containerDamages}
            onDamagesChange={setContainerDamages}
            notes={inspectionNotes}
            onNotesChange={setInspectionNotes}
            disabled={loading}
          />

          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => navigate('/movements')} data-testid="cancel-button">
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="h-12 font-bold uppercase tracking-wide px-8" data-testid="save-button">
              {loading ? 'Salvando...' : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Salvar Registro
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
      )}

      <button
        onClick={() => navigate('/movements/new')}
        className="md:hidden fixed bottom-6 right-6 bg-primary text-primary-foreground rounded-full p-4 shadow-lg hover:bg-primary/90 transition-colors z-50"
        data-testid="fab-new-movement"
      >
        <Save className="w-6 h-6" />
      </button>
    </Layout>
  );
}
