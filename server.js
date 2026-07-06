// 電機技師 2027 備考作戰中心 — 後端 (Render)
// 持有 Notion 金鑰，安全代呼叫 Notion API；前台只跟這支服務溝通。
import express from "express";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), { maxAge: "7d", index: ["index.html"], setHeaders(res, p) { if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); } }));

// ---- API 金鑰驗證：設定 APP_KEY 環境變數後，所有 /api 請求須帶 X-App-Key（health 除外）----
const APP_KEY = process.env.APP_KEY || "";
app.use("/api", (req, res, next) => {
  if (!APP_KEY) return next();                    // 未設定則不啟用（相容舊部署）
  if (req.path === "/health") return next();      // 健康檢查免驗
  const key = req.get("X-App-Key") || req.query.key;
  if (key === APP_KEY) return next();
  res.status(401).json({ error: "unauthorized" });
});

// ---- 環境變數（在 Render 後台設定，不要寫進程式碼）----
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_CHAPTERS  = process.env.NOTION_DB_CHAPTERS || "d2dd115dbf384750b138e20c39d2e2fe"; // 六科章節進度
const DB_WRONG     = process.env.NOTION_DB_WRONG    || "138e5f939f79405d9b072fc61900e920"; // 錯題本
// 影片 / 公式資料庫：可不設，程式會依資料庫名稱自動尋找
const DB_VIDEOS_ENV   = process.env.NOTION_DB_VIDEOS   || "";
const DB_FORMULAS_ENV = process.env.NOTION_DB_FORMULAS || "";
const NOTION_VER   = "2022-06-28";
const API = "https://api.notion.com/v1";

