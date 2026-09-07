/* 公共脚本：接口封装 / 顶部导航 / 登录态 / 倒计时 */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------- 接口 ---------- */
  async function api(path, options) {
    const opts = Object.assign({ method: 'GET', headers: {} }, options || {});
    if (opts.body && typeof opts.body === 'object') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    let res, data;
    try {
      res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts));
      data = await res.json();
    } catch (e) {
      toast('网络异常，请稍后重试', 'err');
      throw e;
    }
    if (!res.ok || data.ok === false) {
      if (res.status === 401 || res.status === 403) {
        if (typeof window.onNeedLogin === 'function' && res.status === 401) window.onNeedLogin();
      }
      const err = new Error(data.msg || ('请求失败(' + res.status + ')'));
      err.code = res.status; err.data = data;
      throw err;
    }
    return data;
  }
  const get = p => api(p);
  const post = (p, b) => api(p, { method: 'POST', body: b || {} });
  const put = (p, b) => api(p, { method: 'PUT', body: b || {} });
  const del = p => api(p, { method: 'DELETE' });

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg, type) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast'; el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  /* ---------- 格式化 ---------- */
  const money = n => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const int = n => Math.round(Number(n) || 0).toLocaleString('zh-CN');
  function fmtTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts), p = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtDur(ms) {
    if (ms <= 0) return '已到期';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600),
      m = Math.floor(s % 3600 / 60), ss = s % 60;
    if (d > 0) return `${d}天 ${p2(h)}:${p2(m)}:${p2(ss)}`;
    return `${p2(h)}:${p2(m)}:${p2(ss)}`;
  }
  const p2 = x => String(x).padStart(2, '0');

  /* ---------- 顶部导航 ---------- */
  const PAGES = [
    { href: '/index.html', key: 'home', name: '首页' },
    { href: '/app.html', key: 'app', name: '利润计算' },
    { href: '/recharge.html', key: 'recharge', name: '充值会员' }
  ];

  async function mountNav(active) {
    const root = $('#nav-root');
    if (!root) return;
    let cfg = { siteName: '拼多多利润计算器', plans: [] };
    try { cfg = (await get('/api/config')).config; } catch (e) { }
    let me = { user: null };
    try { me = await get('/api/me'); } catch (e) { }

    const links = PAGES.map(p =>
      `<a href="${p.href}" class="${p.key === active ? 'active' : ''}">${p.name}</a>`).join('');

    let right = '';
    if (me.user) {
      right = `
        <span class="time-chip" id="timeChip" title="会员有效期至 ${fmtTime(me.user.expireAt)}">
          <span class="dot"></span><span id="timeText">--</span>
        </span>
        <span class="nav-user"><span class="avatar">${(me.user.username[0] || 'U').toUpperCase()}</span>${escapeHtml(me.user.nickname || me.user.username)}</span>
        <button class="btn btn-ghost btn-sm" id="btnLogout">退出</button>
        <a class="btn btn-primary btn-sm" href="/recharge.html">充值</a>`;
    } else {
      right = `
        <span class="time-chip expired"><span class="dot"></span>未登录</span>
        <a class="btn btn-ghost btn-sm" href="/login.html">登录</a>
        <a class="btn btn-primary btn-sm" href="/register.html">注册领 24 小时</a>`;
    }

    root.innerHTML = `
      <div class="nav">
        <div class="nav-inner">
          <a class="logo" href="/index.html">
            <span class="logo-mark">¥</span><span>${escapeHtml(cfg.siteName)}</span>
          </a>
          <button class="btn btn-ghost btn-sm nav-toggle" id="navToggle">菜单</button>
          <div class="nav-links" id="navLinks">${links}</div>
          <div class="nav-right">${right}</div>
        </div>
      </div>`;

    const tg = $('#navToggle'), nl = $('#navLinks');
    if (tg) tg.onclick = () => nl.classList.toggle('show');
    const lo = $('#btnLogout');
    if (lo) lo.onclick = async () => {
      try { await post('/api/logout'); } catch (e) { }
      location.href = '/index.html';
    };

    if (me.user) startCountdown(me.user.expireAt, me.user.status);
    window.__cfg = cfg;
    window.__me = me.user;
    if (typeof window.onNavReady === 'function') window.onNavReady(cfg, me.user);
  }

  let cdTimer = null;
  function startCountdown(expireAt, status) {
    const chip = $('#timeChip'), text = $('#timeText');
    if (!chip || !text) return;
    if (status === 'disabled') {
      chip.classList.add('expired'); text.textContent = '账号已停用'; return;
    }
    function tick() {
      const left = (expireAt || 0) - Date.now();
      if (left <= 0) {
        chip.classList.add('expired');
        text.textContent = '会员已到期 · 去充值';
        return;
      }
      chip.classList.remove('expired');
      text.textContent = '可用 ' + fmtDur(left);
    }
    tick();
    clearInterval(cdTimer);
    cdTimer = setInterval(tick, 1000);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 登录守卫 ---------- */
  async function requireUser(redirectTo) {
    let me;
    try { me = await get('/api/me'); } catch (e) { return null; }
    if (!me.user) {
      location.href = '/login.html?next=' + encodeURIComponent(redirectTo || location.pathname);
      return null;
    }
    return me.user;
  }

  window.App = {
    $, $$, api, get, post, put, del, toast, money, int, fmtTime, fmtDur,
    mountNav, requireUser, escapeHtml, startCountdown
  };

  document.addEventListener('DOMContentLoaded', () => {
    const active = document.body.dataset.nav || '';
    if ($('#nav-root') && !document.body.dataset.noNav) mountNav(active);
  });
})();
