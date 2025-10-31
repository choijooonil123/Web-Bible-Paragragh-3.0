/* --------- Utils --------- */
const AI_ENDPOINT = 'http://localhost:5174/api/unit-context';
const el = id => document.getElementById(id);
const treeEl = el('tree'), statusEl = el('status');
function status(msg){ if(statusEl) statusEl.textContent = msg; }
function escapeHtml(s){ return (s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function stripBlankLines(s){return String(s||'').split(/\r?\n/).filter(l=>l.trim()!=='').join('\n');}

function syncCurrentFromOpen(){
  const openPara = treeEl.querySelector('details.para[open]');
  if(!openPara) return false;
  const t = openPara.querySelector('summary .ptitle');
  if(!t) return false;
  const book = t.dataset.book;
  const chap = parseInt(t.dataset.ch, 10);
  const idx  = parseInt(t.dataset.idx, 10);
  const para = BIBLE?.books?.[book]?.[chap]?.paras?.[idx];
  if(!para) return false;
  CURRENT.book   = book;
  CURRENT.chap   = chap;
  CURRENT.paraIdx= idx;
  CURRENT.paraId = `${book}|${chap}|${para.ref}`;
  return true;
}

// 제목 변경 반영
function updateParaTitle(book, chap, idx, newTitle){
  try{
    const para = BIBLE?.books?.[book]?.[chap]?.paras?.[idx];
    if(!para) return;
    para.title = newTitle;
    const s = document.querySelector(
      `summary .ptitle[data-book="${CSS.escape(String(book))}"][data-ch="${CSS.escape(String(chap))}"][data-idx="${CSS.escape(String(idx))}"]`
    );
    if(s) s.textContent = newTitle;
  }catch(_){}
}

// JSON 다운로드
function downloadBibleJSON(){
  if(!BIBLE){ alert('BIBLE 데이터가 없습니다.'); return; }
  const blob = new Blob([JSON.stringify(BIBLE, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bible-paragraphs.json';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  status('수정된 JSON을 다운로드했습니다.');
}

/* ==== 전체 데이터 백업/복원 ==== */
const STORAGE_SERMON      = 'wbps.sermons.v4';
const STORAGE_UNIT_CTX    = 'wbps.ctx.unit.v1';
const STORAGE_WHOLE_CTX   = 'wbps.ctx.whole.v1';
const STORAGE_COMMENTARY  = 'wbps.ctx.comm.v1';
const STORAGE_SUMMARY     = 'wbps.ctx.summary.v1';
const VOICE_CHOICE_KEY    = 'wbps.tts.choice.v2';

function todayStr(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function exportAllData(){
  const keys = [STORAGE_SERMON, STORAGE_UNIT_CTX, STORAGE_WHOLE_CTX, STORAGE_COMMENTARY, STORAGE_SUMMARY, VOICE_CHOICE_KEY];
  const payload = { __wbps:1, date: todayStr(), items:{} };
  keys.forEach(k=> payload.items[k] = localStorage.getItem(k) ?? null);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  const ts = new Date();
  const tss = `${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}-${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `wbps-backup-${tss}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  status('전체 데이터를 내보냈습니다.');
}
async function importAllData(file){
  try{
    const text = await file.text();
    const json = JSON.parse(text);
    if(!json || json.__wbps!==1 || !json.items){ alert('백업 파일 형식이 아닙니다.'); return; }
    if(!confirm('이 백업으로 현재 기기의 데이터를 덮어쓸까요?')) return;
    Object.entries(json.items).forEach(([k,v])=>{
      if(v===null || v===undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    });
    status('가져오기가 완료되었습니다. 페이지를 새로고침하면 반영됩니다.');
  }catch(e){
    console.error(e);
    alert('가져오기 중 오류가 발생했습니다.');
  }
}

/* --------- Refs / State --------- */
const voiceSelect = el('voiceSelect'), testVoiceBtn = el('testVoice');
const rateCtl = el('rateCtl'), pitchCtl = el('pitchCtl'), voiceHint = el('voiceHint');
const modalWrap = el('modalWrap'), modalRef = el('modalRef');
const sermonList = el('sermonList'), sermonEditor = el('sermonEditor');
const sermonTitle = el('sermonTitle'), sermonBody = el('sermonBody');

const editorSpeakBtn = el('editorSpeak');
const modalFooterNew = el('modalFooterNew');

let BIBLE = null;
let CURRENT = { book:null, chap:null, paraIdx:null, paraId:null };
let READER = { playing:false, q:[], idx:0, synth:window.speechSynthesis||null, scope:null, btn:null, continuous:false };
let EDITOR_READER = { playing:false, u:null, synth:window.speechSynthesis||null };

/* --------- Boot --------- */
(async function boot(){
  try{
    BIBLE = await tryFetchJSON('bible-paragraph.json');
  }catch(_){
    try{ BIBLE = await tryFetchJSON('bible_paragraphs.json'); }
    catch(e){ status('bible-paragraph.json을 찾을 수 없습니다. 같은 폴더에 두고 다시 열어주세요.'); return; }
  }
  buildTree();
  status('불러오기 완료. 66권 트리가 활성화되었습니다.');
  await setupVoices();
})();

(function bindButtons(){
  el('btnSaveJSON')?.addEventListener('click', downloadBibleJSON);
  const btnExport = el('btnExportAll');
  const btnImport = el('btnImportAll');
  const fileInput = el('importFile');
  if (btnExport) btnExport.onclick = exportAllData;
  if (btnImport) btnImport.onclick = ()=> fileInput && fileInput.click();
  if (fileInput) fileInput.addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    importAllData(f).finally(()=>{ e.target.value=''; });
  });
})();

async function tryFetchJSON(path){ const res = await fetch(path, {cache:'no-store'}); if(!res.ok) throw 0; return await res.json(); }

/* --------- Voice --------- */
function waitForVoices(timeout=1500){
  return new Promise(resolve=>{
    const have = speechSynthesis.getVoices?.();
    if (have && have.length) return resolve(have);
    const t = setTimeout(()=> resolve(speechSynthesis.getVoices?.()||[]), timeout);
    speechSynthesis.onvoiceschanged = ()=>{ clearTimeout(t); resolve(speechSynthesis.getVoices?.()||[]); };
  });
}
function getKoreanVoices(all){
  return (all||[]).filter(v=>{
    const n=(v.name||'').toLowerCase(), l=(v.lang||'').toLowerCase();
    return l.startsWith('ko') || n.includes('korean') || n.includes('한국') || n.includes('korea');
  });
}
function presetsForSingleVoice(){
  return [
    {id:'preset-soft-low',  label:'프리셋 · 저음/느림',   rate:0.85, pitch:0.85},
    {id:'preset-soft-high', label:'프리셋 · 고음/느림',   rate:0.90, pitch:1.20},
    {id:'preset-fast',      label:'프리셋 · 빠름',       rate:1.20, pitch:1.05},
    {id:'preset-bright',    label:'프리셋 · 밝게',       rate:1.05, pitch:1.25},
    {id:'preset-radio',     label:'프리셋 · 라디오톤',   rate:1.00, pitch:0.90},
    {id:'preset-reading',   label:'프리셋 · 낭독체',     rate:0.95, pitch:1.00},
  ];
}
async function setupVoices(){
  const all = await waitForVoices();
  const kos = getKoreanVoices(all);

  voiceSelect.innerHTML = '';
  const def = document.createElement('option');
  def.value = JSON.stringify({type:'default'});
  def.textContent = '브라우저 기본(ko-KR)';
  voiceSelect.appendChild(def);

  if(kos.length > 0){
    const og = document.createElement('optgroup'); og.label = '한국어 보이스';
    kos.forEach(v=>{
      const opt = document.createElement('option');
      opt.value = JSON.stringify({type:'voice', uri:v.voiceURI});
      opt.textContent = `${v.name} — ${v.lang}${v.localService ? ' (로컬)' : ''}`;
      og.appendChild(opt);
    });
    voiceSelect.appendChild(og);
  }
  if(kos.length <= 1){
    const pg = document.createElement('optgroup'); pg.label = '스타일 프리셋';
    presetsForSingleVoice().forEach(p=>{
      const opt = document.createElement('option');
      opt.value = JSON.stringify({type:'preset', rate:p.rate, pitch:p.pitch});
      opt.textContent = p.label;
      pg.appendChild(opt);
    });
    voiceHint.style.display = '';
  } else {
    voiceHint.style.display = 'none';
  }

  const saved = localStorage.getItem(VOICE_CHOICE_KEY);
  if(saved){
    const idx = [...voiceSelect.options].findIndex(o=>o.value===saved);
    if(idx>=0) voiceSelect.selectedIndex = idx;
  } else {
    localStorage.setItem(VOICE_CHOICE_KEY, voiceSelect.value);
  }
  voiceSelect.addEventListener('change', ()=> localStorage.setItem(VOICE_CHOICE_KEY, voiceSelect.value));
  testVoiceBtn.onclick = ()=> speakSample('태초에 하나님이 천지를 창조하시니라.');
}
function resolveVoiceChoice(){
  try{ return JSON.parse(localStorage.getItem(VOICE_CHOICE_KEY)||'{"type":"default"}'); }
  catch{ return {type:'default'}; }
}
function pickVoiceByURI(uri){ return (speechSynthesis.getVoices?.()||[]).find(v=>v.voiceURI===uri) || null; }
function applyVoice(u){
  const choice = resolveVoiceChoice();
  const baseRate = parseFloat(rateCtl.value||'0.95');
  const basePitch = parseFloat(pitchCtl.value||'1');
  if(choice.type==='voice'){
    const v = pickVoiceByURI(choice.uri);
    if(v){ u.voice = v; u.lang = v.lang; } else { u.lang = 'ko-KR'; }
    u.rate = baseRate; u.pitch = basePitch;
  } else if(choice.type==='preset'){
    u.lang = 'ko-KR';
    u.rate = clamp((choice.rate ?? 0.95) * baseRate / 0.95, 0.5, 2);
    u.pitch = clamp((choice.pitch ?? 1.0) * basePitch / 1.0, 0, 2);
  } else {
    u.lang = 'ko-KR'; u.rate = baseRate; u.pitch = basePitch;
  }
}
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
function speakSample(text){
  const synth = window.speechSynthesis;
  try{ synth.cancel(); }catch(e){}
  const u = new SpeechSynthesisUtterance(text);
  applyVoice(u);
  synth.speak(u);
}

/* --------- Tree --------- */
function buildTree(){
  treeEl.innerHTML = '';
  if(!BIBLE){ treeEl.innerHTML = '<div class="muted">파일을 찾을 수 없습니다.</div>'; return; }

  for(const bookName of Object.keys(BIBLE.books)){
    const detBook = document.createElement('details');
    const sumBook = document.createElement('summary');
    sumBook.innerHTML = `<span class="tw">${escapeHtml(bookName)}</span>`;
    detBook.appendChild(sumBook);

    const chWrap = document.createElement('div'); chWrap.className='chapters';
    const chapters = Object.keys(BIBLE.books[bookName]).map(n=>parseInt(n,10)).sort((a,b)=>a-b);

    for(const chap of chapters){
      const detChap = document.createElement('details');
      const sumChap = document.createElement('summary');
      sumChap.innerHTML = `<span class="chip">${chap}장</span>`;
      detChap.appendChild(sumChap);

      const parWrap = document.createElement('div'); parWrap.className='paras';
      const paras = BIBLE.books[bookName][chap].paras || [];
      paras.forEach((p, idx)=>{
        const detPara = document.createElement('details'); detPara.className='para';

        const m = String(p.ref||'').match(/^(\d+):(\d+)(?:-(\d+))?$/);
        const v1 = m ? m[2] : '?', v2 = m ? (m[3]||m[2]) : '?';
        const titleText = p.title || p.ref;

        const sum = document.createElement('summary');
        sum.innerHTML = `
          <span class="vrange">(${v1}-${v2})</span>
          <span class="ptitle"
                data-book="${bookName}"
                data-ch="${chap}"
                data-idx="${idx}"
                title="제목을 더블클릭하면 편집할 수 있습니다">${escapeHtml(titleText)}</span>
        `;

        const titleEl = sum.querySelector('.ptitle');

        titleEl.addEventListener('dblclick', (e)=>{
          e.preventDefault(); e.stopPropagation();
          detPara.open = true;
          startInlineTitleEdit(titleEl, bookName, chap, idx);
        }, true);

        function guardSummary(ev){
          const isEditing = titleEl.isContentEditable;
          const dblOnTitle = (ev.type === 'dblclick' && ev.target === titleEl);
          if (isEditing || dblOnTitle){
            ev.preventDefault();
            ev.stopPropagation();
          }
        }
        ['pointerdown','mousedown','click','dblclick'].forEach(type=>{
          sum.addEventListener(type, guardSummary, true);
        });

        detPara.appendChild(sum);

        const body = document.createElement('div');
        body.className = 'pbody';
        body.innerHTML = `
          <div class="ptoolbar">
            <button class="primary speakBtn">낭독</button>
            <label class="chip"><input type="checkbox" class="keepReading" style="margin-right:6px">계속 낭독</label>
            <button class="ctxBtn btnSummary">내용흐름</button>
            <button class="ctxBtn btnUnitCtx">단위성경속 맥락</button>
            <button class="ctxBtn btnWholeCtx">전체성경속 맥락</button>
            <button class="ctxBtn btnCommentary">주석</button>
            <div class="spacer"></div>
            <button class="sermBtn">설교</button>
          </div>
          <div class="pcontent"></div>`;
        detPara.appendChild(body);

        const pcontent = body.querySelector('.pcontent');
        (p.verses||[]).forEach(([v,t])=>{
          const line = document.createElement('div');
          line.className = 'pline';
          line.dataset.verse = v;
          line.innerHTML = `<sup class="pv">${v}</sup>${t}`;
          pcontent.appendChild(line);
        });

        detPara.addEventListener('toggle', ()=>{
          if(detPara.open){
            CURRENT.book = bookName; CURRENT.chap = chap; CURRENT.paraIdx = idx;
            const para = BIBLE.books[bookName][chap].paras[idx];
            CURRENT.paraId = `${bookName}|${chap}|${para.ref}`;
            status(`선택됨: ${bookName} ${chap}장 · ${para.title||para.ref}`);
          }
        });

        body.querySelector('.speakBtn').addEventListener('click', ()=>{
          toggleSpeakInline(bookName, chap, idx, detPara, body.querySelector('.speakBtn'));
        });
        body.querySelector('.sermBtn').addEventListener('click', ()=>{
          CURRENT.book = bookName; CURRENT.chap = chap; CURRENT.paraIdx = idx;
          const para = BIBLE.books[bookName][chap].paras[idx];
          CURRENT.paraId = `${bookName}|${chap}|${para.ref}`;
          openSermonModal();
        });
        body.querySelector('.btnUnitCtx').addEventListener('click', ()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('unit'); });
        body.querySelector('.btnWholeCtx').addEventListener('click',()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('whole'); });
        body.querySelector('.btnCommentary').addEventListener('click',()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('commentary'); });
        body.querySelector('.btnSummary').addEventListener('click',   ()=>{ CURRENT.book=bookName; CURRENT.chap=chap; CURRENT.paraIdx=idx; openSingleDocEditor('summary'); });

        parWrap.appendChild(detPara);
      });

      detChap.appendChild(parWrap);
      chWrap.appendChild(detChap);
    }

    detBook.appendChild(chWrap);
    treeEl.appendChild(detBook);
  }
}

/* 🔧 트리 위임 클릭 공용 처리 */
treeEl.addEventListener('click', (e)=>{
  const isCtxBtn = e.target.closest('.btnSummary, .btnUnitCtx, .btnWholeCtx, .btnCommentary, .sermBtn');
  if (!isCtxBtn) return;

  const paraEl = e.target.closest('details.para');
  const t = paraEl?.querySelector('summary .ptitle');
  if (!paraEl || !t) return;

  CURRENT.book   = t.dataset.book;
  CURRENT.chap   = parseInt(t.dataset.ch, 10);
  CURRENT.paraIdx= parseInt(t.dataset.idx, 10);
  const para = BIBLE?.books?.[CURRENT.book]?.[CURRENT.chap]?.paras?.[CURRENT.paraIdx];
  if (!para) return;
  CURRENT.paraId = `${CURRENT.book}|${CURRENT.chap}|${para.ref}`;

  if (e.target.closest('.btnSummary'))    { openSingleDocEditor('summary');    return; }
  if (e.target.closest('.btnUnitCtx'))    { openSingleDocEditor('unit');       return; }
  if (e.target.closest('.btnWholeCtx'))   { openSingleDocEditor('whole');      return; }
  if (e.target.closest('.btnCommentary')) { openSingleDocEditor('commentary'); return; }
  if (e.target.closest('.sermBtn'))       { openSermonModal();                 return; }
});

/* --------- Inline TTS --------- */
function buildQueueFrom(book, chap, idx){
  const para = BIBLE.books[book][chap].paras[idx];
  return (para.verses||[]).map(([v,t])=>({verse:v, text:t}));
}
function clearReadingHighlight(scope){ [...scope.querySelectorAll('.pline')].forEach(el=> el.classList.remove('reading')); }
function bindKeepReading(scope){
  const cb = scope.querySelector('.keepReading');
  if(!cb) return;
  cb.checked  = READER.continuous;
  cb.disabled = false;
  cb.onchange = ()=>{ READER.continuous = cb.checked; };
}
function speakVerseItemInScope(item, scope, onend){
  if(!READER.synth) return;
  const u = new SpeechSynthesisUtterance(String(item.text));
  applyVoice(u);
  let done = false;
  const safeEnd = ()=>{ if(done) return; done = true; onend(); };
  u.onstart = ()=>{
    clearReadingHighlight(scope);
    const line = scope.querySelector(`.pline[data-verse="${item.verse}"]`);
    if(line){ line.classList.add('reading'); line.scrollIntoView({block:'center', behavior:'smooth'}); }
    if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
    const base = Math.max(800, Math.round(item.text.length * 65));
    const rate = u.rate || 1;
    const estimate = Math.max(600, Math.round(base / rate)) + 1200;
    READER._wd = setTimeout(safeEnd, estimate);
  };
  u.onend   = safeEnd;
  u.onerror = safeEnd;
  READER.synth.speak(u);
}
function toggleSpeakInline(book, chap, idx, paraDetailsEl, btnEl){
  if(!READER.synth) return alert('이 브라우저는 음성합성을 지원하지 않습니다.');
  const sameScope = READER.playing && READER.scope === paraDetailsEl;
  if(READER.playing && sameScope){ stopSpeakInline(); return; }
  READER.continuous = true;
  READER.q = buildQueueFrom(book, chap, idx);
  READER.idx = 0;
  READER.playing = true;
  READER.scope = paraDetailsEl;
  READER.btn = btnEl;
  try{ READER.synth.cancel(); }catch(e){}
  bindKeepReading(READER.scope);
  updateInlineSpeakBtn();
  playNextInQueueInline(book, chap, idx);
}
function playNextInQueueInline(book, chap, idx){
  if(!READER.playing) return;
  if(READER.idx >= READER.q.length){
    if(READER.continuous && goToNextParagraphInline(book, chap, idx)){
      const nextCb = READER.scope?.querySelector?.('.keepReading');
      if(nextCb){ nextCb.checked = READER.continuous; nextCb.disabled = false; }
      READER.q = buildQueueFrom(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      READER.idx = 0;
      bindKeepReading(READER.scope);
      updateInlineSpeakBtn();
      setTimeout(()=>{ try{ READER.synth.cancel(); }catch(e){} playNextInQueueInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx); }, 120);
      return;
    }
    stopSpeakInline();
    return;
  }
  const item = READER.q[READER.idx];
  speakVerseItemInScope(item, READER.scope, ()=>{ READER.idx++; playNextInQueueInline(book, chap, idx); });
}
function stopSpeakInline(){
  READER.playing = false;
  try{ READER.synth && READER.synth.cancel(); }catch(e){}
  if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
  if(READER.scope){
    const cb = READER.scope.querySelector?.('.keepReading');
    if(cb) cb.disabled = false;
    clearReadingHighlight(READER.scope);
  }
  updateInlineSpeakBtn();
  READER.scope = null; READER.btn = null;
}
function updateInlineSpeakBtn(){ if(READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독'; }
function goToNextParagraphInline(book, chap, idx){
  const chObj = BIBLE.books[book][chap];
  const booksEls = [...treeEl.children];

  const bookNames = Object.keys(BIBLE.books);
  const bIdx = bookNames.indexOf(book);
  const bookEl = booksEls[bIdx];
  if(!bookEl) return false;

  const chaptersEls = bookEl.querySelectorAll(':scope > .chapters > details');
  const chapNums = Object.keys(BIBLE.books[book]).map(n=>parseInt(n,10)).sort((a,b)=>a-b);

  const chPos = chapNums.indexOf(chap);
  const chapEl = chaptersEls[chPos];
  if(!chapEl) return false;

  const paraEls = chapEl.querySelectorAll(':scope > .paras > details.para');

  if (READER.btn) READER.btn.textContent = '낭독';

  if (idx < chObj.paras.length - 1){
    const nextEl = paraEls[idx + 1];
    if(nextEl){
      chapEl.open = true;
      nextEl.open = true;
      CURRENT.book = book;
      CURRENT.chap = chap;
      CURRENT.paraIdx = idx + 1;
      READER.scope = nextEl;
      READER.btn = nextEl.querySelector('.speakBtn');
      if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
      return true;
    }
  }

  if (chPos >= 0 && chPos < chapNums.length - 1){
    const nextChap = chapNums[chPos + 1];
    const nextChapEl = chaptersEls[chPos + 1];
    if(nextChapEl){
      const nextParas = (BIBLE.books[book][nextChap].paras || []);
      if(nextParas.length){
        const nextParaEl = nextChapEl.querySelector(':scope > .paras > details.para');
        nextChapEl.open = true;
        if(nextParaEl) nextParaEl.open = true;

        CURRENT.book = book;
        CURRENT.chap = nextChap;
        CURRENT.paraIdx = 0;

        READER.scope = nextParaEl;
        READER.btn = nextParaEl?.querySelector('.speakBtn') || null;
        if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
        return true;
      }
    }
  }

  const bPos = bIdx;
  if (bPos >= 0 && bPos < bookNames.length - 1){
    const nextBook = bookNames[bPos + 1];
    const nextBookEl = booksEls[bPos + 1];
    if(nextBookEl){
      const firstChap = Math.min(...Object.keys(BIBLE.books[nextBook]).map(n=>parseInt(n,10)));
      const nextChapEl = nextBookEl.querySelector(':scope > .chapters > details');
      const nextParaEl = nextChapEl?.querySelector(':scope > .paras > details.para');
      if(nextParaEl){
        nextBookEl.open = true;
        nextChapEl.open = true;
        nextParaEl.open = true;

        CURRENT.book = nextBook;
        CURRENT.chap = firstChap;
        CURRENT.paraIdx = 0;

        READER.scope = nextParaEl;
        READER.btn = nextParaEl.querySelector('.speakBtn');
        if (READER.btn) READER.btn.textContent = READER.playing ? '중지' : '낭독';
        return true;
      }
    }
  }

  return false;
}

/* --------- Sermon / Context Editors --------- */
function getSermonMap(){ try{ return JSON.parse(localStorage.getItem(STORAGE_SERMON)||'{}'); }catch{ return {}; } }
function setSermonMap(o){ localStorage.setItem(STORAGE_SERMON, JSON.stringify(o)); }
function getDocMap(storageKey){ try{ return JSON.parse(localStorage.getItem(storageKey)||'{}'); }catch{ return {}; } }
function setDocMap(storageKey, obj){ localStorage.setItem(storageKey, JSON.stringify(obj)); }

function openSermonModal(){
  // ✅ 현재 열린 단락에서 안전하게 CURRENT 세팅
  if (!CURRENT.book || !Number.isFinite(CURRENT.chap) || !Number.isFinite(CURRENT.paraIdx)) {
    if (!syncCurrentFromOpen()) {
      alert('단락을 먼저 선택해 주세요.');
      return;
    }
  }
  const para = BIBLE?.books?.[CURRENT.book]?.[CURRENT.chap]?.paras?.[CURRENT.paraIdx];
  if (!para) { alert('선택한 단락을 찾을 수 없습니다.'); return; }
  CURRENT.paraId = `${CURRENT.book}|${CURRENT.chap}|${para.ref}`;

  document.getElementById('modalTitle').textContent = '단락 성경';
  sermonEditor.dataset.ctxType = '';
  sermonEditor.dataset.editing = '';
  modalRef.textContent = `${CURRENT.book} ${CURRENT.chap}장 · ${para.title || para.ref} (${para.ref})`;

  sermonList.innerHTML = '';
  sermonEditor.style.display = 'none';
  sermonEditor.classList.add('context-editor');
  modalWrap.style.display = 'flex';
  modalWrap.setAttribute('aria-hidden','false');
  modalFooterNew.style.display = '';

  renderSermonList();
}

el('closeModal').onclick = ()=>{ modalWrap.style.display='none'; modalWrap.setAttribute('aria-hidden','true'); stopEditorSpeak(true); };

function openSingleDocEditor(kind){
  if (!CURRENT.book || !Number.isFinite(CURRENT.chap) || !Number.isFinite(CURRENT.paraIdx)) {
    if (!syncCurrentFromOpen()) { alert('단락을 먼저 선택해 주세요.'); return; }
  }
  if (!BIBLE) { alert('성경 데이터가 로드되지 않았습니다.'); return; }

  const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const pid  = `${CURRENT.book}|${CURRENT.chap}|${para.ref}`;

  const titlePrefix =
    kind==='unit'       ? '단위성경속 맥락' :
    kind==='whole'      ? '전체성경속 맥락' :
    kind==='commentary' ? '주석' :
                           '내용요약';

  const key =
    kind==='unit'       ? STORAGE_UNIT_CTX :
    kind==='whole'      ? STORAGE_WHOLE_CTX :
    kind==='commentary' ? STORAGE_COMMENTARY :
                           STORAGE_SUMMARY;

  const map = getDocMap(key);
  const doc = map[pid] || { body:(kind==='summary' ? '핵심 내용을 간결하게 요약해 적어주세요.' : ''), images: [], date:'' };

  modalRef.textContent = `${CURRENT.book} ${CURRENT.chap}장 · ${para.title||para.ref} (${para.ref}) — ${titlePrefix}`;
  sermonList.innerHTML = '';
  sermonEditor.style.display = '';
  sermonEditor.classList.add('context-editor');
  modalWrap.style.display = 'flex';
  modalWrap.setAttribute('aria-hidden','false');
  modalFooterNew.style.display = 'none';

  sermonTitle.value = doc.title || '';
  setBodyHTML(doc.body || '');

  sermonEditor.dataset.editing = '';
  sermonEditor.dataset.ctxType = kind;

  const aiBtn = document.getElementById('aiFill');
  if (aiBtn) {
    aiBtn.style.display = (kind === 'unit') ? '' : 'none';
    aiBtn.onclick = null;
    if (kind === 'unit') { aiBtn.onclick = async ()=>{ /* 선택: AI 핸들러 */ }; }
  }
}

function renderSermonList(){
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  sermonList.innerHTML = '';

  // ✅ 설교가 없으면 모달 에디터 대신, 새 설교 생성 후 곧바로 '설교편집 에디터(팝업)' 열기
  if (arr.length === 0) {
    const newId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    map[CURRENT.paraId] = [{ id: newId, title: '', body: '', images: [], date: '', link: '' }];
    setSermonMap(map);

    // 모달 닫고 팝업 에디터로 바로 이동
    modalWrap.style.display = 'none';
    modalWrap.setAttribute('aria-hidden', 'true');
    openSermonEditorWindow(0);
    return;
  }

  arr.forEach((it, idx)=>{
    const row = document.createElement('div');
    row.className = 'item';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';

    const dateHtml = it.date ? `<span class="date">${it.date}</span>` : '';
    row.innerHTML = `
      <div class="item-title" style="flex:1 1 auto; min-width:0;">
        ${escapeHtml(it.title||'(제목 없음)')} ${dateHtml}
      </div>

      <!-- 🔗 링크 입력란 (클릭 시 바로 열림) -->
      <label class="muted" style="white-space:nowrap;">링크</label>
      <input type="text" class="sermonLinkInput" placeholder="https://..."
             value="${it.link ? escapeHtml(it.link) : ''}"
             style="width:240px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer;text-decoration:underline;" />

      <div class="ptoolbar" style="display:flex;gap:6px;">
        <button data-edit="${idx}">편집</button>
        <button data-del="${idx}" style="border-color:var(--danger);color:var(--text)">삭제</button>
      </div>
    `;

    // 편집/삭제 동작
    row.querySelector('[data-edit]').onclick = ()=>{
      modalWrap.style.display = 'none';
      modalWrap.setAttribute('aria-hidden','true');
      openSermonEditorWindow(idx);
    };
    row.querySelector('[data-del]').onclick = ()=> deleteSermon(idx);

    // 🔗 링크 입력 즉시 저장 + 클릭시 바로 열기
    const linkInput = row.querySelector('.sermonLinkInput');

    // 값 변경 시 저장
    linkInput.addEventListener('change', ()=>{
      const val = linkInput.value.trim();
      const map2 = getSermonMap();
      const arr2 = map2[CURRENT.paraId] || [];
      if(arr2[idx]){
        arr2[idx].link = val;
        map2[CURRENT.paraId] = arr2;
        setSermonMap(map2);
      }
    });

    // 클릭 시 새 탭 열기 (noopener)
    linkInput.addEventListener('click', (e)=>{
      const url = e.target.value.trim();
      if(!url) return;
      const safe = /^https?:\/\//i.test(url) ? url : ('https://' + url);
      window.open(safe, '_blank', 'noopener');
    });

    sermonList.appendChild(row);
  });
}

el('newSermonBtn').onclick = ()=>{
  sermonEditor.dataset.ctxType = '';
  if (!CURRENT.paraId) {
    if (!syncCurrentFromOpen()) { alert('단락을 먼저 선택하세요.'); return; }
    const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
    CURRENT.paraId = `${CURRENT.book}|${CURRENT.chap}|${para.ref}`;
  }
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const newId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  arr.unshift({ id: newId, title:'', body:'', images:[], date:'', link:'' });
  map[CURRENT.paraId] = arr;
  setSermonMap(map);

  modalWrap.style.display='none';
  modalWrap.setAttribute('aria-hidden','true');
  openSermonEditorWindow(0);
};

function startNewSermon(){
  sermonList.innerHTML = '<div class="muted" style="padding:0 14px">새 설교를 작성해 저장하면 이 단락에 붙습니다.</div>';
  sermonEditor.classList.add('context-editor');
  sermonEditor.style.display = '';
  sermonTitle.value = '';
  setBodyHTML('');
  sermonEditor.dataset.editing = '';
  stopEditorSpeak(true);
}
function deleteSermon(idx){
  if(!confirm('이 설교를 삭제할까요?')) return;
  const map = getSermonMap(); const arr = map[CURRENT.paraId] || [];
  arr.splice(idx,1); map[CURRENT.paraId] = arr; setSermonMap(map); renderSermonList();
}

// 취소 버튼은 현재 UI에 없지만, 안전하게 처리
el('cancelEdit')?.addEventListener('click', ()=>{
  if(sermonEditor.dataset.ctxType){
    sermonEditor.dataset.ctxType = '';
    modalWrap.style.display = 'none'; modalWrap.setAttribute('aria-hidden','true');
  }else{
    sermonEditor.style.display = 'none'; renderSermonList();
  }
  stopEditorSpeak(true);
});

el('saveSermon').onclick = ()=>{
  const title = sermonTitle.value.trim() || '(제목 없음)';
  let body = getBodyHTML() || '';
  body = body.replace(/^\s+|\s+$/g, '');

  const imgs  = []; // 파일선택 제거에 따라 항상 빈 배열
  const now   = new Date();
  const date  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const para  = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const pid   = `${CURRENT.book}|${CURRENT.chap}|${para.ref}`;
  const ctxType = sermonEditor.dataset.ctxType || '';

  if(ctxType){
    const key = ctxType==='unit'       ? STORAGE_UNIT_CTX
              : ctxType==='whole'      ? STORAGE_WHOLE_CTX
              : ctxType==='commentary' ? STORAGE_COMMENTARY
              :                          STORAGE_SUMMARY;
    const map = getDocMap(key);
    map[pid] = { title, body, images: imgs, date };
    setDocMap(key, map);

    sermonEditor.dataset.ctxType = '';
    sermonEditor.classList.remove('context-editor');
    modalWrap.style.display = 'none'; modalWrap.setAttribute('aria-hidden','true');
    status(`저장됨: ${title}`);
    return;
  }

  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const editing = sermonEditor.dataset.editing;
  if(editing!==''){
    const i = +editing;
    if(arr[i]){
      const keepLink = arr[i].link || '';
      arr[i] = { ...arr[i], title, body, images: imgs, date, link: keepLink };
    }
  }else{
    arr.unshift({ id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), title, body, images: imgs, date, link: '' });
  }
  map[CURRENT.paraId] = arr; setSermonMap(map);
  sermonEditor.style.display = 'none'; renderSermonList(); status('설교가 저장되었습니다.');
};

/* ===== RTE 유틸 (모달 편집기용) ===== */
function isRTE(){ return sermonBody && sermonBody.getAttribute('contenteditable') === 'true'; }
function getBodyHTML(){ return isRTE() ? sermonBody.innerHTML : (sermonBody.value || ''); }
function setBodyHTML(html){ if(isRTE()) sermonBody.innerHTML = html || ''; else sermonBody.value = html || ''; }

function applyColorImmediateToRTE(hex){
  if(!isRTE()) return;
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0){ sermonBody.focus(); return; }
  const range = sel.getRangeAt(0);
  if(!sermonBody.contains(range.commonAncestorContainer)){ sermonBody.focus();
