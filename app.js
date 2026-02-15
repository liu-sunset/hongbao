// 配置
const CONFIG = {
    SUPABASE_URL: 'https://amlypzgchsujfxzmizif.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtbHlwemdjaHN1amZ4em1pemlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMjA0NDYsImV4cCI6MjA4NjY5NjQ0Nn0.Nl-1B0sdNKw9IOWniiwHArwvO6PyIUaCQPSzZdNNn14'
};

// 状态管理
const Store = {
    user: {
        id: null,
        joinedGroups: [] // [{id, code, name}]
    },
    currentGroup: null, // 完整的分组信息
    currentPacket: null, // 当前最新的红包
    members: [], // 当前分组成员
    realtime: null
};

// 工具函数
const Utils = {
    uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },
    toast(msg, duration = 2000, icon = '') {
        const el = document.getElementById('toast');
        if (el) {
            el.innerHTML = `${icon ? `<span class="toast-icon">${icon}</span>` : ''}${msg}`;
            el.classList.add('show');
            setTimeout(() => el.classList.remove('show'), duration);
        }
    },
    alert(msg, title = '提示') {
        const overlay = document.getElementById('alertOverlay');
        const titleEl = overlay.querySelector('.alert-title');
        const msgEl = document.getElementById('alertMessage');
        
        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = msg;
        if (overlay) overlay.classList.add('active');
    },
    closeAlert() {
        const overlay = document.getElementById('alertOverlay');
        if (overlay) overlay.classList.remove('active');
    },
    getLocalStorage(key, defaultVal = null) {
        try {
            const v = localStorage.getItem(key);
            return v ? JSON.parse(v) : defaultVal;
        } catch (e) { return defaultVal; }
    },
    setLocalStorage(key, val) {
        try {
            localStorage.setItem(key, JSON.stringify(val));
        } catch (e) {}
    }
};

// Supabase 服务
const API = {
    client: null,
    
    init() {
        if (window.supabase) {
            this.client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
        } else {
            console.error('Supabase SDK not loaded');
        }
    },

    async rpc(name, params = {}) {
        if (!this.client) return { error: { message: 'Client not initialized' } };
        return await this.client.rpc(name, params);
    },

    async createGroup(userId, userName) {
        return await this.rpc('create_group', { p_creator_id: userId, p_creator_name: userName });
    },

    async joinGroup(code, userId, userName) {
        return await this.rpc('join_group', { p_code: code, p_user_id: userId, p_username: userName });
    },

    async sendPacket(groupId, userId, amount, count) {
        return await this.rpc('send_packet', { 
            p_group_id: groupId, 
            p_sender_id: userId, 
            p_amount: amount, 
            p_count: count 
        });
    },

    async grabPacket(packetId, userId, userName) {
        return await this.rpc('grab_packet', { 
            p_packet_id: packetId, 
            p_user_id: userId, 
            p_username: userName 
        });
    },

    async deleteGroup(groupId, userId) {
        return await this.rpc('delete_group', { p_group_id: groupId, p_user_id: userId });
    },

    async getGroupDetails(groupId) {
        // 并行获取分组信息、成员、最新红包
        const { data: group, error: gErr } = await this.client.from('groups').select('*').eq('id', groupId).single();
        if (gErr) return { error: gErr };

        const { data: members, error: mErr } = await this.client.from('group_members').select('*').eq('group_id', groupId);
        
        // 获取最新红包 (无论是否结束，都显示最近的一个)
        const { data: packets, error: pErr } = await this.client
            .from('redpackets')
            .select('*')
            .eq('group_id', groupId)
            .order('created_at', { ascending: false })
            .limit(1);

        return { 
            data: { 
                group, 
                members: members || [], 
                packet: packets && packets.length > 0 ? packets[0] : null 
            } 
        };
    },
    
    // 订阅当前分组的实时更新
    subscribeGroup(groupId, callback) {
        if (Store.realtime) {
            Store.realtime.unsubscribe();
        }

        Store.realtime = this.client.channel(`group:${groupId}`)
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'group_members',
                filter: `group_id=eq.${groupId}`
            }, () => callback('members'))
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'redpackets',
                filter: `group_id=eq.${groupId}`
            }, () => callback('packet'))
            .on('postgres_changes', {
                event: 'DELETE',
                schema: 'public',
                table: 'groups',
                filter: `id=eq.${groupId}`
            }, () => callback('group_deleted'))
            .subscribe();
    }
};

