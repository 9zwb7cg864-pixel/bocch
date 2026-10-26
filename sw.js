/* bocch：ホーム画面アプリ用。ページは毎回まず新しい版を取りに行き、つながらないときだけ保存した版を使う */
const CACHE='bocch-v2';
const CORE=['./','./index.html','./guide.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return; // 対戦の通信などは触らない
  // ページや翻訳ファイルは、スマホに一時保存された古い版を使わず、毎回サイトに確認する（変わっていなければ通信は小さい）
  const fresh=r.mode==='navigate'||/\.(html|js|json|webmanifest)$/.test(u.pathname)||u.pathname.endsWith('/');
  e.respondWith(fetch(fresh?new Request(r,{cache:'no-cache'}):r).then(res=>{if(res&&res.ok&&!u.search){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp)).catch(()=>{})}return res})
    .catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||(r.mode==='navigate'?caches.match('./index.html'):Response.error()))))});
