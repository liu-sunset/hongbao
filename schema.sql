-- 启用必要的扩展
create extension if not exists "pgcrypto";

-- ==========================================
-- 1. 表结构定义
-- ==========================================

-- 分组表
create table if not exists groups (
  id uuid default gen_random_uuid() primary key,
  code text not null unique, -- 6位数字
  creator_id uuid not null, -- 创建者 ID
  name text, -- 分组名称
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 分组成员表
create table if not exists group_members (
  id uuid default gen_random_uuid() primary key,
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null, -- 用户 ID
  username text not null, -- 组内昵称
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(group_id, user_id),
  unique(group_id, username)
);

-- 红包表
create table if not exists redpackets (
  id uuid default gen_random_uuid() primary key,
  group_id uuid not null references groups(id) on delete cascade,
  sender_id uuid not null, -- 发送者 ID (关联到 group_members.user_id 逻辑上)
  total_amount numeric(10, 2) not null check (total_amount > 0),
  remaining_count integer not null check (remaining_count >= 0),
  total_count integer not null check (total_count > 0), -- 总个数
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  expires_at timestamp with time zone default timezone('utc'::text, now() + interval '3 hours') not null,
  is_active boolean default true -- 辅助字段，虽可通过 expires_at 判断，但显式字段方便索引
);

-- 红包领取记录表
create table if not exists packet_records (
  id uuid default gen_random_uuid() primary key,
  packet_id uuid not null references redpackets(id) on delete cascade,
  user_id uuid not null, -- 领取者 ID
  username text not null, -- 冗余字段，方便查询
  amount numeric(10, 2) not null check (amount > 0),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(packet_id, user_id) -- 每人每个红包只能领一次
);

-- ==========================================
-- 2. 索引优化
-- ==========================================
create index if not exists idx_groups_code on groups(code);
create index if not exists idx_groups_creator on groups(creator_id);
create index if not exists idx_members_group_user on group_members(group_id, user_id);
create index if not exists idx_redpackets_group_active on redpackets(group_id) where is_active = true;

-- ==========================================
-- 3. RLS 策略 (Row Level Security)
-- ==========================================
-- 简单起见，允许匿名读写，但在生产环境应严格限制。
-- 这里我们主要依赖 RPC 函数来操作，所以表的直接操作权限可以设为只读或关闭，
-- 但为了 Realtime 订阅方便，通常开放读权限。

alter table groups enable row level security;
alter table group_members enable row level security;
alter table redpackets enable row level security;
alter table packet_records enable row level security;

-- 允许所有用户读取 (需要根据业务调整，这里为了简化客户端订阅逻辑)
create policy "Allow public read groups" on groups for select using (true);
create policy "Allow public read members" on group_members for select using (true);
create policy "Allow public read packets" on redpackets for select using (true);
create policy "Allow public read records" on packet_records for select using (true);

-- 写入权限通过 RPC 控制，或者开放给 Authenticated 用户 (如果用了 Auth)
-- 本项目使用匿名用户 + 本地 UUID，所以我们开放 INSERT/UPDATE 但建议通过 RPC 封装逻辑。
-- 为了安全，我们可以只开放 RPC，不开放直接 INSERT/UPDATE。
-- 但为了 Realtime，必须开放 SELECT。

-- 开启 Realtime
alter publication supabase_realtime add table groups, group_members, redpackets, packet_records;

-- ==========================================
-- 4. 核心业务逻辑函数 (RPC)
-- ==========================================

-- 4.1 创建分组
create or replace function create_group(
  p_creator_id uuid,
  p_creator_name text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_group_id uuid;
  v_code text;
  v_count integer;
  v_retry integer := 0;
begin
  -- 1. 检查创建上限 (每人最多5个)
  select count(*) into v_count from groups where creator_id = p_creator_id;
  if v_count >= 5 then
    return jsonb_build_object('success', false, 'message', '您最多只能创建5个分组，请先删除旧分组');
  end if;

  -- 2. 生成唯一 Code (6位数字)
  loop
    v_code := floor(random() * 900000 + 100000)::text;
    -- 检查是否存在
    if not exists (select 1 from groups where code = v_code) then
      exit;
    end if;
    v_retry := v_retry + 1;
    if v_retry > 10 then
      return jsonb_build_object('success', false, 'message', '系统繁忙，请重试');
    end if;
  end loop;

  -- 3. 创建分组
  insert into groups (code, creator_id, name)
  values (v_code, p_creator_id, '分组 ' || v_code)
  returning id into v_group_id;

  -- 4. 自动加入分组 (作为创建者)
  insert into group_members (group_id, user_id, username)
  values (v_group_id, p_creator_id, p_creator_name);

  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_group_id, 'code', v_code));
