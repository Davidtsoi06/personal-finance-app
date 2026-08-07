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
│   │   ├── 初始化数据库（migrations）
│   │   ├── 注册 IPC handlers
│   │   ├── 启动定时任务（scheduler）
│   │   └── 设置自动更新（electron-updater）
│   │
│   ├── preload.ts                 # Context bridge
│   │   └── 暴露 electronAPI 到渲染进程
│   │
│   ├── ipc/                       # IPC 通信层
│   │   ├── index.ts               # 主 handler 注册文件
│   │   │   └── 频道命名：domain:action
│   │   │   └── 全部 handler 在此注册（约 80+ 个）
│   │   └── update-ipc.ts          # 自动更新 handler
│   │
│   ├── database/
│   │   ├── index.ts               # 数据库初始化 + WAL 模式 + 迁移执行
│   │   ├── migrations.ts          # 版本化建表 SQL（v1 ~ v5）
│   │   └── services/              # 数据服务层（13 个）
│   │       ├── account-service.ts          # 账户 CRUD
│   │       ├── account-transaction-service.ts  # 存取记录 CRUD
│   │       ├── alert-service.ts            # 提醒配置 + 价格检查
│   │       ├── asset-service.ts            # 资产持仓 CRUD
│   │       ├── budget-service.ts           # 预算 CRUD + 状态计算
│   │       ├── category-service.ts          # 收支分类 CRUD
│   │       ├── currency-service.ts          # 货币 + 汇率转换
│   │       ├── custom-format-service.ts     # 日结单自定义格式
│   │       ├── investment-account-service.ts # 投资账户 CRUD
│   │       ├── ledger-service.ts            # 收支记账 CRUD
│   │       ├── net-worth-service.ts         # 净值记录 + 历史
│   │       ├── settings-service.ts          # KV 设置（AI 配置等）
│   │       └── transaction-service.ts       # 交易记录 CRUD
│   │
│   └── services/                  # 后台服务层（8 个）
│       ├── ai-service.ts          # AI 对话（构建 prompt + 调用 API + 流式 SSE）
│       ├── archive-service.ts     # 数据归档（生成月度 Excel + 清理旧数据）
│       ├── data-normalizer.ts     # 数据标准化（日期/币种/代码/字符串）
│       ├── exchange-rate-fetcher.ts  # 汇率数据抓取
│       ├── portfolio-context.ts   # 组合上下文收集（格式化为 Markdown）
│       ├── price-fetcher.ts       # 价格抓取（新浪/雅虎/天天基金等）
│       ├── scheduler.ts           # 定时任务调度 + 价格提醒检查
│       └── statement-parser.ts    # 日结单解析（CSV/Excel + 智能格式匹配）
│
├── Renderer Process (src/renderer/)
│   ├── index.html                 # HTML 入口
│   ├── index.tsx                  # React 入口（createRoot）
│   ├── App.tsx                    # 根组件（路由配置，9 个页面路由）
│   ├── hooks/
│   │   └── useIpc.ts              # IPC 调用封装（泛型 invoke）
│   ├── pages/                     # 页面组件（9 个）
│   │   ├── Dashboard.tsx          # 仪表盘首页
│   │   ├── Accounts.tsx           # 账户列表
│   │   ├── AccountDetail.tsx      # 账户详情 + 存取记录
│   │   ├── Investments.tsx        # 投资持仓列表
│   │   ├── HoldingsDetail.tsx     # 持仓详情 + 交易历史
│   │   ├── Bookkeeping.tsx        # 记账 + 账单导入
│   │   ├── Reports.tsx            # 报表分析
│   │   ├── AIAssistant.tsx        # AI 助手聊天
│   │   └── Settings.tsx           # 设置（汇率/备份/AI/预算/提醒/归档/更新）
│   └── components/
│       ├── Layout.tsx             # 侧边栏 + 内容区布局
│       ├── ui/                    # 通用 UI 组件（8 个）
│       │   ├── Amount.tsx         # 金额显示组件
│       │   ├── Badge.tsx          # 标签徽章
│       │   ├── Button.tsx         # 按钮（primary/secondary/danger/sm）
│       │   ├── Card.tsx           # 卡片容器
│       │   ├── Modal.tsx          # 模态对话框
│       │   ├── ProgressBar.tsx    # 进度条（颜色自适应）
│       │   └── Table.tsx          # 数据表格
│       ├── cards/                 # 业务卡片组件（2 个）
│       │   ├── ArchiveCard.tsx    # 数据归档管理卡片
│       │   └── BudgetCard.tsx     # 月度预算进度卡片
│       ├── charts/                # 图表组件（1 个）
│       │   └── NetWorthTrendChart.tsx  # 净资产走势图
│       └── forms/                 # 表单组件（4 个）
│           ├── AddAccountForm.tsx
│           ├── AddAssetForm.tsx
│           ├── AddLedgerForm.tsx
│           └── TradeForm.tsx
│
└── Shared (src/shared/)
    └── constants/
        ├── labels.ts              # 类型/市场/分类中文映射
        └── chart-colors.ts        # 图表颜色常量
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
| `account` | `account:list`, `account:create`, `account:delete` | 账户 CRUD |
| `asset` | `asset:list`, `asset:updatePrice`, `asset:totalMarketValue` | 资产持仓 |
| `transaction` | `transaction:list`, `transaction:create` | 交易记录 |
| `trade` | `trade:record`, `trade:parseStatement`, `trade:importParsed` | 交易操作 |
| `ledger` | `ledger:list`, `ledger:create`, `ledger:monthlySummary` | 收支记账 |
| `category` | `category:list`, `category:create` | 收支分类 |
| `currency` | `currency:list`, `currency:convert` | 货币汇率 |
| `investmentAccount` | `investmentAccount:holdings`, `investmentAccount:summary` | 投资账户 |
| `netWorth` | `netWorth:history`, `netWorth:record` | 净值历史 |
| `report` | `report:monthlyTrend`, `report:categoryBreakdown` | 报表数据 |
| `export` | `export:toExcel` | 单表导出 |
| `data` | `data:exportAll`, `data:importAll`, `data:refreshPrices` | 数据备份/刷新 |
| `budget` | `budget:list`, `budget:status` | 预算管理 |
| `alert` | `alert:listConfig`, `alert:updateConfig` | 提醒配置 |
| `settings` | `settings:getAiConfig`, `settings:testAiConnection` | 应用设置 |
| `ai` | `ai:chat`, `ai:chatStream` | AI 对话 |
| `archive` | `archive:getPendingMonths`, `archive:execute` | 数据归档 |
| `customFormat` | `customFormat:list`, `customFormat:create` | 自定义日结单 |
| `app` | `app:ping` | 应用状态 |
| `accountTransaction` | `accountTransaction:list`, `accountTransaction:create` | 存取记录 |

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
| 迁移方式 | 版本号递增，`meta` 表记录当前版本 |

