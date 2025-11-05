/* --------- Utils --------- */
const AI_ENDPOINT = 'http://localhost:5174/api/unit-context';
const el = id => document.getElementById(id);
const treeEl = el('tree'), statusEl = el('status');
function status(msg){ statusEl.textContent = msg; }
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
  ensureSermonButtons();   // 🔧 설교 버튼 누락 시 보강
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
            <button class="sermBtn">설교</button>
            <div class="spacer"></div>
          </div>
          <div class="pcontent"></div>`;

        // [PATCH 1 START] 설교 버튼 생성/가시성만 보강 (클릭 바인딩 없음)
        (function ensureSermonBtn(){
          const tb = body.querySelector('.ptoolbar');
          if (!tb) return;

          if (!tb.querySelector('.spacer')) {
            const sp = document.createElement('div');
            sp.className = 'spacer';
            tb.appendChild(sp);
          }
          let sermBtn = tb.querySelector('.sermBtn');
          if (!sermBtn) {
            sermBtn = document.createElement('button');
            sermBtn.className = 'sermBtn';
            sermBtn.textContent = '설교';
            tb.appendChild(sermBtn);
          }
        })();
        // [PATCH 1 END]

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
            // 열릴 때 설교 버튼 누락 시 즉시 생성 (클릭 바인딩 없음)
            const tb = detPara.querySelector('.ptoolbar');
            if (tb && !tb.querySelector('.sermBtn')) {
              const btn = document.createElement('button');
              btn.className = 'sermBtn';
              btn.textContent = '설교';
              tb.appendChild(btn);
            }
          }
        });

        body.querySelector('.speakBtn').addEventListener('click', ()=>{
          toggleSpeakInline(bookName, chap, idx, detPara, body.querySelector('.speakBtn'));
        });

        // 컨텍스트 에디터 버튼들
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

// [PATCH 2 START] 렌더 후에도 설교 버튼 누락 시 자동 보정(클릭 바인딩 없음)
(function sermonBtnWatcher(){
  const root = document.getElementById('tree');
  if (!root) return;

  function fix(tb){
    if (!tb.querySelector('.spacer')) {
      const sp = document.createElement('div');
      sp.className = 'spacer';
      tb.insertBefore(sp, tb.firstChild);
    }
    if (!tb.querySelector('.sermBtn')) {
      const b = document.createElement('button');
      b.className = 'sermBtn';
      b.textContent = '설교';
      tb.appendChild(b);
    }
  }

  function sweep(){
    root.querySelectorAll('details.para .ptoolbar').forEach(fix);
  }

  sweep();
  new MutationObserver(sweep).observe(root, {subtree:true, childList:true});
})();
// [PATCH 2 END]

/* ✅ 트리 렌더 후 설교 버튼이 누락됐을 때 자동 보강(클릭 바인딩 없음) */
function ensureSermonButtons(){
  document.querySelectorAll('#tree details.para .ptoolbar').forEach(tb=>{
    if (tb.querySelector('.sermBtn')) return;

    let spacer = tb.querySelector('.spacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'spacer';
      tb.appendChild(spacer);
    }

    const btn = document.createElement('button');
    btn.className = 'sermBtn';
    btn.textContent = '설교';
    tb.appendChild(btn);
  });
}

/* 🔧 트리 위임 클릭 공용 처리 (유일한 클릭 바인딩) */
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

/* ✅ 최초 클릭 시에도 동작하도록 보강 + 중복편집기 제거 전제 */
function openSermonModal(){
  if (!CURRENT.book || !Number.isFinite(CURRENT.chap) || !Number.isFinite(CURRENT.paraIdx)) {
    if (!syncCurrentFromOpen()) {
      alert('단락을 먼저 선택해 주세요.');
      return;
    }
  }

  const para = BIBLE?.books?.[CURRENT.book]?.[CURRENT.chap]?.paras?.[CURRENT.paraIdx];
  if (!para) {
    alert('선택한 단락을 찾을 수 없습니다.');
    return;
  }
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
  const doc = map[pid] || {
    body:  (kind==='summary' ? '핵심 내용을 간결하게 요약해 적어주세요.' : ''),
    images: [], date:''
  };
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
    if (kind === 'unit') {
      aiBtn.onclick = async ()=>{ /* 선택: AI 핸들러 */ };
    }
  }
}

/* ✅ 설교목록 렌더링 */
/* ✅ 설교목록 렌더링 (제목 → 날짜 → 링크 → 편집 → 삭제 순서) */
function renderSermonList(){
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  sermonList.innerHTML = '';

  if(arr.length===0){
    startNewSermon();
    return;
  }

  arr.forEach((it, idx)=>{
    const row = document.createElement('div');
    row.className = 'item'; // 필요시 레이아웃용 CSS를 추가할 수 있어요.

    // 1) 제목
    const colTitle = document.createElement('div');
    colTitle.className = 'col col-title';
    colTitle.textContent = (it.title || '(제목 없음)');

    // 2) 작성날짜
    const colDate = document.createElement('div');
    colDate.className = 'col col-date';
    colDate.textContent = (it.date || '');

    // 3) 링크 (입력 + 미리보기 앵커)
    const colLink = document.createElement('div');
    colLink.className = 'col col-link';

    const linkInput = document.createElement('input');
    linkInput.type = 'url';
    linkInput.placeholder = '링크(URL)';
    linkInput.value = it.link || '';
    linkInput.style.minWidth = '220px';

    const linkAnchor = document.createElement('a');
    linkAnchor.textContent = it.link ? it.link : '';
    if (it.link) {
      linkAnchor.href = it.link;
      linkAnchor.target = '_blank';
      linkAnchor.rel = 'noopener noreferrer';
    } else {
      linkAnchor.style.display = 'none';
    }

    linkInput.addEventListener('change', ()=>{
      const url = linkInput.value.trim();
      const m = getSermonMap();
      const a = m[CURRENT.paraId] || [];
      if (a[idx]) {
        a[idx].link = url;
        setSermonMap(m);
      }
      if (url){
        linkAnchor.href = url;
        linkAnchor.textContent = url;
        linkAnchor.style.display = '';
        linkAnchor.target = '_blank';
        linkAnchor.rel = 'noopener noreferrer';
      } else {
        linkAnchor.removeAttribute('href');
        linkAnchor.textContent = '';
        linkAnchor.style.display = 'none';
      }
    });

    colLink.appendChild(linkInput);
    colLink.appendChild(linkAnchor);

    // 4) 편집 버튼
    const btnEdit = document.createElement('button');
    btnEdit.textContent = '편집';
    btnEdit.addEventListener('click', ()=>{
      modalWrap.style.display = 'none';
      modalWrap.setAttribute('aria-hidden','true');
      openSermonEditorWindow(idx);
    });

    // 5) 삭제 버튼
    const btnDel = document.createElement('button');
    btnDel.textContent = '삭제';
    btnDel.style.borderColor = 'var(--danger)';
    btnDel.addEventListener('click', ()=>{
      if(!confirm('이 설교를 삭제할까요?')) return;
      const m = getSermonMap();
      const a = m[CURRENT.paraId] || [];
      a.splice(idx,1);
      m[CURRENT.paraId] = a;
      setSermonMap(m);
      renderSermonList();
    });

    const colActions = document.createElement('div');
    colActions.className = 'col col-actions';
    colActions.appendChild(btnEdit);
    colActions.appendChild(btnDel);

    // 👉 순서대로 추가: 제목 → 날짜 → 링크 → 편집/삭제
    row.appendChild(colTitle);
    row.appendChild(colDate);
    row.appendChild(colLink);
    row.appendChild(colActions);

    sermonList.appendChild(row);
  });
}

/* 새 설교 */
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
  const title = (sermonTitle.value||'').trim() || '(제목 없음)';
  let body = getBodyHTML() || '';
  body = body.replace(/^\s+|\s+$/g, '');

  const imgs  = [];
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
  if(editing!==''){ const i=+editing; if(arr[i]) arr[i] = {...arr[i], title, body, images:imgs, date}; }
  else { arr.unshift({ id: crypto.randomUUID(), title, body, images: imgs, date, link:'' }); }
  map[CURRENT.paraId] = arr; setSermonMap(map);
  sermonEditor.style.display = 'none'; renderSermonList(); status('설교가 저장되었습니다.');
};

/* ===== RTE 유틸 ===== */
function isRTE(){ return sermonBody && sermonBody.getAttribute('contenteditable') === 'true'; }
function getBodyHTML(){ return isRTE() ? sermonBody.innerHTML : (sermonBody.value || ''); }
function setBodyHTML(html){ if(isRTE()) sermonBody.innerHTML = html || ''; else sermonBody.value = html || ''; }

function applyColorImmediateToRTE(hex){
  if(!isRTE()) return;
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0){ sermonBody.focus(); return; }
  const range = sel.getRangeAt(0);
  if(!sermonBody.contains(range.commonAncestorContainer)){ sermonBody.focus(); return; }

  if(range.collapsed){
    const sp = document.createElement('span');
    sp.style.color = hex;
    sp.appendChild(document.createTextNode('\u200B'));
    range.insertNode(sp);
    sel.removeAllRanges();
    const r = document.createRange();
    r.setStart(sp.firstChild, 1); r.collapse(true);
    sel.addRange(r);
    return;
  }
  document.execCommand('foreColor', false, hex);
}
function execFmt(cmd){
  if(isRTE()){
    sermonBody.focus({preventScroll:true});
    document.execCommand(cmd,false,null);
  }
}

/* --------- Editor TTS --------- */
editorSpeakBtn.onclick = ()=> toggleEditorSpeak();
function toggleEditorSpeak(){
  const tmp = document.createElement('div'); tmp.innerHTML = getBodyHTML();
  tmp.querySelectorAll('sup').forEach(s=> s.textContent='['+s.textContent+'] ');
  const plain = (tmp.textContent||'').replace(/\n{2,}/g,' ').replace(/\s+/g,' ').trim();
  const text = [sermonTitle.value.trim(), plain].filter(Boolean).join('. ');
  if(!EDITOR_READER.synth) return alert('이 브라우저는 음성합성을 지원하지 않습니다.');
  if(EDITOR_READER.playing){ stopEditorSpeak(); return; }

  if(!text){ alert('낭독할 내용이 없습니다.'); return; }
  const u = new SpeechSynthesisUtterance(text.replace(/\n{2,}/g, '. ').replace(/\n/g,' '));
  applyVoice(u); u.onend = ()=> stopEditorSpeak(true);
  EDITOR_READER.u = u; EDITOR_READER.synth.cancel(); EDITOR_READER.synth.speak(u);
  EDITOR_READER.playing = true; editorSpeakBtn.textContent = '중지';
}
function stopEditorSpeak(silent){
  if(EDITOR_READER.synth){ try{ EDITOR_READER.synth.cancel(); }catch(e){} }
  EDITOR_READER.playing = false; EDITOR_READER.u = null;
  if(!silent) status('설교 낭독을 중지했습니다.'); editorSpeakBtn.textContent = '낭독';
}

/* --------- Hotkeys --------- */
window.addEventListener('keydown', (e)=>{
  if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='s'){
    e.preventDefault();
    downloadBibleJSON();
    return;
  }
  if(e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  if(key === 's'){
    e.preventDefault();
    syncCurrentFromOpen();
    const openPara = treeEl.querySelector('details.para[open]');
    if(openPara && CURRENT.book!=null){
      const btn = openPara.querySelector('.speakBtn');
      toggleSpeakInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx, openPara, btn);
    }
    return;
  }
  if(key === 'n'){
    e.preventDefault();
    if(!syncCurrentFromOpen()) return;
    const wasPlaying = !!READER.playing;
    try{ READER.synth && READER.synth.cancel(); }catch(_){}
    if (READER._wd){ clearTimeout(READER._wd); READER._wd = null; }
    READER.playing = wasPlaying;
    const moved = goToNextParagraphInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
    if(!moved) return;
    if (wasPlaying){
      const cb = READER.scope?.querySelector?.('.keepReading');
      if(cb){ cb.checked = READER.continuous; cb.disabled = false; }
      READER.q   = buildQueueFrom(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      READER.idx = 0;
      bindKeepReading(READER.scope);
      updateInlineSpeakBtn();
      setTimeout(()=>{ try{ READER.synth && READER.synth.cancel(); }catch(_){}
        playNextInQueueInline(CURRENT.book, CURRENT.chap, CURRENT.paraIdx);
      }, 120);
    }
  }
});

/* === 팝업 편집기 (스크립트 분리 버전) === */
function openSermonEditorWindow(idx){
  const map = getSermonMap();
  const arr = map[CURRENT.paraId] || [];
  const it  = arr[idx];
  if(!it){ alert('편집할 설교를 찾을 수 없습니다.'); return; }

  const para = BIBLE.books[CURRENT.book][CURRENT.chap].paras[CURRENT.paraIdx];
  const versesRaw = Array.isArray(para?.verses) ? para.verses : [];

  const meta = {
    paraId: CURRENT.paraId,
    idx,
    ref: `${CURRENT.book} ${CURRENT.chap}장 · ${(para?.title || para?.ref || '')} (${para?.ref || ''})`,
    title: it.title || '',
    body:  it.body  || '',
    date:  it.date || '',
    verses: versesRaw
  };

  const w = window.open('', '_blank', 'width=1100,height=820');
  if(!w){ alert('팝업이 차단되었습니다. 브라우저 팝업을 허용해주세요.'); return; }
  w.__WBPS_META__ = meta;
  if (w.opener && w.opener.firebase) { w.firebase = w.opener.firebase; }

  let popupHTML = String.raw`<!DOCTYPE html><html lang="ko">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>설교 편집</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600&family=Nanum+Myeongjo&display=swap" rel="stylesheet">
