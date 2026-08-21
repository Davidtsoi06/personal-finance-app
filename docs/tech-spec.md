# 技术规范 — 个人理财投资软件

## 技术选型

| 层面 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 桌面框架 | Electron | 40.x | 跨平台桌面应用框架 |
| 前端框架 | React | 19.x | UI 渲染，函数组件 + Hooks |
| 类型系统 | TypeScript | 7.x | 严格模式（`strict: true`） |
| 构建工具（渲染进程） | Vite | 8.x | 极速开发服务器 + 生产打包 |
| 构建工具（主进程） | tsc | 7.x | TypeScript 编译器直接编译 |
| 数据库 | better-sqlite3 | 13.x | SQLite 同步 Node.js 绑定 |
| 图表 | ECharts | 6.x | 专业金融图表 |
| Excel 处理 | xlsx | 0.18.x | 读写 .xlsx 文件 |
| HTTP 请求 | Node.js 原生 `fetch()` | — | 零额外依赖，用于汇率/价格/AI API |
| 自动更新 | electron-updater | 6.x | GitHub Releases 托管的自动更新 |
| UI 组件 | 自研（无第三方 UI 库） | — | 组件约 200 行以内，保持简洁可控 |
| 路由 | react-router-dom | 7.x | 客户端路由 |
| 包管理 | npm | — | 标准 Node.js 包管理 |

---

## 项目架构

