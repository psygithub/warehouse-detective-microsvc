const cronSvc = require('node-cron');
const database = require('../db_sqlite');
const inventoryService = require('./inventoryService');
const orderService = require('./orderService');
const analysisService = require('../analysisService');
const xizhiyueClient = require('./xizhiyueClient');

class SchedulerService {
    constructor() {
        this.scheduledTasks = new Map();
    }

    async executeTaskLogic(schedule, isScheduled = true, overrideUserId = null) {
        const startTime = new Date();
        const triggerType = isScheduled ? '自动调度' : '手动触发';
        console.log(`[任务开始] ${triggerType}任务 '${schedule.name}' (ID: ${schedule.id}) 已于 ${startTime.toLocaleString()} 开始执行。`);
        
        let status = 'failed';
        let details = '';
        
        try {
            let result;
            const authInfo = await xizhiyueClient.getAuthInfo();
            switch (schedule.task_type) {
                case 'run_analysis':
                    result = await analysisService.runInventoryAnalysis();
                    break;
                case 'check_orders':
                    await orderService.checkNewOrderAndSendNotice(authInfo.token);
                    result = { message: '订单检查完成' };
                    break;
                case 'fetch_inventory':
                default:
                    result = await inventoryService.fetchAndSaveAllTrackedSkus(authInfo.token);
                    break;
            }
            status = 'completed';
            details = JSON.stringify(result);
            console.log(`[${new Date().toLocaleString()}] Task ${schedule.name} completed successfully.`);
        } catch (error) {
            console.error(`[${new Date().toLocaleString()}] Error running task ${schedule.name}:`, error);
            details = error.message;
        } finally {
            const config = (schedule.configId ? database.getConfigById(schedule.configId) : null) || {};
            database.saveResult({
                userId: overrideUserId || schedule.userId,
                configId: schedule.configId || null,
                skus: config.skus || [],
                regions: config.regions || [],
                results: details,
                status: status,
                isScheduled: isScheduled ? 1 : 0,
                scheduleId: schedule.id
            });
        }
    }

    startScheduledTask(schedule) {
        if (this.scheduledTasks.has(schedule.id)) {
            this.stopScheduledTask(schedule.id);
        }
        if (cronSvc.validate(schedule.cron)) {
            const task = cronSvc.schedule(schedule.cron, async () => {
                await this.executeTaskLogic(schedule, true);
            }, {
                timezone: "Asia/Shanghai"
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

    stopAll() {
        for (const [scheduleId, task] of this.scheduledTasks) {
            task.stop();
        }
        this.scheduledTasks.clear();
    }
    
    getTasksStatus() {
        return {
            scheduledTasks: Array.from(this.scheduledTasks.keys()),
            totalScheduled: this.scheduledTasks.size,
            isGlobalTaskRunning: false, // 简化逻辑，不再维护全局单任务锁，因为 executeTaskLogic 是并发安全的(或者说由数据库锁控制)
            currentTaskUser: null
        };
    }
}

module.exports = new SchedulerService();
