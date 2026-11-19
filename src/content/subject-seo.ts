/**
 * SUBJECT & BOARD SEO CONTENT
 *
 * Extends the title/description pattern in SubjectPage.tsx (SUBJECT_SEO) and
 * BoardPage.tsx (BOARD_SEO) with genuinely unique per-route prose: an intro
 * paragraph, "what a good tutor covers" bullets, and FAQ pairs shaped for the
 * existing FAQSchema component (src/components/FAQSchema.tsx ->
 * generateFAQPageSchema in src/utils/structuredDataGenerators.ts, which wants
 * { question, answer }[]).
 *
 * Keyed by the same pathname strings used in SUBJECT_SEO / BOARD_SEO so a page
 * component can do SUBJECT_CONTENT[pathname] directly. Not wired into any page
 * yet — this is the content data layer only, per the SEO content-system brief.
 *
 * Word counts (intro paragraph only) target 60-90 words per the brief. Every
 * fact here is either evergreen curriculum/board information or a plain
 * description of what a tutor does — no invented teacher counts, ratings, or
 * statistics (those must come from a live query per the copy guide).
 */

export interface FAQPair {
  question: string;
  answer: string;
}

export interface InternalLink {
  href: string;
  label: string;
}

export interface SubjectContent {
  intro: string;
  covers: string[];
  faqs: FAQPair[];
  internalLinks: InternalLink[];
}

