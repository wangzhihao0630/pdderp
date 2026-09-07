'use strict';
/**
 * 拼多多利润计算器 —— 零依赖 Node 服务
 * 启动：node server.js        （默认 3000 端口，可用 PORT 环境变量覆盖）
 * 依赖：无，无需 npm install
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const store = require('./lib/store');
const { calculate } = require('./lib/calc');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 30;

/* ------------------------- 工具 ------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};

function json(res, code, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
const ok = (res, data = {}) => json(res, 200, Object.assign({ ok: true }, data));
const fail = (res, msg, code = 400) => json(res, code, { ok: false, msg });

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setCookie(res, name, val, days = SESSION_DAYS) {
  res.setHeader('Set-Cookie',
    `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}`);
}
function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      if ((req.headers['content-type'] || '').includes('application/json')) {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('JSON 格式错误')); }
      } else {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
      }
    });
    req.on('error', reject);
  });
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

/* ------------------------- 会话 ------------------------- */
function createSession(type, uid) {
  const sid = crypto.randomBytes(24).toString('hex');
  store.db.sessions[sid] = { type, uid, exp: Date.now() + SESSION_DAYS * 86400000 };
  store.save();
  return sid;
}
function getSession(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const s = store.db.sessions[sid];
  if (!s) return null;
  if (s.exp < Date.now()) { delete store.db.sessions[sid]; store.save(); return null; }
  s.sid = sid;
  if (s.type === 'user') {
    const u = store.db.users.find(x => x.id === s.uid);
    if (!u) return null;
    s.user = u;
  }
  return s;
}
function destroySession(sid) { delete store.db.sessions[sid]; store.save(); }

/* ------------------------- 业务 ------------------------- */
function publicUser(u) {
  return {
    id: u.id, username: u.username, nickname: u.nickname || u.username,
    createdAt: u.createdAt, expireAt: u.expireAt, status: u.status, lastLoginAt: u.lastLoginAt
  };
}
function findUser(name) {
  return store.db.users.find(u => u.username.toLowerCase() === String(name || '').toLowerCase());
}
function addDays(ms, days) { return ms + days * 86400000; }
function nowExpire(u) { return Math.max(u.expireAt || 0, Date.now()); }

function publicConfig() {
  const s = store.db.settings;
  return {
    siteName: s.siteName,
    slogan: s.slogan,
    announcement: s.announcement,
    plans: s.plans.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)),
    freeTrialHours: s.freeTrialHours,
    payment: {
      alipayQr: s.payment.alipayQr,
      wechatQr: s.payment.wechatQr,
      payee: s.payment.payee,
      note: s.payment.note,
      contact: s.payment.contact,
      autoApprove: !!s.payment.autoApprove
    }
  };
}

/* ------------------------- 路由 ------------------------- */
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, regex, keys, handler });
}
const G = (p, h) => route('GET', p, h);
const P = (p, h) => route('POST', p, h);
const U = (p, h) => route('PUT', p, h);
const D = (p, h) => route('DELETE', p, h);

/* ===== 公开 ===== */
G('/api/config', (req, res) => ok(res, { config: publicConfig() }));

P('/api/register', async (req, res) => {
  const b = await readBody(req);
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(username)) return fail(res, '账号需为 4-20 位字母/数字/下划线');
  if (password.length < 6) return fail(res, '密码至少 6 位');
  if (findUser(username)) return fail(res, '该账号已被注册');
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: store.uid('u_'),
    username, nickname: username,
    salt, hash: store.hashPwd(password, salt),
    createdAt: Date.now(),
    expireAt: Date.now() + (store.db.settings.freeTrialHours || 24) * 3600000,
    status: 'active',
    lastLoginAt: null,
    source: b.source || 'web'
  };
  store.db.users.push(user);
  const sid = createSession('user', user.id);
  user.lastLoginAt = Date.now();
  store.save(true);
  setCookie(res, 'sid', sid);
  ok(res, { user: publicUser(user), tip: `注册成功，已赠送 ${store.db.settings.freeTrialHours} 小时体验` });
});

P('/api/login', async (req, res) => {
  const b = await readBody(req);
  const u = findUser(b.username);
  if (!u) return fail(res, '账号不存在');
  if (store.hashPwd(String(b.password || ''), u.salt) !== u.hash) return fail(res, '密码错误');
  if (u.status === 'disabled') return fail(res, '账号已被停用，请联系客服');
  u.lastLoginAt = Date.now();
  const sid = createSession('user', u.id);
  store.save(true);
  setCookie(res, 'sid', sid);
  ok(res, { user: publicUser(u) });
});