end;
$$;

grant execute on function create_group(uuid, text) to anon, authenticated, service_role;

-- 4.2 加入分组
create or replace function join_group(
  p_code text,
  p_user_id uuid,
  p_username text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_group_id uuid;
  v_count integer;
begin
  -- 1. 查找分组
  select id into v_group_id from groups where code = p_code;
  if v_group_id is null then
    return jsonb_build_object('success', false, 'message', '分组不存在');
  end if;

  -- 2. 检查是否已加入
  if exists (select 1 from group_members where group_id = v_group_id and user_id = p_user_id) then
     return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_group_id));
  end if;

  -- 3. 检查人数上限 (6人)
  select count(*) into v_count from group_members where group_id = v_group_id;
  if v_count >= 6 then
    return jsonb_build_object('success', false, 'message', '该分组已满员 (6人)');
  end if;

  -- 4. 检查用户名重复
  if exists (select 1 from group_members where group_id = v_group_id and username = p_username) then
    return jsonb_build_object('success', false, 'message', '该用户名在组内已存在，请换一个');
  end if;

  -- 5. 加入
  insert into group_members (group_id, user_id, username)
  values (v_group_id, p_user_id, p_username);

  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_group_id));
end;
$$;

grant execute on function join_group(text, uuid, text) to anon, authenticated, service_role;

