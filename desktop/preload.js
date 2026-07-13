// Preload script para adicionar funcionalidades específicas do desktop
window.addEventListener('DOMContentLoaded', () => {
  // Adicionar indicador de que está rodando no desktop
  document.body.classList.add('electron-app');
  
  // Adicionar informações de versão
  const version = process.versions;
  console.log('ContainerLogix Desktop App');
  console.log('Electron:', version.electron);
  console.log('Chrome:', version.chrome);
  console.log('Node:', version.node);
});
