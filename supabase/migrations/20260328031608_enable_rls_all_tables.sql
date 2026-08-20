
-- =============================================
-- ENABLE RLS ON ALL UNPROTECTED TABLES
-- =============================================

-- 1. PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

-- 2. HOUSE_USERS
ALTER TABLE public.house_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "house_users_select" ON public.house_users
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "house_users_insert" ON public.house_users
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = house_id AND hu.user_id = auth.uid() AND hu.role IN ('super_admin','admin'))
  );

CREATE POLICY "house_users_update" ON public.house_users
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = house_users.house_id AND hu.user_id = auth.uid() AND hu.role IN ('super_admin','admin'))
  );

CREATE POLICY "house_users_delete" ON public.house_users
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = house_users.house_id AND hu.user_id = auth.uid() AND hu.role = 'super_admin')
  );

-- 3. CLIENTS (access by house membership)
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select" ON public.clients
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = clients.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

CREATE POLICY "clients_insert" ON public.clients
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = clients.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

CREATE POLICY "clients_update" ON public.clients
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = clients.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

-- 4. CHECKINS
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkins_select" ON public.checkins
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = checkins.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

CREATE POLICY "checkins_insert" ON public.checkins
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = checkins.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

-- 5. FINANCE_ENTRIES
ALTER TABLE public.finance_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance_entries_select" ON public.finance_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = finance_entries.house_id AND hu.user_id = auth.uid() AND hu.is_active = true AND hu.role IN ('super_admin','admin','finance'))
  );

CREATE POLICY "finance_entries_insert" ON public.finance_entries
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = finance_entries.house_id AND hu.user_id = auth.uid() AND hu.is_active = true AND hu.role IN ('super_admin','admin','finance'))
  );

CREATE POLICY "finance_entries_update" ON public.finance_entries
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = finance_entries.house_id AND hu.user_id = auth.uid() AND hu.is_active = true AND hu.role IN ('super_admin','admin','finance'))
  );

-- 6. BIRTHDAY_LISTS
ALTER TABLE public.birthday_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "birthday_lists_select" ON public.birthday_lists
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = birthday_lists.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

CREATE POLICY "birthday_lists_insert" ON public.birthday_lists
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = birthday_lists.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

CREATE POLICY "birthday_lists_update" ON public.birthday_lists
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = birthday_lists.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

-- 7. BIRTHDAY_LIST_GUESTS
ALTER TABLE public.birthday_list_guests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "birthday_list_guests_select" ON public.birthday_list_guests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = birthday_list_guests.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

CREATE POLICY "birthday_list_guests_insert" ON public.birthday_list_guests
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = birthday_list_guests.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

CREATE POLICY "birthday_list_guests_update" ON public.birthday_list_guests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.house_users hu WHERE hu.house_id = birthday_list_guests.house_id AND hu.user_id = auth.uid() AND hu.is_active = true)
  );

-- 8. ESTABLISHMENTS (legacy table - lock down)
ALTER TABLE public.establishments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "establishments_select" ON public.establishments
  FOR SELECT USING (true);

-- 9. SYSTEM_USERS (legacy table - lock down)
ALTER TABLE public.system_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_users_select" ON public.system_users
  FOR SELECT USING (true);
