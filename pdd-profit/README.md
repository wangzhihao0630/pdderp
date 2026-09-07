# 拼多多利润计算器 · 会员制站点

零依赖（不需要 `npm install`）的 Node 服务 + 原生前端，包含：首页公告、注册登录、两种模式利润计算、扫码充值、后台管理。

---

## 一、30 秒启动

```bash
cd pdd-profit
node server.js
```

Windows 双击 `start.bat`，Mac/Linux 运行 `start.sh`（会自动打开浏览器）。

> Windows 用户注意：**必须先把 zip 完整解压**，再进文件夹双击 `start.bat`，不要在压缩包里直接双击。
> 新版 `start.bat` 带 4 步自检，无论成功失败都会停下来等你按键，不会闪退——如果还有问题，看文档第三节的「闪一下就关」专项排查。

第一次用、或要在自己电脑上长期跑，请看 **[本地部署说明.md](本地部署说明.md)**（含安装 Node.js、局域网访问、数据备份、故障排查）。

命令行启动（想换端口时用）：`PORT=8080 node server.js`

浏览器打开：

| 地址 | 说明 |
|---|---|
| http://localhost:3000 | 前台首页（公告 + 套餐） |
| http://localhost:3000/app.html | 利润计算器（需登录） |
| http://localhost:3000/recharge.html | 充值支付页 |
| http://localhost:3000/admin.html | **后台管理** |

- 初始管理员：**admin / admin888**（登录后请立刻在「账号安全」里改掉）
- 换端口：`PORT=8080 node server.js`
- 换数据目录：`DATA_DIR=/mnt/disk/data node server.js`

---

## 二、目录结构

```
pdd-profit/
├── server.js               # 全部后端：路由 / 鉴权 / 会话 / 静态服务
├── lib/
│   ├── calc.js             # 【核心】利润计算公式，改算法只动这个文件
│   └── store.js            # JSON 文件数据库（data/db.json）
├── public/                 # 前端
│   ├── index.html          # 首页 + 公告 + 套餐
│   ├── login.html  register.html
│   ├── app.html            # 计算器（两种模式）
│   ├── recharge.html       # 扫码支付 + 提交订单号
│   ├── admin.html          # 后台
│   └── assets/  css/style.css  js/common.js  js/admin.js
├── data/                   # 运行时数据（一定要备份/持久化）
│   ├── db.json             # 用户 / 订单 / 套餐 / 公告 / 会话
│   └── uploads/            # 收款码图片
├── Dockerfile  render.yaml # 云托管用
└── docs/                   # 上线与盈利指南
```

---

## 三、已实现功能清单

| 模块 | 能力 |
|---|---|
| 首页 | 后台可编辑的公告（支持开关、多行）、站点名/Slogan、套餐展示 |
| 注册登录 | 账号密码（scrypt 加盐哈希）、新用户自动送 N 小时（后台可改）、登录态 Cookie |
| 导航 | 未登录显示「未登录 + 登录/注册」；登录后显示账号 + **剩余时间倒计时**（精确到秒） |
| 无货源模式 | 成本价 / 售价 / 净投产比 / 推广投入 / 退货率 |
| 仓储模式 | 上述 5 项 + 邮费（自动算退货往返运费） |
| 计算结果 | 净利润、净利率、成交额、有效订单、成本构成表、保本投产比、保本售价、20% 净利率建议售价、单件净贡献 + 落地建议 |
| 充值 | 支付宝/微信收款码（后台上传）、套餐选择、订单号提交、我的订单记录 |
| 到账 | 默认「人工核对」：后台一键通过 → 自动叠加时长；可开「免审核自动到账」 |
| 后台 | 数据概览、订单审核、用户管理（加时长/改密/停用/删除）、套餐定价、公告、支付设置、管理员密码 |

---

## 四、后期加功能的操作方法（重点）

### 1. 加一个新前台页面（例如「退货率诊断工具」）

**第 1 步** 复制 `public/app.html` 为 `public/roi-tool.html`，改掉里面的标题和表单内容。

**第 2 步** 在页面里保留这两行，导航、登录态、倒计时就自动有了：

```html
<body data-nav="app">        <!-- 高亮哪个导航项：home / app / recharge -->
<div id="nav-root"></div>    <!-- 导航容器，common.js 自动填充 -->
<script src="/assets/js/common.js"></script>
```

**第 3 步** 需要登录才能访问时，在脚本开头加：

```js
const USER = await App.requireUser('/roi-tool.html');  // 未登录自动跳登录页
```

**第 4 步** 在导航里加入口：编辑 `public/assets/js/common.js` 顶部的 `PAGES` 数组，加一行 `{ href: '/roi-tool.html', key: 'tool', name: '退货率诊断' }`。

---

### 2. 加一个计算模式（例如「直播带货模式」）

只需要两处改动：

