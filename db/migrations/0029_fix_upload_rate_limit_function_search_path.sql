-- Pin the trigger function to the only schema it requires for now().
ALTER FUNCTION public.update_upload_rate_limits_updated_at()
  SET search_path = pg_catalog;