export const SUBJECT_CONTENT: Record<string, SubjectContent> = {
  '/maths-tuition-teachers-in-kolkata': {
    intro:
      'Maths is the subject most Kolkata parents call about first. Across CBSE, ICSE and the West Bengal board, Class 9-12 maths moves fast, from algebra and trigonometry to calculus and coordinate geometry, and a gap in one chapter compounds into the next. Board exams weight step-marking heavily, so students often understand a concept but still lose marks on presentation. A tutor who drills method, not just answers, is what closes that gap.',
    covers: [
      'Board-specific weightage: ICSE\'s two-mark structure, CBSE\'s case-study questions, WB board\'s long-answer format',
      'Algebra through Class 10: quadratic equations, arithmetic progressions, coordinate geometry',
      'Class 11-12 calculus: limits, differentiation, integration, and application-based problems',
      'Trigonometry and mensuration with the step-by-step working boards actually award marks for',
      'Mental-maths speed for competitive-exam-track students alongside board syllabus',
      'Past-paper practice timed to the actual exam duration, not just untimed problem sets',
    ],
    faqs: [
      {
        question: 'What class levels do maths tutors in Kolkata usually teach?',
        answer: 'Most maths tutors on Shikshaq cover Classes 6 to 12, with the bulk of demand in Class 9-12 where board exams and, for some students, JEE preparation overlap. Filter by class on this page to see who teaches your child\'s exact level.',
      },
      {
        question: 'Is CBSE maths tuition different from ICSE maths tuition?',
        answer: 'The core topics overlap heavily, but ICSE goes deeper into proof-based geometry and its exams reward detailed working, while CBSE has moved toward case-study and application questions. A tutor experienced with your specific board will pace lessons around that exam format.',
      },
      {
        question: 'Can I find a maths tutor near Ballygunge or Salt Lake specifically?',
        answer: 'Yes. Use the area filter on this page to narrow results to a locality, or search for home tuition near a specific neighbourhood. Teachers list the areas they travel to.',
      },
    ],
    internalLinks: [
      { href: '/physics-tuition-teachers-in-kolkata', label: 'Physics tutors' },
      { href: '/cat-tuition-teachers-in-kolkata', label: 'CAT quantitative aptitude tutors' },
      { href: '/all-tuition-teachers-in-kolkata', label: 'browse all subjects' },
    ],
  },

  '/english-tuition-teachers-in-kolkata': {
    intro:
      'English tuition in Kolkata covers two quite different demands: language mechanics (grammar, comprehension, writing) for younger students, and literature analysis for Class 9-12 boards where set texts, unseen passages and long-format essays are marked on structure as much as content. ICSE and CBSE English papers differ in how much weight they give to literature versus functional writing, so a tutor who has actually taught your board\'s paper pattern saves months of guesswork.',
    covers: [
      'Grammar and comprehension fundamentals for Classes 6-8',
      'Literature set texts: poetry, drama and prose analysis for board exam years',
      'Formal and informal writing: letters, articles, reports, and the notice/email formats boards test',
      'Unseen passage comprehension under exam time pressure',
      'Spoken English and pronunciation for students who need conversational confidence, not just exam marks',
      'Essay structuring that matches ICSE\'s literary-analysis style or CBSE\'s value-based writing prompts',
    ],
    faqs: [
      {
        question: 'Do English tutors in Kolkata teach spoken English too?',
        answer: 'Many do, alongside academic English. If you specifically need conversational or spoken-English coaching rather than board exam prep, mention that when you contact a teacher, and most tutors adjust their approach for it.',
      },
      {
        question: 'How is ICSE English different from CBSE English for tuition purposes?',
        answer: 'ICSE splits English into two papers (Language and Literature) with heavier literary analysis, while CBSE combines grammar, writing and a shorter literature component. A tutor who knows your board\'s exact paper split will plan lessons more efficiently than a generalist.',
      },
      {
        question: 'Can a tutor help with English for competitive exams like SAT or ACT?',
        answer: 'For SAT/ACT-specific English (reading, writing and language sections), check the dedicated SAT tuition and ACT tuition pages, which list tutors who specialise in that test format rather than school-board English.',
      },
    ],
    internalLinks: [
      { href: '/sat-tuition-teachers-in-kolkata', label: 'SAT tutors' },
      { href: '/bengali-tuition-teachers-in-kolkata', label: 'Bengali language tutors' },
      { href: '/hindi-tuition-teachers-in-kolkata', label: 'Hindi tutors' },
    ],
  },

  '/science-tuition-teachers-in-kolkata': {
    intro:
      'Science tuition on this page covers Physics, Chemistry and Biology together, which is what most Class 6-8 students need before the subjects split apart in Class 9. At that split point, a family choosing science stream should decide whether they need one integrated science tutor for junior classes or separate subject specialists for Class 9-12, where physics, chemistry and biology are taught, and examined, as three distinct papers.',
    covers: [
      'Integrated science for Classes 6-8: physics, chemistry and biology as one combined subject',
      'The physics-chemistry-biology split explained for parents choosing a Class 9 stream',
      'Lab-based practical understanding, not just theory, for concepts like reactions and forces',
      'NCERT and ICSE science textbook alignment for junior classes',
      'A bridge to single-subject tutoring once a student reaches Class 9 and needs a physics or chemistry specialist',
    ],
    faqs: [
      {
        question: 'Should I look for a Science tutor or a Physics/Chemistry/Biology tutor?',
        answer: 'For Classes 6-8, where the three subjects are taught together, a Science tutor is usually right. From Class 9 onward, when boards examine physics, chemistry and biology separately, most families switch to subject specialists. See the Physics, Chemistry and Biology tuition pages.',
      },
      {
        question: 'Does this page include Physics, Chemistry and Biology tutors?',
        answer: 'Yes, results here include teachers who list any of Physics, Chemistry or Biology. If you already know your child needs one specific subject at Class 9-12 level, the dedicated Physics, Chemistry or Biology page will narrow results faster.',
      },
      {
        question: 'What boards teach an integrated Science subject in Kolkata?',
        answer: 'CBSE, ICSE and the West Bengal board all teach combined science through Class 8, with WB board extending it slightly longer for some schools before the Class 9 split into separate subjects.',
      },
    ],
    internalLinks: [
      { href: '/physics-tuition-teachers-in-kolkata', label: 'Physics tutors' },
      { href: '/chemistry-tuition-teachers-in-kolkata', label: 'Chemistry tutors' },
      { href: '/biology-tuition-teachers-in-kolkata', label: 'Biology tutors' },
    ],
  },

  '/physics-tuition-teachers-in-kolkata': {
    intro:
      'Physics at Class 9-12 level is where numerical problem-solving becomes the whole game: mechanics, electricity, optics and modern physics, each demanding both a clear grasp of formulae and the ability to apply them under exam conditions. Kolkata students preparing for JEE or NEET alongside board exams need a tutor who can teach the same chapter at two speeds, board depth for school marks and problem-solving speed for competitive exams.',
    covers: [
      'Mechanics: laws of motion, work-energy-power, and rotational motion for Class 11-12',
      'Electricity and magnetism: circuits, electromagnetic induction, and the numerical-heavy problems boards favour',
      'Optics and wave physics, including ray diagrams that ICSE and CBSE both test closely',
      'Modern physics: atomic structure, semiconductors, and dual nature of matter for Class 12',
      'JEE/NEET-level numerical practice for students on a competitive-exam track alongside boards',
      'Practical/lab viva preparation where the board requires it',
    ],
    faqs: [
      {
        question: 'Can a physics tutor prepare my child for both boards and JEE?',
        answer: 'Yes, many physics tutors in Kolkata teach both tracks, but the pacing differs: board prep is chapter-complete and exam-format focused, while JEE prep needs faster numerical problem-solving across a wider question bank. Ask a teacher directly which mix they specialise in.',
      },
      {
        question: 'What class levels need physics tuition most in Kolkata?',
        answer: 'Demand is highest in Class 11-12, when physics becomes numerically heavier and directly feeds into JEE and NEET preparation, though Class 9-10 students preparing for ICSE or CBSE board exams also commonly take physics tuition.',
      },
      {
        question: 'Is physics tuition different for ICSE versus CBSE students?',
        answer: 'ICSE physics tends to go deeper into derivations and numerical rigour at Class 10, while CBSE places more weight on NCERT-aligned application questions. A tutor familiar with your board\'s exact textbook will match the exam style more closely.',
      },
    ],
    internalLinks: [
      { href: '/chemistry-tuition-teachers-in-kolkata', label: 'Chemistry tutors' },
      { href: '/maths-tuition-teachers-in-kolkata', label: 'Maths tutors' },
      { href: '/science-tuition-teachers-in-kolkata', label: 'combined Science tutors' },
    ],
  },

  '/chemistry-tuition-teachers-in-kolkata': {
    intro:
      'Chemistry splits into three distinct habits of thinking, organic (mechanism and naming), inorganic (memorisation and periodic trends) and physical (numerical, formula-driven), and students often struggle with one while doing fine in the other two. Class 11-12 chemistry in Kolkata also doubles as NEET and JEE prep for many students, so a tutor needs to balance board-format answers with the faster recall competitive exams demand.',
    covers: [
      'Organic chemistry: reaction mechanisms, naming conventions, and the named reactions boards test repeatedly',
      'Inorganic chemistry: periodic trends, coordination compounds, and structured memorisation techniques',
      'Physical chemistry: mole concept, thermodynamics, and equilibrium numericals',
      'Practical and viva preparation for ICSE and CBSE lab-based assessment',
      'NEET/JEE-level rapid-recall practice for organic name reactions and inorganic facts',
      'Balancing equations and stoichiometry from the fundamentals up for students who fell behind early',
    ],
    faqs: [
      {
        question: 'Does chemistry tuition cover NEET preparation as well as boards?',
        answer: 'Many chemistry tutors in Kolkata teach both, since Class 11-12 chemistry syllabus overlaps closely with NEET and JEE. Confirm with the teacher whether they run board-pace or NEET-pace sessions, or a combined track.',
      },
      {
        question: 'My child is weak specifically in organic chemistry. Can I find a tutor for that?',
        answer: 'Yes. When you contact a teacher through Shikshaq, mention the specific area, organic reaction mechanisms, for example, and ask whether they focus lessons accordingly rather than re-teaching the full syllabus.',
      },
      {
        question: 'What boards does chemistry tuition on this page cover?',
        answer: 'Teachers listed here teach CBSE, ICSE, IGCSE and West Bengal state board chemistry. Use the board filter on this page to narrow results to your child\'s exact curriculum.',
      },
    ],
    internalLinks: [
      { href: '/physics-tuition-teachers-in-kolkata', label: 'Physics tutors' },
      { href: '/biology-tuition-teachers-in-kolkata', label: 'Biology tutors' },
      { href: '/science-tuition-teachers-in-kolkata', label: 'combined Science tutors' },
    ],
  },

  '/biology-tuition-teachers-in-kolkata': {
    intro:
      'Biology tuition in Kolkata splits broadly into two demands: Class 9-10 board biology, which is diagram-heavy and definition-precise, and Class 11-12 biology, which adds genetics, physiology and ecology at a depth aimed squarely at NEET. A tutor who understands NCERT\'s exact line-by-line phrasing matters here more than in most subjects, since NEET and many boards mark against textbook wording.',
    covers: [
      'Diagram-based learning: cell structure, human physiology, and plant biology with labelled diagrams boards expect',
      'Genetics and evolution for Class 12, including numerical genetics problems',
      'Human physiology systems: digestive, circulatory, nervous and reproductive, at board depth',
      'NEET-aligned NCERT-line recall for students on a medical entrance track',
      'Ecology and environmental biology for board exam years',
      'Practical/lab diagram practice where the board requires a viva component',
    ],
    faqs: [
      {
        question: 'Is biology tuition here focused on boards or NEET?',
        answer: 'Both. Class 11-12 biology tutors on Shikshaq commonly teach board syllabus and NEET-level depth together, since the NCERT textbook underlies both. Ask a specific teacher which they emphasise if your child has one clear goal.',
      },
      {
        question: 'What class levels are most common for biology tuition in Kolkata?',
        answer: 'Class 9-10 for board exam preparation, and Class 11-12 heavily for NEET-track students, are the two biggest groups. Junior-level biology is usually covered under combined Science tuition instead.',
      },
      {
        question: 'Do biology tutors help with diagram practice, not just theory?',
        answer: 'Most do, since boards and NEET both grade labelled diagrams closely. Mention diagram practice specifically when you reach out to a teacher if that is where your child is losing marks.',
      },
    ],
    internalLinks: [
      { href: '/chemistry-tuition-teachers-in-kolkata', label: 'Chemistry tutors' },
      { href: '/physics-tuition-teachers-in-kolkata', label: 'Physics tutors' },
      { href: '/science-tuition-teachers-in-kolkata', label: 'combined Science tutors' },
    ],
  },

  '/computer-tuition-teachers-in-kolkata': {
    intro:
      'Computer tuition here spans two different needs, school-curriculum computer science (Python or Java-based programming for CBSE, ICSE and IGCSE boards) and standalone coding skills for students who want to learn beyond the syllabus. Board computer science exams test both theory (data structures, SQL) and practical programming, so a tutor needs to be comfortable in both a classroom explanation and an actual coding session.',
    covers: [
      'Python programming for CBSE Class 11-12 Computer Science, including the practical file and project component',
      'Java-based programming for ICSE Computer Applications',
      'Fundamentals of databases and SQL as tested at board level',
      'Logic-building and algorithmic thinking for younger students starting out in coding',
      'IT fundamentals and basic computer literacy for junior classes',
    ],
    faqs: [
      {
        question: 'Does computer tuition cover both Python and Java?',
        answer: 'Yes, tutors on this page teach across languages depending on the board, CBSE Computer Science commonly uses Python, ICSE Computer Applications uses Java. Check with a teacher which language they cover before booking.',
      },
      {
        question: 'Can I find a tutor for coding outside the school syllabus?',
        answer: 'Some teachers listed here teach general programming or coding fundamentals beyond board requirements. Mention your goal, syllabus-based or independent coding skills, when you contact a tutor.',
      },
      {
        question: 'Is this the right page for JEE or CAT quantitative coding topics?',
        answer: 'No, this page is school-curriculum computer science. For competitive exams see the CAT tuition page for quantitative aptitude, which is a different skill set from programming.',
      },
    ],
    internalLinks: [
      { href: '/maths-tuition-teachers-in-kolkata', label: 'Maths tutors' },
      { href: '/cat-tuition-teachers-in-kolkata', label: 'CAT tutors' },
      { href: '/all-tuition-teachers-in-kolkata', label: 'browse all subjects' },
    ],
  },

  '/hindi-tuition-teachers-in-kolkata': {
    intro:
      'Hindi is a second or third language for most Kolkata board students, taught alongside English and often Bengali, and the exam demands, grammar (vyakaran), comprehension (apathit gadyansh), and letter or essay writing, differ meaningfully by board. CBSE and ICSE both offer Hindi as Course A or Course B depending on the school, and getting that distinction right early avoids a mismatch between tutor and syllabus.',
    covers: [
      'Vyakaran (grammar): sandhi, samas, and the grammar rules boards test directly',
      'Comprehension passages (apathit gadyansh) with the answer-format boards expect',
      'Letter writing (patra lekhan) and essay writing (nibandh) formats',
      'Literature portions where the board includes prescribed Hindi texts',
      'Course A versus Course B pacing depending on which the student\'s school follows',
    ],
    faqs: [
      {
        question: 'What is the difference between Hindi Course A and Course B?',
        answer: 'Course B is designed for students with less prior Hindi exposure and is somewhat less demanding than Course A. Check with your child\'s school which course they are enrolled in, then confirm with a tutor that they teach that specific course.',
      },
      {
        question: 'Do Hindi tutors in Kolkata teach both CBSE and ICSE syllabi?',
        answer: 'Many do, since the core language skills overlap, though the exact grammar terminology and marking scheme differ. Use the board filter on this page to find a tutor matched to your child\'s board.',
      },
      {
        question: 'Is spoken Hindi taught here or only exam-focused Hindi?',
        answer: 'This page is primarily for school-board Hindi tuition. If you need conversational or spoken Hindi coaching outside a school syllabus, mention that directly to a teacher when you get in touch.',
      },
    ],
    internalLinks: [
      { href: '/bengali-tuition-teachers-in-kolkata', label: 'Bengali tutors' },
      { href: '/english-tuition-teachers-in-kolkata', label: 'English tutors' },
      { href: '/cbse-ncert-tuition-teachers-in-kolkata', label: 'CBSE tutors' },
    ],
  },

  '/history-tuition-teachers-in-kolkata': {
    intro:
      'History tuition in Kolkata is usually paired with Civics under one subject, History & Civics, through Class 10, before splitting into standalone History (and separately, Political Science) at Class 11-12 for humanities-stream students. The subject rewards structured answer-writing, dates, causes and consequences laid out clearly, more than rote memorisation, which is where a tutor\'s guidance on exam technique matters as much as content knowledge.',
    covers: [
      'Indian history: freedom movement, colonial period, and post-independence India as tested at board level',
      'World history topics where the board syllabus includes them (world wars, key global events)',
      'Civics: the Constitution, government structures, and citizenship, bundled with history through Class 10',
      'Answer-writing technique: structuring long-answer history responses for maximum step-marks',
      'Timeline and map-based questions that ICSE in particular tests closely',
    ],
    faqs: [
      {
        question: 'Is Civics included in History tuition or is it separate?',
        answer: 'Through Class 10, most boards teach History & Civics as one combined subject, and tutors on this page cover both. From Class 11, Civics-related content moves into a separate Political Science subject for humanities students.',
      },
      {
        question: 'Does history tuition include map work?',
        answer: 'Yes, map-based questions are a standard part of ICSE and CBSE history papers, and tutors typically include map practice as part of exam preparation.',
      },
      {
        question: 'What is the difference between this page and Social Studies tuition?',
        answer: 'This page is specifically History (and Civics through Class 10). The Social Studies page covers both History and Geography together, which suits younger students whose schools still teach the two as one combined subject.',
      },
    ],
    internalLinks: [
      { href: '/geography-tuition-teachers-in-kolkata', label: 'Geography tutors' },
      { href: '/political-science-tuition-teachers-in-kolkata', label: 'Political Science tutors' },
      { href: '/social-studies-tuition-teachers-in-kolkata', label: 'Social Studies tutors' },
    ],
  },

  '/geography-tuition-teachers-in-kolkata': {
    intro:
      'Geography tuition covers physical geography (landforms, climate, weather systems) and human geography (population, agriculture, resources), taught together through Class 10 and often continuing as a humanities elective at Class 11-12. Map-reading and map-marking are graded skills in their own right on ICSE and CBSE papers, so practice with actual outline maps matters as much as reading the textbook chapters.',
    covers: [
      'Physical geography: landforms, climate, and weather systems for board exam years',
      'Human geography: population studies, agriculture, and resource distribution',
      'Map-reading and map-marking practice, a distinct graded skill on ICSE and CBSE papers',
      'India-specific geography: rivers, states, and economic geography as tested at board level',
      'Case-study based questions that CBSE increasingly favours over pure recall',
    ],
    faqs: [
      {
        question: 'Does geography tuition include practical map work?',
        answer: 'Yes, map-marking is a core, separately graded part of ICSE and CBSE geography papers, and most tutors on this page include dedicated map practice alongside the theory portions.',
      },
      {
        question: 'What class levels take geography tuition most in Kolkata?',
        answer: 'Class 9-10, when geography is examined at full board weightage, sees the most demand. Some Class 11-12 humanities-stream students continue geography as an elective and also seek tuition.',
      },
      {
        question: 'Is Geography different from Social Studies on Shikshaq?',
        answer: 'Geography here is the standalone subject. Social Studies tuition covers both Geography and History together, which fits younger students whose school still teaches the two combined.',
      },
    ],
    internalLinks: [
      { href: '/history-tuition-teachers-in-kolkata', label: 'History tutors' },
      { href: '/social-studies-tuition-teachers-in-kolkata', label: 'Social Studies tutors' },
      { href: '/environmental-science-tuition-teachers-in-kolkata', label: 'Environmental Science tutors' },
    ],
  },

  '/economics-tuition-teachers-in-kolkata': {
    intro:
      'Economics at Class 11-12 introduces students to a genuinely new way of thinking, graphs, elasticity, national income accounting, that most students have not encountered in earlier commerce or humanities subjects. It is also one of the more numerically demanding humanities/commerce subjects, mixing theory questions with diagram-based and numerical problems, so a tutor needs to teach both the concept and how to show working for marks.',
    covers: [
      'Microeconomics: demand, supply, elasticity, and market structures with diagram-based questions',
      'Macroeconomics: national income, money and banking, and government budget for Class 12',
      'Numerical problems: index numbers, national income calculations, and the working boards mark closely',
      'Indian economic development topics as covered in the CBSE and ICSE syllabus',
      'Graph-drawing and labelling technique, a distinct skill boards grade separately from the answer text',
    ],
    faqs: [
      {
        question: 'Is economics tuition useful for CAT or other MBA entrance prep too?',
        answer: 'School-board economics builds useful foundational concepts, but CAT tests quantitative aptitude, verbal ability and logical reasoning specifically. For direct CAT preparation, see the dedicated CAT tuition page.',
      },
      {
        question: 'Does economics tuition cover both micro and macro topics?',
        answer: 'Yes, Class 11 is largely microeconomics and Class 12 largely macroeconomics under CBSE and ICSE, and tutors on this page typically teach across both years.',
      },
      {
        question: 'How numerical is Class 11-12 economics really?',
        answer: 'More than most students expect. Index numbers, national income calculations and elasticity problems all require shown working, similar in style to a maths answer, which is why a tutor comfortable with both the theory and the numbers helps.',
      },
    ],
    internalLinks: [
      { href: '/accounts-tuition-teachers-in-kolkata', label: 'Accounts tutors' },
      { href: '/business-studies-tuition-teachers-in-kolkata', label: 'Business Studies tutors' },
      { href: '/commerce-tuition-teachers-in-kolkata', label: 'Commerce tutors' },
    ],
  },

  '/accounts-tuition-teachers-in-kolkata': {
    intro:
      'Accounts (Accountancy) at Class 11-12 is procedural in a way most other subjects are not: journal entries, ledgers, trial balances and final accounts each follow a fixed method, and marks are lost through small procedural slips rather than conceptual gaps. It is also the subject most directly useful for students planning to pursue CA afterward, so many families look for a tutor who can bridge board accounts into CA Foundation groundwork.',
    covers: [
      'Journal entries, ledger posting, and trial balance, the procedural backbone of Class 11 accounts',
      'Final accounts: trading, profit and loss, and balance sheet preparation',
      'Partnership accounting: admission, retirement, and dissolution for Class 12',
      'Company accounts and financial statement analysis where the board syllabus includes it',
      'Common procedural errors that cost marks even when the concept is understood',
    ],
    faqs: [
      {
        question: 'Can an accounts tutor also help prepare for CA Foundation?',
        answer: 'Some tutors bridge Class 12 accountancy into CA Foundation-level accounting, since the fundamentals overlap. For a CA-specific track including law and other CA Foundation subjects, also check the dedicated CA tuition page.',
      },
      {
        question: 'Is Accounts the same as Commerce tuition on Shikshaq?',
        answer: 'No, Accounts is one component of the commerce stream. The Commerce tuition page covers Accounts, Economics and Business Studies together, useful if your child needs help across the whole stream rather than one subject.',
      },
      {
        question: 'What class levels need accounts tuition in Kolkata?',
        answer: 'Almost entirely Class 11-12, since Accountancy is introduced as a commerce-stream subject at that stage under CBSE, ICSE and the West Bengal board.',
      },
    ],
    internalLinks: [
      { href: '/commerce-tuition-teachers-in-kolkata', label: 'Commerce tutors' },
      { href: '/ca-tuition-teachers-in-kolkata', label: 'CA tutors' },
      { href: '/business-studies-tuition-teachers-in-kolkata', label: 'Business Studies tutors' },
    ],
  },

  '/business-studies-tuition-teachers-in-kolkata': {
    intro:
      'Business Studies at Class 11-12 is theory-heavy and definition-precise: principles of management, business environment, marketing and financial management each carry specific textbook definitions that boards expect near-verbatim in answers. Unlike Accounts, there is little numerical work here, the challenge is structuring long, multi-point answers clearly and covering every part of a question, which is where guided practice makes the biggest difference.',
    covers: [
      'Principles and functions of management: planning, organising, staffing, and controlling',
      'Business environment and forms of business organisation for Class 11',
      'Marketing management and consumer protection topics as tested at board level',
      'Financial management and financial markets for Class 12',
      'Answer-structuring technique for the multi-point, definition-based questions this subject favours',
    ],
    faqs: [
      {
        question: 'Is Business Studies mostly theory or does it involve numericals?',
        answer: 'Mostly theory and definitions, with far fewer numerical problems than Accounts or Economics. The skill boards reward here is precise, well-structured written answers rather than calculation.',
      },
      {
        question: 'Does Business Studies tuition overlap with Commercial Studies?',
        answer: 'They are related but distinct: ICSE\'s "Commercial Studies" (Class 9-10) is a broader introduction to business and commerce, while Business Studies proper is the Class 11-12 CBSE/ICSE commerce-stream subject. Check the Commercial Studies page if your child is at Class 9-10 ICSE level.',
      },
      {
        question: 'Can I find a Business Studies tutor for both CBSE and ICSE?',
        answer: 'Yes, use the board filter on this page. The syllabus structure is broadly similar across boards, though the exact chapter sequencing and marking scheme differ.',
      },
    ],
    internalLinks: [
      { href: '/commerce-tuition-teachers-in-kolkata', label: 'Commerce tutors' },
      { href: '/commercial-studies-tuition-teachers-in-kolkata', label: 'Commercial Studies tutors' },
      { href: '/accounts-tuition-teachers-in-kolkata', label: 'Accounts tutors' },
    ],
  },

  '/commerce-tuition-teachers-in-kolkata': {
    intro:
      'Commerce tuition on this page is for families who need coverage across the whole Class 11-12 commerce stream, Accounts, Economics and Business Studies together, rather than a single-subject specialist. This suits students in the first months of Class 11 who are still finding their footing across all three subjects, or those who want one tutor managing the stream holistically instead of three separate teachers.',
    covers: [
      'Accountancy fundamentals: journal entries through final accounts',
      'Business Studies: management principles and business environment',
      'Economics basics as they apply to commerce-stream students',
      'Cross-subject exam strategy for managing three commerce papers in one board cycle',
      'A single point of contact for parents who prefer one tutor across the stream rather than three',
    ],
    faqs: [
      {
        question: 'Does one Commerce tutor really cover Accounts, Economics and Business Studies?',
        answer: 'Some do, particularly for Class 11 where the subjects are still foundational. For focused, exam-stage depth in one subject, the dedicated Accounts, Economics or Business Studies pages will have specialists in that single subject.',
      },
      {
        question: 'Is Commerce tuition the same as Commercial Studies?',
        answer: 'They sound similar but serve different levels: Commerce here means the Class 11-12 stream (Accounts, Economics, Business Studies). Commercial Studies is an ICSE Class 9-10 subject that introduces business concepts before the stream split. See the Commercial Studies page if your child is at that earlier level.',
      },
      {
        question: 'What board does this Commerce tuition page cover?',
        answer: 'Teachers listed here teach commerce-stream subjects across CBSE, ICSE and West Bengal state board. Use the board filter to narrow to your child\'s specific curriculum.',
      },
    ],
    internalLinks: [
      { href: '/accounts-tuition-teachers-in-kolkata', label: 'Accounts tutors' },
      { href: '/business-studies-tuition-teachers-in-kolkata', label: 'Business Studies tutors' },
      { href: '/economics-tuition-teachers-in-kolkata', label: 'Economics tutors' },
    ],
  },

  '/commercial-studies-tuition-teachers-in-kolkata': {
    intro:
      'Commercial Studies is an ICSE-specific Class 9-10 subject, an early, practical introduction to business, trade and commercial life before students choose a commerce, science or humanities stream at Class 11. It sits earlier and broader than Business Studies proper, covering topics like consumer awareness, banking basics and elements of commerce in simpler form. On Shikshaq, this page and Commerce tuition are matched to the same pool of commerce-background teachers, since both draw on the same subject expertise even though the levels differ.',
    covers: [
      'Elements of commerce: trade, aids to trade, and commercial documents',
      'Consumer awareness and consumer protection basics for ICSE Class 9-10',
      'Introductory banking and money concepts',
      'Business organisation basics as a precursor to Class 11 Business Studies',
      'ICSE-specific paper format and internal assessment components',
    ],
    faqs: [
      {
        question: 'Is Commercial Studies the same subject as Business Studies?',
        answer: 'No. Commercial Studies is ICSE\'s Class 9-10 subject, an introductory look at commerce and trade. Business Studies is the more advanced Class 11-12 CBSE/ICSE commerce-stream subject. A student typically studies Commercial Studies first, then moves to Business Studies if they choose commerce at Class 11.',
      },
      {
        question: 'Why do Commercial Studies and Commerce tuition show similar tutors?',
        answer: 'Both draw on the same commerce-background teaching expertise, even though Commercial Studies is a Class 9-10 ICSE subject and Commerce tuition covers the Class 11-12 stream. If your child is specifically at Class 9-10 ICSE level, mention that to the teacher so lessons target the right syllabus.',
      },
      {
        question: 'Which board offers Commercial Studies?',
        answer: 'Commercial Studies is specific to the ICSE board at Class 9-10. CBSE and the West Bengal board do not offer an equivalent subject by that name at that level.',
      },
    ],
    internalLinks: [
      { href: '/commerce-tuition-teachers-in-kolkata', label: 'Commerce tutors' },
      { href: '/business-studies-tuition-teachers-in-kolkata', label: 'Business Studies tutors' },
      { href: '/icse-tuition-teachers-in-kolkata', label: 'ICSE tutors' },
    ],
  },

  '/psychology-tuition-teachers-in-kolkata': {
    intro:
      'Psychology as a school subject, offered mainly under CBSE and IB at Class 11-12, introduces students to research methods, developmental psychology and behavioural theory, a genuinely different discipline from anything in the science or commerce streams. Because fewer schools offer it and fewer teachers specialise in it, finding a tutor who has actually taught the specific board syllabus matters more here than in mainstream subjects.',
    covers: [
      'Research methods and psychological testing basics as introduced at Class 11',
      'Developmental psychology and the stages of human development',
      'Theories of learning, motivation and emotion for Class 12',
      'Case-study analysis, a format CBSE psychology papers use heavily',
      'IB Psychology\'s biological, cognitive and sociocultural approaches, where applicable',
    ],
    faqs: [
      {
        question: 'Which boards offer Psychology at school level in Kolkata?',
        answer: 'CBSE offers Psychology as a Class 11-12 elective, and IB Diploma includes Psychology as a group 3 subject. It is not commonly offered under ICSE or the West Bengal state board at school level.',
      },
      {
        question: 'Is school Psychology the same as college-level psychology?',
        answer: 'It covers similar foundational areas, research methods, developmental and behavioural theory, but at introductory depth suited to Class 11-12, preparing students who may go on to study psychology at undergraduate level.',
      },
      {
        question: 'Do Psychology tutors help with case-study based answers?',
        answer: 'Yes, CBSE Psychology papers lean heavily on case-study analysis, and tutors on this page typically build that answer format into lesson practice rather than pure theory recall.',
      },
    ],
    internalLinks: [
      { href: '/sociology-tuition-teachers-in-kolkata', label: 'Sociology tutors' },
      { href: '/political-science-tuition-teachers-in-kolkata', label: 'Political Science tutors' },
      { href: '/international-board-tuition-teachers-in-kolkata', label: 'IB tutors' },
    ],
  },

  '/sociology-tuition-teachers-in-kolkata': {
    intro:
      'Sociology at Class 11-12, offered mainly under CBSE, examines social institutions, culture and social change in India, a subject that rewards clear conceptual writing and the ability to relate theory to real Indian social examples. It is a smaller-enrolment subject than history or political science, so families often need to search a little more specifically for a tutor with direct sociology teaching experience.',
    covers: [
      'Basic concepts: society, culture, socialisation, and social institutions for Class 11',
      'Social change and social order in India for Class 12',
      'Environment and society, and the challenges of unequal development in India',
      'Structured essay-writing that connects sociological theory to real Indian examples',
      'CBSE\'s specific case-study and short-answer question formats',
    ],
    faqs: [
      {
        question: 'Which board offers Sociology in Kolkata schools?',
        answer: 'Sociology as a distinct school subject is offered mainly under CBSE at Class 11-12 as a humanities elective. It is less commonly available under ICSE or the West Bengal state board.',
      },
      {
        question: 'Is Sociology tuition similar to Political Science tuition?',
        answer: 'Both are humanities subjects and share some overlap in discussing Indian society and institutions, but Sociology focuses on social structures and change while Political Science focuses on governance and political theory. They are separate CBSE subjects with separate papers.',
      },
      {
        question: 'What kind of answers does CBSE Sociology reward?',
        answer: 'Structured, example-driven answers that connect theoretical concepts to real social situations in India tend to score well. A tutor experienced with the subject will practise this style of writing specifically, not just concept recall.',
      },
    ],
    internalLinks: [
      { href: '/political-science-tuition-teachers-in-kolkata', label: 'Political Science tutors' },
      { href: '/psychology-tuition-teachers-in-kolkata', label: 'Psychology tutors' },
      { href: '/history-tuition-teachers-in-kolkata', label: 'History tutors' },
    ],
  },

  '/political-science-tuition-teachers-in-kolkata': {
    intro:
      'Political Science at Class 11-12 covers the Indian Constitution, political theory and international relations, building on the Civics foundation students get through Class 10 History & Civics. It is a common choice for humanities-stream students, and also useful groundwork for those later preparing for CLAT or civil-services-track exams, so a tutor who can connect textbook theory to current governance examples tends to be the most effective.',
    covers: [
      'Political theory: democracy, rights, and citizenship for Class 11',
      'The Indian Constitution: structure, federalism, and government institutions',
      'International relations and India\'s foreign policy for Class 12',
      'Contemporary world politics as covered in the CBSE syllabus',
      'Structured, example-based answer writing for long-format political science questions',
    ],
    faqs: [
      {
        question: 'Is Political Science useful preparation for CLAT?',
        answer: 'Class 11-12 political science builds useful background in constitutional and legal concepts, but CLAT itself tests specific legal reasoning, logical reasoning and current affairs. For focused CLAT preparation, see the dedicated CLAT tuition page.',
      },
      {
        question: 'How is Political Science different from Civics in earlier classes?',
        answer: 'Civics through Class 10 is bundled into History & Civics and covers government structure at an introductory level. Political Science at Class 11-12 is a standalone, more detailed subject covering political theory, the Constitution and international relations.',
      },
      {
        question: 'Which board offers Political Science as a subject in Kolkata?',
        answer: 'Political Science is most commonly offered under CBSE as a Class 11-12 humanities elective. Availability under ICSE and the West Bengal board varies by school.',
      },
    ],
    internalLinks: [
      { href: '/history-tuition-teachers-in-kolkata', label: 'History tutors' },
      { href: '/clat-tuition-teachers-in-kolkata', label: 'CLAT tutors' },
      { href: '/sociology-tuition-teachers-in-kolkata', label: 'Sociology tutors' },
    ],
  },

  '/environmental-science-tuition-teachers-in-kolkata': {
    intro:
      'Environmental Science at primary and middle school level introduces students to ecosystems, pollution, conservation and the natural world around Kolkata itself, wetlands, air quality, and local biodiversity, in age-appropriate detail. It is typically project and activity based rather than purely exam driven, so tutors focus on building genuine understanding and observation skills rather than heavy memorisation.',
    covers: [
      'Ecosystems and food chains for primary and middle school levels',
      'Pollution, conservation, and environmental awareness projects',
      'Local Kolkata context: wetlands, air quality, and urban environmental issues where relevant',
      'Project-based learning and activity assignments common at this level',
      'Basic environmental concepts that feed into Class 9-10 combined Science and later Class 12 Biology ecology chapters',
    ],
    faqs: [
      {
        question: 'What age group is Environmental Science tuition for?',
        answer: 'This page is aimed at primary and middle school students, where Environmental Science (sometimes called EVS) is typically a standalone subject before it gets folded into combined Science from Class 6-8 onward.',
      },
      {
        question: 'Is this the same as the ecology portion of Class 12 Biology?',
        answer: 'No, this page covers the earlier, primary/middle-school EVS subject. Ecology as an exam topic within Class 12 Biology is covered by tutors on the Biology tuition page.',
      },
      {
        question: 'Does Environmental Science tuition help with school projects?',
        answer: 'Yes, this subject is often project and activity based at school, and tutors on this page commonly help students with observation-based assignments and projects, not only textbook revision.',
      },
    ],
    internalLinks: [
      { href: '/biology-tuition-teachers-in-kolkata', label: 'Biology tutors' },
      { href: '/geography-tuition-teachers-in-kolkata', label: 'Geography tutors' },
      { href: '/science-tuition-teachers-in-kolkata', label: 'combined Science tutors' },
    ],
  },

  '/bengali-tuition-teachers-in-kolkata': {
    intro:
      'Bengali tuition in Kolkata serves two distinct groups: West Bengal state board students studying Bengali as a first language with full literature depth, and CBSE/ICSE students taking Bengali as a second language option, a lighter syllabus focused more on grammar and comprehension than literary analysis. Getting this distinction right when choosing a tutor matters, since the two syllabi barely overlap in depth or expectation.',
    covers: [
      'West Bengal board Bengali: first-language literature, poetry and prose analysis',
      'CBSE/ICSE Bengali as a second language: grammar, comprehension and shorter writing tasks',
      'Byakaran (grammar) fundamentals: sandhi, samas, and common error correction',
      'Letter and essay writing (patra o probondho rachona) formats specific to the board',
      'Reading fluency and comprehension building for younger students',
    ],
    faqs: [
      {
        question: 'Is Bengali tuition different for state board versus CBSE/ICSE students?',
        answer: 'Yes, considerably. West Bengal board treats Bengali as a first language with deep literature study, while CBSE and ICSE offer it as a lighter second-language option. Tell a tutor which track your child is on so lessons target the right syllabus depth.',
      },
      {
        question: 'Can a Bengali tutor also help with spoken or conversational Bengali?',
        answer: 'Some tutors on this page teach conversational Bengali alongside academic Bengali, useful for students who have moved to Kolkata from elsewhere and need to build fluency, not just exam skills. Mention this specifically when you contact a teacher.',
      },
      {
        question: 'What class levels commonly need Bengali tuition?',
        answer: 'Demand spans from primary reading fluency through Class 10 board-level literature, with West Bengal board students needing tuition across a wider range of classes given Bengali\'s first-language depth.',
      },
    ],
    internalLinks: [
      { href: '/state-board-tuition-teachers-in-kolkata', label: 'State Board tutors' },
      { href: '/english-tuition-teachers-in-kolkata', label: 'English tutors' },
      { href: '/hindi-tuition-teachers-in-kolkata', label: 'Hindi tutors' },
    ],
  },

  '/drawing-tuition-teachers-in-kolkata': {
    intro:
      'Drawing and painting tuition in Kolkata ranges from school-level art assessments, still life, nature drawing, and basic composition, to more serious skill building for students pursuing art as an interest or considering a design or fine arts path later. Unlike academic subjects, progress here is built through regular practice and feedback on technique rather than exam-style revision, so consistency matters more than cramming.',
    covers: [
      'Still life, nature and object drawing fundamentals for school-level art assessment',
      'Colour theory and basic painting techniques (watercolour, poster colour)',
      'Composition and perspective for students moving beyond beginner level',
      'Sketching and portrait basics for older students with a genuine interest in art',
      'Portfolio-building guidance for students considering design or fine arts study later',
    ],
    faqs: [
      {
        question: 'Is this tuition for school art class or serious art training?',
        answer: 'Both. Some tutors on this page focus on school-level drawing assessments, while others teach more serious technique for students building toward a design or fine arts portfolio. Mention your goal when contacting a teacher.',
      },
      {
        question: 'What age groups do drawing tutors in Kolkata teach?',
        answer: 'Drawing and painting tutors here teach across a wide age range, from young children building basic motor and observation skills to older students refining technique for portfolios or personal interest.',
      },
      {
        question: 'Do drawing tutors help with school exam art assessments specifically?',
        answer: 'Yes, several tutors on this page have experience with the specific still-life, nature-drawing and composition formats that CBSE and ICSE art assessments use at school level.',
      },
    ],
    internalLinks: [
      { href: '/all-tuition-teachers-in-kolkata', label: 'browse all subjects' },
      { href: '/environmental-science-tuition-teachers-in-kolkata', label: 'Environmental Science tutors' },
    ],
  },

  '/sat-tuition-teachers-in-kolkata': {
    intro:
      'SAT preparation in Kolkata is almost entirely about the Digital SAT now, adaptive testing, shorter sections, and a different pacing strategy than the old paper SAT. Students here are usually targeting US undergraduate admissions and need a tutor who understands both the test\'s Reading & Writing and Math sections and how to build a study plan around a specific target score and application timeline.',
    covers: [
      'Digital SAT format: adaptive module structure and time management strategy',
      'Reading & Writing: evidence-based reading, grammar rules, and the specific SAT answer-elimination technique',
      'Math section: algebra, problem-solving, and data analysis at SAT\'s specific difficulty curve',
      'Full-length timed practice tests under actual Digital SAT conditions',
      'Score-target planning aligned to specific US university admission ranges',
    ],
    faqs: [
      {
        question: 'Do SAT tutors in Kolkata teach the Digital SAT format specifically?',
        answer: 'Yes, most SAT tutors here have shifted fully to the Digital SAT\'s adaptive format, which differs meaningfully in pacing and question style from the older paper-based test. Confirm with a tutor that their material is Digital SAT-aligned.',
      },
      {
        question: 'How long does SAT preparation typically take?',
        answer: 'This varies by starting score and target score, but many students in Kolkata begin structured SAT prep 4-6 months ahead of their intended test date. A tutor can help set a realistic timeline once they know the target score.',
      },
      {
        question: 'Is SAT tuition useful alongside school board exams?',
        answer: 'Yes, SAT prep runs alongside, not instead of, CBSE, ICSE or IB coursework for most students. Many families schedule SAT sessions separately from board-subject tuition to avoid overload.',
      },
    ],
    internalLinks: [
      { href: '/act-tuition-teachers-in-kolkata', label: 'ACT tutors' },
      { href: '/english-tuition-teachers-in-kolkata', label: 'English tutors' },
      { href: '/maths-tuition-teachers-in-kolkata', label: 'Maths tutors' },
    ],
  },

  '/act-tuition-teachers-in-kolkata': {
    intro:
      'ACT preparation is the alternative to SAT for US college admissions, and the two tests reward slightly different strengths, the ACT includes a dedicated Science section and moves at a faster overall pace, which suits some students better than the SAT\'s format. Kolkata students choosing between the two usually take a diagnostic test first, then work with a tutor on whichever test better fits their strengths.',
    covers: [
      'ACT format: English, Math, Reading, Science, and optional Writing sections',
      'The ACT Science section specifically, a reasoning-under-time-pressure skill distinct from school science',
      'Faster-paced timing strategy compared to SAT, since ACT allows less time per question',
      'Full-length timed practice tests under real ACT conditions',
      'SAT-versus-ACT diagnostic guidance for students deciding which test suits them',
    ],
    faqs: [
      {
        question: 'Should my child take the SAT or the ACT?',
        answer: 'It depends on their strengths: the ACT rewards faster pacing and includes a Science reasoning section, while the SAT gives more time per question. A diagnostic test with a tutor is the fastest way to see which format suits your child.',
      },
      {
        question: 'Does the ACT Science section require actual science knowledge?',
        answer: 'Not really, it tests data interpretation and reasoning from charts and experiments rather than recalled science facts, which is why it is a distinct skill that tutors coach separately from board science subjects.',
      },
      {
        question: 'Are ACT tutors in Kolkata familiar with current US admission requirements?',
        answer: 'Many ACT tutors work regularly with students applying to US universities and stay current on which schools require or prefer ACT scores. Confirm directly with a tutor on the latest requirements for your target universities.',
      },
    ],
    internalLinks: [
      { href: '/sat-tuition-teachers-in-kolkata', label: 'SAT tutors' },
      { href: '/english-tuition-teachers-in-kolkata', label: 'English tutors' },
      { href: '/maths-tuition-teachers-in-kolkata', label: 'Maths tutors' },
    ],
  },

  '/cat-tuition-teachers-in-kolkata': {
    intro:
      'CAT preparation for MBA admissions in Kolkata centres on three sections, Verbal Ability & Reading Comprehension, Data Interpretation & Logical Reasoning, and Quantitative Ability, each demanding a different kind of speed and accuracy under strict sectional time limits. Most CAT aspirants are working professionals or final-year graduates studying around a job or coursework, so a tutor\'s ability to structure an efficient, focused study plan matters as much as content knowledge.',
    covers: [
      'Quantitative Ability: arithmetic, algebra, and geometry at CAT\'s specific difficulty and speed requirements',
      'Data Interpretation & Logical Reasoning: reading and solving data sets under sectional time pressure',
      'Verbal Ability & Reading Comprehension: para-jumbles, critical reasoning, and long passage comprehension',
      'Sectional time-management strategy, since CAT enforces strict per-section time limits',
      'Mock test analysis and error-pattern review, not just fresh content coverage',
    ],
    faqs: [
      {
        question: 'How is CAT preparation different from board or engineering exam maths?',
        answer: 'CAT quant tests speed and shortcut techniques on relatively simple concepts rather than depth of theory, so preparation focuses heavily on solving fast and accurately under time pressure, quite different from board exam or JEE-style maths.',
      },
      {
        question: 'Do CAT tutors in Kolkata also teach Data Interpretation and Logical Reasoning?',
        answer: 'Yes, most CAT tutors cover all three sections, Quant, DILR and Verbal, since CAT requires balanced performance across all of them, not strength in just one.',
      },
      {
        question: 'How far in advance should CAT preparation start?',
        answer: 'Most candidates in Kolkata begin structured preparation 6-8 months before the exam, though this depends heavily on the student\'s starting comfort with quantitative and logical reasoning. A tutor can help assess a realistic timeline after an initial diagnostic.',
      },
    ],
    internalLinks: [
      { href: '/gmat-tuition-teachers-in-kolkata', label: 'GMAT tutors' },
      { href: '/nmat-tuition-teachers-in-kolkata', label: 'NMAT tutors' },
      { href: '/maths-tuition-teachers-in-kolkata', label: 'Maths tutors' },
    ],
  },

  '/nmat-tuition-teachers-in-kolkata': {
    intro:
      'NMAT by GMAC, the entrance exam for NMIMS and a handful of other MBA programmes, is less punishing on any single section than CAT but rewards a different skill: consistent, fast accuracy across Language Skills, Quantitative Skills, and Logical Reasoning, with the added flexibility of multiple attempts within one testing window. Kolkata students preparing for NMAT often benefit from a tutor who structures practice around that multiple-attempt strategy rather than treating it like a single make-or-break exam.',
    covers: [
      'Language Skills: vocabulary, grammar, and reading comprehension at NMAT\'s pace',
      'Quantitative Skills: arithmetic, algebra, and data interpretation',
      'Logical Reasoning: pattern recognition and structured problem-solving',
      'Strategy for NMAT\'s multiple-attempt window, deciding when to reattempt and how to improve between attempts',
      'Section-wise time allocation given NMAT\'s distinct per-section timing rules',
    ],
    faqs: [
      {
        question: 'How is NMAT different from CAT in terms of difficulty?',
        answer: 'NMAT questions are generally considered less difficult individually than CAT\'s toughest questions, but NMAT rewards speed and consistency across all three sections, and offers up to three attempts in one window, a different strategic challenge than CAT\'s single-shot format.',
      },
      {
        question: 'Can I use the same tutor for both CAT and NMAT preparation?',
        answer: 'Many quantitative and logical reasoning tutors cover both exams, since the underlying skills overlap substantially. Ask specifically about NMAT\'s multiple-attempt strategy, since that part of preparation differs from CAT.',
      },
      {
        question: 'Which colleges accept NMAT scores in and around Kolkata?',
        answer: 'NMIMS campuses are the primary destination for NMAT scores, along with a small number of other participating institutes nationally. A tutor with recent NMAT-focused students can usually confirm the current list of accepting institutes.',
      },
    ],
    internalLinks: [
      { href: '/cat-tuition-teachers-in-kolkata', label: 'CAT tutors' },
      { href: '/gmat-tuition-teachers-in-kolkata', label: 'GMAT tutors' },
    ],
  },

  '/gmat-tuition-teachers-in-kolkata': {
    intro:
      'GMAT preparation in Kolkata serves students applying to international MBA programmes or India\'s top private business schools that accept GMAT scores. The exam\'s Quantitative and Verbal sections are computer-adaptive, meaning question difficulty shifts in real time based on performance, and Data Insights adds a data-heavy reasoning component, so a tutor experienced with adaptive-test strategy, not just content, is what separates useful GMAT coaching from generic quant tutoring.',
    covers: [
      'Quantitative Reasoning: algebra, arithmetic, and problem-solving at GMAT\'s adaptive difficulty curve',
      'Verbal Reasoning: critical reasoning, reading comprehension, and sentence correction',
      'Data Insights: interpreting tables, graphs, and multi-source data under time pressure',
      'Adaptive-test strategy: how question difficulty shifts and what that means for pacing',
      'Score-target planning aligned to specific international or Indian MBA programme requirements',
    ],
    faqs: [
      {
        question: 'Is GMAT preparation different from CAT preparation?',
        answer: 'Yes. GMAT is computer-adaptive and includes a distinct Data Insights section, while CAT has a fixed-difficulty, sectional-time-limit format. The underlying quant and verbal skills overlap somewhat, but exam strategy differs enough that dedicated GMAT prep is worth seeking out.',
      },
      {
        question: 'Do GMAT tutors in Kolkata prepare students for international MBA applications?',
        answer: 'Many do, and some also advise on how GMAT scores fit into a broader international application alongside essays and recommendations, though for full application strategy you may also want a dedicated admissions consultant.',
      },
      {
        question: 'How is the adaptive format different from a normal test?',
        answer: 'In an adaptive test, each question\'s difficulty depends on whether you answered the previous one correctly, so early questions carry outsized weight. A tutor familiar with GMAT specifically will coach pacing and question-selection strategy around that, not just content review.',
      },
    ],
    internalLinks: [
      { href: '/cat-tuition-teachers-in-kolkata', label: 'CAT tutors' },
      { href: '/nmat-tuition-teachers-in-kolkata', label: 'NMAT tutors' },
    ],
  },

  '/ca-tuition-teachers-in-kolkata': {
    intro:
      'CA (Chartered Accountancy) tuition in Kolkata covers the ICAI course\'s three stages, Foundation, Intermediate and Final, each with its own paper structure spanning accounting, law, taxation, audit and financial management. Pass rates at every stage are demanding, so most students combine self-study with tutors who focus on specific weak papers, taxation or costing, for example, rather than trying to relearn the entire syllabus with one generalist.',
    covers: [
      'CA Foundation: accounting fundamentals, business law, and quantitative aptitude',
      'CA Intermediate: advanced accounting, taxation (direct and indirect), costing, and auditing',
      'CA Final: advanced financial reporting, strategic financial management, and corporate law',
      'ICAI\'s specific paper format and negative-marking rules where they apply',
      'Targeted revision for individual weak papers rather than full-syllabus reteaching',
    ],
    faqs: [
      {
        question: 'Can I find a tutor for just one CA paper, like Taxation?',
        answer: 'Yes, many CA tutors on Shikshaq specialise in specific papers rather than the full course. Mention which stage (Foundation, Intermediate or Final) and which paper you need when you contact a teacher.',
      },
      {
        question: 'Is CA Foundation tuition connected to Class 12 Accounts and Commerce?',
        answer: 'There is real overlap, CA Foundation builds on Class 12 accountancy and commerce fundamentals, which is why some Accounts tutors also teach CA Foundation-level content. Check the Accounts tuition page as well if your child is bridging from board exams into CA.',
      },
      {
        question: 'Do CA tutors in Kolkata teach ICAI\'s updated syllabus?',
        answer: 'ICAI periodically revises the CA syllabus and paper structure, so confirm directly with a tutor that they are teaching the current scheme before starting, especially if you are transitioning between old and new syllabus versions.',
      },
    ],
    internalLinks: [
      { href: '/accounts-tuition-teachers-in-kolkata', label: 'Accounts tutors' },
      { href: '/cfa-tuition-teachers-in-kolkata', label: 'CFA tutors' },
      { href: '/commerce-tuition-teachers-in-kolkata', label: 'Commerce tutors' },
    ],
  },

  '/cfa-tuition-teachers-in-kolkata': {
    intro:
      'CFA (Chartered Financial Analyst) tuition in Kolkata prepares candidates for the CFA Institute\'s three-level programme, covering investment tools, asset valuation, portfolio management and ethics, aimed at working professionals or graduates pursuing a career in finance and investment analysis. Because CFA candidates are usually studying around full-time jobs, tutors here tend to focus on efficient, high-yield topic coverage and question-practice rather than a slow, ground-up teaching pace.',
    covers: [
      'Level I: investment tools, financial reporting, and ethical and professional standards',
      'Level II: asset valuation and application-based case analysis',
      'Level III: portfolio management and wealth planning',
      'CFA Institute\'s ethics component, which carries disproportionate weight across all three levels',
      'Efficient, working-professional-paced study planning around the exam\'s fixed testing windows',
    ],
    faqs: [
      {
        question: 'Is CFA tuition suitable for working professionals with limited time?',
        answer: 'Yes, most CFA tutors in Kolkata structure sessions around candidates studying part-time alongside a job, focusing on high-yield topics and question practice rather than lengthy ground-up lectures.',
      },
      {
        question: 'Do CFA tutors cover all three levels?',
        answer: 'Some do, though many specialise in one or two levels given how different Level I\'s breadth is from Level III\'s applied portfolio management focus. Confirm which level a tutor is currently teaching before booking.',
      },
      {
        question: 'How does CFA tuition differ from CA tuition?',
        answer: 'CFA focuses specifically on investment analysis and portfolio management for a global finance career, while CA (Chartered Accountancy) covers accounting, audit, tax and corporate law for the Indian accounting profession. They serve different career paths despite some accounting overlap.',
      },
    ],
    internalLinks: [
      { href: '/ca-tuition-teachers-in-kolkata', label: 'CA tutors' },
      { href: '/gmat-tuition-teachers-in-kolkata', label: 'GMAT tutors' },
      { href: '/economics-tuition-teachers-in-kolkata', label: 'Economics tutors' },
    ],
  },

  '/clat-tuition-teachers-in-kolkata': {
    intro:
      'CLAT preparation in Kolkata targets admission to India\'s National Law Universities, testing English, Current Affairs & GK, Legal Reasoning, Logical Reasoning and Quantitative Techniques in one combined paper. Legal Reasoning in particular is a skill most Class 11-12 students have never practised before, applying legal principles to fact scenarios, so a tutor with CLAT-specific experience matters more here than general aptitude coaching.',
    covers: [
      'Legal Reasoning: applying legal principles to fact-based scenarios, CLAT\'s most distinctive section',
      'Current Affairs & General Knowledge, with an emphasis on recent legal and policy developments',
      'Logical Reasoning: syllogisms, critical reasoning, and passage-based inference',
      'English: comprehension and vocabulary within a legal and current-affairs context',
      'Quantitative Techniques: basic numeracy and data interpretation as CLAT tests it',
    ],
    faqs: [
      {
        question: 'What is Legal Reasoning and why does it need specific coaching?',
        answer: 'Legal Reasoning gives you a legal principle and a fact scenario, then asks you to apply the principle correctly, a skill distinct from general logical reasoning. Most students have never encountered this format before CLAT prep, which is why dedicated coaching helps more here than in other sections.',
      },
      {
        question: 'When should CLAT preparation start?',
        answer: 'Many Kolkata students preparing for CLAT begin structured coaching in Class 11, running it alongside board-subject tuition, since CLAT rewards sustained current-affairs reading and reasoning practice built up over more than a few months.',
      },
      {
        question: 'Is CLAT tuition useful for Political Science students specifically?',
        answer: 'Political Science background helps with constitutional and legal familiarity, but CLAT tests reasoning and application skills that go beyond the school syllabus. Many CLAT aspirants combine tuition here with their regular Political Science coursework.',
      },
    ],
    internalLinks: [
      { href: '/political-science-tuition-teachers-in-kolkata', label: 'Political Science tutors' },
      { href: '/english-tuition-teachers-in-kolkata', label: 'English tutors' },
      { href: '/history-tuition-teachers-in-kolkata', label: 'History tutors' },
    ],
  },

  '/social-studies-tuition-teachers-in-kolkata': {
    intro:
      'Social Studies tuition on this page covers History and Geography together, matching how many schools teach the two subjects as one combined block through the middle and early secondary years before boards examine them separately at Class 10 and beyond. It suits parents looking for one tutor to handle both subjects at once rather than booking two separate specialists for a student who is not yet at the stage where the subjects diverge in depth.',
    covers: [
      'Indian and world history topics as taught at combined social studies level',
      'Physical and human geography fundamentals alongside the history syllabus',
      'Civics basics: government structure and citizenship, where bundled into the same subject',
      'Map work spanning both historical and geographical map-reading skills',
      'A bridge toward standalone History and Geography tuition once a student\'s board splits the subjects',
    ],
    faqs: [
      {
        question: 'Is Social Studies the same as History & Civics on this site?',
        answer: 'They overlap but are not identical: Social Studies here covers History and Geography together for schools that combine them, while the History tuition page includes History & Civics specifically as tested through Class 10. Check both pages if you are unsure which matches your child\'s school subject.',
      },
      {
        question: 'At what class level do schools stop combining History and Geography?',
        answer: 'This varies by school and board, but most CBSE and ICSE schools separate History and Geography into distinct papers by Class 9-10, even if they were taught together earlier. Confirm your child\'s current school syllabus before booking a tutor.',
      },
      {
        question: 'Can I book separate History and Geography tutors instead?',
        answer: 'Yes, if your child\'s board already examines the two subjects separately, the dedicated History tuition and Geography tuition pages will connect you with subject specialists rather than a combined-subject generalist.',
      },
    ],
    internalLinks: [
      { href: '/history-tuition-teachers-in-kolkata', label: 'History tutors' },
      { href: '/geography-tuition-teachers-in-kolkata', label: 'Geography tutors' },
      { href: '/all-tuition-teachers-in-kolkata', label: 'browse all subjects' },
    ],
  },
};

