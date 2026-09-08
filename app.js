/* 医考题库 PWA 主逻辑 */
(function () {
  'use strict';

  // ---------- 数据 ----------
  const BANK = (window.QUESTION_BANK || []).map((q, i) => ({
    id: q.id || ('q' + i),
    subject: q.subject || '未分类',
    section: q.section || '',
    source: q.source || '',
    type: q.type || 'single',
    stem: (q.stem || '').trim(),
    options: Array.isArray(q.options) ? q.options : [],
    optionImages: Array.isArray(q.optionImages) ? q.optionImages : [],
    answer: (q.answer || '').trim(),
    explanation: (q.explanation || '').trim(),
  }));

  const TYPES = {
    single: '单选题',
    multiple: '多选题',
    judge: '判断题',
    definition: '名词解释',
    matching: '配伍题',
    case: '案例分析',
    shared: '共用备选',
  };

  // ---------- 状态 ----------
  const LS_KEY = 'medquiz_v1';
  const state = loadState();

  function defaultState() {
    return {
      memory: {}, wrong: {}, fav: {}, notes: {}, practice: {}, newToday: {},
      session: null,
      settings: { newPerDay: 20, reciteMode: false }
    };
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const merged = Object.assign(defaultState(), s);
        merged.settings = Object.assign({ newPerDay: 20, reciteMode: false }, s.settings || {});
        return merged;
      }
    } catch (e) { /* ignore */ }
    return defaultState();
  }
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---------- SM-2 间隔重复 ----------
  function dueCount() {
    const now = Date.now();
    let n = 0;
    for (const id in state.memory) {
      const c = state.memory[id];
      if (c.due && c.due <= now) n++;
    }
    return n;
  }

  function gradeMemory(id, grade) {
    // grade: 0=again 1=hard 2=good 3=easy
    const c = state.memory[id] || { interval: 0, ease: 2.5, reps: 0, due: 0, lapses: 0 };
    if (grade === 0) {
      c.reps = 0;
      c.interval = 0;
      c.lapses = (c.lapses || 0) + 1;
      c.ease = Math.max(1.3, (c.ease || 2.5) - 0.2);
    } else {
      if (grade === 1) {
        c.ease = Math.max(1.3, (c.ease || 2.5) - 0.15);
        c.interval = Math.max(1, Math.round((c.interval || 1) * 1.2));
      } else if (grade === 2) {
        if (c.reps === 0) c.interval = 1;
        else if (c.reps === 1) c.interval = 6;
        else c.interval = Math.round((c.interval || 1) * (c.ease || 2.5));
        c.reps = (c.reps || 0) + 1;
      } else {
        c.interval = Math.round(Math.max(1, c.interval || 1) * (c.ease || 2.5) * 1.3);
        c.ease = (c.ease || 2.5) + 0.15;
        c.reps = (c.reps || 0) + 1;
      }
    }
    c.due = Date.now() + c.interval * 86400000;
    state.memory[id] = c;
    saveState();
  }

  function dayKey() { return new Date().toDateString(); }
  function newCardLimit() { return state.settings.newPerDay || 20; }

  // 构建复习队列：到期卡片 + 每日新卡片
  function buildReviewQueue() {
    const now = Date.now();
    const due = [];
    const newCards = [];
    for (const q of BANK) {
      const c = state.memory[q.id];
      if (c && c.due && c.due <= now) {
        due.push(q);
      } else if (!c) {
        newCards.push(q);
      }
    }
    // 新卡片每次引入有限数量，避免一次太多
    const limit = newCardLimit();
    const selectedNew = newCards.slice(0, limit);
    // due 优先
    return due.concat(selectedNew);
  }

  // ---------- 工具 ----------
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  function normAnswer(a) {
    return (a || '').replace(/[，,、\s]/g, '').toUpperCase();
  }
  function isAutoGradable(q) {
    return (q.type === 'single' || q.type === 'multiple' || q.type === 'judge') && !!q.answer;
  }
  function answerLetters(q) {
    return normAnswer(q.answer);
  }
  function optionLetters(q) {
    return q.options.map((_, i) => String.fromCharCode(65 + i));
  }
  // 判断是否判对/错类型
  function isJudge(q) { return q.type === 'judge'; }

  function subjects() {
    const map = {};
    for (const q of BANK) {
      if (!map[q.subject]) map[q.subject] = 0;
      map[q.subject]++;
    }
    return Object.keys(map).sort((a, b) => map[b] - map[a]).map(s => ({ name: s, count: map[s] }));
  }

  function questionById(id) { return BANK.find(q => q.id === id); }

  // ---------- 视图路由 ----------
  let currentView = 'view-home';
  function showView(id, title) {
    if (id !== 'view-quiz') clearPracticeTimers();
    currentView = id;
    $$('.view').forEach(v => v.style.display = 'none');
    $('#' + id).style.display = 'block';
    $('#topbarTitle').textContent = title || '医考题库';
    $('#btnBack').style.display = (id === 'view-home') ? 'none' : 'block';
    $('#btnSearch').style.display = (id === 'view-home') ? 'block' : 'none';
    $('#main').scrollTop = 0;
    updateTabbar(id);
  }
  function updateTabbar(id) {
    const tabMap = { 'view-home': 'home', 'view-review': 'review', 'view-wrong': 'wrong', 'view-notes': 'notes' };
    const active = tabMap[id] || '';
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === active));
  }

  // ---------- 首页 ----------
  function renderHome() {
    const total = BANK.length;
    const due = dueCount();
    const wrongCount = Object.keys(state.wrong).length;
    const attempted = Object.keys(state.practice).length;
    const totals = Object.values(state.practice).reduce((a, p) => {
      a.all += p.total || 0; a.correct += p.correct || 0; return a;
    }, { all: 0, correct: 0 });
    const accuracy = totals.all ? Math.round(totals.correct / totals.all * 100) : 0;
    $('#statCards').innerHTML = `
      <div class="stat-card"><div class="num">${total}</div><div class="lbl">题库总量</div></div>
      <div class="stat-card"><div class="num">${attempted}</div><div class="lbl">已练题目</div></div>
      <div class="stat-card"><div class="num">${accuracy}%</div><div class="lbl">累计正确率</div></div>
    `;
    $('#dueBadge').textContent = due;
    $('#dueBadge').style.display = due ? 'flex' : 'none';

    const now = new Date();
    $('#heroDate').textContent = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${wrongCount ? `还有 ${wrongCount} 道错题待巩固` : '从一道题开始今天的学习'}`;
    const session = validSession();
    $('#continueCard').style.display = session ? 'flex' : 'none';
    if (session) {
      $('#continueMeta').textContent = `${session.meta.subject || '全部科目'} · 第 ${session.index + 1}/${session.ids.length} 题`;
    }

    const subs = subjects();
    $('#subjectList').innerHTML = subs.map(s => `
      <div class="subject-item" data-subject="${escapeAttr(s.name)}">
        <div class="s-name">${escapeHtml(s.name)}</div>
        <div class="s-count">${s.count} 题</div>
      </div>
    `).join('') || '<div class="list-empty">暂无题目</div>';
  }

  // ---------- 答题（刷题） ----------
  let practiceQueue = [];
  let practiceIndex = 0;
  let practiceMeta = {};
  let practiceResponses = {};
  let practiceTimeout = null;
  let practiceCountdown = null;

  function clearPracticeTimers() {
    if (practiceTimeout) clearTimeout(practiceTimeout);
    if (practiceCountdown) clearInterval(practiceCountdown);
    practiceTimeout = null;
    practiceCountdown = null;
  }

  function showCountdown(deadline) {
    const update = () => {
      const el = $('#autoCountdown');
      if (!el) return;
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      el.textContent = `${seconds} 秒后下一题`;
    };
    update();
    practiceCountdown = setInterval(update, 250);
  }

  function scheduleNextQuestion(correct) {
    clearPracticeTimers();
    if (practiceMeta.mode === 'single' || state.settings.reciteMode) return;
    const delay = correct ? 700 : 3000;
    if (!correct) showCountdown(Date.now() + delay);
    practiceTimeout = setTimeout(nextPractice, delay);
    if (!correct) {
      const pause = $('#btnPauseAuto');
      if (pause) pause.onclick = () => {
        clearPracticeTimers();
        pause.disabled = true;
        pause.textContent = '已暂停自动跳转';
        showToast('已暂停，可慢慢查看答案');
      };
    }
  }

  function startPractice(subject, options) {
    options = options || {};
    let list = subject ? BANK.filter(q => q.subject === subject) : BANK.slice();
    if (options.scope === 'unseen') list = list.filter(q => !state.practice[q.id]);
    if (options.scope === 'wrong') list = list.filter(q => state.wrong[q.id]);
    if (options.scope === 'fav') list = list.filter(q => state.fav[q.id]);
    if (options.random !== false) list = shuffle(list);
    const count = options.count === 'all' ? list.length : parseInt(options.count || 20, 10);
    practiceQueue = list.slice(0, count);
    practiceIndex = 0;
    practiceResponses = {};
    practiceMeta = {
      subject: subject || '全部科目',
      mode: 'practice',
      scope: options.scope || 'all',
    };
    state.session = { ids: practiceQueue.map(q => q.id), index: 0, meta: practiceMeta, responses: {}, correct: 0, answered: 0, startedAt: Date.now() };
    saveState();
    showView('view-quiz', '刷题练习');
    renderPractice();
  }

  function validSession() {
    const s = state.session;
    return s && Array.isArray(s.ids) && s.ids.length && s.index < s.ids.length ? s : null;
  }

  function resumePractice() {
    const s = validSession();
    if (!s) return;
    practiceQueue = s.ids.map(questionById).filter(Boolean);
    practiceIndex = Math.min(s.index || 0, Math.max(0, practiceQueue.length - 1));
    practiceMeta = s.meta || { subject: '全部科目', mode: 'practice' };
    practiceResponses = s.responses || {};
    showView('view-quiz', '继续练习');
    renderPractice();
  }

  function nextPractice() {
    clearPracticeTimers();
    practiceIndex++;
    if (state.session && practiceMeta.mode === 'practice') {
      state.session.index = practiceIndex;
      saveState();
    }
    renderPractice();
  }

  function previousPractice() {
    clearPracticeTimers();
    if (practiceIndex <= 0) return;
    practiceIndex--;
    if (state.session && practiceMeta.mode === 'practice') {
      state.session.index = practiceIndex;
      saveState();
    }
    renderPractice();
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderPractice() {
    clearPracticeTimers();
    const q = practiceQueue[practiceIndex];
    if (!q) {
      const s = practiceMeta.mode === 'practice' ? state.session : null;
      const responses = Object.values(practiceResponses);
      const answered = s ? s.answered : responses.length;
      const correct = s ? s.correct : responses.filter(r => r.correct).length;
      const rate = answered ? Math.round(correct / answered * 100) : 0;
      $('#quizBody').innerHTML = `<div class="list-empty"><span class="big">✓</span><b>本组练习完成</b><br><span style="font-size:14px">答题 ${answered} 道 · 正确率 ${rate}%</span></div>`;
      const collectionNames = { wrong: '错题', notes: '笔记', fav: '收藏' };
      const doneText = practiceMeta.collection ? `返回${collectionNames[practiceMeta.collection] || ''}分类` : '返回首页';
      $('#quizFoot').innerHTML = `<button class="btn btn-primary" id="practiceDone">${doneText}</button>`;
      if (practiceMeta.mode === 'practice') {
        state.session = null;
        saveState();
      }
      $('#practiceDone').onclick = () => {
        if (practiceMeta.collection) renderCollection(practiceMeta.collection);
        else { renderHome(); showView('view-home', '医考题库'); }
      };
      return;
    }
    if (state.session && practiceMeta.mode === 'practice') {
      state.session.index = practiceIndex;
      saveState();
    }
    const total = practiceQueue.length;
    $('#quizProgress').innerHTML = `
      <span>${practiceIndex + 1} / ${total}</span>
      <div class="bar"><div class="bar-fill" style="width:${((practiceIndex) / total) * 100}%"></div></div>
    `;
    $('#quizMeta').innerHTML = `${escapeHtml(q.subject)} · ${TYPES[q.type] || q.type} · 左右滑动切题`;
    $('#quizBody').innerHTML = renderQuestion(q, 'practice');
    $('#quizFoot').innerHTML = renderPracticeFoot(q);
    const saved = practiceResponses[q.id];
    if (state.settings.reciteMode) {
      revealReciteAnswer(q);
    } else if (saved) {
      const opts = $$('#quizBody .opt');
      const savedSelection = Array.isArray(saved.selected) ? saved.selected : [];
      opts.forEach(o => o.classList.toggle('selected', savedSelection.includes(o.dataset.val)));
      revealAnswer(q, opts, savedSelection, 'practice', { correct: saved.correct, restored: true, selfGraded: saved.selfGraded === true });
    } else {
      bindPractice(q);
    }
  }

  function renderQuestion(q, mode) {
    let html = '';
    const typeLabel = TYPES[q.type] || q.type;
    html += `<div class="q-type">${typeLabel}</div>`;
    if (q.section) html += `<div class="quiz-meta" style="margin-bottom:6px">${escapeHtml(q.section)}</div>`;
    html += `<div class="q-stem">${escapeHtml(q.stem)}</div>`;

    if (isJudge(q)) {
      html += `<div class="opt" data-val="对"><div class="opt-letter">✓</div><div class="opt-txt">正确</div></div>`;
      html += `<div class="opt" data-val="错"><div class="opt-letter">✗</div><div class="opt-txt">错误</div></div>`;
    } else if (q.options.length) {
      q.options.forEach((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const image = q.optionImages[i] ? `<img class="opt-image" src="${escapeAttr(q.optionImages[i])}" alt="选项 ${letter} 图片" loading="lazy">` : '';
        html += `<div class="opt" data-val="${letter}"><div class="opt-letter">${letter}</div><div class="opt-txt">${escapeHtml(opt)}${image}</div></div>`;
      });
    } else {
      html += `<div class="list-empty" style="padding:20px">（无选项）</div>`;
    }
    return html;
  }

  function renderPracticeFoot(q) {
    const previous = `<button class="btn btn-secondary btn-prev" id="btnPrev" ${practiceIndex === 0 ? 'disabled' : ''}>上一题</button>`;
    if (isAutoGradable(q)) {
      if (q.type === 'multiple') {
        return `<div class="practice-actions">${previous}<button class="btn btn-secondary" id="btnReveal">显示答案</button>
                <button class="btn btn-primary" id="btnSubmit" disabled>提交</button></div>`;
      }
      return `<div class="practice-actions">${previous}<div class="answer-tip">选择答案后自动判定</div></div>`;
    }
    // 名词解释/配伍/案例：自评模式
    return `<div class="practice-actions">${previous}<button class="btn btn-secondary" id="btnReveal">显示答案</button></div>`;
  }

  function correctSelections(q) {
    const letters = answerLetters(q);
    if (isJudge(q)) {
      const ansIsTrue = letters === '对' || letters === '正确' || letters === 'A' || letters === 'TRUE' || letters === '√';
      return [ansIsTrue ? '对' : '错'];
    }
    return isAutoGradable(q) ? letters.split('') : [];
  }

  function revealReciteAnswer(q) {
    const opts = $$('#quizBody .opt');
    const selected = correctSelections(q);
    opts.forEach(o => o.classList.toggle('selected', selected.includes(o.dataset.val)));
    revealAnswer(q, opts, selected, 'practice', { restored: true, selfGraded: true });
  }

  function bindPractice(q) {
    const opts = $$('#quizBody .opt');
    let selected = [];
    const isMulti = q.type === 'multiple';
    let answered = false;

    const previousBtn = $('#btnPrev');
    if (previousBtn) previousBtn.onclick = previousPractice;

    opts.forEach(o => {
      o.onclick = () => {
        if (o.classList.contains('disabled')) return;
        if (isMulti) {
          o.classList.toggle('selected');
        } else {
          opts.forEach(x => x.classList.remove('selected'));
          o.classList.add('selected');
        }
        updateSelected();
        if (!isMulti && isAutoGradable(q) && !answered) {
          answered = true;
          opts.forEach(x => x.classList.add('disabled'));
          gradePractice(q, selected);
        }
      };
    });

    function updateSelected() {
      selected = opts.filter(o => o.classList.contains('selected')).map(o => o.dataset.val);
      const btn = $('#btnSubmit');
      if (btn) btn.disabled = selected.length === 0;
    }

    const revealBtn = $('#btnReveal');
    if (revealBtn) revealBtn.onclick = () => revealAnswer(q, opts, selected, 'practice', null);

    const submitBtn = $('#btnSubmit');
    if (submitBtn) {
      submitBtn.onclick = () => {
        if (isAutoGradable(q)) gradePractice(q, selected);
      };
    }
  }

  function revealAnswer(q, opts, selected, mode, outcome) {
    if ($('#quizBody .answer-box')) return;
    clearPracticeTimers();
    const letters = answerLetters(q);
    opts.forEach(o => o.classList.add('disabled'));
    // 标注正确
    if (isJudge(q)) {
      const ansIsTrue = letters === '对' || letters === '正确' || letters === 'A' || letters === 'TRUE' || letters === '√';
      opts.forEach(o => {
        const v = o.dataset.val === '对';
        if (v === ansIsTrue) o.classList.add('correct');
      });
    } else {
      opts.forEach(o => {
        if (letters.includes(o.dataset.val)) o.classList.add('correct');
      });
    }
    // 标注用户选错
    selected.forEach(v => {
      const o = opts.find(x => x.dataset.val === v);
      if (!o) return;
      if (isJudge(q)) {
        const ansIsTrue = letters === '对' || letters === '正确' || letters === 'A' || letters === 'TRUE' || letters === '√';
        if ((v === '对') !== ansIsTrue) o.classList.add('wrong');
      } else if (!letters.includes(v)) {
        o.classList.add('wrong');
      }
    });
    if (outcome && typeof outcome.correct === 'boolean' && !outcome.restored) {
      const result = document.createElement('div');
      result.className = `answer-result ${outcome.correct ? 'is-correct' : 'is-wrong'}`;
      result.textContent = outcome.correct ? '✓ 回答正确' : '✗ 回答错误，正确答案如下';
      $('#quizBody').appendChild(result);
    }
    appendAnswerBox(q, mode, selected);
    // 切换底部按钮
    const foot = $('#quizFoot');
    if (!isAutoGradable(q) && !(outcome && outcome.selfGraded)) {
      // 自评模式：显示"我答对了/我答错了"
      foot.innerHTML = `<div class="practice-actions">
        <button class="btn btn-secondary btn-prev" id="btnPrev" ${practiceIndex === 0 ? 'disabled' : ''}>上一题</button>
        <button class="btn grade-btn grade-good" id="btnSelfRight">✓ 我答对了</button>
        <button class="btn grade-btn grade-again" id="btnSelfWrong">✗ 我答错了</button></div>`;
      $('#btnPrev').onclick = previousPractice;
      $('#btnSelfRight').onclick = () => selfGrade(q, true);
      $('#btnSelfWrong').onclick = () => selfGrade(q, false);
    } else {
      const shouldAuto = outcome && typeof outcome.correct === 'boolean' && !outcome.restored && practiceMeta.mode !== 'single' && !state.settings.reciteMode;
      const pause = shouldAuto && !outcome.correct
        ? '<button class="btn btn-secondary btn-pause" id="btnPauseAuto"><span id="autoCountdown">3 秒后下一题</span><small>暂停</small></button>'
        : '';
      foot.innerHTML = `<div class="practice-actions"><button class="btn btn-secondary btn-prev" id="btnPrev" ${practiceIndex === 0 ? 'disabled' : ''}>上一题</button>${pause}<button class="btn btn-primary" id="btnNext">下一题</button></div>`;
      $('#btnPrev').onclick = previousPractice;
      $('#btnNext').onclick = nextPractice;
      if (shouldAuto) scheduleNextQuestion(outcome.correct);
    }
    showNoteEditor(q);
  }

  function gradePractice(q, selected) {
    if (practiceResponses[q.id]) return;
    const letters = answerLetters(q);
    let correct = false;
    if (isJudge(q)) {
      const ansIsTrue = letters === '对' || letters === '正确' || letters === 'A' || letters === 'TRUE' || letters === '√';
      const userTrue = selected[0] === '对';
      correct = (ansIsTrue === userTrue);
    } else {
      const userSet = selected.sort().join('');
      const ansSet = letters.split('').sort().join('');
      correct = userSet === ansSet;
    }
    // 记录
    const p = state.practice[q.id] || { total: 0, correct: 0 };
    p.total++;
    if (correct) {
      p.correct++;
      delete state.wrong[q.id];
    } else {
      state.wrong[q.id] = 1;
    }
    state.practice[q.id] = p;
    practiceResponses[q.id] = { selected: selected.slice(), correct };
    if (state.session && practiceMeta.mode === 'practice') {
      state.session.answered = (state.session.answered || 0) + 1;
      if (correct) state.session.correct = (state.session.correct || 0) + 1;
      state.session.responses = practiceResponses;
    }
    saveState();

    revealAnswer(q, $$('#quizBody .opt'), selected, 'practice', { correct, restored: false });
  }

  function selfGrade(q, correct) {
    if (practiceResponses[q.id]) return;
    const p = state.practice[q.id] || { total: 0, correct: 0 };
    p.total++;
    if (correct) { p.correct++; delete state.wrong[q.id]; } else state.wrong[q.id] = 1;
    state.practice[q.id] = p;
    practiceResponses[q.id] = { selected: [], correct, selfGraded: true };
    if (state.session && practiceMeta.mode === 'practice') {
      state.session.answered = (state.session.answered || 0) + 1;
      if (correct) state.session.correct = (state.session.correct || 0) + 1;
      state.session.responses = practiceResponses;
    }
    saveState();
    const foot = $('#quizFoot');
    foot.innerHTML = `<div class="practice-actions"><button class="btn btn-secondary btn-prev" id="btnPrev" ${practiceIndex === 0 ? 'disabled' : ''}>上一题</button><button class="btn btn-primary" id="btnNext">下一题</button></div>`;
    $('#btnPrev').onclick = previousPractice;
    $('#btnNext').onclick = nextPractice;
  }

  function appendAnswerBox(q, mode, selected) {
    const body = mode === 'review' ? $('#reviewBody') : $('#quizBody');
    let ansTxt = q.answer;
    if (isJudge(q)) {
      const a = answerLetters(q);
      ansTxt = (a === '对' || a === '正确' || a === 'A' || a === 'TRUE' || a === '√') ? '正确' : '错误';
    }
    const box = document.createElement('div');
    box.className = 'answer-box';
    const ansDisplay = ansTxt ? `<span class="ab-ans">${escapeHtml(ansTxt)}</span>` : '<span class="ab-ans wrong-ans">（此题暂无答案）</span>';
    box.innerHTML = `<div class="ab-head">正确答案：${ansDisplay}</div>
      ${q.explanation && q.explanation !== '暂无解析' ? `<div class="ab-expl">${escapeHtml(q.explanation)}</div>` : ''}
      ${q.source ? `<div class="quiz-meta" style="margin-top:9px">来源：${escapeHtml(q.source)}</div>` : ''}`;
    body.appendChild(box);
    // 收藏按钮
    const favBtn = document.createElement('button');
    favBtn.className = 'btn btn-secondary';
    favBtn.style.marginTop = '12px';
    favBtn.textContent = state.fav[q.id] ? '⭐ 已收藏' : '☆ 收藏';
    favBtn.onclick = () => {
      if (state.fav[q.id]) delete state.fav[q.id]; else state.fav[q.id] = 1;
      saveState();
      favBtn.textContent = state.fav[q.id] ? '⭐ 已收藏' : '☆ 收藏';
      showToast(state.fav[q.id] ? '已加入收藏' : '已取消收藏');
    };
    body.appendChild(favBtn);
  }

  function showNoteEditor(q) {
    const body = $('#quizBody');
    if (body.querySelector('.note-editor')) return;
    const wrap = document.createElement('div');
    wrap.className = 'note-editor';
    wrap.innerHTML = `<div class="card-title" style="padding:10px 0 4px">📝 我的笔记</div>
      <textarea placeholder="记录你的笔记...">${escapeHtml(state.notes[q.id] || '')}</textarea>
      <div class="note-saved" style="display:none">已保存 ✓</div>`;
    body.appendChild(wrap);
    const ta = wrap.querySelector('textarea');
    const saved = wrap.querySelector('.note-saved');
    let t;
    ta.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.notes[q.id] = ta.value;
        saveState();
        saved.style.display = 'block';
        setTimeout(() => saved.style.display = 'none', 1500);
      }, 400);
    });
  }

  // ---------- 复习 ----------
  let reviewQueue = [];
  let reviewIndex = 0;

  function startReview() {
    reviewQueue = buildReviewQueue();
    reviewIndex = 0;
    showView('view-review', '记忆复习');
    renderReview();
  }

  function renderReview() {
    const q = reviewQueue[reviewIndex];
    if (!q) {
      $('#reviewBody').innerHTML = '<div class="list-empty"><span class="big">🎉</span>今日复习完成</div>';
      $('#reviewFoot').innerHTML = '<button class="btn btn-primary" id="reviewDone">返回首页</button>';
      $('#reviewDone').onclick = () => { showView('view-home', '医考题库'); };
      return;
    }
    const total = reviewQueue.length;
    const card = state.memory[q.id];
    $('#reviewProgress').innerHTML = `
      <span>${reviewIndex + 1} / ${total}</span>
      <div class="bar"><div class="bar-fill" style="width:${(reviewIndex / total) * 100}%"></div></div>
    `;
    $('#reviewMeta').textContent = `${escapeHtml(q.subject)} · ${TYPES[q.type] || q.type}${card ? ' · 复习' : ' · 新卡片'}`;
    $('#reviewBody').innerHTML = renderQuestion(q, 'review');
    $('#reviewFoot').innerHTML = `<button class="btn btn-primary" id="btnShowAns">显示答案</button>`;
    $('#btnShowAns').onclick = () => revealReviewAnswer(q);
    if (state.settings.reciteMode) revealReviewAnswer(q);
  }

  function revealReviewAnswer(q) {
      const opts = $$('#reviewBody .opt');
      const selected = correctSelections(q);
      opts.forEach(o => {
        o.classList.add('disabled');
        if (selected.includes(o.dataset.val)) o.classList.add('selected', 'correct');
      });
      appendAnswerBox(q, 'review', selected);
      if (state.settings.reciteMode) {
        $('#reviewFoot').innerHTML = '<button class="btn btn-primary" id="btnReviewNext">下一题</button>';
        $('#btnReviewNext').onclick = () => {
          reviewIndex++;
          renderReview();
        };
        return;
      }
      $('#reviewFoot').innerHTML = `
        <div class="grade-row">
          <button class="grade-btn grade-again" data-g="0">重来<br><small>再见</small></button>
          <button class="grade-btn grade-hard" data-g="1">困难<br><small>加长</small></button>
          <button class="grade-btn grade-good" data-g="2">良好<br><small>正常</small></button>
          <button class="grade-btn grade-easy" data-g="3">简单<br><small>加长</small></button>
        </div>`;
      $$('#reviewFoot .grade-btn').forEach(b => {
        b.onclick = () => {
          gradeMemory(q.id, parseInt(b.dataset.g, 10));
          reviewIndex++;
          renderReview();
        };
      });
  }

  // ---------- 列表（错题/笔记/收藏/科目） ----------
  function collectionItems(kind) {
    const ids = kind === 'wrong'
      ? new Set(Object.keys(state.wrong))
      : kind === 'fav'
        ? new Set(Object.keys(state.fav))
        : new Set(Object.keys(state.notes).filter(id => state.notes[id]));
    return BANK.filter(q => ids.has(q.id));
  }

  function renderCollection(kind) {
    const isWrong = kind === 'wrong';
    const isFav = kind === 'fav';
    const title = isWrong ? '错题本' : isFav ? '我的收藏' : '我的笔记';
    const icon = isWrong ? '📕' : isFav ? '⭐' : '📝';
    const itemName = isWrong ? '错题' : isFav ? '收藏题' : '笔记题';
    const items = collectionItems(kind);
    const grouped = new Map();
    items.forEach(q => grouped.set(q.subject, (grouped.get(q.subject) || 0) + 1));
    showView('view-list', title);
    if (!items.length) {
      $('#listContent').innerHTML = `<div class="list-empty"><span class="big">${icon}</span>空空如也</div>`;
      return;
    }
    const categories = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);
    $('#listContent').innerHTML = `
      <div class="collection-summary">
        <div><b>${items.length} 道${itemName}</b><p>按科目进入连续刷题，左右滑动也可切题</p></div>
        <button class="btn btn-primary" id="practiceCollectionAll">全部连续练习</button>
      </div>
      <div class="card subject-card collection-subjects">
        <div class="card-title">按科目分类</div>
        <div class="subject-list">${categories.map(([subject, count]) => `
          <div class="subject-item" data-subject="${escapeAttr(subject)}">
            <div class="s-name">${escapeHtml(subject)}</div>
            <div class="s-count">${count} 题 · 开始 ›</div>
          </div>`).join('')}</div>
      </div>`;
    $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === kind));
    $('#practiceCollectionAll').onclick = () => startCollectionPractice(kind, null);
    $$('#listContent .subject-item').forEach(item => {
      item.onclick = () => startCollectionPractice(kind, item.dataset.subject);
    });
  }

  function startCollectionPractice(kind, subject) {
    let items = collectionItems(kind);
    if (subject) items = items.filter(q => q.subject === subject);
    if (!items.length) {
      showToast('这个分类暂时没有题目');
      renderCollection(kind);
      return;
    }
    practiceQueue = items;
    practiceIndex = 0;
    practiceResponses = {};
    practiceMeta = {
      subject: subject || (kind === 'wrong' ? '全部错题' : kind === 'fav' ? '全部收藏' : '全部笔记'),
      mode: 'collection',
      collection: kind,
    };
    showView('view-quiz', kind === 'wrong' ? '错题巩固' : kind === 'fav' ? '收藏练习' : '笔记复习');
    renderPractice();
  }

  function renderList(title, ids, emptyMsg) {
    showView('view-list', title);
    const items = ids.map(id => questionById(id)).filter(Boolean);
    $('#listContent').innerHTML = items.map(q => `
      <div class="list-card" data-id="${escapeAttr(q.id)}">
        <div class="lc-meta"><span class="lc-subject">${escapeHtml(q.subject)}</span> · ${TYPES[q.type] || q.type}</div>
        <div class="lc-stem">${escapeHtml(q.stem)}</div>
        ${state.notes[q.id] ? `<div class="lc-meta" style="margin-top:6px">📝 ${escapeHtml(state.notes[q.id].slice(0, 60))}${state.notes[q.id].length > 60 ? '…' : ''}</div>` : ''}
      </div>
    `).join('') || `<div class="list-empty"><span class="big">${emptyMsg}</span>空空如也</div>`;
    $$('#listContent .list-card').forEach(c => {
      c.onclick = () => openQuestion(c.dataset.id);
    });
  }

  function openQuestion(id) {
    // 在刷题模式中打开单个题目
    practiceQueue = [questionById(id)];
    practiceIndex = 0;
    practiceResponses = {};
    practiceMeta = { subject: '', mode: 'single' };
    showView('view-quiz', '题目详情');
    renderPractice();
  }

  // ---------- 搜索 ----------
  function openSearch() {
    showView('view-search', '搜索题目');
    const input = $('#searchInput');
    input.value = '';
    $('#searchResults').innerHTML = '';
    $('#searchHint').textContent = `输入关键词查找 ${BANK.length} 道题`;
    setTimeout(() => input.focus(), 80);
  }

  function searchQuestions(keyword) {
    const key = (keyword || '').trim().toLowerCase();
    if (!key) {
      $('#searchResults').innerHTML = '';
      $('#searchHint').textContent = `输入关键词查找 ${BANK.length} 道题`;
      return;
    }
    const items = BANK.filter(q => {
      const text = [q.subject, q.section, q.stem].concat(q.options).join(' ').toLowerCase();
      return text.includes(key);
    }).slice(0, 100);
    $('#searchHint').textContent = items.length === 100 ? '已显示前 100 条结果，请输入更多关键词缩小范围' : `找到 ${items.length} 道题`;
    $('#searchResults').innerHTML = items.map(q => `
      <div class="list-card" data-id="${escapeAttr(q.id)}">
        <div class="lc-meta"><span class="lc-subject">${escapeHtml(q.subject)}</span> · ${TYPES[q.type] || q.type}</div>
        <div class="lc-stem">${escapeHtml(q.stem)}</div>
      </div>`).join('') || '<div class="list-empty"><span class="big">⌕</span>没有找到相关题目</div>';
    $$('#searchResults .list-card').forEach(c => { c.onclick = () => openQuestion(c.dataset.id); });
  }

  // ---------- 练习配置 ----------
  function configuredPool() {
    const subject = $('#practiceSubject').value;
    const scope = $('#practiceScope').value;
    let list = subject ? BANK.filter(q => q.subject === subject) : BANK;
    if (scope === 'unseen') list = list.filter(q => !state.practice[q.id]);
    if (scope === 'wrong') list = list.filter(q => state.wrong[q.id]);
    if (scope === 'fav') list = list.filter(q => state.fav[q.id]);
    return list;
  }

  function updateConfigAvailable() {
    const n = configuredPool().length;
    $('#configAvailable').textContent = `当前范围可练习 ${n} 道题`;
    $('#startConfigured').disabled = n === 0;
  }

  function openPracticeConfig() {
    $('#practiceSubject').innerHTML = '<option value="">全部科目</option>' + subjects().map(s =>
      `<option value="${escapeAttr(s.name)}">${escapeHtml(s.name)}（${s.count}）</option>`).join('');
    updateConfigAvailable();
    $('#configMask').classList.add('show');
    $('#configSheet').classList.add('show');
  }

  function closePracticeConfig() {
    $('#configMask').classList.remove('show');
    $('#configSheet').classList.remove('show');
  }

  // ---------- 设置与数据 ----------
  function openSettings() {
    $('#newPerDay').value = String(state.settings.newPerDay || 20);
    $('#reciteMode').checked = state.settings.reciteMode === true;
    showView('view-settings', '设置与数据');
  }

  function exportData() {
    const payload = { app: '医考题库', version: 3, exportedAt: new Date().toISOString(), state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `医考题库备份-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('学习数据已导出');
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const incoming = parsed.state || parsed;
        if (!incoming || typeof incoming !== 'object') throw new Error('invalid');
        localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(defaultState(), incoming)));
        showToast('恢复成功，即将刷新');
        setTimeout(() => location.reload(), 700);
      } catch (e) {
        showToast('无法识别这个备份文件');
      }
    };
    reader.readAsText(file);
  }

  let toastTimer;
  function showToast(message) {
    const el = $('#toast');
    if (!el) return;
    clearTimeout(toastTimer);
    el.textContent = message;
    el.classList.add('show');
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ---------- 科目选择 sheet ----------
  function showSubjectSheet(cb) {
    showSheet('选择科目', subjects().map(s => ({
      label: `${s.name}（${s.count} 题）`,
      value: s.name,
    })), cb);
  }

  function showSheet(title, options, cb) {
    const mask = $('.sheet-mask');
    const sheet = $('.sheet');
    sheet.innerHTML = `<h3>${title}</h3>` + options.map((o, i) =>
      `<div class="sheet-option" data-i="${i}">${escapeHtml(o.label)}</div>`).join('');
    sheet.classList.add('show');
    mask.classList.add('show');
    sheet.querySelectorAll('.sheet-option').forEach(el => {
      el.onclick = () => {
        closeSheet();
        cb(options[parseInt(el.dataset.i, 10)]);
      };
    });
    mask.onclick = closeSheet;
  }
  function closeSheet() {
    $('.sheet').classList.remove('show');
    $('.sheet-mask').classList.remove('show');
  }

  // ---------- 转义 ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function bindSwipeNavigation() {
    const surface = $('#quizBody');
    let startX = 0;
    let startY = 0;
    let tracking = false;
    surface.addEventListener('touchstart', event => {
      const target = event.target;
      if (target && target.closest && target.closest('textarea, input, button')) return;
      const touch = event.changedTouches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
      surface.classList.remove('swipe-reset');
    }, { passive: true });
    surface.addEventListener('touchmove', event => {
      if (!tracking) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        surface.style.transform = `translateX(${Math.max(-28, Math.min(28, dx * 0.16))}px)`;
        surface.style.opacity = String(Math.max(0.78, 1 - Math.abs(dx) / 600));
      }
    }, { passive: true });
    surface.addEventListener('touchend', event => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      surface.classList.add('swipe-reset');
      surface.style.transform = '';
      surface.style.opacity = '';
      if (currentView !== 'view-quiz' || Math.abs(dx) < 55 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      if (dx < 0) nextPractice();
      else previousPractice();
    }, { passive: true });
  }

  // ---------- 事件绑定 ----------
  function bindNav() {
    $('#btnBack').onclick = () => {
      if (currentView === 'view-quiz' && practiceMeta.collection) {
        renderCollection(practiceMeta.collection);
      } else {
        renderHome();
        showView('view-home', '医考题库');
      }
    };
    $('#btnSearch').onclick = openSearch;
    $('#quickSearch').onclick = openSearch;
    $('#continueCard').onclick = resumePractice;

    $$('.tab').forEach(t => {
      t.onclick = () => {
        const tab = t.dataset.tab;
        if (tab === 'home') showView('view-home', '医考题库');
        else if (tab === 'review') startReview();
        else if (tab === 'wrong') renderCollection('wrong');
        else if (tab === 'notes') renderCollection('notes');
      };
    });

    $('#menuPractice').onclick = openPracticeConfig;

    $('#menuReview').onclick = startReview;
    $('#menuWrong').onclick = () => renderCollection('wrong');
    $('#menuNotes').onclick = () => renderCollection('notes');
    $('#menuFav').onclick = () => renderCollection('fav');
    $('#menuSettings').onclick = openSettings;

    $('#closeConfig').onclick = closePracticeConfig;
    $('#configMask').onclick = closePracticeConfig;
    $('#practiceSubject').onchange = updateConfigAvailable;
    $('#practiceScope').onchange = updateConfigAvailable;
    $('#startConfigured').onclick = () => {
      const subject = $('#practiceSubject').value || null;
      const options = {
        scope: $('#practiceScope').value,
        count: $('#practiceCount').value,
        random: $('#practiceRandom').checked,
      };
      closePracticeConfig();
      startPractice(subject, options);
    };

    let searchTimer;
    $('#searchInput').addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => searchQuestions(e.target.value), 120);
    });

    $('#newPerDay').onchange = e => {
      state.settings.newPerDay = parseInt(e.target.value, 10) || 20;
      saveState();
      showToast('学习设置已保存');
    };
    $('#reciteMode').onchange = e => {
      state.settings.reciteMode = e.target.checked;
      saveState();
      showToast(e.target.checked ? '背题模式已开启' : '背题模式已关闭');
    };
    $('#btnExport').onclick = exportData;
    $('#btnImport').onclick = () => $('#importFile').click();
    $('#importFile').onchange = e => importData(e.target.files[0]);
  }

  // ---------- 初始化 ----------
  function init() {
    // 确保 sheet 元素存在
    if (!$('.sheet-mask')) {
      document.body.insertAdjacentHTML('beforeend',
        '<div class="sheet-mask"></div><div class="sheet"></div>');
    }
    bindNav();
    bindSwipeNavigation();
    renderHome();
    if (window.location.hash === '#review') startReview();

    // 注册 service worker
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if (standalone || (window.navigator && window.navigator.standalone)) $('#installCard').style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
