import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Validate environment variables
if (!SUPABASE_URL) {
  if (import.meta.env.DEV) {
    console.error('Missing VITE_SUPABASE_URL environment variable');
  }
}

if (!SUPABASE_PUBLISHABLE_KEY) {
  if (import.meta.env.DEV) {
    console.error('Missing VITE_SUPABASE_PUBLISHABLE_KEY environment variable');
  }
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(
  SUPABASE_URL || '',
  SUPABASE_PUBLISHABLE_KEY || '',
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);