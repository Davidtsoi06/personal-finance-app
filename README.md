# 个人理财投资软件

一款运行在 Windows 电脑上的**个人财产投资管理软件**，以投资管理为核心，统一管理现金、银行卡、股票、基金、黄金、加密货币等全部资产，提供深度财务洞察和智能记账。

## ✨ 功能概览

### 📊 仪表盘
- 总资产 / 净资产 / 现金存款 / 投资市值 四大统计卡片
- 资产分布饼图（现金、投资、在线支付等大类分类）
- 账户概览面板
- 净资产走势图（ECharts 折线图）
- 月度预算进度卡片（含「剩余每天可用」计算）

### 💳 账户管理
- 支持类型：现金、银行卡、信用卡、在线支付（微信/支付宝）
- 账户列表 + 详情页（含存取记录、余额变动）
- 按类型分类汇总

### 📈 投资管理（核心）
- 资产类型：A股 / 港股 / 美股 / 基金 / ETF / 黄金 / 加密货币 / 定期存款
- 持仓列表：名称、代码、数量、成本价、当前价、市值、盈亏
- 买卖交易记录（支持加权平均成本自动计算）
- 日结单导入（支持 CSV / Excel，智能格式匹配 + 自定义格式）
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
- 汇率自动更新（exchangerate-api.com）
- 汇率历史图表

### 📉 报表分析
- 月度收支趋势图
- 分类消费排行
- 年度收支统计
- 持仓表现排行

### 📦 数据归档
- 设定数据保留期限（默认 12 个月）
- 预设归档文件夹，一键归档旧数据
- 每月生成一份 **Excel 投资统计表**（含月度汇总、交易明细、个股统计、收支流水 4 个 Sheet）
- 文件名：`投资统计_YYYY-MM.xlsx`

### 📤 数据备份
- 一键导出全部 14 张表到一个 Excel 文件
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

### ⚙️ 设置
- 货币汇率管理
- 软件自动更新（基于 electron-updater）
- 自定义日结单格式配置

---

## 🛠 技术栈

| 层面 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Electron | 40.x |
| 前端框架 | React | 19.x |
| 类型系统 | TypeScript | 7.x（严格模式） |
| 构建工具 | Vite | 8.x |
| 数据库 | better-sqlite3 | 13.x（WAL 模式） |
| 图表 | ECharts | 6.x |
| Excel 处理 | xlsx | 0.18.x |
| HTTP 请求 | Node.js 原生 `fetch` | — |
| 自动更新 | electron-updater | 6.x |
| UI 组件 | 自研（无第三方 UI 库） | — |

---

## 📁 项目结构

