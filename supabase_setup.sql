-- =========================================================
-- Teen Patti Chips - Supabase Database & Realtime Setup
-- Copy and run this entire script in Supabase SQL Editor
-- =========================================================

-- 1. Create Rooms Table
CREATE TABLE IF NOT EXISTS public.rooms (
    code TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- 3. Create Public Policies (Allow read/write by room code)
DROP POLICY IF EXISTS "Public Read Rooms" ON public.rooms;
CREATE POLICY "Public Read Rooms" ON public.rooms
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public Insert Rooms" ON public.rooms;
CREATE POLICY "Public Insert Rooms" ON public.rooms
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public Update Rooms" ON public.rooms;
CREATE POLICY "Public Update Rooms" ON public.rooms
    FOR UPDATE USING (true);

-- 4. Enable Supabase Realtime Replication for 'rooms' table
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;

-- 5. Auto-update timestamp trigger function
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_rooms_modtime ON public.rooms;
CREATE TRIGGER update_rooms_modtime
    BEFORE UPDATE ON public.rooms
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();
