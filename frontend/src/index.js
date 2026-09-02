import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import "@/index.css";
import App from "@/App";
import OfflineApp from "@/offline/OfflineApp";

const isOfflineMode = process.env.REACT_APP_OFFLINE_MODE === 'true';
const isElectron = navigator.userAgent.toLowerCase().includes('electron');
const isCapacitorNative = Capacitor.isNativePlatform();

// No Android (targetSdk 35), o sistema força layout edge-to-edge e a WebView
// desenha por baixo da status bar por padrão, sobrepondo o cabeçalho do app
// (logo/nome do usuário) com o relógio/ícones do sistema. Isso reserva o
// espaço da status bar fora da WebView.
if (isCapacitorNative) {
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#FFFFFF' }).catch(() => {});
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
}

// No app desktop, sempre exige login de novo a cada abertura (por segurança,
// já que a máquina/sessão do Electron é compartilhada). Redundante com o
// sessionStorage usado pelo AuthContext (que já limpa sozinho ao fechar a
// janela), mas mantido como garantia extra caso a partição de sessão do
// Electron persista entre reinicializações.
if (isElectron) {
  sessionStorage.removeItem('token');
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    {isOfflineMode ? <OfflineApp /> : <App />}
  </React.StrictMode>,
);

// Registrar Service Worker para PWA — só faz sentido no navegador (versão nuvem).
// Dentro do app desktop (Electron), do app Android (Capacitor) ou do modo
// offline o sistema já roda localmente/via WebView nativa, e um Service Worker
// só serve pra prender a UI numa versão antiga em cache entre updates (ou, no
// caso do Capacitor, pra interceptar e quebrar as chamadas de API cross-origin
// pro backend de produção).
if ('serviceWorker' in navigator) {
  if (isElectron || isOfflineMode || isCapacitorNative) {
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
