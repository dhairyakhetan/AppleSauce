import { LegalReader, type LegalSection } from '@/pages/legal/reader';
import { usePageMeta } from '@/hooks/usePageMeta';
import { FREE_PREVIEW_WORD } from '@/lib/free-preview';

const pClass = 'max-w-prose text-warm-prose leading-relaxed';
const pMtClass = 'max-w-prose text-warm-prose leading-relaxed mt-3';
const h3Class = 'text-base font-semibold text-foreground mt-4 mb-2';
const ulClass = 'max-w-prose text-warm-prose leading-relaxed list-disc pl-6 space-y-1';
const calloutClass = 'max-w-prose text-warm-prose leading-relaxed mt-3 p-4 rounded-lg bg-brand-subtle';

const SECTIONS: LegalSection[] = [
  {
    n: '01',
    title: 'Introduction and acceptance',
    short: 'By using Shikshaq you accept these Terms. Read them like a contract, because they are one.',
    body: (
      <>
        <p className={pClass}>
          Welcome to Shikshaq ("Company," "we," "our," or "us"). By accessing or using our website located
          at <strong>www.shikshaq.in</strong> (the "Platform"), you agree to be bound by these Terms of
          Service ("Terms") and our Privacy Policy.
        </p>
        <p className={calloutClass}>
          <strong>PLEASE READ CAREFULLY:</strong> These Terms constitute a legally binding agreement between
          you and Shikshaq. If you do not agree to these Terms, you must not access or use the Platform. By
          clicking "I Agree," signing up, or using the Platform, you acknowledge that you have read,
          understood, and agreed to be bound by these Terms.
        </p>
      </>
    ),
  },
  {
    n: '02',
    title: 'What we do, and what we do not',
    short: 'We introduce you to teachers. Everything after that is between you and them.',
    body: (
      <>
        <p className={pClass}>
          We publish teacher listings, help you find them, and hand you to WhatsApp. We do not set fees,
          schedule classes, supervise teaching, guarantee results, or take responsibility for what happens in
          a class.
        </p>
        <h3 className={h3Class}>2.1 Platform only</h3>
        <p className={pClass}>
          Shikshaq acts solely as a technology intermediary that connects students/parents ("Students") with
          independent tutors ("Teachers").
        </p>
        <h3 className={h3Class}>2.2 No employer-employee relationship</h3>
        <p className={pClass}>
          Teachers are independent contractors and not employees, agents, partners, or representatives of
          Shikshaq. We do not direct, control, or supervise the manner in which classes are conducted.
        </p>
        <h3 className={h3Class}>2.3 No agency</h3>
        <p className={pClass}>
          Shikshaq is not an agent for either the Student or the Teacher. We do not have the authority to
          bind either party to any agreement.
        </p>
      </>
    ),
    bullets: [
      'We are not an employment agency and teachers are not our employees.',
      'We do not mediate fee disputes, though we will remove a teacher who behaves badly.',
      'We do not promise that any teacher is available, or that anyone will reply.',
    ],
  },
  {
    n: '03',
    title: 'Who can use Shikshaq',
    short: 'Anyone 18 or over, and students under 18 with a guardian’s knowledge.',
    body: (
      <>
        <h3 className={h3Class}>3.1 Age requirement</h3>
        <p className={pClass}>You must be at least 18 years old to create an account.</p>
        <h3 className={h3Class}>3.2 Minors</h3>
        <p className={pClass}>
          If you are a student under 18, you may only use the Platform under the supervision of a parent or
          legal guardian who agrees to be bound by these Terms. The Parent/Guardian assumes full
          responsibility for the minor's use of the Platform.
        </p>
      </>
    ),
  },
  {
    n: '04',
    title: 'Listing as a teacher',
    short: 'Be truthful, keep it current, and expect a human to read it.',
    body: 'Everything on your profile must be true: your name, your qualifications, your years of experience, the subjects and boards you actually teach. We read every application and may ask for another document before publishing. We can unpublish a listing that turns out to be inaccurate.',
    bullets: [
      'Do not list someone else, or use a photo that is not you.',
      'Keep your rate and availability current. Stale listings get quiet, then hidden.',
      'You are responsible for your own tax and legal obligations.',
    ],
  },
  {
    n: '05',
    title: 'Disclaimers regarding teachers',
    short: 'We connect you to teachers; we do not vet, employ, or vouch for them.',
    body: (
      <>
        <p className={pClass}>
          To the fullest extent permitted by Indian law, specifically the Information Technology Act, 2000:
        </p>
        <h3 className={h3Class}>5.1 No warranty of quality</h3>
        <p className={pClass}>
          Shikshaq makes no representations or warranties regarding the teaching skills, credentials,
          academic background, character, or suitability of any Teacher.
        </p>
        <h3 className={h3Class}>5.2 No background checks</h3>
        <p className={pClass}>
          Unless explicitly stated otherwise, Shikshaq does not conduct criminal background checks or police
          verification of Teachers. It is the sole responsibility of the Student/Parent to verify the
          Teacher's credentials and identity before engaging their services.
        </p>
        <h3 className={h3Class}>5.3 User responsibility</h3>
        <p className={pClass}>
          You agree that you are solely responsible for conducting your own due diligence before meeting a
          Teacher or allowing them into your home.
        </p>
      </>
    ),
  },
  {
    n: '06',
    title: 'Limitation of liability',
    short: 'We are not liable for what happens off-platform, and our total liability is capped.',
    body: (
      <>
        <h3 className={h3Class}>6.1 Interactions off-platform</h3>
        <p className={pClass}>
          Shikshaq is not liable for any interactions, conduct, or transactions that occur off the Platform,
          including but not limited to:
        </p>
        <ul className={ulClass}>
          <li>In-person home tuition sessions.</li>
          <li>Phone calls or WhatsApp messages.</li>
          <li>Private monetary transactions.</li>
        </ul>
        <h3 className={h3Class}>6.2 No liability for conduct</h3>
        <p className={pClass}>
          In no event shall Shikshaq be liable for any direct, indirect, punitive, incidental, special, or
          consequential damages arising out of:
        </p>
        <ul className={ulClass}>
          <li>Physical or emotional injury, bodily harm, or distress caused by a Teacher or Student.</li>
          <li>Property damage, theft, or loss of items during home visits.</li>
          <li>Academic failure or lack of progress by the Student.</li>
          <li>Sexual harassment, misconduct, or inappropriate behavior by any user.</li>
        </ul>
        <h3 className={h3Class}>6.3 Cap on liability</h3>
        <p className={pClass}>
          To the maximum extent permitted by law, Shikshaq's total liability to you for any claim arising out
          of these Terms shall be limited to the amount of fees paid by you to Shikshaq in the 3 months
          preceding the claim, or ₹1,000 (Indian Rupees One Thousand), whichever is lower.
        </p>
      </>
    ),
  },
  {
    n: '07',
    title: 'User conduct and safety',
    short: 'Keep it civil. We can remove you, and disputes between users are yours to resolve.',
    body: (
      <>
        <h3 className={h3Class}>7.1 Prohibited content</h3>
        <p className={pClass}>
          Users shall not transmit any content that is grossly harmful, harassing, blasphemous, defamatory,
          obscene, pornographic, pedophilic, libelous, invasive of another's privacy, or racially/ethnically
          objectionable.
        </p>
        <h3 className={h3Class}>7.2 Safety disputes</h3>
        <p className={pClass}>
          If a dispute arises between a Student and Teacher (e.g., fee non-payment, scheduling, behavior),
          Shikshaq is under no obligation to become involved or resolve the dispute. You release Shikshaq
          from all claims, demands, and damages arising out of such disputes.
        </p>
      </>
    ),
  },
  {
    n: '08',
    title: 'Fees and money',
    short: 'Your fee is yours. We take nothing from it, ever.',
    body: (
      <>
        <p className={pClass}>
          Teachers set their own rate and keep all of it. We never process payments, so please do not send
          money through Shikshaq or to anyone claiming to collect on our behalf. If someone asks you to pay
          Shikshaq, that is a scam. Tell us.
        </p>
        <h3 className={h3Class}>8.1 Direct tuition payments</h3>
        <p className={pClass}>
          Tuition fees for classes are negotiated and paid directly between the Student and the Teacher.
          Shikshaq is not a party to these transactions, does not hold funds on behalf of users, and is not
          responsible for refunds, non-payment, or fee disputes arising from these direct interactions.
        </p>
        <h3 className={h3Class}>8.2 Student access fees</h3>
        <p className={pClass}>
          Shikshaq reserves the right to charge Students a subscription or one-time fee to access Teacher
          contact details or premium features. Any such fee will be clearly disclosed on the Platform prior
          to payment and is non-refundable.
        </p>
        <h3 className={h3Class}>8.3 Teacher platform fees</h3>
        <ul className={ulClass}>
          <li>
            <strong>Current status:</strong> Listing a profile on Shikshaq is currently free for Teachers.
          </li>
          <li>
            <strong>Future rights:</strong> Shikshaq reserves the absolute right to introduce listing fees,
            subscription plans, or lead-generation fees for Teachers in the future.
          </li>
          <li>
            <strong>Notification:</strong> We will provide reasonable notice to Teachers before implementing
            any mandatory fees. Continued use of the Platform after such fees are introduced constitutes your
            agreement to the new pricing structure.
          </li>
        </ul>
        <h3 className={h3Class}>8.4 Taxes</h3>
        <p className={pClass}>
          Users (both Students and Teachers) are solely responsible for determining their own tax liabilities
          and reporting any income generated through connections made on the Platform. Shikshaq is not
          responsible for withholding or paying taxes on behalf of any user.
        </p>
      </>
    ),
  },
  {
    n: '09',
    title: 'Past papers',
    short: 'The papers belong to the schools that set them. We host them for reading only.',
    body: `Papers are shared by students and hosted for revision. The first ${FREE_PREVIEW_WORD} questions of any paper are free to read with no account; a free account unlocks the rest. Downloading, reposting or selling them is not allowed.`,
  },
  {
    n: '10',
    title: 'Reviews',
    short: 'Only people who actually contacted a teacher can review them, and teachers cannot edit reviews.',
    body: 'A review can only be left after a contact is recorded. We remove reviews that contain abuse, personal contact details, or an attempt to pull business off the platform. We do not remove an honest bad review because a teacher asked.',
  },
  {
    n: '11',
    title: 'Indemnification',
    short: 'If your actions cause us legal trouble, you agree to cover the cost.',
    body: (
      <>
        <p className={pClass}>
          You agree to defend, indemnify, and hold harmless Shikshaq, its founders, directors, employees, and
          agents from and against any claims, liabilities, damages, losses, and expenses (including legal
          fees) arising out of:
        </p>
        <ul className={ulClass}>
          <li>Your violation of these Terms.</li>
          <li>Your violation of any third-party right, including privacy rights.</li>
          <li>Your interaction with any other User (Student or Teacher).</li>
          <li>Any claim that your content caused damage to a third party.</li>
        </ul>
      </>
    ),
  },
  {
    n: '12',
    title: 'Ending it',
    short: 'You can delete your account whenever. We can close one that harms other people, without notice.',
    body: (
      <>
        <p className={pClass}>
          Delete your account from the account screen and your listing disappears from search immediately.
          We may suspend an account for false information, harassment, or trying to charge for something we
          give away free. Where we can, we tell you why first.
        </p>
        <p className={pMtClass}>
          Shikshaq reserves the right to suspend or terminate your account immediately, without notice, if we
          believe you have violated these Terms or posed a safety risk to our community.
        </p>
      </>
    ),
  },
  {
    n: '13',
    title: 'Governing law and jurisdiction',
    short: 'Indian law applies, and any dispute goes exclusively to the courts in Kolkata.',
    body: 'These Terms shall be governed by the laws of India. You agree that any legal action or proceeding arising out of or relating to these Terms shall be brought exclusively in the courts located in Kolkata, West Bengal.',
  },
];

