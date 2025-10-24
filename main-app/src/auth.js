const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const database = require('./db_sqlite');


const JWT_SECRET = process.env.JWT_SECRET || 'warehouse-detective-secret-key';

class AuthService {
  // 生成JWT令牌
  generateToken(user, sessionId) {
    return jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        sessionId: sessionId
      },
      JWT_SECRET,
      { expiresIn: '1d' } // 令牌有效期设置为1天
    );
  }

  // 验证JWT令牌
  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return null;
    }
  }

  // 用户登录
  async login(username, password) {
    const user = database.findUserByUsername(username);
    if (!user || !user.isActive) {
      throw new Error('用户名或密码错误');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error('用户名或密码错误');
    }

    // 生成新的会话ID并更新到数据库
    const sessionId = uuidv4();
    database.updateUser(user.id, { session_id: sessionId });

    const token = this.generateToken(user, sessionId);
    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token
    };
  }

  // 用户注册
  async register(userData) {
    // 检查用户名是否已存在
    const existingUser =  database.findUserByUsername(userData.username);
    if (existingUser) {
      throw new Error('用户名已存在');
    }

    // 检查邮箱是否已存在
    // 注意：您的数据库模块中没有 findUserByEmail 函数，这里暂时注释掉
    // const existingEmail = await database.findUserByEmail(userData.email);
    // if (existingEmail) {
    //   throw new Error('邮箱已存在');
    // }

    // 创建新用户
    const newUser =  database.createUser(userData);
    
    // 为新用户生成会话ID
    const sessionId = uuidv4();
    database.updateUser(newUser.id, { session_id: sessionId });

    const token = this.generateToken(newUser, sessionId);

    return {
      user: newUser,
      token
    };
  }

  // 验证用户身份中间件
  authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: '访问令牌缺失' });
    }

    const decoded = this.verifyToken(token);
    if (!decoded) {
      return res.status(403).json({ error: '无效的访问令牌' });
    }

    // 验证会话ID
    const user = database.findUserById(decoded.id);
    if (!user || user.session_id !== decoded.sessionId) {
      return res.status(401).json({ error: '会话已失效，请重新登录' });
    }

    req.user = decoded;
    next();
  }

  // 验证页面访问权限中间件，失败则重定向到登录页
  requireLoginForPage(req, res, next) {
    let token = null;
    if (req.headers.cookie) {
      const cookies = req.headers.cookie.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
      }, {});
      token = cookies['token'];
    }

    if (!token) {
      return res.redirect('/login');
    }

    const decoded = this.verifyToken(token);
    if (!decoded) {
      return res.redirect('/login');
    }

    const user = database.findUserById(decoded.id);
    if (!user || user.session_id !== decoded.sessionId) {
      return res.redirect('/login');
    }

    req.user = decoded;
    next();
  }

  // 验证管理员权限中间件
  requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
  }

  // 验证用户或管理员权限中间件
  requireUserOrAdmin(req, res, next) {
    const userId = parseInt(req.params.id);
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  }
}

module.exports = new AuthService();
