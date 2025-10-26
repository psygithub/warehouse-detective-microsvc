(() => {
    // A variable to hold the SkuManager instance, ensuring it's created only once per load.
    let skuManagerInstance = null;
    // A flag to ensure event listeners are set up only once per load.
    let listenersInitialized = false;

    window.sectionInitializers = window.sectionInitializers || {};
    window.sectionInitializers.users = async () => {
        if (currentUser.role === 'admin') {
            // Load the modal's HTML into the placeholder
            const container = document.getElementById('sku-manager-container');
            if (container) {
                const response = await fetch('/partials/sku-manager.html');
                if (response.ok) {
                    container.innerHTML = await response.text();
                }
            }

            // Load user data
            await loadUsers();
            // Set up event listeners once everything is in the DOM
            setupEventListeners();
        } else {
            const tableBody = document.getElementById('usersTableBody');
            if (tableBody) {
                tableBody.innerHTML = '<tr><td colspan="7">您没有权限查看此内容。</td></tr>';
            }
        }
    };

    async function loadUsers() {
        try {
            const users = await apiRequest('/api/users');
            displayUsers(users);
        } catch (error) {
            console.error('加载用户失败:', error);
            const tableBody = document.getElementById('usersTableBody');
            if (tableBody) {
                tableBody.innerHTML = '<tr><td colspan="7" class="text-danger">加载用户列表失败</td></tr>';
            }
        }
    }

    function displayUsers(users) {
        const tableBody = document.getElementById('usersTableBody');
        if (!tableBody) return;
        tableBody.innerHTML = '';

        if (users.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7">暂无用户</td></tr>';
            return;
        }

        users.forEach(user => {
            const manageSkusBtn = user.role === 'user'
                ? `<button class="btn btn-sm btn-outline-info manage-skus-btn" data-user-id="${user.id}" data-username="${user.username}">关联SKU</button>`
                : '';
            
            const manageRegionsBtn = user.role === 'user'
                ? `<button class="btn btn-sm btn-outline-success manage-regions-btn" data-user-id="${user.id}" data-username="${user.username}">关联区域</button>`
                : '';

            const row = `
                <tr>
                    <td>${user.id}</td>
                    <td>${user.username}</td>
                    <td>${user.email}</td>
                    <td><span class="badge bg-${getRoleClass(user.role)}">${user.role}</span></td>
                    <td><span class="badge bg-${user.isActive ? 'success' : 'secondary'}">${user.isActive ? '激活' : '禁用'}</span></td>
                    <td>${new Date(user.createdAt).toLocaleString()}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary edit-btn" data-user-id="${user.id}">编辑</button>
                        ${manageSkusBtn}
                        ${manageRegionsBtn}
                        <button class="btn btn-sm btn-outline-danger delete-btn" data-user-id="${user.id}" ${user.id === currentUser.id ? 'disabled' : ''}>删除</button>
                    </td>
                </tr>
            `;
            tableBody.insertAdjacentHTML('beforeend', row);
        });
    }

    function getRoleClass(role) {
        switch (role) {
            case 'admin': return 'success';
            case 'user': return 'info';
            default: return 'secondary';
        }
    }

    function setupEventListeners() {
        if (listenersInitialized) {
            return;
        }

        const userModalEl = document.getElementById('userModal');
        if (!userModalEl) return;

        const userModal = new bootstrap.Modal(userModalEl);

        // 解决模态框关闭后的焦点和点击问题
        userModalEl.addEventListener('hidden.bs.modal', () => {
            // 1. 移除焦点，防止被困在隐藏元素内，解决 aria-hidden 警告
            if (document.activeElement) {
                document.activeElement.blur();
            }
            // 2. 强制移除可能残留的背景板，解决“需要点击两次”的问题
            const backdrop = document.querySelector('.modal-backdrop');
            if (backdrop) {
                backdrop.remove();
            }
            // 3. 确保body的滚动条恢复正常
            document.body.style.overflow = 'auto';
        });
        
        const userForm = document.getElementById('userForm');
        
        if (typeof SkuManager !== 'undefined' && !skuManagerInstance) {
            skuManagerInstance = new SkuManager();
        }

        const mainContent = document.querySelector('.main-content');
        if (!mainContent) return;

        mainContent.addEventListener('click', async (event) => {
            const target = event.target.closest('button');
            if (!target) return;

            if (target.id === 'addUserBtn') {
                userForm.reset();
                document.getElementById('userId').value = '';
                document.getElementById('userModalLabel').textContent = '添加新用户';
                userModal.show();
            }

            if (target.classList.contains('edit-btn')) {
                const userId = target.dataset.userId;
                const user = await apiRequest(`/api/users/${userId}`);
                
                document.getElementById('userId').value = user.id;
                document.getElementById('username').value = user.username;
                document.getElementById('email').value = user.email;
                document.getElementById('password').value = '';
                document.getElementById('role').value = user.role;
                document.getElementById('isActive').checked = user.isActive === 1;
                document.getElementById('userModalLabel').textContent = '编辑用户';
                
                userModal.show();
            }

            if (target.classList.contains('delete-btn')) {
                const userId = target.dataset.userId;
                if (confirm('确定要删除这个用户吗？')) {
                    try {
                        await apiRequest(`/api/users/${userId}`, 'DELETE');
                        loadUsers();
                    } catch (error) {
                        alert('删除用户失败: ' + error.message);
                    }
                }
            }

            if (target.classList.contains('manage-skus-btn')) {
                if (skuManagerInstance) {
                    const userId = target.dataset.userId;
                    const username = target.dataset.username;
                    skuManagerInstance.openForUser(userId, username);
                } else {
                    console.error("SkuManager is not initialized.");
                }
            }

            if (target.classList.contains('manage-regions-btn')) {
                const userId = target.dataset.userId;
                const username = target.dataset.username;
                openAssociateRegionsModal({ id: userId, username });
            }

            if (target.id === 'saveUserBtn') {
                const userId = document.getElementById('userId').value;
                const userData = {
                    username: document.getElementById('username').value,
                    email: document.getElementById('email').value,
                    password: document.getElementById('password').value,
                    role: document.getElementById('role').value,
                    isActive: document.getElementById('isActive').checked ? 1 : 0,
                };

                // 当创建新用户时，密码是必需的
                if (!userId && !userData.password) {
                    alert('创建新用户时必须提供密码。');
                    return;
                }

                if (!userData.password) {
                    delete userData.password;
                }

                try {
                    if (userId) {
                        await apiRequest(`/api/users/${userId}`, 'PUT', userData);
                    } else {
                        await apiRequest('/api/users', 'POST', userData);
                    }
                    userModal.hide();
                    loadUsers();
                } catch (error) {
                    alert('保存用户失败: ' + error.message);
                }
            }
        });

        listenersInitialized = true;
    }

    async function openAssociateRegionsModal(user) {
        const modalHtml = `
            <div class="modal fade" id="associateRegionsModal" tabindex="-1" aria-labelledby="associateRegionsModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="associateRegionsModalLabel">为 ${user.username} 关联区域</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label for="newRegionName" class="form-label">添加新区域 (每行一个)</label>
                                <div class="input-group">
                                    <textarea class="form-control" id="newRegionName" placeholder="输入新区域名称，每行一个" rows="3"></textarea>
                                    <button class="btn btn-outline-secondary" type="button" id="saveNewRegionBtn">保存</button>
                                </div>
                            </div>
                            <hr>
                            <h6>可选区域</h6>
                            <div id="regionsList" class="list-group" style="max-height: 300px; overflow-y: auto;">
                                <!-- Regions will be loaded here -->
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>
                            <button type="button" class="btn btn-primary" id="saveUserRegionsBtn">确认</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove any existing modal to avoid conflicts
        const existingModal = document.getElementById('associateRegionsModal');
        if (existingModal) {
            existingModal.remove();
        }

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modalEl = document.getElementById('associateRegionsModal');
        const modal = new bootstrap.Modal(modalEl);

        const regionsList = document.getElementById('regionsList');
        let allRegions = [];
        let userRegionIds = new Set();

        async function loadRegions() {
            try {
                const [regions, userRegions] = await Promise.all([
                    apiRequest('/api/regions'),
                    apiRequest(`/api/users/${user.id}/regions`)
                ]);
                allRegions = regions;
                userRegionIds = new Set(userRegions.map(r => r.id));
                renderRegions();
            } catch (error) {
                console.error('加载区域失败:', error);
                regionsList.innerHTML = '<p class="text-danger">加载区域列表失败</p>';
            }
        }

        function renderRegions() {
            regionsList.innerHTML = allRegions.map(region => `
                <label class="list-group-item">
                    <input class="form-check-input me-1" type="checkbox" value="${region.id}" ${userRegionIds.has(region.id) ? 'checked' : ''}>
                    ${region.name}
                </label>
            `).join('');
        }

        document.getElementById('saveNewRegionBtn').addEventListener('click', async () => {
            const newRegionNameInput = document.getElementById('newRegionName');
            const names = newRegionNameInput.value.trim().split('\n').map(name => name.trim()).filter(name => name);
            if (names.length > 0) {
                try {
                    await apiRequest('/api/regions/bulk', 'POST', { names });
                    newRegionNameInput.value = '';
                    await loadRegions();
                } catch (error) {
                    alert('保存新区域失败: ' + error.message);
                }
            }
        });

        document.getElementById('saveUserRegionsBtn').addEventListener('click', async () => {
            const selectedRegionIds = Array.from(regionsList.querySelectorAll('input:checked')).map(input => parseInt(input.value));
            try {
                await apiRequest(`/api/users/${user.id}/regions`, 'PUT', { regionIds: selectedRegionIds });
                modal.hide();
            } catch (error) {
                alert('保存用户区域关联失败: ' + error.message);
            }
        });

        modalEl.addEventListener('hidden.bs.modal', () => {
            modalEl.remove();
        });

        await loadRegions();
        modal.show();
    }
})();
