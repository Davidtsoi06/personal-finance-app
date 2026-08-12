# 开发路线图 — 个人理财投资软件

## 阶段总览

| 阶段 | 名称 | 内容 | 状态 |
|------|------|------|------|
| 0 | 项目初始化 | 文件夹结构、文档体系 | ✅ 完成 |
| 1 | 框架搭建 | Electron + React + TypeScript + SQLite 跑通 | ✅ 完成 |
| 2 | 数据层 | 数据库表创建、CRUD 服务（15 个） | ✅ 完成 |
| 3 | UI 框架 | 设计令牌、通用组件（7 个）、布局 | ✅ 完成 |
| 4 | 核心功能 | 仪表盘、账户、投资、记账、报表（10 页面） | ✅ 完成 |
| 5 | 数据源接入 | 汇率/价格 API + 主备双源架构 + 定时调度 | ✅ 完成 |
| 6 | AI 助手 | DeepSeek 对话 + 持仓上下文 + 流式响应 | ✅ 完成 |
| 7 | 智能功能 | 预算管理、涨跌提醒、Windows 通知 | ✅ 完成 |
| 8 | 数据安全 | Excel 备份恢复、数据归档 | ✅ 完成 |
| 9 | 自动更新 | electron-updater + GitHub Releases | ✅ 完成 |
| 10 | v1.1.0 — v1.3.0 | 人情债、银行日结单、账户层级、多币种余额 | ✅ 完成 |
| 11 | v1.4.0 | Dashboard 增强 + 价格源增强 + 投资账户关联 | ✅ 完成 |
| 12 | v1.4.1 | 滚动条增强 + 格式编辑 + 持仓全字段编辑 + CSV 导入 + 银行账户增强 | ✅ 完成 |
| 13 | v1.4.3 | 基金价格 API + 定期存款 + 券商现金余额 + 投资账户关联 + 父账户汇总余额 | ✅ 完成 |
| 14 | v1.5.0 | 四层资产架构重构（电子钱包/银行分组/保单/券商）+ 保单管理 + 保费提醒 | ✅ 完成 |
| 15 | 打包发布 | Windows .exe 安装包 | ⏳ 待开始 |

---

## 第 0 阶段：项目初始化 ✅

- [x] 创建项目文件夹结构
- [x] 创建 CLAUDE.md 指引文件
- [x] 编写需求文档 requirements.md
- [x] 编写技术规范 tech-spec.md
- [x] 编写设计规范 design-spec.md
- [x] 编写数据模型 data-model.md
- [x] 编写开发路线图 dev-roadmap.md

---

## 第 1 阶段：框架搭建 ✅

- [x] npm init + 安装依赖
- [x] 配置 TypeScript（tsconfig.main.json / tsconfig.json）
- [x] 配置 Vite 打包
- [x] 创建 Electron 主进程入口（src/main/index.ts）
- [x] 创建 React 渲染进程入口（src/renderer/）
- [x] 配置 IPC 通信（ipcMain.handle + preload contextBridge）
- [x] 配置 SQLite 数据库初始化（better-sqlite3 + WAL）
- [x] 验证：`npm run dev` 正常运行

---

## 第 2 阶段：数据层 ✅

- [x] 编写完整建表 SQL 脚本（migrations v1 ~ v10）
- [x] 实现 15 个 service：account, account-transaction, alert, asset, bank-format, budget, category, currency, custom-format, investment-account, ledger, net-worth, settings, social-obligation, transaction

---

## 第 3 阶段：UI 框架 ✅

- [x] 定义 CSS 设计令牌（色彩/字体/间距/圆角/阴影）
- [x] 实现 Layout 组件（侧边栏 220px + 内容区，动态应用名称）
- [x] 实现 Button 组件（primary/secondary/danger/sm/loading）
- [x] 实现 Table / Modal / Card / Amount（含 NetAmount）/ Badge / ProgressBar 组件
- [x] 实现路由框架（react-router-dom v7，10 个路由）

---

## 第 4 阶段：核心功能 ✅

### 4.1 仪表盘
- [x] 四大统计卡片（总资产/现金/投资/月收支）
- [x] 资产分布 ECharts 饼图（两级下钻：大类 → 明细，v1.4.0）
- [x] 资产概览面板（按类别分项，v1.4.0 增强）
- [x] 资产查询与分析 Card（筛选/搜索/排序，v1.4.0 新增）
- [x] 净资产走势图（NetWorthTrendChart）
- [x] 月度预算进度卡片（BudgetCard）

