
REVOKE EXECUTE ON FUNCTION public.recompute_vendor(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_vendor_from_invoice() FROM PUBLIC, anon, authenticated;
