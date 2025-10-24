# 仓库库存检测系统 (微服务版)

一个基于 Node.js 的智能仓库库存检测系统。本项目采用微服务架构，将浏览器自动化任务与主应用分离，以实现更高的性能、可伸缩性和可维护性。

## 功能特性

### 🔍 库存检测
- 自动化库存检测，支持多个 SKU 和地区
- 基于 Playwright 的网页自动化
- 实时结果展示和历史记录

### 👥 用户管理
- 用户注册和登录系统
- 基于角色的权限控制（普通用户、管理员）
- JWT 令牌认证

### ⚙️ 配置管理
- 灵活的 SKU 和地区配置
- 可重用的检测配置
- 配置的增删改查

### ⏰ 定时任务
- 基于 Cron 表达式的定时任务
- 自动执行库存检测
- 任务状态监控

### 📊 管理后台
- 直观的 Web 管理界面
- 实时数据统计
- 结果查看和分析

### 🐳 容器化部署
- 优化的 Dockerfile，实现镜像最小化
- 分离的服务，支持独立部署和扩展

## 架构概览

系统采用三层微服务架构：

1.  **主应用 (warehouse-detective)**
    -   **职责**: 提供 Web 界面和核心业务 API（用户管理、配置、任务调度等）。
    -   **技术**: Node.js, Express, SQLite。
    -   **特点**: 轻量级，不包含任何浏览器或 Playwright 依赖。

2.  **Playwright 服务 (playwright-service)**
    -   **职责**: 接收来自主应用的指令，执行所有与浏览器自动化相关的任务（如登录网站、搜索 SKU）。
    -   **技术**: Node.js, Express, Playwright。
    -   **特点**: 封装了所有繁重的浏览器操作，作为一个独立的 API 服务运行。

3.  **浏览器服务 (browser-service)**
    -   **职责**: 提供一个稳定、可远程连接的 Chrome 浏览器环境。
    -   **技术**: `browserless/chrome` Docker 镜像。
    -   **特点**: 即开即用，无需我们自己维护浏览器安装和配置。

**调用流程**: `用户 -> 主应用 -> Playwright 服务 -> 浏览器服务`

## 部署指南 (Docker)

本项目推荐使用 Docker 进行部署。我们不使用 Docker Compose，而是通过标准的 Docker 命令进行管理。

详细的构建和运行步骤已记录在 `run-docker.md` 文件中。请参考该文件来启动整个应用。

**[>> 点击查看详细部署步骤 (run-docker.md)](run-docker.md)**

## 本地开发

1.  **克隆项目**
    ```bash
    git clone https://github.com/psygithub/waredetective.git
    cd waredetective
    ```

2.  **启动依赖服务**
    在开发主应用或 Playwright 服务之前，您需要一个正在运行的浏览器服务。
    ```bash
    docker run -d -p 3000:3000 --rm --name browser-service browserless/chrome:latest
    ```
    *注意：这里我们将浏览器服务的 3000 端口映射到了宿主机的 3000 端口。*

3.  **开发 `playwright-service`**
    ```bash
    cd playwright-service
    npm install
    # 设置环境变量以连接到本地运行的浏览器服务
    export BROWSER_SERVICE_URL=ws://localhost:3000
    npm start
    ```
    服务将运行在 `http://localhost:3001`。

4.  **开发主应用**
    在另一个终端中：
    ```bash
    cd main-app
    npm install
    # 设置环境变量以连接到本地运行的 playwright-service
    export PLAYWRIGHT_SERVICE_URL=http://localhost:3001
    npm start
    ```
    主应用将运行在 `http://localhost:3000`（或其他配置的端口）。

## 项目结构

```
waredetective/
├── main-app/               # 主应用服务
│   ├── src/                # 主应用源代码
│   ├── public/             # 前端静态文件
│   ├── Dockerfile          # 主应用的 Docker 配置
│   └── package.json
├── playwright-service/     # Playwright 微服务
│   ├── src/
│   │   ├── main.js        # 浏览器自动化核心逻辑
│   │   └── server.js      # Playwright 服务的 Express 入口
│   ├── Dockerfile         # Playwright 服务的 Docker 配置
│   └── package.json
├── config/                 # 共享配置文件
├── data/                   # 数据库文件 (持久化)
├── scripts/                # 部署和备份脚本
├── run-docker.md           # Docker 部署指南
└── README.md               # 项目说明文档
```

## 默认账户

-   **用户名**: admin
-   **密码**: admin123

## API 接口

(API 接口部分与旧版一致，此处省略以保持简洁，实际文件中会保留)

## 可用脚本 (主应用)

-   `npm start`: 启动主应用的 Web 服务器。
-   `npm run dev`: 在开发模式下启动服务器。
-   `npm test`: 运行基础测试。
