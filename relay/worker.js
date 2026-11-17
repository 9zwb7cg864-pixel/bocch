// bocch 中継サーバー（クラウドフレア ワーカー＋Durable Object）
// 部屋・ロビー・観戦一覧の「話題」ごとに1つのオブジェクトが、直近12時間のメッセージを保存して配る。
//   POST /<話題>                       … メッセージを送る（本文はそのまま保存）
//   GET  /<話題>/json?poll=1&since=…   … 保存分を1行1件で返す
//   GET  /<話題>/ws?since=…            … WebSocketで保存分＋以後の新着を受け取る
//   GET/POST /bocch-v1-bots/kv          … 名前付きボットのレート（無期限に保存）
//   POST /bocch-v1-stats/hit             … 遊んだ時間・終局・訪問の集計（端末はランダムIDのみ。個人は特定しない）
//   POST /bocch-v1-tally/note            … 上の別名（広告ブロッカー対策。ゲームはこちらを使う）
//   GET  /bocch-v1-stats/view            … 集計を見る（ヘッダー X-Pass のパスワードが合うときだけ）
//   POST /bocch-v1-kifu/rec              … 終わった対局の棋譜を残す（コーチづくり・改善用。端末のランダムIDだけで、名前・メールは受け取らない。2年で消す）
//   GET  /bocch-v1-kifu/dump?since=…     … 残した棋譜を1行1局で取り出す（X-Pass が合うときだけ）
//   POST /bocch-v1-kifu/feat {nm,on}     … 「記事で紹介されてもいい」のオン・オフ（オフの名前を記録する）
//   GET  /bocch-v1-kifu/feats            … 紹介を断った名前の一覧（X-Pass が合うときだけ）
//   GET  /bocch-v1-news/list             … 運営のお知らせ（新しい順・無期限に保存）
//   POST /bocch-v1-news/post {title,body} … お知らせを出す（X-Pass が合うときだけ。日本語を6言語に訳して保存）
//   POST /bocch-v1-news/del {id}          … お知らせを消す（X-Pass が合うときだけ）
//   POST /bocch-v1-news/psub {...}        … 研究記事を確認に出す（会員。題名・本文・盤の図）
//   GET  /bocch-v1-news/pmine?u=…         … 自分が出した研究記事の状態
//   GET  /bocch-v1-news/pq                … 確認待ちの研究記事（X-Pass が合うときだけ。日本語以外は日本語訳つき）
//   POST /bocch-v1-news/prev {id,act,note} … 公開（7言語に訳す）か差し戻し（X-Pass が合うときだけ。結果は書いた人のメールに届く）
//   GET  /bocch-v1-news/plist             … 公開された研究記事の一覧（新しい順）
//   GET  /bocch-v1-news/pget?id=…         … 公開された研究記事1本
// フレンドの受信箱（bocch-v1-in-…）だけは30日保存する（12時間だと、開かない人に申請が届かない）
// since は all / 90s / 15m / 3h / UNIX秒。
import { DurableObject } from "cloudflare:workers";

