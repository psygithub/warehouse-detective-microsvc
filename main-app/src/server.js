if (process.stdout._handle) process.stdout._handle.setBlocking(true);
if (process.stderr._handle) process.stderr._handle.setBlocking(true);

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const database = require('./db_sqlite');
const auth = require('./auth');
const schedulerService = require('./services/SchedulerService');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const configRoutes = require('./routes/configs');
const taskRoutes = require('./routes/tasks');
const resultRoutes = require('./routes/results');
const scheduleRoutes = require('./routes/schedules');
const inventoryRoutes = require('./routes/inventory');
const orderRoutes = require('./routes/orders');

class WebServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.serverBaseUrl = process.env.SERVER_URL || 'http://localhost:3000';
    console.log('服务器基础URL:', this.serverBaseUrl);
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(helmet({ contentSecurityPolicy: false }));
    this.app.use(cors({ origin: '*', credentials: true }));
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(session({
      secret: process.env.SESSION_SECRET || 'warehouse-detective-session',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
    }));
    this.app.use(express.static(path.join(__dirname, '../public')));
  }

  setupRoutes() {
    // API Routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/users', userRoutes); // 包含 /regions
    this.app.use('/api/configs', configRoutes);
    this.app.use('/api/tasks', taskRoutes);
    this.app.use('/api/results', resultRoutes);
    this.app.use('/api/schedules', scheduleRoutes);
    this.app.use('/api/inventory', auth.authenticateToken.bind(auth), inventoryRoutes);
    this.app.use('/api/orders', orderRoutes);

    // Health Check
    this.app.get('/api/health', (req, res) => {
      res.status(200).json({
        status: 'ok',
        timestamp: new Date().toLocaleString()
      });
    });

    this.setupPageRoutes();
    this.setupErrorHandling();
  }

  setupPageRoutes() {
    this.app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
    this.app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
    this.app.get('/admin', auth.requireLoginForPage.bind(auth), (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
    this.app.get('/results', (req, res) => res.sendFile(path.join(__dirname, '../public/results.html')));
  }

  setupErrorHandling() {
    this.app.use((req, res) => res.status(404).json({ error: '页面不存在' }));
    this.app.use((error, req, res, next) => {
      console.error('服务器错误:', error);
      res.status(500).json({ error: '服务器内部错误' });
    });
  }

  async start() {
    try {
      await schedulerService.startAllScheduledTasks();
      this.app.listen(this.port, () => {
        console.log(`服务器运行在 http://localhost:${this.port}`);
        console.log('默认管理员账户: admin / admin123');
      });
    } catch (error) {
      console.error('服务器启动失败:', error);
      process.exit(1);
    }
  }

  async stop() {
    schedulerService.stopAll();
    if (database && database.close) {
      await database.close();
    }
  }
}

module.exports = WebServer;
