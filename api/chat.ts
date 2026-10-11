// Vercel serverless function for Gemini AI chatbot
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// --- Real-teacher lookup -----------------------------------------------------
// Pragmatic keyword match: rather than trusting the LLM to invent or correctly
// recall real teacher records, we independently detect "find me a teacher"
// intent + a subject/keyword from the user's own message, then query the real
// Shikshaq data directly. Any teachers found are returned as structured data
// (`teachers`) alongside the prose so the frontend can render real TeacherCard
// components instead of the model listing names in text.

const FIND_TEACHER_INTENT = [
  'teacher', 'tutor', 'tuition', 'find', 'recommend', 'suggest', 'looking for',
  'need a', 'anyone teach', 'who teaches', 'help me find', 'contact',
];

const SUBJECT_KEYWORDS = [
  'maths', 'mathematics', 'math', 'physics', 'chemistry', 'biology', 'science',
  'english', 'hindi', 'bengali', 'history', 'geography', 'economics',
  'accountancy', 'accounts', 'commerce', 'computer science', 'computer',
  'coding', 'python', 'social studies', 'political science', 'business studies',
  'statistics', 'french', 'sanskrit',
];

interface TeacherCardResult {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  subject: string;
  sirMaam: string | null;
  experienceYears: number | null;
  minFees: number | null;
  maxFees: number | null;
  area: string | null;
}

function deriveExperienceYears(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const yearStarted = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!yearStarted || isNaN(yearStarted)) return null;
  const years = new Date().getFullYear() - yearStarted;
  return years > 0 && years < 80 ? years : null;
}

/** Extracts a subject keyword mentioned in the user's message, if any. */
function detectSubject(message: string): string | null {
  const lower = message.toLowerCase();
  for (const keyword of SUBJECT_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

function hasFindTeacherIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return FIND_TEACHER_INTENT.some((kw) => lower.includes(kw));
}

/**
 * Looks up up to 3 real teachers matching the subject mentioned in the user's
 * message. Returns [] when the message doesn't look like a "find a teacher"
 * question, or when nothing matches — the frontend simply renders no cards.
 */
async function findMatchingTeachers(message: string): Promise<TeacherCardResult[]> {
  if (!hasFindTeacherIntent(message)) return [];
  const subjectKeyword = detectSubject(message);
  if (!subjectKeyword) return [];

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 'maths' should also match a subject named 'Mathematics', etc.
    const normalized = subjectKeyword === 'maths' || subjectKeyword === 'math' ? 'mathemat' : subjectKeyword;

    const { data: matchingSubjects } = await supabase
      .from('subjects')
      .select('name, slug')
      .ilike('name', `%${normalized}%`);

    if (!matchingSubjects || matchingSubjects.length === 0) return [];
    const subjectIds = matchingSubjects.map((s: { name: string }) => s.name);

    interface MatchedTeacherRow {
      id: string;
      name: string;
      slug: string;
      image_url: string | null;
      subjects: { name: string; slug: string } | null;
    }

    const { data: teacherRows, error } = await supabase
      .from('teachers_list')
      .select('id, name, slug, image_url, is_featured, subjects!inner(name, slug)')
      .in('subjects.name', subjectIds)
      .order('is_featured', { ascending: false })
      .limit(3)
      .returns<MatchedTeacherRow[]>();

    if (error || !teacherRows || teacherRows.length === 0) return [];

    const slugs = teacherRows.map((t) => t.slug).filter(Boolean);

    interface ShikshaqmineBasicRow {
      Slug: string;
      "Sir/Ma'am?": string | null;
      'Years they started teaching': string | number | null;
      'Min Fees': number | null;
      'Max Fees': number | null;
      Area: string | null;
      'LOCATION V2': string | null;
    }

    // No "Link" here, deliberately. The WhatsApp number was revoked from `anon`
    // at the column level (20260909000002) and this function talks to Supabase
    // with the publishable key, i.e. as anon -- so naming that column failed the
    // WHOLE query with "permission denied for column", not just omitting the
    // number. Every field below (honorific, experience, fees, area) came back
    // empty as a result, which read as "these teachers have no details" rather
    // than as an error.
    //
    // Nothing is lost by dropping it: TeacherCard accepts `whatsappLink` but no
    // longer renders a WhatsApp CTA, so this value was never displayed. Contact
    // happens on the teacher's profile, behind the sign-in gate that exists
    // precisely so an anonymous endpoint cannot hand numbers out.
    const { data: shikshaqRows, error: shikshaqError } = await supabase
      .from('Shikshaqmine')
      .select('"Slug","Sir/Ma\'am?","Years they started teaching","Min Fees","Max Fees","Area","LOCATION V2"')
      .in('Slug', slugs)
      .returns<ShikshaqmineBasicRow[]>();

    // Surfaced on purpose. The previous version discarded this error, which is
    // exactly why a permission failure was indistinguishable from thin data.
    if (shikshaqError) {
      console.warn('Shikshaqmine enrichment failed:', shikshaqError.message);
    }

    const basicMap = new Map<string, ShikshaqmineBasicRow>();
    for (const row of shikshaqRows ?? []) {
      basicMap.set(row.Slug, row);
    }

    return teacherRows.map((t) => {
      const basic: Partial<ShikshaqmineBasicRow> = basicMap.get(t.slug) ?? {};
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        imageUrl: t.image_url ?? null,
        subject: t.subjects?.name ?? subjectKeyword,
        sirMaam: basic["Sir/Ma'am?"] ?? null,
        experienceYears: deriveExperienceYears(basic['Years they started teaching']),
        minFees: basic['Min Fees'] != null ? Number(basic['Min Fees']) : null,
        maxFees: basic['Max Fees'] != null ? Number(basic['Max Fees']) : null,
        area: basic['Area'] ?? basic['LOCATION V2'] ?? null,
      } as TeacherCardResult;
    });
  } catch (err) {
    console.warn('findMatchingTeachers failed:', err);
    return [];
  }
}

