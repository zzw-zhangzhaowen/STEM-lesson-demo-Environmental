/* 小科 · 離線版對話引擎 + 介面（純前端，不呼叫任何模型）

   基礎：`app.py` 的 `_offline_reply()` —— 純規則 + 詞庫 + FAQ 模糊匹配，
   沒有任何東西必須留在伺服器，所以整條鏈路搬到瀏覽器。
   資料由 `工具-從6064重新生成.py` 從 `app.py` / 知識庫抽出，兩邊同一份來源。

   在此之上，這一版刻意「對齊」6064 正式版的系統提示詞，補了七件事
   （6064 的離線規則沒有、但模型版做得到的能力）：
     1. 語言自適應：按「用戶這次輸入的語言」回覆，不再綁死 UI 的 ?lang=
     2. 趣味小考官改用「現實生活進階題庫」，一題一判，答對／答錯都有原因與鼓勵
     3. 遊戲外物品（電池、玻璃樽、舊衣…）補「拿去回收點 + 問老師家人」
     4. 安全界線：情緒支援、不收集個人資料、離題溫柔帶回
     5. 四色總覽補上每桶的例子（報紙／紙箱／膠樽／鋁罐…）
     6. 代碼只在「分類條件／除錯」出現，並用 <details> 做「點擊翻譯」
     7. 防沉迷：連續 3 次無關話題就溫和攔截，直到學生問回課程相關問題
        （話術與 6064 的 OFFTOPIC_TEXT 同一份，由產生器寫入）

   對照關係（方便日後維護）：
     _item_label      → itemLabel()
     _why             → whyOf()
     _lookup_item     → lookupItem()
     _bin_answer      → binAnswer()
     _kb_faq_answer   → kbFaqAnswer()
     _looks_offtopic  → looksOfftopic()（防沉迷：連續離題次數）
     _offline_reply   → reply()（意圖順序有擴充，見上面七點）
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

  // 以下是「對齊正式版 prompt」才加的意圖，6064 的離線規則裡沒有
  const R_AND = /\band\b|同埋|兩個條件|两个条件|兩個原因/i;
  const R_WHO = /你係邊個|你係誰|你是谁|你叫咩名|你叫什麼名字|你叫什麽名字|who are you|what'?s your name/i;
  const R_CAP = /你會做咩|你会做咩|你可以做咩|你可以做什麼|你可以做什么|有咩功能|有什么功能|幫到我咩|帮到我什么|what can you do|how can you help/i;
  const R_EMOTION = /唔開心|不開心|不开心|好傷心|伤心|想死|自殺|自杀|死咗就好|欺負|欺负|bully|打我|被排擠|被排挤|冇人同我玩|没人跟我玩|好驚|害怕|好嬲|嬲死|討厭自己|讨厌自己|我好蠢|我太笨|頂唔順|撑不住|捱唔住|想喊|哭了|好孤單|好孤单|sad|scared|lonely|hate myself/i;
  const R_PRIVACY = /\b\d{8}\b|電話號碼|电话号码|手機號碼|手机号码|身份證|身份证|學號|学号|我個電話|my phone number|my address/i;

  // 出題句式：三種語言各一段，用來判斷「上一句是不是在考我」
  const QUIZ_ASKS = [
    /我來考考你：(.+?)應該放入/,
    /我来考考你：(.+?)应该放进/,
    /Let me quiz you: which colou?r bin should (.+?) go into/,
  ];

  const LEVEL_RE = /第\s*([0-5一二三四五])\s*關|第\s*([0-5一二三四五])\s*关/;
  const LEVEL_MAP = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5' };

  const PUNCT_RE = /[\s，。？！、,.?!~…]/g;

  const kbEntry = (name) => D.kb_items[name] || {};

  // 知識庫詞條名常是「本名（補充）、別名2、別名3」；回答時只取最前面那個，
  // 否則會出現「充電電池、鈕扣電池、鉛蓄電池唔可以丟四色桶」這種像在唸清單的句子。
  function shortName(name) {
    return String(name).replace(/（[^）]*）/g, '').split('、')[0].trim() || name;
  }

  function itemLabel(name, lang) {
    if (lang === 'en') return D.item_en[name] || kbEntry(name).en || shortName(name);
    if (lang === 'cn') return D.item_cn[name] || kbEntry(name).cn || shortName(name);
    return shortName(name);
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
     二、語言自適應（正式版 prompt 的「核心重要」規則）
     正式版由模型自己判斷語言；離線版沒有模型，就用字集投票：
     同一句話裡「繁體專用字」多 → 粵語；「簡體專用字」多 → 普通話；無中文 → 英文。
     判斷不出來（例如「你好」）才沿用 UI 語言。
     ======================================================================= */
  const TRAD_ONLY =
    '們個這來說麼樣時學習環類膠樽電腦網頭過對開關問題廚餘紙張還與從邊該丟進裡嘅咗唔係佢哋啲喺咩冇哂嘢點幾雙單發現認語讀寫聽講師園區乾濕錢鐵銅蓋爛壞舊戲髮嗎為給見記覺讓應該沒誰間體課級億';
  const SIMP_ONLY =
    '们个这来说么样时学习环类胶瓶电脑网头过对开关问题厨余纸张还与从边该丢进里点几双单发现认语读写听讲师园区干湿钱铁铜盖烂坏旧戏发吗为给见记觉让应该没谁间体课级亿';

  function detectLang(text, fallback) {
    const s = String(text || '');
    if (!/[\u3400-\u9fff]/.test(s)) {
      return /[a-z]/i.test(s) ? 'en' : fallback;
    }
    let trad = 0;
    let simp = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (TRAD_ONLY.indexOf(ch) !== -1) trad += 1;
      else if (SIMP_ONLY.indexOf(ch) !== -1) simp += 1;
    }
    if (simp > trad) return 'cn';
    if (trad > simp) return 'hk';
    // 打和：UI 是英文就先當粵語（香港小學情境），否則沿用 UI 語言
    return fallback === 'en' ? 'hk' : fallback;
  }

  /* =======================================================================
     三、difflib.SequenceMatcher.ratio() 的 JavaScript 版
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

  // FAQ 與關卡提示都要「按語言查表」，否則簡體／英文學生會拿到粵語答案
  const FAQ_TABLE = Object.assign({ hk: D.kb_faq }, D.faq_lang || {});
  const HINTS = Object.assign({ hk: D.level_hints }, D.level_hints_lang || {});

  /* 英文短句的字集重疊很容易誤配（"how do i make a cake" 會撞到 "how do i find
     the mistake"），所以要求句子裡有主題詞，或者相似度高到不用懷疑。 */
  const TOPIC_RE = new RegExp(
    '桶|垃圾|回收|廢|废|膠|胶|紙|纸|金屬|金属|樽|罐|電池|电池|燈泡|灯泡|' +
    '關|关|遊戲|游戏|分數|分数|除錯|錯|错|程式|程序|條件|条件|變數|变量|拖|' +
    '小測|小测|題|题|小芽|笑話|笑话|唱歌|故事|功課|作业|作業|蠢|笨|真人|歲|岁|' +
    'bin|waste|rubbish|trash|recycl|paper|plastic|metal|glass|bottle|level|game|' +
    'score|point|heart|debug|bug|code|sort|drag|quiz|question|joke|story|sing|' +
    'homework|sprout|real person|how old|stupid|wrong',
    'i'
  );

  function kbFaqAnswer(text, lang) {
    const table = FAQ_TABLE[lang] || D.kb_faq;
    const compact = text.replace(PUNCT_RE, '');
    if (compact.length < 2) return null;
    const setA = new Set(compact);

    let bestScore = 0;
    let bestAnswer = '';
    table.forEach((pair) => {
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
    if (bestScore >= 0.9) return bestAnswer;
    if (bestScore >= 0.62 && TOPIC_RE.test(text)) return bestAnswer;
    return null;
  }

  /* =======================================================================
     四、主回覆流程
     ======================================================================= */
  const ALIGN = D.align || {};
  const copyOf = (lang) => ALIGN[lang] || ALIGN.hk || {};

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

  /* =======================================================================
     三·五、防沉迷：連續 3 次無關話題 → 溫和攔截
     對齊 6064 的 `_looks_offtopic` / `_offtopic_streak` / `_intercept_due`：
     離線版沒有模型自己數次數，就用「規則引擎接得住就不算離題」回頭掃紀錄。
     ======================================================================= */
  const OFFTOPIC_LIMIT = 3;

  function looksOfftopic(text, lang) {
    const s = String(text || '').trim();
    if (!s) return false;
    if (R_GREET.test(s)) return false;
    if (R_PRIVACY.test(s) || R_EMOTION.test(s)) return false;
    if (R_QUIZ.test(s) || R_WHO.test(s) || R_CAP.test(s)) return false;
    if (R_FOUR.test(s) && !lookupItem(s, lang)) return false;
    if (R_DEBUG.test(s) || R_DEBUG_EN.test(s)) return false;
    if (binAnswer(s) !== null) return false;
    if (lookupItem(s, lang)) return false;
    if (LEVEL_RE.test(s)) return false;
    if (kbFaqAnswer(s, lang)) return false;
    return true;
  }

  function offtopicStreak(history, lang) {
    let n = 0;
    for (let i = (history || []).length - 1; i >= 0; i -= 1) {
      if (history[i].role !== 'user') continue;
      if (!looksOfftopic(String(history[i].content || ''), lang)) break;
      n += 1;
    }
    return n;
  }

  function interceptText(lang) {
    const table = D.offtopic_text || {};
    return table[lang] || table.hk || '';
  }

  // 遊戲外的物品：先講「不入四色桶」，再引導去回收點（正式版 prompt 的要求）
  function specialReply(name, lang, copy) {
    const body = fill(D.offline_special[lang] || D.offline_special.hk, {
      item: itemLabel(name, lang),
      why: whyOf(name, lang),
    });
    const tail = copy.special_tail || '';
    return capEn(tail ? body + '\n\n' + tail : body, lang);
  }

  // 出題池：優先「進階生活題」，沒有才退回原本的 28 題
  const QUIZ_POOL = (D.quiz_life && D.quiz_life.length)
    ? D.quiz_life
    : D.quiz_bank.map((row) => ({
        key: row[0], hk: row[0], cn: D.item_cn[row[0]] || row[0],
        en: D.item_en[row[0]] || row[0], code: D.char2code[row[1]] || 'green',
      }));

  let lastQuiz = null;   // {key, code}：等學生答的那一題

  function askQuiz(lang, tpl) {
    const q = QUIZ_POOL[Math.floor(Math.random() * QUIZ_POOL.length)];
    lastQuiz = { key: q.key, code: q.code };
    return fill(tpl.quiz_ask, { item: q[lang] || q.hk });
  }

  // 頁面重載或按 ↺ 之後 lastQuiz 會消失，這時靠「上一句 bot 說了甚麼」反查
  function quizFromHistory(history) {
    const lastBot = lastAssistant(history);
    for (let i = 0; i < QUIZ_ASKS.length; i++) {
      const m = lastBot.match(QUIZ_ASKS[i]);
      if (!m) continue;
      const asked = m[1];
      const pool = QUIZ_POOL.find((q) => q.hk === asked || q.cn === asked || q.en === asked);
      if (pool) return { key: pool.key, code: pool.code };
      const row = D.quiz_bank.find((r) => r[0] === asked);
      if (row) return { key: row[0], code: D.char2code[row[1]] || 'green' };
      const found = lookupItem(asked, 'hk');
      if (found) return { key: found[1], code: found[0] };
    }
    return null;
  }

  function judgeQuiz(text, quiz, lang, tpl) {
    const code = quiz.code;
    const why = whyOf(quiz.key, lang);
    const picked = binAnswer(text);

    if (picked === null) {
      lastQuiz = quiz;                       // 沒聽懂答案，題目留著讓他再答
      return { text: copyOf(lang).quiz_nudge || tpl.quiz_hint, keep: true };
    }
    lastQuiz = null;

    // 學生可能照句式反過來考我們（「我來考考你：充電電池…」）；
    // 這種物品不屬於四色桶，沒有顏色可判，改回答它該去哪裡。
    if (code === 'special') {
      return { text: specialReply(quiz.key, lang, copyOf(lang)), keep: false };
    }

    if (picked === code) return { text: fill(tpl.quiz_right, { why: why }), keep: false };
    const colorWord = (D.bin_name[lang] || D.bin_name.hk)[code];
    const binWord = (D.bin_label[lang] || D.bin_label.hk)[code];
    return {
      text: fill(tpl.quiz_wrong, { color: colorWord, bin: binWord, why: why }),
      keep: false,
    };
  }

  function reply(message, history, lang, steps) {
    const text = String(message || '').trim();
    const tpl = D.offline_text[lang] || D.offline_text.hk;
    const copy = copyOf(lang);
    history = history || [];

    // 思考過程：把「這次真正走過的判定」記進 steps，不改動回覆內容。
    // 6064 的 Gradio 版用的是同一套順序，兩邊展示的步驟才會一致。
    const mark = (key, val) => { if (steps) steps.push([key, val]); };
    const TT = D.thought_text || {};
    const langNames = (TT[lang] || TT.hk || {}).lang_names || {};
    mark('lang', langNames[lang] || lang);

    // 打招呼：短句才算，避免「你好，膠樽放邊個桶？」被吃掉
    if (R_GREET.test(text) && text.length <= 12 && !lookupItem(text, lang)) {
      mark('intent', 'greet');
      return tpl.greet;
    }

    // 安全界線：不要收集個人資料
    if (R_PRIVACY.test(text)) {
      mark('intent', 'privacy');
      return copy.privacy || tpl.fallback;
    }

    // 情緒支援：先安慰，再鼓勵找老師／家人（正式版 prompt 的界線）
    if (R_EMOTION.test(text)) {
      mark('intent', 'comfort');
      return copy.comfort || tpl.fallback;
    }

    // 想被考
    if (R_QUIZ.test(text)) {
      mark('intent', 'quiz');
      return askQuiz(lang, tpl);
    }

    // 上一句是考題 → 這句當作答（題目在 lastQuiz，或從對話紀錄反查）
    const quiz = lastQuiz || quizFromHistory(history);
    if (quiz) {
      // 短句、有顏色詞、或明說「唔知」才算在回答；否則當成轉話題，題目留著
      const looksAnswer = binAnswer(text) !== null ||
        (text.length <= 12 && !lookupItem(text, lang) &&
          !R_DEBUG.test(text) && !R_FOUR.test(text)) ||
        /唔知|不知道|不知道呀|no idea|dunno|not sure|guess/i.test(text);
      if (looksAnswer) {
        mark('intent', 'answer');
        const result = judgeQuiz(text, quiz, lang, tpl);
        if (!result.keep) lastQuiz = null;
        return result.text;
      }
    }

    // 身份與能力（正式版的角色設定）
    if (R_WHO.test(text)) {
      mark('intent', 'who');
      return copy.who || tpl.greet;
    }
    if (R_CAP.test(text)) {
      mark('intent', 'cap');
      return copy.capabilities || tpl.four_bins;
    }

    // 四色總覽：句中有具體物品時先答物品（英文 "which bin" 會命中四色規則）
    if (R_FOUR.test(text) && !lookupItem(text, lang)) {
      mark('intent', 'four');
      return copy.four_bins_detail || tpl.four_bins;
    }

    // 條件判斷／除錯：只有這裡會出現程式碼，並用 details 做「點擊翻譯」
    if (R_DEBUG.test(text) || R_DEBUG_EN.test(text)) {
      mark('intent', 'debug');
      return (R_AND.test(text) && copy.debug_and) ? copy.debug_and : tpl.debug;
    }

    const found = lookupItem(text, lang);
    if (found) {
      const code = found[0];
      const name = found[1];
      mark('intent', 'item');
      mark('lookup', ['item', code, name]);
      if (code === 'special') return specialReply(name, lang, copy);
      const sentence = fill(tpl.item, {
        item: itemLabel(name, lang),
        color: (D.bin_name[lang] || D.bin_name.hk)[code],
        bin: (D.bin_label[lang] || D.bin_label.hk)[code],
        why: whyOf(name, lang),
      });
      return sentence.charAt(0).toUpperCase() + sentence.slice(1);
    }

    mark('lookup', ['none']);

    // 關卡提示：先於 FAQ，否則「第 5 關點過」會誤中「150 分」那條 FAQ
    const level = text.match(LEVEL_RE);
    if (level) {
      const raw = level[1] || level[2];
      const key = LEVEL_MAP[raw] || raw;
      const hints = HINTS[lang] || D.level_hints;
      if (Object.prototype.hasOwnProperty.call(hints, key)) {
        mark('intent', 'level');
        mark('lookup', ['level', key]);
        return hints[key];
      }
    }

    const faq = kbFaqAnswer(text, lang);
    if (faq) {
      mark('intent', 'faq');
      mark('lookup', ['faq', faqQuestionOf(faq, lang)]);
      return faq;
    }

    mark('intent', 'fallback');
    // 防沉迷：連續第 3 次無關話題就溫和攔截（對齊 6064 的 OFFTOPIC_TEXT）
    if (offtopicStreak(history, lang) + 1 >= OFFTOPIC_LIMIT) {
      const warning = interceptText(lang);
      if (warning) {
        mark('intent', 'offtopic');
        return warning;
      }
    }
    return tpl.fallback;
  }

  function faqQuestionOf(answer, lang) {
    const table = FAQ_TABLE[lang] || D.kb_faq;
    for (let i = 0; i < table.length; i += 1) {
      if (table[i][1] === answer) return table[i][0];
    }
    return '';
  }

  /* 把這次真實走過的判定，變成可摺疊的「思考過程」卡片。
     文案全部來自 6064 的 THOUGHT_TEXT（由產生器寫進 xiaoke-data.js）。 */
  function thoughtData(steps, lang) {
    const TT = D.thought_text || {};
    const t = TT[lang] || TT.hk;
    if (!t) return { html: '', list: [] };
    const last = (key) => {
      const hits = (steps || []).filter((s) => s[0] === key);
      return hits.length ? hits[hits.length - 1][1] : null;
    };
    const esc = (s) => String(s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const langName = last('lang') || lang;
    const intent = last('intent') || 'fallback';
    const lookup = last('lookup') || ['skip'];   // skip = 這題根本唔使查詞庫
    let lookupText = t.no_lookup || t.hit_none;
    let rule = 'other';
    let compose = 'other';

    if (lookup[0] === 'none') {
      lookupText = t.hit_none;
    } else if (lookup[0] === 'item') {
      const code = lookup[1];
      const label = itemLabel(lookup[2], lang);
      if (code === 'special') {
        lookupText = fill(t.hit_special, { item: label });
        rule = 'special';
      } else {
        lookupText = fill(t.hit_item, {
          item: label,
          color: (D.bin_name[lang] || D.bin_name.hk)[code],
          bin: (D.bin_label[lang] || D.bin_label.hk)[code],
        });
        rule = 'item';
      }
      compose = 'item';
    } else if (lookup[0] === 'faq') {
      lookupText = fill(t.hit_faq, { q: lookup[1] || '' });
      rule = 'faq';
      compose = 'faq';
    } else if (lookup[0] === 'level') {
      lookupText = fill(t.rules.level, { level: lookup[1] });
      rule = 'level';
      compose = 'faq';
    }
    if (intent === 'quiz' || intent === 'answer') {
      rule = 'quiz';
      compose = 'quiz';
    }

    const list = [
      fill(t.step_lang, { v: langName }),
      fill(t.step_intent, { v: t.intents[intent] || intent }),
      fill(t.step_lookup, { v: lookupText }),
      fill(t.step_rule, { v: t.rules[rule] || t.rules.other }),
      fill(t.step_compose, { v: t.composes[compose] || t.composes.other }),
    ];
    const html = "<details class='thought'><summary>" + esc(t.title) +
      '</summary><ol>' + list.map((s) => '<li>' + esc(s) + '</li>').join('') +
      "</ol><p class='thought-note'>" + esc(t.note) + '</p></details>';
    return { html: html, list: list };
  }

  function buildThought(steps, lang) {
    return thoughtData(steps, lang).html;
  }

  /* =======================================================================
     五、介面
     ======================================================================= */
  const params = new URLSearchParams(location.search);
  const uiLang = ['hk', 'cn', 'en'].indexOf(params.get('lang')) >= 0
    ? params.get('lang') : 'hk';
  const ui = D.ui_text[uiLang] || D.ui_text.hk;

  const log = document.getElementById('log');
  const chips = document.getElementById('chips');
  const input = document.getElementById('input');
  const form = document.getElementById('composer');
  const btnSend = document.getElementById('btnSend');

  // 給瀏覽器測試／除錯用：主控台可以直接呼叫 XKEngine.reply(...)
  window.XKEngine = {
    reply: reply, lookupItem: lookupItem, binAnswer: binAnswer,
    kbFaqAnswer: kbFaqAnswer, ratio: ratio, detectLang: detectLang,
    thoughtData: thoughtData, buildThought: buildThought,
    quizPool: QUIZ_POOL, lang: uiLang, data: D,
  };

  let history = [];
  let busy = false;

  document.getElementById('xkSub').textContent = ui.sub;
  // 頂部只留「小科」，全名太長；外層面板已經寫了「小科 · 地球老師」
  document.getElementById('xkName').textContent = ui.name.split('·')[0].trim();
  document.getElementById('xkTag').textContent =
    ({ hk: '離線版', cn: '离线版', en: 'Offline' })[uiLang] || '離線版';
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
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>' +
                       '<span class="typing-label"></span>';
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

    // 語言跟隨「這次輸入」，不是跟隨 UI
    const replyLang = detectLang(text, uiLang);
    document.body.dataset.replyLang = replyLang;

    addRow('user', text);
    history.push({ role: 'user', content: text });
    input.value = '';
    autoGrow();
    setBusy(true);

    const typing = addTyping();
    const steps = [];
    const answer = reply(text, history.slice(0, -1), replyLang, steps);
    const thought = thoughtData(steps, replyLang);
    const TT = (D.thought_text || {})[replyLang] || {};
    const label = typing.querySelector('.typing-label');
    if (label) label.textContent = TT.thinking || '';

    // 「思考中」只顯示一句，不再把五步逐條亮出來——思考過程要學生自己點開才看到
    const wait = 360 + Math.min(520, answer.length * 6);
    setTimeout(() => {
      typing.remove();
      addRow('bot', (thought.html ? thought.html + '\n\n' : '') + answer);
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
    lastQuiz = null;
    const opening = D.openings[uiLang] || D.openings.hk;
    addRow('bot', opening);
    history.push({ role: 'assistant', content: opening });
    renderChips();
    input.focus();
  });

  /* 開場：小科先打招呼（與 Python 版一致，進來就有話說） */
  const opening = D.openings[uiLang] || D.openings.hk;
  addRow('bot', opening);
  history.push({ role: 'assistant', content: opening });
  renderChips();
  autoGrow();
  if (window.matchMedia('(min-width: 700px)').matches) input.focus();
})();
