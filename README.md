# 个人理财投资软件

一款运行在 Windows 电脑上的**个人财产投资管理软件**，以投资管理为核心，统一管理现金、银行卡、股票、基金、黄金、加密货币等全部资产，提供深度财务洞察、智能记账与 AI 投资分析。

**最新版本：v1.7.1**（2026-08-16） · [更新说明](RELEASE_NOTES.md) · [开发路线图](docs/dev-roadmap.md)

📥 下载：[GitHub Releases](https://github.com/Davidtsoi06/personal-finance-app/releases/latest)（Windows 安装包，支持自动更新）

---

## ✨ 功能概览

### 📊 资产结构（总览仪表盘）
- 五张统计卡：总资产 / 现金及存款 / 券商流动金 / 投资市值 / 本月收支
- 资产分布饼图（两级下钻：大类 → 账户明细）与可展开资产概览面板
- 资产查询与分析：搜索 / 筛选 / 排序 + 持仓市值、定存等快速统计
- 总资产走势图（最近 30 天，随汇率自动刷新）与月度预算进度卡片
- **总资产单一口径**：总览卡 = 概览行 = 资产管理页 = 净值走势，任何时刻一致

### 💳 资产管理
- 四层架构：总资产 → 大类卡片 → 银行分组（内嵌关联券商）→ 子账户
- 多币种余额自动按汇率折算 CNY；银行卡号仅存后 4 位
- 账户存取记录、定期存款、银行理财产品；安全删除 + 强制级联删除
- **定期存款询问式联动**：创建扣款自动写存取记录；编辑/删除均询问是否调整余额；到期提供「到期处理」回款（默认本金+利息，标记 ✅ 已结算）
- 银行日结单导入（CSV / Excel，支持美式 `月/日/年` 日期与千分位/括号负数金额）

### 📈 投资管理（核心）
- 资产类型：A股 / 港股 / 美股 / 基金 / ETF / 黄金 / 加密货币
- 统一持仓排序（港股 → A股 → 美股 → ETF → 基金 → 黄金 → 加密货币）+ 盈亏明细
- 买卖交易记录（加权平均成本）；编辑/删除自动重算成本盈亏与券商现金流水
- **券商流动金独立口径**：现金流派生（存入/取出/买卖/日结单导入全链路自动记账）
- 价格自动更新：主/备双数据源 + 智能市场检测 + 失败降级
- 券商日结单导入（智能关键词匹配 + 自定义格式）；未归属持仓转挂/清理

### 📱 电子钱包 · 🛡️ 保险 · 📝 记账 · 🤝 人情债
- 微信 / 支付宝 / 现金系统钱包：独立流水页 + CSV 账单批量导入（导入后余额自动同步）
- 独立保单管理 + 保费缴纳（选账户即扣款并写存取/记账记录，或仅记录）+ 到期提醒
- 收入/支出记账：两级分类、多账户、标签；月度收支按币种折算 CNY
- 人情债记录与还款状态管理

### 📉 报表分析
- 月度趋势 / 分类构成 / 资产表现图表；年度已实现盈亏（重放法）
- 每日交易报表一键导出 Excel；完整资产汇总导出（多 sheet、CNY 等值）

### 🤖 AI 投资助手
- 基于 DeepSeek API，自动读取持仓/账户/交易上下文；流式响应 + Markdown 安全渲染
- API Key 仅存本地主进程（AES-256-GCM 加密），不随备份导出；接口地址强制公网 HTTPS（防 SSRF）

### 🔒 安全
- **启动密码锁**：双击打开先验证密码（scrypt 加盐哈希）；独立锁屏小窗口 + 最小权限 preload；未解锁时全部业务通道拒绝
- 忘记密码邮箱验证码找回（6 位 / 10 分钟有效 / 60 秒限发 / 防枚举）；空闲 10 分钟自动锁定（可调 1~60）+ 手动锁定
- 登录失败 5 次锁定 30 秒；SMTP 授权码 AES-GCM 加密存储
- 数据备份/恢复（Excel 多表，敏感配置自动排除）；数据归档；迁移前自动备份数据库文件

---

## 🆕 近期更新

**v1.7.1（2026-08-16）· 全面审计修复版**：22 处数据正确性与安全修复——保费双重扣款、备份/恢复完整（含券商现金流水）、手动交易卖出金额、钱包导入余额、归档反冲、日结单金额解析、跨币种统计、清空数据二次确认、密码锁全频道门禁、恢复路径绑定、AI 端点 SSRF 防护、找回防枚举等。详见 [RELEASE_NOTES.md](RELEASE_NOTES.md)。

**v1.7.0（2026-08-16）**：启动密码锁（锁屏窗口 + 邮箱验证码找回 + 空闲自动锁）；银行日结单美式日期与 Excel 序列号支持。

**v1.6.1（2026-08-16）**：总资产口径修复（内嵌券商/净值窗口/汇率刷新同步）；资产间联动全部询问式；银行取出修复。

---

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 41（Windows 10/11） |
| 前端 | React 19 + TypeScript + Vite 8 + ECharts 6（路由级代码分割） |
| 数据 | SQLite（better-sqlite3，WAL 模式，迁移 v1~v17） |
| 校验 | zod IPC 入参校验 + 全局密码锁门禁 |
| 安全 | AES-256-GCM（敏感配置）、scrypt（启动密码）、CSP |
| 测试 | Vitest（113 项单元/集成测试）+ 端到端验证脚本 |

---

## 🚀 快速开始（开发）

```bash
npm install

# 开发模式（渲染端 HMR + 主进程自动重启）
npm run dev

# 生产构建 + 本地启动
npm run build
npm start

# 测试与检查
npm test                          # vitest + IPC 白名单一致性校验
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.json --noEmit
npm run check:ipc
```

### 演示数据验证

```bash
node scripts/seed-demo-data.js "$env:TEMP\pf-demo\finance.db"   # 灌入多币种演示数据
$env:PF_USER_DATA_DIR = "$env:TEMP\pf-demo"; npm start           # 用演示库启动（不影响真实数据）
node scripts/inspect-summary.js "$env:TEMP\pf-demo\finance.db" # 只读打印资产口径（对账用）
```

---

## 📦 打包发布

```bash
npm run release:local          # 生成 release/personal-finance-setup-<版本>.exe
node scripts/upload-release.js # 上传 GitHub Releases（exe + blockmap + latest.yml）
```

发布流程详见 [docs/release-guide.md](docs/release-guide.md)。

---

## 🧭 项目结构（简版）

```
src/
├── main/          # Electron 主进程：数据库(迁移 v1~v17 + 服务层)、IPC(160 频道 + 校验 + 门禁)、
│                  #   后台调度(价格/汇率/AI)、日结单解析、启动密码锁、自动更新
├── shared/        # 主/渲染共用：类型、IPC schema、纯函数（金额舍入/资产口径/金额解析/URL 校验）
└── renderer/      # React 渲染进程：13 个页面 + 组件库 + hooks（汇率刷新/空闲锁）
tests/             # Vitest 单元 + 集成测试（113 项）
scripts/           # 演示数据、端到端验证、只读诊断、IPC 白名单校验、发布上传
docs/              # 需求 / 技术 / 设计 / 数据模型 / 路线图 / API 参考 / 发布指南
dev-logs/          # 每次开发会话的日志
```

---

## 📚 文档索引

| 文档 | 说明 |
|------|------|
| [docs/requirements.md](docs/requirements.md) | 完整功能需求与状态 |
| [docs/tech-spec.md](docs/tech-spec.md) | 架构、服务、IPC 频道、安全设计 |
| [docs/data-model.md](docs/data-model.md) | 数据库表结构与迁移历史（v1~v17） |
| [docs/design-spec.md](docs/design-spec.md) | 设计令牌与页面布局 |
| [docs/dev-roadmap.md](docs/dev-roadmap.md) | 分阶段开发计划（含 v1.8.0 前端交互升级规划） |
| [docs/api-reference.md](docs/api-reference.md) | 外部数据源 API 与降级策略 |
| [docs/frontend-interaction.md](docs/frontend-interaction.md) | 前端交互逻辑（页面/流程/联动/机制） |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | 最新版本更新说明 |
| [CLAUDE.md](CLAUDE.md) | 项目工作规则（代码风格/安全要求/文档同步） |

---

## 📜 版本历史

| 版本 | 日期 | 重点 |
|------|------|------|
| v1.7.1 | 2026-08-16 | 审计修复：数据正确性 14 项 + 安全加固 7 项 |
| v1.7.0 | 2026-08-16 | 启动密码锁 + 银行日结单日期格式 |
| v1.6.1 | 2026-08-16 | 总资产口径修复 + 联动询问式 + 汇率刷新同步 |
| v1.6.0 | 2026-08-15 | 投资市值口径完善 + 定存询问式 |
| v1.5.x | 2026-08-15 | 券商流动金、跨币种换算、钱包/保险/报表完善 |
| v1.0 ~ v1.4 | 2026-07 ~ 08 | 核心功能：四层资产架构、投资管理、记账、AI 助手 |

完整历史见 [docs/dev-roadmap.md](docs/dev-roadmap.md)。