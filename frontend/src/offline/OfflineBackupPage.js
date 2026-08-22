import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { DatabaseBackup, Upload, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { exportBackup, listAvailableBackups, importBackup } from '../lib/offlineBackup';

export default function OfflineBackupPage() {
  const [backups, setBackups] = useState([]);
  const [selectedBackup, setSelectedBackup] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadBackups = async () => {
    const list = await listAvailableBackups();
    setBackups(list);
    if (list.length > 0) setSelectedBackup(list[0]);
  };

  useEffect(() => { loadBackups(); }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { fileName } = await exportBackup();
      toast.success(`Backup salvo: ${fileName}`);
      loadBackups();
    } catch (e) {
      toast.error('Erro ao gerar backup: ' + (e.message || e));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!selectedBackup) return;
    const confirmed = window.confirm(
      'Isso vai substituir TODOS os dados atuais deste aparelho pelos dados do backup selecionado. Continuar?'
    );
    if (!confirmed) return;

    setImporting(true);
    try {
      const { manifest, photosRestored } = await importBackup(selectedBackup);
      const totalDocs = Object.values(manifest.collections || {}).reduce((a, b) => a + b, 0);
      toast.success(`Backup importado! ${totalDocs} registros e ${photosRestored} fotos restaurados.`);
    } catch (e) {
      toast.error('Erro ao importar backup: ' + (e.message || e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Backup</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseBackup className="w-5 h-5" />
            Gerar Backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Cria um arquivo com todos os dados deste aparelho, salvo na pasta
            <strong> Documentos/ContainerLogix-Backups</strong>. Copie esse arquivo para o
            computador (ou para o Google Drive) para levar os dados para o sistema Windows.
          </p>
          <Button onClick={handleExport} disabled={exporting} className="w-full">
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <DatabaseBackup className="w-4 h-4 mr-2" />}
            Gerar Backup Agora
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="w-5 h-5" />
            Importar Backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Copie o arquivo de backup (gerado neste app ou no sistema Windows) para a pasta
            <strong> Documentos/ContainerLogix-Backups</strong> deste aparelho e selecione-o abaixo.
          </p>

          {backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum arquivo de backup encontrado nessa pasta.</p>
          ) : (
            <div>
              <Label>Arquivo de backup</Label>
              <Select value={selectedBackup} onValueChange={setSelectedBackup}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {backups.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button variant="outline" onClick={loadBackups} className="w-full" size="sm">
            Atualizar lista
          </Button>

          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Importar substitui todos os dados atuais deste aparelho. Essa ação não pode ser desfeita.</span>
          </div>

          <Button
            onClick={handleImport}
            disabled={importing || !selectedBackup}
            variant="destructive"
            className="w-full"
          >
            {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Importar Backup Selecionado
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
