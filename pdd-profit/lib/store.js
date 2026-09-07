'use strict';
/**
 * 极简 JSON 文件数据库（零依赖）
 * - 数据落盘到 data/db.json，写入采用「临时文件 + rename」保证原子性
 * - 云托管场景请把 data/ 目录挂在持久卷上，否则重启后数据会丢
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function uid(prefix = '') {
  return prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function defaultDb() {
  const adminSalt = crypto.randomBytes(16).toString('hex');
  return {
    settings: {
      siteName: '拼多多利润计算器',
      slogan: '用平台的底层逻辑，算出你真实的每一分钱',
      announcement: {
        title: '📢 平台公告',
        content:
          '1、新用户注册即送 24 小时免费体验，注册后自动到账，无需领取。\n' +
          '2、本工具按「净投产比」真实还原平台扣费逻辑，计算结果可直接用于选品定价决策。\n' +
          '3、会员到期后计算功能将暂停使用，已保存的历史记录不受影响。\n' +
          '4、充值请走站内收款码，付款后务必填写订单号，管理员确认后时长实时到账。',
        enabled: true,
        updatedAt: Date.now()
      },
      freeTrialHours: 24,
      plans: [
        { id: 'p1', name: '体验周卡', days: 7, price: 19.9, tag: '', sort: 1 },
        { id: 'p2', name: '月度会员', days: 30, price: 59, tag: '最受欢迎', sort: 2 },
        { id: 'p3', name: '季度会员', days: 90, price: 149, tag: '省 28 元', sort: 3 },
        { id: 'p4', name: '年度会员', days: 365, price: 399, tag: '折合 1.1 元/天', sort: 4 }
      ],
      payment: {
        alipayQr: '',
        wechatQr: '',
        payee: '请在此填写收款方昵称',
        note:
          '① 选择套餐后扫码付款，金额务必与套餐价格一致\n' +
          '② 付款后复制「订单号/交易单号」填入下方\n' +
          '③ 管理员核对通过后，时长自动到账（一般 5 分钟内）',
        autoApprove: false,
        contact: '如超过 30 分钟未到账，请联系客服微信：your_wechat'
      },
      admin: {
        username: 'admin',
        salt: adminSalt,
        hash: hashPwd('admin888', adminSalt),
        mustChangePwd: true
      },
      stats: { visits: 0 }
    },
    users: [],
    orders: [],
    calcLogs: [],
    sessions: {}
  };
}

function hashPwd(pwd, salt) {
  return crypto.scryptSync(String(pwd), salt, 64).toString('hex');
}

let db = null;
let writeTimer = null;

function load() {
  if (db) return db;
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      const bak = DB_FILE + '.broken.' + Date.now();
      fs.copyFileSync(DB_FILE, bak);
      db = defaultDb();
    }
  } else {
    db = defaultDb();
  }
  // 兼容旧版本字段缺失
  const d = defaultDb();
  db.settings = Object.assign({}, d.settings, db.settings);
  db.settings.payment = Object.assign({}, d.settings.payment, db.settings.payment || {});
  db.settings.announcement = Object.assign({}, d.settings.announcement, db.settings.announcement || {});
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.orders)) db.orders = [];
  if (!Array.isArray(db.calcLogs)) db.calcLogs = [];
  if (!db.sessions || typeof db.sessions !== 'object') db.sessions = {};
  if (!db.settings.admin) db.settings.admin = d.settings.admin;
  return db;
}

function save(immediate = false) {
  if (immediate) {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    flush();
    return;
  }
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; flush(); }, 300);
}

function flush() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

module.exports = {
  DATA_DIR, UPLOAD_DIR, DB_FILE,
  load, save, hashPwd, uid,
  get db() { return load(); }
};
