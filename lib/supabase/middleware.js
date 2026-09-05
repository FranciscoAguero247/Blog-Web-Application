import { createServerClient } from "@supabase/ssr";

import { getSupabaseEnv, parseCookieHeader } from "./shared.js";

const SUPABASE_AUTH_TIMEOUT_MS = 1500;

function timeout(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function supabaseSessionMiddleware() {
  return async (req, res, next) => {
    try {
      const supabaseEnv = getSupabaseEnv();

      if (!supabaseEnv) {
        return next();
      }

      const supabase = createServerClient(supabaseEnv.supabaseUrl, supabaseEnv.supabaseKey, {
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

      req.supabase = supabase;
      await Promise.race([supabase.auth.getUser(), timeout(SUPABASE_AUTH_TIMEOUT_MS)]);
    } catch (error) {
      // Keep app routes available even if Supabase is temporarily unavailable.
      console.error("Supabase session refresh failed:", error.message);
    }

    return next();
  };
}

export { supabaseSessionMiddleware };