```
Electron App
├── Main Process (src/main/)
│   ├── index.ts                   # 主进程入口
│   │   ├── 创建 BrowserWindow
│   │   ├── 初始化数据库（migrations v1~v13）
│   │   ├── 注册 IPC handlers
│   │   ├── 启动定时任务（scheduler）+ 保费到期提醒
│   │   └── 设置自动更新（electron-updater）
│   │
│   ├── preload.ts                 # Context bridge
│   │   └── 暴露 electronAPI 到渲染进程
│   │
│   ├── ipc/                       # IPC 通信层（8 个文件）
│   │   ├── account-ipc.ts         # 账户 + 存取记录 + allAssetsSummary
│   │   ├── asset-ipc.ts           # 资产 + 交易 + 日结单导入 + 银行产品查询
│   │   ├── insurance-ipc.ts       # 保单 CRUD + 保费缴纳（v1.5.0 新增）
│   │   ├── ledger-ipc.ts          # 收支 + 分类
│   │   ├── report-ipc.ts          # 报表数据
│   │   ├── settings-ipc.ts        # 投资账户/净值/格式/AI/预算/提醒/人情债/设置/归档
│   │   ├── update-ipc.ts          # 自动更新
│   │   └── wallet-ipc.ts          # 系统钱包 + 账单导入（v1.5.0 新增）
│   │
│   ├── database/
│   │   ├── index.ts               # 数据库初始化 + WAL 模式 + 迁移执行（支持 SQL + JS 迁移）
│   │   ├── migrations.ts          # 版本化建表 SQL + JS 数据迁移（v1 ~ v20）
│   │   └── services/              # 数据服务层（22 个）
│   │       ├── account-service.ts          # 账户 CRUD + 树形结构 + 统一资产汇总（四层架构）
│   │       ├── asset-cny-core.ts           # 跨币种 CNY 换算纯 DB 函数（无 electron 依赖）
│   │       ├── account-transaction-service.ts  # 存取记录 CRUD + 钱包账单导入
│   │       ├── alert-service.ts            # 提醒配置 + 价格检查
│   │       ├── asset-service.ts            # 资产持仓 CRUD + 价格/盈亏计算
│   │       ├── bank-format-service.ts      # 银行日结单自定义格式 CRUD
│   │       ├── budget-service.ts           # 预算 CRUD + 状态计算
│   │       ├── cash-flow-core.ts           # 券商现金流水纯 DB 操作（余额=Σ流水）
│   │       ├── category-service.ts          # 收支分类 CRUD
│   │       ├── currency-service.ts          # 货币 + 汇率转换 + 汇率历史
│   │       ├── custom-format-service.ts     # 券商日结单自定义格式 CRUD
│   │       ├── fixed-deposit-core.ts        # 定存纯 DB 操作（联动询问式 + 到期回款，v1.6.1；v1.9.0 流水/日结单驱动/利息拆分）
│   │       ├── fixed-deposit-service.ts      # 定期存款 CRUD（薄封装）
│   │       ├── statement-pairing.ts          # 日结单行与定存/流水智能配对 + 防重复指纹（v1.9.0 新增）
│   │       ├── insurance-service.ts         # 保单 CRUD + 保费缴纳 + 到期查询（v1.5.0 新增）
│   │       ├── investment-account-service.ts # 投资账户 CRUD + 持仓汇总 + 日统计 + 现金余额
│   │       ├── ledger-service.ts            # 收支记账 CRUD + 月度汇总（支持 accountId 过滤）
│   │       ├── net-worth-core.ts           # 净资产快照纯 DB 操作（口径复用 asset-totals，v1.6.1）
│   │       ├── net-worth-service.ts         # 净值记录 + 历史（薄封装）
│   │       ├── settings-service.ts          # KV 设置（AI/归档/自定义名称）
│   │       ├── social-obligation-service.ts  # 人情债 CRUD
│   │       └── transaction-service.ts       # 交易记录 CRUD + 当日查询
│   │
│   └── services/                  # 后台服务层（16 个）
│       ├── ai-service.ts          # AI 对话（构建 prompt + 调用 API + 流式 SSE）
│       ├── auth-core.ts            # 启动密码锁纯逻辑（scrypt 哈希/验证码/限流，v1.7.0）
│       ├── auth-service.ts         # 启动密码锁门禁（解锁状态/SMTP 发信/邮箱验证码找回，v1.7.0）
│       ├── archive-service.ts     # 数据归档（生成月度 Excel + 清理旧数据）
│       ├── bank-statement-parser.ts  # 银行日结单解析（CSV/Excel + 智能格式匹配）
│       ├── crypto-core.ts         # AES-256-GCM 纯函数核心（无 electron 依赖）
│       ├── crypto-util.ts         # 敏感数据加密密钥管理（v1.5.4 新增）
│       ├── data-normalizer.ts     # 数据标准化（日期/币种/代码/字符串）
│       ├── exchange-rate-fetcher.ts  # 汇率数据抓取
│       ├── portfolio-context.ts   # 组合上下文收集（格式化为 Markdown）
│       ├── price-fetcher.ts       # 价格抓取（主/备双源 + 智能市场检测）
│       ├── report-export-service.ts  # 报表数据构建（每日交易 + 资产快照 sheet + 导出转换，v1.5.2 新增）
│       ├── scheduler.ts           # 定时任务调度 + 价格提醒检查
│       ├── statement-classifier.ts   # 日结单行分类（转定期/定期回款/普通，v1.9.0 新增）
│       └── statement-parser.ts    # 券商日结单解析（CSV/Excel + 智能格式匹配）
│
├── Renderer Process (src/renderer/)
│   ├── index.html                 # HTML 入口
│   ├── index.tsx                  # React 入口（createRoot）
│   ├── App.tsx                    # 根组件（13 个页面路由，含 #/lock 锁屏页）
│   ├── hooks/
│   │   ├── useIpc.ts              # IPC 调用封装（泛型 invoke）
│   │   ├── useCurrencyRefresh.ts   # 汇率更新事件订阅 → 页面自动重载（v1.6.1）
│   │   ├── usePriceRefresh.ts      # 股价更新事件订阅 → 页面自动重载（v1.10.0）
│   │   └── useIdleLock.ts          # 空闲自动锁定（v1.7.0）
│   ├── pages/                     # 页面组件（13 个，含 LockScreen 锁屏页 v1.7.0）
│   │   ├── Dashboard.tsx          # 仪表盘（饼图下钻 + 概览可展开分组[银行内嵌关联券商] + 资产查询 + 走势 + 预算）
│   │   ├── Accounts.tsx           # 资产管理（Layer 2 四层架构卡片 + 银行分组可展开）
│   │   ├── AccountDetail.tsx      # 账户详情（存取记录 + 定期存款 + 银行理财产品）
│   │   ├── WalletFlow.tsx         # 钱包流水页（收支记录 + 账单导入，v1.5.0 新增）
│   │   ├── Insurance.tsx          # 保单管理页（保单 CRUD + 保费缴纳，v1.5.0 新增）
│   │   ├── Investments.tsx        # 投资账户列表（卡片 + 关联银行 + 当日交易）
│   │   ├── HoldingsDetail.tsx     # 持仓详情 + 交易历史（SlidePanel 侧边滑出）
│   │   ├── Bookkeeping.tsx        # 记账页
│   │   ├── SocialObligations.tsx  # 人情债管理
│   │   ├── Reports.tsx            # 报表分析
│   │   ├── AIAssistant.tsx        # AI 助手聊天
│   │   └── Settings.tsx           # 设置（应用名称/汇率/备份/AI/预算/提醒/归档/更新）
│   └── components/
│       ├── Layout.tsx             # 侧边栏 + 内容区布局（动态应用名称）
│       ├── ErrorBoundary.tsx      # 错误边界
│       ├── DailyTradesReport.tsx  # 每日交易报表卡片（v1.5.2 新增）
│       ├── ui/                    # 通用 UI 组件（8 个）
│       │   ├── Amount.tsx         # 金额显示（含 NetAmount 变体）
│       │   ├── Badge.tsx          # 标签徽章
│       │   ├── Button.tsx         # 按钮（primary/secondary/danger/sm）
│       │   ├── Card.tsx           # 卡片容器
│       │   ├── Modal.tsx          # 模态对话框
│       │   ├── ProgressBar.tsx    # 进度条（颜色自适应）
│       │   ├── SlidePanel.tsx     # 侧边滑出面板（v1.5.0 新增）
│       │   └── Table.tsx          # 数据表格
│       ├── account/               # 账户详情区块组件（3 个，v1.5.5 自 AccountDetail 拆分）
│       │   ├── AccountTransactionsSection.tsx # 存取记录（列表+弹窗）
│       │   ├── AccountTxFormModal.tsx        # 存入/取出表单弹窗
│       │   ├── BankStatementImportModal.tsx  # 银行日结单导入
│       │   └── FixedDepositsSection.tsx      # 定期存款区块
│       ├── holdings/               # 持仓详情区块组件（6 个，v1.5.5 拆分 + v1.5.6 CashFlowCard）
│       │   ├── HoldingsTableCard.tsx          # 持仓表 + 编辑/删除弹窗
│       │   ├── TradesTableCard.tsx            # 交易表 + 编辑/删除弹窗
│       │   ├── TradeHistoryModal.tsx          # 单股交易历史弹窗
│       │   ├── PriceModal.tsx                 # 手动改价弹窗
│       │   ├── BrokerStatementImportModal.tsx # 券商日结单导入
│       │   └── CashFlowCard.tsx                # 现金流水 + 余额校正（v1.5.6）
│       ├── cards/                 # 业务卡片组件（10 个）
│       │   ├── AiConfigCard.tsx   # AI 配置卡片
│       │   ├── AlertConfigCard.tsx # 提醒配置卡片
│       │   ├── ArchiveCard.tsx    # 数据归档管理卡片
│       │   ├── BankFormatCard.tsx # 银行日结单格式卡片（v1.5.5 自 Settings 拆分）
│       │   ├── BrokerFormatCard.tsx # 券商日结单格式卡片（v1.5.5 自 Settings 拆分）
│       │   ├── BudgetCard.tsx     # 月度预算进度卡片
│       │   ├── RealizedPnlCard.tsx # 年度已实现盈亏卡片（v1.5.5）
│       │   ├── DangerZoneCard.tsx # 危险操作卡片（v1.5.5 自 Settings 拆分）
│       │   ├── DataBackupCard.tsx # 数据备份恢复卡片
│       │   └── UpdateCard.tsx     # 版本更新卡片（v1.5.5 自 Settings 拆分）
│       ├── charts/                # 图表组件（1 个）
│       │   └── NetWorthTrendChart.tsx  # 净资产走势图
│       └── forms/                 # 表单组件（4 个）
│           ├── AddAccountForm.tsx
│           ├── AddAssetForm.tsx
│           ├── AddLedgerForm.tsx
│           └── TradeForm.tsx
│
└── Shared (src/shared/)
    ├── constants/
    │   ├── labels.ts              # 类型/市场/分类中文映射
    │   └── chart-colors.ts        # 图表颜色常量
    └── utils/                     # 纯函数工具（可单元测试，v1.5.5 新增）
        ├── money.ts               # 金额舍入（roundMoney/roundPct）
        ├── investment.ts          # 加权平均成本/盈亏纯函数
        ├── market.ts              # 股票代码智能市场检测
        ├── asset-totals.ts        # 总资产口径汇总纯函数（现金/流动金/投资/总资产，v1.6.1）
        ├── amount-parse.ts        # 日结单金额解析（千分位/括号负数/货币符号，v1.7.1）
        └── url-safety.ts          # AI 端点 SSRF 校验（公网 HTTPS，v1.7.1）
        ├── card.ts                # 卡号仅存后 4 位
        └── markdown.ts            # AI 回复安全渲染（先转义后转换）
```