### 4.2 账户管理
- [x] 账户列表页（Accounts.tsx，树形展示 + 投资账户关联）
- [x] 添加/编辑账户表单（AddAccountForm + 银行日结单导入）
- [x] 账户详情页（AccountDetail.tsx，含存取记录）
- [x] 账户余额汇总 + 多币种余额

### 4.3 投资管理（核心）
- [x] 持仓列表页（Investments.tsx，卡片布局 + 关联银行标识）
- [x] 添加持仓表单（AddAssetForm.tsx）
- [x] 买卖交易表单（TradeForm.tsx，加权平均成本自动计算）
- [x] 盈亏计算与显示（金额 + 百分比）
- [x] 持仓详情页（HoldingsDetail.tsx，交易历史 + 编辑/删除持仓 v1.4.0）
- [x] 券商日结单导入（CSV/Excel，智能格式匹配）
- [x] 自定义日结单格式管理
- [x] 投资账户 ↔ 银行账户关联（v1.4.0）

### 4.4 记账功能
- [x] 收支记录列表（Bookkeeping.tsx）
- [x] 添加记账表单（AddLedgerForm.tsx）
- [x] 月度收支统计

### 4.5 多币种与汇率
- [x] 货币管理（Settings 页）
- [x] 汇率显示与编辑
- [x] 汇率自动更新（exchangerate-api.com）
- [x] 汇率历史

### 4.6 报表分析
- [x] 月度收支趋势图
- [x] 分类消费排行
- [x] 年度收支统计
- [x] 持仓表现排行

---

## 第 5 阶段：数据源接入 ✅

- [x] 汇率 API 接入（exchangerate-api.com）
- [x] A 股价格（新浪主 + 腾讯备）
- [x] 港股价格（新浪主 + 腾讯备）
- [x] 美股价格（Yahoo Finance 主 + 新浪备）
- [x] 黄金价格（新浪主 + Gold-API 备）
- [x] 加密货币价格（CoinGecko 主 + Binance 备）
- [x] 基金净值接入（天天基金）
- [x] 智能市场检测 `detectMarket()`（v1.4.0）
- [x] 通用 `fetchWithFallback()` failover 包装器（v1.4.0）
- [x] 定时调度器（scheduler.ts，价格/汇率/AI 日摘要）

---

## 第 6 阶段：AI 投资助手 ✅

- [x] settings-service（KV 存储 AI 配置）
- [x] portfolio-context（收集全部持仓数据格式化为 Markdown）
- [x] ai-service（构建 prompt + 调用 DeepSeek API + 流式 SSE）
- [x] AIAssistant 聊天页面（引导页 + 快捷提问 + Markdown 渲染）
- [x] AI 配置卡片（Settings 页，API Key 安全存储）
- [x] 流式响应（event.sender.send 推送 chunk）

---

## 第 7 阶段：智能功能 ✅

- [x] budgets 表 + budget-service
- [x] BudgetCard 仪表盘预算进度卡片
- [x] 预算设置（Settings 页）
- [x] alert_config 表 + alert-service
- [x] 涨跌提醒（scheduler 价格刷新后检查）
- [x] Windows 系统通知（Electron Notification API）
- [x] 提醒配置 UI（Settings 页，开关 + 阈值）

---

## 第 8 阶段：数据安全 ✅

- [x] 一键备份（16 张表 → 1 个 Excel，保存对话框）
- [x] 一键恢复（读取 Excel → 预览 → 事务导入）
- [x] 数据归档（按月生成 Excel 投资统计表 + 清理旧数据）
- [x] ArchiveCard 归档设置卡片（文件夹预设 + 保留期限）

---

## 第 9 阶段：自动更新 ✅

- [x] electron-updater 集成
- [x] update-ipc.ts（检查/下载/安装 handler）
- [x] 更新状态 UI（Settings 页，进度条 + 按钮）
- [x] GitHub Releases 发布配置

---

## 第 10 阶段：v1.1.0 — v1.3.0 ✅

- [x] v6 migration: social_obligations 表（人情债）
- [x] SocialObligations 页面 + social-obligation-service
- [x] v7 migration: parent_account_id + account_balances（账户树形 + 多币种）
- [x] v8 migration: asset_type 分类（bank/cash/insurance/investment/custom）
- [x] v9 migration: custom_bank_formats（银行日结单自定义格式）
- [x] 银行日结单导入（bank-statement-parser + bank-format-service + IPC）
- [x] 统一资产汇总 `account:allAssetsSummary`

---

## 第 11 阶段：v1.4.0 ✅

