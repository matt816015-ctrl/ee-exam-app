# 電機技師 2027 作戰中心 — 網頁前台 + Render 後端 + Notion 資料庫

網頁是你的主操作介面（看進度、勾章節、記錯題、查公式）。Notion 只當背後資料庫。
網頁 → Render 後端（持金鑰）→ 讀寫你的兩個 Notion 資料庫。你幾乎不用打開 Notion。

---

## 步驟 1｜建立 Notion 金鑰（約 3 分鐘）

實際畫面用字已對照 2026 年現行版本。

1. 開瀏覽器到 **https://www.notion.so/my-integrations**
   （若被導去別頁：Notion 左側 **Settings → Connections 分頁 → 拉到最下 →「Develop or manage integrations」**，會開到同一頁。）
2. 點 **「+ New integration」**（有些帳號顯示「+ New connection」，同一個東西）。
3. 填 **Name**（例：`ee-exam`）→ **Associated workspace** 選你的工作區 → Type 選 **Internal** → **Submit**。
4. 建好後進入該整合頁，找 **「Internal Integration Secret」**（或「Secrets」分頁）→ 按 **Show** → **Copy**。
   - 這串就是金鑰，**`secret_` 或 `ntn_` 開頭**。像密碼一樣保管，別貼到 GitHub。

## 步驟 2｜把資料庫「分享」給這個整合（最關鍵，做錯就讀不到）

**只要對「作戰中心主頁」做一次，底下兩個資料庫會一起被授權**（連線權限會往下層繼承）。

1. 打開 Notion，進入頁面 **「電機技師 2027 備考作戰中心」**。
2. 點頁面 **右上角的 `•••`**。
3. 在彈出選單 **最下方**點 **「Add connections」**（中文版：「新增連線」）。
4. 搜尋你剛建立的整合名稱（`ee-exam`）→ 點它 → 若問存取權限按 **Confirm / Update access**。

> 若部署後某個資料庫仍報 403/找不到：再對「六科章節進度」「錯題本」**各自**做一次步驟 2。
> 它們是頁面內的資料庫，要先在資料庫右上角點 **「⤢ Open as full page」** 開成整頁，才會出現它自己的 `•••` → Add connections。

## 步驟 3｜部署到 Render（約 5 分鐘）

先把這個資料夾推到一個 GitHub repo（`git init` → commit → push）。

**方法 A：手動建（最直覺）**
1. Render 右上 **「New」→「Web Service」**。
2. 連你的 GitHub repo → 選到後按 **Connect**。
3. 表單填：
   - **Name**：隨意（會變成網址 xxx.onrender.com）
   - **Region**：Singapore
   - **Branch**：main
   - **Build Command**：`npm install`
   - **Start Command**：`npm start`
   - **Instance Type**：Free
4. 展開最下方 **「Advanced」→ Environment Variables**，新增：
   - Key `NOTION_TOKEN`　Value = 步驟 1 複製的金鑰
   - （DB ID 程式已內建，可不填；要填就加 `NOTION_DB_CHAPTERS` / `NOTION_DB_WRONG`）
5. 按 **「Create Web Service」**，等首次部署完成（狀態變 **Live**）。

**方法 B：用 Blueprint（讀 render.yaml）**
Render →「New」→「Blueprint」→ 選含 `render.yaml` 的 repo → 部署時它會提示輸入 `NOTION_TOKEN`。

## 步驟 4｜驗證

- 開你的網址 `https://你的服務.onrender.com` → 應看到作戰中心，章節自動載入。
- 開 `https://你的服務.onrender.com/api/health` → 應回 `{"ok":true,"tokenSet":true}`。
  - `tokenSet:false` → 金鑰沒設好（回步驟 1/3）。
  - 章節空白或紅字錯誤 → 多半是步驟 2 沒分享（回步驟 2）。

---

## 常見卡關對照

| 症狀 | 原因 | 解法 |
| --- | --- | --- |
| 網頁紅字「連線失敗 401」 | 金鑰錯或沒設 | 步驟 3 環境變數 `NOTION_TOKEN` |
| 網頁紅字「找不到 / 404 / object_not_found」 | 資料庫沒分享給整合 | 步驟 2 |
| `/api/health` 回 tokenSet:false | 環境變數沒生效 | Render 改完環境變數要 **Manual Deploy / 重新部署** 才生效 |
| 第一次開很慢（30–60 秒） | Render 免費版閒置會休眠 | 正常，等喚醒即可 |

## 安全
金鑰只存在 Render 環境變數，永不進前台或 Git。真實 `.env` 已被 `.gitignore` 擋住，勿提交。
