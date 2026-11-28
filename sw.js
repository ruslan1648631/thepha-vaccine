/**
 * VCC — Progressive Web App Service Worker
 * ระบบติดตามและเฝ้าระวังวัคซีน อำเภอเทพา
 * Cache Version: vcc-pwa-v1.1 (รองรับ Web Push Notification)
 */

const CACHE_NAME = 'vcc-cache-v1.1';
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon.svg',
    // External CDN Libraries (Core UI & Data)
    'https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11',
    'https://code.jquery.com/jquery-3.7.0.min.js',
    'https://cdn.datatables.net/1.13.6/js/jquery.dataTables.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// 1. Install Event: Cache Core Assets
self.addEventListener('install', event => {
    console.log('[SW] Installing VCC Service Worker v1.1...');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.allSettled(
                STATIC_ASSETS.map(url =>
                    fetch(url, { mode: 'cors' })
                        .then(res => {
                            if (res.ok) return cache.put(url, res);
                        })
                        .catch(err => console.warn('[SW] Could not pre-cache:', url, err))
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// 2. Activate Event: Clean Old Caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating VCC Service Worker v1.1...');
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => {
                    console.log('[SW] Deleting old cache:', k);
                    return caches.delete(k);
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. Fetch Event: Smart Routing
self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);

    if (req.method !== 'GET') {
        return;
    }

    // A. API Calls (Supabase / Google Apps Script) — Network-First
    if (url.hostname.includes('supabase.co') || url.hostname.includes('script.google.com') || url.pathname.includes('/rest/v1/')) {
        event.respondWith(
            fetch(req)
                .then(networkRes => networkRes)
                .catch(async () => {
                    return new Response(
                        JSON.stringify({
                            success: false,
                            error: 'OFFLINE_MODE',
                            message: 'อุปกรณ์กำลังทำงานในโหมดออฟไลน์ กรุณาเชื่อมต่ออินเทอร์เน็ต'
                        }),
                        { headers: { 'Content-Type': 'application/json' } }
                    );
                })
        );
        return;
    }

    // B. CDN Assets — Cache-First with Background Revalidation
    if (
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com') ||
        url.hostname.includes('cdnjs.cloudflare.com') ||
        url.hostname.includes('cdn.jsdelivr.net') ||
        url.hostname.includes('code.jquery.com') ||
        url.hostname.includes('cdn.datatables.net') ||
        url.hostname.includes('unpkg.com')
    ) {
        event.respondWith(
            caches.match(req).then(cachedRes => {
                if (cachedRes) {
                    fetch(req).then(networkRes => {
                        if (networkRes && networkRes.status === 200) {
                            caches.open(CACHE_NAME).then(cache => cache.put(req, networkRes));
                        }
                    }).catch(() => {});
                    return cachedRes;
                }
                return fetch(req).then(networkRes => {
                    if (networkRes && networkRes.status === 200) {
                        const copy = networkRes.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                    }
                    return networkRes;
                }).catch(() => caches.match('./index.html'));
            })
        );
        return;
    }

    // C. Same-Origin Assets — Network-First with Cache Fallback
    event.respondWith(
        fetch(req)
            .then(networkRes => {
                if (networkRes && networkRes.status === 200) {
                    const copy = networkRes.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                }
                return networkRes;
            })
            .catch(async () => {
                const cachedRes = await caches.match(req);
                if (cachedRes) return cachedRes;
                if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
                    return caches.match('./index.html');
                }
            })
    );
});

// 4. Web Push Event: รับการแจ้งเตือนจาก Server แม้ปิดแอปอยู่
self.addEventListener('push', event => {
    let payload = {
        title: 'VCC เทพา — แจ้งเตือนระบบวัคซีน',
        body: 'มีรายการนัดหมายหรือการติดตามวัคซีนที่ต้องดำเนินการ',
        url: './index.html',
        tag: 'vcc-push-general'
    };

    if (event.data) {
        try {
            const parsed = event.data.json();
            payload = Object.assign(payload, parsed);
        } catch (e) {
            payload.body = event.data.text() || payload.body;
        }
    }

    const options = {
        body: payload.body,
        icon: payload.icon || './icons/icon-192.png',
        badge: payload.badge || './icons/icon-192.png',
        tag: payload.tag || 'vcc-push',
        renotify: true,
        requireInteraction: !!payload.requireInteraction,
        vibrate: [200, 100, 200],
        data: {
            url: payload.url || './index.html'
        }
    };

    event.waitUntil(
        self.registration.showNotification(payload.title, options)
    );
});

// 5. Notification Click Event: กดแจ้งเตือนแล้วเปิดหน้าเป้าหมายทันที
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : './index.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url && 'focus' in client) {
                    if (targetUrl.includes('#') && 'navigate' in client) {
                        client.navigate(targetUrl).catch(() => {});
                    }
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