P('/api/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) destroySession(sid);
  clearCookie(res, 'sid');
  ok(res);
});

G('/api/me', (req, res) => {
  const s = getSession(req);
  if (!s || s.type !== 'user') return ok(res, { user: null });
  ok(res, { user: publicUser(s.user), serverTime: Date.now() });
});

P('/api/calc', async (req, res) => {
  const s = getSession(req);
  if (!s || s.type !== 'user') return fail(res, '请先登录后再使用计算器', 401);
  const u = s.user;
  if (u.status === 'disabled') return fail(res, '账号已被停用', 403);
  if ((u.expireAt || 0) < Date.now()) return fail(res, '会员已到期，请先充值后使用', 403);
  const b = await readBody(req);
  const result = calculate(b);
  if (!result.ok) return fail(res, result.errors.join('；'));
  store.db.calcLogs.unshift({
    id: store.uid('l_'), userId: u.id, username: u.username,
    mode: result.mode, at: Date.now(),
    input: result.input, profit: result.summary.profit, rate: result.summary.profitRate
  });
  if (store.db.calcLogs.length > 2000) store.db.calcLogs.length = 2000;
  store.save();
  ok(res, { result });
});

P('/api/orders', async (req, res) => {
  const s = getSession(req);
  if (!s || s.type !== 'user') return fail(res, '请先登录', 401);
  const b = await readBody(req);
  const plan = store.db.settings.plans.find(p => p.id === b.planId);
  if (!plan) return fail(res, '套餐不存在');
  const tradeNo = String(b.tradeNo || '').trim();
  if (!tradeNo) return fail(res, '请填写支付订单号/交易单号，否则无法核对到账');
  const auto = !!store.db.settings.payment.autoApprove;
  const order = {
    id: store.uid('o_'),
    userId: s.user.id, username: s.user.username,
    planId: plan.id, planName: plan.name, days: plan.days,
    amount: plan.price, method: b.method === 'wechat' ? 'wechat' : 'alipay',
    tradeNo, remark: String(b.remark || '').slice(0, 200),
    status: auto ? 'approved' : 'pending',
    createdAt: Date.now(), handledAt: auto ? Date.now() : null
  };
  store.db.orders.unshift(order);
  if (auto) {
    s.user.expireAt = addDays(nowExpire(s.user), plan.days);
    store.save(true);
    return ok(res, { order, auto: true, expireAt: s.user.expireAt, tip: '已自动到账' });
  }
  store.save(true);
  ok(res, { order, auto: false, tip: '已提交，等待管理员核对' });
});

G('/api/my/orders', (req, res) => {
  const s = getSession(req);
  if (!s || s.type !== 'user') return fail(res, '请先登录', 401);
  ok(res, { orders: store.db.orders.filter(o => o.userId === s.user.id).slice(0, 50) });
});

/* ===== 管理员 ===== */
P('/api/admin/login', async (req, res) => {
  const b = await readBody(req);
  const a = store.db.settings.admin;
  if (String(b.username) !== a.username) return fail(res, '管理员账号错误');
  if (store.hashPwd(String(b.password || ''), a.salt) !== a.hash) return fail(res, '密码错误');
  const sid = createSession('admin', 'admin');
  store.save(true);
  setCookie(res, 'sid', sid);
  ok(res, { mustChangePwd: !!a.mustChangePwd });
});

function adminGuard(req, res) {
  const s = getSession(req);
  if (!s || s.type !== 'admin') { fail(res, '未登录或登录已失效', 401); return null; }
  return s;
}

G('/api/admin/state', (req, res) => {
  const s = getSession(req);
  if (!s || s.type !== 'admin') return ok(res, { admin: null });
  ok(res, {
    admin: { username: store.db.settings.admin.username },
    mustChangePwd: !!store.db.settings.admin.mustChangePwd
  });
});

P('/api/admin/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) destroySession(sid);
  clearCookie(res, 'sid');
  ok(res);
});

G('/api/admin/overview', (req, res) => {
  if (!adminGuard(req, res)) return;
  const db = store.db;
  const now = Date.now();
  const active = db.users.filter(u => (u.expireAt || 0) > now).length;
  const approved = db.orders.filter(o => o.status === 'approved');
  const income = approved.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const day7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayStart.getTime() - (6 - i) * 86400000);
    const end = d.getTime() + 86400000;
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      users: db.users.filter(u => u.createdAt >= d.getTime() && u.createdAt < end).length,
      income: approved.filter(o => o.createdAt >= d.getTime() && o.createdAt < end)
        .reduce((s, o) => s + (Number(o.amount) || 0), 0)
    };
  });
  ok(res, {
    stats: {
      users: db.users.length,
      activeUsers: active,
      pendingOrders: db.orders.filter(o => o.status === 'pending').length,
      income,
      calcCount: db.calcLogs.length,
      online: Object.values(db.sessions).filter(s => s.type === 'user' && s.exp > now).length
    },
    day7,
    recentUsers: db.users.slice(-8).reverse().map(publicUser),
    recentCalc: db.calcLogs.slice(0, 8)
  });
});