### 表清单（14 张）

| 表名 | 说明 | 迁移版本 |
|------|------|---------|
| `accounts` | 资金账户 | v1 |
| `categories` | 收支分类 | v1 |
| `assets` | 资产持仓 | v1 |
| `asset_prices` | 价格历史 | v1 |
| `transactions` | 投资交易记录 | v1 |
| `ledgers` | 日常收支记账 | v1 |
| `currencies` | 货币定义 | v1 |
| `exchange_rates` | 汇率历史 | v1 |
| `investment_accounts` | 投资账户（券商） | v2 |
| `net_worth_history` | 净资产快照 | v2 |
| `account_transactions` | 存取记录 | v3 |
| `custom_statement_formats` | 自定义日结单格式 | v4 |
| `budgets` | 月度预算 | v5 |
| `alert_config` | 提醒配置 | v5 |
| `app_settings` | 应用设置（KV） | v5 |

完整字段定义见 [data-model.md](data-model.md)。

---

## 安全设计

| 措施 | 实现 |
|------|------|
| **Context Isolation** | `contextIsolation: true`，渲染进程不暴露 Node.js API |
| **API Key 保护** | AI API Key 仅存主进程 `app_settings` 表，`getAiConfigPublic()` 只返回 `hasApiKey` 布尔值，Key 明文永不到达渲染进程 |
| **无云端依赖** | 全部数据存本地 SQLite，无后端服务器，无数据外泄 |
| **事务保护** | 数据导入使用 `db.transaction()`，失败自动回滚 |
| **数据库加密** | 后续可选 SQLCipher 扩展 |

---

## 数据源

| 数据 | 来源 | 方法 | 更新频率 |
|------|------|------|----------|
| 汇率 | exchangerate-api.com | `fetch()` + JSON 解析 | 每日 |
| A 股 | 新浪财经 API | `fetch()` + 文本解析 | 实时/延迟 |
| 港股 | 新浪港股 API | `fetch()` + 文本解析 | 实时/延迟 |
| 美股 | Yahoo Finance | `fetch()` + JSON 解析 | 延迟 15 分钟 |
| 基金 | 天天基金 | `fetch()` + JSON 解析 | 每日 |
| AI 对话 | DeepSeek API | `fetch()` + SSE 流式 | 按需 |
| 自动更新 | GitHub Releases | electron-updater | 启动时检查 |

---

## 定时任务

Scheduler（`src/main/services/scheduler.ts`）管理所有后台定时任务：

| 任务 | 频率 | 说明 |
|------|------|------|
| 汇率刷新 | 每日 | 更新全部币种汇率 |
| 价格刷新 + 提醒 | 每 30 分钟 | 更新持仓价格，检查涨跌阈值 |
| 净值记录 | 每日 | 记录当日总资产快照 |

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

---

## 开发环境

- Node.js >= 18 LTS
- npm >= 9
- Windows 10 / 11（64 位）
- VS Code（推荐编辑器）
