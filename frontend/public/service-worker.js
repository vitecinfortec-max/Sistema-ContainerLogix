const CACHE_NAME = 'containerlogix-v1.6.0';
// O build do CRA gera nomes de arquivo com hash (ex: main.3e77797c.js), que
// mudam a cada deploy - não dá pra listar um nome fixo aqui. Só pré-cacheia o
// que realmente existe com nome estável; o resto é cacheado sob demanda pelo
// fetch handler abaixo.
const urlsToCache = [
  '/',
  '/manifest.json'
];

// Install event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .catch((err) => console.warn('Falha ao pré-cachear (não bloqueia a instalação):', err))
  );
  self.skipWaiting();
});

// Fetch event - Network first para APIs e uploads, cache first para assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Deixa passar direto qualquer requisição pra outra origem (ex: dev local,
  // onde o frontend roda em :3000 e o backend em :8000 - cross-origin). O SW
  // só existe pra cachear os assets do próprio frontend em produção (mesma
  // origem, atrás do proxy) - interceptar cross-origin aqui não tem benefício
  // de cache real e quebra qualquer chamada de API que não seja same-origin.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Para requisições de API (incluindo uploads), sempre usar network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Não cachear uploads de imagens
          return response;
        })
        .catch(() => {
          // Se falhar, retornar erro (não usar cache para APIs)
          return new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }
  
  // Para blobs (previews locais), deixar passar direto
  if (url.protocol === 'blob:') {
    return;
  }
  
  // Para o restante (HTML, JS, CSS, manifest) - network-first: busca a versão
  // mais recente sempre que há conexão, e só cai pro cache se estiver offline.
  // Antes era cache-first "pra sempre" - uma vez guardado, o app nunca mais
  // verificava se tinha deploy novo, nem forçando recarregar a página.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
      // Assume o controle das abas já abertas imediatamente, em vez de esperar
      // elas serem fechadas - junto com skipWaiting(), evita o app ficar preso
      // na versão anterior enquanto o usuário não fecha e reabre.
    }).then(() => self.clients.claim())
  );
});

// Push notification event
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'ContainerLogix';
  const options = {
    body: data.body || 'Nova notificação',
    icon: '/logo192.png',
    badge: '/logo192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    },
    actions: [
      { action: 'view', title: 'Ver' },
      { action: 'close', title: 'Fechar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const url = event.notification.data.url || '/';
        
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// Message event for triggering notifications from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, url } = event.data;
    self.registration.showNotification(title, {
      body,
      icon: '/logo192.png',
      badge: '/logo192.png',
      vibrate: [100, 50, 100],
      data: { url: url || '/movements' }
    });
  }
});