---

## IPC 通信设计

### 架构模式

```
Renderer (React)  ──→  window.electronAPI.invoke(channel, ...args)
                          │
                          ▼
                   preload.ts (contextBridge)
                          │
                          ▼
                   ipcMain.handle(channel, handler)
                          │
                          ▼
                   数据库 / 服务层
```

### 频道命名规范

所有 IPC 频道采用 `domain:action` 格式：

| 域 | 频道示例 | 说明 |
|----|---------|------|
| `account` | `account:list`, `account:forceDelete`, `account:allAssetsSummary`, `account:createWithChildren`, `account:ensureAlipayFamily`（v1.10.7：支付宝归类升级，幂等） | 账户 CRUD + 树形 + 强制删除 + 统一资产汇总 + 支付宝多区域归类 |
| `accountTransaction` | `accountTransaction:list`, `accountTransaction:create`, `accountTransaction:update`, `accountTransaction:delete` | 存取记录（含编辑/删除） |
| `asset` | `asset:list`, `asset:update`, `asset:totalMarketValue`, `asset:listAll`, `asset:listOrphaned`（v1.6.0）, `asset:reassignOrphaned`（v1.6.0） | 资产持仓（含定存虚拟行/孤儿修复） |
| `transaction` | `transaction:list`, `transaction:update`, `transaction:delete`, `transaction:todayList` | 投资交易记录（含编辑/删除，自动回滚持仓） |
| `trade` | `trade:record`, `trade:parseStatement`, `trade:importParsed`, `trade:importExcel` | 交易操作 + 券商日结单（CSV/Excel） |
| `bank` | `bank:listFormats`, `bank:parseStatement`, `bank:importParsed`, `bank:importExcel` | 银行日结单导入（CSV/Excel） |
| `bankFormat` | `bankFormat:list`, `bankFormat:create`, `bankFormat:update`, `bankFormat:delete` | 银行日结单格式管理 |
| `ledger` | `ledger:list`, `ledger:create`, `ledger:monthlySummary` | 收支记账 |
| `category` | `category:list`, `category:create` | 收支分类 |
| `currency` | `currency:list`, `currency:convert`, `currency:rateHistory` | 货币汇率 |
| `investmentAccount` | `investmentAccount:list`, `investmentAccount:summary`, `investmentAccount:dailyStats`, `investmentAccount:addCash`, `investmentAccount:withdrawCash`, `investmentAccount:cashFlows`（v1.5.6）, `investmentAccount:adjustCash`（v1.5.6） | 投资账户 + 现金余额管理（v1.4.3，v1.5.6 起流水派生） |
| `fixedDeposit` | `fixedDeposit:listByAccount`, `fixedDeposit:create`, `fixedDeposit:update`（含 balanceMode 询问式）, `fixedDeposit:delete`（含 restoreBalance 询问式）, `fixedDeposit:settle`（到期回款，v1.6.1） | 定期存款 CRUD + 联动询问式（v1.4.3 新增） |
| `auth` | `auth:status`, `auth:setRecoveryEmail`, `auth:setupSmtp`, `auth:sendTestEmail`, `auth:enable`, `auth:changePassword`, `auth:disable`, `auth:verify`, `auth:lock`, `auth:quit`, `auth:requestResetCode`, `auth:verifyResetCode`, `auth:resetPassword`, `auth:setIdleMinutes` | 启动密码锁（v1.7.0，锁屏窗口仅暴露 verify/status/quit/重置类频道） |
| `netWorth` | `netWorth:history`, `netWorth:record` | 净值历史 |
| `report` | `report:monthlyTrend`, `report:categoryBreakdown`, `report:assetPerformance`, `report:dailyTrades`（v1.5.2）, `report:realizedPnl`（v1.5.5） | 报表数据 |
| `export` | `export:toExcel`, `export:dailyTrades`（v1.5.2） | Excel 导出 |
| `data` | `data:exportAll`, `data:importAll`, `data:confirmImport`, `data:clearAll`, `data:refreshPrices`, `data:refreshRates`, `data:refreshAll` | 数据备份/恢复/清空/刷新 |
| `budget` | `budget:list`, `budget:status` | 预算管理 |
| `alert` | `alert:listConfig`, `alert:updateConfig` | 提醒配置 |
| `socialObligation` | `socialObligation:list`, `socialObligation:create` | 人情债管理 |
| `settings` | `settings:getAiConfig`, `settings:getAppName`, `settings:setAppName` | 应用设置 |
| `ai` | `ai:chat`, `ai:chatStream`, `ai:dailySummary` | AI 对话 |
| `archive` | `archive:getPendingMonths`, `archive:execute`, `archive:getSettings` | 数据归档 |
| `customFormat` | `customFormat:list`, `customFormat:create`, `customFormat:update`, `customFormat:delete` | 券商日结单自定义格式 |
| `update` | `update:check`, `update:download`, `update:getVersion` | 自动更新 |
| `app` | `app:ping` | 应用状态 |

