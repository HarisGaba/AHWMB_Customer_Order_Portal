-- Browser push subscriptions for admin devices (new-order alerts).
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text DEFAULT '',
  created_at timestamptz DEFAULT NOW()
);

ALTER TABLE public.push_subscriptions
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Admins manage push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (public.is_ahwmb_admin())
  WITH CHECK (public.is_ahwmb_admin());
