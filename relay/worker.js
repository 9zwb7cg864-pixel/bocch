// bocch 中継サーバー（クラウドフレア ワーカー＋Durable Object）
// 部屋・ロビー・観戦一覧の「話題」ごとに1つのオブジェクトが、直近12時間のメッセージを保存して配る。
//   POST /<話題>                       … メッセージを送る（本文はそのまま保存）
//   GET  /<話題>/json?poll=1&since=…   … 保存分を1行1件で返す
//   GET  /<話題>/ws?since=…            … WebSocketで保存分＋以後の新着を受け取る
// since は all / 90s / 15m / 3h / UNIX秒。
import { DurableObject } from "cloudflare:workers";

const KEEP_SEC = 12 * 3600;     // 保存期間
const KEEP_MAX = 1000;          // 1話題あたりの最大件数
const BODY_MAX = 4096;          // 1件の最大バイト数
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
    const parts = url.pathname.split("/").filter(Boolean);
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
    return { id: r.id, time: r.time, expires: r.time + KEEP_SEC, event: "message", topic, message: r.body };
  }
  prune(now) {
    this.sql.exec("DELETE FROM m WHERE time < ?", now - KEEP_SEC);
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
      this.prune(now);
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

    return new Response("not found\n", { status: 404, headers: h });
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