G('/api/admin/users', (req, res) => {
  if (!adminGuard(req, res)) return;
  const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').toLowerCase();
  let list = store.db.users.slice();
  if (q) list = list.filter(u => (u.username + (u.nickname || '')).toLowerCase().includes(q));
  list.sort((a, b) => b.createdAt - a.createdAt);
  ok(res, { users: list.map(publicUser), total: store.db.users.length });
});

P('/api/admin/users/:id/adjust', async (req, res, m) => {
  if (!adminGuard(req, res)) return;
  const u = store.db.users.find(x => x.id === m.id);
  if (!u) return fail(res, '用户不存在');
  const b = await readBody(req);
  if (b.expireAt !== undefined && b.expireAt !== null && b.expireAt !== '') {
    u.expireAt = Number(b.expireAt);
  } else {
    const days = Number(b.days) || 0;
    const hours = Number(b.hours) || 0;
    u.expireAt = addDays(nowExpire(u), days) + hours * 3600000;
  }
  store.save(true);
  ok(res, { user: publicUser(u) });
});

P('/api/admin/users/:id/status', async (req, res, m) => {
  if (!adminGuard(req, res)) return;
  const u = store.db.users.find(x => x.id === m.id);
  if (!u) return fail(res, '用户不存在');
  const b = await readBody(req);
  u.status = b.status === 'disabled' ? 'disabled' : 'active';
  store.save(true);
  ok(res, { user: publicUser(u) });
});

P('/api/admin/users/:id/password', async (req, res, m) => {
  if (!adminGuard(req, res)) return;
  const u = store.db.users.find(x => x.id === m.id);
  if (!u) return fail(res, '用户不存在');
  const b = await readBody(req);
  if (String(b.password || '').length < 6) return fail(res, '密码至少 6 位');
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = store.hashPwd(String(b.password), u.salt);
  store.save(true);
  ok(res);
});

D('/api/admin/users/:id', (req, res, m) => {
  if (!adminGuard(req, res)) return;
  const i = store.db.users.findIndex(x => x.id === m.id);
  if (i < 0) return fail(res, '用户不存在');
  store.db.users.splice(i, 1);
  store.save(true);
  ok(res);
});

U('/api/admin/plans', async (req, res) => {
  if (!adminGuard(req, res)) return;
  const b = await readBody(req);
  if (!Array.isArray(b.plans)) return fail(res, '数据格式错误');
  store.db.settings.plans = b.plans.map((p, i) => ({
    id: p.id || store.uid('p_'),
    name: String(p.name || '未命名套餐').slice(0, 30),
    days: Math.max(1, Number(p.days) || 1),
    price: Math.max(0, Number(p.price) || 0),
    tag: String(p.tag || '').slice(0, 20),
    sort: Number(p.sort) || i + 1
  }));
  store.save(true);
  ok(res, { plans: store.db.settings.plans });
});

U('/api/admin/announcement', async (req, res) => {
  if (!adminGuard(req, res)) return;
  const b = await readBody(req);
  store.db.settings.announcement = {
    title: String(b.title || '平台公告').slice(0, 60),
    content: String(b.content || '').slice(0, 4000),
    enabled: b.enabled !== false,
    updatedAt: Date.now()
  };
  if (b.siteName) store.db.settings.siteName = String(b.siteName).slice(0, 40);
  if (b.slogan !== undefined) store.db.settings.slogan = String(b.slogan).slice(0, 80);
  if (b.freeTrialHours !== undefined) {
    const h = Number(b.freeTrialHours);
    if (Number.isFinite(h) && h >= 0) store.db.settings.freeTrialHours = h;
  }
  store.save(true);
  ok(res, { announcement: store.db.settings.announcement });
});

U('/api/admin/payment', async (req, res) => {
  if (!adminGuard(req, res)) return;
  const b = await readBody(req);
  const p = store.db.settings.payment;
  ['alipayQr', 'wechatQr', 'payee', 'note', 'contact'].forEach(k => {
    if (b[k] !== undefined) p[k] = String(b[k]);
  });
  p.autoApprove = !!b.autoApprove;
  store.save(true);
  ok(res, { payment: p });
});

