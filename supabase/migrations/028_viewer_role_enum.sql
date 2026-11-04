-- 4 Nov 2026: a view-only role for the Customer Service team. Enum values must be committed before they are used, so the
-- functions that use it are in 029.
alter type public.app_role add value if not exists 'viewer';
