import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { PageSkeleton } from '../components/DataPage';
import { FormActions, FieldError } from '../components/FormKit';
import PageHeader from '../components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { ClientNamePicker } from '../components/ClientNamePicker';
import { toast } from 'sonner';
import { Save, Container as ContainerIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import ContainerPhotoUpload from '../components/ContainerPhotoUpload';
import { Autocomplete } from '../components/Autocomplete';
import ContainerValueFields from '../components/ContainerValueFields';
import { formatContainerNumber } from '../lib/containerNumber';

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
  const [terminals, setTerminals] = useState([]);
  const [containerPhotos, setContainerPhotos] = useState(null);
  const [containerDamages, setContainerDamages] = useState([]);
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [buyerSearch, setBuyerSearch] = useState('');
  const [servicePriceEntries, setServicePriceEntries] = useState([]);
  // Só true depois que o usuário troca cliente/serviço manualmente - evita
  // sobrescrever um Valor do Serviço já salvo assim que a página carrega os
  // dados existentes da movimentação.
  const userChangedPricingInputRef = useRef(false);
  const { register, handleSubmit, setValue, watch, getValues, formState: { errors } } = useForm();
  const [entryLocked, setEntryLocked] = useState({});

  const operationType = watch('operation_type');
  const status = watch('status');
  const sizeType = watch('size_type');
  const shippingLine = watch('shipping_line');
  const clientName = watch('client_name');
  const serviceType = watch('service_type');
  const existingCurrency = watch('currency');
  const containerValueCurrency = watch('container_value_currency');

  useEffect(() => {
    loadMovement();
    loadAuxData();
  }, [id]);

  // Numa Saída, o Valor do Container e a Data de Fabricação que a entrada do
  // container tiver preenchidos são puxados e ficam bloqueados; o que a
  // entrada deixou em branco continua livre pra informar na própria saída.
  const loadEntryLocked = useCallback(async (containerNumber, opType) => {
    if (!containerNumber || opType !== 'SAIDA') {
      setEntryLocked({});
      return;
    }
    try {
      const response = await api.getEntryLockedFields(containerNumber, id);
      const locked = response.data || {};
      Object.entries(locked).forEach(([field, value]) => setValue(field, value));
      setEntryLocked(locked);
    } catch (error) {
      setEntryLocked({});
    }
  }, [id, setValue]);

  useEffect(() => {
    if (loadingData) return;
    loadEntryLocked(getValues('container_number'), operationType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationType, loadingData]);


  // Carrega a tabela de preços do cliente selecionado (Comercial > Tabela de
  // Serviços), usada abaixo para preencher o Valor do Serviço automaticamente.
  useEffect(() => {
    if (!clientName) {
      setServicePriceEntries([]);
      return;
    }
    api.getServicePriceEntries({ client_name: clientName })
      .then((res) => setServicePriceEntries(res.data))
      .catch(() => setServicePriceEntries([]));
  }, [clientName]);

  // Preenche o Valor do Serviço automaticamente quando cliente + serviço
  // batem com uma entrada da Tabela de Serviços - só depois que o usuário
  // trocou um dos dois manualmente, nunca na primeira carga da movimentação.
  // Também guarda a moeda cadastrada nessa entrada (R$ ou $), usada no envio
  // do formulário no lugar da moeda antiga da movimentação.
  const [matchedCurrency, setMatchedCurrency] = useState(null);
  useEffect(() => {
    if (!userChangedPricingInputRef.current) return;
    if (!serviceType || servicePriceEntries.length === 0) return;
    const match = servicePriceEntries.find((e) => e.service_type_name === serviceType);
    if (match) {
      setValue('service_value', match.value);
      setMatchedCurrency(match.currency || 'BRL');
    }
  }, [serviceType, servicePriceEntries, setValue]);

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

      if (movement.inspection_notes) {
        setInspectionNotes(movement.inspection_notes);
      }

      // Atualizar o campo de busca do cliente
      if (movement.client_name) {
        setClientSearch(movement.client_name);
      }
      if (movement.buyer_name) {
        setBuyerSearch(movement.buyer_name);
      }
    } catch (error) {
      console.error('[EditMovementPage] Erro ao carregar registro:', error);
      toast.error('Erro ao carregar registro');
      navigate('/movements');
    } finally {
      setLoadingData(false);
    }
  };

  const loadAuxData = async () => {
    setLoadingAux(true);
    try {
      const [clientsRes, shippingLinesRes, serviceTypesRes, vehiclesRes, terminalsRes] = await Promise.all([
        api.getClients(),
        api.getShippingLines(),
        api.getServiceTypes({ per_page: 1000 }),
        api.getVehicles({ per_page: 1000 }),
        api.getTerminals()
      ]);

      const clientsData = Array.isArray(clientsRes.data) ? clientsRes.data : [];
      const shippingLinesData = Array.isArray(shippingLinesRes.data) ? shippingLinesRes.data : [];
      const serviceTypesData = Array.isArray(serviceTypesRes.data?.items) ? serviceTypesRes.data.items : [];
      const vehiclesData = Array.isArray(vehiclesRes.data?.items) ? vehiclesRes.data.items : [];
      const terminalsData = Array.isArray(terminalsRes.data) ? terminalsRes.data : [];

      setClients(clientsData);
      setShippingLines(shippingLinesData);
      setServiceTypes(serviceTypesData);
      setVehicles(vehiclesData);
      setTerminals(terminalsData);
    } catch (error) {
      console.error('[EditMovementPage] Erro ao carregar dados auxiliares:', error);
      toast.error('Erro ao carregar dados auxiliares');
    } finally {
      setLoadingAux(false);
    }
  };

  // Obrigatório em branco: o formulário não envia e o campo mostra o motivo
  const onInvalid = () => toast.error('Preencha os campos obrigatórios destacados');

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      // Moeda vem da Tabela de Serviços do cliente quando o usuário trocou
      // cliente/serviço nesta edição; senão preserva a moeda já salva na
      // movimentação, e só cai no caso hardcoded legado se nem isso existir.
      const currency = matchedCurrency || data.currency || (data.client_name === 'CARU Containers Brasil Locação' ? 'USD' : 'BRL');
      
      // Incluir fotos e moeda no payload
      const payload = {
        ...data,
        currency,
        container_photos: containerPhotos,
        container_damages: containerDamages,
        inspection_notes: inspectionNotes
      };
      await api.updateMovement(id, payload);
      toast.success('Registro atualizado com sucesso!');
      navigate(`/movements/${id}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao atualizar registro');
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
        <PageSkeleton />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto" data-testid="edit-movement-page">
        <div className="mb-4">
          <PageHeader
            icon={ContainerIcon}
            title="Editar Gate"
            subtitle="Atualize as informações do registro"
            backTo={`/movements/${id}`}
          />
        </div>

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4">
          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Tipo de Operação</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="operation_type" className="block">Tipo de Operação *</Label>
                  <Select value={operationType} onValueChange={(value) => setValue('operation_type', value)}>
                    <SelectTrigger id="operation_type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENTRADA">ENTRADA</SelectItem>
                      <SelectItem value="SAIDA">SAÍDA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="status" className="block">Status *</Label>
                  <Select value={status} onValueChange={(value) => setValue('status', value)}>
                    <SelectTrigger id="status">
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

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Informações do Veículo e Motorista</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="driver_name" className="block">Nome do Motorista *</Label>
                  <Input id="driver_name" {...register('driver_name', { required: true })} aria-invalid={!!errors.driver_name} />
                  {errors.driver_name && <FieldError />}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="driver_cpf" className="block">CPF *</Label>
                  <Input id="driver_cpf" {...register('driver_cpf', { required: true })} aria-invalid={!!errors.driver_cpf} className="font-mono" />
                  {errors.driver_cpf && <FieldError />}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="truck_plate" className="block">Placa do Cavalo *</Label>
                  <Input
                    id="truck_plate"
                    {...register('truck_plate', { required: true })}
                    onChange={(e) => handleTruckPlateChange(e.target.value)}
                    className="font-mono uppercase"
                    list="trucks-list"
                  />
                  {errors.truck_plate && <FieldError />}
                  <datalist id="trucks-list">
                    {cavaloVehicles.map(vehicle => (
                      <option key={vehicle.id} value={vehicle.plate} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trailer_plate_1" className="block">Placa Carreta *</Label>
                  <Input
                    id="trailer_plate_1"
                    {...register('trailer_plate_1', { required: true })}
                    onChange={(e) => handleTrailerPlateChange(e.target.value)}
                    className="font-mono uppercase"
                    list="trailers-list"
                  />
                  {errors.trailer_plate_1 && <FieldError />}
                  <datalist id="trailers-list">
                    {carretaVehicles.map(vehicle => (
                      <option key={vehicle.id} value={vehicle.plate} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="transport_company" className="block">Transportadora *</Label>
                  <Input id="transport_company" {...register('transport_company', { required: true })} aria-invalid={!!errors.transport_company} />
                  {errors.transport_company && <FieldError />}
                </div>
                <div className="space-y-1.5 relative">
                  <Label htmlFor="client_name" className="block">Cliente</Label>
                  <ClientNamePicker
                    id="client_name"
                    testId="client-name-input"
                    text={clientSearch}
                    clients={clients}
                    onTextChange={(value) => {
                      setClientSearch(value);
                      if (value === '') setValue('client_name', '');
                    }}
                    onPick={(client) => { userChangedPricingInputRef.current = true; setClientSearch(client.name); setValue('client_name', client.name); }}
                    onClear={() => { setClientSearch(''); setValue('client_name', ''); }}
                  />
                  <p className="text-xs text-muted-foreground">Este campo aparece na impressão</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Informações do Contêiner</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="container_number" className="block">Nº Container *</Label>
                  <Input
                    id="container_number"
                    {...register('container_number', {
                      required: true,
                      onBlur: (e) => {
                        const containerNumber = formatContainerNumber(e.target.value);
                        setValue('container_number', containerNumber);
                        loadEntryLocked(containerNumber, operationType);
                      },
                    })}
                    aria-invalid={!!errors.container_number}
                    className="font-mono uppercase"
                  />
                  {errors.container_number && <FieldError />}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="size_type" className="block">Tamanho/Tipo *</Label>
                  <Select value={sizeType} onValueChange={(value) => setValue('size_type', value)}>
                    <SelectTrigger id="size_type">
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
                <div className="space-y-1.5">
                  <Label htmlFor="tare" className="block">Tara</Label>
                  <Input id="tare" {...register('tare')} className="font-mono" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="shipping_line">Armador *</Label>
                    <span className="text-xs text-muted-foreground">
                      {shippingLines.length > 0 ? `(${shippingLines.length} cadastrados)` : ''}
                    </span>
                  </div>
                  <Select value={shippingLine || ''} onValueChange={(value) => setValue('shipping_line', value)}>
                    <SelectTrigger id="shipping_line" data-testid="shipping-line-select">
                      <SelectValue />
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
                <div className="space-y-1.5">
                  <Label htmlFor="seal" className="block">Lacre</Label>
                  <Input id="seal" {...register('seal')} className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="genset" className="block">Genset</Label>
                  <Input id="genset" {...register('genset')} className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="booking" className="block">Booking</Label>
                  <Input id="booking" {...register('booking')} className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="origin_terminal" className="block">Terminal de Origem</Label>
                  <Autocomplete
                    value={watch('origin_terminal') || ''}
                    onChange={(v) => setValue('origin_terminal', v)}
                    onSelect={(t) => setValue('origin_terminal', t.name)}
                    options={terminals}
                    displayField="name"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="service_type">Tipo de Serviço</Label>
                    <span className="text-xs text-muted-foreground">
                      {serviceTypes.length > 0 ? `(${serviceTypes.length} cadastrados)` : ''}
                    </span>
                  </div>
                  <Select value={serviceType || 'none'} onValueChange={(value) => { userChangedPricingInputRef.current = true; setValue('service_type', value === 'none' ? '' : value); }}>
                    <SelectTrigger id="service_type" data-testid="service-type-select">
                      <SelectValue />
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
                <div className="space-y-1.5">
                  <Label htmlFor="service_value" className="block">
                    Valor do Serviço ({(matchedCurrency || existingCurrency || (clientName === 'CARU Containers Brasil Locação' ? 'USD' : 'BRL')) === 'USD' ? 'US$' : 'R$'})
                  </Label>
                  <Input
                    id="service_value"
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('service_value', { valueAsNumber: true })}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Este valor aparecerá apenas no relatório de faturamento</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice_number" className="block">Nota Fiscal</Label>
                  <Input
                    id="invoice_number"
                    {...register('invoice_number')}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">Este campo aparecerá no relatório de faturamento</p>
                </div>

                <div className="space-y-1.5 relative">
                  <Label htmlFor="buyer_name" className="block">Comprador</Label>
                  <ClientNamePicker
                    id="buyer_name"
                    testId="buyer-name-input"
                    text={buyerSearch}
                    clients={clients}
                    onTextChange={(value) => {
                      setBuyerSearch(value);
                      if (value === '') setValue('buyer_name', '');
                    }}
                    onPick={(client) => { setBuyerSearch(client.name); setValue('buyer_name', client.name); }}
                    onClear={() => { setBuyerSearch(''); setValue('buyer_name', ''); }}
                  />
                  <p className="text-xs text-muted-foreground">Este campo não aparece na impressão</p>
                </div>

                <ContainerValueFields
                  register={register}
                  currency={containerValueCurrency}
                  onCurrencyChange={(value) => setValue('container_value_currency', value)}
                  locked={entryLocked}
                />

                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="observations" className="block">Observações</Label>
                  <textarea
                    id="observations"
                    data-testid="observations-input"
                    {...register('observations')}
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
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

          <FormActions sticky>
            <Button type="button" variant="outline" onClick={() => navigate(`/movements/${id}`)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Salvando...' : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Salvar alterações
                </>
              )}
            </Button>
          </FormActions>
        </form>
      </div>
    </Layout>
  );
}