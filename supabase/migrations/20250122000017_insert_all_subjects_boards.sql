-- Insert page content for all subjects and boards
-- This creates entries for all subjects, all boards, and subject+board combinations
-- Content is placeholder text that can be updated later
-- Uses ON CONFLICT DO NOTHING to skip existing entries (e.g., biology, icse)

-- All subjects from subjectMapping.ts
-- Subject pages
INSERT INTO public.page_content (
  page_type,
  subject_slug,
  heading,
  short_content,
  full_content,
  is_active,
  display_order
) VALUES
('subject', 'maths', 'Find the best teachers for you', NULL, 'Find the best Maths teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Mathematics for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'english', 'Find the best teachers for you', NULL, 'Find the best English teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in English for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'physics', 'Find the best teachers for you', NULL, 'Find the best Physics teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Physics for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'chemistry', 'Find the best teachers for you', NULL, 'Find the best Chemistry teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Chemistry for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'biology', 'Find the best teachers for you', NULL, 'Biology is a fascinating subject that explores the living world around us. Our platform connects you with experienced Biology tutors in Kolkata who specialize in various boards including CBSE, ICSE, IGCSE, IB, and State Board. Whether you need help with botany, zoology, cell biology, or preparing for competitive exams like NEET, our verified Biology teachers are here to help you excel.', true, 1),
('subject', 'computer', 'Find the best teachers for you', NULL, 'Find the best Computer teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Computer Science for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'hindi', 'Find the best teachers for you', NULL, 'Find the best Hindi teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Hindi for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'history', 'Find the best teachers for you', NULL, 'Find the best History teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in History & Civics for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'geography', 'Find the best teachers for you', NULL, 'Find the best Geography teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Geography for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'economics', 'Find the best teachers for you', NULL, 'Find the best Economics teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Economics for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'accounts', 'Find the best teachers for you', NULL, 'Find the best Accounts teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Accounts for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'business-studies', 'Find the best teachers for you', NULL, 'Find the best Business Studies teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Business Studies for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'commerce', 'Find the best teachers for you', NULL, 'Find the best Commerce teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Commerce for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'commercial-studies', 'Find the best teachers for you', NULL, 'Find the best Commercial Studies teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Commerce for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'psychology', 'Find the best teachers for you', NULL, 'Find the best Psychology teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Psychology for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'sociology', 'Find the best teachers for you', NULL, 'Find the best Sociology teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Sociology for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'political-science', 'Find the best teachers for you', NULL, 'Find the best Political Science teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Political Science for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'environmental-science', 'Find the best teachers for you', NULL, 'Find the best Environmental Science teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Environmental Science for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'bengali', 'Find the best teachers for you', NULL, 'Find the best Bengali teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Bengali for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'drawing', 'Find the best teachers for you', NULL, 'Find the best Drawing teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in Drawing for various boards including CBSE, ICSE, IGCSE, IB, and State Board.', true, 1),
('subject', 'sat', 'Find the best teachers for you', NULL, 'Find the best SAT teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in SAT preparation.', true, 1),
('subject', 'act', 'Find the best teachers for you', NULL, 'Find the best ACT teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in ACT preparation.', true, 1),
('subject', 'cat', 'Find the best teachers for you', NULL, 'Find the best CAT teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in CAT preparation.', true, 1),
('subject', 'nmat', 'Find the best teachers for you', NULL, 'Find the best NMAT teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in NMAT preparation.', true, 1),
('subject', 'gmat', 'Find the best teachers for you', NULL, 'Find the best GMAT teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in GMAT preparation.', true, 1),
('subject', 'ca', 'Find the best teachers for you', NULL, 'Find the best CA teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in CA preparation.', true, 1),
('subject', 'cfa', 'Find the best teachers for you', NULL, 'Find the best CFA teachers in Kolkata. Our platform connects you with experienced, qualified tutors who specialize in CFA preparation.', true, 1)
ON CONFLICT (page_type, subject_slug, board_slug) 
WHERE is_active = true 
DO NOTHING;

-- All boards from boardMapping.ts
-- Board pages
INSERT INTO public.page_content (
  page_type,
  board_slug,
  heading,
  short_content,
  full_content,
  is_active,
  display_order
) VALUES
('board', 'cbse', 'Find the best teachers for you', NULL, 'The Central Board of Secondary Education (CBSE) is one of the most popular educational boards in India. Our platform features experienced CBSE tutors in Kolkata who understand the board''s teaching methodology and examination pattern. Whether you need help with Mathematics, Science, English, or any other CBSE subject, our verified teachers are equipped to provide quality education tailored to CBSE standards.', true, 1),
('board', 'icse', 'Find the best teachers for you', NULL, 'The Indian Certificate of Secondary Education (ICSE) board is known for its comprehensive curriculum. Our platform features experienced ICSE tutors in Kolkata who understand the board''s unique requirements and examination patterns. Whether you need help with Mathematics, Science, English, or any other ICSE subject, our verified teachers are equipped to provide quality education tailored to ICSE standards.', true, 1),
('board', 'igcse', 'Find the best teachers for you', NULL, 'The International General Certificate of Secondary Education (IGCSE) is a globally recognized curriculum. Our platform features experienced IGCSE tutors in Kolkata who understand the board''s international standards and examination patterns. Whether you need help with Mathematics, Science, English, or any other IGCSE subject, our verified teachers are equipped to provide quality education tailored to IGCSE standards.', true, 1),
('board', 'ib', 'Find the best teachers for you', NULL, 'The International Baccalaureate (IB) program is known for its rigorous and holistic approach to education. Our platform features experienced IB tutors in Kolkata who understand the program''s unique requirements and assessment methods. Whether you need help with Mathematics, Science, English, or any other IB subject, our verified teachers are equipped to provide quality education tailored to IB standards.', true, 1),
('board', 'state', 'Find the best teachers for you', NULL, 'State Board education follows the curriculum set by individual state governments. Our platform features experienced State Board tutors in Kolkata who understand the state-specific curriculum and examination patterns. Whether you need help with Mathematics, Science, English, or any other State Board subject, our verified teachers are equipped to provide quality education tailored to State Board standards.', true, 1)
ON CONFLICT (page_type, subject_slug, board_slug) 
WHERE is_active = true 
DO NOTHING;

-- Note: Subject + Board combinations can be added later as needed
-- Example: INSERT INTO public.page_content (page_type, subject_slug, board_slug, heading, short_content, full_content, is_active, display_order)
-- VALUES ('subject_board', 'biology', 'cbse', 'Find the best teachers for you', NULL, 'Content here...', true, 1);

