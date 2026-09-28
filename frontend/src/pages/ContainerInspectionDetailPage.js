import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Printer, Download, Camera, Upload, X, Edit, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import JsBarcode from 'jsbarcode';
import { CONTAINER_INSPECTION_PHOTO_TYPES, MAX_CONTAINER_INSPECTION_PHOTOS } from './NewContainerInspectionPage';
import { useCompanySettings, getCompanyLogoUrl } from '../lib/useCompanySettings';
import { PrintHeader, PrintSection, PrintFieldGrid, PrintText, PrintPhotoGrid, PrintClosing } from '../components/PrintDocument';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';

const PHOTO_LABELS = CONTAINER_INSPECTION_PHOTO_TYPES.reduce((acc, { value, label }) => {
  acc[value] = label;
  return acc;
}, {});

// Função para gerar código de barras como imagem base64 - só as barras, sem o
// valor embutido (a fonte do JsBarcode fica fina/pequena demais); o valor é
// escrito à parte, em negrito, no mesmo estilo do comprovante de Registro de Gate.
function generateBarcodeImage(value) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, {
    format: 'CODE128',
    width: 2.2,
    height: 55,
    displayValue: false,
    lineColor: '#000000',
    margin: 5
  });
  return canvas.toDataURL('image/png');
}

