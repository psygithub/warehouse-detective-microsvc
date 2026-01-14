// 全局配置默认值
window.AppConfig = {
    apiPrefix: '',
    staticPrefix: ''
};

// 加载配置
const configLoaded = fetch('config.json')
    .then(response => {
        if (!response.ok) {
            // 如果找不到配置文件，可能是开发环境或意图使用默认值
            // 不抛出错误，静默使用默认值
            return {};
        }
        return response.json();
    })
    .then(config => {
        Object.assign(window.AppConfig, config);
        // console.log('Configuration loaded:', window.AppConfig);
    })
    .catch(error => {
        console.warn('Failed to load config.json, using defaults.', error);
    });

// 工具函数

// API 请求函数
async function apiRequest(url, method = 'GET', body = null) {
    // 确保配置已加载
    await configLoaded;

    // 移除开头的 /，使其变成相对路径（如果未配置绝对路径前缀）
    if (url.startsWith('/') && !url.startsWith('http')) {
        url = url.substring(1);
    }
    
    // 添加配置的前缀
    if (window.AppConfig.apiPrefix) {
        // 如果前缀不以 / 结尾，且 URL 不以 / 开头，添加 /
        const prefix = window.AppConfig.apiPrefix;
        if (!prefix.endsWith('/') && !url.startsWith('/')) {
            url = `${prefix}/${url}`;
        } else {
            url = `${prefix}${url}`;
        }
    }
    
    const token = localStorage.getItem('token');
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${token}`
        }
    };
    if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    
    // 尝试解析 JSON
    let data;
    try {
        data = await response.json();
    } catch (e) {
        data = null;
    }

    if (!response.ok) {
        const errorMsg = (data && data.error) ? data.error : `Request failed: ${response.status}`;
        const error = new Error(errorMsg);
        error.status = response.status;
        error.data = data;
        throw error;
    }
    
    return data;
}

// 显示 Toast 通知
function showToast(message, type = 'info') {
    const toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        // 创建容器
        const container = document.createElement('div');
        container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        container.style.zIndex = '1100';
        document.body.appendChild(container);
    }

    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-white bg-${type} border-0`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;

    document.querySelector('.toast-container').appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl);
    toast.show();

    // 自动移除 DOM
    toastEl.addEventListener('hidden.bs.toast', () => {
        toastEl.remove();
    });
}

// 格式化日期
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// 通用确认框 (简单的 window.confirm 封装，未来可以用 Modal 替换)
function confirmAction(message) {
    return window.confirm(message);
}

// 显示公共信息模态框
function showCommonModal(title, content) {
    const modalEl = document.getElementById('commonInfoModal');
    const titleEl = document.getElementById('commonInfoModalLabel');
    const bodyEl = document.getElementById('commonInfoModalBody');

    if (modalEl && titleEl && bodyEl) {
        titleEl.textContent = title;
        bodyEl.innerHTML = content;
        
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    } else {
        console.error('Common Info Modal element not found in DOM.');
        alert(title + '\n\n' + content.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, ""));
    }
}

// 显示加载动画
function showLoading(element) {
    if (!element) return;
    // 检查是否已经存在加载动画
    if (element.querySelector('.custom-loader')) return;

    const loader = document.createElement('div');
    loader.className = 'custom-loader d-flex justify-content-center align-items-center position-absolute top-0 start-0 w-100 h-100 bg-white bg-opacity-75';
    loader.style.zIndex = '1000';
    loader.innerHTML = `
        <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
        </div>
    `;
    
    // 确保父元素有定位上下文
    if (window.getComputedStyle(element).position === 'static') {
        element.classList.add('position-relative');
    }
    
    element.appendChild(loader);
}

// 隐藏加载动画
function hideLoading(element) {
    if (!element) return;
    const loader = element.querySelector('.custom-loader');
    if (loader) {
        loader.remove();
    }
}

// 导出函数到全局作用域
window.apiRequest = apiRequest;
window.showToast = showToast;
window.formatDate = formatDate;
window.confirmAction = confirmAction;
window.showCommonModal = showCommonModal;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
