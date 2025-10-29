// Override console.log to add a timestamp
const originalLog = console.log;
console.log = (...args) => {
    const timestamp = new Date().toLocaleString();
    originalLog(`[${timestamp}]`, ...args);
};

const WebServer = require('./server');

// 创建并启动服务器
const server = new WebServer();
server.start();
