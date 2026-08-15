# 数据模型 — 个人理财投资软件

## 概览

共 22 张业务表 + 1 张迁移元数据表（`_migrations`），通过版本号递增的 migration 脚本管理（当前最新：v14）。

---

## 1. accounts — 账户表

管理用户的全部资金账户（银行卡、现金、支付平台等），支持树形层级结构。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| name | TEXT | 账户名称（如"招商银行储蓄卡"） |
| type | TEXT | 支付方式：cash / bank_card / credit_card / online_pay |
| asset_type | TEXT | 资产大类：bank / cash / insurance / investment / custom（v8 新增） |
| currency | TEXT | 币种：CNY / HKD / USD / EUR / JPY / GBP |
| balance | REAL | 当前余额（多币种汇总值） |
| bank_name | TEXT | 银行名称（银行卡时） |
| card_number | TEXT | 卡号尾号后 4 位（v13 起仅存尾号，完整卡号不落库） |
| display_alias | TEXT | 卡片显示别名（v12 新增） |
| parent_account_id | INTEGER FK | 父账户 ID，支持树形结构（v7 新增） |
| is_active | INTEGER | 是否启用 0/1 |
| sort_order | INTEGER | 排序顺序 |
| created_at | TEXT | 创建时间 ISO8601 |
| updated_at | TEXT | 更新时间 ISO8601 |

---

## 2. account_balances — 多币种余额表（v7 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| account_id | INTEGER FK | 关联账户（CASCADE 删除） |
| currency | TEXT | 币种 |
| balance | REAL | 该币种余额 |
| updated_at | TEXT | 更新时间 |

`UNIQUE(account_id, currency)`

---

## 3. investment_accounts — 投资账户表

管理券商/交易平台账户。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| name | TEXT | 账户名称（如"富途牛牛"） |
| broker | TEXT | 券商名称 |
| currency | TEXT | 默认币种 |
| account_number | TEXT | 账号 |
| funding_account_id | INTEGER FK | 关联的资金银行账户（v10 新增，可为空） |
| cash_balance | REAL | 闲置现金余额（v11 新增，默认 0） |
| notes | TEXT | 备注 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

---

## 4. assets — 资产持仓表

管理投资类资产的持仓信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| name | TEXT | 资产名称（如"腾讯控股"） |
| code | TEXT | 代码（如"00700"） |
| type | TEXT | 类型：stock / fund / etf / gold / crypto / fixed_deposit |
| market | TEXT | 市场：a_stock / hk_stock / us_stock / other |
| currency | TEXT | 计价币种 |
| quantity | REAL | 持有数量 |
| cost_price | REAL | 成本均价（加权平均） |
| current_price | REAL | 当前市价（自动更新） |
| market_value | REAL | 当前市值（= quantity × current_price） |
| total_cost | REAL | 总成本（= quantity × cost_price） |
| profit_loss | REAL | 盈亏金额 |
| profit_loss_pct | REAL | 盈亏百分比 |
| account_id | INTEGER FK | 关联账户（旧字段） |
| investment_account_id | INTEGER FK | 关联投资账户（v2 新增） |
| notes | TEXT | 备注 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

---

## 5. transactions — 投资交易记录表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| asset_id | INTEGER FK | 关联资产 |
| type | TEXT | 类型：buy / sell / dividend / split |
| quantity | REAL | 数量 |
| price | REAL | 成交价 |
| fee | REAL | 手续费 |
| total_amount | REAL | 总金额 |
| currency | TEXT | 币种 |
| date | TEXT | 交易日期 |
| notes | TEXT | 备注 |
| created_at | TEXT | 创建时间 |

---

## 6. asset_prices — 资产价格历史表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| asset_id | INTEGER FK | 关联资产 |
| price | REAL | 价格 |
| date | TEXT | 日期 |

---

## 7. ledgers — 日常收支记账表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| type | TEXT | 类型：income / expense |
| amount | REAL | 金额 |
| currency | TEXT | 币种 |
| category_id | INTEGER FK | 分类 ID |
| subcategory_id | INTEGER FK | 子分类 ID（可空） |
| account_id | INTEGER FK | 来源/去向账户 |
| date | TEXT | 日期 |
| description | TEXT | 描述 |
| tags | TEXT | 标签（JSON 数组） |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

---

## 8. categories — 收支分类表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| name | TEXT | 分类名称 |
| type | TEXT | income / expense |
| parent_id | INTEGER FK | 父分类 ID（二级分类） |
| icon | TEXT | 图标 |
| sort_order | INTEGER | 排序 |
| is_default | INTEGER | 是否为默认分类 |

---

## 9. account_transactions — 存取记录表（v3 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| account_id | INTEGER FK | 关联账户 |
| type | TEXT | 类型：deposit / withdraw |
| amount | REAL | 金额 |
| currency | TEXT | 币种 |
| date | TEXT | 日期 |
| notes | TEXT | 备注 |
| investment_account_id | INTEGER FK | 关联投资账户（v11 新增，取款转入券商时追踪现金余额） |
| created_at | TEXT | 创建时间 |

