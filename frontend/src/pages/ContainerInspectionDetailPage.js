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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';

const PHOTO_LABELS = CONTAINER_INSPECTION_PHOTO_TYPES.reduce((acc, { value, label }) => {
  acc[value] = label;
  return acc;
}, {});

// Função para gerar código de barras como imagem base64
function generateBarcodeImage(value) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, {
    format: 'CODE128',
    width: 2,
    height: 50,
    displayValue: true,
    fontSize: 14,
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
      const barcodeValue = `VC${String(inspection.inspection_number).padStart(6, '0')}`;
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
      toast.error('Erro ao carregar vistoria');
      navigate('/container-inspections');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (file) => {
    if (!file) return;
    const currentCount = (inspection?.photos || []).length;
    if (currentCount >= MAX_CONTAINER_INSPECTION_PHOTOS) {
      toast.error(`Máximo de ${MAX_CONTAINER_INSPECTION_PHOTOS} fotos por vistoria`);
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
        <div className="text-center py-8">Vistoria não encontrada</div>
      </Layout>
    );
  }

  // Componente de impressão
  const PrintView = () => (
    <div className="print-only">
      <div className="print-registry" style={{
        width: '210mm',
        minHeight: '297mm',
        padding: '8mm',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#fff',
        boxSizing: 'border-box'
      }}>
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          marginBottom: '10px',
          gap: '12px'
        }}>
          <img
            src={getCompanyLogoUrl(company)}
            alt={company.name}
            style={{ height: '40px', width: 'auto' }}
          />
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#000',
              fontFamily: 'Arial Black, sans-serif'
            }}>
              {company.name}
            </div>
          </div>
        </div>

        {/* Título */}
        <div style={{ 
          backgroundColor: '#fff', 
          border: '2px solid #000',
          padding: '6px 10px', 
          borderRadius: '4px', 
          textAlign: 'center', 
          marginBottom: '10px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#000' }}>
            VISTORIA DE CONTÊINER
          </div>
          <div style={{ fontSize: '11px', color: '#000', marginTop: '2px' }}>
            Vistoria Nº {inspection.inspection_number}
          </div>
        </div>

        {/* Informações */}
        <div style={{ 
          border: '1px solid #000', 
          borderRadius: '4px', 
          marginBottom: '8px',
          overflow: 'hidden'
        }}>
          <div style={{ 
            backgroundColor: '#f0f0f0', 
            padding: '4px 8px', 
            borderBottom: '1px solid #000',
            fontWeight: 'bold',
            fontSize: '10px'
          }}>
            Informações do Container
          </div>
          <div style={{ padding: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Número do Container</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.container_number}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Numeração de Container</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.container_seal || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Tamanho/Tipo</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.size_type || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Terminal de Coleta</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.collection_terminal || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Booking</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.booking || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Cliente</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.client_name || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '8px', color: '#666' }}>Armador</div>
              <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{inspection.shipping_line_name || '-'}</div>
            </div>
          </div>
        </div>

        {/* Observações */}
        {inspection.observations && (
          <div style={{ 
            border: '1px solid #000', 
            borderRadius: '4px', 
            marginBottom: '8px',
            overflow: 'hidden'
          }}>
            <div style={{ 
              backgroundColor: '#f0f0f0', 
              padding: '4px 8px', 
              borderBottom: '1px solid #000',
              fontWeight: 'bold',
              fontSize: '10px'
            }}>
              Observações
            </div>
            <div style={{ padding: '8px', fontSize: '10px' }}>
              {inspection.observations}
            </div>
          </div>
        )}

        {/* Itens de Vistoria */}
        <div style={{
          border: '1px solid #000',
          borderRadius: '4px',
          marginBottom: '8px',
          overflow: 'hidden'
        }}>
          <div style={{
            backgroundColor: '#f0f0f0',
            padding: '4px 8px',
            borderBottom: '1px solid #000',
            fontWeight: 'bold',
            fontSize: '10px'
          }}>
            Itens de Vistoria
          </div>
          <div style={{ padding: '8px', fontSize: '10px' }}>
            {inspection.no_damage ? (
              <strong>Container sem avarias</strong>
            ) : inspection.damage_items && inspection.damage_items.length > 0 ? (
              inspection.damage_items.join(' • ')
            ) : (
              'Nenhum item informado.'
            )}
          </div>
        </div>

        {/* Fotos da Vistoria */}
        {inspection.photos && inspection.photos.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: '6px',
            marginBottom: '8px'
          }}>
            {inspection.photos.map(photo => (
              <div key={photo.id} style={{
                border: '1px solid #000',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  backgroundColor: '#f0f0f0',
                  padding: '3px 8px',
                  borderBottom: '1px solid #000',
                  fontWeight: 'bold',
                  fontSize: '9px',
                  textAlign: 'center'
                }}>
                  {PHOTO_LABELS[photo.type] || photo.type}
                </div>
                <div style={{
                  height: '45mm',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#fafafa',
                  padding: '4px'
                }}>
                  <img
                    src={getPhotoUrl(photo.url)}
                    alt={PHOTO_LABELS[photo.type] || photo.type}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain'
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rodapé */}
        <div style={{ 
          borderTop: '1px solid #000',
          paddingTop: '6px',
          fontSize: '9px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', flex: 1 }}>
              <div>
                <strong>Vistoriado por:</strong> {inspection.created_by_name}
              </div>
              <div>
                <strong>Data de criação:</strong> {format(new Date(inspection.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </div>
              <div>
                <strong>Data da vistoria:</strong> {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </div>
            </div>
            {barcodeImage && (
              <div style={{ textAlign: 'right' }}>
                <img src={barcodeImage} alt="Código de Barras" style={{ height: '45px', width: 'auto' }} />
              </div>
            )}
          </div>
          <div style={{ textAlign: 'center', fontSize: '8px', color: '#666', borderTop: '1px solid #ddd', paddingTop: '4px' }}>
            {company.name} | Este documento é válido como vistoria de container
          </div>
        </div>
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
              <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                Vistoria #{inspection.inspection_number}
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
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Informações do Container</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Número do Container</p>
                <p className="font-semibold">{inspection.container_number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Numeração de Container</p>
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
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Observações</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap">{inspection.observations}</p>
            </CardContent>
          </Card>
        )}

        {/* Itens de Vistoria */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Itens de Vistoria</CardTitle>
          </CardHeader>
          <CardContent>
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
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5" />
              Fotos do Container ({photos.length}/{MAX_CONTAINER_INSPECTION_PHOTOS})
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
        <Card>
          <CardHeader>
            <CardTitle>Informações da Vistoria</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-start">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 flex-1">
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
                <div className="text-center ml-4">
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
