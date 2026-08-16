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
| 15 | 打包发布 | Windows .exe 安装包（v1.5.0/1.5.1 已发布） | ✅ 完成 |
| 16 | v1.5.1 | 基金价格 API 修复（天天基金+东方财富防盗链升级）+ 券商现金余额显示修复 | ✅ 完成 |
| 17 | v1.5.2 | 报表功能增强：每日交易报表 + 完整资产汇总导出 + 统一持仓排序 | ✅ 完成 |
| 18 | v1.5.3 | 手动修改现价：持仓表 ✏️ + 交易记录弹窗「✏️ 改价」 | ✅ 完成 |

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

## 第 16 阶段：v1.5.1 ✅

- [x] **基金价格 API 修复**：天天基金/东方财富 fundgz 防盗链升级全部失效 → 切换主源为东方财富历史净值 API + 新浪财经备用源
- [x] **券商现金余额显示修复**：投资账户卡片金额计入现金余额（`totalValue` = 持仓市值 + 现金）+ 存入/取出快捷操作
- [x] 构建验证：`npm run build` 零错误

---

## 第 17 阶段：v1.5.2 ✅

- [x] **每日交易报表**（`report:dailyTrades`）：任选日期查看当日交易，买入/卖出笔数与金额、已实现盈亏统计
- [x] **每日交易 Excel 导出**（`export:dailyTrades`）：汇总 + 交易明细双 sheet
- [x] **收盘交易通知**：scheduler 每日 16:35 检查当日交易，有交易时推送 Windows 通知
- [x] **完整资产汇总导出**：`export:toExcel` assets 类型升级为 7 sheet 快照（总览/银行/钱包/券商/持仓/定存/保险，全部 CNY 换算），不再受时间筛选影响
- [x] **统一持仓排序**：共享 `ASSET_SORT_SQL`（港股→A股→美股→ETF→基金→黄金→加密货币，组内按代码），应用于持仓列表/账户持仓/收益明细/持仓导出
- [x] **Reports 页**：每日交易报表卡片 + 资产汇总导出隐藏时间选择器
- [x] 新增 `report-export-service.ts` 报表数据服务 + `DailyTradesReport.tsx` 组件
- [x] 构建验证：`npm run build` 零错误

---

## 第 18 阶段：v1.5.3 ✅

- [x] **手动修改现价**：现价自动获取失败时，持仓列表「最新价」列 ✏️ 按钮 + 交易记录弹窗头部「✏️ 改价」均可手动输入现价
- [x] 保存调用既有 IPC `asset:updatePrice`（`updateCurrentPrice` 重算市值/盈亏 + 记录 `asset_prices` 历史），成功后自动刷新页面
- [x] 修改 `HoldingsDetail.tsx`（新增改价弹窗 + 两处入口按钮），无数据库/主进程变更
- [x] 构建验证：`npm run build` 零错误

---

## 第 19 阶段：v1.5.4 ✅ 数据完整性与安全加固

- [x] **备份/恢复补全**：`data:exportAll`/`data:confirmImport` 覆盖全部 21 张业务表（补多币种余额/定期存款/银行自定义格式/保单/保费/应用设置；AI Key 不随备份导出）
- [x] **导入安全**：仅接受数据库真实列名（防 SQL 注入），跳过行数计入结果返回并在 UI 提示
- [x] **一键清空修复**：`data:clearAll` 表清单补全并按外键依赖排序（此前有定存/保单时清空会因外键约束失败）
- [x] **卡号保护**：服务层 `normalizeCardNumber` 仅存后 4 位 + 迁移 v13 清洗存量数据，完整卡号不落库
- [x] **AI Key 加密**：新增 `crypto-util.ts`（AES-256-GCM，密钥存 `userData/secret.key`），`app_settings['ai.apiKey']` 密文存储
- [x] **IPC 白名单**：preload 仅放行已注册的 138 个频道；注册缺失的 `app:ping` handler
- [x] **AI 渲染安全**：`renderMarkdown` 先整体 HTML 转义再转换，杜绝模型输出 HTML 注入
- [x] **依赖安全**：electron 40→41.10.3（修复 sandbox iframe 漏洞）、xlsx 0.18.5→0.20.3（SheetJS 官方源，修复原型污染/ReDoS）
- [x] **dev 真 HMR**：`ELECTRON_DEV=1` 时窗口加载 Vite dev server（此前 dev 模式实际加载的是构建产物）；`npm start` 不再隐式构建
- [x] 构建验证：`npm run build`（vite + tsc）零错误；better-sqlite3 已按 Electron 41 ABI 重新编译

---

## 第 20 阶段：v1.5.5 ✅ 工程化与可靠性基础

