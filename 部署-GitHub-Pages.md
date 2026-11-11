# 部署到 GitHub Pages（逐步）

這份站是純靜態，部署完會是一個公開網址，任何人打開就能玩遊戲、跟小科聊天，
**不需要你的電腦開著**，也不需要 API key。

---

## 0. 先確認本機能跑

```bash
cd D:/Wen/EduHK/6066/INT6066_FINAL
python -m http.server 8080
```

打開 `http://127.0.0.1:8080/` → 左邊遊戲能進選關、右邊小科會打招呼，才繼續往下。
（**不能雙擊 index.html**，遊戲是 wasm，需要 HTTP。）

---

## 1. 在 GitHub 建立倉庫

1. 登入 GitHub → 右上角 **＋** → **New repository**
2. Repository name：例如 `INT6066_FINAL`（這個名字會出現在網址裡）
3. 選 **Public**（免費帳號的 Pages 只支援公開倉庫）
4. **不要**勾選 "Add a README file"（本地已經有）
5. Create repository

---

## 2. 推上去

```bash
cd D:/Wen/EduHK/6066/INT6066_FINAL
git remote add origin https://github.com/zzw-zhangzhaowen/STEM-lesson-demo-Environmental.git
git branch -M main
git push -u origin main
```

第一次 push 會要求登入。GitHub 已經不接受密碼，要用 **Personal Access Token**：

1. GitHub → 右上角頭像 → **Settings** → 左下 **Developer settings**
2. **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
3. 勾選 `repo` 與 `workflow` 兩個權限（`workflow` 一定要勾，否則推不上 `.github/workflows/`）
4. 產生後複製 token，`git push` 問 Password 時貼上（帳號填你的 GitHub 用戶名）

---

## 3. 打開 Pages

倉庫頁 → **Settings** → 左側 **Pages**：

- **Source** 選 **GitHub Actions**（不是 "Deploy from a branch"）
- 不需要選分支，`pages.yml` 會自己跑

回到 **Actions** 分頁，會看到「部署到 GitHub Pages」正在跑：
橙點 = 進行中，綠勾 = 完成（約 40–90 秒）。

完成後網址是：

```
https://zzw-zhangzhaowen.github.io/STEM-lesson-demo-Environmental/
```

---

## 4. 之後每次更新

改了內容（或重跑了 `工具-從6064重新生成.py`）之後：

```bash
git add -A
git commit -m "更新知識庫"
git push
```

推送即自動重新部署，不用再點任何設定。

---

## 5. 常見問題

| 現象 | 原因 / 解法 |
|---|---|
| Actions 顯示 `Branch "main" is not allowed to deploy` | Pages 的 Source 還沒切到 **GitHub Actions**，回第 3 步 |
| 推不上去，提示 `refusing to allow a Personal Access Token to create or update workflow` | token 沒勾 `workflow` 權限，重新產生一個 |
| 網址打開是 404 | 部署還沒完成，或網址少了結尾的 `/`；到 Actions 看最後一次是否成功 |
| 遊戲一直停在 `Loading, please wait...` | 正常，首次要從 CDN 拉 Python wasm，10–20 秒；超過 1 分鐘請看 Console 是否有 `game.tar.gz` 404 |
| 遊戲動、小科不動 | `xiaoke-data.js` 沒推上去，或檔名大小寫不符（GitHub Pages 大小寫敏感，Linux 上 `Xiaoke.js` ≠ `xiaoke.js`） |
| 小科每次回答都一樣的兜底話術 | 該問題不在詞庫範圍內；`README.md` 第六節有範圍說明 |

---

## 6. 想用自己的域名（可選）

1. 在 DNS 加一筆 CNAME：`www` → `<帳號>.github.io`
2. 倉庫 Settings → Pages → **Custom domain** 填域名 → Save
3. 勾 **Enforce HTTPS**（憑證約 10 分鐘簽好）

---

## 7. 如果不想公開原始碼

Pages 免費版要求倉庫公開，整個資料夾（含 `工具-從6064重新生成.py`、README）都會被看到。
不想公開的話有三條路：

- **只公開建置產物**：開一個只放 `index.html` / `xiaoke*` / `game/` / `assets/` 的倉庫，
  把生成腳本留在本地。
- **改用私有倉庫 + Cloudflare Pages**（免費方案支援私有倉庫，流程幾乎一樣）。
- **用 6064 的 Python 版 + 臨時連結**（Hugging Face Spaces / Cloudflare Tunnel），
  不走靜態站。
