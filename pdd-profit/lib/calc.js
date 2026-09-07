'use strict';
/**
 * ============================================================
 *  拼多多利润计算 —— 底层逻辑与公式
 * ============================================================
 * 【平台底层逻辑】
 *   净投产比 R（平台后台显示） = 净成交额 ÷ 推广花费
 *   即：你花 1 元推广费，平台统计口径下带来 R 元的「扣后成交」。
 *   注意：平台显示的净投产比已扣除退款，所以 R × 花费 = 实际到手成交（未扣成本）。
 *
 * 【推导链路】
 *   推广花费        P   = 推广预计投入
 *   净成交额(支付)  GMV = P × R
 *   有效订单数      Ne  = GMV ÷ S            （S = 售价）
 *   下单总数        N   = Ne ÷ (1 - r)       （r = 退货率，退货订单 = N - Ne）
 *   退货订单数      Nr  = N × r
 *
 * 【成本构成】
 *   ① 商品成本   = Ne × C + Nr × C × d       （C = 成本价，d = 退货件成本损耗率）
 *   ② 发货运费   = N  × F                    （F = 单件邮费，仓储模式填，无货源可填 0 或代发运费）
 *   ③ 退货运费   = Nr × (F + Fb)             （去程已计，退回运费 Fb 默认 = F）
 *   ④ 平台扣点   = GMV × k                   （k = 平台技术服务费率，如 0.6% 填 0.6）
 *   ⑤ 推广费     = P
 *
 * 【结论公式】
 *   利润   = GMV - ① - ② - ③ - ④ - ⑤
 *   利润率 = 利润 ÷ GMV
 *
 *   为便于求解，令单件净贡献：
 *     U = S(1 - k) - C - [C·d·r + F(1 + r) + Fb·r] / (1 - r)
 *   则：利润 = Ne × U - P = (P·R/S)·U - P
 *
 *   保本投产比  R0 = S ÷ U            （U ≤ 0 时，任何投产比都亏，需先改成本结构）
 *   保本售价    S0 = R(C + G) ÷ [R(1 - k) - 1]   ，G = [C·d·r + F(1+r) + Fb·r] / (1 - r)
 *   目标利润率 m 的建议售价：
 *     S* = (C + G) ÷ [(1 - k) - (1 + m·R) / R]
 * ============================================================
 */

