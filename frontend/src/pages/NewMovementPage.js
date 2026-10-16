import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { FormActions, FieldError } from '../components/FormKit';
import { StatusPill, PageSkeleton } from '../components/DataPage';
import PageHeader from '../components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { activeRecords } from '../lib/cadastroStatus';
import { ClientNamePicker } from '../components/ClientNamePicker';
import { toast } from 'sonner';
import { Save, Check, Container as ContainerIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNotifications } from '../hooks/useNotifications';
import ContainerPhotoUpload from '../components/ContainerPhotoUpload';
import { Autocomplete } from '../components/Autocomplete';
import ContainerValueFields from '../components/ContainerValueFields';
import { formatContainerNumber } from '../lib/containerNumber';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const AUTO_SAVE_KEY = 'containerlogix_movement_draft';

export default function NewMovementPage() {
  const navigate = useNavigate();
  // Vistoria de Container que está gerando esta EIR de entrada ("Salvar e
  // gerar EIR de entrada" / "Gerar EIR de entrada" na vistoria)
  const [searchParams] = useSearchParams();
  const vistoriaId = searchParams.get('vistoria');
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [drivers, setDrivers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [clients, setClients] = useState([]);
  const [shippingLines, setShippingLines] = useState([]);
  const [serviceTypes, setServiceTypes] = useState([]);
  // Hora do último rascunho gravado no navegador (fica visível no cabeçalho)
  const [autoSavedAt, setAutoSavedAt] = useState(null);
  const [terminals, setTerminals] = useState([]);
  const [containerPhotos, setContainerPhotos] = useState(null);
  const [containerDamages, setContainerDamages] = useState([]);
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [buyerSearch, setBuyerSearch] = useState('');
  const [containerDuplicateError, setContainerDuplicateError] = useState('');
  const [segregationError, setSegregationError] = useState('');
  const [servicePriceEntries, setServicePriceEntries] = useState([]);
  const [entryLocked, setEntryLocked] = useState({});
  const { notifyNewMovement, requestPermission, permission } = useNotifications();
  
  // Vindo de uma vistoria, o formulário parte dos dados dela, não do rascunho
  const savedDraft = vistoriaId ? null : localStorage.getItem(AUTO_SAVE_KEY);
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
  const buyerName = watch('buyer_name');
  const serviceType = watch('service_type');
  const containerValueCurrency = watch('container_value_currency');

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
      setAutoSavedAt(new Date());
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [formData]);

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
  // selecionados batem com uma entrada da Tabela de Serviços - não impede
  // edição manual depois, só sugere um valor de partida. Também guarda a
  // moeda cadastrada nessa entrada (R$ ou $), usada no envio do formulário.
  const [matchedCurrency, setMatchedCurrency] = useState(null);
  useEffect(() => {
    if (!serviceType || servicePriceEntries.length === 0) {
      setMatchedCurrency(null);
      return;
    }
    // Só preço Ativo de cobrança única: a Diária de Armazenagem não é o
    // valor do serviço do EIR, e um preço inativo não vale mais.
    const wanted = serviceType.trim().toLowerCase();
    const match = servicePriceEntries.find((e) => (
      (e.status || 'ATIVO') === 'ATIVO'
      && (e.billing_type || 'UNICO') === 'UNICO'
      && (e.service_type_name || '').trim().toLowerCase() === wanted
    ));
    if (match) {
      setValue('service_value', match.value);
      setMatchedCurrency(match.currency || 'BRL');
    } else {
      setMatchedCurrency(null);
    }
  }, [serviceType, servicePriceEntries, setValue]);

  const loadData = async () => {
    setLoadingData(true);
    try {
      // Carregar todos os dados em paralelo
      const [driversRes, companiesRes, clientsRes, shippingLinesRes, serviceTypesRes, vehiclesRes, terminalsRes] = await Promise.all([
        api.getDrivers(),
        api.getTransportCompanies(),
        api.getClients(),
        api.getShippingLines(),
        api.getServiceTypes({ per_page: 1000 }),
        api.getVehicles({ per_page: 1000 }),
        api.getTerminals()
      ]);

      // Definir os dados com validação
      // Inativo/Bloqueado no Cadastro não aparecem pra um EIR novo
      const driversData = activeRecords(driversRes.data);
      const companiesData = activeRecords(companiesRes.data);
      const clientsData = activeRecords(clientsRes.data);
      const shippingLinesData = Array.isArray(shippingLinesRes.data) ? shippingLinesRes.data : [];
      const serviceTypesData = Array.isArray(serviceTypesRes.data?.items) ? serviceTypesRes.data.items : [];
      const vehiclesData = Array.isArray(vehiclesRes.data?.items) ? vehiclesRes.data.items : [];
      const terminalsData = activeRecords(terminalsRes.data);

      setDrivers(driversData);
      setCompanies(companiesData);
      setClients(clientsData);
      setShippingLines(shippingLinesData);
      setServiceTypes(serviceTypesData);
      setVehicles(vehiclesData);
      setTerminals(terminalsData);

      if (vistoriaId) {
        await fillFromVistoria(driversData);
      }
      
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

  // Preenche a EIR de entrada com o que a Vistoria de Container já registrou.
  // Status (cheio/vazio) e o que a vistoria não tiver ficam pro operador.
  const fillFromVistoria = async (driversData) => {
    try {
      const { data: vistoria } = await api.getContainerVistoria(vistoriaId);
      const code = `VC${String(vistoria.vistoria_number).padStart(6, '0')}`;
      setValue('operation_type', 'ENTRADA');
      setValue('container_number', vistoria.container_number);
      if (vistoria.size_type) setValue('size_type', vistoria.size_type);
      if (vistoria.shipping_line) setValue('shipping_line', vistoria.shipping_line);
      if (vistoria.tare) setValue('tare', vistoria.tare);
      if (vistoria.truck_plate) setValue('truck_plate', vistoria.truck_plate);
      if (vistoria.trailer_plate) setValue('trailer_plate_1', vistoria.trailer_plate);
      if (vistoria.transport_company) setValue('transport_company', vistoria.transport_company);
      if (vistoria.client_name) {
        setValue('client_name', vistoria.client_name);
        setClientSearch(vistoria.client_name);
      }
      if (vistoria.driver_name) {
        setValue('driver_name', vistoria.driver_name);
        const driver = driversData.find((d) => d.name.toLowerCase() === vistoria.driver_name.toLowerCase());
        if (driver) setValue('driver_cpf', driver.cpf);
      }
      if (vistoria.driver_cpf) setValue('driver_cpf', vistoria.driver_cpf);
      if (vistoria.observations) setValue('observations', vistoria.observations);
      if (vistoria.no_damage) {
        setContainerDamages(['SEM_AVARIA']);
        setInspectionNotes(`Vistoria de Container ${code}`);
      } else {
        const items = (vistoria.damage_items || []).join('; ');
        setInspectionNotes(`Vistoria de Container ${code}${items ? `: ${items}` : ''}`);
      }
      checkContainerDuplicate(vistoria.container_number, 'ENTRADA');
      toast.success(`Dados da vistoria ${code} preenchidos. Confira e informe o Status.`);
    } catch (error) {
      toast.error('Não foi possível carregar os dados da vistoria');
    }
  };

  // Obrigatório em branco: o formulário não envia e o campo mostra o motivo
  const onInvalid = () => toast.error('Preencha os campos obrigatórios destacados');

  const onSubmit = async (data) => {
    if (containerDuplicateError) {
      toast.error(containerDuplicateError);
      return;
    }
    if (segregationError) {
      toast.error(segregationError);
      return;
    }
    setLoading(true);
    try {
      // Moeda vem da Tabela de Serviços do cliente (campo Moeda cadastrado
      // junto com o serviço) quando há um serviço selecionado que bate com
      // uma entrada cadastrada; senão cai no caso hardcoded legado abaixo.
      const currency = matchedCurrency || (data.client_name === 'CARU Containers Brasil Locação' ? 'USD' : 'BRL');

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
      if (vistoriaId) {
        // Registra na vistoria a EIR gerada (a tela dela passa a mostrar "Ver EIR")
        await api.updateContainerVistoria(vistoriaId, {
          movement_id: response.data.id,
          movement_transaction_id: response.data.transaction_id,
        }).catch(() => {});
      }
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

  // Verifica se a última movimentação registrada desse container já é do
  // mesmo tipo que está sendo digitado agora - trava de duplicidade (mesmo
  // container não pode dar Entrada/Entrada ou Saída/Saída em sequência sem
  // uma movimentação do tipo oposto no meio).
  const checkContainerDuplicate = useCallback(async (containerNumber, opType) => {
    if (!containerNumber) {
      setContainerDuplicateError('');
      return;
    }
    try {
      const response = await api.getLastMovementForContainer(containerNumber);
      const last = response.data?.movement;
      if (last && last.operation_type === opType) {
        const tipoLabel = opType === 'ENTRADA' ? 'ENTRADA' : 'SAÍDA';
        const dataStr = last.created_at
          ? format(new Date(last.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })
          : '';
        setContainerDuplicateError(
          `Este container já teve uma ${tipoLabel} registrada (Transação #${last.transaction_id}${dataStr ? `, em ${dataStr}` : ''}) sem uma movimentação do tipo oposto depois. Não é possível registrar outra ${tipoLabel} em duplicidade.`
        );
      } else {
        setContainerDuplicateError('');
      }
    } catch (error) {
      setContainerDuplicateError('');
    }
  }, []);

  // Trava #1 da Segregação de Unidade: se o container está Segregado
  // (ATIVO) pra um cliente, só libera Saída quando esse cliente aparece no
  // campo Cliente OU no campo Comprador (reconhece qualquer um dos dois,
  // já que na prática quem retira um container comprado costuma ser
  // preenchido em Comprador) - mesmo padrão de checagem "ao digitar" já
  // usado pra checkContainerDuplicate, só que também precisa reconferir
  // quando o Cliente ou o Comprador mudam (não só o container).
  const checkSegregation = useCallback(async (containerNumber, opType, clientNm, buyerNm) => {
    if (!containerNumber || opType !== 'SAIDA') {
      setSegregationError('');
      return;
    }
    try {
      const response = await api.checkContainerSegregation(containerNumber);
      const seg = response.data;
      if (seg?.is_segregated) {
        const segClient = (seg.segregation?.client_name || '').trim().toLowerCase();
        const currentClient = (clientNm || '').trim().toLowerCase();
        const currentBuyer = (buyerNm || '').trim().toLowerCase();
        if (segClient !== currentClient && segClient !== currentBuyer) {
          setSegregationError(
            `Este container está segregado (reservado) para o cliente "${seg.segregation.client_name}". Selecione esse cliente no campo Cliente ou Comprador para emitir a saída, ou libere a segregação em Segregação de Unidade.`
          );
          return;
        }
      }
      setSegregationError('');
    } catch (error) {
      setSegregationError('');
    }
  }, []);

  // Numa Saída, o Valor do Container e a Data de Fabricação que a entrada do
  // container tiver preenchidos são puxados e ficam bloqueados; o que a
  // entrada deixou em branco continua livre pra informar na própria saída.
  const loadEntryLocked = useCallback(async (containerNumber, opType) => {
    if (!containerNumber || opType !== 'SAIDA') {
      setEntryLocked({});
      return;
    }
    try {
      const response = await api.getEntryLockedFields(containerNumber);
      const locked = response.data || {};
      Object.entries(locked).forEach(([field, value]) => setValue(field, value));
      setEntryLocked(locked);
    } catch (error) {
      setEntryLocked({});
    }
  }, [setValue]);

  const handleContainerNumberBlur = async (e) => {
    const containerNumber = formatContainerNumber(e.target.value);
    setValue('container_number', containerNumber);
    checkContainerDuplicate(containerNumber, operationType);
    checkSegregation(containerNumber, operationType, clientName, buyerName);
    loadEntryLocked(containerNumber, operationType);
    if (operationType !== 'SAIDA') return;
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

  // Reconfere a trava de duplicidade e a de Segregação quando o Tipo de
  // Operação, o Cliente ou o Comprador mudam (o container pode já ter sido
  // digitado antes de o usuário trocar algum desses campos).
  useEffect(() => {
    const containerNumber = formData.container_number;
    if (containerNumber) {
      checkContainerDuplicate(containerNumber, operationType);
      checkSegregation(containerNumber, operationType, clientName, buyerName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationType, clientName, buyerName]);

  useEffect(() => {
    loadEntryLocked(formData.container_number, operationType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationType]);

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
        <div className="max-w-5xl mx-auto">
          <PageSkeleton testId="loading-data" />
        </div>
      ) : (
      <div className="max-w-5xl mx-auto" data-testid="new-movement-page">
        <div className="mb-4">
          <PageHeader
            icon={ContainerIcon}
            title="Novo Registro"
            subtitle={vistoriaId ? 'EIR de entrada gerada a partir da Vistoria de Container' : 'Registre uma nova entrada ou saída de contêiner'}
            meta={autoSavedAt && (
              <StatusPill tone="emerald" dot={false}>
                <Check className="w-3 h-3" />
                Rascunho salvo às {format(autoSavedAt, 'HH:mm')}
              </StatusPill>
            )}
            backTo="/movements"
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
                    <SelectTrigger id="operation_type" data-testid="operation-type-select">
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
                    <SelectTrigger id="status" data-testid="status-select">
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
                  <Autocomplete
                    value={watch('driver_name') || ''}
                    onChange={handleDriverChange}
                    onSelect={(d) => handleDriverChange(d.name)}
                    options={drivers}
                    displayField="name"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="driver_cpf" className="block">CPF *</Label>
                  <Input
                    id="driver_cpf"
                    data-testid="driver-cpf-input"
                    {...register('driver_cpf', { required: true })}
                    aria-invalid={!!errors.driver_cpf}
                    className="font-mono"
                  />
                  {errors.driver_cpf && <FieldError testId="driver-cpf-error" />}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="truck_plate" className="block">Placa do Cavalo *</Label>
                  <Autocomplete
                    value={watch('truck_plate') || ''}
                    onChange={handleTruckPlateChange}
                    onSelect={(v) => handleTruckPlateChange(v.plate)}
                    options={cavaloVehicles}
                    displayField="plate"
                    className="font-mono uppercase"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="trailer_plate_1" className="block">Placa Carreta *</Label>
                  <Autocomplete
                    value={watch('trailer_plate_1') || ''}
                    onChange={handleTrailerPlateChange}
                    onSelect={(v) => handleTrailerPlateChange(v.plate)}
                    options={carretaVehicles}
                    displayField="plate"
                    className="font-mono uppercase"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="transport_company" className="block">Transportadora *</Label>
                  <Autocomplete
                    value={watch('transport_company') || ''}
                    onChange={handleCompanyChange}
                    onSelect={(c) => handleCompanyChange(c.name)}
                    options={companies}
                    displayField="name"
                  />
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
                    onPick={(client) => { setClientSearch(client.name); setValue('client_name', client.name); }}
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
                    data-testid="container-number-input"
                    {...register('container_number', { required: true, onBlur: handleContainerNumberBlur })}
                    aria-invalid={!!errors.container_number}
                    className="font-mono uppercase"
                  />
                  {errors.container_number && <FieldError testId="container-number-error" />}
                  {containerDuplicateError && (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium" data-testid="container-duplicate-error">
                      {containerDuplicateError}
                    </p>
                  )}
                  {segregationError && (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium" data-testid="container-segregation-error">
                      {segregationError}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="size_type" className="block">Tamanho/Tipo *</Label>
                  <Select value={sizeType} onValueChange={(value) => setValue('size_type', value)}>
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

                <div className="space-y-1.5">
                  <Label htmlFor="tare" className="block">Tara</Label>
                  <Input
                    id="tare"
                    data-testid="tare-input"
                    {...register('tare')}
                    className="font-mono"
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
                    <SelectTrigger id="shipping_line" data-testid="shipping-line-select">
                      <SelectValue />
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

                <div className="space-y-1.5">
                  <Label htmlFor="seal" className="block">Lacre</Label>
                  <Input
                    id="seal"
                    data-testid="seal-input"
                    {...register('seal')}
                    className="font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="genset" className="block">Genset</Label>
                  <Input
                    id="genset"
                    data-testid="genset-input"
                    {...register('genset')}
                    className="font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="booking" className="block">Booking</Label>
                  <Input
                    id="booking"
                    data-testid="booking-input"
                    {...register('booking')}
                    className="font-mono"
                  />
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
                  <Select value={serviceType || 'none'} onValueChange={(value) => setValue('service_type', value === 'none' ? '' : value)}>
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
                    Valor do Serviço ({(matchedCurrency || (clientName === 'CARU Containers Brasil Locação' ? 'USD' : 'BRL')) === 'USD' ? 'US$' : 'R$'})
                  </Label>
                  <Input
                    id="service_value"
                    data-testid="service-value-input"
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
                    data-testid="invoice-number-input"
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
            <Button type="button" variant="outline" onClick={() => navigate('/movements')} data-testid="cancel-button">
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} data-testid="save-button">
              {loading ? 'Salvando...' : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Salvar registro
                </>
              )}
            </Button>
          </FormActions>
        </form>
      </div>
      )}
    </Layout>
  );
}