function notionHeaders() {
  return {
    "Authorization": `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VER,
    "Content-Type": "application/json",
  };
}

async function notion(pathname, method = "GET", body) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: notionHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000), // Notion 卡住 10 秒即中止，避免請求懸掛
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.message ? data.message : `Notion API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// 把 Notion page 攝平成前台好用的物件
const txt = (rt) => (rt && rt.length ? rt.map((t) => t.plain_text).join("") : "");
const sel = (p) => (p && p.select ? p.select.name : null);
const dat = (p) => (p && p.date ? p.date.start : null);
const chk = (p) => !!(p && p.checkbox);
const num = (p) => (p && typeof p.number === "number" ? p.number : 0);
const urlv = (p) => (p && p.url ? p.url : "");
const multi = (p) => (p && p.multi_select ? p.multi_select.map((o) => o.name) : []);

function mapChapter(page) {
  const p = page.properties;
  return {
    id: page.id,
    章節: txt(p["章節"]?.title),
    科目: sel(p["科目"]),
    波次: sel(p["波次"]),
    階段: sel(p["階段"]),
    狀態: sel(p["狀態"]) || "待讀",
    目標完成日: dat(p["目標完成日"]),
    已錄影: chk(p["已錄影"]),
  };
}

function mapWrong(page) {
  const p = page.properties;
  return {
    id: page.id,
    題目摘要: txt(p["題目摘要"]?.title),
    科目: sel(p["科目"]),
    章節: txt(p["章節"]?.rich_text),
    題型: multi(p["題型"]),
    卡點原因: sel(p["卡點原因"]),
    難度: sel(p["難度"]),
    盲點: txt(p["盲點"]?.rich_text),
    正解重點: txt(p["正解重點"]?.rich_text),
    複習次數: num(p["複習次數"]),
    下次複習日: dat(p["下次複習日"]),
    已攻克: chk(p["已攻克"]),
    來源: txt(p["來源"]?.rich_text),
  };
}

function mapVideo(page) {
  const p = page.properties;
  return {
    id: page.id,
    title: txt(p["標題"]?.title),
    subj: sel(p["科目"]),
    chapter: txt(p["章節"]?.rich_text),
    teacher: txt(p["講師"]?.rich_text),
    tag: sel(p["標籤"]),
    min: num(p["時長分"]),
    url: urlv(p["影片連結"]),
    prog: num(p["進度"]),
  };
}

function mapFormula(page) {
  const p = page.properties;
  const tagStr = txt(p["標籤"]?.rich_text);
  return {
    id: page.id,
    name: txt(p["公式名稱"]?.title),
    subj: sel(p["科目"]),
    latex: txt(p["LaTeX"]?.rich_text),
    desc: txt(p["說明"]?.rich_text),
    tags: tagStr ? tagStr.split("·").map((s) => s.trim()).filter(Boolean) : [],
    blind: chk(p["常忘"]),
  };
}

async function queryAll(dbId, mapper) {
  let results = [];
  let cursor;
  do {
    const data = await notion(`/databases/${dbId}/query`, "POST", {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    results = results.concat(data.results.map(mapper));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

// 依資料庫名稱自動解析 database id（免手動填 ID）
const _dbCache = {};
async function resolveDb(title) {
  if (_dbCache[title]) return _dbCache[title];
  const data = await notion(`/search`, "POST", {
    query: title,
    filter: { value: "database", property: "object" },
    page_size: 50,
  });
  const list = data.results || [];
  const hit =
    list.find((d) => txt(d.title) === title) ||
    list.find((d) => txt(d.title).indexOf(title) === 0);
  // 刻意不 fallback 到 list[0]：名稱對不上就明確報錯，避免鎖定到錯的資料庫
  if (!hit) throw new Error(`找不到資料庫：${title}（請確認整合已加入該資料庫）`);
  _dbCache[title] = hit.id;
  return hit.id;
}
async function videosDb() { return DB_VIDEOS_ENV || (await resolveDb("課程影片")); }
async function formulasDb() { return DB_FORMULAS_ENV || (await resolveDb("公式庫")); }

// ---- 讀取快取：45 秒 TTL，寫入時主動失效，減少 Notion 呼叫並加速冷啟動後載入 ----
const _cache = new Map();
const CACHE_MS = 45000;
async function cached(key, fn) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.v;
  const v = await fn();
  _cache.set(key, { v, t: Date.now() });
  return v;
}
const bust = (key) => _cache.delete(key);

// ---------------- API ----------------

app.get("/api/health", (req, res) => {
  res.json({ ok: true, tokenSet: !!NOTION_TOKEN });
});

// 讀全部章節
app.get("/api/chapters", async (req, res) => {
  try {
    const rows = await cached("chapters", () => queryAll(DB_CHAPTERS, mapChapter));
    res.json(rows);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 更新某章的 狀態 / 已錄影
app.patch("/api/chapters/:id", async (req, res) => {
  try {
    const props = {};
    if (typeof req.body.狀態 === "string") props["狀態"] = { select: { name: req.body.狀態 } };
    if (typeof req.body.已錄影 === "boolean") props["已錄影"] = { checkbox: req.body.已錄影 };
    const data = await notion(`/pages/${req.params.id}`, "PATCH", { properties: props });
    bust("chapters");
    res.json(mapChapter(data));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 讀全部錯題
app.get("/api/wrong", async (req, res) => {
  try {
    const rows = await cached("wrong", () => queryAll(DB_WRONG, mapWrong));
    res.json(rows);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 新增錯題
app.post("/api/wrong", async (req, res) => {
  try {
    const b = req.body || {};
    const rt = (s) => ({ rich_text: [{ text: { content: String(s) } }] });
    const props = {
      "題目摘要": { title: [{ text: { content: b.題目摘要 || "未命名" } }] },
    };
    if (b.科目) props["科目"] = { select: { name: b.科目 } };
    if (Array.isArray(b.題型) && b.題型.length) props["題型"] = { multi_select: b.題型.map((n) => ({ name: n })) };
    if (b.卡點原因) props["卡點原因"] = { select: { name: b.卡點原因 } };
    if (b.難度) props["難度"] = { select: { name: b.難度 } };
    if (b.來源) props["來源"] = rt(b.來源);
    if (b.章節) props["章節"] = rt(b.章節);
    if (b.盲點) props["盲點"] = rt(b.盲點);
    if (b.正解重點) props["正解重點"] = rt(b.正解重點);
    props["複習次數"] = { number: 0 };
    const today = new Date();
    today.setDate(today.getDate() + 1);
    props["下次複習日"] = { date: { start: today.toISOString().slice(0, 10) } };
    props["已攻克"] = { checkbox: false };
    const data = await notion(`/pages`, "POST", { parent: { database_id: DB_WRONG }, properties: props });
    bust("wrong");
    res.json(mapWrong(data));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 標記錯題複習結果
app.patch("/api/wrong/:id/review", async (req, res) => {
  try {
    const ok = req.body && req.body.ok === false ? false : true;
    const cur = await notion(`/pages/${req.params.id}`);
    const gaps = [1, 3, 7, 14, 30];
    let count;
    if (ok) { count = num(cur.properties["複習次數"]) + 1; } else { count = 0; }
    const gap = ok ? gaps[Math.min(count - 1, gaps.length - 1)] : gaps[0];
    const next = new Date();
    next.setDate(next.getDate() + gap);
    const props = {
      "複習次數": { number: count },
      "下次複習日": { date: { start: next.toISOString().slice(0, 10) } },
      "已攻克": { checkbox: ok && count >= 3 },
    };
    const data = await notion(`/pages/${req.params.id}`, "PATCH", { properties: props });
    bust("wrong");
    res.json(mapWrong(data));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 讀全部影片
app.get("/api/videos", async (req, res) => {
  try {
    const rows = await cached("videos", async () => queryAll(await videosDb(), mapVideo));
    res.json(rows);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 更新影片進度 / 連結
app.patch("/api/videos/:id", async (req, res) => {
  try {
    const props = {};
    if (typeof req.body.進度 === "number") props["進度"] = { number: req.body.進度 };
    if (typeof req.body.時長分 === "number") props["時長分"] = { number: req.body.時長分 };
    if (typeof req.body.影片連結 === "string") props["影片連結"] = { url: req.body.影片連結 || null };
    const data = await notion(`/pages/${req.params.id}`, "PATCH", { properties: props });
    bust("videos");
    res.json(mapVideo(data));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 讀全部公式
app.get("/api/formulas", async (req, res) => {
  try {
    const rows = await cached("formulas", async () => queryAll(await formulasDb(), mapFormula));
    res.json(rows);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 更新公式 常忘 標記
app.patch("/api/formulas/:id", async (req, res) => {
  try {
    const props = {};
    if (typeof req.body.常忘 === "boolean") props["常忘"] = { checkbox: req.body.常忘 };
    const data = await notion(`/pages/${req.params.id}`, "PATCH", { properties: props });
    bust("formulas");
    res.json(mapFormula(data));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---- 每日戰績（專注分鐘 / 達標 / 每日完成）----
function mapDaily(page) {
  const p = page.properties;
  return {
    id: page.id,
    日期: txt(p["日期"]?.title),
    專注分鐘: num(p["專注分鐘"]),
    完成關卡: num(p["完成關卡"]),
    XP: num(p["XP"]),
    分心次數: num(p["分心次數"]),
    達標: chk(p["達標"]),
  };
}
async function dailyDb() { return process.env.NOTION_DB_DAILY || (await resolveDb("每日戰績")); }

// 讀全部每日戰績
app.get("/api/daily", async (req, res) => {
  try {
    const rows = await cached("daily", async () => queryAll(await dailyDb(), mapDaily));
    res.json(rows);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// upsert 今日戰績（依日期）
app.put("/api/daily", async (req, res) => {
  try {
    const b = req.body || {};
    const date = String(b.日期 || "").slice(0, 10);
    if (!date) throw new Error("缺少日期");
    const dbId = await dailyDb();
    const found = await notion(`/databases/${dbId}/query`, "POST", {
      filter: { property: "日期", title: { equals: date } },
      page_size: 1,
    });
    const props = {};
    if (typeof b.專注分鐘 === "number") props["專注分鐘"] = { number: b.專注分鐘 };
    if (typeof b.完成關卡 === "number") props["完成關卡"] = { number: b.完成關卡 };
    if (typeof b.XP === "number") props["XP"] = { number: b.XP };
    if (typeof b.分心次數 === "number") props["分心次數"] = { number: b.分心次數 };
    if (typeof b.達標 === "boolean") props["達標"] = { checkbox: b.達標 };
    let data;
    if (found.results && found.results.length) {
      data = await notion(`/pages/${found.results[0].id}`, "PATCH", { properties: props });
    } else {
      props["日期"] = { title: [{ text: { content: date } }] };
      data = await notion(`/pages`, "POST", { parent: { database_id: dbId }, properties: props });
    }
    bust("daily");
    res.json(mapDaily(data));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`作戰中心後端啟動於 :${PORT}`));