- [x] **测试体系**：Vitest 单元 + 集成测试 38 个用例全绿（金额舍入/加权平均成本/市场检测/卡号/Markdown 防 XSS/AES-GCM/迁移 v1~v13 内存库验证）；Playwright + Electron E2E 冒烟 spec（`tests/e2e/app.spec.ts`，PF_USER_DATA_DIR 独立数据目录）
- [x] **共享纯函数层**：`src/shared/utils/`（money/investment/market/card/markdown）+ `src/main/services/crypto-core.ts`，asset-service / transaction-service / price-fetcher / account-service / AIAssistant / currency-service 全部改用
- [x] **金额统一舍入**：金额出口四舍五入到分，均价保留全精度（修复买卖冲销漂移，测试锁定行为）
- [x] **单实例锁**：双开自动聚焦已有窗口
- [x] **迁移前自动备份 + 启动完整性检查**：`userData/backups/` 保留最近 5 份；`PRAGMA integrity_check` 失败中止启动
- [x] **市场检测增强**：支持 .SH/.SZ/.HK/.US 后缀
- [x] **类型检查纳入验证**：渲染进程 6 处存量类型错误修复（Badge primary、WalletFlow amount 等）
- [x] **设计令牌合规**：Badge 全部改用令牌（新增 5 个状态徽章令牌）；侧边栏版本号修正 v1.5.4
- [x] **CI**：`.github/workflows/ci.yml`（windows-latest：构建 + npm test）
- [ ] 本机执行 `npm run test:e2e` 与打包发布验证（沙箱环境无法启动 GUI）

---

## 第 21 阶段：v1.5.5 维护性改造 🔄（进行中）

- [x] **IPC 频道类型安全**：`src/shared/types/ipc.ts` 提供 `IpcChannel` 联合类型，渲染进程全部 `invoke()` 调用点编译期校验（vite-env.d.ts 改 `declare global` 保持全局声明）；删除死代码 `useData.ts`
- [x] **白名单自动校验**：`scripts/check-ipc-whitelist.js` 校验主进程注册 ↔ preload 白名单 ↔ 类型联合三处一致，挂入 `npm test`（新增 `check:ipc` 脚本）
- [x] **密钥文件 ACL 收紧**：`secret.key` 经 icacls 限制为仅当前用户可读写（crypto-util，非致命失败）
- [x] 拆分超长文件（三批全部完成）：Settings 947→284、AccountDetail 895→211、HoldingsDetail 878→112，共抽出 13 个区块组件（cards×4 / account×4 / holdings×5）
- [x] IPC 入参运行时校验（zod）：54 个可变频道接入 handleValidated + 10 个单元测试 + 校验脚本升级为四处一致检查

---

## 第 22 阶段：v1.5.5 安全收尾 🔄（进行中）

- [x] **AI 隐私开关**：设置页可关闭「组合数据共享」；关闭后组合上下文与 AI 日摘要仅返回隐私提示，不发送持仓/账户/交易数据（`ai.includePortfolio`，默认开启）
- [x] **修复掩码 Key 覆盖 bug**：保存配置时未修改的掩码 Key 不再覆盖已存 Key（saveAiConfig 空值保持语义 + 前端传空串）
- [ ] 整库 SQLCipher 加密（远期，需要密码交互与原生模块替换，单独评估）

---

## 第 23 阶段：v1.5.5 性能与报表 🔄（进行中）

- [x] **路由级代码分割**：12 个页面 React.lazy 分包，首屏只加载当前路由（修复 1.5MB 单包告警）
- [x] **年度已实现盈亏报表**：`report:realizedPnl`（重放法纯函数 `computeRealizedPnl` + 5 个单元测试）+ `RealizedPnlCard`（年份选择/汇总/明细表）
- [x] 启动流程优化（第一批）：窗口优先显示（余额重算/净资产记录移入后台 setTimeout 0）+ `PRAGMA quick_check` 快速完整性检查（失败才跑完整检查）；主进程打印「窗口可见」与「启动完成」两个耗时节点
- [ ] 本机实测启动耗时并记录基线（`[Main] ✓ 启动完成（窗口可见），总耗时 XXms`）

---

## 第 28 阶段：v1.6.0 投资市值口径完善 🔄（代码完成，待本机验证后发布）

- [x] 银行理财独立为投资类（bank_wealth 顶级类别计入投资市值；银行子项=余额+定存CNY；定存跨币种换算修正）
- [x] 删除券商级联删除持仓/交易/价格/现金流（防孤儿）
- [x] 迁移 v15 孤儿检测 + 投资页「未归属持仓」卡片（转挂/删除）+ asset:listOrphaned/reassignOrphaned（145 频道）
- [x] 净资产记录统一概览口径（净值历史与总资产一致）
- [x] 资产查询面板统计：CNY 换算 + 定存分离
- [x] 测试 60/60（新增 v15 孤儿检测用例）
- [x] 添加银行卡分组内预填银行名 + 滚动条改 Windows 原生
- [x] 定期存款资金询问式（迁移 v16：deduct_mode/deduct_account_id；创建弹窗扣款/纯记录选择；标记与删除文案）
- [x] 打包发布 v1.6.0

