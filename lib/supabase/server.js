import { createServerClient } from "@supabase/ssr";

import { getSupabaseEnv, parseCookieHeader } from "./shared.js";

export function createClient(req, res) {
  const supabaseEnv = getSupabaseEnv();

  if (!supabaseEnv) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createServerClient(supabaseEnv.supabaseUrl, supabaseEnv.supabaseKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(req.headers.cookie);
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookie(name, value, options);
        });
      },
    },
  });
}