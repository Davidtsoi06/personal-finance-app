# 个人理财投资软件

一款运行在 Windows 电脑上的**个人财产投资管理软件**，以投资管理为核心，统一管理现金、银行卡、股票、基金、黄金、加密货币等全部资产，提供深度财务洞察和智能记账。

**最新版本：v1.4.2**（2026-08-10）

## ✨ 功能概览

### 📊 仪表盘
- 总资产 / 现金存款 / 投资市值 / 本月收支 四大统计卡片
- 资产分布 ECharts 饼图（**两级下钻**：大类 → 账户明细，点击中心返回）
- 资产概览面板（按类别分项显示金额和数量）
- 🔍 资产查询与分析（搜索/筛选/排序 + 快速统计）
- 净资产走势图（30 天可配置）
- 月度预算进度卡片（含「剩余每天可用」计算，颜色自适应）

### 💳 账户管理
- 支持类型：银行、现金、保险、投资、自定义
- **树形层级结构**：父账户 + 子账户（银行卡/子账户）
- 多币种余额（`account_balances` 表）
- 添加 / 编辑 / 安全删除 / **强制级联删除** 账户
- 账户详情页（含存取记录编辑/删除、余额变动历史）
- 投资账户可**关联银行账户**，资产树中作为银行子节点展示
- 银行日结单导入（CSV / Excel，自定义格式）

### 📈 投资管理（核心）
- 资产类型：A股 / 港股 / 美股 / 基金 / ETF / 黄金 / 加密货币 / 定期存款
- 持仓列表：名称、代码、数量、成本价、当前价、市值、盈亏
- 买卖交易记录（加权平均成本自动计算）
- **编辑 / 删除持仓**（全字段可编辑）
- **编辑 / 删除交易记录**（自动重算持仓成本和盈亏）
- **价格自动更新**：5 个市场主/备双数据源 + 智能市场检测 + 自动 failover
- 券商日结单导入（CSV / Excel，智能关键词匹配 + 自定义格式编辑）
- 持仓详情页：交易历史、价格走势

### 🤖 AI 投资助手
- 基于 DeepSeek API，注册即送 $5 免费额度（每日 50 次免费调用）
- 自动读取用户全部持仓、账户、交易数据作为上下文
- 支持流式响应，Markdown 渲染
- 快捷提问：分析组合、风险评估、优化建议、投资报告、消费分析
- API Key 仅存本地主进程，永不暴露给渲染进程

### 📝 记账
- 收入 / 支出记录，支持多账户、多分类
- 两级分类系统 + 标签
- 月度收支统计

### 💱 多币种与汇率
- 本位币：人民币（CNY），支持 HKD / USD / EUR / JPY / GBP
- 汇率自动更新（exchangerate-api.com，每 6 小时）
- 汇率历史图表

### 🎁 人情往来
- 欠别人 / 别人欠我 两种类型
- 记录事项、对方、状态（待还/已还）
- 独立页面管理

### 📉 报表分析
- 月度收支趋势图
- 分类消费排行
- 年度收支统计
- 持仓表现排行（市值/盈亏排序、总汇总行）

### 📦 数据归档
- 设定数据保留期限（默认 12 个月，可配置 6/12/18/24/36 个月）
- 预设归档文件夹，一键归档旧数据
- 每月生成一份 **Excel 投资统计表**（含月度汇总、交易明细、个股统计、收支流水 4 个 Sheet）
- 文件名：`投资统计_YYYY-MM.xlsx`

### 📤 数据备份
- 一键导出全部 16 张表到一个 Excel 文件
- 一键恢复（含预览确认 + 事务保护）
- 适合换设备或重装系统时迁移数据

### 💰 预算管理
- 月度预算设置 + 预警比例
- 仪表盘预算进度条（绿→蓝→橙→红自适应）
- 超支提醒（Windows 系统通知）

### ⚠️ 智能提醒
- 涨跌幅提醒（可独立开关 + 自定义阈值）
- 价格每 30 分钟自动刷新并检查
- 触发时弹出 Windows 系统通知

### ⚙️ 更多设置
- 自定义软件名称（窗口标题 + 侧边栏标题）
- 货币汇率管理
- 自动更新（electron-updater + GitHub Releases）
- 自定义日结单格式配置（券商 + 银行，支持编辑）

---

## 🛠 技术栈

| 层面 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Electron | 40.x |
| 前端框架 | React | 19.x |
| 类型系统 | TypeScript | 7.x（严格模式） |
| 构建工具 | Vite + tsc | 8.x |
| 数据库 | better-sqlite3 | 13.x（WAL 模式） |
| 图表 | ECharts | 6.x |
| Excel 处理 | xlsx | 0.18.x |
| HTTP 请求 | Node.js 原生 `fetch` | — |
| 自动更新 | electron-updater | 6.x |
| 路由 | react-router-dom | 7.x |
| UI 组件 | 自研（无第三方 UI 库） | — |