P('/api/admin/password', async (req, res) => {
  if (!adminGuard(req, res)) return;
  const b = await readBody(req);
  const a = store.db.settings.admin;
  if (store.hashPwd(String(b.oldPassword || ''), a.salt) !== a.hash) return fail(res, '原密码错误');
  const np = String(b.newPassword || '');
  if (np.length < 6) return fail(res, '新密码至少 6 位');
  a.salt = crypto.randomBytes(16).toString('hex');
  a.hash = store.hashPwd(np, a.salt);
  a.mustChangePwd = false;
  if (b.username && String(b.username).trim()) a.username = String(b.username).trim();
  store.save(true);
  ok(res);
});

G('/api/admin/orders', (req, res) => {
  if (!adminGuard(req, res)) return;
  const status = new URL(req.url, 'http://x').searchParams.get('status');
  let list = store.db.orders.slice();
  if (status && status !== 'all') list = list.filter(o => o.status === status);
  ok(res, { orders: list.slice(0, 300) });
});

P('/api/admin/orders/:id/approve', (req, res, m) => {
  if (!adminGuard(req, res)) return;
  const o = store.db.orders.find(x => x.id === m.id);
  if (!o) return fail(res, '订单不存在');
  if (o.status === 'approved') return fail(res, '该订单已通过');
  const u = store.db.users.find(x => x.id === o.userId);
  if (!u) return fail(res, '对应用户不存在，无法加时长');
  u.expireAt = addDays(nowExpire(u), Number(o.days) || 0);
  o.status = 'approved';
  o.handledAt = Date.now();
  store.save(true);
  ok(res, { order: o, expireAt: u.expireAt });
});

P('/api/admin/orders/:id/reject', async (req, res, m) => {
  if (!adminGuard(req, res)) return;
  const o = store.db.orders.find(x => x.id === m.id);
  if (!o) return fail(res, '订单不存在');
  const b = await readBody(req);
  o.status = 'rejected';
  o.handledAt = Date.now();
  o.rejectReason = String(b.reason || '未收到款项').slice(0, 100);
  store.save(true);
  ok(res, { order: o });
});

P('/api/admin/upload', async (req, res) => {
  if (!adminGuard(req, res)) return;
  const b = await readBody(req);
  const dataUrl = String(b.data || '');
  const m2 = dataUrl.match(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,(.+)$/i);
  if (!m2) return fail(res, '仅支持 PNG/JPG/GIF/WEBP 图片，且需为 base64 格式');
  const buf = Buffer.from(m2[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) return fail(res, '图片不能超过 4MB');
  const ext = m2[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const name = store.uid('qr_') + '.' + ext;
  fs.writeFileSync(path.join(store.UPLOAD_DIR, name), buf);
  ok(res, { url: '/uploads/' + name });
});

/* ------------------------- 静态资源 ------------------------- */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  if (rel.startsWith('/uploads/')) {
    const fp = path.join(store.UPLOAD_DIR, path.basename(rel));
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const body = fs.readFileSync(fp);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=86400' });
      return res.end(body);
    }
    return notFound(res);
  }

  let fp = path.join(PUBLIC_DIR, rel);
  if (!fp.startsWith(PUBLIC_DIR)) return notFound(res);
  if (rel.endsWith('.html') && !fs.existsSync(fp)) {
    const alt = fp.replace(/\.html$/, '') + '/index.html';
    if (fs.existsSync(alt)) fp = alt;
  }
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    fp = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(fp)) return notFound(res);
  }
  const body = fs.readFileSync(fp);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': path.extname(fp) === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  res.end(body);
}
function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<meta charset="utf-8"><h1>404</h1><p>页面不存在，<a href="/">返回首页</a></p>');
}

/* ------------------------- 服务 ------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.regex);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
          await r.handler(req, res, params);
          return;
        }
      }
      return fail(res, '接口不存在', 404);
    } catch (e) {
      console.error('[API ERROR]', pathname, e);
      return fail(res, e.message || '服务器内部错误', 500);
    }
  }
  return serveStatic(req, res, req.url);
});

server.listen(PORT, HOST, () => {
  store.load();
  console.log('--------------------------------------------------');
  console.log('  拼多多利润计算器 已启动');
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`  后台管理: http://localhost:${PORT}/admin.html`);
  console.log(`  初始管理员账号: ${store.db.settings.admin.username}  密码: admin888`);
  console.log(`  数据目录: ${store.DATA_DIR}`);
  console.log('--------------------------------------------------');
});
