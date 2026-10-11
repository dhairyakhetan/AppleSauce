-- Migration: Add min_fees and max_fees columns to Shikshaqmine table
-- These columns store the teacher's fee range per month (optional)

ALTER TABLE public."Shikshaqmine"
ADD COLUMN IF NOT EXISTS "Min Fees" INTEGER,
ADD COLUMN IF NOT EXISTS "Max Fees" INTEGER;

-- Add comments for documentation
COMMENT ON COLUMN public."Shikshaqmine"."Min Fees" IS 'Minimum fees per month in rupees. Optional field for teachers to specify their fee range.';
COMMENT ON COLUMN public."Shikshaqmine"."Max Fees" IS 'Maximum fees per month in rupees. Optional field for teachers to specify their fee range.';

