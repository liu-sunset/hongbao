# Supabase 数据库配置指南

为了实现多端同步和数据实时更新，本项目使用了 [Supabase](https://supabase.com) 作为后端数据库。请按照以下步骤进行配置。

## 1. 注册与创建项目
1. 访问 [Supabase 官网](https://supabase.com) 并注册账号（免费）。
2. 点击 **"New Project"** 创建一个新项目。
3. 填写项目名称和数据库密码，等待项目初始化完成（约 1-2 分钟）。

## 2. 创建数据表
项目创建完成后，点击左侧菜单的 **SQL Editor**，新建一个 Query，复制并运行以下 SQL 语句：

```sql
-- 创建红包表
create table redpackets (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  total_amount numeric,
  remaining_count integer,
  participants jsonb default '[]'::jsonb,
  is_first boolean default true,
  is_active boolean default true
);

-- 开启 Realtime 功能 (允许前端监听数据变化)
alter publication supabase_realtime add table redpackets;

-- 设置简单的读写策略 (为了演示方便，允许匿名读写，生产环境建议配置 RLS)
alter table redpackets enable row level security;
create policy "Allow all access" on redpackets for all using (true) with check (true);
```

## 3. 获取配置信息
1. 点击左侧菜单的 **Project Settings** (齿轮图标)。
2. 选择 **API** 选项卡。
3. 找到 **Project URL** 和 **anon public key**。

## 4. 在网页中配置
1. 打开部署好的红包网页。
2. 点击右上角的 **"+ 发红包"** 按钮。
3. 在弹出的配置框中填入上一步获取的 **Supabase URL** 和 **Supabase Key**。
4. 输入管理员账号密码（默认：`admin` / `123456`），即可发送第一个同步红包。
