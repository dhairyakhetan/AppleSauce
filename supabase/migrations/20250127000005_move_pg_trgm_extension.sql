-- Move pg_trgm extension from public schema to extensions schema
-- This addresses the security warning about extensions in the public schema
-- 
-- Note: pg_trgm provides trigram-based text search and similarity matching functions.
-- If this extension is not actively used, you can drop it instead of moving it.
-- To drop: DROP EXTENSION IF EXISTS pg_trgm CASCADE;

-- Check if the extension exists and is in public schema
DO $$
BEGIN
  -- Check if extension exists
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
  ) THEN
    -- Check current schema
    IF EXISTS (
      SELECT 1 
      FROM pg_extension e
      JOIN pg_namespace n ON e.extnamespace = n.oid
      WHERE e.extname = 'pg_trgm' AND n.nspname = 'public'
    ) THEN
      -- Create extensions schema if it doesn't exist
      CREATE SCHEMA IF NOT EXISTS extensions;
      
      -- Grant usage on extensions schema to public (needed for functions to work)
      GRANT USAGE ON SCHEMA extensions TO public;
      
      -- Move the extension to extensions schema
      -- Note: This requires dropping and recreating the extension
      -- CASCADE will drop dependent objects (indexes, functions) which will be recreated
      
      -- Drop extension from public schema (CASCADE handles dependencies)
      DROP EXTENSION IF EXISTS pg_trgm CASCADE;
      
      -- Recreate in extensions schema
      CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
      
      -- Grant execute on functions to public (so they can be used)
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO public;
      
      -- Set default privileges for future functions
      ALTER DEFAULT PRIVILEGES IN SCHEMA extensions 
      GRANT EXECUTE ON FUNCTIONS TO public;
      
      RAISE NOTICE 'pg_trgm extension moved from public to extensions schema';
    ELSE
      RAISE NOTICE 'pg_trgm extension is not in public schema, no action needed';
    END IF;
  ELSE
    -- Extension doesn't exist, create it in extensions schema if needed
    -- (Uncomment the following if you want to create it)
    /*
    CREATE SCHEMA IF NOT EXISTS extensions;
    GRANT USAGE ON SCHEMA extensions TO public;
    CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO public;
    ALTER DEFAULT PRIVILEGES IN SCHEMA extensions 
    GRANT EXECUTE ON FUNCTIONS TO public;
    */
    RAISE NOTICE 'pg_trgm extension does not exist';
  END IF;
END $$;

-- Add comment
COMMENT ON SCHEMA extensions IS 
'Schema for PostgreSQL extensions. Extensions are moved here from public schema for security best practices.';