function num(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function calculate(input) {
  const mode = input.mode === 'warehouse' ? 'warehouse' : 'dropship'; // 无货源 / 仓储
  const C = num(input.cost);                  // 成本价
  const S = num(input.price);                 // 售价
  const R = num(input.roi);                   // 净投产比（平台显示）
  const P = num(input.adSpend);               // 推广预计投入
  const rRaw = num(input.refundRate);         // 退货率（%）
  let F = num(input.shipping);                // 单件邮费（元/件，发出）
  const FbRaw = input.returnShipping;         // 退回运费（元/件），留空 = 同邮费
  const kRaw = num(input.commission);         // 平台扣点（%）
  const dRaw = num(input.refundLossRate);     // 退货件成本损耗率（%）

  if (mode === 'dropship') F = num(input.shipping); // 无货源也允许填代发运费，默认 0

  const r = Math.min(Math.max(rRaw, 0), 99.9) / 100;
  const k = Math.min(Math.max(kRaw, 0), 60) / 100;
  const d = Math.min(Math.max(dRaw, 0), 100) / 100;
  const Fb = FbRaw === '' || FbRaw === null || FbRaw === undefined ? F : num(FbRaw, F);

  const errors = [];
  if (C <= 0) errors.push('请输入大于 0 的成本价');
  if (S <= 0) errors.push('请输入大于 0 的售价');
  if (R <= 0) errors.push('请输入大于 0 的净投产比');
  if (P <= 0) errors.push('请输入大于 0 的推广预计投入');
  if (r >= 1) errors.push('退货率需小于 100%');
  if (errors.length) return { ok: false, errors };

  // —— 核心链路 ——
  const GMV = P * R;                        // 净成交额（已扣退款）
  const Ne = GMV / S;                       // 有效订单数
  const N = Ne / (1 - r);                   // 下单总数
  const Nr = N - Ne;                        // 退货订单数

  const costGoods = Ne * C + Nr * C * d;                 // 商品成本
  const costShip = N * F;                                // 发货运费
  const costReturnShip = Nr * (F + Fb);                  // 退货往返运费（去程 + 退回）
  const costPlatform = GMV * k;                          // 平台扣点
  const costAd = P;                                      // 推广费

  const totalCost = costGoods + costShip + costReturnShip + costPlatform + costAd;
  const profit = GMV - totalCost;
  const profitRate = GMV > 0 ? (profit / GMV) * 100 : 0;

  // —— 单件指标 ——
  const G = (C * d * r + F * (1 + r) + Fb * r) / (1 - r);
  const U = S * (1 - k) - C - G;                          // 单件净贡献
  const grossPerOrder = S - C;                            // 单件毛利（未扣推广/运费）
  const adPerOrder = N > 0 ? P / N : 0;                   // 单件分摊推广费
  const adShare = GMV > 0 ? (P / GMV) * 100 : 0;          // 推广费占成交比
  const returnLoss = Nr * (C * d + F + Fb);               // 退货造成的直接损失
  const roiNeed = U > 0 ? S / U : null;                   // 保本净投产比
  const priceNeed = (function () {
    const denom = R * (1 - k) - 1;
    if (denom <= 0) return null;
    return (R * (C + G)) / denom;
  })();                                                    // 保本售价
  const priceForTarget = (function (m) {                   // 达成目标利润率的建议售价
    const denom = (1 - k) - (1 + m * R) / R;
    if (denom <= 0) return null;
    return (C + G) / denom;
  })(0.2);

  // —— 建议输出 ——
  const advice = [];
  if (profit <= 0) {
    advice.push({
      level: 'danger',
      title: '当前结构亏损，先别放量',
      text: `按现有参数测算，投入 ${P} 元推广预计亏损 ${Math.abs(profit).toFixed(2)} 元。若平台显示的净投产比是真实值，说明这款产品在当前售价下不具备放量条件，先优化结构再加大推广。`
    });
  }
  if (roiNeed !== null && R < roiNeed) {
    advice.push({
      level: 'danger',
      title: `净投产比需拉到 ${roiNeed.toFixed(2)} 才保本`,
      text: `当前净投产比 ${R.toFixed(2)}，距离保本还差 ${(roiNeed - R).toFixed(2)}。优先动作：优化主图点击率 → 提升转化率 → 用「全站推广」分阶段拉投产，别一步到位硬拉，容易掉量。`
    });
  } else if (roiNeed !== null) {
    const safe = (R / roiNeed - 1) * 100;
    advice.push({
      level: safe > 30 ? 'success' : 'warn',
      title: `投产安全垫 ${safe.toFixed(1)}%`,
      text: safe > 30
        ? `净投产比 ${R.toFixed(2)} 高出保本线 ${roiNeed.toFixed(2)} 较多，可以适度放大推广预算抢量。`
        : `净投产比仅高出保本线 ${safe.toFixed(1)}%，抗波动能力弱。一旦退货率或点击单价上浮 10% 就可能转亏，建议留出 30% 以上安全垫。`
    });
  } else {
    advice.push({
      level: 'danger',
      title: '成本结构不健康，拉投产也救不回来',
      text: `单件净贡献为负（${U.toFixed(2)} 元），意味着每成交一单都在亏。必须先降成本价或提售价，单纯拉投产比只会亏得更多。`
    });
  }

  if (priceNeed !== null && S < priceNeed) {
    advice.push({
      level: 'warn',
      title: `售价至少提到 ${priceNeed.toFixed(2)} 元`,
      text: `当前售价 ${S.toFixed(2)} 元低于保本价。若担心涨价掉转化，可采用「小幅多轮」：每次涨 3%~5%，观察 3 天转化与投产，稳住再涨下一轮。`
    });
  }
  if (priceForTarget !== null && priceForTarget > 0) {
    advice.push({
      level: 'info',
      title: `想要 20% 净利率，售价可定 ${priceForTarget.toFixed(2)} 元`,
      text: `该价格下按当前净投产比 ${R.toFixed(2)} 测算，扣除成本、运费、退货与推广后可留下约 20% 净利。实际定价请对照竞品价格带，高于竞品 15% 以上需要配套差异化卖点。`
    });
  }
  if (r >= 0.3) {
    advice.push({
      level: 'danger',
      title: `退货率 ${(r * 100).toFixed(1)}% 偏高，是利润黑洞`,
      text: `退货带来的直接损失约 ${returnLoss.toFixed(2)} 元。高退货通常来自：尺码/色差描述不符、夸大宣传、包装破损。先改详情页真实描述与包装，再谈放量。`
    });
  } else if (r >= 0.15) {
    advice.push({
      level: 'warn',
      title: `退货率 ${(r * 100).toFixed(1)}% 吃掉 ${(returnLoss / Math.max(GMV, 1) * 100).toFixed(1)}% 的成交额`,
      text: '建议在详情页补充规格实拍与常见疑问，用「退货率每降 1 个点能多赚多少」去倒逼供应链改进。'
    });
  }
  if (adShare > 40) {
    advice.push({
      level: 'warn',
      title: `推广费占成交额 ${adShare.toFixed(1)}%，依赖付费流量`,
      text: '这说明自然流量占比偏低。建议把付费带来的成交转化为销量与评价，逐步降低出价，让自然流量接棒，否则一停推广就没单。'
    });
  }
  if (mode === 'warehouse') {
    advice.push({
      level: 'info',
      title: '仓储模式：运费是第二成本中心',
      text: `运费合计 ${(costShip + costReturnShip).toFixed(2)} 元，占总成本 ${((costShip + costReturnShip) / Math.max(totalCost, 1) * 100).toFixed(1)}%。可与快递谈月结价，单件每降 0.3 元，按本次单量可多赚 ${(N * 0.3).toFixed(2)} 元。`
    });
  } else {
    advice.push({
      level: 'info',
      title: '无货源模式：别只盯差价',
      text: '无货源常见坑是「上游涨价/缺货」与「售后响应慢」。建议同一链接至少备 2~3 家可替换货源，并把售后时效写进合作约定，避免店铺体验分被拖垮。'
    });
  }

  return {
    ok: true,
    mode,
    input: { C, S, R, P, r: rRaw, F, Fb, k: kRaw, d: dRaw },
    summary: {
      gmv: GMV,
      orders: N,
      validOrders: Ne,
      returnOrders: Nr,
      totalCost,
      profit,
      profitRate,
      adShare
    },
    costs: {
      goods: costGoods,
      shipping: costShip,
      returnShipping: costReturnShip,
      platform: costPlatform,
      ad: costAd
    },
    perUnit: {
      gross: grossPerOrder,
      net: U,
      ad: adPerOrder,
      returnLoss
    },
    benchmark: {
      roiNeed,
      priceNeed,
      priceForTarget
    },
    advice
  };
}

module.exports = { calculate };