```
个人理财投资软件/
├── src/
│   ├── main/                       # Electron 主进程
│   │   ├── index.ts                # 主进程入口（窗口创建、启动流程）
│   │   ├── preload.ts              # 预加载脚本（contextBridge）
│   │   ├── ipc/                    # IPC 通信处理
│   │   │   ├── index.ts            # 全部 IPC handler 注册
│   │   │   └── update-ipc.ts       # 自动更新相关 handler
│   │   ├── database/
│   │   │   ├── index.ts            # 数据库初始化 + 迁移
│   │   │   ├── migrations.ts       # 建表脚本（v1 ~ v5）
│   │   │   └── services/           # 数据服务层（13 个）
│   │   │       ├── account-service.ts
│   │   │       ├── account-transaction-service.ts
│   │   │       ├── alert-service.ts
│   │   │       ├── asset-service.ts
│   │   │       ├── budget-service.ts
│   │   │       ├── category-service.ts
│   │   │       ├── currency-service.ts
│   │   │       ├── custom-format-service.ts
│   │   │       ├── investment-account-service.ts
│   │   │       ├── ledger-service.ts
│   │   │       ├── net-worth-service.ts
│   │   │       ├── settings-service.ts
│   │   │       └── transaction-service.ts
│   │   └── services/               # 后台服务（8 个）
│   │       ├── ai-service.ts       # AI 对话（DeepSeek，含流式）
│   │       ├── archive-service.ts  # 数据归档（Excel 报表 + 清理）
│   │       ├── data-normalizer.ts  # 数据标准化
│   │       ├── exchange-rate-fetcher.ts  # 汇率抓取
│   │       ├── portfolio-context.ts      # AI 上下文数据收集
│   │       ├── price-fetcher.ts    # 价格抓取（多数据源）
│   │       ├── scheduler.ts        # 定时任务（价格/汇率刷新 + 提醒）
│   │       └── statement-parser.ts # 日结单解析
│   ├── renderer/                   # React 渲染进程
│   │   ├── index.html
│   │   ├── index.tsx               # React 入口
│   │   ├── App.tsx                 # 路由配置（9 个页面）
│   │   ├── hooks/
│   │   │   └── useIpc.ts           # IPC 调用封装 hook
│   │   ├── pages/                  # 页面组件（9 个）
│   │   │   ├── Dashboard.tsx       # 仪表盘
│   │   │   ├── Accounts.tsx        # 账户列表
│   │   │   ├── AccountDetail.tsx   # 账户详情
│   │   │   ├── Investments.tsx     # 投资持仓列表
│   │   │   ├── HoldingsDetail.tsx  # 持仓详情
│   │   │   ├── Bookkeeping.tsx     # 记账
│   │   │   ├── Reports.tsx         # 报表分析
│   │   │   ├── AIAssistant.tsx     # AI 助手
│   │   │   └── Settings.tsx        # 设置
│   │   └── components/
│   │       ├── Layout.tsx          # 侧边栏布局
│   │       ├── ui/                 # 通用 UI 组件
│   │       │   ├── Amount.tsx      # 金额显示（正负色 + 币种）
│   │       │   ├── Badge.tsx
│   │       │   ├── Button.tsx
│   │       │   ├── Card.tsx
│   │       │   ├── Modal.tsx
│   │       │   ├── ProgressBar.tsx # 进度条（颜色自适应）
│   │       │   └── Table.tsx
│   │       ├── cards/              # 卡片组件
│   │       │   ├── ArchiveCard.tsx # 数据归档卡片
│   │       │   └── BudgetCard.tsx  # 预算进度卡片
│   │       ├── charts/
│   │       │   └── NetWorthTrendChart.tsx  # 净资产走势图
│   │       └── forms/              # 表单组件
│   │           ├── AddAccountForm.tsx
│   │           ├── AddAssetForm.tsx
│   │           ├── AddLedgerForm.tsx
│   │           └── TradeForm.tsx
│   └── shared/                     # 共享代码
│       └── constants/
│           ├── labels.ts           # 分类标签映射
│           └── chart-colors.ts     # 图表颜色常量
├── docs/                           # 项目文档
│   ├── requirements.md             # 需求文档
│   ├── tech-spec.md                # 技术规范
│   ├── design-spec.md              # 设计规范
│   ├── data-model.md               # 数据模型
│   ├── dev-roadmap.md              # 开发路线图
│   └── api-reference.md            # API 参考
├── dev-logs/                       # 开发日志
├── scripts/                        # 构建脚本
└── dist/                           # 构建输出
```

---

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式（Vite + Electron 并行）
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
| API Key 保护 | AI API Key 仅存主进程 `app_settings` 表，`getAiConfigPublic()` 只返回 `hasApiKey: boolean`，Key 本身永不到达渲染进程 |
| 数据库加密 | 本地文件存储，后续可选 SQLCipher |
| 无云端依赖 | 全部数据存本地 SQLite，无后端服务器 |

---

## 🗄️ 数据库

- **引擎**：SQLite 3（better-sqlite3，同步 API）
- **模式**：WAL（Write-Ahead Logging）
- **位置**：`%APPDATA%/personal-finance/finance.db`
- **迁移**：版本号递增（v1 ~ v5），含 14 张业务表
- **表结构**：详见 [docs/data-model.md](docs/data-model.md)

---

## 📡 数据源

| 数据 | 来源 | 更新频率 |
|------|------|----------|
| 汇率 | exchangerate-api.com | 每日 |
| A 股 | 新浪财经 API | 实时 |
| 港股 | 新浪港股 API | 实时 |
| 美股 | Yahoo Finance | 延迟 15 分钟 |
| 基金 | 天天基金 | 每日 |
| AI 对话 | DeepSeek API | 按需 |
| 自动更新 | GitHub Releases | 按需检查 |

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