### 频道类型安全与一致性校验（v1.5.5）

- 频道名称的**单一事实来源**是主进程注册；`src/shared/types/ipc.ts` 提供 `IpcChannel` 类型联合，渲染进程 `invoke()` 的 channel 参数受**编译期校验**（频道名拼错直接在 tsc 报错）
- `scripts/check-ipc-whitelist.js` 校验「主进程注册（ipcMain.handle + handleValidated） ↔ preload 白名单 ↔ 类型联合 ↔ zod schema 接入」四处一致，挂入 `npm test`（也可单独 `npm run check:ipc`）
- 新增 IPC 频道流程：先在主进程注册 → 运行 `npm run check:ipc` 查看不一致 → 同步 preload 白名单、`ipc.ts` 类型联合与校验 schema

### IPC 入参运行时校验（zod，v1.5.5，v1.7.1 全局门禁）

- **边界防护**：渲染进程传错类型/缺字段/非法枚举时在 IPC 边界直接拒绝（报错含具体字段与原因），防止脏数据落库
- **实现**：`src/shared/ipc-validation.ts` 定义 77 个频道的参数元组 schema（对象一律 `.passthrough()` 向前兼容；数字字段 `z.coerce` 兼容表单字符串）；`src/main/ipc/validation.ts` 提供 `handleValidated(channel, handler)` 包装器
- **全局密码锁门禁（v1.7.1）**：`ipc/index.ts` 对 `ipcMain.handle` 统一打补丁，全部频道（含裸注册的只读/报表/更新频道）在未解锁时一律拒绝，`auth:*` 频道放行
- **覆盖范围**：全部 `:create` / `:update` / `:delete` 及 addCash/withdrawCash、trade:record、日结单导入、清空（含主进程二次确认）/归档等频道
- **测试**：`tests/unit/validation.test.ts` 13 个用例（合法通过/字符串转数字/负数与 NaN 拒绝/非法枚举/缺字段/日期格式/超长字段/联动字段归一化/auth 频道）