export default function TermsOfService() {
  usePageMeta(
    'Terms of Service | Shikshaq',
    'The terms that govern your use of Shikshaq, the free tutor-student matchmaking platform connecting students with verified tuition teachers in Kolkata.'
  );

  return (
    <LegalReader
      pill="plain English, then the clauses"
      pillTone="brand"
      h1="What you agree to"
      lede="Shikshaq is a place to find a teacher and read past papers. We introduce people; we are not a tuition agency, an employer, or a party to the classes you arrange. Each section below opens with the plain-English version, followed by the exact clause it summarizes."
      updated="Last updated 27 September 2026"
      accent="brand"
      summary={[
        { head: 'Free to use', text: 'For students, guardians and teachers. No listing fee or commission today. Any future fee is announced first (section 08).', tone: 'bone' },
        { head: 'We do not take the money', text: 'Fees are settled directly between you and the teacher. We never invoice or hold a deposit.', tone: 'brand' },
        { head: 'We verify, we do not vouch', text: 'We check ID and degree. We cannot guarantee anyone’s teaching.', tone: 'muted' },
        { head: 'You can leave', text: 'Delete your account whenever. Teachers can unlist in one tap.', tone: 'mint' },
      ]}
      sections={SECTIONS}
      footHead="Something here unclear?"
      footBody="Ask us in normal words and we will answer in normal words. If a clause needs to change, we would rather rewrite it than argue about it."
      copyrightSectionN="09"
      crossLink={{ label: 'Privacy policy', href: '/privacy-policy' }}
    />
  );
}
