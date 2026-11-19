-- Query 1: Show teachers in Shikshaqmine that don't exist in teachers_list (by slug)
-- These will be inserted by the sync
SELECT 
  s."Slug",
  s."Title" as name,
  'NOT IN TEACHERS_LIST' as status
FROM public."Shikshaqmine" s
WHERE 
  s."Title" IS NOT NULL 
  AND s."Title" != ''
  AND s."Slug" IS NOT NULL 
  AND s."Slug" != ''
  AND NOT EXISTS (
    SELECT 1 FROM public.teachers_list tl 
    WHERE tl.slug = s."Slug"
  )
ORDER BY s."Title";

-- Query 2: Show teachers in teachers_list that don't exist in Shikshaqmine (by slug)
-- These won't be affected by the sync
SELECT 
  tl.slug,
  tl.name,
  'NOT IN SHIKSHAQMINE' as status
FROM public.teachers_list tl
WHERE NOT EXISTS (
  SELECT 1 FROM public."Shikshaqmine" s 
  WHERE s."Slug" = tl.slug
    AND s."Slug" IS NOT NULL
    AND s."Slug" != ''
)
ORDER BY tl.name;

-- Query 3: Summary count of mismatches
SELECT 
  'Total in Shikshaqmine' as category,
  COUNT(*) as count
FROM public."Shikshaqmine"
WHERE "Title" IS NOT NULL AND "Title" != '' AND "Slug" IS NOT NULL AND "Slug" != ''

UNION ALL

SELECT 
  'Total in teachers_list' as category,
  COUNT(*) as count
FROM public.teachers_list

UNION ALL

SELECT 
  'Matching by slug' as category,
  COUNT(*) as count
FROM public."Shikshaqmine" s
INNER JOIN public.teachers_list tl ON s."Slug" = tl.slug
WHERE s."Title" IS NOT NULL AND s."Title" != '' AND s."Slug" IS NOT NULL AND s."Slug" != ''

UNION ALL

SELECT 
  'Slug mismatches' as category,
  COUNT(*) as count
FROM public."Shikshaqmine" s
INNER JOIN public.teachers_list tl ON s."Slug" = tl.slug
WHERE s."Slug" != tl.slug
  AND s."Title" IS NOT NULL AND s."Title" != '' AND s."Slug" IS NOT NULL AND s."Slug" != ''

UNION ALL

SELECT 
  'Name mismatches (same slug)' as category,
  COUNT(*) as count
FROM public."Shikshaqmine" s
INNER JOIN public.teachers_list tl ON s."Slug" = tl.slug
WHERE s."Slug" = tl.slug
  AND LOWER(TRIM(s."Title")) != LOWER(TRIM(tl.name))
  AND s."Title" IS NOT NULL AND s."Title" != '' AND s."Slug" IS NOT NULL AND s."Slug" != ''

UNION ALL

SELECT 
  'In Shikshaqmine but not in teachers_list' as category,
  COUNT(*) as count
FROM public."Shikshaqmine" s
WHERE 
  s."Title" IS NOT NULL 
  AND s."Title" != ''
  AND s."Slug" IS NOT NULL 
  AND s."Slug" != ''
  AND NOT EXISTS (
    SELECT 1 FROM public.teachers_list tl 
    WHERE tl.slug = s."Slug"
  )

UNION ALL

SELECT 
  'In teachers_list but not in Shikshaqmine' as category,
  COUNT(*) as count
FROM public.teachers_list tl
WHERE NOT EXISTS (
  SELECT 1 FROM public."Shikshaqmine" s 
  WHERE s."Slug" = tl.slug
    AND s."Slug" IS NOT NULL
    AND s."Slug" != ''
);

-- Query 4: Detailed comparison with all key fields (for manual review)
SELECT 
  s."Slug",
  s."Title" as shikshaqmine_name,
  tl.name as teachers_list_name,
  s."Hero Image" as shikshaqmine_image,
  tl.image_url as teachers_list_image,
  s."Area" as shikshaqmine_area,
  tl.location as teachers_list_location,
  s."Subjects" as shikshaqmine_subjects,
  tl.subjects as teachers_list_subjects,
  s."Classes Taught" as shikshaqmine_classes,
  tl.classes as teachers_list_classes,
  s."Link" as shikshaqmine_link,
  tl.whatsapp_number as teachers_list_whatsapp,
  CASE 
    WHEN s."Slug" != tl.slug THEN '⚠️ SLUG DIFF'
    WHEN LOWER(TRIM(s."Title")) != LOWER(TRIM(tl.name)) THEN '⚠️ NAME DIFF'
    WHEN COALESCE(s."Hero Image", '') != COALESCE(tl.image_url, '') THEN '⚠️ IMAGE DIFF'
    WHEN COALESCE(s."Area", '') != COALESCE(tl.location, '') 
         AND COALESCE(s."LOCATION V2", '') != COALESCE(tl.location, '') THEN '⚠️ LOCATION DIFF'
    WHEN COALESCE(s."Subjects", '') != COALESCE(tl.subjects, '') THEN '⚠️ SUBJECTS DIFF'
    WHEN COALESCE(s."Classes Taught", '') != COALESCE(tl.classes, '') THEN '⚠️ CLASSES DIFF'
    ELSE '✅ MATCH'
  END as sync_status
FROM public."Shikshaqmine" s
LEFT JOIN public.teachers_list tl ON s."Slug" = tl.slug
WHERE 
  s."Title" IS NOT NULL 
  AND s."Title" != ''
  AND s."Slug" IS NOT NULL 
  AND s."Slug" != ''
ORDER BY 
  CASE 
    WHEN s."Slug" != tl.slug THEN 1
    WHEN LOWER(TRIM(s."Title")) != LOWER(TRIM(tl.name)) THEN 2
    WHEN COALESCE(s."Hero Image", '') != COALESCE(tl.image_url, '') THEN 3
    WHEN COALESCE(s."Area", '') != COALESCE(tl.location, '') 
         AND COALESCE(s."LOCATION V2", '') != COALESCE(tl.location, '') THEN 4
    WHEN COALESCE(s."Subjects", '') != COALESCE(tl.subjects, '') THEN 5
    WHEN COALESCE(s."Classes Taught", '') != COALESCE(tl.classes, '') THEN 6
    ELSE 7
  END,
  s."Title";