### 流式通信

AI 对话支持 SSE 流式响应，通过 Electron 的 `event.sender.send()` 推送：

```
渲染进程                        主进程
  │                               │
  ├── invoke('ai:chatStream') ──→ │
  │                               ├── fetch(SSE) → DeepSeek API
  │   ←── send('ai:streamChunk')  │
  │   ←── send('ai:streamChunk')  │
  │   ←── send('ai:streamDone')   │
  │                               │
```

---

## 数据库设计

### 基本信息

| 项目 | 值 |
|------|-----|
| 引擎 | SQLite 3 |
| Node.js 绑定 | better-sqlite3（同步 API） |
| 写入模式 | WAL（Write-Ahead Logging） |
| 外键 | `PRAGMA foreign_keys = ON` |
| 存储位置 | `%APPDATA%/personal-finance/finance.db` |
| 迁移方式 | 版本号递增（v1~v14），`_migrations` 表记录当前版本 |
| 金额精度 | REAL 存储；所有计算出口经 `roundMoney`（`src/shared/utils/money.ts`）统一四舍五入到分；均价等中间比例值保留全精度 |

### 表清单（22 张）

| 表名 | 说明 | 迁移版本 |
|------|------|---------|
| `accounts` | 资金账户（含树形层级 + 多币种余额） | v1/v7/v8 |
| `account_balances` | 多币种余额明细 | v7 |
| `account_transactions` | 存取记录 | v3 |
| `categories` | 收支分类 | v1 |
| `assets` | 资产持仓 | v1/v2 |
| `asset_prices` | 价格历史 | v1 |
| `transactions` | 投资交易记录 | v1 |
| `ledgers` | 日常收支记账 | v1 |
| `currencies` | 货币定义 | v1 |
| `exchange_rates` | 汇率历史 | v1 |
| `investment_accounts` | 投资账户（券商，含银行关联） | v2/v10 |
| `net_worth_history` | 净资产快照 | v2 |
| `custom_statement_formats` | 券商日结单自定义格式 | v4 |
| `custom_bank_formats` | 银行日结单自定义格式 | v9 |
| `social_obligations` | 人情债 | v6 |
| `budgets` | 月度预算 | v5 |
| `alert_config` | 提醒配置 | v5 |
| `app_settings` | 应用设置（KV） | v5 |
| `fixed_deposits` | 定期存款 | v11 |
| `insurance_policies` | 保单 | v12 |
| `premium_payments` | 保费缴纳记录 | v12 |
| `investment_cash_flows` | 券商现金流水 | v14 |