export default function ContainerInspectionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const company = useCompanySettings();
  const [inspection, setInspection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [newPhotoType, setNewPhotoType] = useState('front');
  const [barcodeImage, setBarcodeImage] = useState(null);
  const printTriggered = useRef(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadInspection();
  }, [id]);

  useEffect(() => {
    if (inspection) {
      const barcodeValue = `RFC${String(inspection.inspection_number).padStart(6, '0')}`;
      const barcodeImg = generateBarcodeImage(barcodeValue);
      setBarcodeImage(barcodeImg);
    }
  }, [inspection]);

  useEffect(() => {
    if (searchParams.get('print') === 'true' && inspection && !printTriggered.current) {
      printTriggered.current = true;
      setTimeout(() => window.print(), 500);
    }
  }, [inspection, searchParams]);

  const loadInspection = async () => {
    try {
      const response = await api.getContainerInspection(id);
      setInspection(response.data);
    } catch (error) {
      toast.error('Erro ao carregar registro');
      navigate('/container-inspections');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (file) => {
    if (!file) return;
    const currentCount = (inspection?.photos || []).length;
    if (currentCount >= MAX_CONTAINER_INSPECTION_PHOTOS) {
      toast.error(`Máximo de ${MAX_CONTAINER_INSPECTION_PHOTOS} fotos por registro`);
      return;
    }

    setUploading(true);

    try {
      await api.uploadContainerInspectionPhoto(id, newPhotoType, file);
      toast.success('Foto enviada com sucesso!');
      loadInspection();
    } catch (error) {
      toast.error('Erro ao enviar foto');
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoDelete = async (photoId) => {
    try {
      await api.deleteContainerInspectionPhoto(id, photoId);
      toast.success('Foto removida com sucesso!');
      loadInspection();
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

  const handleDownloadPhoto = async (photoUrl, label) => {
    try {
      const fullUrl = api.getFileUrl(photoUrl);
      const response = await fetch(fullUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inspection.container_number}_${label.replace(/\s+/g, '_')}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Download iniciado!');
    } catch (error) {
      toast.error('Erro ao baixar foto');
    }
  };

  const getPhotoUrl = (path) => {
    if (!path) return null;
    return api.getFileUrl(path);
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

  if (!inspection) {
    return (
      <Layout>
        <div className="text-center py-8">Registro não encontrado</div>
      </Layout>
    );
  }

  // Componente de impressão - mesmo visual dos PDFs gerados no servidor
  // (cabeçalho, quadros e código de barras de components/PrintDocument.jsx)
  const barcodeValue = `RFC${String(inspection.inspection_number).padStart(6, '0')}`;
  const PrintView = () => (
    <div className="print-only">
      <div className="print-registry print-doc" style={{
        width: '210mm',
        minHeight: '297mm',
        padding: '10mm 12mm',
        fontFamily: 'Helvetica, Arial, sans-serif',
        backgroundColor: '#fff',
        boxSizing: 'border-box'
      }}>
        <PrintHeader
          company={company}
          logoUrl={getCompanyLogoUrl(company)}
          title="Registro Fotográfico de Contêiner"
          subtitle={`Registro Nº ${inspection.inspection_number}`}
        />

        <PrintSection title="Informações do Container">
          <PrintFieldGrid fields={[
            ['Número do Container', inspection.container_number],
            ['Lacre', inspection.container_seal],
            ['Tamanho/Tipo', inspection.size_type],
            ['Booking', inspection.booking],
            ['Terminal de Coleta', inspection.collection_terminal],
            ['Terminal de Origem', inspection.origin_terminal],
            ['Cliente', inspection.client_name],
            ['Armador', inspection.shipping_line_name],
          ]} />
        </PrintSection>

        {inspection.observations && (
          <PrintSection title="Observações">
            <PrintText>{inspection.observations}</PrintText>
          </PrintSection>
        )}

        <PrintSection title="Itens de Vistoria">
          {inspection.no_damage ? (
            <PrintText strong>Container sem avarias</PrintText>
          ) : inspection.damage_items && inspection.damage_items.length > 0 ? (
            <PrintText>{inspection.damage_items.join('  •  ')}</PrintText>
          ) : (
            <PrintText>Nenhum item informado.</PrintText>
          )}
        </PrintSection>

        {inspection.photos && inspection.photos.length > 0 && (
          <PrintSection title={`Fotos do Registro (${inspection.photos.length})`} style={{ breakInside: 'auto', pageBreakInside: 'auto' }}>
            <PrintPhotoGrid
              photos={inspection.photos}
              getLabel={(photo) => PHOTO_LABELS[photo.type] || photo.type}
              getUrl={(photo) => getPhotoUrl(photo.url)}
              columns={3}
            />
          </PrintSection>
        )}

        <PrintClosing
          barcodeImage={barcodeImage}
          code={barcodeValue}
          fields={[
            ['Registrado por', inspection.created_by_name],
            ['Data de criação', format(new Date(inspection.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })],
            ['Data de emissão', format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })],
          ]}
          companyName={company.name}
          note="Este documento é válido como registro fotográfico"
        />
      </div>
    </div>
  );

  const photos = inspection.photos || [];

  return (
    <Layout>
      {/* Área de impressão */}
      <PrintView />

      {/* Conteúdo da tela */}
      <div className="max-w-5xl mx-auto no-print" data-testid="container-inspection-detail-page">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate('/container-inspections')} data-testid="back-btn">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar
            </Button>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Registro Fotográfico #{inspection.inspection_number}
              </h1>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
                Criado em {format(new Date(inspection.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/container-inspections/${id}/edit`)} data-testid="edit-btn">
              <Edit className="w-4 h-4 mr-2" />
              Editar
            </Button>
            <Button variant="outline" onClick={() => window.print()} data-testid="print-btn">
              <Printer className="w-4 h-4 mr-2" />
              Imprimir
            </Button>
          </div>
        </div>

        {/* Informações */}
        <Card className="mb-6 border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Informações do Container</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Número do Container</p>
                <p className="font-semibold">{inspection.container_number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Lacre</p>
                <p className="font-semibold">{inspection.container_seal || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tamanho/Tipo</p>
                <p className="font-semibold">{inspection.size_type || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Terminal de Coleta</p>
                <p className="font-semibold">{inspection.collection_terminal || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Terminal de Origem</p>
                <p className="font-semibold">{inspection.origin_terminal || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Booking</p>
                <p className="font-semibold">{inspection.booking || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cliente</p>
                <p className="font-semibold">{inspection.client_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Armador</p>
                <p className="font-semibold">{inspection.shipping_line_name || '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Observações */}
        {inspection.observations && (
          <Card className="mb-6 border border-slate-200 dark:border-slate-700 shadow-none">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Observações</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <p className="whitespace-pre-wrap">{inspection.observations}</p>
            </CardContent>
          </Card>
        )}

        {/* Itens de Vistoria */}
        <Card className="mb-6 border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Itens de Vistoria</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {inspection.no_damage ? (
              <span className="inline-block px-3 py-1 rounded-full bg-green-100 text-green-800 font-semibold text-sm">
                Container sem avarias
              </span>
            ) : inspection.damage_items && inspection.damage_items.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {inspection.damage_items.map(item => (
                  <span
                    key={item}
                    className="inline-block px-3 py-1 rounded-full bg-red-100 text-red-800 font-semibold text-sm"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Nenhum item informado.</p>
            )}
          </CardContent>
        </Card>

        {/* Fotos do Container */}
        <Card className="mb-6 border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />
              Fotos do Container ({photos.length}/{MAX_CONTAINER_INSPECTION_PHOTOS})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
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
                variant="outline"
                onClick={() => triggerFileInput(true)}
                disabled={uploading || photos.length >= MAX_CONTAINER_INSPECTION_PHOTOS}
              >
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Camera className="w-4 h-4 mr-2" />}
                Câmera
              </Button>
              <Button
                variant="outline"
                onClick={() => triggerFileInput(false)}
                disabled={uploading || photos.length >= MAX_CONTAINER_INSPECTION_PHOTOS}
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
                  handlePhotoUpload(e.target.files?.[0]);
                  e.target.value = '';
                }}
                data-testid="new-photo-input"
              />
            </div>

            {photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma foto adicionada.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {photos.map((photo) => (
                  <div key={photo.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold">{PHOTO_LABELS[photo.type] || photo.type}</h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownloadPhoto(photo.url, PHOTO_LABELS[photo.type] || photo.type)}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Baixar
                      </Button>
                    </div>
                    <div className="relative">
                      <img
                        src={getPhotoUrl(photo.url)}
                        alt={PHOTO_LABELS[photo.type] || photo.type}
                        className="w-full h-48 object-contain rounded-lg bg-gray-50 dark:bg-slate-800"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-2 right-2"
                        onClick={() => handlePhotoDelete(photo.id)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Metadados e Código de Barras */}
        <Card className="border border-slate-200 dark:border-slate-700 shadow-none">
          <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Informações do Registro</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 flex-1">
                <div>
                  <p className="text-sm text-muted-foreground">Criado por</p>
                  <p className="font-semibold">{inspection.created_by_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Data de Criação</p>
                  <p className="font-semibold">
                    {format(new Date(inspection.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
                {inspection.updated_at && (
                  <div>
                    <p className="text-sm text-muted-foreground">Última Atualização</p>
                    <p className="font-semibold">
                      {format(new Date(inspection.updated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                )}
              </div>
              {barcodeImage && (
                <div className="text-center sm:ml-4">
                  <p className="text-sm text-muted-foreground mb-1">Código de Barras</p>
                  <img src={barcodeImage} alt="Código de Barras" className="h-12" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
