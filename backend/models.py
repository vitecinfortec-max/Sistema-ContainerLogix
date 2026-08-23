from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional, Literal, List
from datetime import datetime, timezone
import uuid

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: str
    password: str
    role: Literal["admin", "operator"] = "operator"
    must_change_password: bool = False  # True quando usar senha provisória
    active: bool = True  # False = acesso revogado por um admin, sem apagar o usuário
    # Só verdadeiro para a conta do dono do sistema (J.A Logística/vendedor) -
    # nunca exposto em nenhum endpoint de criação/edição de usuário, só pode
    # ser definido direto no banco. Controla quem pode liberar/bloquear
    # módulos contratados - se o admin comum do cliente pudesse setar isso,
    # ele conseguiria se autoliberar tudo.
    is_superadmin: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    must_change_password: bool = False
    active: bool = True
    is_superadmin: bool = False
    created_at: datetime

class UserCreate(BaseModel):
    name: str
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserRoleUpdate(BaseModel):
    role: Literal["admin", "operator"]

class UserStatusUpdate(BaseModel):
    active: bool

class ModuleConfigUpdate(BaseModel):
    disabled_modules: List[str]

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

class CompanySettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: Optional[str] = None
    cnpj: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    bank_name: Optional[str] = None
    bank_agency: Optional[str] = None
    bank_account: Optional[str] = None
    pix_key: Optional[str] = None
    logo_filename: Optional[str] = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CompanySettingsUpdate(BaseModel):
    name: Optional[str] = None
    cnpj: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    bank_name: Optional[str] = None
    bank_agency: Optional[str] = None
    bank_account: Optional[str] = None
    pix_key: Optional[str] = None
    logo_filename: Optional[str] = None

