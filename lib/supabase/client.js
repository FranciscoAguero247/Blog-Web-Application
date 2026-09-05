import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "./shared.js";

export function createClient() {
  const supabaseEnv = getSupabaseEnv();

  if (!supabaseEnv) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createBrowserClient(supabaseEnv.supabaseUrl, supabaseEnv.supabaseKey);
}