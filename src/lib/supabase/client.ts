
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const CONFIG_KEY = 'selwick_supabase_config';

interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

let cachedClient: SupabaseClient | null = null;
let cachedConfigSignature = '';

/**
 * Reads the Supabase project configured in CloudSyncSettings.
 * Call this from client-side React components only.
 *
 * Returns null if no valid configuration has been saved.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(CONFIG_KEY);

    if (!stored) {
      cachedClient = null;
      cachedConfigSignature = '';
      return null;
    }

    const config = JSON.parse(stored) as Partial<SupabaseConfig>;

    if (
      typeof config.url !== 'string' ||
      typeof config.publishableKey !== 'string' ||
      !config.url.trim() ||
      !config.publishableKey.trim()
    ) {
      return null;
    }

    const url = config.url.trim().replace(/\/+$/, '');
    const publishableKey = config.publishableKey.trim();

    const signature = `${url}|${publishableKey}`;

    // Reuse the client while this project configuration stays unchanged.
    if (cachedClient && cachedConfigSignature === signature) {
      return cachedClient;
    }

    const parsedUrl = new URL(url);

    if (
      parsedUrl.protocol !== 'https:' &&
      !(
        parsedUrl.protocol === 'http:' &&
        (parsedUrl.hostname === 'localhost' ||
          parsedUrl.hostname === '127.0.0.1')
      )
    ) {
      return null;
    }

    cachedClient = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    cachedConfigSignature = signature;

    return cachedClient;
  } catch {
    return null;
  }
}
