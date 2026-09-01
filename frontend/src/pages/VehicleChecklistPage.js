import { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { useConfirm } from '../hooks/useConfirm';
import { Autocomplete } from '../components/Autocomplete';
import { useCompanySettings, getCompanyLogoUrl } from '../lib/useCompanySettings';
import {
  ClipboardCheck, Plus, Eye, Pencil, Trash2, Printer, Search, X, CheckCircle2, XCircle, AlertTriangle,
  Camera, Upload
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Toggle SIM/NÃO compacto por item
function SimNaoToggle({ value, onChange, testId }) {
  return (
    <div className="flex gap-1 flex-shrink-0">
      <button
        type="button"
        data-testid={testId ? `${testId}-sim` : undefined}
        onClick={() => onChange(value === 'SIM' ? null : 'SIM')}
        className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
          value === 'SIM'
            ? 'bg-green-600 border-green-600 text-white'
            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-green-400'
        }`}
      >
        Sim
      </button>
      <button
        type="button"
        data-testid={testId ? `${testId}-nao` : undefined}
        onClick={() => onChange(value === 'NAO' ? null : 'NAO')}
        className={`px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
          value === 'NAO'
            ? 'bg-red-600 border-red-600 text-white'
            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-red-400'
        }`}
      >
        Não
      </button>
    </div>
  );
}

const emptyForm = {
  template: 'generic',
  expedidor: '',
  un: '',
  inspection_datetime: '',
  scheduling_code: '',
  un_address: '',
  phone: '',
  fax: '',
  client_id: '',
  client_name: '',
  orp_odp_number: '',
  nf_number: '',
  transport_company_id: '',
  transport_company_name: '',
  driver_id: '',
  driver_name: '',
  driver_cpf: '',
  products_description: '',
  cavalo_plate: '',
  cavalo_year: '',
  carreta1_plate: '',
  carreta1_year: '',
  carreta1_capacity: '',
  carreta2_plate: '',
  carreta2_year: '',
  carreta2_capacity: '',
  cnh_number: '',
  cnh_category: '',
  cnh_expiry: '',
  sap_code: '',
  documentos_items: [],
  vehicle_condition_items: [],
  epi_items: [],
  kit_items: [],
  tank_items: [],
  post_loading_items: [],
  products: [],
  kit_validity_1: '',
  kit_validity_2: '',
  kit_validity_3: '',
  last_trip_product_1: '',
  last_trip_product_2: '',
  last_trip_product_3: '',
  observations: '',
  transport_responsible_name: '',
  transport_responsible_rg: '',
  lvt_receiver_name: '',
  lvt_receiver_registration: '',
  inspection_responsible_name: '',
  inspection_responsible_registration: '',
  merit_record: '',
  occurrence_record: '',
  driver_document: '',
  release_datetime: '',
};

const SECTION_FIELD_BY_KEY = {
  documentos: 'documentos_items',
  vehicle_condition: 'vehicle_condition_items',
  epi: 'epi_items',
  kit: 'kit_items',
  tank: 'tank_items',
  post_loading: 'post_loading_items',
};

// Modelo atual de checklist (substituiu o modelo LVT/Manuport pra novos
// registros - ver memory/PRD.md): identificação básica do veículo + fotos,
// sem os itens SIM/NÃO do modelo antigo. Checklists antigos continuam no
// banco intactos, só pra consulta/histórico (ver openEditModal/modalOpen).
const VEHICLE_TYPE_OPTIONS = [
  { value: 'CAMINHAO', label: 'Caminhão' },
  { value: 'CARRETA', label: 'Carreta' },
  { value: 'CARRO', label: 'Carro' },
];
const VEHICLE_TYPE_LABELS = VEHICLE_TYPE_OPTIONS.reduce((acc, { value, label }) => { acc[value] = label; return acc; }, {});

const CHECKLIST_PHOTO_TYPES = [
  { value: 'front', label: 'Frente' },
  { value: 'back', label: 'Traseira' },
  { value: 'left_side', label: 'Lateral Esquerda' },
  { value: 'right_side', label: 'Lateral Direita' },
  { value: 'speedometer', label: 'Velocímetro' },
  { value: 'tires', label: 'Pneus' },
];
const CHECKLIST_PHOTO_LABELS = CHECKLIST_PHOTO_TYPES.reduce((acc, { value, label }) => { acc[value] = label; return acc; }, {});
const MAX_VEHICLE_CHECKLIST_PHOTOS = 24;

const emptySimpleForm = {
  vehicle_type: 'CAMINHAO',
  vehicle_plate: '',
  driver_id: '',
  driver_name: '',
  vistoriador_id: '',
  vistoriador_name: '',
  current_km: '',
  inspection_datetime: '',
  observations: '',
};

const buildSectionsFromTemplate = (sections) =>
  (sections || []).map((s) => ({ label: s.label, items: (s.items || []).map((text) => ({ text, answer: null })) }));

// Layout de impressão do checklist simplificado (window.print(), igual ao
// padrão usado em ContainerInspectionDetailPage) - fica fora do fluxo normal
// da página, só visível quando a página entra em modo impressão.
function SimpleChecklistPrintView({ checklist, company }) {
  const photosByType = CHECKLIST_PHOTO_TYPES.map(({ value, label }) => ({
    value,
    label,
    photos: (checklist.photos || []).filter((p) => p.type === value),
  }));
  const hasPhotos = (checklist.photos || []).length > 0;

  return (
    <div className="print-only">
      <div className="print-registry" style={{
        width: '210mm',
        minHeight: '297mm',
        padding: '8mm',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#fff',
        boxSizing: 'border-box'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px', gap: '12px' }}>
          <img src={getCompanyLogoUrl(company)} alt={company.name} style={{ height: '40px', width: 'auto' }} />
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#000', fontFamily: 'Arial Black, sans-serif' }}>
            {company.name}
          </div>
        </div>

        <div style={{ border: '2px solid #000', padding: '6px 10px', borderRadius: '4px', textAlign: 'center', marginBottom: '10px' }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#000' }}>CHECKLIST DE VEÍCULO</div>
          <div style={{ fontSize: '11px', color: '#000', marginTop: '2px' }}>Checklist Nº {checklist.checklist_number}</div>
        </div>

        <div style={{ border: '1px solid #000', borderRadius: '4px', marginBottom: '8px', overflow: 'hidden' }}>
          <div style={{ backgroundColor: '#f0f0f0', padding: '4px 8px', borderBottom: '1px solid #000', fontWeight: 'bold', fontSize: '10px' }}>
            Identificação
          </div>
          <div style={{ padding: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Tipo de Veículo</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{VEHICLE_TYPE_LABELS[checklist.vehicle_type] || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Placa</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{checklist.vehicle_plate || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Km Atual</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{checklist.current_km != null ? `${checklist.current_km.toLocaleString('pt-BR')} km` : '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Motorista</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{checklist.driver_name || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Vistoriador</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{checklist.vistoriador_name || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Data/Hora</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>
                {checklist.inspection_datetime ? format(new Date(checklist.inspection_datetime), "dd/MM/yyyy HH:mm", { locale: ptBR }) : '-'}
              </div>
            </div>
          </div>
        </div>

        {(checklist.checklist_sections || []).length > 0 && (
          <div style={{ border: '1px solid #000', borderRadius: '4px', marginBottom: '8px', overflow: 'hidden' }}>
            <div style={{ backgroundColor: '#f0f0f0', padding: '4px 8px', borderBottom: '1px solid #000', fontWeight: 'bold', fontSize: '10px' }}>
              Itens de Verificação
            </div>
            <div style={{ padding: '8px' }}>
              {checklist.checklist_sections.map((section, sIdx) => (
                <div key={sIdx} style={{ marginBottom: sIdx < checklist.checklist_sections.length - 1 ? '6px' : 0, breakInside: 'avoid' }}>
                  <div style={{ fontSize: '9px', fontWeight: 'bold', marginBottom: '2px' }}>{section.label}</div>
                  {(section.items || []).map((item, iIdx) => (
                    <div key={iIdx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', padding: '2px 0', borderBottom: '1px solid #eee' }}>
                      <span>{item.text}</span>
                      <span style={{ fontWeight: 'bold', color: item.answer === 'NAO' ? '#c00' : item.answer === 'SIM' ? '#080' : '#999' }}>
                        {item.answer === 'SIM' ? 'SIM' : item.answer === 'NAO' ? 'NÃO' : '-'}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {checklist.observations && (
          <div style={{ border: '1px solid #000', borderRadius: '4px', marginBottom: '8px', overflow: 'hidden' }}>
            <div style={{ backgroundColor: '#f0f0f0', padding: '4px 8px', borderBottom: '1px solid #000', fontWeight: 'bold', fontSize: '10px' }}>
              Observações
            </div>
            <div style={{ padding: '8px', fontSize: '10px' }}>{checklist.observations}</div>
          </div>
        )}

        <div style={{ border: '1px solid #000', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ backgroundColor: '#f0f0f0', padding: '4px 8px', borderBottom: '1px solid #000', fontWeight: 'bold', fontSize: '10px' }}>
            Fotos
          </div>
          {hasPhotos ? (
            <div style={{ padding: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {photosByType.flatMap(({ label, photos }) =>
                photos.map((photo) => (
                  <div key={photo.id} style={{ border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden', breakInside: 'avoid' }}>
                    <img src={api.getFileUrl(photo.url)} alt={label} style={{ width: '100%', height: '55mm', objectFit: 'cover', display: 'block' }} />
                    <div style={{ fontSize: '8px', textAlign: 'center', padding: '2px', backgroundColor: '#f7f7f7' }}>{label}</div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div style={{ padding: '8px', fontSize: '10px', color: '#666' }}>Nenhuma foto registrada.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VehicleChecklistPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const company = useCompanySettings();
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  const [clients, setClients] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [template, setTemplate] = useState([]);

  // Modal legado (LVT/ANTT/Manuport) - só usado hoje pra editar/consultar
  // checklists antigos já existentes. Não é mais possível criar um novo
  // checklist nesse formato (ver openNewSimpleModal).
  const [modalOpen, setModalOpen] = useState(false);
  const [editingChecklist, setEditingChecklist] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(emptyForm);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedChecklist, setSelectedChecklist] = useState(null);

  // Modal do checklist simplificado (modelo atual - identificação + fotos)
  const [simpleModalOpen, setSimpleModalOpen] = useState(false);
  const [simpleForm, setSimpleForm] = useState(emptySimpleForm);
  const [simpleEditingId, setSimpleEditingId] = useState(null);
  const [simplePhotos, setSimplePhotos] = useState([]);
  const [simpleSections, setSimpleSections] = useState([]);
  const [newPhotoType, setNewPhotoType] = useState('front');
  const [savingSimple, setSavingSimple] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const simpleFileInputRef = useRef(null);
  const [printChecklist, setPrintChecklist] = useState(null);

  useEffect(() => {
    loadChecklists();
    loadSelectData();
  }, [pagination.page]);

  const loadSelectData = async () => {
    try {
      const [clientsRes, companiesRes, driversRes, vehiclesRes, templateRes] = await Promise.all([
        api.getClients(),
        api.getCompanies(),
        api.getDrivers(),
        api.getVehicles({ per_page: 200 }),
        api.getVehicleChecklistTemplate(),
      ]);
      setClients(clientsRes.data);
      setCompanies(companiesRes.data);
      setDrivers(driversRes.data);
      setVehicles(vehiclesRes.data.items || []);
      setTemplate(templateRes.data.sections || []);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      toast.error('Erro ao carregar dados');
    }
  };

  const loadChecklists = async (search = '') => {
    setLoading(true);
    try {
      const params = { page: pagination.page, per_page: 15 };
      if (search) params.search = search;
      const response = await api.getVehicleChecklists(params);
      setChecklists(response.data.items);
      setPagination(prev => ({ ...prev, pages: response.data.pages, total: response.data.total }));
    } catch (error) {
      toast.error('Erro ao carregar checklists');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    loadChecklists(searchQuery);
  };

  const cavalos = vehicles.filter(v => v.vehicle_type === 'CAVALO' || v.vehicle_type === 'CAMINHÃO');
  const carretas = vehicles.filter(v => v.vehicle_type === 'CARRETA');

  const buildItemsFromTemplate = () => {
    const result = {};
    template.forEach(section => {
      result[SECTION_FIELD_BY_KEY[section.key]] = section.items.map(text => ({ text, answer: null, expiry: null }));
    });
    return result;
  };

  const resetForm = () => {
    setFormData({ ...emptyForm, ...buildItemsFromTemplate() });
    setEditingChecklist(null);
  };

  const openEditModal = (checklist) => {
    setEditingChecklist(checklist);
    setFormData({ ...emptyForm, ...checklist });
    setModalOpen(true);
  };

  const viewDetails = (checklist) => {
    setSelectedChecklist(checklist);
    setDetailModalOpen(true);
  };

  const updateItem = (sectionField, index, patch) => {
    setFormData(prev => {
      const items = [...prev[sectionField]];
      items[index] = { ...items[index], ...patch };
      return { ...prev, [sectionField]: items };
    });
  };

  const addProduct = () => {
    setFormData(prev => ({ ...prev, products: [...prev.products, { product: '', un_number: '', risk_number: '', subclass: '' }] }));
  };

  const updateProduct = (index, field, value) => {
    setFormData(prev => {
      const products = [...prev.products];
      products[index] = { ...products[index], [field]: value };
      return { ...prev, products };
    });
  };

  const removeProduct = (index) => {
    setFormData(prev => ({ ...prev, products: prev.products.filter((_, i) => i !== index) }));
  };

  const handleSubmit = async () => {
    if (!formData.driver_name || !formData.cavalo_plate) {
      toast.error('Preencha ao menos o motorista e a placa do cavalo');
      return;
    }
    setSaving(true);
    try {
      if (editingChecklist) {
        await api.updateVehicleChecklist(editingChecklist.id, formData);
        toast.success('Checklist atualizado com sucesso!');
      } else {
        await api.createVehicleChecklist(formData);
        toast.success('Checklist criado com sucesso!');
      }
      setModalOpen(false);
      resetForm();
      loadChecklists();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar checklist');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!(await confirm('Tem certeza que deseja excluir este checklist?'))) return;
    try {
      await api.deleteVehicleChecklist(id);
      toast.success('Checklist excluído!');
      loadChecklists();
    } catch (error) {
      toast.error('Erro ao excluir');
    }
  };

  const handlePrint = async (id) => {
    try {
      const response = await api.getVehicleChecklistPDF(id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `checklist_veiculo_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Erro ao gerar PDF');
    }
  };

  const checklistStatus = (checklist) => {
    const allItems = [
      ...(checklist.documentos_items || []),
      ...(checklist.vehicle_condition_items || []),
      ...(checklist.epi_items || []),
      ...(checklist.kit_items || []),
      ...(checklist.tank_items || []),
      ...(checklist.post_loading_items || []),
      ...(checklist.checklist_sections || []).flatMap(s => s.items || []),
    ];
    if (allItems.some(i => i.answer === 'NAO')) return 'REPROVADO';
    if (allItems.length > 0 && allItems.every(i => i.answer === 'SIM')) return 'APROVADO';
    return 'PENDENTE';
  };

  const statusBadge = (status) => {
    const styles = {
      APROVADO: 'bg-green-100 text-green-800',
      REPROVADO: 'bg-red-100 text-red-800',
      PENDENTE: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${styles[status]}`}>
        {status}
      </span>
    );
  };

  const renderItemsSection = (sectionKey, label) => {
    const fieldName = SECTION_FIELD_BY_KEY[sectionKey];
    const items = formData[fieldName] || [];
    if (items.length === 0) return null;
    const hasExpiry = sectionKey === 'documentos';

    return (
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-primary/10 px-4 py-2">
          <h4 className="text-sm font-semibold text-primary">{label}</h4>
        </div>
        <div className="divide-y">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-xs text-slate-400 dark:text-slate-500 w-5 flex-shrink-0">{idx + 1}</span>
              <span className="text-sm flex-1">{item.text}</span>
              {hasExpiry && (
                <Input
                  type="date"
                  value={item.expiry || ''}
                  onChange={(e) => updateItem(fieldName, idx, { expiry: e.target.value })}
                  className="h-8 w-40 text-xs flex-shrink-0"
                  data-testid={`checklist-item-expiry-${sectionKey}-${idx}`}
                />
              )}
              <SimNaoToggle
                value={item.answer}
                onChange={(v) => updateItem(fieldName, idx, { answer: v })}
                testId={`checklist-item-${sectionKey}-${idx}`}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ===== Checklist simplificado (modelo atual) =====

  const resetSimpleForm = () => {
    setSimpleForm(emptySimpleForm);
    setSimplePhotos([]);
    setSimpleSections([]);
    setSimpleEditingId(null);
  };

  const loadSimpleTemplate = async (vehicleType) => {
    try {
      const res = await api.getSimpleVehicleChecklistTemplate(vehicleType);
      setSimpleSections(buildSectionsFromTemplate(res.data.sections));
    } catch (error) {
      toast.error('Erro ao carregar itens do checklist');
    }
  };

  const openNewSimpleModal = () => {
    resetSimpleForm();
    setSimpleModalOpen(true);
    loadSimpleTemplate(emptySimpleForm.vehicle_type);
  };

  const openEditSimpleModal = (checklist) => {
    setSimpleEditingId(checklist.id);
    setSimpleForm({
      vehicle_type: checklist.vehicle_type || 'CAMINHAO',
      vehicle_plate: checklist.vehicle_plate || '',
      driver_id: checklist.driver_id || '',
      driver_name: checklist.driver_name || '',
      vistoriador_id: checklist.vistoriador_id || '',
      vistoriador_name: checklist.vistoriador_name || '',
      current_km: checklist.current_km != null ? String(checklist.current_km) : '',
      inspection_datetime: checklist.inspection_datetime || '',
      observations: checklist.observations || '',
    });
    setSimplePhotos(checklist.photos || []);
    setSimpleSections(buildSectionsFromTemplate(checklist.checklist_sections));
    setSimpleModalOpen(true);
  };

  // Troca dos itens de verificação quando o tipo de veículo muda - descarta
  // as respostas já marcadas (seções diferentes por tipo, não faz sentido
  // tentar preservar). Handler explícito em vez de useEffect pra não disparar
  // sozinho ao abrir o modal de edição (que já vem com checklist_sections
  // carregado do registro salvo).
  const handleVehicleTypeChange = (newType) => {
    setSimpleForm(prev => ({ ...prev, vehicle_type: newType }));
    loadSimpleTemplate(newType);
  };

  const updateSimpleSectionItem = (sectionIdx, itemIdx, patch) => {
    setSimpleSections(prev => {
      const next = [...prev];
      const items = [...next[sectionIdx].items];
      items[itemIdx] = { ...items[itemIdx], ...patch };
      next[sectionIdx] = { ...next[sectionIdx], items };
      return next;
    });
  };

  // Sempre inclui checklist_kind + listas vazias dos campos do modelo antigo,
  // senão o backend recria os itens padrão (default_factory do Pydantic) a
  // cada salvamento. `photos` também precisa ser sempre reenviado - o PUT
  // substitui o documento inteiro, não faz merge.
  const buildSimplePayload = (photos) => ({
    checklist_kind: 'simple',
    vehicle_type: simpleForm.vehicle_type,
    vehicle_plate: simpleForm.vehicle_plate,
    driver_id: simpleForm.driver_id,
    driver_name: simpleForm.driver_name,
    vistoriador_id: simpleForm.vistoriador_id,
    vistoriador_name: simpleForm.vistoriador_name,
    current_km: simpleForm.current_km !== '' ? parseInt(simpleForm.current_km, 10) : null,
    inspection_datetime: simpleForm.inspection_datetime,
    observations: simpleForm.observations,
    documentos_items: [],
    vehicle_condition_items: [],
    epi_items: [],
    kit_items: [],
    tank_items: [],
    post_loading_items: [],
    products: [],
    checklist_sections: simpleSections,
    photos: photos.map((p) => ({ id: p.id, type: p.type, url: p.url })),
  });

  const triggerSimpleFileInput = (useCamera) => {
    const input = simpleFileInputRef.current;
    if (!input) return;
    if (useCamera) input.setAttribute('capture', 'environment');
    else input.removeAttribute('capture');
    input.click();
  };

  const handleAddSimplePhoto = async (file) => {
    if (!file) return;
    if (simplePhotos.length >= MAX_VEHICLE_CHECKLIST_PHOTOS) {
      toast.error(`Máximo de ${MAX_VEHICLE_CHECKLIST_PHOTOS} fotos por checklist`);
      return;
    }
    if (simpleEditingId) {
      // Checklist já existe (edição) - envia a foto direto pro servidor
      setUploadingPhoto(true);
      try {
        const res = await api.uploadVehicleChecklistPhoto(simpleEditingId, newPhotoType, file);
        setSimplePhotos(prev => [...prev, res.data]);
      } catch (error) {
        toast.error('Erro ao enviar foto');
      } finally {
        setUploadingPhoto(false);
      }
    } else {
      // Checklist novo (ainda sem id) - guarda localmente, envia após criar
      setSimplePhotos(prev => [...prev, { id: `local-${Date.now()}-${Math.random()}`, type: newPhotoType, file }]);
    }
  };

  const handleRemoveSimplePhoto = async (photo) => {
    if (photo.file) {
      setSimplePhotos(prev => prev.filter(p => p.id !== photo.id));
      return;
    }
    if (!simpleEditingId) return;
    try {
      await api.deleteVehicleChecklistPhoto(simpleEditingId, photo.id);
      setSimplePhotos(prev => prev.filter(p => p.id !== photo.id));
    } catch (error) {
      toast.error('Erro ao remover foto');
    }
  };

  const handleSimpleSubmit = async () => {
    if (!simpleForm.driver_name || !simpleForm.vehicle_plate) {
      toast.error('Preencha ao menos o motorista e a placa do veículo');
      return;
    }
    setSavingSimple(true);
    try {
      if (simpleEditingId) {
        await api.updateVehicleChecklist(simpleEditingId, buildSimplePayload(simplePhotos));
        toast.success('Checklist atualizado com sucesso!');
      } else {
        const res = await api.createVehicleChecklist(buildSimplePayload([]));
        const newId = res.data.id;
        const staged = simplePhotos.filter(p => p.file);
        for (const photo of staged) {
          await api.uploadVehicleChecklistPhoto(newId, photo.type, photo.file);
        }
        toast.success('Checklist criado com sucesso!');
      }
      setSimpleModalOpen(false);
      resetSimpleForm();
      loadChecklists();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Erro ao salvar checklist');
    } finally {
      setSavingSimple(false);
    }
  };

  const handleSimplePrint = (checklist) => {
    // Fecha qualquer modal aberto antes de imprimir - o conteúdo do Dialog é
    // renderizado em portal fora da área marcada como .no-print e ficaria
    // visível por cima do layout de impressão se continuasse montado.
    setDetailModalOpen(false);
    setPrintChecklist(checklist);
    setTimeout(() => window.print(), 350);
  };

  return (
    <Layout>
      {printChecklist && <SimpleChecklistPrintView checklist={printChecklist} company={company} />}

      <div className="space-y-6 no-print">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4" />
              Checklist de Veículo
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Identificação do veículo e registro fotográfico antes da viagem</p>
          </div>
          <Button onClick={openNewSimpleModal} data-testid="new-checklist-button">
            <Plus className="w-4 h-4 mr-2" />
            Novo Checklist
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="h-9"
              />
              <Button variant="outline" onClick={handleSearch} className="h-9">
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Carregando...</div>
            ) : checklists.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500 dark:text-slate-400">Nenhum checklist encontrado</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Nº</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Motorista</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Placa</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cliente / Tipo</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Data</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklists.map((c, idx) => {
                      const isSimple = c.checklist_kind === 'simple';
                      return (
                        <tr key={c.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}`}>
                          <td className="px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">#{c.checklist_number}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">{c.driver_name || '-'}</td>
                          <td className="px-4 py-2.5 text-sm font-mono text-slate-600 dark:text-slate-400">{(isSimple ? c.vehicle_plate : c.cavalo_plate) || '-'}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">
                            {isSimple ? (VEHICLE_TYPE_LABELS[c.vehicle_type] || '-') : (
                              <>
                                {c.client_name || '-'}
                                {c.template === 'petrobras_lvt' && (
                                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-green-100 text-green-800 align-middle">LVT</span>
                                )}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400">
                            {c.created_at ? format(new Date(c.created_at), 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {statusBadge(checklistStatus(c))}
                              {isSimple && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                  <Camera className="w-3 h-3" /> {(c.photos || []).length}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-0.5">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => viewDetails(c)} title="Ver detalhes">
                                <Eye className="w-3.5 h-3.5 text-primary" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => (isSimple ? openEditSimpleModal(c) : openEditModal(c))} title="Editar">
                                <Pencil className="w-3.5 h-3.5 text-blue-600" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => (isSimple ? handleSimplePrint(c) : handlePrint(c.id))} title="Imprimir">
                                <Printer className="w-3.5 h-3.5 text-green-600" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDelete(c.id)} title="Excluir">
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {pagination.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs text-slate-400 dark:text-slate-500">Página {pagination.page} de {pagination.pages}</div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagination.page === 1} onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}>Anterior</Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pagination.page === pagination.pages} onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}>Próximo</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal Criar/Editar - checklist simplificado (modelo atual) */}
      <Dialog open={simpleModalOpen} onOpenChange={(open) => { if (!open) resetSimpleForm(); setSimpleModalOpen(open); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              {simpleEditingId ? 'Editar Checklist' : 'Novo Checklist'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Tipo de Veículo *</Label>
                <Select value={simpleForm.vehicle_type} onValueChange={handleVehicleTypeChange}>
                  <SelectTrigger data-testid="simple-checklist-vehicle-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_TYPE_OPTIONS.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Placa do Veículo *</Label>
                <Autocomplete
                  value={simpleForm.vehicle_plate}
                  onChange={(val) => setSimpleForm(prev => ({ ...prev, vehicle_plate: val.toUpperCase() }))}
                  options={vehicles}
                  displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                  onSelect={(v) => setSimpleForm(prev => ({ ...prev, vehicle_plate: v.plate }))}
                />
              </div>
              <div>
                <Label>Motorista *</Label>
                <Autocomplete
                  value={simpleForm.driver_name}
                  onChange={(val) => setSimpleForm(prev => ({ ...prev, driver_name: val, driver_id: '' }))}
                  options={drivers}
                  displayField="name"
                  onSelect={(d) => setSimpleForm(prev => ({ ...prev, driver_id: d.id, driver_name: d.name }))}
                />
              </div>
              <div>
                <Label>Vistoriador</Label>
                <Autocomplete
                  value={simpleForm.vistoriador_name}
                  onChange={(val) => setSimpleForm(prev => ({ ...prev, vistoriador_name: val, vistoriador_id: '' }))}
                  options={drivers}
                  displayField="name"
                  onSelect={(d) => setSimpleForm(prev => ({ ...prev, vistoriador_id: d.id, vistoriador_name: d.name }))}
                />
              </div>
              <div>
                <Label>Km Atual</Label>
                <Input
                  type="number"
                  value={simpleForm.current_km}
                  onChange={(e) => setSimpleForm(prev => ({ ...prev, current_km: e.target.value }))}
                />
              </div>
              <div>
                <Label>Data e Hora</Label>
                <Input
                  type="datetime-local"
                  value={simpleForm.inspection_datetime}
                  onChange={(e) => setSimpleForm(prev => ({ ...prev, inspection_datetime: e.target.value }))}
                />
              </div>
            </div>

            {simpleSections.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-semibold text-sm">Itens de Verificação</h3>
                {simpleSections.map((section, sIdx) => (
                  <div key={section.label} className="border rounded-lg overflow-hidden">
                    <div className="bg-primary/10 px-4 py-2">
                      <h4 className="text-sm font-semibold text-primary">{section.label}</h4>
                    </div>
                    <div className="divide-y">
                      {section.items.map((item, iIdx) => (
                        <div key={iIdx} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-sm flex-1">{item.text}</span>
                          <SimNaoToggle
                            value={item.answer}
                            onChange={(v) => updateSimpleSectionItem(sIdx, iIdx, { answer: v })}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <Label>Observações</Label>
              <Textarea
                value={simpleForm.observations}
                onChange={(e) => setSimpleForm(prev => ({ ...prev, observations: e.target.value }))}
              />
            </div>

            <div>
              <Label className="mb-1 block">Fotos ({simplePhotos.length}/{MAX_VEHICLE_CHECKLIST_PHOTOS})</Label>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                Registre fotos das laterais, frente, traseira, velocímetro e pneus do veículo.
              </p>
              <div className="flex flex-wrap items-end gap-2 mb-4">
                <div className="w-48">
                  <Label htmlFor="new_checklist_photo_type">Tipo da foto</Label>
                  <Select value={newPhotoType} onValueChange={setNewPhotoType}>
                    <SelectTrigger id="new_checklist_photo_type" data-testid="new-checklist-photo-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHECKLIST_PHOTO_TYPES.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => triggerSimpleFileInput(true)}
                  disabled={simplePhotos.length >= MAX_VEHICLE_CHECKLIST_PHOTOS || uploadingPhoto}
                >
                  <Camera className="w-4 h-4 mr-2" />
                  Câmera
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => triggerSimpleFileInput(false)}
                  disabled={simplePhotos.length >= MAX_VEHICLE_CHECKLIST_PHOTOS || uploadingPhoto}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Galeria
                </Button>
                <input
                  ref={simpleFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { handleAddSimplePhoto(e.target.files?.[0]); e.target.value = ''; }}
                  data-testid="new-checklist-photo-input"
                />
              </div>

              {simplePhotos.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">Nenhuma foto adicionada.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {simplePhotos.map((photo) => (
                    <div key={photo.id} className="border rounded-lg p-2">
                      <div className="relative">
                        <img
                          src={photo.file ? URL.createObjectURL(photo.file) : api.getFileUrl(photo.url)}
                          alt={CHECKLIST_PHOTO_LABELS[photo.type]}
                          className="w-full h-24 object-cover rounded-lg bg-gray-50 dark:bg-slate-800"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="absolute top-1 right-1 h-6 w-6 p-0"
                          onClick={() => handleRemoveSimplePhoto(photo)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <p className="text-[11px] text-center text-slate-500 dark:text-slate-400 mt-1">{CHECKLIST_PHOTO_LABELS[photo.type]}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSimpleModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSimpleSubmit} disabled={savingSimple}>
              {savingSimple ? 'Salvando...' : (simpleEditingId ? 'Salvar Alterações' : 'Criar Checklist')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Criar/Editar legado (LVT/ANTT) - só reaproveitado hoje pra editar
          checklists antigos já existentes (ver openEditModal) */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) resetForm(); setModalOpen(open); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              {editingChecklist ? 'Editar Checklist de Veículo' : 'Novo Checklist de Veículo'}
              {formData.template === 'petrobras_lvt' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-800">
                  Modelo Petrobras (LVT)
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Informações Gerais */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Informações Gerais</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Expedidor</Label>
                  <Input
                    value={formData.expedidor}
                    onChange={(e) => setFormData(prev => ({ ...prev, expedidor: e.target.value }))}
                    disabled={formData.template === 'petrobras_lvt'}
                  />
                </div>
                <div>
                  <Label>UN</Label>
                  <Input value={formData.un} onChange={(e) => setFormData(prev => ({ ...prev, un: e.target.value }))} />
                </div>
                <div>
                  <Label>Cód. Agendamento</Label>
                  <Input value={formData.scheduling_code} onChange={(e) => setFormData(prev => ({ ...prev, scheduling_code: e.target.value }))} />
                </div>
                <div>
                  <Label>Data e Hora da Vistoria</Label>
                  <Input type="datetime-local" value={formData.inspection_datetime} onChange={(e) => setFormData(prev => ({ ...prev, inspection_datetime: e.target.value }))} />
                </div>
                <div>
                  <Label>Endereço da UN</Label>
                  <Input value={formData.un_address} onChange={(e) => setFormData(prev => ({ ...prev, un_address: e.target.value }))} />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input value={formData.phone} onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))} />
                </div>
                <div>
                  <Label>Fax</Label>
                  <Input value={formData.fax} onChange={(e) => setFormData(prev => ({ ...prev, fax: e.target.value }))} />
                </div>
                <div>
                  <Label>Cliente</Label>
                  <Autocomplete
                    value={formData.client_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, client_name: val, client_id: '' }))}
                    options={clients}
                    displayField="name"
                    onSelect={(c) => setFormData(prev => ({ ...prev, client_id: c.id, client_name: c.name }))}
                  />
                </div>
                <div>
                  <Label>Transportadora</Label>
                  <Autocomplete
                    value={formData.transport_company_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, transport_company_name: val, transport_company_id: '' }))}
                    options={companies}
                    displayField="name"
                    onSelect={(c) => setFormData(prev => ({ ...prev, transport_company_id: c.id, transport_company_name: c.name }))}
                  />
                </div>
                <div>
                  <Label>Número ORP / ODP</Label>
                  <Input value={formData.orp_odp_number} onChange={(e) => setFormData(prev => ({ ...prev, orp_odp_number: e.target.value }))} />
                </div>
                <div>
                  <Label>Número da NF (Descarga)</Label>
                  <Input value={formData.nf_number} onChange={(e) => setFormData(prev => ({ ...prev, nf_number: e.target.value }))} />
                </div>
                <div>
                  <Label>Produto(s)</Label>
                  <Input value={formData.products_description} onChange={(e) => setFormData(prev => ({ ...prev, products_description: e.target.value }))} />
                </div>
                <div>
                  <Label>Código SAP</Label>
                  <Input value={formData.sap_code} onChange={(e) => setFormData(prev => ({ ...prev, sap_code: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Motorista e Veículo */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Motorista e Veículo</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Motorista *</Label>
                  <Autocomplete
                    value={formData.driver_name}
                    onChange={(val) => setFormData(prev => ({ ...prev, driver_name: val, driver_id: '' }))}
                    options={drivers}
                    displayField="name"
                    onSelect={(d) => setFormData(prev => ({ ...prev, driver_id: d.id, driver_name: d.name, driver_cpf: d.cpf || '' }))}
                  />
                </div>
                <div>
                  <Label>CPF do Motorista</Label>
                  <Input value={formData.driver_cpf} onChange={(e) => setFormData(prev => ({ ...prev, driver_cpf: e.target.value }))} />
                </div>
                <div>
                  <Label>Nº CNH / Categoria</Label>
                  <div className="flex gap-2">
                    <Input value={formData.cnh_number} onChange={(e) => setFormData(prev => ({ ...prev, cnh_number: e.target.value }))} />
                    <Input value={formData.cnh_category} onChange={(e) => setFormData(prev => ({ ...prev, cnh_category: e.target.value.toUpperCase() }))} className="w-20" />
                  </div>
                </div>
                <div>
                  <Label>Vencimento CNH</Label>
                  <Input type="date" value={formData.cnh_expiry} onChange={(e) => setFormData(prev => ({ ...prev, cnh_expiry: e.target.value }))} />
                </div>
                <div>
                  <Label>Placa do Cavalo *</Label>
                  <Autocomplete
                    value={formData.cavalo_plate}
                    onChange={(val) => setFormData(prev => ({ ...prev, cavalo_plate: val.toUpperCase() }))}
                    options={cavalos}
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    onSelect={(v) => setFormData(prev => ({ ...prev, cavalo_plate: v.plate, cavalo_year: v.year ? String(v.year) : prev.cavalo_year }))}
                  />
                </div>
                <div>
                  <Label>Ano de Fabricação do Cavalo</Label>
                  <Input value={formData.cavalo_year} onChange={(e) => setFormData(prev => ({ ...prev, cavalo_year: e.target.value }))} />
                </div>
                <div>
                  <Label>Placa Carreta 1</Label>
                  <Autocomplete
                    value={formData.carreta1_plate}
                    onChange={(val) => setFormData(prev => ({ ...prev, carreta1_plate: val.toUpperCase() }))}
                    options={carretas}
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    onSelect={(v) => setFormData(prev => ({ ...prev, carreta1_plate: v.plate, carreta1_year: v.year ? String(v.year) : prev.carreta1_year }))}
                  />
                </div>
                <div>
                  <Label>Ano Carreta 1</Label>
                  <Input value={formData.carreta1_year} onChange={(e) => setFormData(prev => ({ ...prev, carreta1_year: e.target.value }))} />
                </div>
                <div>
                  <Label>Capacidade Carreta 1</Label>
                  <Input value={formData.carreta1_capacity} onChange={(e) => setFormData(prev => ({ ...prev, carreta1_capacity: e.target.value }))} />
                </div>
                <div>
                  <Label>Placa Carreta 2</Label>
                  <Autocomplete
                    value={formData.carreta2_plate}
                    onChange={(val) => setFormData(prev => ({ ...prev, carreta2_plate: val.toUpperCase() }))}
                    options={carretas}
                    displayField={(v) => `${v.plate}${v.model ? ' - ' + v.model : ''}`}
                    onSelect={(v) => setFormData(prev => ({ ...prev, carreta2_plate: v.plate, carreta2_year: v.year ? String(v.year) : prev.carreta2_year }))}
                  />
                </div>
                <div>
                  <Label>Ano Carreta 2</Label>
                  <Input value={formData.carreta2_year} onChange={(e) => setFormData(prev => ({ ...prev, carreta2_year: e.target.value }))} />
                </div>
                <div>
                  <Label>Capacidade Carreta 2</Label>
                  <Input value={formData.carreta2_capacity} onChange={(e) => setFormData(prev => ({ ...prev, carreta2_capacity: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Itens do checklist */}
            <div className="space-y-4">
              <h3 className="font-semibold">Itens de Verificação</h3>
              {renderItemsSection('documentos', 'Documentos')}
              {renderItemsSection('vehicle_condition', 'Condições do Veículo')}
              {renderItemsSection('epi', 'EPI')}
              {renderItemsSection('kit', 'Kit')}
              {renderItemsSection('tank', 'Condições do Tanque / Carreta')}
              {renderItemsSection('post_loading', 'Documentos Pós Carregamento')}
            </div>

            {/* Produtos */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Produtos Transportados</h3>
                <Button type="button" variant="outline" size="sm" onClick={addProduct}>
                  <Plus className="w-4 h-4 mr-1" />
                  Adicionar Produto
                </Button>
              </div>
              {formData.products.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum produto adicionado</p>
              ) : (
                <div className="space-y-2">
                  {formData.products.map((p, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <Input className="col-span-5 h-9" value={p.product} onChange={(e) => updateProduct(idx, 'product', e.target.value)} />
                      <Input className="col-span-2 h-9" value={p.un_number} onChange={(e) => updateProduct(idx, 'un_number', e.target.value)} />
                      <Input className="col-span-2 h-9" value={p.risk_number} onChange={(e) => updateProduct(idx, 'risk_number', e.target.value)} />
                      <Input className="col-span-2 h-9" value={p.subclass} onChange={(e) => updateProduct(idx, 'subclass', e.target.value)} />
                      <Button type="button" variant="ghost" size="sm" className="col-span-1 h-9 w-9 p-0" onClick={() => removeProduct(idx)}>
                        <X className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Kit / Últimas viagens */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Kit de Emergência e Histórico</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Validade Calço/Extintor 1</Label>
                  <Input type="date" value={formData.kit_validity_1} onChange={(e) => setFormData(prev => ({ ...prev, kit_validity_1: e.target.value }))} />
                </div>
                <div>
                  <Label>Validade 2</Label>
                  <Input type="date" value={formData.kit_validity_2} onChange={(e) => setFormData(prev => ({ ...prev, kit_validity_2: e.target.value }))} />
                </div>
                <div>
                  <Label>Validade 3</Label>
                  <Input type="date" value={formData.kit_validity_3} onChange={(e) => setFormData(prev => ({ ...prev, kit_validity_3: e.target.value }))} />
                </div>
                <div>
                  <Label>Últ. Viagem - Produto 1</Label>
                  <Input value={formData.last_trip_product_1} onChange={(e) => setFormData(prev => ({ ...prev, last_trip_product_1: e.target.value }))} />
                </div>
                <div>
                  <Label>Produto 2</Label>
                  <Input value={formData.last_trip_product_2} onChange={(e) => setFormData(prev => ({ ...prev, last_trip_product_2: e.target.value }))} />
                </div>
                <div>
                  <Label>Produto 3</Label>
                  <Input value={formData.last_trip_product_3} onChange={(e) => setFormData(prev => ({ ...prev, last_trip_product_3: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Observações */}
            <div>
              <Label>Observações</Label>
              <Textarea value={formData.observations} onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))} />
            </div>

            {/* Responsáveis */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold mb-4">Responsáveis</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Responsável da Transportadora</Label>
                  <Input value={formData.transport_responsible_name} onChange={(e) => setFormData(prev => ({ ...prev, transport_responsible_name: e.target.value }))} />
                </div>
                <div>
                  <Label>RG</Label>
                  <Input value={formData.transport_responsible_rg} onChange={(e) => setFormData(prev => ({ ...prev, transport_responsible_rg: e.target.value }))} />
                </div>
                <div>
                  <Label>Recebedor da LVT</Label>
                  <Input value={formData.lvt_receiver_name} onChange={(e) => setFormData(prev => ({ ...prev, lvt_receiver_name: e.target.value }))} />
                </div>
                <div>
                  <Label>Matrícula</Label>
                  <Input value={formData.lvt_receiver_registration} onChange={(e) => setFormData(prev => ({ ...prev, lvt_receiver_registration: e.target.value }))} />
                </div>
                <div>
                  <Label>Responsável pela Vistoria</Label>
                  <Input value={formData.inspection_responsible_name} onChange={(e) => setFormData(prev => ({ ...prev, inspection_responsible_name: e.target.value }))} />
                </div>
                <div>
                  <Label>Matrícula</Label>
                  <Input value={formData.inspection_responsible_registration} onChange={(e) => setFormData(prev => ({ ...prev, inspection_responsible_registration: e.target.value }))} />
                </div>
                <div>
                  <Label>Registro de Mérito</Label>
                  <Input value={formData.merit_record} onChange={(e) => setFormData(prev => ({ ...prev, merit_record: e.target.value }))} />
                </div>
                <div>
                  <Label>Registro de Ocorrências</Label>
                  <Input value={formData.occurrence_record} onChange={(e) => setFormData(prev => ({ ...prev, occurrence_record: e.target.value }))} />
                </div>
                <div>
                  <Label>Documento do Condutor</Label>
                  <Input value={formData.driver_document} onChange={(e) => setFormData(prev => ({ ...prev, driver_document: e.target.value }))} />
                </div>
                <div>
                  <Label>Data/Hora da Liberação do Veículo</Label>
                  <Input type="datetime-local" value={formData.release_datetime} onChange={(e) => setFormData(prev => ({ ...prev, release_datetime: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvando...' : (editingChecklist ? 'Salvar Alterações' : 'Criar Checklist')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhes */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5" />
              Checklist #{selectedChecklist?.checklist_number}
              {selectedChecklist && statusBadge(checklistStatus(selectedChecklist))}
            </DialogTitle>
          </DialogHeader>

          {selectedChecklist && (
            selectedChecklist.checklist_kind === 'simple' ? (
              <div className="space-y-4">
                {checklistStatus(selectedChecklist) === 'REPROVADO' && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    Há item(ns) reprovado(s) nesse checklist.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-muted/50 p-3 rounded">
                    <p className="text-sm text-muted-foreground">Tipo de Veículo</p>
                    <p className="font-medium">{VEHICLE_TYPE_LABELS[selectedChecklist.vehicle_type] || '-'}</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded">
                    <p className="text-sm text-muted-foreground">Placa</p>
                    <p className="font-medium">{selectedChecklist.vehicle_plate || '-'}</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded">
                    <p className="text-sm text-muted-foreground">Motorista</p>
                    <p className="font-medium">{selectedChecklist.driver_name || '-'}</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded">
                    <p className="text-sm text-muted-foreground">Vistoriador</p>
                    <p className="font-medium">{selectedChecklist.vistoriador_name || '-'}</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded">
                    <p className="text-sm text-muted-foreground">Km Atual</p>
                    <p className="font-medium">{selectedChecklist.current_km != null ? `${selectedChecklist.current_km.toLocaleString('pt-BR')} km` : '-'}</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded">
                    <p className="text-sm text-muted-foreground">Data</p>
                    <p className="font-medium">
                      {selectedChecklist.inspection_datetime ? format(new Date(selectedChecklist.inspection_datetime), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-'}
                    </p>
                  </div>
                </div>

                {(selectedChecklist.checklist_sections || []).length > 0 && (
                  <div className="space-y-3">
                    {selectedChecklist.checklist_sections.map((section, idx) => (
                      <div key={idx} className="border rounded-lg overflow-hidden">
                        <div className="bg-primary/10 px-4 py-2">
                          <h4 className="text-sm font-semibold text-primary">{section.label}</h4>
                        </div>
                        <div className="divide-y">
                          {(section.items || []).map((item, iIdx) => (
                            <div key={iIdx} className="flex items-center gap-3 px-4 py-2 text-sm">
                              <span className="flex-1">{item.text}</span>
                              {item.answer === 'SIM' && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
                              {item.answer === 'NAO' && <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                              {!item.answer && <span className="text-xs text-slate-400">-</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block mb-2">
                    Fotos ({(selectedChecklist.photos || []).length})
                  </span>
                  {(selectedChecklist.photos || []).length === 0 ? (
                    <p className="text-sm text-slate-400 dark:text-slate-500">Nenhuma foto registrada.</p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {selectedChecklist.photos.map((photo) => (
                        <div key={photo.id} className="border rounded-lg p-2">
                          <img
                            src={api.getFileUrl(photo.url)}
                            alt={CHECKLIST_PHOTO_LABELS[photo.type]}
                            className="w-full h-28 object-cover rounded bg-gray-50 dark:bg-slate-800"
                          />
                          <p className="text-[11px] text-center text-slate-500 dark:text-slate-400 mt-1">{CHECKLIST_PHOTO_LABELS[photo.type]}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedChecklist.observations && (
                  <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block mb-1">Observações</span>
                    <span className="text-sm">{selectedChecklist.observations}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {checklistStatus(selectedChecklist) === 'REPROVADO' && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    Há item(ns) reprovado(s) — o carregamento deve ser cancelado.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-muted/50 p-3 rounded">
                    <p className="text-sm text-muted-foreground">Motorista</p>
                    <p className="font-medium">{selectedChecklist.driver_name || '-'}</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded">
                    <p className="text-sm text-muted-foreground">Placa do Cavalo</p>
                    <p className="font-medium">{selectedChecklist.cavalo_plate || '-'}</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded">
                    <p className="text-sm text-muted-foreground">Cliente</p>
                    <p className="font-medium">{selectedChecklist.client_name || '-'}</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded">
                    <p className="text-sm text-muted-foreground">Transportadora</p>
                    <p className="font-medium">{selectedChecklist.transport_company_name || '-'}</p>
                  </div>
                </div>

                {[
                  ['documentos_items', 'Documentos'],
                  ['vehicle_condition_items', 'Condições do Veículo'],
                  ['epi_items', 'EPI'],
                  ['kit_items', 'Kit'],
                  ['tank_items', 'Condições do Tanque / Carreta'],
                  ['post_loading_items', 'Documentos Pós Carregamento'],
                ].map(([field, label]) => (
                  (selectedChecklist[field] || []).length > 0 && (
                    <div key={field} className="border rounded-lg overflow-hidden">
                      <div className="bg-primary/10 px-4 py-2">
                        <h4 className="text-sm font-semibold text-primary">{label}</h4>
                      </div>
                      <div className="divide-y">
                        {selectedChecklist[field].map((item, idx) => (
                          <div key={idx} className="flex items-center gap-3 px-4 py-2 text-sm">
                            <span className="flex-1">{item.text}</span>
                            {item.answer === 'SIM' && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
                            {item.answer === 'NAO' && <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                            {!item.answer && <span className="text-xs text-slate-400">-</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                ))}

                {selectedChecklist.observations && (
                  <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold block mb-1">Observações</span>
                    <span className="text-sm">{selectedChecklist.observations}</span>
                  </div>
                )}
              </div>
            )
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
            <Button onClick={() => { selectedChecklist?.checklist_kind === 'simple' ? handleSimplePrint(selectedChecklist) : handlePrint(selectedChecklist.id); }}>
              <Printer className="w-4 h-4 mr-2" />
              Imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </Layout>
  );
}
