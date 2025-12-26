-- Create dumps table for capture sessions
CREATE TABLE IF NOT EXISTS public.dumps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source TEXT NOT NULL CHECK (source IN ('voice', 'text')),
    raw_text TEXT NOT NULL,
    transcript TEXT NULL,
    clarified_at TIMESTAMPTZ NULL,
    archived_at TIMESTAMPTZ NULL
);

-- Create dump_items table for items within a dump
CREATE TABLE IF NOT EXISTS public.dump_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dump_id UUID NOT NULL REFERENCES public.dumps(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'promoted', 'snoozed', 'saved', 'trashed')),
    snooze_until TIMESTAMPTZ NULL,
    linked_task_id UUID NULL REFERENCES public.tasks(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dumps_user_id_created_at ON public.dumps(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dumps_user_id_archived_at ON public.dumps(user_id, archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dump_items_dump_id ON public.dump_items(dump_id);
CREATE INDEX IF NOT EXISTS idx_dump_items_status ON public.dump_items(status);
CREATE INDEX IF NOT EXISTS idx_dump_items_linked_task_id ON public.dump_items(linked_task_id) WHERE linked_task_id IS NOT NULL;

-- Enable RLS
ALTER TABLE public.dumps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dump_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for dumps
CREATE POLICY "Users can view their own dumps"
    ON public.dumps FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can create their own dumps"
    ON public.dumps FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own dumps"
    ON public.dumps FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own dumps"
    ON public.dumps FOR DELETE
    USING (user_id = auth.uid());

-- RLS Policies for dump_items
CREATE POLICY "Users can view dump_items for their dumps"
    ON public.dump_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.dumps
            WHERE dumps.id = dump_items.dump_id
            AND dumps.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create dump_items for their dumps"
    ON public.dump_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.dumps
            WHERE dumps.id = dump_items.dump_id
            AND dumps.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update dump_items for their dumps"
    ON public.dump_items FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.dumps
            WHERE dumps.id = dump_items.dump_id
            AND dumps.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete dump_items for their dumps"
    ON public.dump_items FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.dumps
            WHERE dumps.id = dump_items.dump_id
            AND dumps.user_id = auth.uid()
        )
    );