---

## 10. currencies — 货币表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| code | TEXT UNIQUE | 货币代码（CNY, HKD, USD...） |
| name | TEXT | 中文名称 |
| symbol | TEXT | 符号（¥, HK$, $...） |
| rate_to_base | REAL | 对本位币汇率 |
| is_base | INTEGER | 是否为本位币 0/1 |
| updated_at | TEXT | 汇率更新时间 |

---

## 11. exchange_rates — 汇率历史表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| from_currency | TEXT | 来源币种 |
| to_currency | TEXT | 目标币种 |
| rate | REAL | 汇率 |
| date | TEXT | 日期 |

---

## 12. net_worth_history — 净资产历史表（v2 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| date | TEXT | 日期（UNIQUE） |
| total_cash | REAL | 现金总额 |
| total_investments | REAL | 投资总额 |
| net_worth | REAL | 净资产（= cash + investments） |
| created_at | TEXT | 创建时间 |

---

## 13. custom_statement_formats — 自定义日结单格式表（v4 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| name | TEXT | 格式名称（如"国信证券"） |
| keywords | TEXT | 检测关键词（逗号分隔） |
| column_mapping | TEXT | 列映射 JSON：`[{position, field}]` |
| has_header | INTEGER | 是否有表头行 0/1 |
| created_at | TEXT | 创建时间 |

---

## 14. custom_bank_formats — 自定义银行日结单格式表（v9 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| name | TEXT | 格式名称 |
| keywords | TEXT | 检测关键词（逗号分隔） |
| column_mapping | TEXT | 列映射 JSON |
| has_header | INTEGER | 是否有表头行 0/1 |
| created_at | TEXT | 创建时间 |

---

## 15. social_obligations — 人情债表（v6 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| type | TEXT | 类型：owe（欠别人）/ owed（别人欠我） |
| person | TEXT | 对方姓名 |
| item | TEXT | 事项描述 |
| status | TEXT | 状态：pending（待还）/ done（已还） |
| notes | TEXT | 备注 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

---

## 16. budgets — 月度预算表（v5 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| name | TEXT | 预算名称（如"月度总预算"） |
| amount | REAL | 预算金额 |
| currency | TEXT | 币种，默认 CNY |
| month | TEXT | 月份（如"2026-08"） |
| notify_at | REAL | 预警比例，默认 0.8（80%） |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

---

## 17. alert_config — 提醒配置表（v5 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| type | TEXT | 类型：price_drop / price_surge / budget_warning |
| enabled | INTEGER | 是否启用 0/1 |
| threshold | REAL | 阈值百分比（如 5 表示 5%） |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

**默认种子数据：**
| id | type | enabled | threshold |
|----|------|---------|-----------|
| 1 | price_drop | 1 | 5.0 |
| 2 | price_surge | 0 | 10.0 |

---

## 18. app_settings — 应用设置表（v5 新增）

键值存储，用于 AI 配置、归档设置、自定义名称等。

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT PK | 设置键名 |
| value | TEXT | 设置值 |
| updated_at | TEXT | 更新时间 |

**当前使用的键：**

| key | 说明 | 默认值 |
|-----|------|--------|
| `ai.provider` | AI 提供商 | `deepseek` |
| `ai.apiUrl` | AI API 端点 | `https://api.deepseek.com/v1/chat/completions` |
| `ai.apiKey` | AI API Key（AES-256-GCM 密文存储，v13 起；仅主进程可读，不随备份导出） | `""` |
| `ai.includePortfolio` | AI 组合数据共享开关（'1' 开 / '0' 关，默认开，v1.5.5） | `'1'` |
| `ai.model` | AI 模型名称 | `deepseek-chat` |
| `app_name` | 自定义应用名称（v1.4.0 新增） | `个人理财投资软件` |
| `archive.folderPath` | 归档文件夹路径 | `""` |
| `archive.retentionMonths` | 数据保留月数 | `12` |
| `archive.lastRun` | 上次归档日期 | — |

---

## 19. fixed_deposits — 定期存款表（v11 新增）

银行账户下的定期存款记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| account_id | INTEGER FK | 关联银行账户 |
| amount | REAL | 存款金额（本金） |
| currency | TEXT | 币种 |
| interest_rate | REAL | 年利率（%） |
| start_date | TEXT | 起始日期 |
| maturity_date | TEXT | 到期日期 |
| notes | TEXT | 备注 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

---

## 20. insurance_policies — 保单表（v12 新增）

