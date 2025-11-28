const express = require('express');
const auth = require('../auth');
const database = require('../db_sqlite');
const cronSvc = require('node-cron');
const schedulerService = require('../services/SchedulerService');
const router = express.Router();

router.get('/', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/schedules`);
    try {
        let schedules = database.getSchedules();
        const { task_type } = req.query;
        if (task_type) {
            schedules = schedules.filter(s => s.task_type === task_type);
        }
        res.json(schedules);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] POST /api/schedules`);
    try {
        const { name, cron, configId, isActive = true, task_type = 'fetch_inventory' } = req.body;
        if (!cronSvc.validate(cron)) return res.status(400).json({ error: '无效的cron表达式' });
        const scheduleData = { name, cron, configId, userId: req.user.id, isActive, task_type };
        const newSchedule = database.saveSchedule(scheduleData);
        if (isActive) schedulerService.startScheduledTask(newSchedule);
        res.status(201).json(newSchedule);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/schedules/:id`);
    try {
        const schedule = database.getScheduleById(parseInt(req.params.id));
        if (!schedule) return res.status(404).json({ error: '定时任务不存在' });
        res.json(schedule);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/:id', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] PUT /api/schedules/:id`);
    try {
        const scheduleId = parseInt(req.params.id);
        const updateData = req.body;
        if (updateData.cron && !cronSvc.validate(updateData.cron)) return res.status(400).json({ error: '无效的cron表达式' });
        const updatedSchedule = database.updateSchedule(scheduleId, updateData);
        if (!updatedSchedule) return res.status(404).json({ error: '定时任务不存在' });
        
        schedulerService.stopScheduledTask(scheduleId);
        if (updatedSchedule.isActive) schedulerService.startScheduledTask(updatedSchedule);
        
        res.json(updatedSchedule);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:id', auth.authenticateToken.bind(auth), (req, res) => {
    console.log(`[API Entry] DELETE /api/schedules/:id`);
    try {
        const scheduleId = parseInt(req.params.id);
        schedulerService.stopScheduledTask(scheduleId);
        const success = database.deleteSchedule(scheduleId);
        if (!success) return res.status(404).json({ error: '定时任务不存在' });
        res.json({ message: '定时任务删除成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/run', auth.authenticateToken.bind(auth), async (req, res) => {
    console.log(`[API Entry] POST /api/schedules/:id/run`);
    try {
        const scheduleId = parseInt(req.params.id);
        const schedule = database.getScheduleById(scheduleId);
        if (!schedule) return res.status(404).json({ error: '定时任务不存在' });

        // 异步执行，不等待完成
        schedulerService.executeTaskLogic(schedule, false, req.user.id);
        res.json({ message: '任务已开始执行' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
