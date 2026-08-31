import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const BASE_URL = process.env.REACT_APP_BACKEND_URL;

const token = sessionStorage.getItem('token');
if (token) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

export const api = {
  getDashboardStats: () => axios.get(`${API}/dashboard`),
  
  // Drivers
  getDrivers: () => axios.get(`${API}/drivers`),
  createDriver: (data) => axios.post(`${API}/drivers`, data),
  updateDriver: (id, data) => axios.put(`${API}/drivers/${id}`, data),
  deleteDriver: (id) => axios.delete(`${API}/drivers/${id}`),
  
  // Transport Companies
  getTransportCompanies: () => axios.get(`${API}/transport-companies`),
  getCompanies: () => axios.get(`${API}/transport-companies`),
  createTransportCompany: (data) => axios.post(`${API}/transport-companies`, data),
  updateTransportCompany: (id, data) => axios.put(`${API}/transport-companies/${id}`, data),
  deleteTransportCompany: (id) => axios.delete(`${API}/transport-companies/${id}`),
  
  // Shipping Lines
  getShippingLines: () => axios.get(`${API}/shipping-lines`),
  createShippingLine: (data) => axios.post(`${API}/shipping-lines`, data),
  updateShippingLine: (id, data) => axios.put(`${API}/shipping-lines/${id}`, data),
  deleteShippingLine: (id) => axios.delete(`${API}/shipping-lines/${id}`),
  
  // Clients
  getClients: () => axios.get(`${API}/clients`),
  createClient: (data) => axios.post(`${API}/clients`, data),
  updateClient: (id, data) => axios.put(`${API}/clients/${id}`, data),
  deleteClient: (id) => axios.delete(`${API}/clients/${id}`),

  // Suppliers (Fornecedores)
  getSuppliers: () => axios.get(`${API}/suppliers`),
  createSupplier: (data) => axios.post(`${API}/suppliers`, data),
  updateSupplier: (id, data) => axios.put(`${API}/suppliers/${id}`, data),
  deleteSupplier: (id) => axios.delete(`${API}/suppliers/${id}`),

  getWarehouses: () => axios.get(`${API}/warehouses`),
  createWarehouse: (data) => axios.post(`${API}/warehouses`, data),
  updateWarehouse: (id, data) => axios.put(`${API}/warehouses/${id}`, data),
  deleteWarehouse: (id) => axios.delete(`${API}/warehouses/${id}`),

  getProductFamilies: () => axios.get(`${API}/product-families`),
  createProductFamily: (data) => axios.post(`${API}/product-families`, data),
  updateProductFamily: (id, data) => axios.put(`${API}/product-families/${id}`, data),
  deleteProductFamily: (id) => axios.delete(`${API}/product-families/${id}`),

  getServiceFamilies: () => axios.get(`${API}/service-families`),
  createServiceFamily: (data) => axios.post(`${API}/service-families`, data),
  updateServiceFamily: (id, data) => axios.put(`${API}/service-families/${id}`, data),
  deleteServiceFamily: (id) => axios.delete(`${API}/service-families/${id}`),

  getServiceCatalog: () => axios.get(`${API}/service-catalog`),
  getServiceCatalogNextCode: () => axios.get(`${API}/service-catalog/next-code`),
  createServiceCatalogItem: (data) => axios.post(`${API}/service-catalog`, data),
  updateServiceCatalogItem: (id, data) => axios.put(`${API}/service-catalog/${id}`, data),
  deleteServiceCatalogItem: (id) => axios.delete(`${API}/service-catalog/${id}`),

  getProducts: (params) => axios.get(`${API}/products`, { params }),
  getProductNextCode: () => axios.get(`${API}/products/next-code`),
  createProduct: (data) => axios.post(`${API}/products`, data),
  updateProduct: (id, data) => axios.put(`${API}/products/${id}`, data),
  deleteProduct: (id) => axios.delete(`${API}/products/${id}`),

  getStockReportExcel: () => axios.get(`${API}/stock/report/excel`, { responseType: 'blob' }),

  getOSCategories: () => axios.get(`${API}/os-categories`),
  createOSCategory: (data) => axios.post(`${API}/os-categories`, data),
  updateOSCategory: (id, data) => axios.put(`${API}/os-categories/${id}`, data),
  deleteOSCategory: (id) => axios.delete(`${API}/os-categories/${id}`),

  getStates: () => axios.get(`${API}/locations/states`),
  getCitiesByUF: (uf) => axios.get(`${API}/locations/cities`, { params: { uf } }),

  getTerminals: () => axios.get(`${API}/terminals`),
  createTerminal: (data) => axios.post(`${API}/terminals`, data),
  updateTerminal: (id, data) => axios.put(`${API}/terminals/${id}`, data),
  deleteTerminal: (id) => axios.delete(`${API}/terminals/${id}`),

  getEmployees: () => axios.get(`${API}/employees`),
  createEmployee: (data) => axios.post(`${API}/employees`, data),
  updateEmployee: (id, data) => axios.put(`${API}/employees/${id}`, data),
  deleteEmployee: (id) => axios.delete(`${API}/employees/${id}`),

  getInsuranceCompanies: () => axios.get(`${API}/insurance-companies`),
  createInsuranceCompany: (data) => axios.post(`${API}/insurance-companies`, data),
  updateInsuranceCompany: (id, data) => axios.put(`${API}/insurance-companies/${id}`, data),
  deleteInsuranceCompany: (id) => axios.delete(`${API}/insurance-companies/${id}`),

  // Service Types
  getServiceTypes: () => axios.get(`${API}/service-types`),
  createServiceType: (data) => axios.post(`${API}/service-types`, data),
  updateServiceType: (id, data) => axios.put(`${API}/service-types/${id}`, data),
  deleteServiceType: (id) => axios.delete(`${API}/service-types/${id}`),
  
  // Movements
  getMovements: (params) => axios.get(`${API}/movements`, { params }),
  createMovement: (data) => axios.post(`${API}/movements`, data),
  getMovement: (id) => axios.get(`${API}/movements/${id}`),
  updateMovement: (id, data) => axios.put(`${API}/movements/${id}`, data),
  deleteMovement: (id) => axios.delete(`${API}/movements/${id}`),
  getOpenEntryForContainer: (containerNumber) => axios.get(`${API}/movements/open-entry/${containerNumber}`),
  downloadMovementsPdf: (movementIds, via) => axios.post(`${API}/movements/pdf`, { movement_ids: movementIds, via }, { responseType: 'blob' }),
  
  // Reports
  downloadPDFReport: (params) => axios.get(`${API}/reports/pdf`, { params, responseType: 'blob' }),
  downloadExcelReport: (params) => axios.get(`${API}/reports/excel`, { params, responseType: 'blob' }),
  downloadBillingPDFReport: (params) => axios.get(`${API}/reports/billing/pdf`, { params, responseType: 'blob' }),
  downloadBillingExcelReport: (params) => axios.get(`${API}/reports/billing/excel`, { params, responseType: 'blob' }),
  
  // Yard Control (Controle de Pátio)
  getYardControl: (params) => axios.get(`${API}/yard-control`, { params }),
  getAlertsSummary: () => axios.get(`${API}/alerts/summary`),
  globalSearch: (q) => axios.get(`${API}/search`, { params: { q } }),
  downloadYardControlExcel: (params) => axios.get(`${API}/yard-control/excel`, { params, responseType: 'blob' }),
  registerQuickExit: (data) => axios.post(`${API}/yard-control/quick-exit`, data),
  
  // Billing
  generateBillingExcel: (data) => axios.post(`${API}/billing/report`, data, { responseType: 'blob' }),
  
  // Invoices Domésticas (Faturas)
  getInvoices: (params) => axios.get(`${API}/invoices`, { params }),
  getInvoicesCount: (params) => axios.get(`${API}/invoices/count`, { params }),
  getInvoice: (id) => axios.get(`${API}/invoices/${id}`),
  createInvoice: (data) => axios.post(`${API}/invoices`, data),
  updateInvoice: (id, data) => axios.put(`${API}/invoices/${id}`, data),
  deleteInvoice: (id) => axios.delete(`${API}/invoices/${id}`),
  getInvoiceMovements: (id) => axios.get(`${API}/invoices/${id}/movements`),
  getInvoiceHistory: (id) => axios.get(`${API}/invoices/${id}/history`),
  getUnbilledMovements: (params) => axios.get(`${API}/movements/unbilled`, { params }),
  downloadInvoicePdf: (id) => axios.get(`${API}/invoices/${id}/pdf`, { responseType: 'blob' }),
  downloadInvoiceExcel: (id) => axios.get(`${API}/invoices/${id}/excel`, { responseType: 'blob' }),
  
  // International Invoices (Faturas Internacionais)
  getIntlInvoices: (params) => axios.get(`${API}/intl-invoices`, { params }),
  getIntlInvoice: (id) => axios.get(`${API}/intl-invoices/${id}`),
  createIntlInvoice: (data) => axios.post(`${API}/intl-invoices`, data),
  updateIntlInvoice: (id, data) => axios.put(`${API}/intl-invoices/${id}`, data),
  updateIntlInvoiceStatus: (id, status) => axios.put(`${API}/intl-invoices/${id}/status?status=${status}`),
  deleteIntlInvoice: (id) => axios.delete(`${API}/intl-invoices/${id}`),
  getIntlInvoiceReceiverData: () => axios.get(`${API}/intl-invoices/receiver-data`),
  getMovementForInvoice: (transactionId) => axios.get(`${API}/intl-invoices/movement/${transactionId}`),
  downloadIntlInvoicePdf: (id) => axios.get(`${API}/intl-invoices/${id}/pdf`, { responseType: 'blob' }),
  
  // User Shortcuts
  getUserShortcuts: () => axios.get(`${API}/user/shortcuts`),
  updateUserShortcuts: (shortcuts) => axios.put(`${API}/user/shortcuts`, { shortcuts }),
  
  // Company Settings (Dados da Empresa)
  getCompanySettings: () => axios.get(`${API}/company-settings`),
  updateCompanySettings: (data) => axios.put(`${API}/company-settings`, data),

  // Gestão de Usuários (admin)
  getUsers: () => axios.get(`${API}/users`),
  updateUserRole: (userId, role) => axios.put(`${API}/users/${userId}/role`, { role }),
  updateUserStatus: (userId, active) => axios.put(`${API}/users/${userId}/status`, { active }),

  // Módulos Contratados (superadmin)
  getModuleConfig: () => axios.get(`${API}/module-config`),
  getModuleCatalog: () => axios.get(`${API}/module-config/catalog`),
  updateModuleConfig: (disabledModules) => axios.put(`${API}/module-config`, { disabled_modules: disabledModules }),

  // File Upload
  uploadFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteFile: (filename) => axios.delete(`${API}/upload/${filename}`),
  getFileUrl: (path) => `${BASE_URL}${path}`,
  
  // Photo Registries (Registro Fotográfico)
  getPhotoRegistries: (params) => axios.get(`${API}/photo-registries`, { params }),
  getPhotoRegistry: (id) => axios.get(`${API}/photo-registries/${id}`),
  createPhotoRegistry: (data) => axios.post(`${API}/photo-registries`, data),
  updatePhotoRegistry: (id, data) => axios.put(`${API}/photo-registries/${id}`, data),
  deletePhotoRegistry: (id) => axios.delete(`${API}/photo-registries/${id}`),
  uploadPhotoRegistryPhoto: (id, position, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/photo-registries/${id}/upload-photo?position=${position}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deletePhotoRegistryPhoto: (id, position) => axios.delete(`${API}/photo-registries/${id}/photo/${position}`),
  
  // Container Inspections (Vistoria de Container)
  getContainerInspections: (params) => axios.get(`${API}/container-inspections`, { params }),
  getContainerInspection: (id) => axios.get(`${API}/container-inspections/${id}`),
  createContainerInspection: (data) => axios.post(`${API}/container-inspections`, data),
  updateContainerInspection: (id, data) => axios.put(`${API}/container-inspections/${id}`, data),
  deleteContainerInspection: (id) => axios.delete(`${API}/container-inspections/${id}`),
  uploadContainerInspectionPhoto: (id, type, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/container-inspections/${id}/upload-photo?type=${type}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteContainerInspectionPhoto: (id, photoId) => axios.delete(`${API}/container-inspections/${id}/photo/${photoId}`),
  
  // Flex Tank (Controle de Estoque de Bolsas)
  getFlexTankMovements: (params) => axios.get(`${API}/flex-tank/movements`, { params }),
  getFlexTankMovement: (id) => axios.get(`${API}/flex-tank/movements/${id}`),
  createFlexTankMovement: (data) => axios.post(`${API}/flex-tank/movements`, data),
  updateFlexTankMovement: (id, data) => axios.put(`${API}/flex-tank/movements/${id}`, data),
  deleteFlexTankMovement: (id) => axios.delete(`${API}/flex-tank/movements/${id}`),
  getFlexTankStock: (params) => axios.get(`${API}/flex-tank/stock`, { params }),
  downloadFlexTankReport: (params) => axios.get(`${API}/flex-tank/report/excel`, { params, responseType: 'blob' }),
  
  // Fleet - Vehicle Revisions (Frota - Controle de Revisão)
  getVehicleRevisions: (params) => axios.get(`${API}/vehicle-revisions`, { params }),
  getVehicleRevision: (id) => axios.get(`${API}/vehicle-revisions/${id}`),
  createVehicleRevision: (data) => axios.post(`${API}/vehicle-revisions`, data),
  updateVehicleRevision: (id, data) => axios.put(`${API}/vehicle-revisions/${id}`, data),
  deleteVehicleRevision: (id) => axios.delete(`${API}/vehicle-revisions/${id}`),
  getVehicleRevisionPDF: (id) => axios.get(`${API}/vehicle-revisions/${id}/pdf`, { responseType: 'blob' }),

  getVehicleChecklistTemplate: () => axios.get(`${API}/vehicle-checklists/template`),
  getSimpleVehicleChecklistTemplate: (vehicleType) => axios.get(`${API}/vehicle-checklists/simple-template`, { params: { vehicle_type: vehicleType } }),
  getVehicleChecklists: (params) => axios.get(`${API}/vehicle-checklists`, { params }),
  getVehicleChecklist: (id) => axios.get(`${API}/vehicle-checklists/${id}`),
  createVehicleChecklist: (data) => axios.post(`${API}/vehicle-checklists`, data),
  updateVehicleChecklist: (id, data) => axios.put(`${API}/vehicle-checklists/${id}`, data),
  deleteVehicleChecklist: (id) => axios.delete(`${API}/vehicle-checklists/${id}`),
  getVehicleChecklistPDF: (id) => axios.get(`${API}/vehicle-checklists/${id}/pdf`, { responseType: 'blob' }),
  uploadVehicleChecklistPhoto: (id, type, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/vehicle-checklists/${id}/upload-photo?type=${type}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteVehicleChecklistPhoto: (id, photoId) => axios.delete(`${API}/vehicle-checklists/${id}/photo/${photoId}`),
  getVehiclePlates: () => axios.get(`${API}/vehicles/plates`),
  
  // Fleet - Vehicles (Frota - Cadastro de Veículos)
  getVehicles: (params) => axios.get(`${API}/vehicles`, { params }),
  getVehicle: (id) => axios.get(`${API}/vehicles/${id}`),
  createVehicle: (data) => axios.post(`${API}/vehicles`, data),
  updateVehicle: (id, data) => axios.put(`${API}/vehicles/${id}`, data),
  deleteVehicle: (id) => axios.delete(`${API}/vehicles/${id}`),
  getVehicleTypes: () => axios.get(`${API}/vehicles/types/list`),
  
  // Operacional - Programação de Carregamento
  getLoadingSchedules: (params) => axios.get(`${API}/loading-schedules`, { params }),
  getLoadingSchedule: (id) => axios.get(`${API}/loading-schedules/${id}`),
  createLoadingSchedule: (data) => axios.post(`${API}/loading-schedules`, data),
  updateLoadingSchedule: (id, data) => axios.put(`${API}/loading-schedules/${id}`, data),
  deleteLoadingSchedule: (id) => axios.delete(`${API}/loading-schedules/${id}`),
  updateLoadingScheduleStatus: (id, status) => axios.put(`${API}/loading-schedules/${id}/status?status=${status}`),
  getLoadingSchedulePDF: (id) => axios.get(`${API}/loading-schedules/${id}/pdf`, { responseType: 'blob' }),

  // Financeiro - Solicitação de Diária
  getDailyRateRequests: (params) => axios.get(`${API}/daily-rate-requests`, { params }),
  getDailyRateRequest: (id) => axios.get(`${API}/daily-rate-requests/${id}`),
  createDailyRateRequest: (data) => axios.post(`${API}/daily-rate-requests`, data),
  updateDailyRateRequest: (id, data) => axios.put(`${API}/daily-rate-requests/${id}`, data),
  deleteDailyRateRequest: (id) => axios.delete(`${API}/daily-rate-requests/${id}`),
  updateDailyRateRequestStatus: (id, status) => axios.put(`${API}/daily-rate-requests/${id}/update-status?new_status=${status}`),
  getDailyRateRequestPDF: (id) => axios.get(`${API}/daily-rate-requests/${id}/pdf`, { responseType: 'blob' }),

  // Financeiro - Prestação de Contas
  getExpenseReports: (params) => axios.get(`${API}/expense-reports`, { params }),
  getExpenseReport: (id) => axios.get(`${API}/expense-reports/${id}`),
  createExpenseReport: (data) => axios.post(`${API}/expense-reports`, data),
  updateExpenseReport: (id, data) => axios.put(`${API}/expense-reports/${id}`, data),
  deleteExpenseReport: (id) => axios.delete(`${API}/expense-reports/${id}`),
  updateExpenseReportStatus: (id, status) => axios.put(`${API}/expense-reports/${id}/status?status=${status}`),
  uploadExpenseReportReceipt: (reportId, itemId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/expense-reports/${reportId}/purchases/${itemId}/upload-receipt`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteExpenseReportReceipt: (reportId, itemId, receiptId) =>
    axios.delete(`${API}/expense-reports/${reportId}/purchases/${itemId}/receipt/${receiptId}`),
  getExpenseReportPDF: (id) => axios.get(`${API}/expense-reports/${id}/pdf`, { responseType: 'blob' }),

  // Operacional - Status de Entrega
  getDeliveryStatuses: (params) => axios.get(`${API}/delivery-status`, { params }),
  getDeliveryStatus: (id) => axios.get(`${API}/delivery-status/${id}`),
  getScheduleForDeliveryStatus: (scheduleNumber) => axios.get(`${API}/delivery-status/schedule/${scheduleNumber}`),
  createDeliveryStatus: (data) => axios.post(`${API}/delivery-status`, data),
  updateDeliveryStatus: (id, data) => axios.put(`${API}/delivery-status/${id}`, data),
  deleteDeliveryStatus: (id) => axios.delete(`${API}/delivery-status/${id}`),
  updateDeliveryStatusStatus: (id, status) => axios.put(`${API}/delivery-status/${id}/update-status?new_status=${status}`),
  getDeliveryStatusPDF: (id) => axios.get(`${API}/delivery-status/${id}/pdf`, { responseType: 'blob' }),
  getDeliveryStatusExcel: (id) => axios.get(`${API}/delivery-status/${id}/excel`, { responseType: 'blob' }),
  
  // Unit Segregation
  getUnitSegregations: (params) => axios.get(`${API}/unit-segregations`, { params }),
  getUnitSegregation: (id) => axios.get(`${API}/unit-segregations/${id}`),
  createUnitSegregation: (data) => axios.post(`${API}/unit-segregations`, data),
  updateUnitSegregation: (id, data) => axios.put(`${API}/unit-segregations/${id}`, data),
  deleteUnitSegregation: (id) => axios.delete(`${API}/unit-segregations/${id}`),
  releaseUnitSegregation: (id) => axios.post(`${API}/unit-segregations/${id}/release`),
  getUnitSegregationPDF: (id) => axios.get(`${API}/unit-segregations/${id}/pdf`, { responseType: 'blob' }),
  checkContainerSegregation: (containerNumber) => axios.get(`${API}/check-segregation/${containerNumber}`),
  checkContainerSegregationBatch: (containerNumbers) => axios.post(`${API}/check-segregation-batch`, { container_numbers: containerNumbers }),

  // RPA Terceiro / Agregado
  getRPATerceiros: (params) => axios.get(`${API}/rpa-terceiro`, { params }),
  getRPATerceiro: (id) => axios.get(`${API}/rpa-terceiro/${id}`),
  getRPATerceiroNextNumber: (rpaType = 'terceiro') => axios.get(`${API}/rpa-terceiro/next-number`, { params: { rpa_type: rpaType } }),
  getRPADriverInfo: (driverId) => axios.get(`${API}/rpa-terceiro/driver-info/${driverId}`),
  createRPATerceiro: (data) => axios.post(`${API}/rpa-terceiro`, data),
  updateRPATerceiro: (id, data) => axios.put(`${API}/rpa-terceiro/${id}`, data),
  deleteRPATerceiro: (id) => axios.delete(`${API}/rpa-terceiro/${id}`),
  getRPATerceiroPDF: (id) => axios.get(`${API}/rpa-terceiro/${id}/pdf`, { responseType: 'blob' }),

  // Ordem de Serviço (Frota)
  getOrdensServico: (params) => axios.get(`${API}/ordem-servico`, { params }),
  getOrdemServico: (id) => axios.get(`${API}/ordem-servico/${id}`),
  getOrdemServicoNextNumber: () => axios.get(`${API}/ordem-servico/next-number`),
  createOrdemServico: (data) => axios.post(`${API}/ordem-servico`, data),
  updateOrdemServico: (id, data) => axios.put(`${API}/ordem-servico/${id}`, data),
  deleteOrdemServico: (id) => axios.delete(`${API}/ordem-servico/${id}`),
  getOrdemServicoPDF: (id) => axios.get(`${API}/ordem-servico/${id}/pdf`, { responseType: 'blob' }),

  // Controle de Abastecimento (Frota)
  getFuelSupplies: (params) => axios.get(`${API}/fuel-supplies`, { params }),
  getFuelSupply: (id) => axios.get(`${API}/fuel-supplies/${id}`),
  getFuelSupplyNextNumber: () => axios.get(`${API}/fuel-supplies/next-number`),
  createFuelSupply: (data) => axios.post(`${API}/fuel-supplies`, data),
  updateFuelSupply: (id, data) => axios.put(`${API}/fuel-supplies/${id}`, data),
  deleteFuelSupply: (id) => axios.delete(`${API}/fuel-supplies/${id}`),

  // Ordem de Abastecimento (Frota)
  getFuelSupplyOrders: (params) => axios.get(`${API}/fuel-supply-orders`, { params }),
  getFuelSupplyOrder: (id) => axios.get(`${API}/fuel-supply-orders/${id}`),
  getFuelSupplyOrderNextNumber: () => axios.get(`${API}/fuel-supply-orders/next-number`),
  createFuelSupplyOrder: (data) => axios.post(`${API}/fuel-supply-orders`, data),
  updateFuelSupplyOrder: (id, data) => axios.put(`${API}/fuel-supply-orders/${id}`, data),
  deleteFuelSupplyOrder: (id) => axios.delete(`${API}/fuel-supply-orders/${id}`),
  getFuelSupplyOrderPDF: (id) => axios.get(`${API}/fuel-supply-orders/${id}/pdf`, { responseType: 'blob' }),

  // Ordem de Carregamento (Transporte)
  getLoadingOrders: (params) => axios.get(`${API}/loading-orders`, { params }),
  getLoadingOrder: (id) => axios.get(`${API}/loading-orders/${id}`),
  getLoadingOrderNextNumber: () => axios.get(`${API}/loading-orders/next-number`),
  createLoadingOrder: (data) => axios.post(`${API}/loading-orders`, data),
  updateLoadingOrder: (id, data) => axios.put(`${API}/loading-orders/${id}`, data),
  deleteLoadingOrder: (id) => axios.delete(`${API}/loading-orders/${id}`),
  getLoadingOrderPDF: (id) => axios.get(`${API}/loading-orders/${id}/pdf`, { responseType: 'blob' }),
};

export default api;