独立的保单管理表，从 accounts 表中分离保险类数据。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| name | TEXT | 保单名称（如"平安福"） |
| company | TEXT | 保险公司 |
| policy_number | TEXT | 保单号码 |
| type | TEXT | 险种：life / health / annuity / critical / accident / other |
| annual_premium | REAL | 年度保费 |
| premium_currency | TEXT | 保费币种 |
| cash_value | REAL | 现金价值 |
| cash_value_currency | TEXT | 现金价值币种 |
| insured_person | TEXT | 被保险人 |
| start_date | TEXT | 生效日期 |
| premium_due_month | INTEGER | 缴费月（1-12） |
| premium_due_day | INTEGER | 缴费日（1-31） |
| account_id | INTEGER FK | 关联银行账户（扣款账户） |
| notes | TEXT | 备注 |
| is_active | INTEGER | 是否有效 0/1 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

---

## 21. premium_payments — 保费缴纳记录表（v12 新增）

记录每次保费缴纳，自动生成银行存取记录和流水账。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| policy_id | INTEGER FK | 关联保单 |
| amount | REAL | 缴纳金额 |
| currency | TEXT | 币种 |
| paid_date | TEXT | 缴纳日期 |
| account_id | INTEGER FK | 付款账户 |
| notes | TEXT | 备注 |
| created_at | TEXT | 创建时间 |

---

## 22. investment_cash_flows — 券商现金流水表（v14 新增）

券商账户的现金变动流水，**现金余额（`investment_accounts.cash_balance`）= Σ(amount) 派生**。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 主键 |
| investment_account_id | INTEGER FK | 关联券商账户 |
| type | TEXT | deposit 存入 / withdraw 取出 / buy 买入 / sell 卖出 / dividend 分红 / adjust 校正 |
| amount | REAL | 带符号：deposit/sell/dividend 为正；withdraw/buy 为负；adjust 为差额 |
| asset_id | INTEGER FK | 关联持仓（买入/卖出/分红时） |
| transaction_id | INTEGER FK | 关联交易记录（买卖时） |
| currency | TEXT | 币种 |
| date | TEXT | 日期 |
| notes | TEXT | 备注 |
| balance_after | REAL | 变动后余额快照（重算时自动维护） |
| created_at | TEXT | 创建时间 |

---

## 迁移历史

| 版本 | 变更内容 |
|------|---------|
| v1 | 核心表：accounts, categories, assets, asset_prices, transactions, ledgers, currencies, exchange_rates, borrow_lending, gift_records |
| v2 | + investment_accounts, + assets.investment_account_id, + net_worth_history |
| v3 | + account_transactions |
| v4 | + custom_statement_formats |
| v5 | + budgets, + alert_config, + app_settings, − borrow_lending, − gift_records |
| v6 | + social_obligations（人情债） |
| v7 | + parent_account_id（账户层级）, + account_balances（多币种余额） |
| v8 | + asset_type 列（资产大类分类） |
| v9 | + custom_bank_formats（银行日结单自定义格式） |
| v10 | + funding_account_id（投资账户 ↔ 银行账户关联，v1.4.0） |
| v11 | + cash_balance（投资账户闲置现金）, + account_transactions.investment_account_id, + fixed_deposits 表（v1.4.3） |
| v12 | + insurance_policies 表, + premium_payments 表, + accounts.display_alias, + JS 迁移函数支持（v1.5.0） |
| v13 | 安全加固：accounts.card_number 截断为后 4 位；app_settings['ai.apiKey'] 明文加密为 AES-256-GCM（v1.5.4） |
| v14 | + investment_cash_flows 表（券商现金流水，v1.5.6）；有现金余额的券商账户生成 adjust 期初快照流水 |

---

## 数据归档策略

| 表 | 归档方式 | 说明 |
|----|---------|------|
| transactions | 按月导出 Excel → 删除 | 投资交易核心数据 |
| ledgers | 按月导出 Excel → 删除 | 日常收支数据 |
| account_transactions | 按月删除（无单独报表） | 存取记录 |
| asset_prices | 按月删除 | 可从 API 重新获取 |
| exchange_rates | 按月删除 | 可从 API 重新获取 |
| 其他表 | 不归档 | 数据量小，不过期 |

默认保留期限：12 个月（可配置 6/12/18/24/36）。

---

## ER 关系

```
accounts ──┬── account_balances（多币种余额）
           ├── account_transactions（存取记录）
           ├── ledgers（收支记账）
           ├── fixed_deposits（定期存款）
           ├── insurance_policies（保单扣款账户）
           │     └── premium_payments（保费缴纳）
           └── investment_accounts（via funding_account_id）
                    │
                    ├── assets（持仓）
                    │     └── asset_prices（价格历史）
                    ├── transactions（交易记录）
                    └── investment_cash_flows（现金流水，v14）

categories ──→ ledgers

currencies ──→ exchange_rates

(独立表) net_worth_history, budgets, alert_config, app_settings,
        custom_statement_formats, custom_bank_formats, social_obligations
```