// Exhaustive Shikshaq FAQ for the chatbot - answer from this first; only suggest WhatsApp when question is not covered or user asks how to contact
const SHIKSHAQ_FAQ = `
ABOUT SHIKSHAQ
Q: What is Shikshaq and how does it work?
A: Shikshaq is a platform that helps students and parents discover tuition teachers across Kolkata. You can browse teacher profiles, compare experience and reviews, and directly contact teachers to start classes.

Q: Who is Shikshaq for?
A: Shikshaq is designed for students and parents looking for reliable tutors across different subjects, grades, boards, and exams.

Q: Is Shikshaq free to use?
A: Yes. Shikshaq is completely free for students and parents. There are no platform charges or hidden fees.

Q: Which cities or localities does Shikshaq currently cater to?
A: Shikshaq currently operates only in Kolkata and covers most major localities across the city.

Q: Will Shikshaq expand to other cities?
A: Yes. Expansion to other cities is planned in the future.

ACADEMIC COVERAGE
Q: Which classes or grades does Shikshaq support?
A: Shikshaq supports students from Classes 1–12, Undergraduate (UG), and Postgraduate (PG).

Q: Which educational boards do you support?
A: Shikshaq supports ICSE/ISC, CBSE, IB, IGCSE, and State Boards.

Q: Do you have tutors for competitive exams?
A: Yes. Select competitive exam tutors are available depending on subject and availability.

Q: Do you have tutors for UG and PG students?
A: Yes. Many teachers also teach college-level subjects.

Q: What subjects are available?
A: Shikshaq covers almost all mainstream academic subjects, including science, commerce, humanities, languages, and specialised subjects where available.

FINDING THE RIGHT TUTOR
Q: How do I find the right tutor on Shikshaq?
A: You can browse tutors using filters such as subject, class, board, and locality. Review profiles, experience, and student feedback before contacting teachers.

Q: How should I choose between multiple tutors?
A: Compare experience, subjects taught, student reviews, teaching approach, and fee expectations. Contact multiple teachers if needed before deciding.

Q: Can I contact multiple teachers at once?
A: Yes. You are encouraged to contact multiple tutors to find the best match.

Q: Do you recommend one teacher over another?
A: No. Shikshaq provides information and reviews to help you make your own decision.

CONTACTING TEACHERS
Q: How do I contact a teacher through Shikshaq?
A: Each teacher profile includes a direct contact option. You can message or call the teacher directly.

Q: Do I need to create an account?
A: No account creation is required to browse or contact tutors.

Q: What should I message a teacher first?
A: Mention the student's class, board, subject, preferred locality, and mode (home/online).

Q: Will the teacher see my phone number?
A: Yes. Since contact happens directly, teachers will see your contact details when you reach out.

Q: How quickly do teachers respond?
A: Most teachers respond within a few hours to a day, depending on availability.

FEES AND PAYMENTS
Q: Do I pay through Shikshaq or directly to the teacher?
A: All payments are made directly to the teacher. Shikshaq does not handle payments.

Q: Who decides the tuition fees?
A: Each teacher independently sets their own fees.

Q: Where does my payment go?
A: Payments go entirely to the teacher. Shikshaq does not receive any portion of tuition fees.

Q: Does Shikshaq charge commission?
A: No. Shikshaq takes zero commission.

Q: Can I negotiate fees with the teacher?
A: Yes. Fees and class arrangements are mutually decided between you and the teacher.

Q: Are demo or trial classes available?
A: Trial classes depend entirely on the individual teacher. You may discuss this directly with them.

VERIFIED TEACHERS
Q: What does the Verified badge on some teachers' profiles mean?
A: A Verified badge indicates that a member of Team Shikshaq has personally interacted with and vouched for the authenticity of that teacher's profile.

Q: Does Verified mean Shikshaq guarantees the teacher?
A: No. Verification reflects additional confidence in authenticity and professionalism, but Shikshaq does not assume responsibility or liability for teaching outcomes or conduct.

REVIEWS AND TRUST
Q: Are the reviews on teacher profiles real?
A: Reviews are submitted based on genuine student or parent experiences to help others make informed decisions.

Q: Can teachers edit or remove reviews?
A: Teachers cannot independently remove reviews. Feedback exists to help maintain transparency.

Q: How do I know if a teacher will suit my child?
A: We recommend reviewing feedback, speaking to the teacher, and trying an initial class before committing long-term.

RESPONSIBILITY AND LIABILITY
Q: Does Shikshaq take responsibility for teaching quality?
A: No. Shikshaq functions as a discovery platform connecting students and teachers. Academic outcomes depend on the teacher-student relationship.

Q: Is Shikshaq responsible for payments or disputes?
A: No. All financial arrangements are strictly between students/parents and teachers.

Q: Does Shikshaq monitor classes?
A: No. Shikshaq does not supervise or monitor lessons.

IF SOMETHING GOES WRONG
Q: What if a teacher doesn't respond after I message them?
A: You may contact Team Shikshaq via the Contact Us option. We will attempt to reach the teacher on your behalf within 48 hours.

Q: What if I face an issue with a teacher?
A: You can submit feedback through the feedback form, or contact Team Shikshaq directly via WhatsApp support.

Q: Can I change my tutor later?
A: Yes. You are free to contact another tutor anytime.

Q: What if classes stop suddenly?
A: We recommend contacting another tutor on Shikshaq. You may also inform us so we can review the listing.

PRIVACY AND DATA
Q: Is my phone number and personal data safe?
A: Yes. Shikshaq does not sell or distribute your personal information to third parties.

Q: Who can see my details?
A: Only the teacher you directly contact will receive your details.

Q: Does Shikshaq store payment information?
A: No. Since payments happen directly with teachers, Shikshaq stores no payment data.

SUPPORT AND COMMUNICATION
Q: How can I contact Shikshaq support quickly?
A: Use the Contact Us button to reach Team Shikshaq via WhatsApp.

Q: How long does support take to respond?
A: We aim to respond as quickly as possible, typically within 48 hours.

Q: How can I give feedback about the platform?
A: You can submit feedback through the feedback form available on the website.

Q: Can I report a suspicious or incorrect profile?
A: Yes. Please report it through the feedback form or contact support directly.

Q: My question wasn't answered here, what should I do?
A: You can contact Team Shikshaq directly through the Contact Us option, and we'll be happy to help.

MORE DETAILS
Q: What information is shown on a teacher's profile?
A: Profile shows subjects, classes, board(s), years of experience, locations taught, teaching mode (online/home), typical fees (if provided), sample teaching approach, and student reviews.

Q: Can I ask a teacher for their CV or qualifications?
A: Yes. Request qualifications or CV directly from the teacher when you contact them; teachers choose what credentials to share.

Q: How do online classes work and what do I need?
A: Teachers usually use Zoom/Google Meet/WhatsApp video. You need a stable internet connection, a device with camera/mic, and a quiet study space. Confirm platform and link with the teacher beforehand.

Q: Do teachers offer group classes or only one-to-one sessions?
A: That depends on the teacher. Some run group batches; others prefer one-to-one. Ask each teacher when you contact them.

Q: Can I record online classes?
A: Recording is subject to the teacher's permission. Ask the teacher and agree on usage before recording.

Q: What happens if a teacher cancels or misses a class?
A: Rescheduling/cancellation is between you and the teacher. If the teacher is unresponsive, contact Shikshaq support and we'll attempt to reach them within 48 hours.

Q: Do teachers provide lesson plans or progress reports?
A: Some teachers do; others do not. Discuss expectations (homework, tests, progress updates) with the teacher before starting.

Q: Are background checks done on teachers?
A: Not as a standard. Selected teachers who receive a Verified badge have been personally vouched for by a Shikshaq team member, but Shikshaq does not perform formal background checks or accept liability.

Q: Can I ask for references from previous students?
A: Yes. You may request references from the teacher; availability depends on the teacher's privacy and consent.

Q: How do I get a receipt for payments?
A: Shikshaq does not handle payments. Ask the teacher for a receipt or invoice when you pay them directly.

Q: What if I receive misleading information on a teacher's profile?
A: Report the profile via the feedback form or Contact Us. We will review the listing and follow up with the teacher.

Q: How are teacher ratings calculated?
A: Ratings and reviews come from students and parents who have submitted feedback. Higher ratings reflect stronger, more consistent positive feedback.

Q: Can I request home-only or female-only tutors?
A: You can specify preferences (home/online, gender, locality) when contacting teachers. Availability depends on the teachers listed.

Q: Does Shikshaq support special-needs tutoring?
A: Some teachers specialise in special-needs education. Use filters or ask teachers directly about experience and accommodations.

Q: Can schools or coaching centres list on Shikshaq?
A: Currently teachers are onboarded via our backend. If a centre wants to list, contact us and we'll discuss onboarding criteria.

Q: How do I remove my contact details from a teacher's view or from the site?
A: If you want your details removed, contact Shikshaq via Contact Us and we will assist; note teachers you already contacted will have the details they received directly.

Q: What should I do before the first class to make it productive?
A: Share the student's board, class, recent syllabus/weak areas, sample test paper or topic list, and preferred teaching mode; set expectations on frequency and fees.

Q: Are there age limits for teachers?
A: We onboard professional teachers as per our internal criteria; some may be college tutors. Teacher profiles list experience so you can decide.

Q: How can I suggest a new feature or improvement for Shikshaq?
A: Use the feedback form or Contact Us; we review suggestions for future updates.

Q: How do I request deletion of my account or personal data?
A: Contact Shikshaq via Contact Us with your request. We'll process data-deletion requests per our privacy policy and confirm when completed.

PLATFORM USAGE AND EXPECTATIONS (Set 3)
Q: Can Shikshaq recommend a tutor for me personally?
A: Shikshaq does not assign tutors. You can browse profiles and directly choose teachers based on your preferences and reviews.

Q: Do you guarantee improvement in marks or results?
A: No. Academic performance depends on student effort, teacher compatibility, and regular practice. Shikshaq does not guarantee outcomes.

Q: How many tutors should I contact before deciding?
A: Most families contact 2–4 teachers to compare teaching styles, fees, and availability before finalising.

Q: Can I stop classes anytime if I am not satisfied?
A: Yes. Continuation of classes depends entirely on mutual agreement between you and the teacher.

Q: Can parents speak to the teacher before starting classes?
A: Yes. We strongly recommend a discussion call before confirming tuition.

AVAILABILITY AND SCHEDULING
Q: How do I know if a teacher is available in my area?
A: Teachers mention their teaching localities in their profiles. You can confirm availability directly when contacting them.

Q: Do teachers travel to the student's home?
A: Some teachers offer home tuition, some teach from their own location, and others teach online. Check each profile.

Q: Can I request weekend-only classes?
A: Yes. Scheduling is decided directly between you and the teacher.

Q: What if my schedule changes after classes begin?
A: Discuss rescheduling directly with the teacher. Policies vary by tutor.

Q: Can I take classes only before exams or for short-term preparation?
A: Yes. Many teachers accept short-term or revision-based students depending on availability.

CHOOSING AND EVALUATING TUTORS
Q: Should I take a trial class before finalising?
A: Yes. A trial class helps evaluate teaching style and student comfort. Availability depends on the teacher.

Q: What signs indicate a good tutor fit?
A: Clear explanations, student comfort, structured teaching, regular feedback, and realistic expectations.

Q: What if my child feels uncomfortable with a tutor?
A: You may discontinue and choose another tutor anytime. Student comfort is important.

Q: Do experienced teachers always mean better teaching?
A: Not necessarily. Teaching compatibility and communication style matter as much as experience.

COMMUNICATION AND INTERACTION
Q: Can I communicate with teachers through Shikshaq after connecting?
A: After initial contact, communication happens directly between you and the teacher.

Q: Will Shikshaq remind teachers about my enquiry?
A: If a teacher does not respond, you may contact us and we will attempt follow-up within 48 hours.

Q: Can teachers contact me without permission?
A: Teachers can only contact you if you initiate contact with them.

TRUST AND TRANSPARENCY
Q: Why do some teachers have more reviews than others?
A: Teachers who have taught more students through the platform or received more feedback will naturally have more reviews.

Q: Can new teachers join Shikshaq without reviews?
A: Yes. Some newer profiles may not yet have reviews.

Q: Should I avoid teachers without reviews?
A: Not necessarily. You can speak to them directly and request details about experience before deciding.

PAYMENTS AND PRACTICAL MATTERS (Set 3 continued)
Q: When should I discuss fees with the teacher?
A: Ideally during your first conversation before confirming classes.

Q: Do teachers provide study materials?
A: Some teachers provide notes or materials; others use textbooks. Confirm directly with the teacher.

Q: Who decides class frequency and duration?
A: You and the teacher mutually decide class structure.

Q: Does Shikshaq handle refunds?
A: No. Since payments are made directly to teachers, refund discussions must happen between you and the teacher.

PLATFORM EVOLUTION
Q: How often are teacher profiles updated?
A: Profiles are periodically reviewed, but availability and details should always be confirmed directly with the teacher.

Q: Can teachers leave the platform after I start classes?
A: Yes. Teachers operate independently. You are free to contact another tutor anytime if needed.

Q: How does Shikshaq maintain quality on the platform?
A: Through feedback monitoring, profile review, and community reporting.

PRACTICAL PARENT QUESTIONS
Q: Is Shikshaq suitable for younger students (primary classes)?
A: Yes. Tutors are available for early-grade foundational learning as well.

Q: Can siblings study together with one tutor?
A: Many teachers allow combined sessions; discuss this directly with the tutor.

Q: What if I am unsure what kind of tutor my child needs?
A: You may speak to multiple teachers first and choose based on comfort and teaching approach.

FIRST-TIME USER DOUBTS (Set 4)
Q: I have never arranged private tuition before. Where should I start?
A: Browse tutors for your class and subject, shortlist a few profiles, speak to teachers, and try an initial class before deciding.

Q: Should I contact teachers or wait for them to contact me?
A: You should directly contact teachers you are interested in.

Q: Is it okay to speak to multiple tutors before deciding?
A: Yes. Comparing teachers helps you find the best fit.

Q: What details should I prepare before contacting a tutor?
A: Student's class, board, subjects, weak areas, preferred schedule, and locality.

PARENT DECISION CONCERNS
Q: How do I know my child actually needs a tutor?
A: If the student needs concept clarity, exam preparation support, structured study habits, or confidence building, a tutor can help.

Q: How soon should I finalise a tutor after contacting them?
A: There is no deadline. Take time to compare teachers and discuss expectations.

Q: Can parents attend or observe the first class?
A: Yes. Many parents choose to observe initial sessions.

Q: Should tuition be long-term or exam-focused only?
A: Both options exist. Discuss goals with the teacher before starting.

TEACHING STYLE AND LEARNING FIT
Q: Can I request homework support instead of full teaching?
A: Yes. Many tutors customise sessions based on student needs.

Q: Can tutors help with school projects and assignments?
A: Some teachers assist with projects and assignments depending on subject and policy.

Q: What if my child is shy or takes time to adjust?
A: Give a few classes for adjustment. Communication between parent and teacher helps build comfort.

Q: Can tuition focus only on revision or doubt solving?
A: Yes. Many students take revision-only or doubt-clearing classes.

LOGISTICS AND CLASS ENVIRONMENT
Q: Where should home tuition ideally take place?
A: A quiet, well-lit study area with minimal distractions works best.

Q: What if my home location is difficult to access?
A: Confirm travel feasibility with the teacher before finalising.

Q: Can tuition timing change during exams or holidays?
A: Yes. Scheduling flexibility depends on mutual agreement.

Q: Do teachers continue classes during school vacations?
A: Some do, some pause. Confirm individually.

ONLINE TUITION CONCERNS
Q: Are online classes as effective as home tuition?
A: Effectiveness depends on student discipline and teacher engagement. Many students successfully learn online.

Q: What if internet issues interrupt a class?
A: Rescheduling policies depend on the teacher. Discuss beforehand.

Q: Can younger students take online tuition?
A: Yes, but parental supervision initially may help.

EXPECTATIONS AND BOUNDARIES
Q: Can I expect daily homework checking?
A: This varies by teacher. Clarify expectations early.

Q: Will tutors share exam strategies and study plans?
A: Many tutors provide structured preparation methods.

Q: Can tutors communicate directly with parents about progress?
A: Yes, if mutually agreed.

Q: Can I ask the tutor to coordinate with school teachers?
A: This depends entirely on the tutor's willingness.

REALISTIC OUTCOMES
Q: How long before improvement becomes visible?
A: Improvement timelines vary by student consistency, starting level, and class frequency.

Q: What if marks don't improve immediately?
A: Learning progress can take time. Review teaching approach and communication with the tutor.

Q: Is more tuition always better?
A: Not necessarily. Quality, consistency, and self-study matter more than hours.

PLATFORM TRANSPARENCY
Q: Why doesn't Shikshaq handle payments or bookings?
A: Shikshaq focuses on helping families discover tutors while allowing flexible direct arrangements between teachers and students.

Q: Why are teachers contacted directly instead of through the platform?
A: Direct contact enables faster communication and personalised discussion.

Q: Can I rely only on reviews while choosing?
A: Reviews help, but speaking with the teacher is equally important.

SAFETY AND PRACTICAL AWARENESS
Q: Should parents meet the tutor before starting home tuition?
A: Yes. A first interaction or discussion call is recommended.

Q: Can I verify teacher identity independently?
A: Yes. You may request ID or credentials directly from the teacher.

Q: What precautions should I take for home tuition?
A: Ensure initial supervision, clear expectations, and open communication.

LONG-TERM USAGE
Q: Can I return to Shikshaq later to find another tutor?
A: Yes. You may use Shikshaq anytime.

Q: Can one tutor teach multiple subjects?
A: Some teachers do; check their profile.

Q: Can tuition continue across academic years?
A: Yes, if both parties agree.
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get API key from environment variable
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    
    if (!apiKey) {
      console.error('GEMINI_API_KEY not found in environment variables');
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(apiKey);

    const systemPrompt = `You are a friendly AI assistant for Shikshaq, a free platform connecting students and parents with tuition teachers in Kolkata.

