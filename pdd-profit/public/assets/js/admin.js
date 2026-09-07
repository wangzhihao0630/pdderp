/* 后台管理逻辑 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  let PAYMENT = {}, PLANS = [];

  /* ---------- 登录态 ---------- */
  async function boot() {
    try {
      const r = await App.get('/api/admin/state');
      if (r.admin) { enterMain(r); return; }
    } catch (e) { }
    $('#loginWrap').style.display = '';
  }

  function enterMain(r) {
    $('#loginWrap').style.display = 'none';
    $('#mainWrap').style.display = '';
    $('#adminName').textContent = '管理员：' + r.admin.username;
    const au = $('#newAdminUser');
    if (au) au.value = r.admin.username;
    if (r.mustChangePwd) {
      App.toast('请尽快修改初始密码', 'err');
      setTimeout(() => switchTab('security'), 600);
    }
    loadOverview();
  }

  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#aBtn');
    btn.disabled = true; btn.textContent = '登录中...';
    try {
      const r = await App.post('/api/admin/login', {
        username: $('#aUser').value.trim(), password: $('#aPwd').value
      });
      enterMain({ admin: { username: $('#aUser').value.trim() }, mustChangePwd: r.mustChangePwd });
    } catch (err) { App.toast(err.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = '登 录'; }
  };
  $('#btnAdminLogout').onclick = async () => {
    await App.post('/api/admin/logout').catch(() => { });
    location.reload();
  };

  /* ---------- Tab ---------- */
  function switchTab(name) {
    $$('.admin-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $$('.tab-pane').forEach(p => p.style.display = p.id === 'pane-' + name ? '' : 'none');
    ({
      overview: loadOverview, orders: loadOrders, users: loadUsers,
      plans: loadPlans, notice: loadNotice, payment: loadPayment
    }[name] || (() => { }))();
  }
  $$('.admin-tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

  /* ---------- 概览 ---------- */
  async function loadOverview() {
    const r = await App.get('/api/admin/overview');
    const s = r.stats;
    $('#statBox').innerHTML = [
      ['总用户数', s.users, '人'],
      ['有效会员', s.activeUsers, '人'],
      ['待核对订单', s.pendingOrders, '笔'],
      ['累计收入', '¥' + App.money(s.income), '已通过订单']
    ].map(x => `<div class="stat"><div class="k">${x[0]}</div><div class="v">${x[1]}</div><div class="small muted">${x[2]}</div></div>`).join('');

    const max = Math.max(1, ...r.day7.map(d => Math.max(d.users, d.income)));
    $('#day7').innerHTML = r.day7.map(d => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
        <div style="width:46px" class="small muted">${d.date}</div>
        <div style="flex:1;height:20px;background:var(--bg);border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${(d.users / max * 100).toFixed(1)}%;background:linear-gradient(90deg,var(--brand),var(--brand-2))"></div>
        </div>
        <div style="width:110px;text-align:right" class="small">+${d.users} 人 / ¥${App.money(d.income)}</div>
      </div>`).join('');

    $('#recentUsers').innerHTML = r.recentUsers.length ? r.recentUsers.map(u => `
      <tr><td>${App.escapeHtml(u.username)}</td>
      <td class="small muted">${App.fmtTime(u.createdAt)}</td>
      <td class="small">${App.fmtTime(u.expireAt)}</td>
      <td>${statusPill(u)}</td></tr>`).join('') : emptyRow(4);

    const badge = $('#pendingBadge');
    badge.style.display = s.pendingOrders ? 'inline-block' : 'none';
    badge.textContent = s.pendingOrders;
  }
  function statusPill(u) {
    if (u.status === 'disabled') return '<span class="pill danger">已停用</span>';
    return u.expireAt > Date.now()
      ? '<span class="pill ok">有效</span>'
      : '<span class="pill muted">已到期</span>';
  }
  const emptyRow = n => `<tr><td colspan="${n}" class="muted small" style="padding:18px;text-align:center">暂无数据</td></tr>`;

  /* ---------- 订单 ---------- */
  async function loadOrders() {
    const status = $('#orderFilter').value;
    const r = await App.get('/api/admin/orders?status=' + status);
    const map = {
      pending: '<span class="pill warn">待核对</span>',
      approved: '<span class="pill ok">已通过</span>',
      rejected: '<span class="pill danger">已驳回</span>'
    };
    $('#orderRows').innerHTML = r.orders.length ? r.orders.map(o => `
      <tr>
        <td><b>${App.escapeHtml(o.username)}</b></td>
        <td>${App.escapeHtml(o.planName)}<div class="small muted">${o.days} 天</div></td>
        <td class="num">¥${App.money(o.amount)}</td>
        <td class="small">${o.method === 'wechat' ? '微信' : '支付宝'}</td>
        <td class="small" style="max-width:180px;word-break:break-all">${App.escapeHtml(o.tradeNo)}${o.remark ? '<div class="muted">备注：' + App.escapeHtml(o.remark) + '</div>' : ''}</td>
        <td>${map[o.status] || o.status}</td>
        <td class="small muted">${App.fmtTime(o.createdAt)}</td>
        <td>${o.status === 'pending'
        ? `<button class="btn btn-primary btn-sm" data-ap="${o.id}">通过并加时长</button>
               <button class="btn btn-ghost btn-sm" data-rj="${o.id}">驳回</button>`
        : '<span class="small muted">' + App.fmtTime(o.handledAt) + '</span>'}</td>
      </tr>`).join('') : emptyRow(8);

    $$('#orderRows [data-ap]').forEach(b => b.onclick = async () => {
      if (!confirm('确认已收到该笔款项？通过后将为 ' + '该用户' + ' 叠加对应天数。')) return;
      try { await App.post('/api/admin/orders/' + b.dataset.ap + '/approve'); App.toast('已通过，时长已到账', 'ok'); loadOrders(); }
      catch (e) { App.toast(e.message, 'err'); }
    });
    $$('#orderRows [data-rj]').forEach(b => b.onclick = async () => {
      const reason = prompt('驳回原因（会展示给用户）', '未查询到该笔收款');
      if (reason === null) return;
      try { await App.post('/api/admin/orders/' + b.dataset.rj + '/reject', { reason }); App.toast('已驳回'); loadOrders(); }
      catch (e) { App.toast(e.message, 'err'); }
    });
  }
  $('#orderFilter').onchange = loadOrders;

  /* ---------- 用户 ---------- */
  async function loadUsers() {
    const q = ($('#userSearch').value || '').trim();
    const r = await App.get('/api/admin/users?q=' + encodeURIComponent(q));
    $('#userCount').textContent = '共 ' + r.total + ' 个用户';
    $('#userRows').innerHTML = r.users.length ? r.users.map(u => `
      <tr>
        <td><b>${App.escapeHtml(u.username)}</b><div class="small muted">${u.id}</div></td>
        <td class="small muted">${App.fmtTime(u.createdAt)}</td>
        <td class="small muted">${App.fmtTime(u.lastLoginAt)}</td>
        <td class="small">${App.fmtTime(u.expireAt)}<div class="muted">${u.expireAt > Date.now() ? '剩余 ' + App.fmtDur(u.expireAt - Date.now()) : '已到期'}</div></td>
        <td>${statusPill(u)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" data-add="${u.id}" data-name="${u.username}">加时长</button>
          <button class="btn btn-ghost btn-sm" data-pwd="${u.id}">改密码</button>
          <button class="btn btn-ghost btn-sm" data-tg="${u.id}" data-st="${u.status}">${u.status === 'disabled' ? '启用' : '停用'}</button>
          <button class="btn btn-ghost btn-sm" data-del="${u.id}" data-name="${u.username}">删除</button>
        </td>
      </tr>`).join('') : emptyRow(6);

    $$('#userRows [data-add]').forEach(b => b.onclick = async () => {
      const v = prompt('给「' + b.dataset.name + '」增加多少天？（可填负数减少）', '30');
      if (v === null) return;
      const days = Number(v);
      if (!Number.isFinite(days)) return App.toast('请输入数字', 'err');
      await App.post('/api/admin/users/' + b.dataset.add + '/adjust', { days });
      App.toast('已调整时长', 'ok'); loadUsers();
    });
    $$('#userRows [data-pwd]').forEach(b => b.onclick = async () => {
      const v = prompt('请输入新的登录密码（至少 6 位）');
      if (!v) return;
      try { await App.post('/api/admin/users/' + b.dataset.pwd + '/password', { password: v }); App.toast('密码已重置', 'ok'); }
      catch (e) { App.toast(e.message, 'err'); }
    });
    $$('#userRows [data-tg]').forEach(b => b.onclick = async () => {
      await App.post('/api/admin/users/' + b.dataset.tg + '/status', { status: b.dataset.st === 'disabled' ? 'active' : 'disabled' });
      App.toast('状态已更新', 'ok'); loadUsers();
    });
    $$('#userRows [data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('确定删除用户「' + b.dataset.name + '」？该操作不可恢复')) return;
      await App.del('/api/admin/users/' + b.dataset.del);
      App.toast('已删除'); loadUsers();
    });
  }
  $('#btnSearch').onclick = loadUsers;
  $('#userSearch').onkeydown = e => { if (e.key === 'Enter') loadUsers(); };

  /* ---------- 套餐 ---------- */
  async function loadPlans() {
    const cfg = (await App.get('/api/config')).config;
    PLANS = cfg.plans || [];
    renderPlans();
  }
  function renderPlans() {
    $('#planRows').innerHTML = PLANS.map((p, i) => `
      <tr>
        <td><input class="input" data-k="name" data-i="${i}" value="${App.escapeHtml(p.name)}" style="padding:7px 10px"></td>
        <td><input class="input" data-k="days" data-i="${i}" type="number" min="1" value="${p.days}" style="width:90px;padding:7px 10px"></td>
        <td><input class="input" data-k="price" data-i="${i}" type="number" min="0" step="0.01" value="${p.price}" style="width:110px;padding:7px 10px"></td>
        <td><input class="input" data-k="tag" data-i="${i}" value="${App.escapeHtml(p.tag || '')}" style="padding:7px 10px"></td>
        <td><input class="input" data-k="sort" data-i="${i}" type="number" value="${p.sort || i + 1}" style="width:70px;padding:7px 10px"></td>
        <td><button class="btn btn-ghost btn-sm" data-rm="${i}">删除</button></td>
      </tr>`).join('');
    $$('#planRows [data-rm]').forEach(b => b.onclick = () => { PLANS.splice(+b.dataset.rm, 1); renderPlans(); });
    $$('#planRows input').forEach(inp => inp.oninput = () => {
      const i = +inp.dataset.i;
      PLANS[i][inp.dataset.k] = inp.dataset.k === 'name' || inp.dataset.k === 'tag' ? inp.value : Number(inp.value);
    });
  }
  $('#btnAddPlan').onclick = () => { PLANS.push({ name: '新套餐', days: 30, price: 99, tag: '', sort: PLANS.length + 1 }); renderPlans(); };
  $('#btnSavePlans').onclick = async () => {
    try { await App.put('/api/admin/plans', { plans: PLANS }); App.toast('套餐已保存', 'ok'); loadPlans(); }
    catch (e) { App.toast(e.message, 'err'); }
  };

  /* ---------- 公告 ---------- */
  async function loadNotice() {
    const cfg = (await App.get('/api/config')).config;
    $('#siteName').value = cfg.siteName || '';
    $('#slogan').value = cfg.slogan || '';
    $('#freeTrialHours').value = cfg.freeTrialHours;
    $('#noticeTitle').value = cfg.announcement.title || '';
    $('#noticeContent').value = cfg.announcement.content || '';
    $('#noticeEnabled').checked = cfg.announcement.enabled !== false;
  }
  $('#btnSaveNotice').onclick = async () => {
    try {
      await App.put('/api/admin/announcement', {
        siteName: $('#siteName').value, slogan: $('#slogan').value,
        freeTrialHours: $('#freeTrialHours').value,
        title: $('#noticeTitle').value, content: $('#noticeContent').value,
        enabled: $('#noticeEnabled').checked
      });
      App.toast('公告已保存，前台立即生效', 'ok');
    } catch (e) { App.toast(e.message, 'err'); }
  };

  /* ---------- 支付 ---------- */
  async function loadPayment() {
    const cfg = (await App.get('/api/config')).config;
    PAYMENT = cfg.payment || {};
    $('#aliBox').innerHTML = PAYMENT.alipayQr ? `<img src="${PAYMENT.alipayQr}">` : '未上传';
    $('#wxBox').innerHTML = PAYMENT.wechatQr ? `<img src="${PAYMENT.wechatQr}">` : '未上传';
    $('#payee').value = PAYMENT.payee || '';
    $('#payNote').value = PAYMENT.note || '';
    $('#contact').value = PAYMENT.contact || '';
    $('#autoApprove').checked = !!PAYMENT.autoApprove;
  }
  window.__setQr = (key, val) => {
    PAYMENT[key] = val;
    (key === 'alipayQr' ? $('#aliBox') : $('#wxBox')).innerHTML = val ? `<img src="${val}">` : '未上传';
  };
  function bindUpload(fileId, key, boxId) {
    $(fileId).onchange = async () => {
      const f = $(fileId).files[0];
      if (!f) return;
      if (f.size > 4 * 1024 * 1024) return App.toast('图片不能超过 4MB', 'err');
      const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      try {
        const r = await App.post('/api/admin/upload', { data });
        PAYMENT[key] = r.url;
        $(boxId).innerHTML = `<img src="${r.url}">`;
        App.toast('上传成功，记得点保存', 'ok');
      } catch (e) { App.toast(e.message, 'err'); }
    };
  }
  bindUpload('#aliFile', 'alipayQr', '#aliBox');
  bindUpload('#wxFile', 'wechatQr', '#wxBox');
  $('#btnSavePayment').onclick = async () => {
    try {
      await App.put('/api/admin/payment', {
        alipayQr: PAYMENT.alipayQr || '', wechatQr: PAYMENT.wechatQr || '',
        payee: $('#payee').value, note: $('#payNote').value,
        contact: $('#contact').value, autoApprove: $('#autoApprove').checked
      });
      App.toast('支付设置已保存', 'ok');
    } catch (e) { App.toast(e.message, 'err'); }
  };

  /* ---------- 安全 ---------- */
  $('#btnSavePwd').onclick = async () => {
    const oldP = $('#oldPwd').value, np = $('#newPwd').value;
    if (!oldP) return App.toast('请输入原密码', 'err');
    if (np.length < 6) return App.toast('新密码至少 6 位', 'err');
    if (np !== $('#newPwd2').value) return App.toast('两次输入的新密码不一致', 'err');
    try {
      await App.post('/api/admin/password', { oldPassword: oldP, newPassword: np, username: $('#newAdminUser').value.trim() });
      App.toast('密码修改成功，下次登录请使用新密码', 'ok');
      $('#oldPwd').value = $('#newPwd').value = $('#newPwd2').value = '';
    } catch (e) { App.toast(e.message, 'err'); }
  };
  $('#btnExport').onclick = () => {
    App.toast('数据文件位于服务器 data/db.json，请通过服务器后台下载', 'ok');
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
