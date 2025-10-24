# 使用一个 slim 镜像
FROM node:20-bullseye-slim

WORKDIR /app

# 只复制 package 文件并安装生产依赖
# 我们不再需要运行 playwright install
COPY package*.json ./
RUN npm ci --omit=dev

# 复制源代码
COPY . .

# 暴露端口
EXPOSE 3000

# 运行应用
# 注意：这里的入口点是 app.js，它启动了 Express 服务器
CMD ["node", "src/app.js"]