IMPORTANT RULES:
1. Answer the user's question using ONLY the FAQ below. If the question is covered in the FAQ, give that answer. Keep answers brief (1-3 sentences). Use a warm, helpful tone.
2. NEVER include HTML tags or links in your response - plain text only.
3. Only suggest contacting Shikshaq (WhatsApp +91 8240980312 or email join.shikshaq@gmail.com) when: (a) the user explicitly asks "how do I contact you" or "what is your WhatsApp" or similar, OR (b) the question is clearly not covered anywhere in the FAQ. Do NOT suggest WhatsApp for normal FAQ questions that are already answered below.
4. For questions outside Shikshaq (e.g. general knowledge, other topics), politely say you only answer questions about Shikshaq and they can contact the team for other help.
5. NEVER invent or name specific teachers, their experience, fees, or availability — you have no access to the live teacher database. If the user is looking for a teacher, tell them briefly you're pulling up real matching profiles (a system separate from you appends real teacher cards below your reply when a match exists) and keep your own text generic and short.

OFFICIAL SHIKSHAQ FAQ (use this to answer):
${SHIKSHAQ_FAQ}`;

    // Build conversation history for context (last 5 messages to keep it fast)
    // Convert history from frontend format to simple text
    const historyArray = Array.isArray(history) ? history : [];
    const recentHistory = historyArray.slice(-5);
    let conversationContext = '';
    if (recentHistory.length > 0) {
      conversationContext = '\n\nRecent conversation:\n';
      recentHistory.forEach((msg: { role?: string; parts?: { text?: string }[]; content?: string }) => {
        const role = msg.role === 'model' ? 'assistant' : msg.role || 'user';
        const content = msg.parts?.[0]?.text || msg.content || '';
        if (role === 'user') {
          conversationContext += `User: ${content}\n`;
        } else if (role === 'assistant' || role === 'model') {
          conversationContext += `Assistant: ${content}\n`;
        }
      });
    }

    // Use Gemini 2.5 Flash-Lite (fastest and available on free tier)
    // Fallback to other models if needed
    const modelsToTry = [
      'gemini-2.5-flash-lite',    // Fastest, free tier model
      'gemini-1.5-flash-latest',  // Latest flash model (fallback)
      'gemini-1.5-pro-latest',    // Latest pro model (fallback)
      'gemini-pro',                // Standard pro model (fallback)
    ];
    let lastError: Error | null = null;
    let result: { response: { text: () => string } } | null = null;

    // Concise prompt for faster processing
    const fullPrompt = `${systemPrompt}${conversationContext}\n\nUser: ${message}\n\nAssistant:`;

    for (const modelName of modelsToTry) {
      try {
        console.log(`Trying model: ${modelName}...`);
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: {
            maxOutputTokens: 250, // Allow 2-3 sentence FAQ answers
            temperature: 0.7, // Balanced creativity vs consistency
          },
        });

        // Timeout: 15 seconds (gemini-pro is reliable but may be slower)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 15000);
        });

        const generatePromise = model.generateContent(fullPrompt);
        result = await Promise.race([generatePromise, timeoutPromise]) as { response: { text: () => string } };
        
        console.log(`Success with model: ${modelName}`);
        break; // Success, exit loop
      } catch (modelError: unknown) {
        const err = modelError as Error;
        lastError = err;
        console.warn(`Model ${modelName} failed:`, err.message);
        // Continue to next model
      }
    }

    if (!result) {
      // All models failed
      const error = lastError || new Error('All models failed');
      console.error('Gemini API error:', {
        message: error.message,
        name: error.name,
        stack: error.stack?.substring(0, 200),
      });
      
      // If all models failed with 404, suggest checking available models
      if (error.message?.includes('404 Not Found') || error.message?.includes('is not found')) {
        console.error('Note: None of the models are available. Check Google AI Studio to see which models your API key has access to.');
        console.error('Common models: gemini-1.5-flash-latest, gemini-1.5-pro-latest, gemini-pro');
      }
      
      throw error;
    }

    const response = result.response;
    const text = response.text();

    // Independent of what the model said, look up real teachers matching the
    // user's own message so the frontend can append real TeacherCards.
    const teachers = await findMatchingTeachers(message);

    return res.status(200).json({ response: text, teachers });
  } catch (error: unknown) {
    const err = error as Error & { status?: number };
    console.error('Chat handler error:', {
      message: err.message,
      name: err.name,
      status: err.status,
    });

    // Return user-friendly error message
    return res.status(500).json({
      error: 'Failed to generate response',
      message: err.message?.includes('API key') 
        ? 'API key not configured' 
        : err.message?.includes('timeout')
        ? 'Request timeout - please try again'
        : 'Unable to generate response',
    });
  }
}
