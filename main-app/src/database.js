const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '../data/db.json');
    this.adapter = null;
    this.db = null;
  }

  async init() {
    // 确保数据目录存在
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 初始化默认数据
    const defaultData = {
      users: [],
      configs: [],
      results: [],
      schedules: []
    };

    this.adapter = new JSONFile(this.dbPath);
    this.db = new Low(this.adapter, defaultData);

    await this.db.read();

    // 确保数据结构存在
    this.db.data ||= defaultData;
    this.db.data.users ||= [];
    this.db.data.configs ||= [];
    this.db.data.results ||= [];
    this.db.data.schedules ||= [];

    // 创建默认超级管理员账户
    if (this.db.data.users.length === 0) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      
      this.db.data.users.push({
        id: 1,
        username: 'admin',
        email: 'admin@warehouse.com',
        password: hashedPassword,
        role: 'super_admin',
        createdAt: new Date().toISOString(),
        isActive: true
      });
    }

    await this.db.write();
    console.log('数据库初始化完成');
  }

  // 用户相关方法
  async createUser(userData) {
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    
    const newUser = {
      id: Date.now(),
      username: userData.username,
      email: userData.email,
      password: hashedPassword,
      role: userData.role || 'user',
      createdAt: new Date().toISOString(),
      isActive: true
    };

    this.db.data.users.push(newUser);
    await this.db.write();
    
    // 返回用户信息（不包含密码）
    const { password, ...userWithoutPassword } = newUser;
    return userWithoutPassword;
  }

  async findUserByUsername(username) {
    return this.db.data.users.find(user => user.username === username);
  }

  async findUserByEmail(email) {
    return this.db.data.users.find(user => user.email === email);
  }

  async findUserById(id) {
    return this.db.data.users.find(user => user.id === id);
  }

  async getAllUsers() {
    return this.db.data.users.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });
  }

  async updateUser(id, updateData) {
    const userIndex = this.db.data.users.findIndex(user => user.id === id);
    if (userIndex === -1) return null;

    if (updateData.password) {
      const bcrypt = require('bcryptjs');
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    this.db.data.users[userIndex] = { ...this.db.data.users[userIndex], ...updateData };
    await this.db.write();
    
    const { password, ...userWithoutPassword } = this.db.data.users[userIndex];
    return userWithoutPassword;
  }

  async deleteUser(id) {
    const userIndex = this.db.data.users.findIndex(user => user.id === id);
    if (userIndex === -1) return false;

    this.db.data.users.splice(userIndex, 1);
    await this.db.write();
    return true;
  }

  // 配置相关方法
  async saveConfig(configData) {
    const newConfig = {
      id: Date.now(),
      ...configData,
      createdAt: new Date().toISOString()
    };

    this.db.data.configs.push(newConfig);
    await this.db.write();
    return newConfig;
  }

  async getConfigs() {
    return this.db.data.configs;
  }

  async getConfigById(id) {
    return this.db.data.configs.find(config => config.id === id);
  }

  async updateConfig(id, updateData) {
    const configIndex = this.db.data.configs.findIndex(config => config.id === id);
    if (configIndex === -1) return null;

    this.db.data.configs[configIndex] = { ...this.db.data.configs[configIndex], ...updateData };
    await this.db.write();
    return this.db.data.configs[configIndex];
  }

  async deleteConfig(id) {
    const configIndex = this.db.data.configs.findIndex(config => config.id === id);
    if (configIndex === -1) return false;

    this.db.data.configs.splice(configIndex, 1);
    await this.db.write();
    return true;
  }

  // 结果相关方法
  async saveResult(resultData) {
    const newResult = {
      id: Date.now(),
      ...resultData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.db.data.results.push(newResult);
    await this.db.write();
    return newResult;
  }

  async getResults(limit = 100, offset = 0) {
    return this.db.data.results
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(offset, offset + limit);
  }

  async getResultById(id) {
    return this.db.data.results.find(result => result.id === id);
  }

  // 调度相关方法
  async saveSchedule(scheduleData) {
    const newSchedule = {
      id: Date.now(),
      ...scheduleData,
      createdAt: new Date().toISOString()
    };

    this.db.data.schedules.push(newSchedule);
    await this.db.write();
    return newSchedule;
  }

  async getSchedules() {
    return this.db.data.schedules;
  }

  async updateSchedule(id, updateData) {
    const scheduleIndex = this.db.data.schedules.findIndex(schedule => schedule.id === id);
    if (scheduleIndex === -1) return null;

    this.db.data.schedules[scheduleIndex] = { ...this.db.data.schedules[scheduleIndex], ...updateData };
    await this.db.write();
    return this.db.data.schedules[scheduleIndex];
  }

  async deleteSchedule(id) {
    const scheduleIndex = this.db.data.schedules.findIndex(schedule => schedule.id === id);
    if (scheduleIndex === -1) return false;

    this.db.data.schedules.splice(scheduleIndex, 1);
    await this.db.write();
    return true;
  }
}

module.exports = new Database();