<style>
:root{--bg:#0f1115;--panel:#161922;--text:#e6e8ef;--muted:#9aa0ab;--border:#252a36;--accent:#6ea8fe;--danger:#ff6b6b}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);display:grid;grid-template-rows:56px 1fr 56px;gap:8px}
header,footer{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--border)}
footer{border-top:1px solid var(--border);border-bottom:none}
.grow{flex:1 1 auto}
main{padding:0 12px 12px}

input[type="text"].title-input{
  width: min(90%, 720px);
  background:#161922;color:#e6e8ef;border:1px solid #2a3040;border-radius:8px;
  padding:10px 12px;font-weight:700;font-size:1.14rem;line-height:1.4;letter-spacing:.01em;
}

button{background:color-mix(in hsl,var(--panel) 65%,black 10%);color:var(--text);
border:1px solid var(--border);border-radius:10px;padding:6px 10px;cursor:pointer;transition:border-color .15s,transform .04s}
button:hover{border-color:color-mix(in hsl,var(--border) 75%,var(--accent) 25%)} button:active{transform:translateY(1px)}
.primary{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 78%,white 10%),color-mix(in srgb,var(--accent) 72%,black 22%));border-color:color-mix(in srgb,var(--accent) 70%,black 10%)}
.muted{color:var(--muted)}

