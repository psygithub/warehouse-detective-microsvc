const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cronSvc = require('node-cron');

const database = require('./db_sqlite');
const auth = require('./auth');
// const WarehouseDetective = require('./main'); // No longer needed
const inventoryService = require('./inventoryService');
const analysisService = require('./analysisService');
const fetch = require('node-fetch');

class WebServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.scheduledTasks = new Map();
    this.isGlobalTaskRunning = false;
    this.currentTaskUser = null;
    this.xizhiyueAuthInfo = { cookies: null, token: null, lastUpdated: null };
    this.serverBaseUrl = process.env.SERVER_URL || 'http://localhost:3000';
    console.log('服务器基础URL:', this.serverBaseUrl);
    this.setupMiddleware();
    this.setupRoutes();
  }

  isAuthInfoValid(authInfo, maxAge = 60 * 60 * 1000) {
    if (!authInfo || !authInfo.lastUpdated) return false;
    return (Date.now() - authInfo.lastUpdated) < maxAge;
  }

  async getXizhiyueAuthInfo(forceLogin = false) {
    if (!forceLogin && this.isAuthInfoValid(this.xizhiyueAuthInfo)) {
      return this.xizhiyueAuthInfo;
    }
    try {
      const url = `https://customer.westmonth.com/login_v2`;
      const body = { area_code: `+86`, account: "18575215654", password: "FUNyaxN9SSB9WiPA5Xhz096kgDmlKag3tOqfoT0sUonuj7YHEANZOt8HD13Rq6q4edNaHsbAHw/+Kghrw+Muw96y+xKL1W8tfl29aQj8+TC6Ht257OXVWGvYQmxgQQtQymzhCitziKwi3lFGP+Kpv+ZaCjIwpqV4jlqlgrbwvLsYep31USgj80nAhll4tYDVEDNM29GfP8zvdC2MLMt8mNRZzMlTNwtcII9vA1J4mKjfQR6OKpSt7nWu90iUYD4bgRU70PfWdJrJ3JBYcrBUeVcNWid0gQMc4cl4SzxgyiqXrocqk5KIg8U/h/2yOUa/c3x77wXoEKb0dEuzAlPo5A==", type: `1` };
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome' },
        body: JSON.stringify(body)
      };
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`获取token请求失败: ${response.status} ${response.statusText}`);
      const res = await response.json();
      this.xizhiyueAuthInfo = { token: res.data.access_token, lastUpdated: Date.now() };
      return this.xizhiyueAuthInfo;
    } catch (error) {
      console.error('获取认证信息失败:', error);
      throw error;
    }
  }

  async makeAuthenticatedRequest(url, options = {}, maxRetries = 2) {
    let authInfo = await this.getXizhiyueAuthInfo();
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const requestOptions = {
          ...options,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Authorization': authInfo.token ? `Bearer ${authInfo.token}` : '',
            ...options.headers
          }
        };
        const response = await fetch(url, requestOptions);
        if (response.status === 401 || response.status === 403) {
          if (attempt < maxRetries) {
            authInfo = await this.getXizhiyueAuthInfo(true);
            continue;
          } else {
            throw new Error(`认证失败: ${response.status} ${response.statusText}`);
          }
        }
        if (!response.ok) {
          const rawText = await response.text();
          throw new Error(`请求失败: ${response.status} ${response.statusText}，返回内容: ${rawText}`);
        }
        return await response.json();
      } catch (error) {
        if (attempt >= maxRetries) throw error;
      }
    }
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
    this.setupAuthRoutes();
    this.setupUserRoutes();
    this.setupConfigRoutes();
    this.setupTaskRoutes();
    this.setupResultRoutes();
    this.setupScheduleRoutes();
    this.setupFetchXizhiyueData();
    this.setupInventoryRoutes();
    this.setupUserSkuRoutes();
    this.setupPageRoutes();
    this.setupErrorHandling();
  }

  setupAuthRoutes() {
    this.app.post('/api/auth/login', async (req, res) => {
      try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
        const result = await auth.login(username, password);
        res.json(result);
      } catch (error) {
        res.status(401).json({ error: error.message });
      }
    });
    this.app.post('/api/auth/register', async (req, res) => {
      try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: '用户名、邮箱和密码不能为空' });
        if (password.length < 6) return res.status(400).json({ error: '密码长度至少6位' });
        const result = await auth.register({ username, email, password });
        res.status(201).json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });
    this.app.get('/api/auth/verify', auth.authenticateToken.bind(auth), (req, res) => res.json({ user: req.user }));
    this.app.get('/api/auth/check-session', auth.authenticateToken.bind(auth), (req, res) => res.json({ isValid: true }));
  }

  setupUserRoutes() {
    this.app.get('/api/users', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), (req, res) => {
      try {
        const users = database.getAllUsers().map(u => {
          const { password, ...userWithoutPassword } = u;
          return userWithoutPassword;
        });
        res.json(users);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    this.app.post('/api/users', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), async (req, res) => {
      try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: '用户名、邮箱和密码不能为空' });
        if (password.length < 6) return res.status(400).json({ error: '密码长度至少6位' });
        const result = await auth.register({ username, email, password, role: 'user' });
        res.status(201).json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });
    this.app.get('/api/users/:id', auth.authenticateToken.bind(auth), auth.requireUserOrAdmin.bind(auth), (req, res) => {
      try {
        const user = database.findUserById(parseInt(req.params.id));
        if (!user) return res.status(404).json({ error: '用户不存在' });
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    this.app.put('/api/users/:id', auth.authenticateToken.bind(auth), auth.requireUserOrAdmin.bind(auth), (req, res) => {
      try {
        const userId = parseInt(req.params.id);
        const updateData = req.body;
        if (req.user.role !== 'admin') delete updateData.role;
        if (updateData.password) {
          const bcrypt = require('bcryptjs');
          updateData.password = bcrypt.hashSync(updateData.password, 10);
        }
        const updatedUser = database.updateUser(userId, updateData);
        if (!updatedUser) return res.status(404).json({ error: '用户不存在' });
        const { password, ...userWithoutPassword } = updatedUser;
        res.json(userWithoutPassword);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    this.app.delete('/api/users/:id', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), (req, res) => {
      try {
        const userId = parseInt(req.params.id);
        if (userId === req.user.id) return res.status(400).json({ error: '不能删除自己的账户' });
        const success = database.deleteUser(userId);
        if (!success) return res.status(404).json({ error: '用户不存在' });
        res.json({ message: '用户删除成功' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  setupUserSkuRoutes() {
    this.app.get('/api/users/:id/skus', auth.authenticateToken.bind(auth), auth.requireUserOrAdmin.bind(auth), (req, res) => {
      try {
        const userId = parseInt(req.params.id);
        const isAdmin = req.user.role === 'admin';
        const userSkus = database.getUserSkus(userId, isAdmin);
        res.json(userSkus);
      } catch (error) {
        res.status(500).json({ error: '获取用户SKU列表失败: ' + error.message });
      }
    });
    this.app.post('/api/users/:id/skus', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), (req, res) => {
      try {
        const userId = parseInt(req.params.id);
        const { skus } = req.body;
        if (!Array.isArray(skus)) return res.status(400).json({ error: 'skus 必须是一个数组' });
        database.replaceUserSkus(userId, skus);
        res.json({ message: '用户SKU关联更新成功' });
      } catch (error) {
        res.status(500).json({ error: '更新用户SKU关联失败: ' + error.message });
      }
    });
    this.app.post('/api/skus/lookup', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const { skus } = req.body;
            if (!Array.isArray(skus) || skus.length === 0) {
                return res.status(400).json({ error: 'SKU列表不能为空' });
            }
            const foundSkus = database.getTrackedSkusBySkuNames(skus);
            res.json(foundSkus);
        } catch (error) {
            res.status(500).json({ error: '查询SKU失败: ' + error.message });
        }
    });
    this.app.get('/api/skus', auth.authenticateToken.bind(auth), (req, res) => {
      try {
        const allSkus = database.getTrackedSkus();
        const { page = 1, limit = 20, search = '' } = req.query;
        let filteredSkus = allSkus;
        if (search) {
          filteredSkus = allSkus.filter(sku =>
            sku.sku.toLowerCase().includes(search.toLowerCase()) ||
            (sku.product_name && sku.product_name.toLowerCase().includes(search.toLowerCase()))
          );
        }
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedSkus = filteredSkus.slice(startIndex, endIndex);
        res.json({ items: paginatedSkus, total: filteredSkus.length, page: parseInt(page), limit: parseInt(limit) });
      } catch (error) {
        res.status(500).json({ error: '获取SKU列表失败: ' + error.message });
      }
    });
  }

  setupConfigRoutes() {
    this.app.get('/api/configs', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const configs = database.getConfigs();
            res.json(configs);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    this.app.post('/api/configs', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const configData = { ...req.body, userId: req.user.id };
            const newConfig = database.saveConfig(configData);
            res.status(201).json(newConfig);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    this.app.get('/api/configs/:id', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const config = database.getConfigById(parseInt(req.params.id));
            if (!config) return res.status(404).json({ error: '配置不存在' });
            res.json(config);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    this.app.put('/api/configs/:id', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const configId = parseInt(req.params.id);
            const updatedConfig = database.updateConfig(configId, req.body);
            if (!updatedConfig) return res.status(404).json({ error: '配置不存在' });
            res.json(updatedConfig);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    this.app.delete('/api/configs/:id', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const configId = parseInt(req.params.id);
            const success = database.deleteConfig(configId);
            if (!success) return res.status(404).json({ error: '配置不存在' });
            res.json({ message: '配置删除成功' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
  }

  setupTaskRoutes() {
    this.app.post('/api/tasks/run', auth.authenticateToken.bind(auth), async (req, res) => {
        try {
            if (this.isGlobalTaskRunning) {
                return res.status(409).json({ error: '系统正在执行其他任务，请稍后再试', currentUser: this.currentTaskUser });
            }
            const { skus, regions, configId } = req.body;
            this.isGlobalTaskRunning = true;
            this.currentTaskUser = req.user.username;

            let config = {};
            if (configId) {
                const savedConfig = database.getConfigById(configId);
                if (savedConfig) config = savedConfig;
            }
            
            const skusToRun = skus || config.skus;
            const regionsToRun = regions || config.regions;

            try {
                // Call the new playwright-service
                const playwrightServiceUrl = process.env.PLAYWRIGHT_SERVICE_URL || 'http://playwright-service:3001';
                console.log(`Calling Playwright service at ${playwrightServiceUrl}/api/run-task`);
                
                const response = await fetch(`${playwrightServiceUrl}/api/run-task`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ skus: skusToRun, regions: regionsToRun })
                });

                if (!response.ok) {
                    const errorBody = await response.text();
                    throw new Error(`Playwright service failed with status ${response.status}: ${errorBody}`);
                }

                const serviceResult = await response.json();

                const savedResult = database.saveResult({
                    userId: req.user.id,
                    configId: configId || null,
                    skus: skusToRun,
                    regions: regionsToRun,
                    results: serviceResult.data,
                    status: 'completed'
                });
                res.json(savedResult);

            } catch (error) {
                console.error('任务执行或调用Playwright服务失败:', error);
                res.status(500).json({ error: '任务执行失败', message: error.message });
            } finally {
                this.isGlobalTaskRunning = false;
                this.currentTaskUser = null;
            }
        } catch (error) {
            console.error('任务路由顶层错误:', error);
            this.isGlobalTaskRunning = false;
            this.currentTaskUser = null;
            res.status(500).json({ error: error.message });
        }
    });
    this.app.get('/api/tasks/status', auth.authenticateToken.bind(auth), (req, res) => {
        res.json({
            scheduledTasks: Array.from(this.scheduledTasks.keys()),
            totalScheduled: this.scheduledTasks.size,
            isGlobalTaskRunning: this.isGlobalTaskRunning,
            currentTaskUser: this.currentTaskUser
        });
    });
  }

  setupResultRoutes() {
    this.app.get('/api/results', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const { limit = 50, offset = 0, scheduled } = req.query;
            let results = database.getResults(parseInt(limit), parseInt(offset));
            if (scheduled === 'true') {
                results = results.filter(result => result.isScheduled === 1);
            } else if (scheduled === 'false') {
                results = results.filter(result => result.isScheduled === 0);
            }
            res.json(results);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    this.app.get('/api/results/:id', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const result = database.getResultById(parseInt(req.params.id));
            if (!result) return res.status(404).json({ error: '结果不存在' });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
  }

  setupScheduleRoutes() {
    this.app.post('/api/schedules', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const { name, cron, configId, isActive = true, task_type = 'fetch_inventory' } = req.body;
            if (!cronSvc.validate(cron)) return res.status(400).json({ error: '无效的cron表达式' });
            const scheduleData = { name, cron, configId, userId: req.user.id, isActive, task_type };
            const newSchedule = database.saveSchedule(scheduleData);
            if (isActive) this.startScheduledTask(newSchedule);
            res.status(201).json(newSchedule);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    this.app.get('/api/schedules/:id', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const schedule = database.getScheduleById(parseInt(req.params.id));
            if (!schedule) return res.status(404).json({ error: '定时任务不存在' });
            res.json(schedule);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    this.app.get('/api/schedules', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const schedules = database.getSchedules();
            res.json(schedules);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    this.app.put('/api/schedules/:id', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const scheduleId = parseInt(req.params.id);
            const updateData = req.body;
            if (updateData.cron && !cronSvc.validate(updateData.cron)) return res.status(400).json({ error: '无效的cron表达式' });
            const updatedSchedule = database.updateSchedule(scheduleId, updateData);
            if (!updatedSchedule) return res.status(404).json({ error: '定时任务不存在' });
            this.stopScheduledTask(scheduleId);
            if (updatedSchedule.isActive) this.startScheduledTask(updatedSchedule);
            res.json(updatedSchedule);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    this.app.delete('/api/schedules/:id', auth.authenticateToken.bind(auth), (req, res) => {
        try {
            const scheduleId = parseInt(req.params.id);
            this.stopScheduledTask(scheduleId);
            const success = database.deleteSchedule(scheduleId);
            if (!success) return res.status(404).json({ error: '定时任务不存在' });
            res.json({ message: '定时任务删除成功' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
  }

  setupFetchXizhiyueData() {
    // ... (omitted for brevity)
  }

  setupInventoryRoutes() {
    const router = express.Router();
    router.get('/skus', (req, res) => {
        try {
            const skus = database.getTrackedSkus();
            res.json(skus);
        } catch (error) {
            res.status(500).json({ error: '获取 SKU 列表失败: ' + error.message });
        }
    });
    router.get('/skus-paginated', (req, res) => {
        try {
            const { page = 1, limit = 20 } = req.query;
            const allSkus = database.getTrackedSkus();
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            const paginatedSkus = allSkus.slice(startIndex, endIndex);
            res.json({
                items: paginatedSkus,
                total: allSkus.length,
                page: parseInt(page),
                limit: parseInt(limit)
            });
        } catch (error) {
            res.status(500).json({ error: '获取分页 SKU 列表失败: ' + error.message });
        }
    });
    router.post('/skus', async (req, res) => {
        const { sku } = req.body;
        if (!sku) return res.status(400).json({ error: 'SKU 不能为空' });
        try {
            const authInfo = await this.getXizhiyueAuthInfo();
            const trackedSku = await inventoryService.addOrUpdateTrackedSku(sku, authInfo.token);
            if (trackedSku) {
                res.status(201).json(trackedSku);
            } else {
                res.status(404).json({ error: `无法找到 SKU ${sku} 的信息` });
            }
        } catch (error) {
            res.status(500).json({ error: '添加 SKU 失败: ' + error.message });
        }
    });
    router.delete('/skus/:id', (req, res) => {
        const { id } = req.params;
        try {
            const success = database.deleteTrackedSku(id);
            if (success) {
                res.json({ message: 'SKU 删除成功' });
            } else {
                res.status(404).json({ error: '未找到要删除的 SKU' });
            }
        } catch (error) {
            res.status(500).json({ error: '删除 SKU 失败: ' + error.message });
        }
    });
    router.get('/skus/:id/has-history', (req, res) => {
        const { id } = req.params;
        try {
            const hasHistory = database.hasInventoryHistory(id);
            res.json({ hasHistory });
        } catch (error) {
            res.status(500).json({ error: '检查历史记录失败: ' + error.message });
        }
    });
    router.get('/history/:skuId', (req, res) => {
        const { skuId } = req.params;
        try {
            const data = inventoryService.getInventoryHistoryBySku(skuId);
            if (data) {
                res.json(data);
            } else {
                res.status(404).json({ error: '未找到该 SKU 的历史记录' });
            }
        } catch (error) {
            res.status(500).json({ error: '获取库存历史失败: ' + error.message });
        }
    });
    router.get('/regional-history/:skuId', (req, res) => {
        const { skuId } = req.params;
        try {
            let history = database.getRegionalInventoryHistoryBySkuId(skuId);
            // 剔除中国地区的数据
            history = history.filter(record => record.region_name !== '中国');
            const skuDetails = database.getTrackedSkus().find(s => s.id == skuId);
            res.json({
                history,
                sku: skuDetails ? skuDetails.sku : 'N/A',
                product_image: skuDetails ? skuDetails.product_image : null,
            });
        } catch (error) {
            res.status(500).json({ error: '获取区域库存历史失败: ' + error.message });
        }
    });
    router.post('/fetch-now', async (req, res) => {
        try {
            const authInfo = await this.getXizhiyueAuthInfo();
            const results = await inventoryService.fetchAndSaveAllTrackedSkus(authInfo.token);
            for (const sku of database.getTrackedSkus()) {
                await inventoryService.addOrUpdateTrackedSku(sku.sku, authInfo.token);
            }
            res.json(results);
        } catch (error) {
            res.status(500).json({ error: '立即查询失败: ' + error.message });
        }
    });

    router.post('/fetch-sku/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const authInfo = await this.getXizhiyueAuthInfo();
            const result = await inventoryService.fetchSingleSkuById(id, authInfo.token);
            if (result) {
                res.json(result);
            } else {
                res.status(404).json({ error: 'SKU not found or failed to fetch.' });
            }
        } catch (error) {
            res.status(500).json({ error: `Failed to fetch SKU: ${error.message}` });
        }
    });
    router.get('/schedule/history', (req, res) => {
        try {
            const history = database.getScheduledTaskHistory();
            res.json(history);
        } catch (error) {
            res.status(500).json({ error: '获取定时任务历史失败: ' + error.message });
        }
    });
    router.post('/run-analysis', async (req, res) => {
        try {
            await analysisService.runInventoryAnalysis();
            res.json({ message: '库存分析任务已成功触发。' });
        } catch (error) {
            res.status(500).json({ error: '手动分析失败: ' + error.message });
        }
    });
    router.post('/run-analysis/:skuId', async (req, res) => {
        try {
            const { skuId } = req.params;
            const result = await analysisService.runInventoryAnalysis(skuId);
            res.json({ 
                message: `SKU (ID: ${skuId}) 分析完成。`,
                ...result 
            });
        } catch (error) {
            res.status(500).json({ error: `单个SKU分析失败: ${error.message}` });
        }
    });
    router.get('/system-configs', (req, res) => {
        try {
            const configs = database.getSystemConfigs();
            res.json(configs);
        } catch (error) {
            res.status(500).json({ error: '获取系统配置失败: ' + error.message });
        }
    });
    router.post('/system-configs', (req, res) => {
        try {
            const { configs } = req.body;
            if (!configs || typeof configs !== 'object') {
                return res.status(400).json({ error: '无效的配置数据格式' });
            }
            database.updateSystemConfigs(configs);
            res.json({ message: '系统配置已更新' });
        } catch (error) {
            res.status(500).json({ error: '更新系统配置失败: ' + error.message });
        }
    });
    router.get('/alerts', (req, res) => {
        try {
            const { page = 1, limit = 50 } = req.query;
            const paginatedAlerts = database.getActiveAlertsPaginated({
                page: parseInt(page),
                limit: parseInt(limit)
            });
            res.json(paginatedAlerts);
        } catch (error) {
            res.status(500).json({ error: '获取预警失败: ' + error.message });
        }
    });

    router.get('/alerts/all', (req, res) => {
        try {
            // 注意：这里调用的是旧的、非分页的函数
            const alerts = database.getActiveAlerts();
            res.json(alerts);
        } catch (error) {
            res.status(500).json({ error: '获取所有预警失败: ' + error.message });
        }
    });
    router.get('/pivot-history', (req, res) => {
        try {
            let latestHistory = database.getLatestRegionalInventoryHistory();
            // 剔除中国地区的数据
            latestHistory = latestHistory.filter(record => record.region_name !== '中国');
            const userSkuExpiresMap = new Map();
            if (req.user.role !== 'admin') {
                const userSkus = database.getUserSkus(req.user.id, false);
                const allowedSkuIds = new Set(userSkus.map(s => {
                    userSkuExpiresMap.set(s.id, s.expires_at);
                    return s.id;
                }));
                latestHistory = latestHistory.filter(record => allowedSkuIds.has(record.tracked_sku_id));
            }
            if (!latestHistory || latestHistory.length === 0) {
                return res.json({ columns: [], rows: [] });
            }
            const allTrackedSkus = database.getTrackedSkus();
            const skuInfoMap = new Map(allTrackedSkus.map(s => [s.sku, {product_name: s.product_name, product_image: s.product_image, id: s.id}]));
            const allRegions = database.getAllRegions().sort().filter(region => region !== '中国');
            const columns = ['图片', 'SKU', '商品名称', '最新日期', ...allRegions];
            if (req.user.role !== 'admin') {
                columns.splice(3, 0, '有效日期');
            }
            const pivotData = {};
            latestHistory.forEach(record => {
                const sku = record.sku;
                if (!pivotData[sku]) {
                    const info = skuInfoMap.get(sku) || {};
                    pivotData[sku] = {
                        'SKU': sku,
                        '商品名称': info.product_name,
                        '最新日期': record.record_date,
                        '图片': info.product_image
                    };
                    if (req.user.role !== 'admin') {
                        const expires_at = userSkuExpiresMap.get(info.id);
                        pivotData[sku]['有效日期'] = expires_at ? expires_at.split(' ')[0] : '长期';
                    }
                }
                pivotData[sku][record.region_name] = record.qty;
            });
            const rows = Object.values(pivotData).map(skuRecord => {
                const row = {};
                columns.forEach(col => {
                    row[col] = skuRecord[col] !== undefined ? skuRecord[col] : null;
                });
                return row;
            });
            res.json({ columns, rows });
        } catch (error) {
            res.status(500).json({ error: '获取数据透视历史失败: ' + error.message });
        }
    });
    router.get('/pivot-history/:skuId', (req, res) => {
        const { skuId } = req.params;
        try {
            const history = database.getRegionalInventoryHistoryBySkuId(skuId);
            if (!history || history.length === 0) {
                return res.json({ columns: [], rows: [] });
            }
            const pivotData = {};
            const regionSet = new Set();
            history.forEach(record => {
                const date = record.record_date;
                const region = record.region_name || '未知区域';
                regionSet.add(region);
                if (!pivotData[date]) {
                    pivotData[date] = { '日期': date };
                }
                pivotData[date][region] = record.qty;
            });
            const columns = ['日期', ...Array.from(regionSet).sort()];
            const rows = Object.values(pivotData).map(dateRecord => {
                const row = {};
                columns.forEach(col => {
                    row[col] = dateRecord[col] !== undefined ? dateRecord[col] : null;
                });
                return row;
            }).sort((a, b) => new Date(b['日期']) - new Date(a['日期']));
            res.json({ columns, rows });
        } catch (error) {
            res.status(500).json({ error: '获取数据透视历史失败: ' + error.message });
        }
    });
    this.app.use('/api/inventory', auth.authenticateToken.bind(auth), router);
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
      await this.startAllScheduledTasks();
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
    for (const [scheduleId, task] of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks.clear();
    if (database && database.close) {
      await database.close();
    }
  }

  // This method is no longer needed as the logic is now in playwright-service
  // async executeTask(skus, regions) { ... }

  startScheduledTask(schedule) {
    if (this.scheduledTasks.has(schedule.id)) {
        this.stopScheduledTask(schedule.id);
    }
    if (cronSvc.validate(schedule.cron)) {
        const task = cronSvc.schedule(schedule.cron, async () => {
            const startTime = new Date();
            console.log(`[定时任务开始] 任务 '${schedule.name}' (ID: ${schedule.id}) 已于 ${startTime.toLocaleString()} 开始执行。Cron: [${schedule.cron}]`);
            let status = 'failed';
            let details = '';
            try {
                let result;
                switch (schedule.task_type) {
                    case 'run_analysis':
                        result = await analysisService.runInventoryAnalysis();
                        break;
                    case 'fetch_inventory':
                    default:
                        const authInfo = await this.getXizhiyueAuthInfo();
                        result = await inventoryService.fetchAndSaveAllTrackedSkus(authInfo.token);
                        break;
                }
                status = 'completed';
                details = JSON.stringify(result);
                console.log(`[${new Date().toLocaleString()}] Scheduled task ${schedule.name} completed successfully.`);
            } catch (error) {
                console.error(`[${new Date().toLocaleString()}] Error running scheduled task ${schedule.name}:`, error);
                details = error.message;
            } finally {
                database.saveScheduledTaskHistory({
                    schedule_id: schedule.id,
                    task_name: schedule.name,
                    run_time: startTime.toISOString(),
                    status: status,
                    details: details
                });
            }
        });
        this.scheduledTasks.set(schedule.id, task);
        console.log(`Scheduled task "${schedule.name}" with cron "${schedule.cron}" has been started.`);
    } else {
        console.error(`Invalid cron expression for schedule ${schedule.id}: ${schedule.cron}`);
    }
  }

  stopScheduledTask(scheduleId) {
    const task = this.scheduledTasks.get(scheduleId);
    if (task) {
        task.stop();
        this.scheduledTasks.delete(scheduleId);
        console.log(`Scheduled task with ID ${scheduleId} has been stopped.`);
    }
  }

  async startAllScheduledTasks() {
    console.log('Starting all scheduled tasks...');
    try {
        const schedules = database.getSchedules();
        const activeSchedules = schedules.filter(s => s.isActive);
        console.log(`Found ${activeSchedules.length} active schedules to start.`);
        for (const schedule of activeSchedules) {
            this.startScheduledTask(schedule);
        }
    } catch (error) {
        console.error('Failed to start all scheduled tasks:', error);
    }
  }

  startDailyInventoryUpdateTask() {
    // ... (implementation omitted for brevity)
  }

  startDailyAnalysisTask() {
    // ... (implementation omitted for brevity)
  }
}

module.exports = WebServer;
