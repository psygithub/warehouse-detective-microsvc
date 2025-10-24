# 使用 Docker 运行 Warehouse Detective (微服务版)

本项目已重构为微服务架构，包含三个核心部分：
1.  **主应用 (warehouse-detective)**: 负责处理业务逻辑和 API。
2.  **Playwright 服务 (playwright-service)**: 封装了所有浏览器自动化操作。
3.  **浏览器服务 (browserless/chrome)**: 提供一个可远程连接的 Chrome 浏览器环境。

请按照以下步骤使用原始 Docker 命令来构建和运行整个应用。

---

## 步骤 1: 创建 Docker 网络

为了让容器之间能够通过服务名相互通信，我们需要创建一个自定义的 Docker 网络。

```bash
docker network create waredetective-net
```

---

## 步骤 2: 构建镜像

我们需要为每个自定义服务构建 Docker 镜像。

### 构建主应用镜像

在项目根目录下运行：

```bash
docker build -t warehouse-detective:latest -f main-app/Dockerfile ./main-app
```

### 构建 Playwright 服务镜像

在项目根目录下运行：

```bash
docker build -t playwright-service:latest -f playwright-service/Dockerfile ./playwright-service
```

---

## 步骤 3: 启动容器

请务必按照以下顺序启动容器，以确保依赖关系正确。

### 1. 启动浏览器服务

我们首先启动 `browserless/chrome` 容器，它为 Playwright 服务提供浏览器环境。

```bash
docker run -d --name browser-service --network waredetective-net --restart always browserless/chrome:latest
```

### 2. 启动 Playwright 服务

接下来启动我们自己的 Playwright 服务。它会连接到上面的 `browser-service`。

**重要**: 请确保将 `/path/to/your/config` 替换为您本地 `config` 目录的**绝对路径**。

```bash
docker run -d --name playwright-service --network waredetective-net -p 3001:3001 --restart always -v /path/to/your/config:/app/config -e "BROWSER_SERVICE_URL=ws://browser-service:3000" playwright-service:latest
```

### 3. 启动主应用

最后，启动主应用。它会连接到 `playwright-service`。

**重要**: 请确保将 `/path/to/your/data`, `/path/to/your/output`, `/path/to/your/config` 替换为您本地相应目录的**绝对路径**。

```bash
docker run -d --name warehouse-detective-app --network waredetective-net -p 3000:3000 --restart always -v /path/to/your/data:/app/data -v /path/to/your/output:/app/output -v /path/to/your/config:/app/config -e "PLAYWRIGHT_SERVICE_URL=http://playwright-service:3001" warehouse-detective:latest
```

---

## 如何停止和清理

```bash
# 停止所有容器
docker stop warehouse-detective-app playwright-service browser-service

# 删除所有容器
docker rm warehouse-detective-app playwright-service browser-service

# 删除网络
docker network rm waredetective-net
