// Service Worker — 任务面板离线缓存
const CACHE = 'task-panel-v2';

// 安装时预缓存核心文件
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      return cache.addAll([
        './',
        './index.html',
        './manifest.json',
        './icon.svg'
      ]);
    })
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// 请求拦截：缓存优先 + 网络回退
self.addEventListener('fetch', event => {
  // 跳过 API 请求，只缓存静态资源
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      // 缓存命中直接返回
      if (cached) return cached;

      // 否则走网络，成功后写入缓存
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // 网络失败，对于 HTML 请求返回缓存首页（离线兜底）
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('./');
        }
        return new Response('离线状态，请连接网络后重试', { status: 503 });
      });
    })
  );
});