-- 4.3 发送红包
create or replace function send_packet(
  p_group_id uuid,
  p_sender_id uuid,
  p_amount numeric,
  p_count integer
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_active_exists boolean;
begin
  -- 1. 检查组内是否有有效红包 (未过期且未被删除)
  -- 简单逻辑：只要有 expires_at > now() 的红包，就不允许发新的。
  -- 或者：如果上一个红包抢完了，是否允许发新的？ -> "分组内最多同时只能存在一个有效红包"。
  -- 通常理解为：只要还有一个没抢完或没过期的，就不能发。
  -- 但为了体验，如果抢完了，应该算“无效”了？
  -- 需求： "红包有效期为3小时，过期后自动失效"。
  -- 我们定义 is_active 为 (expires_at > now() AND remaining_count > 0)。
  -- 但为了避免刷屏，我们严格限制：只要有未过期的记录，就不让发？
  -- 还是：只要上一条还没结束（抢完或过期）。
  
  if exists (
    select 1 from redpackets 
    where group_id = p_group_id 
    and expires_at > now() 
    and remaining_count > 0
  ) then
    return jsonb_build_object('success', false, 'message', '当前分组还有未抢完的红包');
  end if;

  -- 2. 插入新红包
  -- 校验金额
  if p_amount < 10 then
    return jsonb_build_object('success', false, 'message', '红包金额最低10元');
  end if;

  insert into redpackets (group_id, sender_id, total_amount, remaining_count, total_count)
  values (p_group_id, p_sender_id, p_amount, p_count, p_count);

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function send_packet(uuid, uuid, numeric, integer) to anon, authenticated, service_role;

-- 4.4 抢红包 (核心并发逻辑)
create or replace function grab_packet(
  p_packet_id uuid,
  p_user_id uuid,
  p_username text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_packet redpackets%rowtype;
  v_amount numeric(10, 2);
  v_min_amount numeric := 0.01;
  v_random_max numeric;
begin
  -- 1. 锁定红包行 (悲观锁，防止并发超发)
  select * into v_packet from redpackets where id = p_packet_id for update;

  if not found then
    return jsonb_build_object('success', false, 'message', '红包不存在');
  end if;

  -- 2. 检查状态
  if v_packet.expires_at < now() then
    return jsonb_build_object('success', false, 'message', '红包已过期');
  end if;

  if v_packet.remaining_count <= 0 then
    return jsonb_build_object('success', false, 'message', '手慢了，红包已抢完');
  end if;

  -- 3. 检查是否已抢
  if exists (select 1 from packet_records where packet_id = p_packet_id and user_id = p_user_id) then
    return jsonb_build_object('success', false, 'message', '您已经抢过该红包了');
  end if;

  -- 4. 计算金额 (二倍均值法或简单随机)
  -- 剩余金额: v_packet.total_amount - (已抢总额 -> 这里需要实时计算或存储)
  -- 实际上 redpackets 表应该维护 current_balance 字段更方便，
  -- 但这里我们可以通过 sum(packet_records) 来算，或者直接用剩余金额字段。
  -- 让我们修改 redpackets 表结构增加 current_balance 会更好，
  -- 但为了不改动太大，我们假设 redpackets.total_amount 是初始总额。
  -- 我们需要知道当前剩余金额。
  -- 可以在 redpackets 加一个 remaining_amount 字段。
  
  -- 为了简化，我们假设 total_amount 在发红包时确定，
  -- 我们需要计算当前已分配的金额。
  declare
    v_allocated numeric;
    v_remain_amount numeric;
  begin
    select coalesce(sum(amount), 0) into v_allocated from packet_records where packet_id = p_packet_id;
    v_remain_amount := v_packet.total_amount - v_allocated;

    if v_packet.remaining_count = 1 then
      -- 最后一个，全给
      v_amount := v_remain_amount;
    elsif v_packet.remaining_count = v_packet.total_count then
      -- 第一个抢，必须是“手气最佳”
      -- 算法：随机取总金额的 [35%, 60%] (当人数 >=3 时)
      -- 如果人数很少(2人)，取 [60%, 80%]
      -- 这样保证剩余金额分给剩下的人时，即使平均也不可能超过第一个人
      -- (简单起见，设定一个较大比例)
      
      declare
        v_ratio numeric;
      begin
        if v_packet.total_count = 2 then
            v_ratio := 0.6 + random() * 0.2; -- 0.6 ~ 0.8
        else
            v_ratio := 0.35 + random() * 0.25; -- 0.35 ~ 0.60
        end if;
        
        v_amount := floor(v_packet.total_amount * v_ratio * 100) / 100;
        
        -- 安全校验：保证剩余金额足够分给剩下的人 (每人至少 0.01)
        if v_remain_amount - v_amount < (v_packet.remaining_count - 1) * 0.01 then
             v_amount := v_remain_amount - (v_packet.remaining_count - 1) * 0.01;
        end if;
      end;
    else
      -- 随机算法: 0.01 ~ (剩余金额 / 剩余人数 * 2)
      -- 保证每个人至少 0.01
      v_random_max := (v_remain_amount / v_packet.remaining_count) * 2;
      -- 简单的随机逻辑
      v_amount := floor(random() * (v_random_max - v_min_amount) * 100) / 100 + v_min_amount;
      -- 修正: 确保金额不小于 0.01 且不超过剩余金额 (虽然理论上 *2 不会超，但浮点数...)
      if v_amount < v_min_amount then v_amount := v_min_amount; end if;
      -- 确保不超发太多导致最后一个人没钱 (其实 *2 均值法通常安全，但为了绝对安全，限制最大值)
      -- 限制本次最大抢夺金额不能让剩余人分不到 0.01
      if v_remain_amount - v_amount < (v_packet.remaining_count - 1) * v_min_amount then
         v_amount := v_remain_amount - (v_packet.remaining_count - 1) * v_min_amount;
      end if;
    end if;
  end;

  -- 5. 插入记录
  insert into packet_records (packet_id, user_id, username, amount)
  values (p_packet_id, p_user_id, p_username, v_amount);

  -- 6. 更新红包状态
  update redpackets
  set remaining_count = remaining_count - 1,
      is_active = (remaining_count - 1 > 0)
  where id = p_packet_id;

  return jsonb_build_object('success', true, 'data', jsonb_build_object('amount', v_amount));
end;
$$;

grant execute on function grab_packet(uuid, uuid, text) to anon, authenticated, service_role;

-- 4.5 删除分组
create or replace function delete_group(
  p_group_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
as $$
begin
  -- 1. 检查权限
  if not exists (select 1 from groups where id = p_group_id and creator_id = p_user_id) then
    return jsonb_build_object('success', false, 'message', '只有创建者可以删除分组');
  end if;

  -- 2. 删除 (Cascade 会自动删除 members 和 packets)
  delete from groups where id = p_group_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function delete_group(uuid, uuid) to anon, authenticated, service_role;