- [x] **Dashboard 饼图两级下钻**（大类 → 账户明细）
- [x] **资产概览面板增强**（基于 allAssetsSummary，支持点击联动）
- [x] **资产查询与分析模块**（搜索/筛选/排序/快速统计）
- [x] **持仓编辑/删除功能**（HoldingsDetail 操作列 + Modal）
- [x] **价格获取全面增强**（5 个市场主备双源 + failover + 智能检测 + 增强日志）
- [x] **自定义软件名称**（app_settings 存储 + 窗口/侧边栏动态更新）
- [x] **v10 migration: 投资账户 ↔ 银行账户关联**（funding_account_id）
- [x] **资产统计修正**（关联投资市值计入银行总资产）
- [x] **Investments 按钮重叠修复**（flex 布局替代绝对定位）

---

## 第 12 阶段：v1.4.1 ✅

- [x] **滚动条增强**（14px 宽 + 可见轨道 + 单箭头按钮，仿 VS Code 风格）
- [x] **自定义格式编辑**（券商/银行日结单格式支持编辑，updateCustomFormat / updateBankFormat）
- [x] **持仓全字段可编辑**（代码/类型/市场/货币均可编辑，类型/市场/货币改为下拉框）
- [x] **上海 ETF 价格修复**（5xxxxx 代码正确路由到上海交易所 API）
- [x] **CSV 文件导入支持**（券商/银行日结单导入对话框支持 .csv 格式）
- [x] **银行账户图标修复**（始终显示类型图标，不再错误显示 📁）
- [x] **强制删除账户**（forceDeleteAccount，级联删除子账户和全部关联记录）
- [x] **子账户添加**（在已有银行账户下添加子账户，无需在创建时预设）
- [x] **交易记录编辑/删除**（投资交易 + 存取记录均可修改和删除，自动回滚余额/持仓）
- [x] 构建验证：`npm run build` 零错误

---

## 第 13 阶段：v1.5.0 ✅

- [x] **v12 数据库迁移**（insurance_policies + premium_payments 表 + display_alias 字段 + JS 迁移函数支持）
- [x] **四层资产架构**（电子钱包 → 银行分组 → 子账户 → 底层资产）
- [x] **资产管理页重写**（Layer 2 卡片布局 + 统计卡片 + 银行分组可展开 + 点击跳转）
- [x] **电子钱包系统账户**（微信/支付宝/现金自动创建 + 余额管理）
- [x] **钱包流水页**（/wallet/:type，收支记录 + 账单导入 + 记账功能）
- [x] **保单独立管理**（insurance_policies 独立建表 + CRUD + 缴费半自动化）
- [x] **保单管理页**（/insurance，保单列表 + 添加/编辑/删除 + 保费缴纳）
- [x] **保费提醒定时任务**（scheduler 每日 8:57 检查到期保单 + Windows 通知）
- [x] **银行理财产品展示**（AccountDetail 页显示银行持有的股票/基金/ETF）
- [x] **SlidePanel 侧边滑出面板**（交易历史改用非模态面板）
- [x] **Dashboard 电子钱包分类支持**（饼图新增 e_wallet 颜色和图标）
- [x] 构建验证：`npm run build` 零错误

---

## 第 14 阶段：打包发布 ⏳

- [ ] 配置 electron-builder.yml
- [ ] 生成 Windows .exe 安装包（NSIS）
- [ ] 代码签名配置
- [ ] 自动更新 CI/CD（GitHub Actions）

---

## 后续迭代路线图

| 优先级 | 功能 | 工作量估计 |
|--------|------|-----------|
| 🔴 P0 | 打包发布 Windows 安装包 | 1–2 天 |
| 🔴 P0 | CSV 批量导入优化（微信/支付宝账单） | 2–3 天 |
| 🟡 P1 | 日历视图（月历 + 每日收支摘要） | 3–4 天 |
| 🟡 P1 | 信用卡管理（账单日/还款日提醒） | 2–3 天 |
| 🟡 P1 | 持仓详情 K 线图 / 成本曲线 | 3–4 天 |
| 🟡 P1 | 自动价格刷新（交易时段更高频率） | 1–2 天 |
| 🟢 P2 | AI 对话历史持久化 | 1–2 天 |
| 🟢 P2 | AI 智能记账（语音/文字 → 自动分类） | 5–7 天 |
| 🟢 P2 | 存钱计划（365 存钱法等） | 2–3 天 |
| 🟢 P2 | 多账本隔离 | 7–8 天 |
| 🟢 P2 | 仪表盘组件可定制拖拽 | 5–7 天 |
