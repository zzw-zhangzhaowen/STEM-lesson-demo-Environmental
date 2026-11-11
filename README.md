# 地球媽媽拯救大作戰 × 小科 · 純靜態版

給 **GitHub Pages** 用的版本：左邊是 pygbag 編譯的網頁遊戲，右邊是**完全離線**的數字人小科。
沒有伺服器、沒有 API key、不需要安裝任何東西 —— 打開網址就能玩、能問。

> 來源：`D:/Wen/EduHK/6064/FINAL/earth-hk-combined`（Python + Gradio 版）。
> 這個資料夾是**建置產物**，6064 的原始碼沒有被改動；
> 小科的答案、詞庫、題庫都從 6064 抽出來，所以兩邊不會變成兩套說法。

---

## 一、目錄在做什麼

| 檔案 / 資料夾 | 作用 | 手改嗎 |
|---|---|---|
| `index.html` | 主頁（遊戲 + 小科，含版面、語言切換、彈窗） | ❌ 由腳本產生 |
| `xiaoke.html` / `xiaoke.css` | 小科的對話介面 | ✅ 可以 |
| `xiaoke.js` | 對話引擎（把 `app.py` 的 `_offline_reply` 1:1 搬到前端）+ 介面邏輯 | ✅ 可以 |
| `xiaoke-data.js` | 詞庫 46 條、題庫 28 題、FAQ 27 條、三語文案 | ❌ 由腳本產生 |
| `資料-中英補充.json` | 知識庫「理由」只有粵語，這裡補普通話／英文 | ✅ 可以 |
| `game/` | pygbag 產物（wasm 遊戲） | ❌ 從 6064 複製 |
| `assets/` | 圖片、四色桶圖、物品圖、頭像 | ❌ 從 6064 複製 |
| `工具-從6064重新生成.py` | 重新產生 `xiaoke-data.js`、`index.html`，並同步 `game/`、`assets/` | — |

---

## 二、本機預覽（看效果用）

**必須用 HTTP 開，不能雙擊 `index.html`。** 遊戲是 wasm，`file://` 下載不到資源；
小科本身可以雙擊開，但整頁會缺遊戲。

```bash
cd D:/Wen/EduHK/6066/INT6066_FINAL
python -m http.server 8080
# 瀏覽器打開 http://127.0.0.1:8080/
```

手機想一起看：`python -m http.server 8080 --bind 0.0.0.0`，
然後手機連同一個 Wi-Fi 開 `http://<電腦 IP>:8080/`。

---

## 三、部署到 GitHub Pages（三步）

細節與排錯見 [`部署-GitHub-Pages.md`](部署-GitHub-Pages.md)。

1. 在 GitHub 建一個 **public** 倉庫（免費 Pages 需要公開）。
2. 把這個資料夾推上去（`git init` 已做好並有第一次提交）：
   ```bash
   git remote add origin https://github.com/<你的帳號>/<倉庫名>.git
   git branch -M main
   git push -u origin main
   ```
3. 倉庫 → **Settings → Pages → Source 選「GitHub Actions」**。
   推送會自動觸發 `.github/workflows/pages.yml`，約 1 分鐘後得到
   `https://<你的帳號>.github.io/<倉庫名>/`。

---

## 四、改了知識庫之後怎麼同步

6064 的知識庫或關卡文案一改，這裡要重跑一次（只讀 6064，不會改它）：

```bash
cd D:/Wen/EduHK/6066/INT6066_FINAL
python 工具-從6064重新生成.py
```

它會重寫 `xiaoke-data.js`、`index.html`，並重新複製 `game/`、`assets/`。
看到「仍有絕對路徑未改」就表示 6064 的 `index.html` 新增了 `/xxx` 這種絕對路徑，
要在腳本的替換清單補一條。

`資料-中英補充.json` 的鍵必須跟知識庫 `#P-xx` 的標題**完全一致**；
改了詞條名而沒改這裡，腳本會印出警告（不會壞，只是那條會退回粵語或通用句）。

---

## 五、與 Python 版（6064）的差異

邏輯是 1:1 移植，用 83 條問題逐題比對過（Python `_offline_reply` vs 前端 `reply`）。
**只有以下三處刻意不同**，都是為了讓靜態版更好用：

| # | 差異 | 原因 |
|---|---|---|
| 1 | 句子裡有具體物品時，先回答物品，再回答「四色總覽」 | 英文 `PAT_FOUR` 會命中 "which **bin**"，照原順序問 "Which bin for a plastic bottle?" 會拿到總覽而不是答案 |
| 2 | 普通話／英文的物品原因改用 `資料-中英補充.json` 的翻譯 | 知識庫的「理由」只有粵語，照搬會出現 "Plastic bottle goes in the yellow bin. 樽身是塑料…" 這種半句粵語 |
| 3 | 英文多一條除錯關鍵詞（`wrongly` / `wrong bin`） | 介面範例就有「Why did the game sort it wrongly?」，原關鍵詞只收中文，會掉到兜底話術 |

另外：抽題是隨機的（`Math.random` vs Python `random`），每次不同屬正常。

---

## 六、已知限制

- **只答詞庫內的問題。** 46 條物品、28 題題庫、27 條 FAQ、5 關提示；範圍外的問題會回
  「我仲未夠聰明答這條」並給出可以問的三個例子。這是離線版的設計，不是 bug。
- **不會推理、不會寫新句子。** 所有答案都是模板 + 詞庫組合。
- **答案與遊戲畫面不一定同步。** 若 6064 改了關卡規則卻沒重跑生成腳本，小科會講舊規則。
- **FAQ 模糊匹配有門檻（0.62）。** 太低會亂答，太高會常常兜底；現在的門檻是與 Python 版一致的。
- 手機豎屏字級偏小（與 6064 相同），演示建議橫屏。

---

## 七、體積

整站約 1 MB（`game/` 576 KB、`assets/` 380 KB、其餘 < 100 KB），
遠低於 Pages 的限制（單檔 100 MB / 站點 1 GB）。