export const BOARD_CONTENT: Record<string, SubjectContent> = {
  '/cbse-ncert-tuition-teachers-in-kolkata': {
    intro:
      'CBSE, following the NCERT curriculum, is the most common board among Kolkata\'s newer schools and the default choice for families who expect to relocate across India during a child\'s schooling. Its exam pattern has shifted toward case-study and application-based questions in recent years, particularly in maths and science, which means tuition built around a decade-old paper style can leave a student underprepared for the current format.',
    covers: [
      'NCERT textbook alignment across all core subjects, since CBSE questions are set directly against NCERT content',
      'The current case-study and competency-based question format CBSE has phased in for maths and science',
      'Class 10 and Class 12 board exam strategy, including the internal assessment component',
      'Subject-wise tutor matching across maths, science, languages, and social science',
      'JEE/NEET-track pacing for CBSE science students layering competitive exam prep onto board coursework',
    ],
    faqs: [
      {
        question: 'Does CBSE tuition follow the NCERT textbook exactly?',
        answer: 'Yes, CBSE exam questions are set directly against NCERT textbook content, so tutors on this page teach closely aligned to NCERT rather than a generic syllabus outline.',
      },
      {
        question: 'How has the CBSE exam pattern changed recently?',
        answer: 'CBSE has increased the share of case-study and application-based questions, especially in maths and science, moving away from pure recall. A tutor teaching to the current pattern, not an older one, will prepare your child more accurately for the actual paper.',
      },
      {
        question: 'Can I find subject-specific CBSE tutors through this page?',
        answer: 'This page lists CBSE-experienced tutors across subjects; for a specific subject at the level of detail those pages offer, visit the dedicated Maths, Physics, English or other subject tuition pages and filter by CBSE board.',
      },
    ],
    internalLinks: [
      { href: '/maths-tuition-teachers-in-kolkata', label: 'Maths tutors' },
      { href: '/icse-tuition-teachers-in-kolkata', label: 'ICSE tutors' },
      { href: '/all-tuition-teachers-in-kolkata', label: 'browse all boards' },
    ],
  },

  '/icse-tuition-teachers-in-kolkata': {
    intro:
      'ICSE, and its senior-level counterpart ISC, is known in Kolkata for a broader syllabus and greater emphasis on English and literature than CBSE, with exam papers that reward detailed, well-structured written answers over quick recall. Many of Kolkata\'s older, established schools follow ICSE, and its internal assessment component carries real weight, so a tutor who understands both the written exam style and the project-based internal marks matters here.',
    covers: [
      'ICSE\'s broader syllabus depth across Class 9-10, particularly in English, science, and maths',
      'ISC (Class 11-12) subject specialisation as students choose science, commerce, or humanities streams',
      'Internal assessment and project work, a significant, separately graded component under ICSE',
      'Detailed, step-marked written answer technique that ICSE papers specifically reward',
      'Subject-wise tutor matching across the full ICSE and ISC curriculum',
    ],
    faqs: [
      {
        question: 'What is the difference between ICSE and ISC?',
        answer: 'ICSE is the board\'s Class 10 examination, and ISC is the same board\'s Class 12 examination. Tutors on this page cover both stages; mention your child\'s exact class when reaching out.',
      },
      {
        question: 'Why is ICSE considered to have a tougher syllabus than CBSE?',
        answer: 'ICSE generally covers more content depth, particularly in English and the sciences, and rewards detailed written answers over the more application-focused CBSE format. This is a common reason Kolkata parents choose subject-specific ICSE-experienced tutors rather than board-agnostic ones.',
      },
      {
        question: 'Does internal assessment count toward the ICSE/ISC final result?',
        answer: 'Yes, internal assessment (project work and practicals) carries real weight under ICSE and ISC, separate from the written paper. Some tutors also help structure and review project work, not only exam-paper content.',
      },
    ],
    internalLinks: [
      { href: '/cbse-ncert-tuition-teachers-in-kolkata', label: 'CBSE tutors' },
      { href: '/english-tuition-teachers-in-kolkata', label: 'English tutors' },
      { href: '/commercial-studies-tuition-teachers-in-kolkata', label: 'Commercial Studies tutors' },
    ],
  },

  '/igcse-tuition-teachers-in-kolkata': {
    intro:
      'IGCSE, Cambridge International\'s board, is chosen by Kolkata families expecting to move abroad or into an international school system, and its grading and exam style, tiered papers, coursework components in some subjects, and a global rather than India-specific curriculum, differ meaningfully from CBSE or ICSE. A tutor with genuine IGCSE experience understands Cambridge\'s specific assessment objectives, not just the general subject content.',
    covers: [
      'Cambridge\'s tiered paper system where subjects offer Core and Extended difficulty levels',
      'Coursework and controlled assessment components for subjects that include them',
      'IGCSE-specific command words and mark scheme conventions in written answers',
      'Subject choice guidance for students transitioning into or out of IGCSE from another board',
      'A-Level pathway planning for students continuing at the same international school after IGCSE',
    ],
    faqs: [
      {
        question: 'Is IGCSE harder or easier than CBSE and ICSE?',
        answer: 'Difficulty is not directly comparable since the curricula and assessment styles differ, IGCSE uses tiered Core/Extended papers in several subjects and often includes coursework. A tutor experienced specifically in IGCSE will understand its mark schemes better than one trained only on Indian boards.',
      },
      {
        question: 'Do IGCSE tutors in Kolkata also teach A-Levels?',
        answer: 'Some do, since IGCSE and A-Level are both Cambridge/international qualifications students often take in sequence at the same school. Ask a tutor directly whether they cover the A-Level stage as well.',
      },
      {
        question: 'What is the Core versus Extended tier in IGCSE?',
        answer: 'Many IGCSE subjects let schools or students choose between a Core paper (capped at a lower maximum grade, less demanding) and an Extended paper (full grade range, more demanding). Confirm which tier your child is sitting before starting tuition, since content coverage differs.',
      },
    ],
    internalLinks: [
      { href: '/international-board-tuition-teachers-in-kolkata', label: 'IB tutors' },
      { href: '/sat-tuition-teachers-in-kolkata', label: 'SAT tutors' },
      { href: '/all-tuition-teachers-in-kolkata', label: 'browse all boards' },
    ],
  },

  '/international-board-tuition-teachers-in-kolkata': {
    intro:
      'IB, the International Baccalaureate, is offered by a small number of Kolkata schools and structured very differently from Indian boards: the Diploma Programme requires six subject groups plus the Extended Essay, Theory of Knowledge, and CAS components, alongside internal assessments that count meaningfully toward the final grade. Tutors here need to understand IB\'s specific assessment criteria and command terms, which differ subject by subject and are graded against published rubrics rather than a fixed answer key.',
    covers: [
      'IB Diploma Programme (DP) subject groups: languages, sciences, maths, and the arts/electives',
      'Internal Assessment (IA) guidance across subjects, a graded coursework component unique to IB',
      'Extended Essay and Theory of Knowledge support for the DP core requirements',
      'Higher Level versus Standard Level pacing within the same subject',
      'IB-specific command terms and assessment criteria that differ from board-exam mark schemes',
    ],
    faqs: [
      {
        question: 'What does IB tuition typically cover beyond regular subject teaching?',
        answer: 'Beyond subject content, many IB tutors also help with the Extended Essay, Internal Assessments, and Theory of Knowledge, all core IB Diploma requirements that do not exist in CBSE, ICSE or IGCSE.',
      },
      {
        question: 'What is the difference between Higher Level and Standard Level in IB?',
        answer: 'Higher Level (HL) subjects go deeper and require more contact hours than Standard Level (SL) within the same subject. Students choose a mix of HL and SL subjects, so confirm with a tutor which level your child needs help with.',
      },
      {
        question: 'How many IB schools are there in Kolkata?',
        answer: 'IB is offered by a smaller number of Kolkata schools compared to CBSE or ICSE, which is why finding a genuinely IB-experienced tutor, rather than one who has only taught Indian boards, is worth confirming directly before booking.',
      },
    ],
    internalLinks: [
      { href: '/igcse-tuition-teachers-in-kolkata', label: 'IGCSE tutors' },
      { href: '/psychology-tuition-teachers-in-kolkata', label: 'Psychology tutors' },
      { href: '/all-tuition-teachers-in-kolkata', label: 'browse all boards' },
    ],
  },

  '/state-board-tuition-teachers-in-kolkata': {
    intro:
      'The West Bengal State Board (WBBSE for Secondary, WBCHSE for Higher Secondary) remains the board followed by a large share of Kolkata schools, and it is the only one of the five boards on Shikshaq taught primarily in Bengali medium in many schools, alongside an English-medium stream. Its syllabus and exam pattern differ from CBSE and ICSE in pacing and question style, and Bengali as a first language carries far more weight here than under other boards.',
    covers: [
      'WBBSE (Secondary, Class 10) and WBCHSE (Higher Secondary, Class 12) syllabus and exam pattern',
      'Bengali-medium and English-medium instruction, both common across state board schools',
      'Bengali as a first-language subject at full literature depth, distinct from its lighter treatment under CBSE/ICSE',
      'Stream selection guidance (science, commerce, arts) at the Class 11 Higher Secondary transition',
      'Subject-wise tutor matching aligned to the state board\'s specific textbooks and question patterns',
    ],
    faqs: [
      {
        question: 'Is West Bengal State Board tuition available in Bengali medium?',
        answer: 'Yes, many tutors on this page teach in Bengali medium, matching how a large share of state board schools instruct. If your child studies in the English-medium state board stream instead, mention that when contacting a teacher.',
      },
      {
        question: 'What are WBBSE and WBCHSE?',
        answer: 'WBBSE conducts the Class 10 Secondary examination and WBCHSE conducts the Class 12 Higher Secondary examination for the West Bengal State Board. Tutors on this page cover both stages.',
      },
      {
        question: 'How does State Board Bengali differ from Bengali under CBSE or ICSE?',
        answer: 'Under the state board, Bengali is typically a first-language subject with full literature and grammar depth, while CBSE and ICSE usually offer it as a lighter second-language option. See the Bengali tuition page for tutors matched to either track.',
      },
    ],
    internalLinks: [
      { href: '/bengali-tuition-teachers-in-kolkata', label: 'Bengali tutors' },
      { href: '/cbse-ncert-tuition-teachers-in-kolkata', label: 'CBSE tutors' },
      { href: '/all-tuition-teachers-in-kolkata', label: 'browse all boards' },
    ],
  },
};