// 视图控制器
const App = {
    init() {
        API.init();
        
        // 用户初始化
        let uid = Utils.getLocalStorage('user_id');
        if (!uid) {
            uid = Utils.uuid();
            Utils.setLocalStorage('user_id', uid);
        }
        Store.user.id = uid;
        Store.user.joinedGroups = Utils.getLocalStorage('joined_groups', []);

        // 路由监听
        window.addEventListener('hashchange', () => this.handleRoute());
        this.handleRoute(); // 初始路由
    },

    handleRoute() {
        const hash = window.location.hash || '#home';
        
        // 简单的路由匹配
        if (hash.startsWith('#group')) {
            const params = new URLSearchParams(hash.split('?')[1]);
            const gid = params.get('id');
            if (gid) {
                this.renderGroup(gid);
            } else {
                window.location.hash = '#home';
            }
        } else {
            this.renderHome();
        }
    },

    showView(viewId) {
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
    },

    // ================= 首页逻辑 =================
    renderHome() {
        this.showView('view-home');
        
        // 渲染已加入的分组列表
        const listEl = document.getElementById('myGroupsList');
        if (listEl) {
            listEl.innerHTML = '';
            if (Store.user.joinedGroups.length === 0) {
                listEl.innerHTML = '<div class="empty-state">暂未加入任何分组</div>';
            } else {
                Store.user.joinedGroups.forEach(g => {
                    const item = document.createElement('div');
                    item.className = 'group-item';
                    item.innerHTML = `
                        <span>分组 <span class="group-code">${g.code}</span></span>
                        <span class="hint-text">点击进入 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>
                    `;
                    item.onclick = () => window.location.hash = `#group?id=${g.id}`;
                    listEl.appendChild(item);
                });
            }
        }
    },

    async handleCreateGroup() {
        // 提示输入昵称（创建者也需要昵称）
        const name = prompt('请输入您在分组内的昵称:', '群主');
        if (!name) return;

        const btn = document.getElementById('btnCreate');
        btn.disabled = true;
        btn.textContent = '创建中...';

        try {
            const { data, error } = await API.createGroup(Store.user.id, name);
            if (error || !data.success) {
                Utils.alert(error?.message || data?.message || '创建失败');
            } else {
                const groupInfo = data.data; // {id, code}
                // 更新本地存储
                this.addToMyGroups({ id: groupInfo.id, code: groupInfo.code });
                Utils.toast('创建成功', 2000, '🎉');
                window.location.hash = `#group?id=${groupInfo.id}`;
            }
        } catch (e) {
            console.error(e);
            Utils.alert('网络错误');
        } finally {
            btn.disabled = false;
            btn.textContent = '立即创建';
        }
    },

    handleJoinGroupClick() {
        document.getElementById('modalJoin').classList.add('active');
    },

    async handleJoinSubmit() {
        const code = document.getElementById('inputJoinCode').value.trim();
        const name = document.getElementById('inputJoinName').value.trim();
        
        if (!code || code.length !== 6) return Utils.toast('请输入6位分组号', 2000, '⚠️');
        if (!name) return Utils.toast('请输入昵称', 2000, '⚠️');

        const btn = document.getElementById('btnJoinConfirm');
        btn.disabled = true;
        btn.textContent = '加入中...';

        try {
            const { data, error } = await API.joinGroup(code, Store.user.id, name);
            if (error || !data.success) {
                Utils.alert(error?.message || data?.message || '加入失败');
            } else {
                const groupInfo = data.data; // {id}
                this.addToMyGroups({ id: groupInfo.id, code: code });
                this.closeModals();
                window.location.hash = `#group?id=${groupInfo.id}`;
            }
        } catch (e) {
            console.error(e);
            Utils.alert('网络错误');
        } finally {
            btn.disabled = false;
            btn.textContent = '加入';
        }
    },

    addToMyGroups(group) {
        // 去重
        const exists = Store.user.joinedGroups.find(g => g.id === group.id);
        if (!exists) {
            Store.user.joinedGroups.push(group);
            Utils.setLocalStorage('joined_groups', Store.user.joinedGroups);
        }
    },

    // ================= 分组页逻辑 =================
    async renderGroup(groupId) {
        this.showView('view-group');
        
        // 清空旧状态
        document.getElementById('groupCodeDisplay').textContent = '加载中...';
        document.getElementById('packetArea').innerHTML = '<div class="loading-state">加载中...</div>';
        document.getElementById('membersList').innerHTML = '';
        
        // 加载数据
        const { data, error } = await API.getGroupDetails(groupId);
        
        if (error || !data.group) {
            Utils.alert('分组不存在或已删除');
            window.location.hash = '#home';
            return;
        }

        Store.currentGroup = data.group;
        Store.members = data.members;
        Store.currentPacket = data.packet;

        this.updateGroupUI();

        // 订阅更新
        API.subscribeGroup(groupId, async (type) => {
            if (type === 'group_deleted') {
                Utils.alert('该分组已被解散');
                // 移除本地记录
                Store.user.joinedGroups = Store.user.joinedGroups.filter(g => g.id !== groupId);
                Utils.setLocalStorage('joined_groups', Store.user.joinedGroups);
                window.location.hash = '#home';
                return;
            }
            
            // 重新拉取数据 (简单粗暴但可靠)
            const res = await API.getGroupDetails(groupId);
            if (res.data) {
                Store.members = res.data.members;
                Store.currentPacket = res.data.packet;
                this.updateGroupUI();
            }
        });
    },

    updateGroupUI() {
        const group = Store.currentGroup;
        const members = Store.members;
        const packet = Store.currentPacket;
        const userId = Store.user.id;

        // 标题
        document.getElementById('groupCodeDisplay').textContent = group.code;
        
        // 菜单权限: 只有创建者能看到删除按钮
        const isCreator = group.creator_id === userId;
        document.getElementById('btnDeleteGroup').style.display = isCreator ? 'block' : 'none';

        // 成员列表
        const listEl = document.getElementById('membersList');
        listEl.innerHTML = '';
        members.forEach(m => {
            const isMe = m.user_id === userId;
            const isOwner = m.user_id === group.creator_id;
            const item = document.createElement('div');
            item.className = 'member-item';
            item.innerHTML = `
                <span class="member-name">
                    ${m.username} 
                    ${isOwner ? '<span class="badge-owner">群主</span>' : ''}
                    ${isMe ? '<span class="badge-me">(我)</span>' : ''}
                </span>
                <span class="join-time">${new Date(m.joined_at).toLocaleTimeString()} 加入</span>
            `;
            listEl.appendChild(item);
        });

        // 红包区域
        const packetArea = document.getElementById('packetArea');
        if (!packet) {
            packetArea.innerHTML = `
                <div class="packet-card empty">
                    <div class="packet-icon">🧧</div>
                    <div class="subtitle">暂无红包</div>
                    <div class="packet-sub">等待土豪发红包...</div>
                </div>
            `;
        } else {
            // 检查我是否抢过
            const myGrabbedAmount = Utils.getLocalStorage(`grabbed_${packet.id}`);
            
            if (packet.remaining_count <= 0) {
                 packetArea.innerHTML = `
                    <div class="packet-card empty">
                        <div class="packet-icon">🧧</div>
                        <div class="subtitle">手慢了，红包已抢完</div>
                    </div>
                `;
            } else if (myGrabbedAmount) {
                packetArea.innerHTML = `
                    <div class="packet-card grabbed">
                        <div class="packet-title">您已领取</div>
                        <div class="packet-amount">¥${myGrabbedAmount}</div>
                    </div>
                `;
            } else {
                packetArea.innerHTML = `
                    <div class="packet-card">
                        <div class="packet-desc">大吉大利，今晚吃鸡</div>
                        <div class="packet-amount">¥${packet.total_amount}</div>
                        <div class="packet-status">剩余 ${packet.remaining_count} 个</div>
                        <button class="btn-grab" onclick="App.handleGrabPacket('${packet.id}')">抢</button>
                    </div>
                `;
            }
        }
    },

    // 交互逻辑
    toggleMenu() {
        document.getElementById('menuDropdown').classList.toggle('active');
    },

    handleShare() {
        if (!Store.currentGroup) return;
        const code = Store.currentGroup.code;
        navigator.clipboard.writeText(`来领红包啦！我的分组号是：${code}`).then(() => {
            Utils.toast('分组号已复制');
            this.toggleMenu();
        });
    },

    handleSendPacketClick() {
        if (!Store.currentPacket) {
            document.getElementById('modalSend').classList.add('active');
        } else {
            const isExpired = new Date(Store.currentPacket.expires_at) < new Date();
            const isFinished = Store.currentPacket.remaining_count <= 0;

            if (!isFinished && !isExpired) {
                 Utils.alert('当前还有未抢完的红包，请稍后再发');
                 return;
            }
            // 如果抢完了或已过期，允许发新的
            document.getElementById('modalSend').classList.add('active');
        }
        this.toggleMenu();
    },

    async handleSendSubmit() {
        const amount = parseFloat(document.getElementById('inputAmount').value);
        const count = parseInt(document.getElementById('inputCount').value);
        
        if (!amount || amount < 10) return Utils.toast('红包金额最低10元', 2000, '⚠️');
        if (!count || count <= 0) return Utils.toast('请输入有效个数', 2000, '⚠️');
        if (count > 6) return Utils.toast('个数不能超过6个', 2000, '⚠️');

        const btn = document.getElementById('btnSendConfirm');
        btn.disabled = true;
        btn.textContent = '发送中...';

        try {
            const { data, error } = await API.sendPacket(Store.currentGroup.id, Store.user.id, amount, count);
            if (error || !data.success) {
                Utils.alert(error?.message || data?.message || '发送失败', '发送失败');
            } else {
                Utils.toast('发送成功', 2000, '✅');
                this.closeModals();
                // 触发刷新
                const res = await API.getGroupDetails(Store.currentGroup.id);
                if (res.data) {
                    Store.currentPacket = res.data.packet;
                    this.updateGroupUI();
                }
            }
        } catch (e) {
            console.error(e);
            Utils.alert('网络错误');
        } finally {
            btn.disabled = false;
            btn.textContent = '塞进红包';
        }
    },

    async handleGrabPacket(packetId) {
        // 获取当前用户名
        const me = Store.members.find(m => m.user_id === Store.user.id);
        const myName = me ? me.username : '未知用户';

        // 乐观UI
        const btn = document.querySelector('.btn-grab');
        if(btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }

        try {
            const { data, error } = await API.grabPacket(packetId, Store.user.id, myName);
            if (error || !data.success) {
                Utils.alert(error?.message || data?.message || '抢红包失败');
                // 刷新界面
                const res = await API.getGroupDetails(Store.currentGroup.id);
                if (res.data) {
                    Store.currentPacket = res.data.packet;
                    this.updateGroupUI();
                }
            } else {
                const amount = data.data.amount;
                // 记录本地
                Utils.setLocalStorage(`grabbed_${packetId}`, amount);
                // 显示结果
                document.getElementById('resultAmount').textContent = amount.toFixed(2);
                document.getElementById('modalResult').classList.add('active');
                // 刷新界面
                this.updateGroupUI();
            }
        } catch (e) {
            console.error(e);
            Utils.alert('网络错误');
        }
    },

    async handleDeleteGroup() {
        if (!confirm('确定要解散该分组吗？此操作不可恢复。')) return;
        
        try {
            const { data, error } = await API.deleteGroup(Store.currentGroup.id, Store.user.id);
            if (error || !data.success) {
                Utils.alert(error?.message || data?.message || '删除失败');
            } else {
                Utils.toast('分组已解散', 2000, '👋');
                // 移除本地
                Store.user.joinedGroups = Store.user.joinedGroups.filter(g => g.id !== Store.currentGroup.id);
                Utils.setLocalStorage('joined_groups', Store.user.joinedGroups);
                window.location.hash = '#home';
            }
        } catch (e) {
            console.error(e);
            Utils.alert('网络错误');
        }
    },

    closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
        // 清空输入
        document.querySelectorAll('input').forEach(el => el.value = '');
    }
};

// 启动
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}
