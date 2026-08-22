import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import SimpleRegistryList from './SimpleRegistryList';
import { offlineDrivers, offlineTransportCompanies, offlineClients, offlineShippingLines } from '../lib/offlineDb';

export default function OfflineRegistriesPage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Cadastros Básicos</h1>
      <Tabs defaultValue="drivers">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="drivers">Motoristas</TabsTrigger>
          <TabsTrigger value="companies">Transp.</TabsTrigger>
          <TabsTrigger value="clients">Clientes</TabsTrigger>
          <TabsTrigger value="shipping">Armadores</TabsTrigger>
        </TabsList>

        <TabsContent value="drivers">
          <SimpleRegistryList
            api={offlineDrivers}
            emptyLabel="Nenhum motorista cadastrado."
            fields={[
              { key: 'name', label: 'Nome', required: true },
              { key: 'cpf', label: 'CPF', required: true },
              { key: 'phone', label: 'Telefone' },
            ]}
          />
        </TabsContent>

        <TabsContent value="companies">
          <SimpleRegistryList
            api={offlineTransportCompanies}
            emptyLabel="Nenhuma transportadora cadastrada."
            fields={[
              { key: 'name', label: 'Nome', required: true },
              { key: 'cnpj', label: 'CNPJ' },
              { key: 'phone', label: 'Telefone' },
            ]}
          />
        </TabsContent>

        <TabsContent value="clients">
          <SimpleRegistryList
            api={offlineClients}
            emptyLabel="Nenhum cliente cadastrado."
            fields={[
              { key: 'name', label: 'Nome', required: true },
              { key: 'cnpj', label: 'CNPJ' },
              { key: 'phone', label: 'Telefone' },
              { key: 'email', label: 'E-mail' },
              { key: 'address', label: 'Endereço' },
            ]}
          />
        </TabsContent>

        <TabsContent value="shipping">
          <SimpleRegistryList
            api={offlineShippingLines}
            emptyLabel="Nenhum armador cadastrado."
            fields={[
              { key: 'name', label: 'Nome', required: true },
              { key: 'code', label: 'Código' },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
