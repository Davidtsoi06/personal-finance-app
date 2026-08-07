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
3. 数据层变更需同步更新 `docs/data-model.md`
4. UI 变更需遵循 `docs/design-spec.md` 的设计令牌
5. 所有组件使用设计令牌中的颜色/间距/字体变量，禁止硬编码

### 安全要求
- 数据库文件必须加密存储
- 敏感配置通过环境变量注入
- 导出数据时不包含完整密码/密钥

### 兼容性
- 目标系统：Windows 10/11
- 分辨率支持：1280x720 及以上
- 语言：简体中文
