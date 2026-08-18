# 版本更新发布完整流程指南

## 目录
1. [前置准备：安装 Git](#1-前置准备安装-git)
2. [创建 GitHub 账号和仓库](#2-创建-github-账号和仓库)
3. [配置 electron-builder.yml](#3-配置-electron-builder.yml)
4. [生成 GitHub Token](#4-生成-github-token)
5. [创建应用图标（可选）](#5-创建应用图标可选)
6. [首次发布](#6-首次发布)
7. [后续每次发新版本](#7-后续每次发新版本)
8. [故障排查](#8-故障排查)

---

## 1. 前置准备：安装 Git

### 1.1 下载安装
打开浏览器，访问：https://git-scm.com/download/win

下载后双击安装，**所有选项保持默认，一路点 Next 即可**。

### 1.2 配置用户名和邮箱
安装完成后，按 `Win + R`，输入 `cmd`，回车，打开命令提示符。

依次输入以下两行（替换成你的名字和邮箱）：
```
git config --global user.name "你的名字"
git config --global user.email "你的邮箱@example.com"
```

> ⚠️ 这个邮箱建议和下一步注册 GitHub 用的邮箱一致。

---

## 2. 创建 GitHub 账号和仓库

### 2.1 注册 GitHub 账号
1. 打开 https://github.com
2. 点击右上角 **Sign up**
3. 输入邮箱、密码、用户名，按提示完成注册
4. 去邮箱点击验证链接

### 2.2 创建仓库
1. 登录后，点击右上角 **+** → **New repository**
2. 填写：
   - **Repository name**：`personal-finance-app`（或你喜欢的名字）
   - **Description**：`个人理财投资软件`
   - **选 Private**（私有不公开，推荐）或 Public
   - ⚠️ **不要勾选** "Add a README file"、"Add .gitignore"、"Choose a license"
   - 其他保持默认
3. 点击绿色 **Create repository** 按钮

### 2.3 记下你的仓库信息
创建完成后，页面会显示类似这样的地址：
```
https://github.com/你的用户名/personal-finance-app
```

记下来：
- **你的用户名**：____________
- **仓库名**：____________

---

## 3. 配置 electron-builder.yml

用记事本打开你项目文件夹中的 `electron-builder.yml`。

找到文件末尾这两行：
```yaml
owner: YOUR_GITHUB_USERNAME
repo: YOUR_REPO_NAME
```

改成你实际的用户名和仓库名，例如：
```yaml
owner: zhangsan
repo: personal-finance-app
```

保存文件。

---

## 4. 生成 GitHub Token

Token 是一个密码，让打包工具能上传文件到你的 GitHub 仓库。

### 4.1 创建 Token
1. 登录 GitHub
2. 点击右上角头像 → **Settings**
3. 左侧菜单拉到最下面 → **Developer settings**
4. 左侧 **Personal access tokens** → **Tokens (classic)**
5. 点击 **Generate new token** → **Generate new token (classic)**
6. 填写：
   - **Note**：写 `electron-builder release`（随便写，标识这个 token 用途）
   - **Expiration**：选 `No expiration`
   - **勾选权限**：只勾选 **repo** 这一整个分组（包含 repo:status, repo_deployment, public_repo 等）
7. 拉到最下面，点击绿色 **Generate token** 按钮
8. ⚠️ **立刻复制**！页面上会出现一长串字符（以 `ghp_` 开头），马上复制下来。
   - 这个 token **只显示一次**，关闭页面后就看不到了
   - 如果丢了，只能删掉重新生成

### 4.2 设置环境变量

在 Windows 上设置：

1. 按 `Win` 键，输入 `环境变量`，点击「编辑系统环境变量」
2. 点击右下角「环境变量(N)...」按钮
3. 在「用户变量」区域，点击「新建(N)...」
4. 填写：
   - **变量名**：`GH_TOKEN`
   - **变量值**：粘贴你刚才复制的 token（ghp_...）
5. 确定 → 确定 → 确定

> ⚠️ 设置完后，需要**关闭所有命令行窗口并重新打开**才能生效。

---

## 5. 创建应用图标（可选）

如果你想让打包出来的 .exe 有一个自定义图标：

1. 准备一张 256×256 像素的 PNG 图片
2. 访问 https://convertio.co/png-ico/ 将它转成 .ico 文件
3. 把 `icon.ico` 放到项目的 `build/` 文件夹中

> 如果暂时不想做图标，可以从 `electron-builder.yml` 中删除 `icon: build/icon.ico` 这一行，打包时用默认图标。

---

## 6. 首次发布

### 6.1 初始化 Git 仓库

打开命令提示符（Win + R → 输入 `cmd` → 回车）。

逐条执行以下命令：

```cmd
cd /d "d:\家\home\个人理财投资软件"
```

```cmd
git init
```

```cmd
git add .
```

```cmd
git commit -m "首次提交"
```

### 6.2 关联 GitHub 仓库

```cmd
git remote add origin https://github.com/你的用户名/personal-finance-app.git
```

> 把「你的用户名」和「personal-finance-app」换成你实际的。

### 6.3 推送到 GitHub

```cmd
git push -u origin main
```

> 如果提示 "master" 而不是 "main"，改用：`git push -u origin master`

会弹出一个 GitHub 登录窗口，点击授权即可。

### 6.4 打包并发布

```cmd
npm run release
```

这个命令会：
1. 编译代码
2. 打包成 Windows .exe 安装包
3. 上传到 GitHub Releases

完成后在 GitHub 仓库页面右侧可以看到 **Releases** 区域，点进去就能看到 `v1.0.0`。

---

## 7. 后续每次发新版本

以后你改了代码，要发新版本时：

### 7.0 更新文档（每次发布必做，README 最容易忘）

打包发布前，先同步两份文档，版本号与功能描述要和实际一致：

1. **`README.md`**（项目首页）：
   - 「最新版本」行改成新版本号与日期
   - 「🆕 近期更新」最上面加一条新版本摘要（保留最近 3 条即可）
   - 「技术栈」表格里的数据同步（测试数量、迁移版本号、IPC 频道数）
   - 「版本历史」表格加一行新版本
2. **`RELEASE_NOTES.md`**：写新版本的更新说明（新功能/修复 + 版本信息表）
3. 可选：`docs/dev-roadmap.md` 阶段状态、`dev-logs/YYYY-MM-DD.md` 发布记录

> ⚠️ 历次发布最容易漏掉的就是 README——先更新文档，再改版本号打包。

### 7.1 修改版本号
打开 `package.json`，把 `"version": "1.0.0"` 改成新版本号，比如 `"1.0.1"` 或 `"1.1.0"`。

### 7.2 提交代码

```cmd
cd /d "d:\家\home\个人理财投资软件"
git add .
git commit -m "更新到 v1.0.1"
git push
```

### 7.3 发布

```cmd
npm run release
```

完成后，所有安装了你的软件的用户，打开设置页面点击「检查更新」就能看到新版本，一键更新。

---

## 8. 故障排查

### Q: `git push` 报错 "failed to push"
可能是网络问题。试试关掉代理/VPN，或者多试几次。

### Q: `npm run release` 报错 "GH_TOKEN is not set"
说明环境变量没生效。关掉所有命令行窗口，重新打开一个，再试。
确认：在 cmd 中输入 `echo %GH_TOKEN%`，看是否输出你的 token。

### Q: 用户端检查不到更新
确认：
1. 新版本号比旧版本号大
2. GitHub Releases 页面确实有新的安装包
3. `electron-builder.yml` 中的 owner 和 repo 正确

### Q: 打包出来的 .exe 在哪里？
在项目文件夹的 `release/` 文件夹中。

### Q: 忘记 GitHub token 了怎么办？
去 GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)，删掉旧的，重新生成一个。

---

## 快速参考卡片

| 要做的事 | 命令/操作 |
|---------|----------|
| 第一次发布 | `git init` → `git add .` → `git commit` → `git remote add` → `git push` → `npm run release` |
| 之后发新版 | 更新 README + RELEASE_NOTES → 改版本号 → `git add .` → `git commit` → `git push` → `npm run release` |
| 只打包不发布 | `npm run release:local` |
| 运行测试 | `npm run start` |
