const express = require('express');
const auth = require('../auth');
const database = require('../db_sqlite');
const bcrypt = require('bcryptjs');
const router = express.Router();

router.get('/', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/users`);
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

router.post('/', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), async (req, res) => {
    console.log(`[API Entry] POST /api/users`);
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

router.get('/:id', auth.authenticateToken.bind(auth), auth.requireUserOrAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/users/:id`);
    try {
        const user = database.findUserById(parseInt(req.params.id));
        if (!user) return res.status(404).json({ error: '用户不存在' });
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/:id', auth.authenticateToken.bind(auth), auth.requireUserOrAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] PUT /api/users/:id`);
    try {
        const userId = parseInt(req.params.id);
        const updateData = req.body;
        if (req.user.role !== 'admin') delete updateData.role;
        if (updateData.password) {
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

router.delete('/:id', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] DELETE /api/users/:id`);
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

// User-Region Associations
router.get('/:id/regions', auth.authenticateToken.bind(auth), auth.requireUserOrAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/users/:id/regions`);
    try {
        const userId = parseInt(req.params.id);
        const userRegions = database.getUserRegions(userId);
        res.json(userRegions);
    } catch (error) {
        res.status(500).json({ error: '获取用户区域失败: ' + error.message });
    }
});

router.put('/:id/regions', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] PUT /api/users/:id/regions`);
    try {
        const userId = parseInt(req.params.id);
        const { regionIds } = req.body;
        if (!Array.isArray(regionIds)) return res.status(400).json({ error: 'regionIds 必须是一个数组' });
        database.replaceUserRegions(userId, regionIds);
        res.json({ message: '用户区域关联更新成功' });
    } catch (error) {
        res.status(500).json({ error: '更新用户区域关联失败: ' + error.message });
    }
});

// User-SKU Associations
router.get('/:id/skus', auth.authenticateToken.bind(auth), auth.requireUserOrAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] GET /api/users/:id/skus`);
    try {
        const userId = parseInt(req.params.id);
        const isAdmin = req.user.role === 'admin';
        const userSkus = database.getUserSkus(userId, isAdmin);
        res.json(userSkus);
    } catch (error) {
        res.status(500).json({ error: '获取用户SKU列表失败: ' + error.message });
    }
});

router.post('/:id/skus', auth.authenticateToken.bind(auth), auth.requireAdmin.bind(auth), (req, res) => {
    console.log(`[API Entry] POST /api/users/:id/skus`);
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

module.exports = router;
