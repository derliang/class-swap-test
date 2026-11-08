// 包 19 煙霧測試：資料夾存取（showDirectoryPicker）、授權是否持久、createWritable 寫入原子性。
// 不需打包，直接由 poc/web/smoke-server.ts 經 http://localhost 提供；結果 POST 回本機伺服器存成 poc/web/results/smoke-*.json。
// 為了不把使用者的資料夾名稱寫進 repo，結果只記按了哪個按鈕，不記資料夾名稱與路徑。
// 「關掉再開」時用 IndexedDB 取回上次的資料夾，只是為了記錄實測看到的授權行為（不是正式設計）。

const SUB = '調課小幫手煙霧測試';
const LOCS = { local: '本機資料夾', other: '另一個資料夾', plain: '最簡版選資料夾' };
const CMPS = { open: '開檔視窗', save: '存檔視窗', input: '舊式選資料夾' };
const FAST_MS = 500; // 比這更快就失敗：視窗應該根本沒出現（人不可能這麼快按取消）
const $ = (id) => document.getElementById(id);
const events = [];
const err = (e) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

// ---- IndexedDB：存資料夾 handle 與每個位置的狀態
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('smoke', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function put(k, v) {
  const d = await db();
  await new Promise((res, rej) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function get(k) {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction('kv').objectStore('kv').get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// ---- 共用
const visit = Number(localStorage.getItem('smoke-visit') ?? '0') + 1;
localStorage.setItem('smoke-visit', String(visit));
let browser = navigator.userAgent;
async function names(dir) {
  const out = [];
  for await (const [n] of dir.entries()) out.push(n);
  return out;
}
async function read(dir, name) {
  return (await (await dir.getFileHandle(name)).getFile()).text();
}
async function write(dir, name, text) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}
function record(ev) {
  ev.at = new Date().toISOString();
  ev.visit = visit;
  events.push(ev);
  $('log').textContent = JSON.stringify(events, null, 1);
  // 同一個瀏覽器設定檔、同一個網址開的分頁都讀得到，部署在 https 上時 Claude 用這份讀結果
  try {
    localStorage.setItem(`smoke-log-${visit}`, JSON.stringify({ browser, selftest: !!window.__selftest, events }));
  } catch {}
  void send();
}
const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
async function send() {
  if (!LOCAL) {
    $('sent').textContent = `結果已存在這個瀏覽器裡（第 ${visit} 次開啟，${events.length} 筆），不會上傳。`;
    return;
  }
  try {
    const r = await fetch('/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ browser, visit, events, selftest: !!window.__selftest }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    $('sent').textContent = `已把結果送回測試伺服器（第 ${visit} 次開啟，${events.length} 筆）。`;
  } catch (e) {
    $('sent').textContent = `結果沒送出：${err(e)}`;
  }
}
const show = (loc, ok, text, note = '') => {
  $(`st-${loc}`).innerHTML = `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✔' : '✘'} ${text}</span>${note ? `<span class="note">${note}</span>` : ''}`;
};

// ---- 診斷：點擊當下與失敗當下的狀態（只記瀏覽器拿得到的資訊）
const ENV = {
  secureContext: window.isSecureContext,
  inIframe: window.top !== window.self,
  webdriver: navigator.webdriver,
  screen: `${screen.width}x${screen.height}，縮放 ${devicePixelRatio}，色彩 ${screen.colorDepth} 位元`,
  window: `${innerWidth}x${innerHeight}`,
  touchPoints: navigator.maxTouchPoints,
  cpu: navigator.hardwareConcurrency,
  hasDirectoryPicker: !!window.showDirectoryPicker,
  hasOpenFilePicker: !!window.showOpenFilePicker,
  hasSaveFilePicker: !!window.showSaveFilePicker,
};
function snap() {
  const ua = navigator.userActivation;
  return { userActivationActive: ua?.isActive, userActivationEver: ua?.hasBeenActive, hasFocus: document.hasFocus(), visibility: document.visibilityState };
}
// 選取視窗開著的期間，記錄頁面何時失焦、何時被判定看不見（Chrome 視窗被整個蓋住或縮小時會變 hidden）
function begin() {
  const t0 = performance.now();
  const timeline = [];
  const on = (e) => timeline.push({ t: Math.round(performance.now() - t0), type: e.type, visibility: document.visibilityState });
  for (const t of ['blur', 'focus']) window.addEventListener(t, on);
  document.addEventListener('visibilitychange', on);
  const stop = () => {
    for (const t of ['blur', 'focus']) window.removeEventListener(t, on);
    document.removeEventListener('visibilitychange', on);
  };
  return { t0, atClick: snap(), timeline, stop };
}
function finish(ev, b) {
  ev.ms = Math.round(performance.now() - b.t0);
  ev.atClick = b.atClick;
  ev.atEnd = snap();
  b.stop();
  ev.timeline = b.timeline;
  const hidden = b.timeline.find((x) => x.type === 'visibilitychange' && x.visibility === 'hidden');
  if (hidden) ev.hiddenAtMs = hidden.t;
}
// 白話時間線：選取視窗開著期間頁面發生了什麼（不含資料夾名稱或路徑）
const TL = { blur: '頁面失去焦點（選取視窗打開）', focus: '頁面拿回焦點（選取視窗關閉）', visible: '頁面變回看得見', hidden: '頁面被判定看不見' };
function timelineText(ev) {
  const steps = (ev.timeline ?? []).map((x) => `${(x.t / 1000).toFixed(1)} 秒 ${x.type === 'visibilitychange' ? TL[x.visibility] : TL[x.type]}`);
  steps.push(`${(ev.ms / 1000).toFixed(1)} 秒 Chrome 回報 ${ev.errorName ?? '成功'}${ev.error ? `（${ev.error.replace(/^[A-Za-z]+Error: /, '')}）` : ''}`);
  return `經過：${steps.join(' → ')}。`;
}
const yn = (v) => (v === undefined ? '不明' : v ? '是' : '否');
function envText() {
  return `環境：安全來源 ${yn(ENV.secureContext)}；在 iframe 裡 ${yn(ENV.inIframe)}；被自動化控制（webdriver）${yn(ENV.webdriver)}；螢幕 ${ENV.screen}。瀏覽器沒辦法直接判斷是否在遠端桌面裡。`;
}
function clickText(ev) {
  const a = ev.atClick ?? {};
  return `按下時：頁面有焦點 ${yn(a.hasFocus)}，有使用者點擊授權 ${yn(a.userActivationActive)}。`;
}

// 依毫秒數與錯誤名稱判讀，給白話說明與下一步
function explain(ev, what) {
  const sec = (ev.ms / 1000).toFixed(1);
  const next = what.includes('資料夾視窗') ? '下一步：按下面的對照按鈕；若開檔視窗也一樣秒失敗，就是整個原生選取視窗被擋。' : '';
  if (ev.errorName === 'AbortError' && ev.hiddenAtMs !== undefined && ev.hiddenAtMs <= ev.ms) return `${what}打開後第 ${(ev.hiddenAtMs / 1000).toFixed(1)} 秒，這個頁面被判定為「看不見」，接著 Chrome 就自動取消了選取（不是你按的取消）。最常見的原因是${what}是最大化的，把整個 Chrome 視窗蓋住。下一步：${what}出現時，先按它右上角的「向下還原」把它縮小（或按 Win＋↓），再選資料夾；Windows 會記住縮小後的大小，之後就不會再發生。`;
  if (ev.noDialog) return `按下 ${sec} 秒後頁面仍有焦點、也沒有任何回應，${what}應該根本沒出現（被瀏覽器或掛在上面的工具擋掉）。`;
  if (ev.errorName === 'AbortError' && ev.ms < FAST_MS) return `只過了 ${ev.ms} 毫秒就被取消，${what}應該根本沒出現：是瀏覽器或掛在瀏覽器上的工具（例如自動化或遠端操控的擴充功能）直接取消。${next}`;
  if (ev.errorName === 'AbortError') return `按下後 ${sec} 秒 Chrome 回報取消（這個時間是實測的，頁面本身沒有任何逾時）。可能是：按了取消；選到 Chrome 封鎖的資料夾（例如「下載」「文件」「桌面」本身或系統資料夾）；在「允許編輯」時沒按允許；或選好後被 Chrome 擋下。請看下面的「經過」。`;
  if (ev.errorName === 'SecurityError') return `瀏覽器不讓這頁開${what}（${ev.ms} 毫秒）：通常是按下時沒有使用者點擊授權，或頁面不在安全來源。`;
  if (ev.errorName === 'NotAllowedError') return `瀏覽器拒絕授權（${ev.ms} 毫秒）：可能被設定或權限擋掉。`;
  return `失敗：${ev.error}（${ev.ms} 毫秒）。`;
}

// ---- 綜合判讀（各按鈕最近一次的結果）
const latest = {};
function note(key, ev) {
  latest[key] = { ok: !ev.errorName, fast: !!ev.errorName && (ev.ms < FAST_MS || !!ev.noDialog), hidden: !!ev.errorName && ev.hiddenAtMs !== undefined, ms: ev.ms, name: ev.errorName };
  const dirs = ['local', 'other', 'plain'].map((k) => latest[k]).filter(Boolean);
  const files = ['open', 'save'].map((k) => latest[k]).filter(Boolean);
  const lines = [];
  if (Object.values(latest).some((r) => r.hidden)) lines.push('有選取視窗是在這個頁面被判定「看不見」之後才被取消：通常是選取視窗最大化、把 Chrome 整個蓋住，Chrome 就自動取消。請在選取視窗出現時先把它縮小（向下還原或 Win＋↓）再選。');
  if (dirs.some((r) => r.ok)) lines.push('選資料夾可以用。');
  else if (dirs.length) {
    const fast = dirs.every((r) => r.fast);
    lines.push(fast ? '選資料夾每次都在半秒內被取消，視窗沒有出現。' : '選資料夾失敗，但視窗有出現過（不是被直接擋掉）。');
    if (!files.length) lines.push('還沒按開檔／存檔對照按鈕，無法分辨是不是整個原生選取視窗都被擋。');
    else if (files.every((r) => !r.ok && r.fast) && fast) lines.push('開檔／存檔視窗也一樣秒失敗：是整個原生選取視窗都被擋（瀏覽器或掛在上面的工具），不是資料夾本身的問題。');
    else if (files.some((r) => r.ok)) lines.push('開檔／存檔視窗可以用：只有選資料夾被擋，或選到瀏覽器封鎖的資料夾。');
    else lines.push('開檔／存檔視窗也失敗，但不是秒失敗：視窗有出現，請看各按鈕旁的說明。');
    if (latest.input) lines.push(latest.input.ok ? '舊式選資料夾（input）可以用：新式 API 被擋，舊式沒有。' : '舊式選資料夾（input）也沒選成。');
  }
  $('verdict').textContent = lines.join('');
}

// ---- 選資料夾後的測試
const openWriters = []; // 刻意不關閉的寫入（模擬「寫到一半分頁被關掉」）
async function pickAndTest(loc) {
  const ev = { step: 'pick', loc, label: LOCS[loc] };
  const b = begin();
  let dir;
  try {
    dir = loc === 'plain' ? await window.showDirectoryPicker() : await window.showDirectoryPicker({ id: `smoke-${loc}`, mode: 'readwrite' });
    finish(ev, b);
  } catch (e) {
    finish(ev, b);
    ev.error = err(e);
    ev.errorName = e?.name;
    record(ev);
    note(loc, ev);
    show(loc, false, e?.name === 'AbortError' ? '沒有選成' : ev.error, `${explain(ev, '選資料夾視窗')} ${timelineText(ev)} ${clickText(ev)}`);
    return;
  }
  note(loc, ev);
  ev.permissionAfterPick = await dir.queryPermission({ mode: 'readwrite' });
  if (ev.permissionAfterPick !== 'granted') {
    ev.requestResult = await dir.requestPermission({ mode: 'readwrite' }).catch((e) => err(e));
    if (ev.requestResult !== 'granted') {
      record(ev);
      show(loc, false, `選到資料夾了（${ev.ms} 毫秒），但沒有寫入授權（${ev.requestResult}）`);
      return;
    }
  }
  try {
    const sub = await dir.getDirectoryHandle(SUB, { create: true });
    // 1. 讀寫
    const payload = JSON.stringify({ 測試: '網頁版煙霧測試', 時間: new Date().toISOString(), 中文: '課節互調' });
    await write(sub, '讀寫測試.json', payload);
    ev.writeRead = (await read(sub, '讀寫測試.json')) === payload;
    // 2. 原子性：整檔取代、寫到一半放棄
    await write(sub, '原子測試.txt', 'v1-完整的舊版');
    let w = await (await sub.getFileHandle('原子測試.txt')).createWritable();
    await w.write('v2-寫到一半');
    ev.duringWrite = { content: await read(sub, '原子測試.txt'), files: await names(sub) };
    await w.abort();
    ev.afterAbort = { content: await read(sub, '原子測試.txt'), files: await names(sub) };
    w = await (await sub.getFileHandle('原子測試.txt')).createWritable();
    await w.write('v2-完整的新版');
    await w.close();
    ev.afterClose = { content: await read(sub, '原子測試.txt'), files: await names(sub) };
    // 3. 寫到一半不關閉：留到使用者關掉分頁，下次開啟時檢查原檔
    await write(sub, '中斷測試.txt', 'v1-完整的舊版');
    const w2 = await (await sub.getFileHandle('中斷測試.txt')).createWritable();
    await w2.write('v2-寫到一半，分頁就被關掉');
    openWriters.push(w2);
    ev.midWriteFiles = await names(sub);
    ev.atomicOk = ev.duringWrite.content === 'v1-完整的舊版' && ev.afterAbort.content === 'v1-完整的舊版' && ev.afterClose.content === 'v2-完整的新版';
    await put(`h-${loc}`, dir);
    await put(`s-${loc}`, { pickedVisit: visit, midWrite: true });
    show(loc, ev.writeRead && ev.atomicOk, ev.writeRead && ev.atomicOk ? '可以讀寫，寫到一半放棄時原檔完整' : '有項目不通過（看詳細結果）');
  } catch (e) {
    ev.error = err(e);
    show(loc, false, ev.error);
  }
  record(ev);
}

// ---- 對照按鈕：只看視窗開不開得起來，不讀內容、不留檔案
async function compare(kind) {
  const ev = { step: 'compare', kind, label: CMPS[kind] };
  const b = begin();
  const fail = (e) => {
    finish(ev, b);
    ev.error = err(e);
    ev.errorName = e?.name;
    show(kind, false, e?.name === 'AbortError' ? '沒有選成' : ev.error, `${explain(ev, `${CMPS[kind]}`)} ${timelineText(ev)} ${clickText(ev)}`);
  };
  try {
    if (kind === 'open') {
      const hs = await window.showOpenFilePicker();
      finish(ev, b);
      ev.count = hs.length;
      show(kind, true, `視窗可以開，選了 ${hs.length} 個檔（${ev.ms} 毫秒，沒有讀內容）`);
    } else if (kind === 'save') {
      const h = await window.showSaveFilePicker({ suggestedName: '調課小幫手測試-可刪.txt' });
      finish(ev, b);
      // Chrome 選好位置時可能先建空檔；能刪就刪掉，不留檔案
      ev.removed = await (h.remove ? h.remove().then(() => true, (e) => err(e)) : Promise.resolve('瀏覽器不支援 remove'));
      show(kind, true, `視窗可以開（${ev.ms} 毫秒）${ev.removed === true ? '，沒有留下檔案' : `；若有留下「調課小幫手測試-可刪.txt」可直接刪掉`}`);
    } else {
      const input = $('dirInput');
      input.value = '';
      const r = await new Promise((res) => {
        input.onchange = () => res({ ok: true, count: input.files.length });
        input.oncancel = () => res({ ok: false });
        input.click();
        // 原生視窗打開時頁面會失去焦點；1.5 秒後仍有焦點又沒回應，就當作視窗沒出現
        setTimeout(() => document.hasFocus() && res({ ok: false, noDialog: true }), 1500);
      });
      finish(ev, b);
      if (r.noDialog) ev.noDialog = true;
      if (r.ok) {
        ev.count = r.count;
        show(kind, true, `可以選資料夾（${ev.ms} 毫秒，裡面 ${r.count} 個檔，只數數量）`);
        input.value = '';
      } else fail(Object.assign(new Error('取消了選取'), { name: 'AbortError' }));
    }
  } catch (e) {
    fail(e);
  }
  note(kind, ev);
  record(ev);
}

// ---- 重新開啟：授權還在嗎？上次寫到一半的檔案完整嗎？
async function checkStored(request) {
  for (const loc of Object.keys(LOCS)) {
    const dir = await get(`h-${loc}`);
    if (!dir) continue;
    const state = (await get(`s-${loc}`)) ?? {};
    const ev = { step: request ? 'requestAgain' : 'reopen', loc, label: LOCS[loc], pickedVisit: state.pickedVisit };
    try {
      ev.queryReadwrite = await dir.queryPermission({ mode: 'readwrite' });
      ev.queryRead = await dir.queryPermission({ mode: 'read' });
      if (request && ev.queryReadwrite !== 'granted') ev.requestResult = await dir.requestPermission({ mode: 'readwrite' });
      const granted = ev.queryReadwrite === 'granted' || ev.requestResult === 'granted';
      if (granted) {
        const sub = await dir.getDirectoryHandle(SUB, { create: true });
        const files = await names(sub);
        ev.files = files;
        if (state.midWrite && files.includes('中斷測試.txt')) {
          ev.midWriteContent = await read(sub, '中斷測試.txt');
          ev.midWriteIntact = ev.midWriteContent === 'v1-完整的舊版';
          ev.leftoverSwap = files.filter((n) => n.endsWith('.crswap'));
          await put(`s-${loc}`, { ...state, midWrite: false, midWriteChecked: visit });
        }
        // 檢查完就把測試子資料夾刪掉（handle 仍保留，下次開啟還能看授權）
        if (!state.midWrite || ev.midWriteContent !== undefined) {
          await dir.removeEntry(SUB, { recursive: true }).catch((e) => (ev.cleanupError = err(e)));
        }
      }
      show(loc, granted, granted ? `授權還在（${ev.queryReadwrite === 'granted' ? '開啟時就有，不用再按' : '按「再次允許」後'}）${ev.midWriteIntact === undefined ? '' : ev.midWriteIntact ? '；中斷的寫入沒有弄壞原檔' : '；中斷的寫入弄壞了原檔！'}` : `授權已失效（${ev.queryReadwrite}），請按「再次允許」`);
    } catch (e) {
      ev.error = err(e);
      show(loc, false, ev.error);
    }
    record(ev);
  }
}

// ---- 開始
(async () => {
  try {
    const d = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList', 'platformVersion']);
    if (d) browser = d.fullVersionList.map((b) => `${b.brand} ${b.version}`).filter((s) => !/Not.A.Brand/i.test(s)).join('、') + `；Windows ${d.platformVersion}`;
  } catch {}
  $('ua').textContent = browser;
  $('env').textContent = envText();
  for (const b of document.querySelectorAll('button[data-cmp]')) b.addEventListener('click', () => void compare(b.dataset.cmp));
  if (!window.showDirectoryPicker) {
    record({ step: 'support', error: '沒有 showDirectoryPicker', env: ENV });
    return;
  }
  record({ step: 'open', persisted: await navigator.storage.persisted?.(), env: ENV, atOpen: snap() });
  for (const b of document.querySelectorAll('button[data-loc]')) b.addEventListener('click', () => void pickAndTest(b.dataset.loc));
  $('again').addEventListener('click', () => void checkStored(true));
  await checkStored(false);
})();