---

## 📁 项目结构

```
个人理财投资软件/
├── src/
│   ├── main/                       # Electron 主进程
│   │   ├── index.ts                # 主进程入口（窗口创建、启动流程）
│   │   ├── preload.ts              # 预加载脚本（contextBridge）
│   │   ├── ipc/                    # IPC 通信处理（5 个文件）
│   │   │   ├── account-ipc.ts      # 账户 + 存取记录 + 强制删除
│   │   │   ├── asset-ipc.ts        # 资产 + 交易 + 日结单导入
│   │   │   ├── ledger-ipc.ts       # 收支 + 分类
│   │   │   ├── report-ipc.ts       # 报表数据
│   │   │   ├── settings-ipc.ts     # 设置/格式/AI/预算/提醒/归档/人情债
│   │   │   └── update-ipc.ts       # 自动更新
│   │   ├── database/
│   │   │   ├── index.ts            # 数据库初始化 + WAL 模式 + 迁移
│   │   │   ├── migrations.ts       # 建表脚本（v1 ~ v10）
│   │   │   └── services/           # 数据服务层（15 个）
│   │   │       ├── account-service.ts
│   │   │       ├── account-transaction-service.ts
│   │   │       ├── alert-service.ts
│   │   │       ├── asset-service.ts
│   │   │       ├── bank-format-service.ts
│   │   │       ├── budget-service.ts
│   │   │       ├── category-service.ts
│   │   │       ├── currency-service.ts
│   │   │       ├── custom-format-service.ts
│   │   │       ├── investment-account-service.ts
│   │   │       ├── ledger-service.ts
│   │   │       ├── net-worth-service.ts
│   │   │       ├── settings-service.ts
│   │   │       ├── social-obligation-service.ts
│   │   │       └── transaction-service.ts
│   │   └── services/               # 后台服务（9 个）
│   │       ├── ai-service.ts       # AI 对话（DeepSeek，含流式 SSE）
│   │       ├── archive-service.ts  # 数据归档（Excel 报表 + 清理）
│   │       ├── bank-statement-parser.ts  # 银行日结单解析
│   │       ├── data-normalizer.ts  # 数据标准化（日期/币种/代码）
│   │       ├── exchange-rate-fetcher.ts  # 汇率抓取
│   │       ├── portfolio-context.ts      # AI 上下文数据收集
│   │       ├── price-fetcher.ts    # 价格抓取（主/备双源 + failover）
│   │       ├── scheduler.ts        # 定时任务（价格/汇率/AI 日摘要）
│   │       └── statement-parser.ts # 券商日结单解析
│   ├── renderer/                   # React 渲染进程
│   │   ├── index.html
│   │   ├── index.tsx               # React 入口
│   │   ├── App.tsx                 # 路由配置（10 个页面）
│   │   ├── hooks/
│   │   │   └── useIpc.ts           # IPC 调用封装 hook
│   │   ├── pages/                  # 页面组件（10 个）
│   │   │   ├── Dashboard.tsx       # 仪表盘（饼图下钻 + 资产查询）
│   │   │   ├── Accounts.tsx        # 账户列表（树形 + 子账户 + 强制删除）
│   │   │   ├── AccountDetail.tsx   # 账户详情（存取记录编辑/删除）
│   │   │   ├── Investments.tsx     # 投资账户列表（关联银行 + 今日交易）
│   │   │   ├── HoldingsDetail.tsx  # 持仓详情（交易编辑/删除 + 持仓编辑）
│   │   │   ├── Bookkeeping.tsx     # 记账
│   │   │   ├── SocialObligations.tsx  # 人情债
│   │   │   ├── Reports.tsx         # 报表分析
│   │   │   ├── AIAssistant.tsx     # AI 助手
│   │   │   └── Settings.tsx        # 设置
│   │   └── components/
│   │       ├── Layout.tsx          # 侧边栏布局（动态应用名称）
│   │       ├── ErrorBoundary.tsx   # 错误边界
│   │       ├── ui/                 # 通用 UI 组件（7 个）
│   │       │   ├── Amount.tsx      # 金额显示（含 NetAmount 变体）
│   │       │   ├── Badge.tsx
│   │       │   ├── Button.tsx
│   │       │   ├── Card.tsx
│   │       │   ├── Modal.tsx
│   │       │   ├── ProgressBar.tsx # 进度条（颜色自适应）
│   │       │   └── Table.tsx
│   │       ├── cards/              # 业务卡片组件（5 个）
│   │       │   ├── AiConfigCard.tsx
│   │       │   ├── AlertConfigCard.tsx
│   │       │   ├── ArchiveCard.tsx
│   │       │   ├── BudgetCard.tsx
│   │       │   └── DataBackupCard.tsx
│   │       ├── charts/             # 图表组件（1 个）
│   │       │   └── NetWorthTrendChart.tsx
│   │       └── forms/              # 表单组件（4 个）
│   │           ├── AddAccountForm.tsx
│   │           ├── AddAssetForm.tsx
│   │           ├── AddLedgerForm.tsx
│   │           └── TradeForm.tsx
│   └── shared/                     # 共享代码
│       └── constants/
│           ├── labels.ts           # 类型/市场/分类中文映射
│           └── chart-colors.ts     # 图表颜色常量
├── docs/                           # 项目文档（6 个）
│   ├── requirements.md             # 需求文档
│   ├── tech-spec.md                # 技术规范
│   ├── design-spec.md              # 设计规范
│   ├── data-model.md               # 数据模型
│   ├── dev-roadmap.md              # 开发路线图
│   └── api-reference.md            # API 参考
├── dev-logs/                       # 开发日志
└── dist/                           # 构建输出
```