.context-editor{font-family:"Noto Serif KR","Nanum Myeong고",serif;font-size:1.05rem;line-height:1.85;letter-spacing:.02em;word-break:keep-all}

.notion-header{display:flex;align-items:center;gap:8px;margin-top:8px}
.notion-header .title{flex:1 1 auto;background:#161922;color:#e6e8ef;border:1px solid #2a3040;border-radius:8px;padding:10px 12px;font-weight:700}
.notion-header .meta{display:flex;gap:8px;align-items:center}
.notion-badge{font-size:11px;color:#9aa0ab}

#editorRoot{max-width:880px;margin:12px auto 8px;padding:0 6px}
.editor-block{position:relative;display:flex;gap:10px;padding:2px 0}
.editor-block .handle{user-select:none;cursor:grab;opacity:.5;padding:2px 0 0 0}
.editor-block .content{flex:1;outline:none;white-space:pre-wrap}
.editor-block[data-type="h1"] .content{font-size:28px;font-weight:800}
.editor-block[data-type="h2"] .content{font-size:24px;font-weight:800}
.editor-block[data-type="h3"] .content{font-size:20px;font-weight:700}
.editor-block[data-type="quote"]{border-left:3px solid #5a6; padding-left:10px; opacity:.95}
.editor-block[data-type="callout"]{background:#3a3f4e33;border:1px solid #444;border-radius:12px;padding:10px}
.editor-block[data-type="code"] .content{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#0b0d13;border:1px solid #252a36;border-radius:12px;padding:10px}
.editor-block[data-type="todo"] .content{display:flex;gap:8px}
.editor-block[data-type="divider"] .content{border-bottom:1px solid #333;height:1px}
.editor-block[data-type="toggle"] .content summary{cursor:pointer}
.editor-block .progress{position:absolute;left:0;bottom:-2px;height:2px;background:#6ea8fe;opacity:.9;transition:width .05s linear}

.bubble{position:absolute;padding:6px;border:1px solid #333;border-radius:12px;background:#1c1f2a;display:flex;gap:6px}
.bubble.hidden{display:none}
.bubble button{border:1px solid #333;background:#222;color:#eee;border-radius:8px;padding:2px 6px}

.slash{position:fixed;inset:auto auto 0 0;max-height:260px;overflow:auto;background:#1c1f2a;border:1px solid #333;border-radius:12px;min-width:260px;padding:6px}
.slash.hidden{display:none}
.slash .item{padding:6px 8px;border-radius:8px;display:flex;gap:8px;align-items:center}
.slash .item.active,.slash .item:hover{background:#2a2f3d}

.notion-footer{padding:6px 12px;border-top:1px solid #252a36;background:#161922;position:sticky;bottom:0}
#traceLog{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;max-height:180px;overflow:auto;white-space:pre-wrap}

#floatingBar{
  position: fixed; right: 16px; bottom: 16px; z-index: 50;
  display:flex; gap:8px; align-items:center;
  background: color-mix(in hsl, var(--panel) 85%, black 6%);
  border:1px solid var(--border); border-radius:999px; padding:8px 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.35);
}
#floatingBar button{ padding:8px 14px; border-radius:999px }

@media print {
  @page { size: A4; margin: 18mm; }
  body{ background:#fff; color:#000; grid-template-rows:0 1fr 0 }
  header, footer, #floatingBar { display:none !important; }
}

/* === 편집기(main) 스크롤 및 겹침 방지 보정 === */
/* body를 3행 그리드(헤더/메인/푸터)로, 메인은 스크롤 가능 */
body{
  display: grid;
  grid-template-rows: 56px 1fr 56px;
  height: 100vh !important;
  overflow: hidden !important;
}

/* main은 스크롤이 가능해야 함 + footer/floatingBar에 가리지 않도록 하단 여백 */
main{
  position: relative;
  z-index: 1;
  overflow-y: auto !important;
  padding-top: 12px;
  padding-bottom: 140px; /* footer 높이 + 여유 */
  height: calc(100vh - 112px) !important; /* 56(header)+56(footer) */
}

/* 편집 영역 자체 여백 확보(아래쪽 충분히 띄워서 겹침 방지) */
#editorRoot{
  position: relative;
  z-index: 1;
  max-width: 880px;
  margin: 12px auto 100px;  /* 아래 여유 */
  padding: 0 8px 80px;      /* 아래 여유 */
  overflow: visible;
}

/* 플로팅 버튼과의 겹침도 최소화(필요 시) */
#floatingBar{
  z-index: 50;
}
html, body { height:auto !important; overflow:auto !important; }
main { height:auto !important; overflow:visible !important; }
/* === Floating bubble palette === */
#neBubble{ position:absolute; z-index:1000; }
#neBubble .swatch{
  width:18px;height:18px;border-radius:4px;border:1px solid #333; display:inline-block;
}
#neBubble .btn{ border:1px solid #333;background:#222;color:#eee;border-radius:8px;padding:2px 6px }
#neBubble .btn:hover{ background:#2b2b2b }
#neBubble .sep{ width:1px; height:18px; background:#333; display:inline-block; margin:0 6px; }

</style>
</head>
<body class="context-editor">
<header>
  <strong>설교 편집</strong><span class="muted" id="ref"></span>
  <div class="grow"></div>
  <button id="x">닫기</button>
</header>

<main>
  <input id="t" class="title-input" type="text" autocomplete="off" placeholder="설교 제목을 입력하세요">
  <div class="notion-header">
    <input id="neTitle" class="title" placeholder="제목을 입력하세요" />
    <div class="meta">
      <button id="nePublish" class="primary">게시</button>
      <button id="neStt">🎙 STT</button>
    </div>
  </div>

  <div id="neBubble" class="bubble hidden">
    <button data-mark="bold"><b>B</b></button>
    <button data-mark="italic"><i>I</i></button>
    <button data-mark="underline"><u>U</u></button>
    <button data-mark="strike"><s>S</s></button>
    <button data-mark="code">` + '\\`code\\`' + `</button>
    <button data-mark="highlight">HL</button>
    <button data-action="link">🔗</button>
  </div>

  <div id="neSlash" class="slash hidden"></div>
  <div id="editorRoot" aria-label="Sermon Editor"></div>

  <div class="notion-footer">
    <div class="notion-badge" id="neAutosave">자동저장 대기중…</div>
    <details style="margin-top:6px">
      <summary>🎧 Sermon Tracer 로그/타임라인</summary>
      <div id="traceLog"></div>
    </details>
  </div>
</main>

<div id="floatingBar" aria-label="도구 막대">
  <button id="btnInsertBibleFloating" class="primary">성경구절</button>
</div>

<footer>
  <span class="muted" id="date"></span><div class="grow"></div>
  <button id="print">인쇄(A4)</button>
  <button id="read" class="primary">낭독</button>
  <button id="stop">중지</button>
  <button class="danger" id="d">삭제</button>
  <button class="primary" id="s">저장</button>
</footer>
</body>
</html>`;

  // 템플릿 보간 및 </script> 보호
  popupHTML = popupHTML.replaceAll('${', '\\${');
  popupHTML = popupHTML.replaceAll('</script>', '<\\/script>');

  w.document.open();
  w.document.write(popupHTML);
  w.document.close();

  // 팝업 초기화 실행
  initSermonPopup(w);

  // 부모창 메시지 핸들러 (저장/삭제 반영)
  const onMsg = (ev) => {
    const data = ev?.data || {};
    if (!data.type) return;

    const map2 = getSermonMap();
    const arr2 = map2[CURRENT.paraId] || [];

    if (data.type === 'sermon-save') {
      const now  = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      if (arr2[idx]) {
        arr2[idx] = { ...arr2[idx], title: data.title, body: data.body, images: [], date };
      }
      map2[CURRENT.paraId] = arr2;
      setSermonMap(map2);
      status('설교가 저장되었습니다.');
      renderSermonList();
      window.removeEventListener('message', onMsg);
    }

    if (data.type === 'sermon-delete') {
      if (arr2[idx]) arr2.splice(idx, 1);
      map2[CURRENT.paraId] = arr2;
      setSermonMap(map2);
      status('설교가 삭제되었습니다.');
      renderSermonList();
      window.removeEventListener('message', onMsg);
    }
  };
  window.addEventListener('message', onMsg);
}

/* ===== 팝업 내부 스크립트 ===== */
// =============================
// ✅ 설교편집 팝업 초기화 전체
// =============================
function initSermonPopup(win) {
  const w = win;
  const d = w.document;
  const $ = id => d.getElementById(id);

  // =============================
  // [A] 읽기 전용 뷰어 및 하이라이트 스타일
  // =============================
  (function injectTTSStyles() {
    const css = `
    #readPane {
      position: fixed; inset: 56px 8px 56px 8px;
      background: color-mix(in hsl, var(--panel) 88%, black 4%);
      border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px;
      overflow: auto; z-index: 45; display: none;
    }
    #readPane .sent { display: inline; padding: 2px 2px; }
    #readPane .gap { white-space: pre-wrap }
    #readPane .speak-current {
      background: color-mix(in srgb, var(--accent) 25%, transparent);
      outline: 2px solid color-mix(in srgb, var(--accent) 35%, #000);
      border-radius: 6px;
    }
    #ttsBar {
      display: flex; gap: 8px; align-items: center; margin-left: 8px;
    }
    #ttsVoice, #ttsRate {
      background: #1c1f2a; color: #e6e8ef; border: 1px solid #333; border-radius: 8px;
    }
    #ttsRate { width: 160px; }
    `;
    const st = d.createElement('style');
    st.textContent = css;
    d.head.appendChild(st);

    // 읽기 패널 DOM 한 번만 생성
    let pane = d.getElementById('readPane');
    if (!pane) {
      pane = d.createElement('div');
      pane.id = 'readPane';
      pane.setAttribute('aria-label', '낭독 뷰어');
      d.body.appendChild(pane);
    }
  })();

  // =============================
  // [B] 푸터에 음성/속도 컨트롤 추가
  // =============================
  (function ensureTTSControls() {
    const footer = d.querySelector('footer');
    if (!footer || d.getElementById('ttsBar')) return;

    const bar = d.createElement('div');
    bar.id = 'ttsBar';
    bar.innerHTML = `
      <label class="muted" for="ttsVoice">음성</label>
      <select id="ttsVoice"></select>
      <label class="muted" for="ttsRate">속도</label>
      <input id="ttsRate" type="range" min="0.6" max="1.8" step="0.05" value="0.95">
    `;
    const saveBtn = d.getElementById('s');
    footer.insertBefore(bar, saveBtn || footer.lastChild);
  })();

  // =============================
  // [C] 보이스 목록 로딩 및 저장
  // =============================
  const POPUP_TTS_KEY = 'wbps.popup.tts';
  function loadSavedTTS() {
    try {
      return JSON.parse(w.localStorage.getItem(POPUP_TTS_KEY) || '{}');
    } catch {
      return {};
    }
  }
  function saveTTS(v) {
    try {
      w.localStorage.setItem(POPUP_TTS_KEY, JSON.stringify(v || {}));
    } catch {}
  }

  async function populateVoices() {
    const sel = d.getElementById('ttsVoice');
    if (!sel) return;

    function fill(list) {
      sel.innerHTML = '';
      const kos = list.filter(v => (v.lang || '').toLowerCase().startsWith('ko'));
      const etc = list.filter(v => !(v.lang || '').toLowerCase().startsWith('ko'));
      const groups = [
        { label: '한국어', arr: kos },
        { label: '기타', arr: etc }
      ];
      for (const g of groups) {
        if (!g.arr.length) continue;
        const og = d.createElement('optgroup');
        og.label = g.label;
        g.arr.forEach(v => {
          const o = d.createElement('option');
          o.value = v.voiceURI;
          o.textContent = `${v.name} — ${v.lang}${v.localService ? ' (로컬)' : ''}`;
          og.appendChild(o);
        });
        sel.appendChild(og);
      }
      const saved = loadSavedTTS();
      if (saved.voiceURI) {
        const i = [...sel.options].findIndex(o => o.value === saved.voiceURI);
        if (i >= 0) sel.selectedIndex = i;
      }
      if (saved.rate)
        d.getElementById('ttsRate').value = String(saved.rate);
    }

    const have = w.speechSynthesis.getVoices?.();
    if (have && have.length) fill(have);
    w.speechSynthesis.onvoiceschanged = () =>
      fill(w.speechSynthesis.getVoices() || []);
  }
  populateVoices();

  // =============================
  // [D] 문장 분해 / 렌더 유틸
  // =============================
  function blocksToPlainHTML() {
    return NblocksToHTML();
  }

// --- 문장 하이라이트 유틸 ---
// === 문장 분해(안전 버전: s/u 미사용, 모든 환경 OK) ===
// 코어: 오프셋 포함(하이라이트용)
function splitToSentencesCore(text){
  // 마침표/물음표/느낌표/말줄임표(영/한) 기준. dotAll 대신 [\s\S] 사용.
  const re = /([\s\S]+?[.?!…！？。]+)(?:\s+|$)/g;
  const out = [];
  let m, last = 0;
  while ((m = re.exec(text))) {
    out.push({ t: m[1], s: m.index, e: m.index + m[1].length });
    last = re.lastIndex;
  }
  if (last < text.length) {
    const tail = text.slice(last).trim();
    if (tail) out.push({ t: tail, s: last, e: text.length });
  }
  return out;
}

// 읽기 패널용: 문자열 배열
function splitToSentencesArray(text){
  return splitToSentencesCore(text).map(o => o.t);
}

// (호환용) 예전 이름을 호출하는 곳이 있다면 배열 버전으로 반환
function splitToSentences(text){
  return splitToSentencesArray(text);
}


  function renderReadPane(sentences) {
    const pane = d.getElementById('readPane');
    pane.innerHTML = '';
    sentences.forEach((s, i) => {
      const span = d.createElement('span');
      span.className = 'sent';
      span.dataset.i = i;
      span.textContent =
        s + (/[\.!?…？！。]$/.test(s) ? ' ' : '. ');
      pane.appendChild(span);
      const gap = d.createElement('span');
      gap.className = 'gap';
      gap.textContent = ' ';
      pane.appendChild(gap);
    });
    pane.scrollTop = 0;
    pane.style.display = 'block';
  }

  function centerScroll(el, container) {
    const cr = container.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const offset = (er.top + er.height / 2) - (cr.top + cr.height / 2);
    container.scrollTop += offset;
  }

  // =============================
  // [E] TTS 엔진 상태 및 실행
  // =============================
  const TTS = {
    synth: w.speechSynthesis || window.speechSynthesis,
    playing: false,
    idx: 0,
    sents: [],
    u: null,
    pane: () => d.getElementById('readPane'),
    curEl: null
  };

  function currentVoice() {
    const uri = d.getElementById('ttsVoice')?.value || '';
    const list = TTS.synth?.getVoices?.() || [];
    return list.find(v => v.voiceURI === uri) || null;
  }
  function currentRate() {
    return parseFloat(d.getElementById('ttsRate')?.value || '1.0') || 1;
  }

  function speakIdx(i) {
    if (i < 0 || i >= TTS.sents.length) {
      stopReading();
      return;
    }
    TTS.idx = i;

    const pane = TTS.pane();
    if (TTS.curEl) TTS.curEl.classList.remove('speak-current');
    const el = pane.querySelector(`.sent[data-i="${i}"]`);
    TTS.curEl = el;
    if (el) {
      el.classList.add('speak-current');
      centerScroll(el, pane);
    }

    try {
      TTS.synth.cancel();
    } catch (_) {}
    const u = new w.SpeechSynthesisUtterance(TTS.sents[i]);
    const v = currentVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = 'ko-KR';
    }
    u.rate = currentRate();
    u.onend = () => {
      if (TTS.playing) speakIdx(i + 1);
    };
    u.onerror = () => {
      if (TTS.playing) speakIdx(i + 1);
    };
    TTS.u = u;
    TTS.synth.speak(u);
  }

  function startReading() {
    const html = blocksToPlainHTML();
    const sents = splitToSentencesArray(html);
    if (!sents.length) {
      w.alert('낭독할 내용이 없습니다.');
      return;
    }

    saveTTS({
      voiceURI: d.getElementById('ttsVoice')?.value || '',
      rate: currentRate()
    });

    renderReadPane(sents);
    TTS.sents = sents;
    TTS.playing = true;
    d.getElementById('read').textContent = '일시정지';
    speakIdx(0);
  }

  function pauseReading() {
    try {
      TTS.synth.pause();
    } catch (_) {}
    TTS.playing = false;
    d.getElementById('read').textContent = '재개';
  }

  function resumeReading() {
    try {
      TTS.synth.resume();
    } catch (_) {}
    TTS.playing = true;
    d.getElementById('read').textContent = '일시정지';
  }

  function stopReading() {
    try {
      TTS.synth.cancel();
    } catch (_) {}
    TTS.playing = false;
    TTS.idx = 0;
    TTS.u = null;
    const pane = TTS.pane();
    if (pane) {
      pane.style.display = 'none';
      pane.innerHTML = '';
    }
    if (TTS.curEl) {
      TTS.curEl.classList.remove('speak-current');
      TTS.curEl = null;
    }
    d.getElementById('read').textContent = '낭독';
  }

// --- 문장 하이라이트 유틸 ---
function splitToSentences(text){
  // 한국어/영어 마침표, ? ! … 및 전각 기호 포함
  const re = /(.+?[\.\?\!…！？。]+)(\s+|$)/gus;
  const out=[]; let m, last=0;
  while((m=re.exec(text))){ out.push({t:m[1], s:m.index, e: m.index+m[1].length}); last = re.lastIndex; }
  if(last < text.length){ const tail = text.slice(last).trim(); if(tail) out.push({t:tail, s:last, e:text.length}); }
  return out;
}
function textNodesUnder(el){
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(n){ return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
  });
  const arr=[]; while(w.nextNode()) arr.push(w.currentNode); return arr;
}
function wrapSentencesOnce(root){
  // 이미 래핑돼 있으면 스킵
  if(root.querySelector('.tts-sent')) return;

  const nodes = textNodesUnder(root);
  // 텍스트 전체 인덱스 매핑
  let offset = 0;
  const indexMap = nodes.map(n => { const len = n.nodeValue.length; const obj = {node:n, start:offset, end:offset+len}; offset += len; return obj; });

  const full = nodes.map(n=>n.nodeValue).join('');
  const sents = splitToSentencesCore(full);
  if(!sents.length) return;

  // 문장별로 Range를 만들어 <span class="tts-sent">로 감싼다
  const d = root.ownerDocument;
  sents.forEach(sn=>{
    // 범위를 구성
    let startPos=null, endPos=null;
    for(const m of indexMap){
      if(startPos===null && sn.s < m.end){
        startPos = { node:m.node, offset: Math.max(0, sn.s - m.start) };
      }
      if(sn.e <= m.end){
        endPos = { node:m.node, offset: Math.max(0, sn.e - m.start) };
        break;
      }
    }
    if(!startPos || !endPos) return;
    const r = d.createRange();
    r.setStart(startPos.node, startPos.offset);
    r.setEnd(endPos.node, endPos.offset);

    // 부분 요소 선택 충돌 방지: surroundContents가 실패하면 안전하게 split 적용
    try{
      const span = d.createElement('span');
      span.className = 'tts-sent';
      r.surroundContents(span);
    }catch{
      // fallback: 문장 텍스트만 교체
      const frag = r.extractContents();
      const span = d.createElement('span');
      span.className = 'tts-sent';
      span.appendChild(frag);
      r.insertNode(span);
    }
  });
}
function clearTTSMarks(root){
  root.querySelectorAll('.tts-current').forEach(el=> el.classList.remove('tts-current'));
  // 래핑 자체는 재생 종료 시 점진적으로 풀고 싶다면 아래를 활성화
  // root.querySelectorAll('.tts-sent').forEach(span=>{
  //   const p = span.parentNode;
  //   while(span.firstChild) p.insertBefore(span.firstChild, span);
  //   p.removeChild(span);
  // });
}
function allSentenceSpans(root){
  return Array.from(root.querySelectorAll('.tts-sent'));
}
function scrollIntoCenter(el){
  el.scrollIntoView({block:'center', inline:'nearest', behavior:'smooth'});
}

  
  // =============================
  // [F] 버튼 핸들러 교체
  // =============================
  const btnRead = d.getElementById('read');
  const btnStop = d.getElementById('stop');
  if (btnRead) {
    btnRead.onclick = () => {
      if (!TTS.playing && TTS.synth?.paused) {
        resumeReading();
        return;
      }
      if (TTS.playing) {
        pauseReading();
        return;
      }
      startReading();
    };
  }
  if (btnStop) btnStop.onclick = () => stopReading();

  // 설정 변경 시 저장
  d.getElementById('ttsRate')?.addEventListener('input', () =>
    saveTTS({
      voiceURI: d.getElementById('ttsVoice')?.value || '',
      rate: currentRate()
    })
  );
  d.getElementById('ttsVoice')?.addEventListener('change', () =>
    saveTTS({
      voiceURI: d.getElementById('ttsVoice')?.value || '',
      rate: currentRate()
    })
  );
}

  function NshowBubbleMaybe(){
    const sel = w.getSelection();
    if(!sel || sel.isCollapsed){ neBubble.classList.add('hidden'); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    neBubble.style.left = (rect.left + w.scrollX) + 'px';
    neBubble.style.top  = (rect.top  + w.scrollY - 42) + 'px';
    neBubble.classList.remove('hidden');
  }
  neBubble.addEventListener('mousedown', e=> e.preventDefault());
  neBubble.addEventListener('click', e=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const mark = btn.dataset.mark; const act = btn.dataset.action;
    if(mark){
      d.execCommand(mark==='highlight'?'backColor':mark, false, mark==='highlight'? '#6655007a': null);
    } else if(act==='link'){
      const url = w.prompt('링크 URL'); if(url) d.execCommand('createLink', false, url);
    }
    NshowBubbleMaybe(); NscheduleAutosave();
  });

  const N_SLASH = [
    {type:'p', label:'텍스트'},
    {type:'h1', label:'제목 1'},
    {type:'h2', label:'제목 2'},
    {type:'h3', label:'제목 3'},
    {type:'todo', label:'체크리스트'},
    {type:'ul', label:'불릿 리스트'},
    {type:'ol', label:'번호 리스트'},
    {type:'quote', label:'인용'},
    {type:'callout', label:'콜아웃'},
    {type:'divider', label:'구분선'},
    {type:'code', label:'코드 블록'},
    {type:'toggle', label:'토글 블록'},
    {type:'img', label:'이미지(링크)'},
  ];
  let NslashTarget = null;
  function NshowSlash(block){
    NslashTarget = block;
    const rect = block.getBoundingClientRect();
    neSlash.style.left = (rect.left + w.scrollX + 20) + 'px';
    neSlash.style.top  = (rect.top  + w.scrollY + 20) + 'px';
    neSlash.innerHTML = N_SLASH.map((it,i)=>`<div class="item" data-i="${i}">${it.label}</div>`).join('');
    neSlash.classList.remove('hidden');
  }
  neSlash.addEventListener('click', e=>{
    const item = e.target.closest('.item'); if(!item) return;
    const i = +item.dataset.i; NapplySlash(N_SLASH[i]);
    neSlash.classList.add('hidden');
  });
  d.addEventListener('keydown', e=>{ if(e.key==='Escape') neSlash.classList.add('hidden'); });

  function NapplySlash(it){
    if(!NslashTarget) return;
    const id = NslashTarget.dataset.id; const idx = NindexById(id); if(idx<0) return;
    if(it.type==='divider'){
      NSTATE.blocks[idx] = {id, type:'divider', html:''};
    } else if(it.type==='img'){
      const url = w.prompt('이미지 URL'); if(url){ NSTATE.blocks[idx].html = `<img src="${url}" style="max-width:100%">`; }
    } else if(it.type==='todo'){
      NSTATE.blocks[idx] = {id, type:'todo', html:`<input type="checkbox"> 할 일`};
    } else if(it.type==='ul' || it.type==='ol'){
      NSTATE.blocks[idx] = {id, type:it.type, html:`<${it.type}><li>첫 번째</li></${it.type}>`};
    } else if(it.type==='toggle'){
      NSTATE.blocks[idx] = {id, type:'toggle', html:'토글 제목<br>토글 내용'};
    } else {
      NSTATE.blocks[idx].type = it.type;
    }
    Nrender(); NscheduleAutosave();
  }

  function NpushHistory(){ NSTATE.history = NSTATE.history.slice(0, NSTATE.cursor+1); NSTATE.history.push(JSON.stringify(NSTATE.blocks)); NSTATE.cursor = NSTATE.history.length-1; }
  function Nundo(){ if(NSTATE.cursor>0){ NSTATE.cursor--; NSTATE.blocks = JSON.parse(NSTATE.history[NSTATE.cursor]); Nrender(); } }
  function Nredo(){ if(NSTATE.cursor<NSTATE.history.length-1){ NSTATE.cursor++; NSTATE.blocks = JSON.parse(NSTATE.history[NSTATE.cursor]); Nrender(); } }

  function NblocksToHTML(){
    return NSTATE.blocks.map(b=>{
      switch(b.type){
        case 'h1': return `<h2>${b.html}</h2>`;
        case 'h2': return `<h3>${b.html}</h3>`;
        case 'h3': return `<h4>${b.html}</h4>`;
        case 'quote': return `<blockquote>${b.html}</blockquote>`;
        case 'divider': return '<hr/>';
        default: return `<div>${b.html}</div>`;
      }
    }).join('');
  }

  let NsaveTimer=null;
  function NscheduleAutosave(){
    clearTimeout(NsaveTimer);
    neAutosave.textContent = '입력 중…';
    NsaveTimer = setTimeout(()=>{
      try{
        const key = `wbps.sermon.draft.blocks.${(meta.paraId||'')}.${(meta.idx||0)}`;
        const payload = { title: ($('neTitle').value||''), blocks:NSTATE.blocks, ts: Date.now() };
        w.localStorage.setItem(key, JSON.stringify(payload));
        neAutosave.textContent = '자동저장됨';
      }catch(_){ neAutosave.textContent = '자동저장 실패(용량)'; }
    }, 500);
  }

  (function Ninit(){
    initBlocksFromHTML(meta.body||'');
    Nrender(); NpushHistory();
    setTimeout(()=>{ const last = d.querySelector('#editorRoot .editor-block:last-child .content'); last && last.focus(); }, 60);
  })();

  // STT
  (function(){
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if(!SR){ console.warn('STT 미지원'); return; }
    const rec = new SR(); rec.lang='ko-KR'; rec.interimResults=true; rec.continuous=true;

    let activeBlock=null, accText='', startedAt=null;
    function getActive(){ const sel=w.getSelection(); const n=sel?.anchorNode; const el=(n?.nodeType===1?n:(n?.parentElement)); return el?.closest?.('.editor-block') || d.querySelector('.editor-block'); }
    function setProgress(block, ratio){ const bar=block?.querySelector('.progress'); if(bar) bar.style.width = Math.max(0,Math.min(100,ratio*100)) + '%'; }
    function plain(html){ const t=d.createElement('div'); t.innerHTML=html||''; return t.textContent||''; }
    function sim(a,b){ a=a.replace(/\s+/g,''); b=b.replace(/\s+/g,''); const L=Math.max(a.length,1); let m=0; for(let i=0;i<Math.min(a.length,b.length);i++){ if(a[i]===b[i]) m++; } return m/L; }
    function nextBlock(block){ const nx = block?.nextElementSibling?.classList.contains('editor-block')? block.nextElementSibling : null; return nx; }

    const neSttBtn = d.getElementById('neStt');
    neSttBtn?.addEventListener('click', ()=>{
      if(neSttBtn.dataset.on==='1'){ rec.stop(); neSttBtn.dataset.on='0'; neSttBtn.textContent='🎙 STT'; return; }
      activeBlock = getActive(); if(!activeBlock){ w.alert('블록을 선택하세요'); return; }
      accText=''; startedAt=Date.now(); rec.start(); neSttBtn.dataset.on='1'; neSttBtn.textContent='⏸ 중지';
    });

    rec.onresult = (ev)=>{
      if(!activeBlock) return;
      const r = ev.results[ev.results.length-1]; const txt=r[0].transcript; const isFinal=r.isFinal;
      accText += (isFinal? txt+' ' : txt);
      const base = plain(activeBlock.querySelector('.content').innerHTML);
      const s = sim(base, accText); setProgress(activeBlock, s);

      const t = ((Date.now()-startedAt)/1000).toFixed(1);
      const neTrace = d.getElementById('traceLog');
      neTrace.textContent += `t=${t}s s=${(s*100).toFixed(0)}% : ${txt}\n`;
      neTrace.scrollTop = neTrace.scrollHeight;

      if(isFinal && s>0.95){
        const nb = nextBlock(activeBlock);
        if(nb){ activeBlock = nb; accText=''; startedAt=Date.now(); setProgress(nb, 0); }
      }
    };
    rec.onend   = ()=>{ if(neSttBtn.dataset.on==='1'){ rec.start(); } };
    rec.onerror = (e)=> console.warn('STT 오류', e.error);
  })();

  // 게시(Firebase 옵션)
  const nePubBtn = d.getElementById('nePublish');
  nePubBtn?.addEventListener('click', async ()=>{
    try{
      if(typeof w.firebase === 'undefined'){ w.alert('Firebase 미탑재: 게시 기능을 사용하려면 SDK/초기화가 필요합니다.'); return; }
      const user = w.firebase.auth().currentUser;
      if(!user){ w.alert('로그인 후 게시 가능합니다.'); return; }

      const db = w.firebase.firestore();
      const docRef = NSTATE.docId ? db.collection('sermons').doc(NSTATE.docId) : db.collection('sermons').doc();
      const payload = {
        title: (d.getElementById('neTitle').value||'무제'),
        blocks: NSTATE.blocks,
        owner: user.uid,
        updatedAt: w.firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: w.firebase.firestore.FieldValue.serverTimestamp(),
        status: 'published'
      };
      await docRef.set(payload, {merge:true});
      NSTATE.docId = docRef.id;
      const url = w.location.origin + '/viewer.html?id=' + docRef.id;
      w.alert('게시 완료!\n' + url);
    }catch(err){ console.error(err); w.alert('게시 실패: '+err.message); }
  });

  // 성경구절 삽입
  d.getElementById('btnInsertBibleFloating')?.addEventListener('click', insertBiblePrompt);
  async function insertBiblePrompt(){
    const raw = w.prompt('삽입할 성경구절 (예: 요 3:16, 창세기 1:1-3)');
    if(!raw) return;
    const norm=String(raw).replace(/\s+/g,' ').replace(/[–—－]/g,'-').replace(/[：]/g,':').trim();
    const m=norm.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?$/);
    if(!m){ w.alert('형식: 성경이름 장:절 또는 장:절-절'); return; }
    const bookRaw=m[1], chap=parseInt(m[2],10), vFrom=parseInt(m[3],10), vTo=m[4]?parseInt(m[4],10):parseInt(m[3],10);

    let BOOKS;
    try{ BOOKS = await getBooksInPopup(); }
    catch(e){ w.alert(e.message || '성경 데이터를 불러올 수 없습니다.'); return; }

    const bookKey=resolveBookKey(bookRaw,BOOKS);
    if(!bookKey){ w.alert(`해당 성경을 찾을 수 없습니다: "${bookRaw}"`); return; }

    const ch=BOOKS[bookKey]?.[chap];
    if(!ch){ w.alert(`"${bookKey}" ${chap}장을 찾을 수 없습니다.`); return; }

    const verses=(ch.paras||[]).flatMap(p=>p.verses||[]).filter(([v])=>v>=vFrom&&v<=vTo);
    if(!verses.length){ w.alert('해당 구절을 찾을 수 없습니다.'); return; }

    const header = `<div class="verse-header">&lt;${bookKey} ${chap}:${vFrom}${vTo!==vFrom?'-'+vTo:''}&gt;</div>`;
    const html = verses.map(([v,t])=>`<span class="verse-line"><sup>${v}</sup>${t}</span>`).join('');
    const blockHTML = header + html;

    NSTATE.blocks.push({ id:Nuid(), type:'p', html: blockHTML });
    Nrender(); NpushHistory(); NscheduleAutosave();
    const last = d.querySelector('#editorRoot .editor-block:last-child .content');
    last && last.focus();
  }

  // 저장/삭제/닫기/인쇄/낭독
  d.getElementById('s').onclick = ()=>{
    const html = NblocksToHTML();
    const title = (d.getElementById('neTitle').value || d.getElementById('t').value || '').trim() || '(제목 없음)';
    const images = [];
    w.opener?.postMessage?.({ type:'sermon-save', title, body: html, images }, '*');
    w.close();
  };
  d.getElementById('d').onclick = ()=>{ if(w.confirm('삭제할까요?')){ w.opener?.postMessage?.({ type:'sermon-delete' }, '*'); w.close(); } };
  d.getElementById('x').onclick = ()=> w.close();
  d.getElementById('print').onclick = ()=> w.print();

// --- [F] 버튼 핸들러 교체: 읽기/중지 ---
d.getElementById('read').onclick = ()=>{
  if(!TTS.playing && TTS.synth?.paused){
    // 일시정지 → 재개
    resumeReading();
    return;
  }
  if(TTS.playing){
    // 일시정지
    pauseReading();
    return;
  }
  // 새로 시작
  startReading();
};

d.getElementById('stop').onclick = ()=> stopReading();

// 속도/보이스 변경 중에 재생 중이면 즉시 반영(다음 문장부터)
d.getElementById('ttsRate')?.addEventListener('input', ()=>{
  saveTTS({ voiceURI:(d.getElementById('ttsVoice')?.value)||'', rate: currentRate() });
});
d.getElementById('ttsVoice')?.addEventListener('change', ()=>{
  saveTTS({ voiceURI:(d.getElementById('ttsVoice')?.value)||'', rate: currentRate() });
});

  function toPlainText(html){
    const tmp=d.createElement('div'); tmp.innerHTML=html||'';
    tmp.querySelectorAll('sup').forEach(s=> s.textContent='['+s.textContent+'] ');
    return (tmp.textContent||'').replace(/\s+\n/g,'\n').replace(/\n{2,}/g,'\n');
  }

  // 성경 데이터 로드 유틸
  let __BOOKS_CACHE = null;
  async function getBooksInPopup(){
    if (__BOOKS_CACHE) return __BOOKS_CACHE;
    try{
      const P = w.opener || window.opener;
      if (P && P.BIBLE && P.BIBLE.books){
        __BOOKS_CACHE = P.BIBLE.books;
        return __BOOKS_CACHE;
      }
    }catch(_){}
    async function tryLoad(path){
      try{
        const res = await fetch(path, {cache:'no-store'});
        if(!res.ok) return null;
        const j = await res.json();
        return j && j.books ? j.books : null;
      }catch(_){ return null; }
    }
    __BOOKS_CACHE = await tryLoad('bible_paragraphs.json') || await tryLoad('bible-paragraph.json');
    if(!__BOOKS_CACHE) throw new Error('성경 데이터(BIBLE)를 불러올 수 없습니다.');
    return __BOOKS_CACHE;
  }

  function resolveBookKey(input,BOOKS){
    const s=normalizeBookName(input); const keys=Object.keys(BOOKS||{});
    const byNorm=new Map(keys.map(k=>[normalizeBookName(k),k])); if(byNorm.has(s)) return byNorm.get(s);
    const alias=BOOK_ALIAS_MAP(); if(alias[s] && BOOKS[alias[s]]) return alias[s];
    const startHit=keys.find(k=>normalizeBookName(k).startsWith(s)); if(startHit) return startHit;
    const inclHit=keys.find(k=>normalizeBookName(k).includes(s)); if(inclHit) return inclHit;
    return null;
  }
  function normalizeBookName(x){
    return String(x||'').toLowerCase().replace(/\s+/g,'').replace(/[.\u00B7]/g,'').replace(/서$/,'').replace(/복음서?$/,'복음')
    .replace(/첫째|둘째|셋째/g, m=>({'첫째':'1','둘째':'2','셋째':'3'}[m])).replace(/[일이삼]/g,m=>({'일':'1','이':'2','삼':'3'}[m]))
    .replace(/롬서?$/,'롬').replace(/고린도전서?$/,'고전').replace(/고린도후서?$/,'고후')
    .replace(/데살로니가전서?$/,'살전').replace(/데살로니가후서?$/,'살후')
    .replace(/디모데전서?$/,'딤전').replace(/디모데후서?$/,'딤후')
    .replace(/베드로전서?$/,'벧전').replace(/베드로후서?$/,'벧후')
    .replace(/요한일서?$/,'요1').replace(/요한이서?$/,'요2').replace(/요한삼서?$/,'요3');
  }
  function BOOK_ALIAS_MAP(){
    return {
      // 구약
      '창':'창세기','창세기':'창세기','창세':'창세기','출':'출애굽기','출애굽기':'출애굽기','출애':'출애굽기','레':'레위기','레위기':'레위기','민':'민수기','민수기':'민수기','신':'신명기','신명기':'신명기',
      '수':'여호수아','여호수아':'여호수아','삿':'사사기','사사기':'사사기','룻':'룻기','룻기':'룻기','삼상':'사무엘상','사무엘상':'사무엘상','삼하':'사무엘하','사무엘하':'사무엘하',
      '왕상':'열왕기상','열왕기상':'열왕기상','왕하':'열왕기하','열왕기하':'열왕기하','대상':'역대상','역대상':'역대상','대하':'역대하','역대하':'역대하',
      '스':'에스라','에스라':'에스라','느':'느헤미야','느헤미야':'느헤미야','에':'에스더','에스더':'에스더','욥':'욥기','욥기':'욥기','시':'시편','시편':'시편','잠':'잠언','잠언':'잠언',
      '전':'전도서','전도서':'전도서','아':'아가','아가':'아가','사':'이사야','이사야':'이사야','렘':'예레미야','예레미야':'예레미야','애':'예레미야애가','예레미야애가':'예레미야애가',
      '겔':'에스겔','에스겔':'에스겔','단':'다니엘','다니엘':'다니엘','호':'호세아','호세아':'호세아','욜':'요엘','요엘':'요엘','암':'아모스','아모스':'아모스','옵':'오바댜','오바댜':'오바댜',
      '욘':'요나','요나':'요나','미':'미가','미가':'미가','나':'나훔','나훔':'나훔','합':'하박국','하박국':'하박국','습':'스바냐','스바냐':'스바냐','학':'학개','학개':'학개','슥':'스가랴','스가랴':'스가랴','말':'말라기','말라기':'말라기',
      // 신약
      '마':'마태복음','마태':'마태복음','마태복음':'마태복음','막':'마가복음','마가':'마가복음','마가복음':'마가복음','눅':'누가복음','누가':'누가복음','누가복음':'누가복음',
      '요':'요한복음','요한복음':'요한복음','행':'사도행전','사도행전':'사도행전','롬':'로마서','로마서':'로마서','고전':'고린도전서','고린도전서':'고린도전서','고후':'고린도후서','고린도후서':'고린도후서',
      '갈':'갈라디아서','갈라디아서':'갈라디아서','엡':'에베소서','에베소서':'에베소서','빌':'빌립보서','빌립보서':'빌립보서','골':'골로새서','골로새서':'골로새서',
      '살전':'데살로니가전서','데살로니가전서':'데살로니가전서','살후':'데살로니가후서','데살로니가후서':'데살로니가후서','딤전':'디모데전서','디모데전서':'디모데전서','딤후':'디모데후서','디모데후서':'디모데후서',
      '딛':'디도서','디도서':'디도서','몬':'빌레몬서','빌레몬서':'빌레몬서','히':'히브리서','히브리서':'히브리서','약':'야고보서','야고보서':'야고보서',
      '벧전':'베드로전서','베드로전서':'베드로전서','벧후':'베드로후서','베드로후서':'베드로후서',
      '요1':'요한일서','요일1':'요한일서','요한일':'요한일서','요한일서':'요한일서','요2':'요한이서','요일2':'요한이서','요한이':'요한이서','요한이서':'요한이서',
      '요3':'요한삼서','요일3':'요한삼서','요한삼':'요한삼서','요한삼서':'요한삼서','유':'유다서','유다서':'유다서','계':'요한계시록','계시록':'요한계시록','요한계시록':'요한계시록'
    };
  }
}

/* ===== 모달 RTE 상단 패딩 자동 보정 ===== */
function adjustModalEditorPadding() {
  const wrap = document.getElementById('rteToolbar');
  const body = document.querySelector('#sermonEditor .rte');
  if (!body) return;
  const h = wrap ? (wrap.offsetHeight || 0) : 0;
  body.style.setProperty('--editor-pad-top', (h + 0) + 'px');
}
window.addEventListener('resize', adjustModalEditorPadding);
document.getElementById('sermonTitle')?.addEventListener('input', adjustModalEditorPadding);
window.addEventListener('load', adjustModalEditorPadding);

/* ===== 인라인 제목 편집 더미 ===== */
function startInlineTitleEdit(){ /* 필요 시 실제 구현으로 교체 */ }
