// 가족 일정 — 서비스 워커
//
// 목표: 앱을 켜는 순간부터 항상 최신 버전이 뜨게 한다.
//
// 핵심 원칙 — HTML(index.html)은 "네트워크 우선"으로만 가져온다.
// 캐시 우선으로 만들면 예전 버전이 폰에 박혀서 재설치해야 하는 문제가 생긴다.
// 캐시는 어디까지나 "인터넷이 안 될 때 쓰는 예비용"이다.

const VERSION = '5.5';
const CACHE = `fc-cache-v${VERSION}`;

// index.html의 정식 주소. '/family-calendar-yoo/' 로 들어와도 이 주소 하나로 모아서 저장한다.
const INDEX = new URL('./index.html', self.location.href).href;

// 미리 받아둘 파일들 (아이콘은 잘 안 바뀌므로 캐시해도 안전하다)
const ASSETS = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // cache:'reload' — 설치할 때는 브라우저 캐시를 무시하고 서버에서 새로 받는다
    await Promise.all(ASSETS.map(async u => {
      try {
        const url = new URL(u, self.location.href).href;
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await c.put(url, res);
      } catch (err) { /* 한두 개 실패해도 설치는 진행 */ }
    }));
    await self.skipWaiting();   // 기다리지 않고 바로 새 워커로 교체
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 예전 버전 캐시는 모두 지운다
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 페이지에서 "지금 바로 교체해줘" 라고 보낼 때
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

function isHtml(req, url) {
  return req.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 남의 집 요청은 손대지 않는다 — Firebase, 공휴일 API, 구글 폰트 등
  if (url.origin !== self.location.origin) return;

  // ── HTML: 네트워크 우선 (최신 보장) ──
  if (isHtml(req, url)) {
    e.respondWith((async () => {
      try {
        // navigate 요청은 Request를 그대로 재구성할 수 없어서 주소로 새로 만든다
        const fresh = await fetch(new Request(INDEX, {
          cache: 'no-store',
          credentials: 'same-origin'
        }));
        if (fresh && fresh.ok) {
          const c = await caches.open(CACHE);
          c.put(INDEX, fresh.clone());
          return fresh;
        }
        throw new Error('bad response');
      } catch (err) {
        // 인터넷이 없을 때만 캐시에서 꺼낸다
        const c = await caches.open(CACHE);
        const hit = await c.match(INDEX, { ignoreSearch: true });
        if (hit) return hit;
        return new Response(
          '<meta charset="utf-8"><h3 style="font-family:sans-serif;padding:24px">인터넷에 연결되어 있지 않아요 📵</h3>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // ── 그 외(아이콘·매니페스트): 캐시 우선 + 뒤에서 몰래 갱신 ──
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    if (hit) {
      fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); }).catch(() => {});
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