class Driver(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    cpf: str
    phone: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str

class DriverCreate(BaseModel):
    name: str
    cpf: str
    phone: Optional[str] = None

class DriverResponse(BaseModel):
    id: str
    name: str
    cpf: str
    phone: Optional[str] = None
    created_at: datetime

class TransportCompany(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    cnpj: Optional[str] = None
    phone: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str

class TransportCompanyCreate(BaseModel):
    name: str
    cnpj: Optional[str] = None
    phone: Optional[str] = None

class TransportCompanyResponse(BaseModel):
    id: str
    name: str
    cnpj: Optional[str] = None
    phone: Optional[str] = None
    created_at: datetime

# Client Model (baseado em TransportCompany)
class Client(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    cnpj: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str

class ClientCreate(BaseModel):
    name: str
    cnpj: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None

class ClientResponse(BaseModel):
    id: str
    name: str
    cnpj: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    created_at: datetime

# Supplier Model (baseado em Client) - Fornecedor
class Supplier(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    cnpj: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str

class SupplierCreate(BaseModel):
    name: str
    cnpj: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None

class SupplierResponse(BaseModel):
    id: str
    name: str
    cnpj: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    created_at: datetime

class ContainerMovement(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    transaction_id: int
    operation_type: Literal["ENTRADA", "SAIDA"]
    driver_name: str
    driver_cpf: str
    truck_plate: str
    trailer_plate_1: str
    trailer_plate_2: Optional[str] = None
    transport_company: str
    client_name: Optional[str] = None  # Cliente (não aparece na impressão)
    container_number: str
    status: Literal["CHEIO", "VAZIO"]
    size_type: Literal["20DC", "20RF", "20OT", "20FR", "40HC", "40RF", "40OT", "40FR", "40DRY"]
    tare: Optional[str] = None
    shipping_line: str  # Armador - agora dinâmico (cadastrado)
    seal: Optional[str] = None
    genset: Optional[str] = None
    booking: Optional[str] = None
    service_type: Optional[str] = None  # Tipo de Serviço (aparece no faturamento)
    invoice_number: Optional[str] = None  # Nota Fiscal (opcional, aparece no faturamento)
    service_value: Optional[float] = None  # Valor do serviço (não aparece na impressão)
    currency: str = "BRL"  # Moeda: BRL (Real) ou USD (Dólar)
    observations: Optional[str] = None  # Observações da movimentação
    container_photos: Optional[dict] = None  # Fotos do container (frente, traseira, esquerda, direita)
    container_damages: List[str] = []  # Vistoria: avarias constatadas (ou ["SEM_AVARIA"])
    billed: bool = False  # Indica se foi faturado
    billed_at: Optional[datetime] = None  # Data/hora do faturamento
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str
    user_name: str

class ContainerMovementCreate(BaseModel):
    operation_type: Literal["ENTRADA", "SAIDA"]
    driver_name: str
    driver_cpf: str
    truck_plate: str
    trailer_plate_1: str
    trailer_plate_2: Optional[str] = None
    transport_company: str
    client_name: Optional[str] = None  # Cliente
    container_number: str
    status: Literal["CHEIO", "VAZIO"]
    size_type: Literal["20DC", "20RF", "20OT", "20FR", "40HC", "40RF", "40OT", "40FR", "40DRY"]
    tare: Optional[str] = None
    shipping_line: str  # Armador - agora dinâmico (cadastrado)
    seal: Optional[str] = None
    genset: Optional[str] = None
    booking: Optional[str] = None
    service_type: Optional[str] = None  # Tipo de Serviço
    invoice_number: Optional[str] = None  # Nota Fiscal
    service_value: Optional[float] = None  # Valor do serviço
    currency: str = "BRL"  # Moeda: BRL (Real) ou USD (Dólar)
    observations: Optional[str] = None  # Observações da movimentação
    container_photos: Optional[dict] = None  # Fotos do container
    container_damages: List[str] = []  # Vistoria: avarias constatadas (ou ["SEM_AVARIA"])

class ContainerMovementResponse(BaseModel):
    id: str
    transaction_id: int
    operation_type: str
    driver_name: Optional[str] = None
    driver_cpf: Optional[str] = None
    truck_plate: Optional[str] = None
    trailer_plate_1: Optional[str] = None
    trailer_plate_2: Optional[str] = None
    transport_company: Optional[str] = None
    client_name: Optional[str] = None  # Cliente
    container_number: str
    status: str
    size_type: str
    tare: Optional[str] = None
    shipping_line: str
    seal: Optional[str] = None
    genset: Optional[str] = None
    booking: Optional[str] = None
    service_type: Optional[str] = None  # Tipo de Serviço
    invoice_number: Optional[str] = None  # Nota Fiscal
    service_value: Optional[float] = None  # Valor do serviço
    currency: str = "BRL"  # Moeda: BRL (Real) ou USD (Dólar)
    observations: Optional[str] = None  # Observações da movimentação
    container_photos: Optional[dict] = None  # Fotos do container
    container_damages: List[str] = []  # Vistoria: avarias constatadas (ou ["SEM_AVARIA"])
    billed: bool = False  # Indica se foi faturado
    billed_at: Optional[datetime] = None  # Data/hora do faturamento
    created_at: datetime
    user_name: Optional[str] = None

class DailyMovementPoint(BaseModel):
    date: str  # YYYY-MM-DD
    entries: int
    exits: int

class DriverRankingEntry(BaseModel):
    driver_name: str
    entries: int
    exits: int
    total: int

class DashboardStats(BaseModel):
    total_movements: int
    entries_today: int
    exits_today: int
    full_containers: int
    empty_containers: int
    total_entries: int
    total_exits: int
    current_stock: int
    stock_empty: int  # Estoque atual de vazios
    stock_full: int   # Estoque atual de cheios
    entries_month: int  # Entradas do mês
    exits_month: int    # Saídas do mês
    recent_movements: list[ContainerMovementResponse]
    daily_chart: list[DailyMovementPoint] = []  # Entradas/saídas por dia (últimos 14 dias)
    driver_ranking: list[DriverRankingEntry] = []  # Ranking de motoristas no mês vigente

class ShippingLine(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    code: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str

class ShippingLineCreate(BaseModel):
    name: str
    code: Optional[str] = None

class ShippingLineResponse(BaseModel):
    id: str
    name: str
    code: Optional[str] = None
    created_at: datetime


# Tipo de Serviço
class ServiceType(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str

class ServiceTypeCreate(BaseModel):
    name: str
    description: Optional[str] = None

class ServiceTypeResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime


# Invoice (Fatura) Model
class Invoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    invoice_number: int  # Número sequencial da fatura
    client_name: str
    client_cnpj: Optional[str] = None
    movement_ids: List[str]  # IDs das movimentações incluídas
    total_value: float
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str
    user_name: str

class InvoiceCreate(BaseModel):
    client_name: str
    client_cnpj: Optional[str] = None
    movement_ids: List[str]
    notes: Optional[str] = None

class InvoiceUpdate(BaseModel):
    client_name: Optional[str] = None
    client_cnpj: Optional[str] = None
    notes: Optional[str] = None
    movement_ids_to_add: Optional[List[str]] = None
    movement_ids_to_remove: Optional[List[str]] = None

class InvoiceResponse(BaseModel):
    id: str
    invoice_number: int
    client_name: str
    client_cnpj: Optional[str] = None
    movement_ids: List[str]
    total_value: float
    notes: Optional[str] = None
    created_at: datetime
    user_name: str

class InvoiceMovementDetail(BaseModel):
    id: str
    transaction_id: int
    container_number: str
    operation_type: str
    service_type: Optional[str] = None
    service_value: Optional[float] = None
    created_at: datetime


# Invoice History (Histórico de Alterações)
class InvoiceHistory(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    invoice_id: str
    invoice_number: int
    action: Literal["CREATED", "UPDATED", "DELETED"]
    changes: dict  # Detalhes das alterações
    user_id: str
    user_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class InvoiceHistoryResponse(BaseModel):
    id: str
    invoice_id: str
    invoice_number: int
    action: str
    changes: dict
    user_name: str
    created_at: datetime


# ===== REGISTRO FOTOGRÁFICO =====
class PhotoRegistry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    registry_number: int  # Número sequencial do registro
    container_number: str
    container_seal: Optional[str] = None  # Numeração do Container (lacre)
    collection_terminal: Optional[str] = None  # Terminal de Coleta
    booking: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    shipping_line_id: Optional[str] = None
    shipping_line_name: Optional[str] = None
    
    # Fotos (URLs dos arquivos)
    photo_front: Optional[str] = None
    photo_back: Optional[str] = None
    photo_left: Optional[str] = None
    photo_right: Optional[str] = None
    
    # Metadados
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class PhotoRegistryCreate(BaseModel):
    container_number: str
    container_seal: Optional[str] = None
    collection_terminal: Optional[str] = None
    booking: Optional[str] = None
    client_id: Optional[str] = None
    shipping_line_id: Optional[str] = None

class PhotoRegistryUpdate(BaseModel):
    container_number: Optional[str] = None
    container_seal: Optional[str] = None
    collection_terminal: Optional[str] = None
    booking: Optional[str] = None
    client_id: Optional[str] = None
    shipping_line_id: Optional[str] = None

class PhotoRegistryResponse(BaseModel):
    id: str
    registry_number: int
    container_number: str
    container_seal: Optional[str] = None
    collection_terminal: Optional[str] = None
    booking: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    shipping_line_id: Optional[str] = None
    shipping_line_name: Optional[str] = None
    photo_front: Optional[str] = None
    photo_back: Optional[str] = None
    photo_left: Optional[str] = None
    photo_right: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# Tipos de foto disponíveis para a Vistoria de Container
CONTAINER_INSPECTION_PHOTO_TYPES = ["front", "back", "left", "right", "internal"]
MAX_CONTAINER_INSPECTION_PHOTOS = 8

class ContainerInspectionPhoto(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str  # front, back, left, right ou internal
    url: str

# ===== VISTORIA DE CONTAINER =====
class ContainerInspection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    inspection_number: int  # Número sequencial da vistoria
    container_number: str
    container_seal: Optional[str] = None  # Numeração do Container (lacre)
    size_type: Optional[str] = None  # Tamanho/Tipo do container (ex: 20DC, 40HC)
    collection_terminal: Optional[str] = None  # Terminal de Coleta
    booking: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    shipping_line_id: Optional[str] = None
    shipping_line_name: Optional[str] = None
    observations: Optional[str] = None  # Campo de observação

    # Vistoria de avarias
    no_damage: bool = False  # Container sem avarias
    damage_items: List[str] = Field(default_factory=list)  # Itens marcados com avaria

    # Fotos (até 8, cada uma com um tipo: front, back, left, right, internal)
    photos: List[ContainerInspectionPhoto] = Field(default_factory=list)

    # Metadados
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class ContainerInspectionCreate(BaseModel):
    container_number: str
    container_seal: Optional[str] = None
    size_type: Optional[str] = None
    collection_terminal: Optional[str] = None
    booking: Optional[str] = None
    client_id: Optional[str] = None
    shipping_line_id: Optional[str] = None
    observations: Optional[str] = None
    no_damage: bool = False
    damage_items: List[str] = Field(default_factory=list)

class ContainerInspectionUpdate(BaseModel):
    container_number: Optional[str] = None
    container_seal: Optional[str] = None
    size_type: Optional[str] = None
    collection_terminal: Optional[str] = None
    booking: Optional[str] = None
    client_id: Optional[str] = None
    shipping_line_id: Optional[str] = None
    observations: Optional[str] = None
    no_damage: Optional[bool] = None
    damage_items: Optional[List[str]] = None

class ContainerInspectionResponse(BaseModel):
    id: str
    inspection_number: int
    container_number: str
    container_seal: Optional[str] = None
    size_type: Optional[str] = None
    collection_terminal: Optional[str] = None
    booking: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    shipping_line_id: Optional[str] = None
    shipping_line_name: Optional[str] = None
    observations: Optional[str] = None
    no_damage: bool = False
    damage_items: List[str] = Field(default_factory=list)
    photos: List[ContainerInspectionPhoto] = Field(default_factory=list)
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# ===== FLEX TANK (CONTROLE DE ESTOQUE DE BOLSAS) =====
class FlexTankMovement(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    movement_number: int  # Número sequencial do registro
    bag_number: str  # Número da Bolsa
    bag_size: str  # Tamanho da Bolsa
    movement_date: datetime  # Data da movimentação
    movement_type: str  # "ENTRADA" ou "SAIDA"
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    destination_client_id: Optional[str] = None  # Cliente Destino
    destination_client_name: Optional[str] = None  # Nome do Cliente Destino
    container_number: Optional[str] = None  # Número do Container
    observations: Optional[str] = None
    
    # Metadados
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class FlexTankMovementCreate(BaseModel):
    bag_number: str
    bag_size: str
    movement_date: datetime
    movement_type: str  # "ENTRADA" ou "SAIDA"
    client_id: Optional[str] = None
    destination_client_id: Optional[str] = None  # Cliente Destino
    container_number: Optional[str] = None
    observations: Optional[str] = None

class FlexTankMovementUpdate(BaseModel):
    bag_number: Optional[str] = None
    bag_size: Optional[str] = None
    movement_date: Optional[datetime] = None
    movement_type: Optional[str] = None
    client_id: Optional[str] = None
    destination_client_id: Optional[str] = None  # Cliente Destino
    container_number: Optional[str] = None
    observations: Optional[str] = None

class FlexTankMovementResponse(BaseModel):
    id: str
    movement_number: int
    bag_number: str
    bag_size: str
    movement_date: datetime
    movement_type: str
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    destination_client_id: Optional[str] = None
    destination_client_name: Optional[str] = None
    container_number: Optional[str] = None
    observations: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None

class FlexTankStockSummary(BaseModel):
    total_bags: int
    total_entries: int
    total_exits: int
    by_client: List[dict] = []
    by_size: List[dict] = []



# ==================== FROTA - CADASTRO DE VEÍCULOS ====================

class Vehicle(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    plate: str  # Placa do veículo (obrigatório)
    model: Optional[str] = None  # Modelo
    brand: Optional[str] = None  # Marca
    year: Optional[int] = None  # Ano
    vehicle_type: str  # Tipo: CAMINHÃO, CARRETA, EQUIPAMENTO, etc.
    status: str = "ATIVO"  # ATIVO, INATIVO, MANUTENÇÃO
    observations: Optional[str] = None
    driver_id: Optional[str] = None  # Motorista responsável (para autopreencher RPA/Movimentação)
    driver_name: Optional[str] = None

    # Metadados
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class VehicleCreate(BaseModel):
    plate: str
    model: Optional[str] = None
    brand: Optional[str] = None
    year: Optional[int] = None
    vehicle_type: str
    status: str = "ATIVO"
    observations: Optional[str] = None
    driver_id: Optional[str] = None

class VehicleUpdate(BaseModel):
    plate: Optional[str] = None
    model: Optional[str] = None
    brand: Optional[str] = None
    year: Optional[int] = None
    vehicle_type: Optional[str] = None
    status: Optional[str] = None
    observations: Optional[str] = None
    driver_id: Optional[str] = None
    clear_driver: bool = False  # True para remover o motorista vinculado (driver_id=None não dá pra distinguir de "não alterar")

class VehicleResponse(BaseModel):
    id: str
    plate: str
    model: Optional[str] = None
    brand: Optional[str] = None
    year: Optional[int] = None
    vehicle_type: str
    status: str
    observations: Optional[str] = None
    driver_id: Optional[str] = None
    driver_name: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# ==================== FROTA - CHECKLIST DE VEÍCULO (LVT) ====================
# Modelo baseado na Lista de Verificação de Transporte (LVT) para transporte
# rodoviário de derivados de petróleo. Os itens abaixo são fixos (mesmo texto
# e agrupamento do documento original) — cada checklist criado recebe uma
# cópia desses itens para ser respondida (SIM/NÃO).

VEHICLE_CHECKLIST_TEMPLATE = {
    "documentos": [
        "CNH - Carteira Nacional de Habilitação válida e compatível c/ veículo (ou Habilitação p/ transporte internacional)",
        "CRLV – Certificado de Registro e Licenciamento de Veículo válido",
        "Certificado da ANTT do RNTRC (Registro Nacional de Transportadores Rodoviários de Carga) válido",
    ],
    "vehicle_condition": [
        "Pneus e estepe em bom estado (com sulcos mínimos TWI >= 1,6mm)",
        "Rodas possuem todos os parafusos",
        "Faróis (alto e baixo), setas, pisca alerta, lanternas, luzes de freio, luzes de marcha ré com sinal sonoro obrigatório, buzina, limpador de para-brisa em perfeito estado de funcionamento",
        "Emissões (fumaça preta) dentro dos limites estipulados pela legislação vigente. Portaria 85/1996 IBAMA",
        "Fiação elétrica em dutos metálicos ou de PVC (isolamento perfeito e bateria isolada)",
        "Integridade dos espelhos retrovisores externos, interno e integridade do para-brisa",
        "Cinto de segurança de três pontos",
        "Operacionalidade da Chave geral (blindada com L/D ligado no polo positivo da bateria)",
        "Pala de proteção interna (contra o sol) para o motorista",
        "Chave de rodas, triângulo e macaco",
        "Tacógrafo ou controlador eletrônico",
        "Extintor de incêndio de cabine dentro da validade",
    ],
    "epi": [
        "Equipamentos de Proteção Individual (EPI) conforme NBR-9735 e NR-06",
    ],
    "kit": [
        "Equipamentos de emergência conforme norma NBR-9735",
    ],
    "tank": [
        "O produto a ser carregado é compatível com os produtos carregados na viagem anterior ou o tanque do CT está isento de remanescentes (Inclusive ÁGUA)",
        "O tanque e todos os seus dispositivos que entrem em contato com o produto (mangotes, tubulações, engates, bombas, válvulas, vedações e inclusive seus lubrificantes) são compatíveis com o produto transportado",
        "Dois pontos de aterramento, instalados em cada lateral do tanque, fixados por solda ou parafuso, isento de pintura e corrosão",
        "Painéis de segurança, rótulos de risco e número ONU conforme produto(s) a ser(em) carregado(s)",
        "Escada de acesso e plataforma com piso antiderrapante junto a boca de carregamento",
        "Capacidade dos compartimentos demarcados",
        "Juntas de vedação, válvulas, flanges, tampões (CAP) limpos e sem vazamentos",
        "Dispositivo de alívio de pressão e vácuo em perfeito funcionamento (suspiros)",
        "Todas as saídas de produtos em bom estado e sem vazamento",
        "Parte superior do tanque isenta de qualquer objeto estranho (NBR 7500)",
        "Todos os eixos da composição abaixados",
        "Os acessórios (mangotes, funis, conexões, prolongadores etc.) que venham a ser utilizados no carregamento ou descarregamento estão em perfeitas condições de uso, sem vazamentos e não possuindo emendas",
        "Possui faixas reflexivas no tanque de acordo com a Deliberação nº 30 do CONTRAN de 19/12/2001",
        "Para-choque traseiro, com altura máxima 400 mm (ou 450 mm, se enquadrado nos Art. 1º e 2º da Resolução CONTRAN 952/2022), faixas oblíquas nas cores vermelha e branca reflexivas",
        "Tanques/tubulações epicotados de alumínio, aço inoxidável ou aço carbono revestido com tinta epóxi",
        "Ponto baixo dotado de dreno e estanqueidade em relação à penetração de água e outros contaminantes",
        "Ausência de acessórios de cobre, zinco, chumbo, cádmio ou ligas desses metais, que tenham contato com o produto",
        "Existência de cabo duplo (dupla ligação elétrica entre chassis e tanque)",
        "Setas de nível",
    ],
    "post_loading": [
        "Documento Auxiliar da Nota Fiscal Eletrônica – DANFE",
    ],
}

VEHICLE_CHECKLIST_SECTION_LABELS = {
    "documentos": "Documentos",
    "vehicle_condition": "Condições do Veículo",
    "epi": "EPI",
    "kit": "Kit",
    "tank": "Condições do Tanque / Carreta",
    "post_loading": "Documentos Pós Carregamento",
}


class VehicleChecklistItem(BaseModel):
    """Um item de verificação (pergunta SIM/NÃO), com vencimento opcional (usado nos itens de documentos)"""
    text: str
    answer: Optional[str] = None  # "SIM", "NAO" ou None (não respondido)
    expiry: Optional[str] = None  # Data de vencimento (YYYY-MM-DD), só usado nos itens de Documentos


class VehicleChecklistProduct(BaseModel):
    """Linha da tabela de produtos transportados (rótulo de risco)"""
    product: Optional[str] = None
    un_number: Optional[str] = None  # Número ONU
    risk_number: Optional[str] = None  # Nº de risco
    subclass: Optional[str] = None  # Subclasse


def default_checklist_items(section: str) -> List["VehicleChecklistItem"]:
    return [VehicleChecklistItem(text=t) for t in VEHICLE_CHECKLIST_TEMPLATE[section]]


class VehicleChecklistFields(BaseModel):
    """Campos compartilhados entre Create/Update/Response do checklist"""
    # Modelo do documento: "petrobras_lvt" (réplica do LVT Petrobras, usado quando o
    # cliente contratante é a Manuport) ou "generic" (checklist padrão do sistema)
    template: str = "generic"

    # Cabeçalho
    expedidor: Optional[str] = None
    un: Optional[str] = None
    inspection_datetime: Optional[str] = None  # Data e hora da vistoria (ISO)
    scheduling_code: Optional[str] = None  # Cód. do Agendamento
    un_address: Optional[str] = None
    phone: Optional[str] = None
    fax: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    orp_odp_number: Optional[str] = None
    nf_number: Optional[str] = None
    transport_company_id: Optional[str] = None
    transport_company_name: Optional[str] = None
    driver_id: Optional[str] = None
    driver_name: Optional[str] = None
    driver_cpf: Optional[str] = None
    products_description: Optional[str] = None
    cavalo_plate: Optional[str] = None
    cavalo_year: Optional[str] = None
    carreta1_plate: Optional[str] = None
    carreta1_year: Optional[str] = None
    carreta1_capacity: Optional[str] = None
    carreta2_plate: Optional[str] = None
    carreta2_year: Optional[str] = None
    carreta2_capacity: Optional[str] = None
    cnh_number: Optional[str] = None
    cnh_category: Optional[str] = None
    cnh_expiry: Optional[str] = None
    sap_code: Optional[str] = None

    # Itens do checklist por seção
    documentos_items: List[VehicleChecklistItem] = Field(default_factory=lambda: default_checklist_items("documentos"))
    vehicle_condition_items: List[VehicleChecklistItem] = Field(default_factory=lambda: default_checklist_items("vehicle_condition"))
    epi_items: List[VehicleChecklistItem] = Field(default_factory=lambda: default_checklist_items("epi"))
    kit_items: List[VehicleChecklistItem] = Field(default_factory=lambda: default_checklist_items("kit"))
    tank_items: List[VehicleChecklistItem] = Field(default_factory=lambda: default_checklist_items("tank"))
    post_loading_items: List[VehicleChecklistItem] = Field(default_factory=lambda: default_checklist_items("post_loading"))

    # Produtos / rótulos de risco
    products: List[VehicleChecklistProduct] = Field(default_factory=list)

    # Kit de emergência - validades dos calços/extintor
    kit_validity_1: Optional[str] = None
    kit_validity_2: Optional[str] = None
    kit_validity_3: Optional[str] = None

    # Últimas 3 viagens (produtos transportados)
    last_trip_product_1: Optional[str] = None
    last_trip_product_2: Optional[str] = None
    last_trip_product_3: Optional[str] = None

    observations: Optional[str] = None

    # Responsáveis (nome digitado, sem captura de assinatura)
    transport_responsible_name: Optional[str] = None
    transport_responsible_rg: Optional[str] = None
    lvt_receiver_name: Optional[str] = None
    lvt_receiver_registration: Optional[str] = None
    inspection_responsible_name: Optional[str] = None
    inspection_responsible_registration: Optional[str] = None
    merit_record: Optional[str] = None
    occurrence_record: Optional[str] = None
    driver_document: Optional[str] = None
    release_datetime: Optional[str] = None  # Data e horário da liberação do veículo


class VehicleChecklist(VehicleChecklistFields):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    checklist_number: int  # Número sequencial
    status: str = "ATIVO"  # ATIVO, CANCELADO

    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None


class VehicleChecklistCreate(VehicleChecklistFields):
    pass


class VehicleChecklistResponse(VehicleChecklistFields):
    id: str
    checklist_number: int
    status: str
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# ==================== FROTA - CONTROLE DE REVISÃO ====================

class VehicleRevision(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    revision_number: int  # Número sequencial
    vehicle_plate: str  # Placa do veículo
    vehicle_model: Optional[str] = None  # Modelo do veículo
    
    # Dados da revisão atual
    revision_date: datetime
    oil_used: str  # Óleo utilizado
    current_km: int  # KM atual (trocado com)
    
    # Próxima revisão (KM)
    next_oil_motor_km: Optional[int] = None  # Óleo Motor
    next_oil_filter_km: Optional[int] = None  # Filtro Óleo
    next_air_filter_km: Optional[int] = None  # Filtro Ar
    next_ac_filter_km: Optional[int] = None  # Filtro Ar Condicionado
    next_fuel_filter_km: Optional[int] = None  # Filtro Combustível
    next_racor_filter_km: Optional[int] = None  # Filtro Racor
    next_apu_filter_km: Optional[int] = None  # Filtro APU
    next_hydraulic_filter_km: Optional[int] = None  # Filtro Hidraulico
    next_gearbox_oil_km: Optional[int] = None  # Óleo de Caixa de Marcha
    next_differential_oil_km: Optional[int] = None  # Óleo de Diferencial
    next_lubrication_km: Optional[int] = None  # Lubrificação
    next_washing_km: Optional[int] = None  # Lavagem
    
    # Responsáveis
    mechanic_name: str  # Nome do mecânico
    performed_by: Optional[str] = None  # Quem realizou a revisão
    observations: Optional[str] = None
    
    # Metadados
    created_by: str  # Quem gerou a revisão
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class VehicleRevisionCreate(BaseModel):
    vehicle_plate: str
    vehicle_model: Optional[str] = None
    revision_date: datetime
    oil_used: str
    current_km: int
    next_oil_motor_km: Optional[int] = None
    next_oil_filter_km: Optional[int] = None
    next_air_filter_km: Optional[int] = None
    next_ac_filter_km: Optional[int] = None
    next_fuel_filter_km: Optional[int] = None
    next_racor_filter_km: Optional[int] = None
    next_apu_filter_km: Optional[int] = None
    next_hydraulic_filter_km: Optional[int] = None
    next_gearbox_oil_km: Optional[int] = None
    next_differential_oil_km: Optional[int] = None
    next_lubrication_km: Optional[int] = None
    next_washing_km: Optional[int] = None
    mechanic_name: str
    performed_by: Optional[str] = None
    observations: Optional[str] = None

class VehicleRevisionResponse(BaseModel):
    id: str
    revision_number: int
    vehicle_plate: str
    vehicle_model: Optional[str] = None
    revision_date: datetime
    oil_used: str
    current_km: int
    next_oil_motor_km: Optional[int] = None
    next_oil_filter_km: Optional[int] = None
    next_air_filter_km: Optional[int] = None
    next_ac_filter_km: Optional[int] = None
    next_fuel_filter_km: Optional[int] = None
    next_racor_filter_km: Optional[int] = None
    next_apu_filter_km: Optional[int] = None
    next_hydraulic_filter_km: Optional[int] = None
    next_gearbox_oil_km: Optional[int] = None
    next_differential_oil_km: Optional[int] = None
    next_lubrication_km: Optional[int] = None
    next_washing_km: Optional[int] = None
    mechanic_name: str
    performed_by: Optional[str] = None
    observations: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None



# ==================== OPERACIONAL - PROGRAMAÇÃO DE CARREGAMENTO ====================

class LoadingScheduleItem(BaseModel):
    """Item individual da programação de carregamento"""
    operation_type: Optional[str] = None  # COLETA ou ENTREGA
    driver_id: Optional[str] = None
    driver_name: str
    driver_cpf: Optional[str] = None
    cavalo_plate: str  # Placa do cavalo mecânico
    carreta_plate: Optional[str] = None  # Placa da carreta
    loading_location: str  # Local de carregamento
    loading_date: str  # Data do carregamento (formato YYYY-MM-DD)
    container_number: Optional[str] = None  # Número do container
    seal_number: Optional[str] = None  # Número do lacre
    bag_number: Optional[str] = None  # Nº da Bolsa (flexitank) - usado por clientes de líquidos (ex: MANUPORT)

class LoadingSchedule(BaseModel):
    """Programação de carregamento completa"""
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    schedule_number: int  # Número sequencial da programação
    destination_client_id: str  # Cliente destino
    destination_client_name: str
    contracting_client_id: str  # Cliente contratante
    contracting_client_name: str
    booking: Optional[str] = None  # Número do Booking
    voyage: Optional[str] = None  # Número da Viagem
    items: List[LoadingScheduleItem]  # Lista de programações
    status: str = "ATIVO"  # ATIVO, CONCLUIDO, CANCELADO
    observations: Optional[str] = None

    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class LoadingScheduleCreate(BaseModel):
    destination_client_id: str
    destination_client_name: str
    contracting_client_id: str
    contracting_client_name: str
    booking: Optional[str] = None
    voyage: Optional[str] = None
    items: List[LoadingScheduleItem]
    observations: Optional[str] = None

class LoadingScheduleResponse(BaseModel):
    id: str
    schedule_number: int
    destination_client_id: str
    destination_client_name: str
    contracting_client_id: str
    contracting_client_name: str
    booking: Optional[str] = None
    voyage: Optional[str] = None
    items: List[LoadingScheduleItem]
    status: str
    observations: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# ==================== FINANCEIRO - SOLICITAÇÃO DE DIÁRIA ====================

class DailyRateRequestItem(BaseModel):
    """Item individual da solicitação de diária (uma viagem/motorista)"""
    driver_id: Optional[str] = None
    driver_name: str
    vehicle_plate: str
    client_name: str
    departure_date: str  # Data de saída (formato YYYY-MM-DD)
    others_value: float = 0
    commission_value: float = 0
    lunch_value: float = 0
    daily_rate_quantity: float = 0
    daily_rate_value: float = 0
    total: float = 0  # Calculado no backend: others + commission + lunch + quantity * daily_rate_value

class DailyRateRequest(BaseModel):
    """Solicitação de diária completa"""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    request_number: int  # Número sequencial da solicitação
    items: List[DailyRateRequestItem]
    total_value: float = 0  # Soma dos totais dos itens
    status: str = "PENDENTE"  # PENDENTE, PAGO, CANCELADO
    observations: Optional[str] = None

    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class DailyRateRequestCreate(BaseModel):
    items: List[DailyRateRequestItem]
    observations: Optional[str] = None

class DailyRateRequestResponse(BaseModel):
    id: str
    request_number: int
    items: List[DailyRateRequestItem]
    total_value: float
    status: str
    observations: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# ==================== INTERNATIONAL INVOICE ====================

class IntlInvoiceItem(BaseModel):
    """Item individual da Invoice Internacional"""
    description: str
    quantity: float = 1
    unit_price: float
    total: float

class IntlInvoice(BaseModel):
    """Invoice para cobrança internacional"""
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    invoice_number: int  # Número sequencial
    
    # Dados do Recebedor (J.A Logística)
    receiver_company: str
    receiver_email: str
    receiver_address: str
    receiver_city_state: str
    receiver_zip: str
    receiver_complement: Optional[str] = None
    
    # Dados do Pagador (Cliente)
    payer_client_id: Optional[str] = None
    payer_company: str
    payer_address: str
    
    # Detalhes da Invoice
    issue_date: str  # Data de emissão (YYYY-MM-DD)
    due_date: str  # Data de vencimento (YYYY-MM-DD)
    currency: str  # USD, EUR, BRL
    
    # Itens e valores
    items: List[IntlInvoiceItem]
    subtotal: float
    total: float
    
    # Observações
    notes: Optional[str] = None
    
    # Controle
    status: str = "EMITIDA"  # EMITIDA, PAGA, CANCELADA
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class IntlInvoiceCreate(BaseModel):
    payer_client_id: Optional[str] = None
    payer_company: str
    payer_cnpj: Optional[str] = None
    payer_contact: Optional[str] = None
    payer_email: Optional[str] = None
    payer_address: str
    issue_date: str
    due_date: str
    currency: str
    items: List[IntlInvoiceItem]
    notes: Optional[str] = None

class IntlInvoiceResponse(BaseModel):
    id: str
    invoice_number: int
    receiver_company: str
    receiver_email: str
    receiver_address: str
    receiver_city_state: str
    receiver_zip: str
    receiver_complement: Optional[str] = None
    payer_client_id: Optional[str] = None
    payer_company: str
    payer_cnpj: Optional[str] = None
    payer_contact: Optional[str] = None
    payer_email: Optional[str] = None
    payer_address: str
    issue_date: str
    due_date: str
    currency: str
    items: List[IntlInvoiceItem]
    subtotal: float
    total: float
    notes: Optional[str] = None
    status: str
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None



# ==================== STATUS DE ENTREGA ====================

class DeliveryStatusItem(BaseModel):
    """Item individual do status de entrega (um por motorista)"""
    driver_id: Optional[str] = None
    driver_name: str
    driver_cpf: Optional[str] = None
    cavalo_plate: str
    carreta_plate: Optional[str] = None
    container_number: Optional[str] = None
    loading_location: str
    # Horários de entrega
    port_schedule_time: Optional[str] = None  # Agendamento no Porto (HH:MM)
    arrival_time: Optional[str] = None  # Chegada no Cliente (HH:MM)
    loading_start_time: Optional[str] = None  # Início de Carregamento (HH:MM)
    loading_end_time: Optional[str] = None  # Término do Carregamento (HH:MM)
    departure_time: Optional[str] = None  # Saída do Cliente (HH:MM)
    delivery_completed: Optional[str] = None  # Entrega Finalizada (HH:MM)
    bag_number: Optional[str] = None  # Nº da Bolsa (flexitank) - usado por clientes de líquidos (ex: MANUPORT)

class DeliveryStatus(BaseModel):
    """Status de entrega baseado em uma programação de carregamento"""
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status_number: int  # Número sequencial do status
    
    # Referência à programação de carregamento
    schedule_id: str
    schedule_number: int
    
    # Dados copiados da programação
    destination_client_name: str
    contracting_client_name: str
    booking: Optional[str] = None
    voyage: Optional[str] = None

    # Data do status
    status_date: str  # Data do status (YYYY-MM-DD)

    # Itens com horários de cada motorista
    items: List[DeliveryStatusItem]

    # Observações
    observations: Optional[str] = None

    # Controle
    status: str = "ATIVO"  # ATIVO, CONCLUIDO, CANCELADO
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class DeliveryStatusCreate(BaseModel):
    schedule_number: int  # Número da programação para buscar dados
    status_date: str
    items: List[DeliveryStatusItem]
    observations: Optional[str] = None

class DeliveryStatusResponse(BaseModel):
    id: str
    status_number: int
    schedule_id: str
    schedule_number: int
    destination_client_name: str
    contracting_client_name: str
    booking: Optional[str] = None
    voyage: Optional[str] = None
    status_date: str
    items: List[DeliveryStatusItem]
    observations: Optional[str] = None
    status: str
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# ==================== SEGREGAÇÃO DE UNIDADE ====================

class UnitSegregationItem(BaseModel):
    """Item individual da segregação - representa um container"""
    container_number: str  # Número do container
    tare: Optional[str] = None  # Tara
    shipping_line: str  # Armador ID
    shipping_line_name: Optional[str] = None  # Nome do armador


class UnitSegregation(BaseModel):
    """Segregação de Unidade - reserva containers para um cliente específico"""
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    segregation_number: int  # Número sequencial
    
    # Cliente reservado
    client_id: str
    client_name: str
    
    # Lista de containers segregados
    items: List[UnitSegregationItem] = []
    
    # Status da segregação
    status: str = "ATIVO"  # ATIVO, LIBERADO, CANCELADO
    
    # Observações
    observations: Optional[str] = None
    
    # Controle
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    released_at: Optional[datetime] = None  # Data de liberação
    released_by: Optional[str] = None
    released_by_name: Optional[str] = None


class UnitSegregationCreate(BaseModel):
    client_id: str
    items: List[UnitSegregationItem]
    observations: Optional[str] = None


class UnitSegregationUpdate(BaseModel):
    client_id: Optional[str] = None
    items: Optional[List[UnitSegregationItem]] = None
    observations: Optional[str] = None
    status: Optional[str] = None


class UnitSegregationResponse(BaseModel):
    id: str
    segregation_number: int
    client_id: str
    client_name: str
    items: List[UnitSegregationItem]
    status: str
    observations: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: datetime
    released_at: Optional[datetime] = None
    released_by: Optional[str] = None
    released_by_name: Optional[str] = None



# ============= RPA TERCEIRO (Recibo de Pagamento a Autônomo) =============

class RPAServiceItem(BaseModel):
    """Item do demonstrativo de serviços prestados"""
    description: str  # ex: "01 - COLETA E ENTREGA DE CNTR LS"
    value: float = 0.0


class RPATerceiro(BaseModel):
    """RPA - Recibo de Pagamento a Autônomo (motorista terceiro)"""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    rpa_number: int  # Número sequencial (Nº 47)
    rpa_type: str = "terceiro"  # "terceiro" | "agregado"

    # ===== DADOS AUTÔNOMO =====
    driver_name: Optional[str] = None  # MOTORISTA
    driver_cpf: Optional[str] = None  # CPF
    driver_phone: Optional[str] = None  # TELEFONE
    truck_plate: Optional[str] = None  # PLACA CAVALO
    truck_renavam: Optional[str] = None  # RENAVAN
    truck_owner: Optional[str] = None  # PROPRIETÁRIO
    trailer_plate: Optional[str] = None  # PLACA CAVALO (segundo veículo/carreta)
    trailer_renavam: Optional[str] = None  # RENAVAN (segundo)
    trailer_owner: Optional[str] = None  # PROPRIETÁRIO (segundo)

    # ===== DADOS DO SERVIÇO PRESTADO =====
    service_local: Optional[str] = None  # LOCAL
    service_date: Optional[str] = None  # DATA (ISO yyyy-mm-dd)
    service_type: Optional[str] = None  # SERVIÇO (ex: CONTAINER)
    service_modality: Optional[str] = None  # TIPO (LS/RODO)
    origin: Optional[str] = None  # ORIGEM
    destination: Optional[str] = None  # DESTINO
    cte: Optional[str] = None  # CTE
    weight: Optional[str] = None  # PESO
    collection_date: Optional[str] = None  # DATA COLETA
    delivery_date: Optional[str] = None  # DATA ENTREGA
    container_number: Optional[str] = None  # Nº CONTAINER
    client_name: Optional[str] = None  # CLIENTE

    # ===== DEMONSTRATIVO DOS SERVIÇOS PRESTADOS =====
    services: List[RPAServiceItem] = []

    # ===== ESPECIFICAÇÃO DA REMUNERAÇÃO =====
    service_value: float = 0.0  # I. VALOR DO SERVIÇO
    daily_rate: float = 0.0  # II. DIÁRIAS
    fuel: float = 0.0  # III. ABASTECIMENTO
    advance: float = 0.0  # IV. ADIANTAMENTO
    others: float = 0.0  # VI. OUTROS
    discounts: float = 0.0  # DESCONTOS

    # SALDO A RECEBER calculado: service_value + daily_rate + fuel + others - advance - discounts

    # ===== DADOS BANCÁRIOS DO BENEFICIÁRIO =====
    bank_agency: Optional[str] = None  # Nº AGÊNCIA
    bank_account: Optional[str] = None  # Nº CONTA
    bank_pix: Optional[str] = None  # CHAVE PIX
    bank_beneficiary: Optional[str] = None  # BENEFICIÁRIO

    # Observação extra
    observations: Optional[str] = None

    # Controle
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None


class RPATerceiroCreate(BaseModel):
    rpa_type: str = "terceiro"
    driver_name: Optional[str] = None
    driver_cpf: Optional[str] = None
    driver_phone: Optional[str] = None
    truck_plate: Optional[str] = None
    truck_renavam: Optional[str] = None
    truck_owner: Optional[str] = None
    trailer_plate: Optional[str] = None
    trailer_renavam: Optional[str] = None
    trailer_owner: Optional[str] = None
    service_local: Optional[str] = None
    service_date: Optional[str] = None
    service_type: Optional[str] = None
    service_modality: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    cte: Optional[str] = None
    weight: Optional[str] = None
    collection_date: Optional[str] = None
    delivery_date: Optional[str] = None
    container_number: Optional[str] = None
    client_name: Optional[str] = None
    services: List[RPAServiceItem] = []
    service_value: float = 0.0
    daily_rate: float = 0.0
    fuel: float = 0.0
    advance: float = 0.0
    others: float = 0.0
    discounts: float = 0.0
    bank_agency: Optional[str] = None
    bank_account: Optional[str] = None
    bank_pix: Optional[str] = None
    bank_beneficiary: Optional[str] = None
    observations: Optional[str] = None


class RPATerceiroUpdate(RPATerceiroCreate):
    pass


class RPATerceiroResponse(BaseModel):
    id: str
    rpa_number: int
    rpa_type: str = "terceiro"
    driver_name: Optional[str] = None
    driver_cpf: Optional[str] = None
    driver_phone: Optional[str] = None
    truck_plate: Optional[str] = None
    truck_renavam: Optional[str] = None
    truck_owner: Optional[str] = None
    trailer_plate: Optional[str] = None
    trailer_renavam: Optional[str] = None
    trailer_owner: Optional[str] = None
    service_local: Optional[str] = None
    service_date: Optional[str] = None
    service_type: Optional[str] = None
    service_modality: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    cte: Optional[str] = None
    weight: Optional[str] = None
    collection_date: Optional[str] = None
    delivery_date: Optional[str] = None
    container_number: Optional[str] = None
    client_name: Optional[str] = None
    services: List[RPAServiceItem] = []
    service_value: float = 0.0
    daily_rate: float = 0.0
    fuel: float = 0.0
    advance: float = 0.0
    others: float = 0.0
    discounts: float = 0.0
    balance: float = 0.0  # calculado
    bank_agency: Optional[str] = None
    bank_account: Optional[str] = None
    bank_pix: Optional[str] = None
    bank_beneficiary: Optional[str] = None
    observations: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: datetime
    updated_at: Optional[datetime] = None



# ============= ORDEM DE SERVIÇO (FROTA) =============

class OSItem(BaseModel):
    """Item de Produto ou Serviço na OS"""
    code: Optional[str] = None
    description: str = ''
    quantity: float = 1.0
    unit: Optional[str] = 'UN'
    unit_price: float = 0.0
    discount: float = 0.0
    total: float = 0.0  # quantity * unit_price - discount


class OrdemServico(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    os_number: int

    # ===== Dados da O.S. =====
    priority: str = 'MEDIA'  # ALTA | MEDIA | BAIXA
    requires_pt: bool = False  # Exige PT?
    os_type: str = 'EXTERNO'  # INTERNO | EXTERNO
    status: str = 'ABERTO'  # ABERTO | ANDAMENTO | FECHADO | CANCELADO
    category: Optional[str] = None  # MANUTENÇÃO CORRETIVA - INTERNA/EXTERNA, PREVENTIVA, etc.

    # Equipamento / Pessoa / Endereço
    equipment_plate: Optional[str] = None  # Equip. (Placa veículo)
    equipment_id: Optional[str] = None  # Referência ao Vehicle.id
    person_doc: Optional[str] = None  # CPF/CNPJ
    person_name: Optional[str] = None  # Pessoa
    address: Optional[str] = None  # Endereço
    city_uf: Optional[str] = None  # ex: PARACURU/CE
    is_retorno: bool = False  # Checkbox Retorno
    contact_type: str = 'banco'  # banco | outros
    contact_value: Optional[str] = None

    # ===== Prazos =====
    opened_at: Optional[str] = None  # Data Abertura (ISO yyyy-mm-ddTHH:MM)
    budget_at: Optional[str] = None  # Orçamento
    approved_at: Optional[str] = None  # Aprovação
    forecast_close_at: Optional[str] = None  # Prev. fechamento
    closed_at: Optional[str] = None  # Fechamento

    # ===== Apropriação =====
    appropriation_plate: Optional[str] = None  # Equipamento agregador

    # ===== Supervisão e Notificações =====
    supervision_type: str = 'outros'  # banco | outros
    supervision_value: Optional[str] = None

    # ===== Controle de Uso =====
    reading_initial: float = 0.0
    reading_final: float = 0.0

    # ===== Descrição da O.S. =====
    description: Optional[str] = None  # Detalhamento da Demanda
    associated_actions: Optional[str] = None  # Ações Associadas
    closure_remark: Optional[str] = None  # Parecer de Encerramento

    # ===== Observação / Ajudante =====
    observations: Optional[str] = None
    helper_name: Optional[str] = None  # Ajudante
    technician_name: Optional[str] = None  # Técnico
    supervisor_name: Optional[str] = None  # Supervisor

    # ===== Produtos e Serviços =====
    products: List[OSItem] = []
    services: List[OSItem] = []

    # ===== Controle =====
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None


class OrdemServicoCreate(BaseModel):
    priority: str = 'MEDIA'
    requires_pt: bool = False
    os_type: str = 'EXTERNO'
    status: str = 'ABERTO'
    category: Optional[str] = None
    equipment_plate: Optional[str] = None
    equipment_id: Optional[str] = None
    person_doc: Optional[str] = None
    person_name: Optional[str] = None
    address: Optional[str] = None
    city_uf: Optional[str] = None
    is_retorno: bool = False
    contact_type: str = 'banco'
    contact_value: Optional[str] = None
    opened_at: Optional[str] = None
    budget_at: Optional[str] = None
    approved_at: Optional[str] = None
    forecast_close_at: Optional[str] = None
    closed_at: Optional[str] = None
    appropriation_plate: Optional[str] = None
    supervision_type: str = 'outros'
    supervision_value: Optional[str] = None
    reading_initial: float = 0.0
    reading_final: float = 0.0
    description: Optional[str] = None
    associated_actions: Optional[str] = None
    closure_remark: Optional[str] = None
    observations: Optional[str] = None
    helper_name: Optional[str] = None
    technician_name: Optional[str] = None
    supervisor_name: Optional[str] = None
    products: List[OSItem] = []
    services: List[OSItem] = []


class OrdemServicoUpdate(OrdemServicoCreate):
    pass


class OrdemServicoResponse(OrdemServico):
    products_total: float = 0.0
    services_total: float = 0.0
    grand_total: float = 0.0


# ==================== FINANCEIRO - PRESTAÇÃO DE CONTAS ====================

class ExpenseReportReceipt(BaseModel):
    """Comprovante/recibo anexado a um lançamento de compra"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    url: str

class ExpenseReportDeposit(BaseModel):
    """Depósito recebido do setor financeiro para cobrir as compras"""
    amount: float
    date: str  # YYYY-MM-DD
    sent_by: str  # Enviado Por

class ExpenseReportPurchase(BaseModel):
    """Lançamento de compra realizado durante o período"""
    item_id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # gerado no client antes do save
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None  # snapshot resolvido no backend a partir do supplier_id
    purchase_date: str  # YYYY-MM-DD
    amount: float
    observation: Optional[str] = None
    receipts: List[ExpenseReportReceipt] = Field(default_factory=list)

class ExpenseReport(BaseModel):
    """Prestação de contas completa de um período"""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    report_number: int  # Sequencial dentro do ano civil
    report_number_formatted: str  # Ex: "20260001" (ano + sequencial de 4 dígitos)
    period_start: str  # YYYY-MM-DD
    period_end: str  # YYYY-MM-DD
    deposits: List[ExpenseReportDeposit] = Field(default_factory=list)
    purchases: List[ExpenseReportPurchase] = Field(default_factory=list)
    total_deposits: float = 0
    total_purchases: float = 0
    balance: float = 0  # total_purchases - total_deposits
    status: str = "EM_ANDAMENTO"  # EM_ANDAMENTO, CONCLUIDA
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class ExpenseReportCreate(BaseModel):
    period_start: str
    period_end: str
    deposits: List[ExpenseReportDeposit] = Field(default_factory=list)
    purchases: List[ExpenseReportPurchase] = Field(default_factory=list)

class ExpenseReportResponse(ExpenseReport):
    pass
