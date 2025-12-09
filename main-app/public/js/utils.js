// 工具函数

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
window.showToast = showToast;
window.formatDate = formatDate;
window.confirmAction = confirmAction;
window.showCommonModal = showCommonModal;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