## 第 29 阶段：v1.6.1 总资产口径修复 ✅（已发布 2026-08-16）

- [x] 概览「总资产」行补齐券商流动金（netWorth 与 totalAssets 同口径）
- [x] 保险现金价值按保单币种换算 CNY
- [x] 修复银行组内嵌券商漏计：投资市值/总资产卡/净资产快照三处少 ¥225,400（演示数据实测 487,950 → 713,350）
- [x] 净值历史窗口修复：取最近 N 天（原为升序取最早 N 天，真实库 >30 天时走势图窗口错误）
- [x] 单一口径纯函数 `src/shared/utils/asset-totals.ts`（Dashboard 与净资产记录共用）+ `net-worth-core.ts` 纯 DB 层
- [x] 测试：`tests/unit/asset-totals.test.ts` + `tests/integration/net-worth-core.test.ts`（71/71 通过，IPC 145 频道一致）
- [x] 端到端验证脚本 `scripts/verify-demo-totals.js`：演示数据全项通过（总资产 ¥713,350）
- [x] 汇率更新广播（v1.6.1）：`fetchExchangeRates` 更新后向所有窗口发 `currency:updated`，`useCurrencyRefresh` 让总览/资产管理/投资管理自动重载——修复启动时汇率刷新导致的页面数据分叉（实测：总览 713,350 vs 资产管理 676,570.38 系旧/新汇率差异，资产管理页与库内数据完全一致）
- [x] 只读诊断脚本 `scripts/inspect-summary.js`：打印任意库的资产总览口径（验证改为一致性核对，种子汇率会被实时汇率覆盖）
- [x] 修复银行账户取出报错（v1.6.1）：「转入投资账户」默认空串被 coerce 为 0 触发 positive 校验失败；渲染端归一化 + schema 空串/0/null 统一转 null + 单元测试（72/72 通过）
- [x] 资产间联动全部询问式（v1.6.1）：定存创建扣款写记录、编辑差额询问（sync/record_only）、删除询问退回、新增到期回款（`fixedDeposit:settle` + v17 status 字段）；存取记录编辑券商现金同步询问 + 删除明示联动；保费缴纳仅记录语义明确；`fixed-deposit-core` 纯 DB 层 + 7 个集成测试（79/79 通过，IPC 146 频道一致）
- [x] 用户验证通过并打包发布 v1.6.1（含资产联动询问式与到期回款，79/79 测试通过）

## 第 27 阶段：v1.5.9 券商流动金 + 银行卡创建修复 ✅

- [x] 券商流动金独立口径（第 5 张统计卡/概览可展开/资产与投资管理页同步）
- [x] 修复创建银行卡失败（name 兜底 + 弹窗错误提示）
- [x] 打包发布 v1.5.9

## 第 26 阶段：v1.5.8 券商流动金独立口径 ✅

- [x] **券商流动金**：投资市值仅持仓 + broker_cash 独立类别（概览/统计卡/管理页/投资页四处呈现，可展开明细）
- [x] 总盈亏 CNY 口径修正；两边总资产一致（对账公式：总资产 = 现金及存款 + 券商流动金 + 投资市值）
- [x] 打包发布 v1.5.8

## 第 25 阶段：v1.5.7 账户删除恢复 + 跨币种金额统一 ✅

- [x] **账户删除入口恢复**：AccountEditModal（编辑 + 安全删除提示 + 强制删除二级确认）；forceDeleteAccount 级联补全 + account:deleteImpact 影响查询
- [x] **跨币种金额统一**：asset-cny-core 按持仓币种换算 CNY，修正 7 处汇总口径 + 2 个混币集成测试（59/59 通过）
- [x] 打包发布 v1.5.7

## 第 24 阶段：v1.5.6 现金流水与资产概览 ✅

- [x] **资产查询纳入定期存款**：新增 `asset:listAll`（assets + fixed_deposits 虚拟行），Dashboard 查询面板覆盖定存搜索/筛选/排序
- [x] **券商现金流水数据层**：迁移 v14 `investment_cash_flows` + 期初快照；cash_balance 改为流水派生；trade:record / 日结单导入（含整体事务化）/ 交易创建·编辑·删除 / 存入·取出 全链路记账；`investmentAccount:cashFlows` + `investmentAccount:adjustCash` 频道；4 个集成测试（快照/派生/同步冲销/无关联持仓）
- [x] **现金流水 UI**：持仓详情页 `CashFlowCard`（余额显示[负数红色+警示徽章] + 流水表[类型/关联股票/带符号金额/变动后余额] + 余额校正弹窗）
- [x] **资产概览重构**：`getAllAssetsSummary` 银行组内嵌关联券商子项（funding_account_id 关联），未关联券商保留独立顶级项；概览面板银行分组可展开（子账户 + 关联券商行：现金/持仓数）；四大统计卡递归汇总防重复计算

---

## 后续迭代路线图

| 优先级 | 功能 | 工作量估计 |
|--------|------|-----------|
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
