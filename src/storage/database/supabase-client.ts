import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

let envLoaded = false;

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

interface SupabaseGlobalOptions {
  headers?: Record<string, string>;
}

function loadEnv(): void {
  if (envLoaded) {
    return;
  }

  dotenv.config();
  envLoaded = true;
}

function readEnv(primaryKey: string, legacyKey: string): string | undefined {
  return process.env[primaryKey] || process.env[legacyKey];
}

function getSupabaseCredentials(): SupabaseCredentials {
  loadEnv();

  const url = readEnv("SUPABASE_URL", "COZE_SUPABASE_URL");
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const anonKey = readEnv("SUPABASE_ANON_KEY", "COZE_SUPABASE_ANON_KEY") || serviceRoleKey;

  if (!url) {
    throw new Error("SUPABASE_URL is not set");
  }

  if (!anonKey) {
    throw new Error("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return { url, anonKey };
}

function getSupabaseServiceRoleKey(): string | undefined {
  loadEnv();
  return readEnv("SUPABASE_SERVICE_ROLE_KEY", "COZE_SUPABASE_SERVICE_ROLE_KEY");
}

function getSupabaseClient(token?: string): SupabaseClient {
  const { url, anonKey } = getSupabaseCredentials();

  const serviceRoleKey = token ? undefined : getSupabaseServiceRoleKey();
  const key = token ? anonKey : serviceRoleKey ?? anonKey;

  const globalOptions: SupabaseGlobalOptions = {};

  if (token) {
    globalOptions.headers = {
      Authorization: `Bearer ${token}`,
    };
  }

  return createClient(url, key, {
    global: globalOptions,
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export {
  loadEnv,
  getSupabaseCredentials,
  getSupabaseServiceRoleKey,
  getSupabaseClient,
};