**① 后端算法** `lib/calc.js`
- 在 `calculate()` 里把 `mode` 的取值加一个分支：`const mode = input.mode === 'live' ? 'live' : ...`
- 新增成本项（例如「佣金/坑位费」）就加一行：`const costLive = GMV * liveRate / 100;`
- 把新成本加进 `totalCost`，并在 `costs` 对象里返回，前端表格会自动多一行（改 `app.html` 的 `rows` 数组即可）
- **保本公式要同步更新**：公式集中在文件顶部注释里，改了成本项就要改 `U`（单件净贡献）和 `G`，否则保本售价会算错

**② 前端入口** `public/app.html`
- `.mode-tabs` 里加一个 `<button class="mode-tab" data-mode="live">`
- 在 `calc()` 的 `body` 里加新字段，在页面加对应输入框

---

### 3. 加一个后台管理项（例如「优惠券码」）

**① 后端** `server.js` 加两个接口（照抄现有写法即可）：

```js
G('/api/admin/coupons', (req, res) => {          // 查
  if (!adminGuard(req, res)) return;
  ok(res, { coupons: store.db.coupons || [] });
});
U('/api/admin/coupons', async (req, res) => {    // 存
  if (!adminGuard(req, res)) return;
  const b = await readBody(req);
  store.db.coupons = b.coupons;
  store.save(true);          // true = 立即落盘，重要数据都用它
  ok(res);
});
```

`adminGuard(req, res)` 是登录校验，所有 `/api/admin/` 接口第一行必须加，否则任何人都能改你的数据。

**② 前端** `public/admin.html` 加一个 tab 按钮 + 一个 `<div class="tab-pane" id="pane-coupon">`，
`public/assets/js/admin.js` 的 `switchTab` 里加一行 `coupon: loadCoupon`，再写一个 `loadCoupon()` 函数即可。

---

### 4. 数据库字段说明（`data/db.json`）

```js
{
  settings: {
    siteName, slogan,                 // 站点信息
    announcement: { title, content, enabled, updatedAt },
    freeTrialHours,                   // 新用户赠送时长（小时）
    plans: [{ id, name, days, price, tag, sort }],   // 会员套餐
    payment: { alipayQr, wechatQr, payee, note, contact, autoApprove },
    admin: { username, salt, hash, mustChangePwd }
  },
  users:    [{ id, username, nickname, salt, hash, createdAt, expireAt, status, lastLoginAt }],
  orders:   [{ id, userId, username, planId, planName, days, amount, method, tradeNo, status, createdAt, handledAt }],
  calcLogs: [{ userId, mode, input, profit, rate, at }],   // 用户每次计算留痕，最多 2000 条
  sessions: { "<sid>": { type: 'user'|'admin', uid, exp } }
}
```

改字段后记得在 `lib/store.js` 的 `defaultDb()` 里同步给默认值，老数据缺失字段时会自动补齐。

---

### 5. 常见改动速查

| 想做的事 | 改哪里 |
|---|---|
| 修改免费体验时长 | 后台「公告与站点」→ 新用户免费时长（不用改代码） |
| 改套餐价格/天数 | 后台「套餐定价」 |
| 换收款码 | 后台「支付设置」→ 上传图片 → 保存 |
| 改公告 | 后台「公告与站点」 |
| 改配色 | `public/assets/css/style.css` 顶部的 CSS 变量（`--brand` 是主色） |
| 改计算公式 | `lib/calc.js`（注释里写了完整推导） |
| 加短信/验证码 | 在 `server.js` 的 `/api/register` 里插入校验，或加 `/api/sms/send` 路由 |
| 接真实支付 | 见 `docs/上线盈利指南.md` 最后「从收款码升级到官方支付接口」 |
| 导出用户数据 | 手动拷贝 `data/db.json`，或后台「账号安全」页说明的位置 |

---

## 五、部署

详细的部署与盈利方案见 **[docs/上线盈利指南.md](docs/上线盈利指南.md)**。

最快的两条路：

```bash
# 路线 A：云托管（Render / Railway / Fly.io），push 代码即上线
git push  →  平台自动识别 Dockerfile  →  记得挂载 1GB 持久卷到 /app/data

# 路线 B：自有服务器 + 宝塔（数据最可控，推荐长期做）
上传代码 → 宝塔「Node 项目」→ 启动命令 node server.js → 配 Nginx 反代 + SSL
```

> ⚠️ **无论哪种方式，都要把 `data/` 目录放到持久化存储上**，否则重启后用户和订单全没了。

---

## 六、安全提醒

1. 上线第一件事：**改掉 admin888**，后台「账号安全」→ 修改管理员密码。
2. `data/db.json` 包含用户密码哈希，别提交到公开仓库（已加 `.gitignore`）。
3. 定期备份 `data/db.json`（建议每天一次，云托管平台一般有快照功能）。
4. 不要在前台暴露 `/api/admin/*` 之外的任何写接口。
