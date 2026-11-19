-- Migration: Add MOU column to Shikshaqmine table
-- MOU (Memorandum of Understanding) tracks teacher consent for profile display
-- Set all existing teachers to MOU = true (they were added before this requirement)

-- Add MOU column
ALTER TABLE public."Shikshaqmine"
ADD COLUMN IF NOT EXISTS "MOU" BOOLEAN NOT NULL DEFAULT true;

-- Set all existing teachers to MOU = true
-- (They were added before this requirement, so we assume consent)
UPDATE public."Shikshaqmine"
SET "MOU" = true
WHERE "MOU" IS NULL OR "MOU" = false;

-- Add comment for documentation
COMMENT ON COLUMN public."Shikshaqmine"."MOU" IS 'Memorandum of Understanding consent. Indicates teacher has consented to profile display and data usage as per MOU terms.';