完整字段定义见 [data-model.md](data-model.md)。

---

## 安全设计

| 措施 | 实现 |
|------|------|
| **Context Isolation** | `contextIsolation: true`，渲染进程不暴露 Node.js API |
| **API Key 保护** | AI API Key 仅存主进程 `app_settings` 表（AES-256-GCM 密文，密钥存 `userData/secret.key`，与数据库分离），`getAiConfigPublic()` 只返回 `hasApiKey` 布尔值，Key 明文永不到达渲染进程，且不随备份导出 |
| **卡号保护** | 银行卡号仅存后 4 位（服务层 `normalizeCardNumber` 截断 + 迁移 v13 清洗存量数据），完整卡号不落库 |
| **IPC 白名单** | preload 仅放行主进程已注册的 189 个频道（含 `app:ping`），未授权频道调用直接拒绝；锁屏窗口使用独立最小权限 `lock-preload`（v1.7.0） |
| **AI 渲染安全** | AI 回复先整体 HTML 转义再做 Markdown 转换，模型输出中的原始 HTML 不会进入 DOM（防 XSS） |
| **单实例运行** | `app.requestSingleInstanceLock()`：双开时第二个实例直接退出并聚焦已有窗口，防止双进程写库/重复调度 |
| **迁移前自动备份** | 有待执行迁移时自动把数据库复制到 `userData/backups/`（WAL checkpoint 后），仅保留最近 5 份 |
| **完整性检查** | 启动时先执行轻量的 `PRAGMA quick_check`（主结构扫描），失败再用完整 `integrity_check` 取详细错误并中止启动、提示从备份恢复 |
| **密钥文件权限** | Windows 下 `secret.key` 通过 `icacls` 收紧为仅当前用户可读写（移除继承，v1.5.5） |
| **AI 隐私开关** | 设置页可关闭「组合数据共享」（`ai.includePortfolio`），关闭后 `gatherPortfolioContext`/日摘要仅返回隐私提示，不发送持仓/账户/交易数据 |
| **AI 隐私开关** | 设置页可关闭「组合数据共享」（`ai.includePortfolio`），关闭后 `gatherPortfolioContext`/日摘要仅返回隐私提示，不发送持仓/账户/交易数据 |
| **无云端依赖** | 全部数据存本地 SQLite，无后端服务器，无数据外泄 |
| **事务保护** | 数据导入使用 `db.transaction()`，失败自动回滚 |
| **数据库加密** | 敏感字段已加密（AI Key，AES-256-GCM）；整库 SQLCipher 加密列为后续可选 |

