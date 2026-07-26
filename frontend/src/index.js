import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

const isElectron = navigator.userAgent.toLowerCase().includes('electron');

// No app desktop, sempre exige login de novo a cada abertura (por segurança,
// já que a máquina/sessão do Electron é compartilhada) — não reaproveita o
// token de uma sessão anterior como acontece no navegador.
if (isElectron) {
  localStorage.removeItem('token');
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Registrar Service Worker para PWA — só faz sentido no navegador (versão nuvem).
// Dentro do app desktop (Electron) o sistema já roda localmente, e um Service
// Worker só serve pra prender a UI numa versão antiga em cache entre updates.
if ('serviceWorker' in navigator) {
  if (isElectron) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/service-worker.js')
        .then((registration) => {
          console.log('Service Worker registrado:', registration);
        })
        .catch((error) => {
          console.log('Falha ao registrar Service Worker:', error);
        });
    });
  }
}
