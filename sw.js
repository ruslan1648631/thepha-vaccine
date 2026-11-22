/**
 * VCC — Progressive Web App Service Worker
 * ระบบติดตามและเฝ้าระวังวัคซีน อำเภอเทพา
 * Cache Version: vcc-pwa-v1.0
 */

const CACHE_NAME = 'vcc-cache-v1.0';
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
    console.log('[SW] Installing VCC Service Worker...');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Pre-caching static assets & libraries...');
            // ใช้ cache.addAll พร้อม error catch เพื่อไม่ให้ asset ตัวใดตัวหนึ่งบล็อกการติดตั้ง
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
    console.log('[SW] Activating VCC Service Worker...');
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

    // ไม่แคชคำขอที่ไม่ใช่ GET (เช่น POST, DELETE, PUT)
    if (req.method !== 'GET') {
        return;
    }

    // A. API Calls (Supabase / Google Apps Script) — Network-First
    if (url.hostname.includes('supabase.co') || url.hostname.includes('script.google.com') || url.pathname.includes('/rest/v1/')) {
        event.respondWith(
            fetch(req)
                .then(networkRes => {
                    // ถ้าสำเร็จ ส่งข้อมูลสดใหม่คืนไป
                    return networkRes;
                })
                .catch(async () => {
                    // ถ้าเครือข่ายล่ม / ออฟไลน์
                    console.warn('[SW] Network error for API:', req.url);
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

    // B. CDN Assets (Fonts, Stylesheets, Icons, JS Libraries) — Cache-First with Background Revalidation
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
                    // คืนค่าจากแคชทันที แล้วดึงอัปเดตเบื้องหลัง (Stale-While-Revalidate)
                    fetch(req).then(networkRes => {
                        if (networkRes && networkRes.status === 200) {
                            caches.open(CACHE_NAME).then(cache => cache.put(req, networkRes));
                        }
                    }).catch(() => {});
                    return cachedRes;
                }
                // ถ้ายังไม่มีในแคช ดึงจากเครือข่ายแล้วบันทึกลงแคช
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

    // C. Same-Origin Assets (HTML, Icons, Manifest) — Network-First with Cache Fallback
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
                // ถ้าออฟไลน์ ให้ดึงจากแคช
                const cachedRes = await caches.match(req);
                if (cachedRes) return cachedRes;
                // ถ้าเป็นหน้า HTML ให้คืนค่า index.html จากแคช
                if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
                    return caches.match('./index.html');
                }
            })
    );
});

// 4. Message Event for instant updates
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
