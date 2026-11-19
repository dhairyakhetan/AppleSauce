-- Example inserts for page_content table
-- This file shows how to add content for different page types

-- Example 1: General page content (for /all-tuition-teachers-in-kolkata)
INSERT INTO public.page_content (
  page_type,
  heading,
  short_content,
  full_content,
  is_active,
  display_order
) VALUES (
  'general',
  'Find the best teachers for you',
  NULL,
  'Whether you need help with Mathematics, Science, English, Commerce, or any other subject, our verified teachers are here to help you succeed. All teachers on our platform have been verified and come with student reviews to help you make an informed decision.',
  true,
  1
);

-- Example 2: Subject-specific content (for /biology-tuition-teachers-in-kolkata)
INSERT INTO public.page_content (
  page_type,
  subject_slug,
  heading,
  short_content,
  full_content,
  is_active,
  display_order
) VALUES (
  'subject',
  'biology',
  'Find the best teachers for you',
  NULL,
  'Biology is a fascinating subject that explores the living world around us. Our platform connects you with experienced Biology tutors in Kolkata who specialize in various boards including CBSE, ICSE, IGCSE, IB, and State Board. Whether you need help with botany, zoology, cell biology, or preparing for competitive exams like NEET, our verified Biology teachers are here to help you excel.',
  true,
  1
);

-- Example 3: Board-specific content (for /icse-tuition-teachers-in-kolkata)
INSERT INTO public.page_content (
  page_type,
  board_slug,
  heading,
  short_content,
  full_content,
  is_active,
  display_order
) VALUES (
  'board',
  'icse',
  'Find the best teachers for you',
  NULL,
  'The Indian Certificate of Secondary Education (ICSE) board is known for its comprehensive curriculum. Our platform features experienced ICSE tutors in Kolkata who understand the board''s unique requirements and examination patterns. Whether you need help with Mathematics, Science, English, or any other ICSE subject, our verified teachers are equipped to provide quality education tailored to ICSE standards.',
  true,
  1
);

-- Example 4: Subject + Board combination (for pages with both filters)
INSERT INTO public.page_content (
  page_type,
  subject_slug,
  board_slug,
  heading,
  short_content,
  full_content,
  is_active,
  display_order
) VALUES (
  'subject_board',
  'biology',
  'icse',
  'Find the best teachers for you',
  NULL,
  'ICSE Biology requires a thorough understanding of concepts and detailed coverage of the syllabus. Our ICSE Biology teachers in Kolkata are specially trained to help students understand the comprehensive ICSE curriculum and excel in board examinations. Our verified tutors understand the ICSE examination pattern and can help students prepare effectively for both school exams and competitive exams.',
  true,
  1
);

-- Note: 
-- - subject_slug should match the subject from URL (e.g., 'biology' from /biology-tuition-teachers-in-kolkata)
-- - board_slug should be lowercase: 'icse', 'cbse', 'igcse', 'ib', 'state'
-- - short_content is optional - if NULL, only heading and "Read more" button will show
-- - Set is_active = false to hide content without deleting it
-- - display_order controls the order if multiple content entries exist (lower numbers appear first)

