# CLAUDE.md — 个人理财投资软件

## 项目定位

这是一款运行在 Windows 电脑上的**个人财产投资管理软件**，以投资管理为核心，帮助用户统一管理现金、银行卡、股票、基金、黄金、加密货币等全部资产，提供深度财务洞察和智能记账。

- **目标用户**：个人使用
- **平台**：Windows 桌面应用
- **技术栈**：Electron + React + TypeScript + SQLite + ECharts
- **主色调**：淡蓝色（`#5B9BD5` / `#4A90D9`）
- **设计风格**：简洁、直观

---

## 标准文件索引

所有项目规范文档位于 `docs/` 文件夹下：

| 文件 | 路径 | 说明 |
|------|------|------|
| 需求文档 | [docs/requirements.md](docs/requirements.md) | 完整的功能需求和用户故事 |
| 技术规范 | [docs/tech-spec.md](docs/tech-spec.md) | 技术栈、架构设计、数据库选型 |
| 设计规范 | [docs/design-spec.md](docs/design-spec.md) | 色彩、字体、间距、组件设计标准 |
| 数据模型 | [docs/data-model.md](docs/data-model.md) | 数据库表结构定义 |
| 开发路线图 | [docs/dev-roadmap.md](docs/dev-roadmap.md) | 分阶段开发计划和步骤 |
| API 参考 | [docs/api-reference.md](docs/api-reference.md) | 数据源 API 使用说明 |

---

## 开发日志

`dev-logs/` 文件夹记录每次开发的完成事项和待办事项：
- 文件名格式：`YYYY-MM-DD.md`
- 每次开发会话结束时更新
- 记录完成事项、待办、问题和下一步计划

---

## 工作规则

### 代码风格
- 使用 TypeScript 严格模式
- 组件命名采用 PascalCase
- 函数和变量采用 camelCase
- 文件名：组件用 PascalCase，工具函数用 camelCase
- 每个文件不超过 300 行

### 开发流程
1. 每次只做一个模块，完成并验证后再进入下一个
2. 所有修改前先阅读相关标准文档
3. 所有组件使用设计令牌中的颜色/间距/字体变量，禁止硬编码
4. 修改涉及金额计算/数据转换/解析逻辑时，必须在 `tests/` 下补充或更新测试；提交前运行 `npm test` 与 `npx tsc -p tsconfig.main.json --noEmit`、`npx tsc -p tsconfig.json --noEmit`（vite 构建不做类型检查）
5. 新增可变操作（写库）IPC 频道时，必须在 `src/shared/ipc-validation.ts` 定义 zod schema 并用 `handleValidated` 注册（`npm run check:ipc` 会检查未接入的 schema）

### ⚠️ 文档同步更新（必须执行）

**每次代码修改完成后，必须检查并同步更新以下所有文档**，确保文档与代码现状一致。这不是可选项——就像写代码要编译通过一样，改代码就要更新文档。

| 文档 | 何时需要更新 |
|------|-------------|
| [docs/requirements.md](docs/requirements.md) | 新增/修改功能需求、功能状态变更（✅/⏳/🔵） |
| [docs/tech-spec.md](docs/tech-spec.md) | 技术栈版本变更、服务/页面/组件数量增减、IPC 频道增删、数据源变更、架构调整 |
| [docs/data-model.md](docs/data-model.md) | 数据库表增删、字段增删改、迁移版本递增、ER 关系变化、app_settings 键变更 |
| [docs/design-spec.md](docs/design-spec.md) | 新增/修改 UI 组件、页面布局调整、设计令牌变更、新增页面 |
| [docs/dev-roadmap.md](docs/dev-roadmap.md) | 完成新阶段/功能、版本号更新、后续迭代优先级调整 |
| [docs/api-reference.md](docs/api-reference.md) | 新增/修改外部数据源 API、备用源变更、定时策略调整、降级策略变更 |
| [CLAUDE.md](CLAUDE.md) | 项目定位变化、工作规则调整、新增标准文档 |

**检查清单**（每次开发会话结束前逐项确认）：

- [ ] 数据库 schema 变更？→ 更新 `data-model.md`（表、字段、迁移版本、ER 图）
- [ ] IPC 频道增删？→ 更新 `tech-spec.md` 频道表
- [ ] 新增/删除 service？→ 更新 `tech-spec.md` 服务列表和数量
- [ ] 新增/删除页面或组件？→ 更新 `tech-spec.md` 和 `design-spec.md`
- [ ] 功能完成或状态改变？→ 更新 `requirements.md` 状态标记
- [ ] 新增功能需求？→ 更新 `requirements.md` 功能列表
- [ ] 版本号更新？→ 更新 `dev-roadmap.md` 阶段状态
- [ ] 外部 API 或数据源变更？→ 更新 `api-reference.md`
- [ ] 设计令牌或组件样式变更？→ 更新 `design-spec.md`
- [ ] 开发会话结束？→ 更新 `dev-logs/YYYY-MM-DD.md`

### 安全要求
- 敏感字段加密存储：AI API Key 使用 AES-256-GCM 加密（密钥与数据库分离）；银行卡号仅存后 4 位，完整卡号不落库
- 整库加密（SQLCipher）列入后续迭代计划
- 敏感配置（如引入第三方数据源密钥）通过环境变量注入
- 导出数据时不包含完整密码/密钥（备份导出排除 AI Key）
- preload 仅放行白名单内的 IPC 频道；新增频道必须同步 `src/main/preload.ts` 白名单与 `src/shared/types/ipc.ts` 类型联合（运行 `npm run check:ipc` 校验三处一致）
- AI/外部内容渲染前必须先 HTML 转义

### 兼容性
- 目标系统：Windows 10/11
- 分辨率支持：1280x720 及以上
- 语言：简体中文
