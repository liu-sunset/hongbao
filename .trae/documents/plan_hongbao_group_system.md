# 计划：实现分组红包系统

本计划旨在将现有的单页红包应用重构为支持多端实时同步的分组红包系统。

## 1. 数据库设计 (Supabase)

我们需要重新设计数据库 Schema 以支持用户、分组和红包的关联关系。

### 1.1 数据表结构

* **groups (分组表)**

  * `id`: UUID, 主键

  * `code`: String(6), 唯一分组号, 索引

  * `creator_id`: UUID, 创建者用户ID

  * `created_at`: Timestamp

  * `name`: String, 分组名称 (可选, 默认为 "分组 <Code>")

* **group\_members (分组成员表)**

  * `id`: UUID, 主键

  * `group_id`: UUID, 外键 -> groups.id

  * `user_id`: UUID, 用户ID (客户端生成并存储在 LocalStorage)

  * `username`: String, 组内昵称 (组内唯一)

  * `joined_at`: Timestamp

  * *约束*: `(group_id, user_id)` 唯一, `(group_id, username)` 唯一

* **redpackets (红包表)**

  * `id`: UUID, 主键

  * `group_id`: UUID, 外键 -> groups.id

  * `sender_id`: UUID, 发送者 user\_id

  * `total_amount`: Numeric, 总金额

  * `remaining_count`: Integer, 剩余数量

  * `participants`: JSONB, 参与者/抢到记录 (沿用旧逻辑或拆分为新表，建议拆分以保持规范，但为了简化开发和保持与现有逻辑相似性，如果 JSONB 够用且并发控制做好了，也可以继续用。**考虑到“删除分组同步删除用户信息”和“统计”需求，拆分表更好**)

  * *决定*: 拆分为 `packet_records` 表以便于查询和管理。

  * `created_at`: Timestamp

  * `expires_at`: Timestamp, 过期时间 (3小时后)

  * `is_active`: Boolean, 是否有效 (过期或抢完可设为 false)

* **packet\_records (红包领取记录表)**

  * `id`: UUID, 主键

  * `packet_id`: UUID, 外键 -> redpackets.id

  * `user_id`: UUID, 领取者 ID

  * `username`: String, 领取者昵称 (冗余存储，方便展示)

  * `amount`: Numeric, 领取金额

  * `created_at`: Timestamp

### 1.2 数据库函数 (RPC)

为了保证数据一致性和简化前端逻辑，将核心业务逻辑封装为 Postgres Functions:

* `create_group(user_id)`: 生成唯一 Code，检查创建上限(5)，插入 groups 表。

* `join_group(group_code, user_id, username)`: 检查是否存在，检查人数上限(6)，检查用户名重复，插入 group\_members。

* `send_packet(group_id, user_id, amount, count)`: 检查当前是否有有效红包，插入 redpackets。

* `grab_packet(packet_id, user_id)`: 事务处理抢红包逻辑（并发控制、金额计算）。

* `delete_group(group_id, user_id)`: 检查权限(是否为 creator)，级联删除所有相关数据。

## 2. 前端重构

将单文件结构拆分为模块化结构 (如果环境允许)，或者在单文件中组织良好的代码结构。考虑到 `wrangler.jsonc`，我们将保持静态文件结构。

### 2.1 文件结构

* `index.html`: 主入口

* `style.css`: 样式文件

* `app.js`: 核心逻辑

* `supabase.js`: 现有 SDK

* `schema.sql`: SQL 建表脚本 (供用户在 Supabase 执行)

### 2.2 页面视图 (SPA)

使用简单的 Hash 路由 (`#home`, `#group?id=xxx`) 切换视图。

* **首页 (#home)**

  * 顶部: Logo, 标题

  * 主要区域:

    * “加入分组”按钮 -> 弹窗输入 6位 Code + 昵称

    * “创建分组”按钮 -> 自动调用 API 并跳转

  * 底部: “我的分组”列表 (从 LocalStorage 或 API 获取已加入的分组)

* **分组页 (#group?id=xxx)**

  * 顶部栏: 返回按钮 | 分组号 | 菜单按钮 (下拉: 发红包, 分享, 删除)

  * 状态区: 显示当前是否有红包

    * 有红包: 显示红包卡片 (倒计时/金额/抢按钮)

    * 无红包: 显示“暂无红包”或“等待土豪发红包”

  * 成员列表: 显示当前组内成员 (最多6人)

  * 弹窗:

    * 发红包表单 (金额, 个数)

    * 红包结果页

### 2.3 状态管理

* `CurrentContext`: 保存 `userId` (本地生成), `currentGroupId`, `currentPacket`.

* `LocalStorage`: 存储 `userId`, `joinedGroups` (方便首页快速展示).

## 3. 核心业务逻辑

### 3.1 用户系统

* 用户首次访问生成 UUID 存入 `localStorage.getItem('user_id')`。

* 不做全局账号系统，身份基于设备。

### 3.2 分组逻辑

* **创建**: 随机生成 6 位数字，重试机制保证唯一。限制每人创建 5 个 (DB 统计)。

* **加入**: 校验 Code。输入昵称。成功后存入 `localStorage` 并跳转。

* **删除**: 仅创建者可见删除按钮。调用 `delete_group` RPC。

### 3.3 红包逻辑

* **发送**: 仅限组内成员。调用 `send_packet`。

* **抢**: 类似现有逻辑，但改为调用 `grab_packet` RPC，后端计算金额保证原子性。

* **有效期**: 3小时。DB 定时任务或读取时过滤 `expires_at < now()`。

## 4. 任务清单

* [ ] 编写 `schema.sql`: 包含表结构、RLS 策略和 RPC 函数。

* [ ] 拆分前端代码: 创建 `style.css` 和 `app.js`。

* [ ] 实现基础架构: 路由系统, Supabase 初始化, 用户 ID 管理。

* [ ] 实现“首页” UI 和逻辑 (创建/加入分组)。

* [ ] 实现“分组页” UI 框架 (导航, 菜单)。

* [ ] 对接分组 API: 创建、加入、查询成员。

* [ ] 实现红包发送与展示逻辑 (适配新数据库结构)。

* [ ] 实现抢红包核心逻辑 (后端计算金额)。

* [ ] 完善 UI 细节: 错误提示, 加载状态, 分享功能。

* [ ] 测试与验证: 多用户并发测试, 数据清理验证。

## 5. 验证计划

* 验证建表 SQL 是否执行成功。

* 验证流程: 新用户 -> 创建分组 -> 邀请另一用户加入 -> 发红包 -> 抢红包 -> 查看结果。

* 验证限制: 第7人无法加入, 未抢完无法发新红包, 过期红包自动失效(或无法交互)。