const KEEP_SEC = 12 * 3600;     // 保存期間
const KEEP_IN = 30 * 86400;     // フレンドの受信箱の保存期間
const keepOf = t => /^bocch-v1-in-/.test(t || "") ? KEEP_IN : KEEP_SEC;
const KEEP_MAX = 1000;          // 1話題あたりの最大件数
const BODY_MAX = 4096;          // 1件の最大バイト数
const STATS_HASH = "c301ac70fe153803d6486e1b8651e4369b180c2b20904f6c57b70c17169a7055";   // 利用状況ページのパスワードの SHA-256
const KIFU_KEEP = 2 * 365 * 86400;  // 棋譜の保存期間（2年）
const KIFU_MAX = 16384;             // 1局の最大バイト数
// 名前：制御文字と山かっこを除いて30文字まで
const nmClean = x => String(x == null ? "" : x).replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 30);
const ORIGINS = [/^https?:\/\/(www\.)?bocchgame\.com$/, /^https:\/\/9zwb7cg864-pixel\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

function cors(req) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.some(r => r.test(o)) ? o : "https://9zwb7cg864-pixel.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Vary": "Origin",
  };
}
function originOk(req) {
  const o = req.headers.get("Origin");
  return !o || ORIGINS.some(r => r.test(o));   // ブラウザ以外（Originなし）は許可
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
    const url = new URL(req.url);
    let parts = url.pathname.split("/").filter(Boolean);
    // 広告ブロッカーに止められにくい別名：/bocch-v1-tally/note → /bocch-v1-stats/hit（同じ集計に入る）
    if (parts[0] === "bocch-v1-tally" && parts[1] === "note") {
      url.pathname = "/bocch-v1-stats/hit"; req = new Request(url.toString(), req); parts = ["bocch-v1-stats", "hit"];
    }
    // 集計には国（Cloudflare が判定）を付けて渡す
    if (parts[0] === "bocch-v1-stats" && parts[1] === "hit") { const hd = new Headers(req.headers); hd.set("X-CC", String((req.cf && req.cf.country) || "")); req = new Request(req, { headers: hd }); }
    const topic = parts[0] || "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) {
      return new Response("bocch relay ok\n", { headers: { ...cors(req), "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (!originOk(req)) return new Response("forbidden\n", { status: 403 });
    const stub = env.TOPIC.get(env.TOPIC.idFromName(topic));
    return stub.fetch(req);
  },
};

function parseSince(s, now) {
  if (!s || s === "all") return 0;
  const m = /^(\d+)([smhd]?)$/.exec(s);
  if (!m) return 0;
  const n = +m[1];
  if (!m[2]) return n;                       // UNIX秒
  return now - n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
}
// 日本語を訳す（Google 翻訳の公開窓口。失敗したら空を返し、その言語は日本語のまま出す）
// URL は訳す前に ⟦0⟧ のような目印に置きかえ、訳したあとで元に戻す（翻訳で URL が崩れないように）
async function gtx(q, tl, sl = "ja") {
  const urls = [];
  const src = q.replace(/https?:\/\/[^\s<>"'　]+/g, u => "⟦" + (urls.push(u) - 1) + "⟧");
  const out = await gtx0(src, tl, sl);
  if (!out) return "";
  let ok = true;
  const back = out.replace(/⟦\s*(\d+)\s*⟧/g, (m, i) => urls[+i] != null ? urls[+i] : m);
  for (const u of urls) if (!back.includes(u)) ok = false;
  return ok ? back : "";
}
async function gtx0(q, tl, sl = "ja") {
  const r = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=" + sl + "&dt=t&tl=" + tl + "&q=" + encodeURIComponent(q));
  if (!r.ok) return "";
  const j = await r.json();
  return Array.isArray(j && j[0]) ? j[0].map(x => x && x[0] || "").join("") : "";
}
function rid() {
  const a = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(12));
  let s = ""; for (const x of r) s += a[x % a.length]; return s;
}

export class Topic extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS m (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT, time INTEGER, body TEXT)");
    // 接続の見張り用の ping は、オブジェクトを起こさずに自動で pong を返す
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  rows(since) {
    return this.sql.exec("SELECT id, time, body FROM m WHERE time >= ? ORDER BY seq", since).toArray();
  }
  ev(topic, r) {
    return { id: r.id, time: r.time, expires: r.time + keepOf(topic), event: "message", topic, message: r.body };
  }
  prune(now, topic) {
    this.sql.exec("DELETE FROM m WHERE time < ?", now - keepOf(topic));
    this.sql.exec("DELETE FROM m WHERE seq <= (SELECT seq FROM m ORDER BY seq DESC LIMIT 1 OFFSET ?)", KEEP_MAX);
  }

  async fetch(req) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const topic = parts[0], action = parts[1] || "";
    const now = Math.floor(Date.now() / 1000);
    const h = cors(req);

    if (req.method === "POST" && !action) {
      const body = await req.text();
      if (new TextEncoder().encode(body).length > BODY_MAX) return new Response("too large\n", { status: 413, headers: h });
      const r = { id: rid(), time: now, body };
      this.sql.exec("INSERT INTO m (id, time, body) VALUES (?, ?, ?)", r.id, r.time, r.body);
      this.prune(now, topic);
      const out = JSON.stringify(this.ev(topic, r));
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(out); } catch (e) {} }
      return new Response(out + "\n", { headers: { ...h, "Content-Type": "application/json" } });
    }

    if (req.method === "GET" && action === "json") {
      const since = parseSince(url.searchParams.get("since"), now);
      const txt = this.rows(since).map(r => JSON.stringify(this.ev(topic, r))).join("\n");
      return new Response(txt ? txt + "\n" : "", { headers: { ...h, "Content-Type": "application/x-ndjson" } });
    }

    if (req.method === "GET" && action === "ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket\n", { status: 426, headers: h });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ w: url.searchParams.get("role") === "w" });
      if (/^bocch-v1-[a-z0-9]{6}$/.test(topic)) await this.ctx.storage.put("name", topic);
      const since = parseSince(url.searchParams.get("since"), now);
      server.send(JSON.stringify({ event: "open", topic, time: now }));
      for (const r of this.rows(since)) server.send(JSON.stringify(this.ev(topic, r)));
      return new Response(null, { status: 101, webSocket: client });
    }

    // 名前付きボットのレート置き場（話題 bocch-v1-bots だけ）。GET /kv で全部、POST /kv {k,v} で1件保存。保存期間は無期限
    if (topic === "bocch-v1-bots" && action === "kv") {
      if (req.method === "GET") {
        const m = await this.ctx.storage.list({ prefix: "kv:" });
        const o = {}; for (const [k, v] of m) o[k.slice(3)] = v;
        return new Response(JSON.stringify(o), { headers: { ...h, "Content-Type": "application/json" } });
      }
      if (req.method === "POST") {
        let b; try { b = JSON.parse(await req.text()); } catch (e) { return new Response("bad\n", { status: 400, headers: h }); }
        const k = String(b && b.k || "").slice(0, 24), v = Number(b && b.v);
        if (!k || !Number.isFinite(v) || v < 100 || v > 4000) return new Response("bad\n", { status: 400, headers: h });
        await this.ctx.storage.put("kv:" + k, Math.round(v));
        return new Response(JSON.stringify({ k, v: Math.round(v) }), { headers: { ...h, "Content-Type": "application/json" } });
      }
    }

    // 利用状況の集計（話題 bocch-v1-stats だけ）
    if (topic === "bocch-v1-stats" && action === "hit" && req.method === "POST") return this.statHit(req, { ...h, "X-Stat": "co1" });
    if (topic === "bocch-v1-stats" && action === "view" && req.method === "GET") return this.statView(req, h);
    // 棋譜（話題 bocch-v1-kifu だけ）
    if (topic === "bocch-v1-kifu" && action === "rec" && req.method === "POST") return this.kifuRec(req, h, now);
    if (topic === "bocch-v1-kifu" && action === "dump" && req.method === "GET") return this.kifuDump(req, h, url);
    if (topic === "bocch-v1-kifu" && action === "feat" && req.method === "POST") return this.featSet(req, h, now);
    if (topic === "bocch-v1-kifu" && action === "feats" && req.method === "GET") return this.featList(req, h);

    // 運営のお知らせ（話題 bocch-v1-news だけ）
    if (topic === "bocch-v1-news") return this.news(req, h, action, now);

    return new Response("not found\n", { status: 404, headers: h });
  }

  // ---- 運営のお知らせ ----
  async news(req, h, action, now) {
    const st = this.ctx.storage, J = o => new Response(JSON.stringify(o), { headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (action === "list" && req.method === "GET") {
      const m = await st.list({ prefix: "n:", reverse: true, limit: 50 });
      return J([...m.values()]);
    }
    if ((action === "post" || action === "del") && req.method === "POST") {
      if (!(await this.passOk(req))) { await new Promise(r => setTimeout(r, 800)); return new Response("forbidden\n", { status: 401, headers: h }); }
      let b; try { b = JSON.parse(await req.text()); } catch (e) { return new Response("bad\n", { status: 400, headers: h }); }
      if (action === "del") { const id = String(b && b.id || ""); if (!/^n:\d{10}:[A-Za-z0-9]{12}$/.test(id)) return new Response("bad\n", { status: 400, headers: h }); await st.delete(id); return J({ ok: 1 }); }
      const title = String(b && b.title || "").trim().slice(0, 80), body = String(b && b.body || "").trim().slice(0, 2000), to = nmClean(b && b.to), fq = !!(b && b.fq && to);
      if (!title) return new Response("bad\n", { status: 400, headers: h });
      const tr = { ja: { t: title, b: body } };
      const LG = { en: "en", "zh-Hans": "zh-CN", "zh-Hant": "zh-TW", ko: "ko", es: "es", de: "de" };
      await Promise.all(Object.entries(LG).map(async ([k, tl]) => {
        try { const [t, bb] = await Promise.all([gtx(title, tl), body ? gtx(body, tl) : ""]); if (t) tr[k] = { t, b: bb || body }; } catch (e) {}
      }));
      const id = "n:" + now + ":" + rid();
      const it = { id, t: now, tr };
      if (to) it.to = to;  // 宛先：この名前の人のメールにだけ出す
      if (fq) it.fq = 1;   // 「紹介を断る」ボタンを付ける
      await st.put(id, it);
      return J(it);
    }
    if (action[0] === "p") return this.posts(req, h, action, now);
    return new Response("not found\n", { status: 404, headers: h });
  }

  // ---- 研究記事（会員が書いて、運営が確認してから公開） ----
  // p:<id> = { id, u（アカウント）, name, lang, t（作った時刻）, st: "q" 確認待ち | "pub" 公開 | "back" 差し戻し, title, blocks, note, pt（公開した時刻）, tr（言語ごとの題名と本文） }
  // blocks は [{k:"p", x:文章}, {k:"b", pos:36文字の盤, mv:[from,to]（直前の手）, cap:ひとこと}]
  async posts(req, h, action, now) {
    // マーカー（==ここ==）は翻訳の前に «» に置きかえ、訳したあとで戻す
    const tx = async (q, tl, sl) => { const a = String(q).replace(/==([^=\n]+)==/g, "«$1»"); const o = await gtx(a, tl, sl); return o ? o.replace(/«([^»\n]+)»/g, "==$1==") : ""; };
    const st = this.ctx.storage, url = new URL(req.url), J = o => new Response(JSON.stringify(o), { headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    const bad = () => new Response("bad\n", { status: 400, headers: h });
    const LG = { ja: "ja", en: "en", "zh-Hans": "zh-CN", "zh-Hant": "zh-TW", ko: "ko", es: "es", de: "de" };
    const pub = p => ({ id: p.id, name: p.name, lang: p.lang, pt: p.pt, tr: p.tr });
    if (action === "psub" && req.method === "POST") {
      const txt = await req.text(); if (txt.length > 40000) return new Response("too large\n", { status: 413, headers: h });
      let b; try { b = JSON.parse(txt); } catch (e) { return bad(); }
      const u = String(b && b.u || ""), name = nmClean(b && b.name), title = String(b && b.title || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80);
      const lang = Object.keys(LG).includes(b && b.lang) ? b.lang : "ja";
      if (!/^[A-Za-z0-9]{8,40}$/.test(u) || !name || !title || !Array.isArray(b.blocks)) return bad();
      const blocks = [];
      // 部品：p 文章・h 見出し・lead 要点の枠・pt ポイントの枠・ul 箇条書き（1行1項目）・note 注（文字はすべて x）／b 盤の図
      const TXT = { p: 3000, h: 80, lead: 600, pt: 1200, ul: 1500, note: 400 };
      const cells = (a, n) => Array.isArray(a) ? [...new Set(a.filter(v => Number.isInteger(v) && v >= 0 && v < 36))].slice(0, n) : [];
      for (const x of b.blocks.slice(0, 60)) {
        if (x && TXT[x.k]) { const t = String(x.x || "").replace(/\r/g, "").trim().slice(0, TXT[x.k]); if (t) blocks.push({ k: x.k, x: t }); }
        else if (x && x.k === "b" && /^[012]{36}$/.test(String(x.pos || ""))) {
          const mv = Array.isArray(x.mv) && x.mv.length === 2 && x.mv.every(n => Number.isInteger(n) && n >= 0 && n < 36) ? x.mv : null;
          const ar = Array.isArray(x.ar) ? x.ar.filter(a => Array.isArray(a) && a.length === 2 && a.every(n => Number.isInteger(n) && n >= 0 && n < 36) && a[0] !== a[1]).slice(0, 12) : [];
          blocks.push({ k: "b", pos: String(x.pos), mv, ar, dt: cells(x.dt, 20), mk: cells(x.mk, 20), pair: !!x.pair, cap: String(x.cap || "").trim().slice(0, 200) });
        }
      }
      if (!blocks.some(x => x.k !== "b")) return bad();
      // 同じ人の確認待ちは5本まで。書き直し（id 指定）は確認待ちか差し戻しのものだけ
      let id = String(b.id || "");
      if (id) { const o = await st.get("p:" + id); if (!o || o.u !== u || o.st === "pub") return bad(); }
      else {
        const mine = [...(await st.list({ prefix: "p:" })).values()].filter(p => p.u === u && p.st === "q");
        if (mine.length >= 5) return new Response("too many\n", { status: 429, headers: h });
        id = now + "-" + rid();
      }
      const it = { id, u, name, lang, t: now, st: "q", title, blocks };
      await st.put("p:" + id, it);
      return J({ id, st: "q" });
    }
    if (action === "pmine" && req.method === "GET") {
      const u = String(url.searchParams.get("u") || "");
      if (!/^[A-Za-z0-9]{8,40}$/.test(u)) return bad();
      const m = [...(await st.list({ prefix: "p:" })).values()].filter(p => p.u === u);
      return J(m.map(p => ({ id: p.id, title: p.title, st: p.st, note: p.note || "", t: p.t, pt: p.pt || 0, lang: p.lang, blocks: p.st === "pub" ? undefined : p.blocks })).sort((a, b) => b.t - a.t));
    }
    if (action === "plist" && req.method === "GET") {
      const m = [...(await st.list({ prefix: "p:" })).values()].filter(p => p.st === "pub").sort((a, b) => b.pt - a.pt);
      return J(m.map(p => { const o = pub(p); o.tr = Object.fromEntries(Object.entries(p.tr || {}).map(([k, v]) => [k, { t: v.t }])); return o; }));
    }
    if (action === "pget" && req.method === "GET") {
      const p = await st.get("p:" + String(url.searchParams.get("id") || ""));
      if (!p || p.st !== "pub") return new Response("not found\n", { status: 404, headers: h });
      return J({ ...pub(p), blocks: p.blocks.map(x => x.k === "b" ? { k: "b", pos: x.pos, mv: x.mv, ar: x.ar || [], dt: x.dt || [], mk: x.mk || [], pair: !!x.pair } : { k: x.k }) });
    }
    if (action === "pq" || action === "prev") {
      if (!(await this.passOk(req))) { await new Promise(r => setTimeout(r, 800)); return new Response("forbidden\n", { status: 401, headers: h }); }
      if (action === "pq" && req.method === "GET") {
        const q = [...(await st.list({ prefix: "p:" })).values()].filter(p => p.st === "q").sort((a, b) => a.t - b.t);
        // 日本語以外は確認しやすいように日本語訳を付ける（保存はしない）
        await Promise.all(q.map(async p => {
          if (p.lang === "ja") return;
          try {
            const sl = LG[p.lang];
            p.ja = { title: await gtx(p.title, "ja", sl), blocks: await Promise.all(p.blocks.map(async x => x.k !== "b" ? { k: x.k, x: await tx(x.x, "ja", sl) } : { ...x, cap: x.cap ? await tx(x.cap, "ja", sl) : "" })) };
          } catch (e) {}
        }));
        return J(q);
      }
      if (action === "prev" && req.method === "POST") {
        let b; try { b = JSON.parse(await req.text()); } catch (e) { return bad(); }
        const p = await st.get("p:" + String(b && b.id || "")); if (!p || p.st !== "q") return bad();
        const note = String(b.note || "").trim().slice(0, 500), act = b.act === "pub" ? "pub" : b.act === "back" ? "back" : "";
        if (!act) return bad();
        const mailT = { pub: "研究記事を公開しました", back: "研究記事を差し戻しました" }[act];
        if (act === "pub") {
          const sl = LG[p.lang], tr = {};
          await Promise.all(Object.entries(LG).map(async ([k, tl]) => {
            if (k === p.lang) { tr[k] = { t: p.title, b: p.blocks.map(x => x.k !== "b" ? x.x : x.cap || "") }; return; }
            try {
              const t = await gtx(p.title, tl, sl);
              const bb = await Promise.all(p.blocks.map(async x => { const s0 = x.k !== "b" ? x.x : x.cap || ""; return s0 ? (await tx(s0, tl, sl)) || s0 : ""; }));
              tr[k] = { t: t || p.title, b: bb, auto: 1 };
            } catch (e) {}
          }));
          p.tr = tr; p.st = "pub"; p.pt = now; p.note = note;
        } else { p.st = "back"; p.note = note; }
        await st.put("p:" + p.id, p);
        // 書いた人のメールに結果を届ける（宛先つきのお知らせ）
        const body = (act === "pub" ? "「" + p.title + "」が公開されました。アプリの「記事」から読めます。" : "「" + p.title + "」は、今のままでは公開できませんでした。直して、もう一度確認に出してください。") + (note ? "\n\n運営から：" + note : "");
        const mtr = { ja: { t: mailT, b: body } };
        await Promise.all(Object.entries(LG).filter(([k]) => k !== "ja").map(async ([k, tl]) => { try { const [t, bb] = await Promise.all([gtx(mailT, tl), gtx(body, tl)]); if (t) mtr[k] = { t, b: bb || body }; } catch (e) {} }));
        const mid = "n:" + now + ":" + rid();
        await st.put(mid, { id: mid, t: now, tr: mtr, to: p.name });
        return J({ id: p.id, st: p.st });
      }
    }
    return new Response("not found\n", { status: 404, headers: h });
  }

  // ---- 利用状況の集計 ----
  // 合計：sec（遊んだ秒）・games（終局）・visitors（開いた端末）・players（遊んだ端末）・accounts（ログインした登録アカウント）・signups（新規登録）
  // 日ごと（日本時間）：day:YYYY-MM-DD に同じ項目。モード別の終局数は gm:<モード>
  async statHit(req, h) {
    let b; try { b = JSON.parse(await req.text()); } catch (e) { return new Response("bad\n", { status: 400, headers: h }); }
    const d = String(b && b.d || "").slice(0, 32), u = String(b && b.u || "").slice(0, 32);
    if (!/^[a-z0-9]{8,32}$/.test(d)) return new Response("bad\n", { status: 400, headers: h });
    const sec = Math.max(0, Math.min(3600, Math.round(Number(b.s) || 0)));
    const g = b.g ? 1 : 0, o = b.o ? 1 : 0, su = b.su ? 1 : 0;
    const m = String(b.m || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12);
    const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const st = this.ctx.storage;
    const T = (await st.get("tot")) || { sec: 0, games: 0, visitors: 0, players: 0, accounts: 0, signups: 0 };
    const D = (await st.get("day:" + day)) || { sec: 0, games: 0, visitors: 0, players: 0, accounts: 0, signups: 0 };
    T.sec += sec; D.sec += sec; T.games += g; D.games += g; T.signups += su; D.signups += su;
    const put = {};
    if (g && m) put["gm:" + m] = ((await st.get("gm:" + m)) || 0) + 1;
    // 初めての端末・アカウントだけ数える（合計と、その日の分）
    const once = async (key, field) => {
      if (!(await st.get(key))) { put[key] = 1; T[field]++; }
      if (!(await st.get(key + ":" + day))) { put[key + ":" + day] = 1; D[field]++; }
    };
    // 開いた端末：v:<端末> に初めて開いた日（その日に遊んだら末尾に p）を残し、継続率（初日ごと）を数える
    // co:<初日> = { n 新しい端末, p そのうち初日に遊んだ端末, a:{何日後:その日に開いた端末}, b:{何日後:初日に遊んだ端末のうちその日に開いた端末} }
    // この仕組みより前に来た端末（v:<端末> が 1）は継続率に入れない
    if (o || sec || g) {
      const fk = "v:" + d, dk = fk + ":" + day, f0 = await st.get(fk), seen = await st.get(dk), play = !!(sec || g);
      if (!f0) { put[fk] = day + (play ? "p" : ""); T.visitors++; }
      if (!seen) { put[dk] = 1; D.visitors++; }
      const fd = !f0 ? day : (typeof f0 === "string" ? f0.slice(0, 10) : "");
      if (fd) {
        const ck = "co:" + fd, C = (await st.get(ck)) || { n: 0, p: 0, a: {}, b: {} };
        let ch = false;
        if (!f0) { C.n++; if (play) C.p++; ch = true; }
        else if (fd === day) { if (play && f0.length === 10) { C.p++; put[fk] = day + "p"; ch = true; } }
        else if (!seen) {
          const k = Math.round((Date.parse(day) - Date.parse(fd)) / 864e5);
          if (k >= 1 && k <= 90) { C.a[k] = (C.a[k] || 0) + 1; if (f0.length > 10) C.b[k] = (C.b[k] || 0) + 1; ch = true; }
        }
        if (ch) put[ck] = C;
      }
    }
    if (sec || g) await once("p:" + d, "players");
    if (/^[a-f0-9]{16,32}$/.test(u)) await once("a:" + u, "accounts");
    // 初めての人の流れ：nv 初めて開いた・fs 1局目を始めた・fg 1局目を終えた・r1 次の日に来た・r7 7日以内にまた来た（端末ごとに1回だけ）
    // アプリ内ブラウザ：ib アプリ内ブラウザで初めて来た・ix「ブラウザで開く」を押した・ia そのボタンから来た
    // ホームに追加：a2s 案内を見た・a2c 追加ボタンを押した・a2i 追加した・a2l ホームのアイコンから開いた・ar1 ホームから開いた端末が次の日にも来た
    // 入口の計測：n0 開いた（すぐ帰った人も含む）・l1〜l4 表示までの時間・ho ルールを読んだ・hl 4問で覚える・pg Playを押した・q1〜q4 1局も始めずに離れるまでの時間
    for (const f of ["nv", "fs", "fg", "r1", "r7", "n0", "l1", "l2", "l3", "l4", "ho", "hl", "pg", "q1", "q2", "q3", "q4", "ib", "ix", "ixt", "ia", "a2s", "a2c", "a2i", "a2l", "ar1"]) {
      if (b[f] && !(await st.get(f + ":" + d))) { put[f + ":" + d] = 1; T[f] = (T[f] || 0) + 1; D[f] = (D[f] || 0) + 1; }
    }
    // 初めて来た人の内訳（端末ごとに1回）：s_ 来た場所・c_ 国・g_ 言語・d_ 端末（m スマホ・d パソコン）
    {
      const src = String(b.src || "").replace(/[^a-z]/g, "").slice(0, 3), lg = String(b.lg || "").replace(/[^a-z]/g, "").slice(0, 2), dv = b.dv === "m" || b.dv === "d" ? b.dv : "";
      if ((src || lg || dv) && !(await st.get("x:" + d))) {
        put["x:" + d] = 1;
        const cc = String(req.headers.get("X-CC") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || "XX";
        for (const k of [src && "s_" + src, lg && "g_" + lg, dv && "d_" + dv, "c_" + cc]) if (k) { T[k] = (T[k] || 0) + 1; D[k] = (D[k] || 0) + 1; }
      }
    }
    // 登録の流れ：ev メール確認が済んだ・nm 初めて名前を付けた（アカウントごとに1回だけ）
    if (/^[a-f0-9]{16,32}$/.test(u)) for (const f of ["ev", "nm"]) {
      if (b[f] && !(await st.get(f + ":" + u))) { put[f + ":" + u] = 1; T[f] = (T[f] || 0) + 1; D[f] = (D[f] || 0) + 1; }
    }
    put.tot = T; put["day:" + day] = D;
    await st.put(put);
    return new Response("ok\n", { headers: h });
  }
  // ---- 棋譜 ----
  // 1局1行。同じ端末から同じ対局が2回届いても1回だけ残す（k = 端末ID + 対局ID）
  async kifuRec(req, h, now) {
    const txt = await req.text();
    if (new TextEncoder().encode(txt).length > KIFU_MAX) return new Response("too large\n", { status: 413, headers: h });
    let b; try { b = JSON.parse(txt); } catch (e) { return new Response("bad\n", { status: 400, headers: h }); }
    const d = String(b && b.d || ""), gid = String(b && b.k || "");
    if (!/^[a-z0-9]{8,32}$/.test(d) || !/^[A-Za-z0-9_-]{1,48}$/.test(gid)) return new Response("bad\n", { status: 400, headers: h });
    const log = Array.isArray(b.log) ? b.log : null;
    if (!log || log.length < 1 || log.length > 400 || !log.every(m => Array.isArray(m) && m.length === 2 && m.every(x => Number.isInteger(x) && x >= 0 && x < 36)))
      return new Response("bad\n", { status: 400, headers: h });
    const ms = Array.isArray(b.ms) && b.ms.length === log.length ? b.ms.map(x => Math.max(0, Math.min(36e5, Math.round(Number(x) || 0)))) : null;
    const num = (x, lo, hi) => { const v = Number(x); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null; };
    const str = (x, n) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, n);
    const rec = { d, k: gid, at: now, cc: String(req.headers.get("CF-IPCountry") || "").slice(0, 2), v: str(b.v, 12), m: str(b.m, 12), me: num(b.me, 0, 2), win: num(b.win, 0, 2), why: str(b.why, 16),
      ra: num(b.ra, 0, 4000), oa: num(b.oa, 0, 4000), lg: str(b.lg, 8), log, ms };
    // 「記事で紹介されてもいい」がオンの人だけ、名前が付いてくる
    const nm = nmClean(b.nm); if (nm) rec.nm = nm;
    const st = this.ctx.storage;
    this.sql.exec("CREATE TABLE IF NOT EXISTS g (k TEXT PRIMARY KEY, time INTEGER, body TEXT)");
    this.sql.exec("INSERT OR IGNORE INTO g (k, time, body) VALUES (?, ?, ?)", d + ":" + gid, now, JSON.stringify(rec));
    this.sql.exec("DELETE FROM g WHERE time < ?", now - KIFU_KEEP);
    return new Response("ok\n", { headers: h });
  }
  // 記事での紹介：オフにした名前を "fo:名前" に残す（オンに戻したら消す）
  async featSet(req, h, now) {
    let b; try { b = JSON.parse(await req.text()); } catch (e) { return new Response("bad\n", { status: 400, headers: h }); }
    const nm = nmClean(b && b.nm); if (!nm) return new Response("bad\n", { status: 400, headers: h });
    const k = "fo:" + nm;
    if (b.on) await this.ctx.storage.delete(k); else await this.ctx.storage.put(k, { nm, t: now });
    return new Response("ok\n", { headers: h });
  }
  async featList(req, h) {
    if (!(await this.passOk(req))) { await new Promise(r => setTimeout(r, 800)); return new Response("forbidden\n", { status: 401, headers: h }); }
    const m = await this.ctx.storage.list({ prefix: "fo:" });
    return new Response(JSON.stringify([...m.values()]), { headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  async kifuDump(req, h, url) {
    if (!(await this.passOk(req))) { await new Promise(r => setTimeout(r, 800)); return new Response("forbidden\n", { status: 401, headers: h }); }
    this.sql.exec("CREATE TABLE IF NOT EXISTS g (k TEXT PRIMARY KEY, time INTEGER, body TEXT)");
    const since = Number(url.searchParams.get("since")) || 0, lim = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit")) || 5000));
    const rows = this.sql.exec("SELECT time, body FROM g WHERE time >= ? ORDER BY time LIMIT ?", since, lim).toArray();
    const cnt = this.sql.exec("SELECT COUNT(*) AS n FROM g").one().n;
    return new Response(rows.map(r => r.body).join("\n") + (rows.length ? "\n" : ""), { headers: { ...h, "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Total": String(cnt), "Access-Control-Expose-Headers": "X-Total" } });
  }
  async passOk(req) {
    const got = req.headers.get("X-Pass") || "";
    const dg = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(got)))].map(x => x.toString(16).padStart(2, "0")).join("");
    return got.length >= 6 && (dg === STATS_HASH || (!!this.env.STATS_PASS && got === this.env.STATS_PASS));
  }
  async statView(req, h) {
    // パスワードそのものは置かず、SHA-256 の値だけを持つ（秘密 STATS_PASS があればそちらでも可）
    const got = req.headers.get("X-Pass") || "";
    const dg = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(got)))].map(x => x.toString(16).padStart(2, "0")).join("");
    let same = got.length >= 6 && (dg === STATS_HASH || (!!this.env.STATS_PASS && got === this.env.STATS_PASS));
    if (!same) { await new Promise(r => setTimeout(r, 800)); return new Response("forbidden\n", { status: 401, headers: h }); }
    const st = this.ctx.storage;
    const tot = (await st.get("tot")) || {};
    const days = {}; for (const [k, v] of await st.list({ prefix: "day:", reverse: true, limit: 60 })) days[k.slice(4)] = v;
    const modes = {}; for (const [k, v] of await st.list({ prefix: "gm:" })) modes[k.slice(3)] = v;
    const co = {}; for (const [k, v] of await st.list({ prefix: "co:", reverse: true, limit: 120 })) co[k.slice(3)] = v;
    return new Response(JSON.stringify({ tot, days, modes, co, now: Date.now() }), { headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  // 部屋にいる対局者（観戦者は除く）の数
  players(except) {
    return this.ctx.getWebSockets().filter(s => s !== except && !(s.deserializeAttachment() || {}).w).length;
  }
  // 対局者が全員いなくなったら、1分待ってから「いま対局中」板に終わりを出す（すぐ戻ってきた場合は出さない）
  async gone(ws) {
    if (this.players(ws) > 0) return;
    const name = await this.ctx.storage.get("name");
    if (name) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  async alarm() {
    const name = await this.ctx.storage.get("name");
    if (!name || this.players(null) > 0) return;
    const live = this.env.TOPIC.get(this.env.TOPIC.idFromName("bocch-v1-live"));
    await live.fetch(new Request("https://relay/bocch-v1-live", { method: "POST", body: JSON.stringify({ t: "end", room: name.slice(9), why: "gone" }) }));
  }

  // 受け取ったメッセージ（ping 以外）は使わない。送信は POST で行う
  async webSocketMessage(ws, msg) {}
  async webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch (e) {} await this.gone(ws); }
  async webSocketError(ws) { try { ws.close(1011, "error"); } catch (e) {} await this.gone(ws); }
}