---

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式（Vite + tsc + Electron 并行）
npm run dev

# 构建生产版本
npm run build

# 打包 Windows 安装包
npm run release:local
```

### 环境要求

- **Node.js** >= 18 LTS
- **npm** >= 9
- **Windows** 10 / 11（64 位）
- 分辨率 >= 1280 × 720

---

## 🔒 安全设计

| 措施 | 说明 |
|------|------|
| Context Isolation | `contextIsolation: true`，渲染进程无法直接访问 Node.js |
| API Key 保护 | AI API Key 仅存主进程，`getAiConfigPublic()` 只返回 `hasApiKey: boolean`，Key 明文永不到达渲染进程 |
| 数据库加密 | 本地文件存储，后续可选 SQLCipher |
| 无云端依赖 | 全部数据存本地 SQLite，无后端服务器 |
| 事务保护 | 数据导入/删除使用 `db.transaction()`，失败自动回滚 |

---

## 🗄️ 数据库

- **引擎**：SQLite 3（better-sqlite3，同步 API）
- **模式**：WAL（Write-Ahead Logging）
- **位置**：`%APPDATA%/personal-finance/finance.db`
- **迁移**：版本号递增（v1 ~ v10），含 16 张业务表
- **表结构**：详见 [docs/data-model.md](docs/data-model.md)

---

## 📡 数据源

| 数据 | 主数据源 | 备用数据源 | 更新频率 |
|------|---------|-----------|----------|
| 汇率 | exchangerate-api.com | — | 每 6 小时 |
| A 股 | 新浪 `hq.sinajs.cn`（sh/sz） | 腾讯 `qt.gtimg.cn` | 每 30 分钟 |
| 港股 | 新浪 `hq.sinajs.cn`（hk） | 腾讯 `qt.gtimg.cn` | 每 30 分钟 |
| 美股 | Yahoo Finance v8 | 新浪 `gb_` 前缀 | 每 30 分钟 |
| 基金 | 天天基金 | — | 每 30 分钟 |
| 黄金 | 新浪 `hf_XAU` | Gold-API | 每 30 分钟 |
| 加密货币 | CoinGecko | Binance 公开 API | 每 30 分钟 |
| AI 对话 | DeepSeek API | — | 按需 |
| 自动更新 | GitHub Releases | — | 启动时检查 |

**智能市场检测**：根据代码格式自动判断市场（5xxxxx/6xxxxx→sh，0xxxxx~3xxxxx→sz，1-5位数字→港股，字母→美股）

---

## 📖 文档

| 文档 | 说明 |
|------|------|
| [需求文档](docs/requirements.md) | 完整功能需求和用户故事 |
| [技术规范](docs/tech-spec.md) | 技术架构、IPC 设计、数据库设计 |
| [设计规范](docs/design-spec.md) | 色彩、字体、间距、组件设计令牌 |
| [数据模型](docs/data-model.md) | 全部数据库表结构定义 |
| [开发路线图](docs/dev-roadmap.md) | 分阶段开发计划 |
| [API 参考](docs/api-reference.md) | 数据源 API 使用说明 |

---

## 📝 开发日志

查看 [dev-logs/](dev-logs/) 目录了解每次开发的完成事项和待办。文件名格式：`YYYY-MM-DD.md`。

---

## 📄 License

MIT
