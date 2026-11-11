/* 小科 · 離線版對話引擎 + 介面（純前端，不呼叫任何模型）

   為什麼可以直接搬過來：Python 版的小科在沒有 API key 時走的是
   `app.py` 的 `_offline_reply()` —— 純規則 + 詞庫 + FAQ 模糊匹配，
   沒有任何東西必須留在伺服器。這裡是它的 1:1 JavaScript 版本，
   資料由 `工具-從6064重新生成.py` 從 `app.py` / 知識庫抽出，兩邊同一份來源。

   對照關係（方便日後維護）：
     _item_label      → itemLabel()
     _why             → whyOf()
     _lookup_item     → lookupItem()
     _bin_answer      → binAnswer()
     _kb_faq_answer   → kbFaqAnswer()
     _offline_reply   → reply()
*/
(function () {
  'use strict';

  const D = window.XK_DATA;
  if (!D) {
    document.body.innerHTML =
      '<p style="font:16px system-ui;padding:24px;color:#a33">' +
      '缺少 xiaoke-data.js，請先執行「工具-從6064重新生成.py」。</p>';
    return;
  }

  /* =======================================================================
     一、規則與查表（對應 Python 模組層的常數）
     ======================================================================= */
  const R_QUIZ = new RegExp(D.patterns.quiz, 'i');
  const R_FOUR = new RegExp(D.patterns.four, 'i');
  const R_DEBUG = new RegExp(D.patterns.debug, 'i');
  const R_GREET = new RegExp(D.patterns.greet, 'i');
  // Python 版的除錯關鍵詞只收中文，英文的 "sort it wrongly" 會掉到兜底話術；
  // 這裡補一條英文規則（介面上「Why did the game sort it wrongly?」正是範例問題）。
  const R_DEBUG_EN = /wrongly|wrong bin|sort(?:ed|s)?[^.?!]{0,40}wrong/i;

  // 出題句式：三種語言各一段，用來判斷「上一句是不是在考我」
  const QUIZ_ASKS = [
    /我來考考你：(.+?)應該放入/,
    /我来考考你：(.+?)应该放进/,
    /Let me quiz you: which colour bin should (.+?) go into/,
    /Let me quiz you: which color bin should (.+?) go into/,
  ];

  const LEVEL_RE = /第\s*([0-5一二三四五])\s*關/;
  const LEVEL_MAP = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5' };

  const PUNCT_RE = /[\s，。？！、,.?!~…]/g;

  const kbEntry = (name) => D.kb_items[name] || {};

  function itemLabel(name, lang) {
    if (lang === 'en') return D.item_en[name] || kbEntry(name).en || name;
    if (lang === 'cn') return D.item_cn[name] || kbEntry(name).cn || name;
    return name;
  }

  function whyOf(name, lang) {
    const generic = (D.offline_text[lang] || D.offline_text.hk).generic_why;
    if (lang === 'cn') return D.why_cn[name] || kbEntry(name).why || generic;
    if (lang === 'en') return D.why_en[name] || kbEntry(name).why || generic;
    if (D.life_items[name]) return D.life_items[name][1];
    for (let i = 0; i < D.quiz_bank.length; i++) {
      if (D.quiz_bank[i][0] === name) return D.quiz_bank[i][2];
    }
    return kbEntry(name).why || D.offline_text.hk.generic_why;
  }

  /* 從一句話裡找最長的物品匹配；取最長是為了不讓「紙巾」蓋過「紙巾盒」這類情況 */
  function lookupItem(text, lang) {
    const lower = text.toLowerCase();
    const hit = (name) =>
      text.indexOf(name) !== -1 ||
      (D.item_cn[name] && text.indexOf(D.item_cn[name]) !== -1) ||
      (D.item_en[name] && lower.indexOf(D.item_en[name].toLowerCase()) !== -1);

    const hits = [];
    Object.keys(D.life_items).forEach((name) => {
      if (hit(name)) {
        hits.push([name.length, 1, name, D.char2code[D.life_items[name][0]] || 'green']);
      }
    });
    D.quiz_bank.forEach((row) => {
      if (hit(row[0])) hits.push([row[0].length, 1, row[0], D.char2code[row[1]] || 'green']);
    });
    D.kb_aliases.forEach((pair) => {
      const alias = pair[0];
      if (text.indexOf(alias) !== -1 || lower.indexOf(alias.toLowerCase()) !== -1) {
        hits.push([alias.length, 0, pair[1], kbEntry(pair[1]).code || 'green']);
      }
    });
    if (!hits.length) return null;

    // Python: sort(key=lambda row: (-row[0], row[1]))，兩邊都是穩定排序
    hits.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));
    const picked = hits[0];
    const name = picked[2];
    let code = picked[3];

    /* 中文常把「充電電池」說成「電池」、「玻璃樽」說成「玻璃」。
       舊表會歸成一般垃圾；這裡補一刀，改成特殊處理（不丟四色桶）。 */
    if (code === 'green') {
      const names = Object.keys(D.kb_items);
      for (let i = 0; i < names.length; i++) {
        const entry = D.kb_items[names[i]];
        if (entry.code !== 'special') continue;
        const covered = (entry.aliases || []).some((alias) => alias.indexOf(name) !== -1);
        if (covered) return ['special', names[i]];
      }
    }
    return [code, name];
  }

  function binAnswer(text) {
    const lower = text.toLowerCase();
    for (let i = 0; i < D.bin_codes.length; i++) {
      const code = D.bin_codes[i];
      const words = D.bin_match[code] || [];
      if (words.some((w) => lower.indexOf(w) !== -1 || text.indexOf(w) !== -1)) return code;
    }
    return null;
  }

  /* =======================================================================
     二、difflib.SequenceMatcher.ratio() 的 JavaScript 版
     知識庫 FAQ 檢索靠它打分，直接用「最長公共子序列」近似會讓結果跑掉，
     所以照 difflib 的做法：遞迴找最長匹配塊，把塊長加總。
     ======================================================================= */
  function longestMatch(a, alo, ahi, b, blo, bhi) {
    const rows = ahi - alo;
    const cols = bhi - blo;
    let best = { i: alo, j: blo, size: 0 };
    if (rows <= 0 || cols <= 0) return best;

    let prev = new Int32Array(cols + 1);
    let cur = new Int32Array(cols + 1);
    for (let i = 1; i <= rows; i++) {
      const ai = a.charCodeAt(alo + i - 1);
      for (let j = 1; j <= cols; j++) {
        if (ai === b.charCodeAt(blo + j - 1)) {
          const size = prev[j - 1] + 1;
          cur[j] = size;
          // 只在「更長」時更新，於是同樣長度會保留最早的起點（與 difflib 一致）
          if (size > best.size) {
            best = { i: alo + i - size, j: blo + j - size, size: size };
          }
        } else {
          cur[j] = 0;
        }
      }
      const swap = prev;
      prev = cur;
      cur = swap;
      cur.fill(0);
    }
    return best;
  }

  function matchedChars(a, b) {
    let total = 0;
    const stack = [[0, a.length, 0, b.length]];
    while (stack.length) {
      const [alo, ahi, blo, bhi] = stack.pop();
      const m = longestMatch(a, alo, ahi, b, blo, bhi);
      if (!m.size) continue;
      total += m.size;
      if (alo < m.i && blo < m.j) stack.push([alo, m.i, blo, m.j]);
      if (m.i + m.size < ahi && m.j + m.size < bhi) {
        stack.push([m.i + m.size, ahi, m.j + m.size, bhi]);
      }
    }
    return total;
  }

  function ratio(a, b) {
    const total = a.length + b.length;
    return total === 0 ? 1 : (2 * matchedChars(a, b)) / total;
  }

  function kbFaqAnswer(text) {
    const compact = text.replace(PUNCT_RE, '');
    if (compact.length < 2) return null;
    const setA = new Set(compact);

    let bestScore = 0;
    let bestAnswer = '';
    D.kb_faq.forEach((pair) => {
      const q = pair[0].replace(PUNCT_RE, '');
      const setB = new Set(q);
      let inter = 0;
      setA.forEach((ch) => { if (setB.has(ch)) inter += 1; });
      const overlap = inter / Math.max(setA.size, 1);
      const score = overlap * 0.7 + ratio(compact, q) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestAnswer = pair[1];
      }
    });
    return bestScore >= 0.62 ? bestAnswer : null;
  }

  /* =======================================================================
     三、主回覆流程（對應 _offline_reply）
     ======================================================================= */
  function fill(template, vars) {
    return template.replace(/\{(\w+)\}/g, (whole, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole
    );
  }

  // 英文句子開頭要大寫；物品名在英文是小寫（例如 "rechargeable battery"）
  function capEn(text, lang) {
    if (lang !== 'en' || !text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function lastAssistant(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant') return String(history[i].content || '');
    }
    return '';
  }

  function reply(message, history, lang) {
    const text = String(message || '').trim();
    const tpl = D.offline_text[lang] || D.offline_text.hk;

    if (R_GREET.test(text)) return tpl.greet;

    // 想被考
    if (R_QUIZ.test(text)) {
      const row = D.quiz_bank[Math.floor(Math.random() * D.quiz_bank.length)];
      return fill(tpl.quiz_ask, { item: itemLabel(row[0], lang) });
    }

    // 上一句是考題 → 這句當作答
    const lastBot = lastAssistant(history);
    let asked = null;
    for (let i = 0; i < QUIZ_ASKS.length && asked === null; i++) {
      const m = lastBot.match(QUIZ_ASKS[i]);
      if (m) asked = m[1];
    }
    if (asked !== null) {
      let found = null;
      for (let i = 0; i < D.quiz_bank.length; i++) {
        const row = D.quiz_bank[i];
        if (row[0] === asked || D.item_en[row[0]] === asked) {
          found = [D.char2code[row[1]] || 'green', row[0]];
          break;
        }
      }
      if (!found) found = lookupItem(asked, lang);
      const code = found ? found[0] : 'green';
      const name = found ? found[1] : asked;

      if (code === 'special') {
        return capEn(fill(D.offline_special[lang] || D.offline_special.hk, {
          item: itemLabel(name, lang),
          why: whyOf(name, lang),
        }), lang);
      }
      const picked = binAnswer(text);
      const colorWord = (D.bin_name[lang] || D.bin_name.hk)[code];
      const binWord = (D.bin_label[lang] || D.bin_label.hk)[code];
      if (picked === null) return tpl.quiz_hint;
      if (picked === code) return fill(tpl.quiz_right, { why: whyOf(name, lang) });
      return fill(tpl.quiz_wrong, {
        color: colorWord, bin: binWord, why: whyOf(name, lang),
      });
    }

    if (R_FOUR.test(text)) {
      // 先看看句子裡有沒有具體物品：英文的 PAT_FOUR 會命中 "which bin"，
      // 若照 Python 版順序，問 "Which bin for a plastic bottle?" 會拿到四色總覽而不是答案。
      const asItem = lookupItem(text, lang);
      if (!asItem) return tpl.four_bins;
    }
    if (R_DEBUG.test(text) || R_DEBUG_EN.test(text)) return tpl.debug;

    const found = lookupItem(text, lang);
    if (found) {
      const code = found[0];
      const name = found[1];
      if (code === 'special') {
        return capEn(fill(D.offline_special[lang] || D.offline_special.hk, {
          item: itemLabel(name, lang),
          why: whyOf(name, lang),
        }), lang);
      }
      const sentence = fill(tpl.item, {
        item: itemLabel(name, lang),
        color: (D.bin_name[lang] || D.bin_name.hk)[code],
        bin: (D.bin_label[lang] || D.bin_label.hk)[code],
        why: whyOf(name, lang),
      });
      return sentence.charAt(0).toUpperCase() + sentence.slice(1);
    }

    const faq = kbFaqAnswer(text);
    if (faq) return faq;

    const level = text.match(LEVEL_RE);
    if (level) {
      const key = LEVEL_MAP[level[1]] || level[1];
      if (Object.prototype.hasOwnProperty.call(D.level_hints, key)) {
        return D.level_hints[key];
      }
    }

    return tpl.fallback;
  }

  /* =======================================================================
     四、介面
     ======================================================================= */
  const params = new URLSearchParams(location.search);
  const lang = ['hk', 'cn', 'en'].indexOf(params.get('lang')) >= 0
    ? params.get('lang') : 'hk';
  const ui = D.ui_text[lang] || D.ui_text.hk;

  const log = document.getElementById('log');
  const chips = document.getElementById('chips');
  const input = document.getElementById('input');
  const form = document.getElementById('composer');
  const btnSend = document.getElementById('btnSend');

  // 給瀏覽器測試／除錯用：主控台可以直接呼叫 XKEngine.reply(...)
  window.XKEngine = {
    reply: reply, lookupItem: lookupItem, binAnswer: binAnswer,
    kbFaqAnswer: kbFaqAnswer, ratio: ratio, lang: lang, data: D,
  };

  let history = [];
  let busy = false;

  document.getElementById('xkSub').textContent = ui.sub;
  // 頂部只留「小科」，全名太長；外層面板已經寫了「小科 · 地球老師」
  document.getElementById('xkName').textContent = ui.name.split('·')[0].trim();
  document.getElementById('xkTag').textContent =
    ({ hk: '離線版', cn: '离线版', en: 'Offline' })[lang] || '離線版';
  input.placeholder = ui.placeholder;
  document.title = ui.title;

  // 嵌在首頁 iframe 裡時收窄一點（外層已有面板標題，不需要重複副標）
  try {
    if (window.self !== window.top) document.body.classList.add('embedded');
  } catch (e) { /* 跨來源就當作獨立頁面 */ }

  /* 極簡渲染：只處理程式碼區塊、「摺疊說明」與換行。
     內容全部出自我們自己的知識庫，所以不做 HTML 轉義；
     使用者輸入一律用 textContent 塞入，不會被當成標籤。 */
  function blockHtml(block) {
    if (/^<details/i.test(block)) return block.replace(/\n/g, '<br>');
    return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
  }

  function rich(text) {
    return String(text).split('```').map((chunk, i) => {
      if (i % 2 === 1) {
        const body = chunk.replace(/^[A-Za-z]*\n?/, '').replace(/\n$/, '');
        return '<pre><code>' + body.replace(/[&<>]/g, (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</code></pre>';
      }
      return chunk.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
        .map(blockHtml).join('');
    }).join('');
  }

  function scrollDown() {
    log.scrollTop = log.scrollHeight + 200;
  }

  function addRow(role, content) {
    const row = document.createElement('div');
    row.className = 'row ' + (role === 'user' ? 'user' : 'bot');

    if (role === 'user') {
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = content;          // 使用者輸入永遠當純文字
      row.appendChild(bubble);
    } else {
      const avatar = document.createElement('img');
      avatar.className = 'avatar';
      avatar.src = 'assets/mother-earth-avatar.png';
      avatar.alt = '小科';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.innerHTML = rich(content);
      row.appendChild(avatar);
      row.appendChild(bubble);
    }
    log.appendChild(row);
    scrollDown();
    return row;
  }

  function addTyping() {
    const row = document.createElement('div');
    row.className = 'row bot';
    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.src = 'assets/mother-earth-avatar.png';
    avatar.alt = '小科';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    row.appendChild(avatar);
    row.appendChild(bubble);
    log.appendChild(row);
    scrollDown();
    return row;
  }

  function renderChips() {
    chips.innerHTML = '';
    (ui.examples || []).forEach((text) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = text;
      chip.addEventListener('click', () => send(text));
      chips.appendChild(chip);
    });
  }

  function setBusy(state) {
    busy = state;
    btnSend.disabled = state;
    input.disabled = state;
  }

  function send(raw) {
    const text = String(raw || '').trim();
    if (!text || busy) return;

    addRow('user', text);
    history.push({ role: 'user', content: text });
    input.value = '';
    autoGrow();
    setBusy(true);

    const typing = addTyping();
    const answer = reply(text, history.slice(0, -1), lang);

    // 一點延遲，讓「正在輸入」看得見；長回答等一下下，讀起來比較自然
    const wait = 260 + Math.min(520, answer.length * 6);
    setTimeout(() => {
      typing.remove();
      addRow('bot', answer);
      history.push({ role: 'assistant', content: answer });
      setBusy(false);
      input.focus();
    }, wait);
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send(input.value);
  });

  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(input.value);
    }
  });

  document.getElementById('btnReset').addEventListener('click', () => {
    log.innerHTML = '';
    history = [];
    const opening = D.openings[lang] || D.openings.hk;
    addRow('bot', opening);
    history.push({ role: 'assistant', content: opening });
    renderChips();
    input.focus();
  });

  /* 開場：小科先打招呼（與 Python 版一致，進來就有話說） */
  const opening = D.openings[lang] || D.openings.hk;
  addRow('bot', opening);
  history.push({ role: 'assistant', content: opening });
  renderChips();
  autoGrow();
  if (window.matchMedia('(min-width: 700px)').matches) input.focus();
})();
