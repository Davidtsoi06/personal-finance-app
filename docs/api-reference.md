# API 参考 — 数据源接口文档

本文档记录项目中使用的所有外部数据源 API。

---

## 1. 汇率 API

### exchangerate-api.com

- **免费额度**：每月 1500 次请求
- **基础URL**：`https://api.exchangerate-api.com/v4/latest/{base_currency}`
- **支持币种**：160+ 种货币

**获取美元汇率：**
```
GET https://api.exchangerate-api.com/v4/latest/USD
```

**返回示例：**
```json
{
  "base": "USD",
  "date": "2026-08-03",
  "rates": {
    "CNY": 7.25,
    "HKD": 7.82,
    "EUR": 0.92,
    "JPY": 149.5,
    "GBP": 0.79
  }
}
```

---

## 2. A股数据

### 新浪财经 API

**实时行情：**
```
GET https://hq.sinajs.cn/list=sh600036,sz000001
```

**返回示例：**
```
var hq_str_sh600036="招商银行,38.50,38.20,38.60,39.00,38.00,...";
```

### 东方财富 API

**股票列表：**
```
GET https://push2.eastmoney.com/api/qt/clist/get
```

---

## 3. 港股数据

### 新浪港股 API

```
GET https://hq.sinajs.cn/list=hk00700
```

---

## 4. 美股数据

### Yahoo Finance

**基础URL**：`https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`

**获取 Apple 数据：**
```
GET https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1mo
```

---

## 5. 基金净值

### 天天基金 API

**基金搜索：**
```
GET https://fundgz.1234567.com.cn/js/{fund_code}.js
```

**返回示例：**
```json
fundgz("110022", "易方达消费行业", "3.8520", "2026-08-03 15:00")
```

---

## 6. 黄金价格

### 新浪贵金属

```
GET https://hq.sinajs.cn/list=hf_XAU
```

---

## 7. 加密货币

### CoinGecko API（免费）

**基础URL**：`https://api.coingecko.com/api/v3`

**获取比特币价格（美元）：**
```
GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,cny
```

**返回示例：**
```json
{
  "bitcoin": { "usd": 65000, "cny": 470000 },
  "ethereum": { "usd": 3500, "cny": 25200 }
}
```

**限制**：免费版每分钟 10-30 次请求。

---

## 数据获取架构

```
Renderer                      Main Process                    External API
   │                              │                                │
   │  invoke('price:fetch')       │                                │
   │─────────────────────────────→│                                │
   │                              │  fetchPrice(code)              │
   │                              │───────────────────────────────→│
   │                              │←───────────────────────────────│
   │                              │  save to DB                    │
   │←─────────────────────────────│                                │
   │  return prices               │                                │
```

## 定时更新策略

- 汇率：每 6 小时
- A股：交易日 9:30-15:00 每 5 分钟
- 港股：交易日 9:30-16:00 每 5 分钟
- 美股：交易时段每 10 分钟
- 基金：每日 15:30 后
- 黄金：每 10 分钟
- 加密货币：每 5 分钟

## 降级策略

1. API 请求超时 10 秒
2. 失败后重试 1 次
3. 仍失败则使用最近一次成功缓存的数据
4. 数据超过 24 小时未更新，在 UI 上显示"数据可能已过期"提示
