# 分组红包系统配置指南

本项目已重构为分组红包系统，请按照以下步骤配置 Supabase 后端。

## 1. 数据库设置

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)。
2. 进入你的项目，点击左侧 **SQL Editor**。
3. 点击 **New Query**。
4. 打开项目目录下的 `schema.sql` 文件，复制所有内容。
5. 将内容粘贴到 Supabase SQL Editor 中。
6. 点击 **Run** 执行脚本。
   - 确保没有红色报错信息。
   - 如果提示表已存在，可以先执行 `drop table if exists groups, group_members, redpackets, packet_records cascade;` 清理旧数据（**注意：这会删除所有数据！**）。

## 2. 前端配置

1. 打开 `app.js` 文件。
2. 确认顶部的 `CONFIG` 对象中的 `SUPABASE_URL` 和 `SUPABASE_KEY` 是否正确。
   - 如果你之前已经配置过，应该不需要修改。
   - 如果是新项目，请在 Supabase 的 **Project Settings -> API** 中获取。

## 3. 运行项目

1. 在项目根目录下启动本地服务器。
   - 如果安装了 Python: `python -m http.server 8000`
   - 或者使用 VS Code 的 Live Server 插件。
2. 访问 `http://localhost:8000`。
3. 手机访问需确保手机和电脑在同一局域网，并访问电脑 IP (如 `http://192.168.1.x:8000`)。

## 4. 功能验证

1. **创建分组**: 点击首页“创建分组”，输入昵称，应自动跳转到新分组页。
2. **加入分组**: 记下分组号，在另一个浏览器（或无痕模式）中点击“加入分组”，输入分组号和不同昵称。
3. **发红包**: 在分组页右上角菜单选择“发红包”，输入金额和个数。
4. **抢红包**: 另一个用户应能实时看到红包并点击抢夺。
5. **解散分组**: 只有创建者能看到“解散分组”按钮。

## 5. 注意事项

- **数据清理**: 目前系统通过 `expires_at` 字段判断红包是否过期（3小时）。虽然数据保留在数据库中，但前端和新红包逻辑会视为无效。如果需要物理删除，可以在 Supabase 设置 pg_cron 定时任务或手动清理。
- **安全性**: 当前为了演示方便，RLS 策略较为宽松（允许 Public 读写，但在 RPC 中做了逻辑校验）。生产环境建议结合 Supabase Auth 做更严格的权限控制。
