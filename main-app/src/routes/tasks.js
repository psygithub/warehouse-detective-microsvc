const express = require('express');
const auth = require('../auth');
const database = require('../db_sqlite');
const schedulerService = require('../services/SchedulerService');
const fetch = require('node-fetch');
const router = express.Router();

// Module-level state for legacy task runner
let isGlobalTaskRunning = false;
let currentTaskUser = null;

router.post('/run', auth.authenticateToken.bind(auth), async (req, res) => {
    console.log(`[API Entry] POST /api/tasks/run`);
    try {
        if (isGlobalTaskRunning) {
            return res.status(409).json({ error: '系统正在执行其他任务，请稍后再试', currentUser: currentTaskUser });
        }
        const { skus, regions, configId } = req.body;
        isGlobalTaskRunning = true;
        currentTaskUser = req.user.username;

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
            isGlobalTaskRunning = false;
            currentTaskUser = null;
        }
    } catch (error) {
        console.error('任务路由顶层错误:', error);
        isGlobalTaskRunning = false;
        currentTaskUser = null;
        res.status(500).json({ error: error.message });
    }
});

router.get('/status', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/tasks/status`);
    // 合并 SchedulerService 的状态和本地状态
    const schedulerStatus = schedulerService.getTasksStatus();
    res.json({
        ...schedulerStatus,
        isGlobalTaskRunning: isGlobalTaskRunning || schedulerStatus.isGlobalTaskRunning,
        currentTaskUser: currentTaskUser || schedulerStatus.currentTaskUser
    });
});

module.exports = router;