---

## 数据源

| 数据 | 主数据源 | 备用数据源 | 更新频率 |
|------|---------|-----------|----------|
| 汇率 | exchangerate-api.com | — | 每 6 小时 |
| A 股 | 新浪 `hq.sinajs.cn` | 腾讯 `qt.gtimg.cn` | 每 30 分钟 |
| 港股 | 新浪 `hq.sinajs.cn` | 腾讯 `qt.gtimg.cn` | 每 30 分钟 |
| 美股 | Yahoo Finance v8 | 新浪 `gb_` 前缀 | 每 30 分钟 |
| 基金 | 天天基金 | — | 每 30 分钟 |
| 黄金 | 新浪 `hf_XAU` | Gold-API | 每 30 分钟 |
| 加密货币 | CoinGecko | Binance 公开 API | 每 30 分钟 |
| AI 对话 | DeepSeek API | — | 按需 |
| 自动更新 | GitHub Releases | — | 启动时检查 |

智能市场检测：`detectMarket()`（`src/shared/utils/market.ts`）根据代码格式自动判断市场（6 位纯数字→A 股，1-5 位数字→港股，1-5 位字母→美股，支持 `.SH`/`.SZ`/`.HK`/`.US` 等交易所后缀），保持对 `asset.market` 字段的向后兼容。

---

## 定时任务

Scheduler（`src/main/services/scheduler.ts`）管理所有后台定时任务：

| 任务 | 频率 | 说明 |
|------|------|------|
| 价格刷新 + 提醒 | 每 30 分钟 | 更新持仓价格，主源失败自动切换备源，检查涨跌阈值 |
| 汇率刷新 | 每 6 小时 | 更新全部币种汇率 |
| 净值记录 | 每日 | 记录当日总资产快照 |
| AI 日摘要 | 每日 15:30 | 自动生成投资组合分析摘要 |

---

## CSS 方案

### 设计令牌

所有样式变量定义在 `src/renderer/styles/` 中，以 CSS 自定义属性（`--color-*`、`--font-*`、`--spacing-*`、`--radius-*`、`--shadow-*`）形式提供。

### 样式方法论

- 页面级：BEM 命名（如 `stat-card__label`、`budget-card__alert--warning`）
- 组件级：组件名作为最外层 className，内部 BEM
- 禁止行内样式（除动态计算的值外）
- 详见 [design-spec.md](design-spec.md)

---

## 构建与部署

### 开发

```bash
npm run dev
# → concurrently 启动 Vite dev server + tsc main + Electron
# Electron 以 ELECTRON_DEV=1 启动，窗口加载 http://localhost:5173（真 HMR）
# 生产运行（加载 dist/renderer）：npm run build && npm start
```

### 生产构建

```bash
npm run build
# → vite build（渲染进程） + tsc（主进程）
```

### 打包安装包

```bash
npm run release:local
# → electron-builder 打包为 Windows .exe（NSIS 安装程序）
```

### 测试

```bash
npm test                # 单元 + 集成测试（vitest，230 个用例）
npm run test:unit       # 仅单元测试（共享纯函数：金额/成本/市场/卡号/Markdown/加密）
npm run test:integration # 仅集成测试（迁移体系，真实 SQLite 内存库）
npm run test:e2e        # E2E（Playwright + Electron：构建后启动真实应用冒烟测试）
```

测试目录：`tests/unit/`、`tests/integration/`、`tests/e2e/`。CI（GitHub Actions）执行 `npm run build` + `npm test`。E2E 通过环境变量 `PF_USER_DATA_DIR` 使用独立临时数据目录，不触碰真实用户数据。

### 性能

- **路由级代码分割**：12 个页面经 `React.lazy` + `Suspense` 按路由分包（v1.5.5），首屏只加载当前路由对应的 chunk
- **启动耗时统计**：主进程启动流程打印总耗时（`[Main] ✓ 启动完成，总耗时 XXms`），作为后续优化基线

---

## 开发环境

- Node.js >= 18 LTS
- npm >= 9
- Windows 10 / 11（64 位）
- VS Code（推荐编辑器）
