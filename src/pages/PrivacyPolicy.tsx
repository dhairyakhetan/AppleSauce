import { LegalReader, type LegalSection } from '@/pages/legal/reader';
import { usePageMeta } from '@/hooks/usePageMeta';

const pClass = 'max-w-prose text-warm-prose leading-relaxed';
const pMtClass = 'max-w-prose text-warm-prose leading-relaxed mt-3';
const h3Class = 'text-base font-semibold text-foreground mt-4 mb-2';
const ulClass = 'max-w-prose text-warm-prose leading-relaxed list-disc pl-6 space-y-1';
const ulPlainClass = 'max-w-prose text-warm-prose leading-relaxed list-none pl-0 space-y-1';
const linkClass = 'text-brand-blue underline';

const SECTIONS: LegalSection[] = [
  {
    n: '01',
    title: 'Introduction',
    short: 'By using Shikshaq you consent to this policy, and you can withdraw that consent any time.',
    body: (
      <>
        <p className={pClass}>
          Welcome to Shikshaq ("we," "our," or "us"). We are committed to protecting your privacy and
          ensuring transparency about how we collect, use, and safeguard your personal information. This
          Privacy Policy explains our practices regarding data collection, use, and disclosure when you use
          our website located at <strong>www.shikshaq.in</strong> (the "Service").
        </p>
        <p className={pMtClass}>
          By using our Service, you agree to the collection and use of information in accordance with this
          Privacy Policy. If you do not agree with our policies and practices, please do not use our Service.
        </p>
        <p className={pMtClass}>
          <strong>Consent:</strong> In accordance with the Digital Personal Data Protection Act, 2023, your
          consent to this Privacy Policy must be free, specific, informed, unconditional, and unambiguous. By
          creating an account, signing up, or using our Service, you provide your explicit consent to the
          collection, processing, and use of your personal information as described in this Privacy Policy.
          You have the right to withdraw your consent at any time, as described in Section 7 ("Your Rights
          and Choices").
        </p>
      </>
    ),
  },
  {
    n: '02',
    title: 'What we collect',
    short: 'Your name, your number or email, and what you searched for.',
    body: (
      <>
        <p className={pClass}>
          For students and guardians: name, WhatsApp number or email, the searches you run and the teachers
          you save or contact. For teachers: the same, plus the professional details you publish and the ID
          and degree documents you upload for verification.
        </p>
        <h3 className={h3Class}>2.1 Information you provide</h3>
        <p className={pClass}>We collect information that you voluntarily provide when you:</p>
        <ul className={ulClass}>
          <li>
            <strong>Create an account:</strong> When you sign up using Google OAuth, we collect your email
            address, full name, and profile picture from your Google account.
          </li>
          <li>
            <strong>Complete your profile:</strong> As a student, we may collect your phone number, address,
            date of birth, age, school/college name, grade/class, school board, and guardian email address.
          </li>
          <li>
            <strong>Guardian accounts:</strong> We collect your phone number, address, relationship to
            student, and information about the student you are managing (name, date of birth, grade, school
            board).
          </li>
          <li>
            <strong>Submit feedback:</strong> We collect your rating, comments, and optionally your email
            address (if you are not logged in).
          </li>
          <li>
            <strong>Interact with teachers:</strong> When you like teachers, upvote teachers, or leave
            comments, we collect this interaction data.
          </li>
          <li>
            <strong>Recommend teachers:</strong> When you recommend a teacher, we collect the teacher
            information you provide.
          </li>
        </ul>
        <h3 className={h3Class}>2.2 Automatically collected information</h3>
        <ul className={ulClass}>
          <li>
            <strong>Authentication data:</strong> We store authentication session tokens in your browser's
            localStorage to maintain your login session.
          </li>
          <li>
            <strong>Usage data:</strong> We may collect information about how you access and use our Service,
            including pages visited, time spent on pages, and navigation patterns.
          </li>
          <li>
            <strong>Device information:</strong> We may collect information about your device, including
            browser type, operating system, and device identifiers.
          </li>
          <li>
            <strong>Which papers and contacts you open:</strong> When you open a past paper or reveal a
            teacher's contact details, we record that it happened, tied to your account, along with a
            one-way hash of your network address. We record that you opened a paper. We do not record how
            long you spent on it, what you wrote, or anything you did inside it.
          </li>
        </ul>
        <p className={pMtClass}>
          That last record exists for one reason, and we would rather say it plainly than bury it. The
          question papers and the teacher listings took years to gather, and people do try to copy them in
          bulk. Keeping a short log of what was opened is how we tell a student working through past papers
          apart from a script downloading all of them. It is not used to profile you, it is not sold, it is
          not shared with advertisers, and it is deleted after 90 days.
        </p>
      </>
    ),
  },
  {
    n: '03',
    title: 'Why we collect it',
    short: 'To connect you with a teacher, and to keep the listings honest.',
    body: (
      <>
        <p className={pClass}>
          Your number lets a teacher reply to you. Your saves and contacts let you pick up where you left
          off. Verification documents let us check that a teacher is who they say they are. That is the
          only reason we ask for them.
        </p>
        <p className={pMtClass}>We use the collected information for the following purposes:</p>
        <ul className={ulClass}>
          <li>
            <strong>To provide and maintain our Service:</strong> To create and manage your account,
            authenticate you, and provide access to our platform.
          </li>
          <li>
            <strong>To personalize your experience:</strong> To show you relevant teachers based on your
            preferences, grade, subjects, and location.
          </li>
          <li>
            <strong>To enable communication:</strong> To facilitate direct communication between
            students/parents and teachers via WhatsApp.
          </li>
          <li>
            <strong>To improve our Service:</strong> To analyze usage patterns, gather feedback, and enhance
            user experience.
          </li>
          <li>
            <strong>To provide customer support:</strong> To respond to your inquiries, provide technical
            support, and address your concerns.
          </li>
          <li>
            <strong>To send notifications:</strong> To send you important updates about your account or our
            Service (you can opt out of non-essential communications).
          </li>
          <li>
            <strong>To ensure security:</strong> To detect, prevent, and address technical issues, fraud, or
            security threats.
          </li>
        </ul>
      </>
    ),
  },
  {
    n: '04',
    title: 'Who sees what, and third-party services',
    short: 'Teachers see your name and number only after you message them. We never sell, rent, or hand data to ad networks.',
    body: (
      <>
        <p className={pClass}>
          Your searches and saved teachers are private to you. Teacher applications and contact details are
          visible only to Shikshaq's admins and the teacher reviewers they or the HOD appoint. Each such
          action is logged. Verification documents are never published or shared with another teacher or a
          school.
        </p>
        <h3 className={h3Class}>4.1 Google OAuth</h3>
        <p className={pClass}>
          When you sign in with Google, we use Google OAuth 2.0 to authenticate you. We only request the
          following scopes: <strong>openid</strong>, <strong>email</strong>, and <strong>profile</strong>. We
          do not request or store Google access tokens or refresh tokens. We only receive your basic profile
          information (email, name, profile picture) and a secure session token from our authentication
          provider (Supabase).
        </p>
        <p className={pMtClass}>
          Your Google account data is processed according to{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className={linkClass}>
            Google's Privacy Policy
          </a>
          . We do not have access to your Google password or other Google account data beyond what you
          authorize.
        </p>
        <h3 className={h3Class}>4.2 Supabase</h3>
        <p className={pClass}>
          We use Supabase as our backend service provider for database storage and authentication. Your data
          is stored securely on Supabase's servers. Supabase processes your data according to their{' '}
          <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className={linkClass}>
            Privacy Policy
          </a>{' '}
          and{' '}
          <a href="https://supabase.com/security" target="_blank" rel="noopener noreferrer" className={linkClass}>
            Security practices
          </a>
          .
        </p>
        <h3 className={h3Class}>4.3 Google Gemini AI</h3>
        <p className={pClass}>
          We use Google Gemini AI to power our chatbot feature. When you interact with the chatbot, your
          messages are sent to Google's Gemini API to generate responses. Your chat messages are processed
          according to{' '}
          <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer" className={linkClass}>
            Google's Gemini API Terms
          </a>
          . We do not store your chat conversations permanently.
        </p>
        <h3 className={h3Class}>4.4 Data sharing</h3>
        <p className={pClass}>
          We do not sell, trade, or rent your personal information to third parties. We have been asked to
          sell "parent leads" and we have said no every time. There is no version of Shikshaq where your
          number becomes someone's marketing list. We may share your information only in the following
          circumstances:
        </p>
        <ul className={ulClass}>
          <li>
            <strong>With your consent:</strong> When you explicitly authorize us to share your information.
          </li>
          <li>
            <strong>Service providers:</strong> With trusted third-party service providers who assist us in
            operating our Service (e.g., Supabase for database and authentication, Vercel for hosting).
          </li>
          <li>
            <strong>Legal requirements:</strong> When required by law, court order, or government regulation.
          </li>
          <li>
            <strong>Protection of rights:</strong> To protect our rights, privacy, safety, or property, or
            that of our users or others.
          </li>
        </ul>
      </>
    ),
    bullets: [
      'Reviews show your first name and class, never your number.',
      'Paper reading history is private; teachers cannot see it.',
      'We do not show your exact address anywhere, only your locality.',
    ],
  },
  {
    n: '05',
    title: 'Data storage and security',
    short: 'We encrypt your data and lock it down, but no system is ever 100% secure.',
    body: (
      <>
        <p className={pClass}>
          We implement appropriate technical and organizational security measures to protect your personal
          information against unauthorized access, alteration, disclosure, or destruction. These measures
          include:
        </p>
        <ul className={ulPlainClass}>
          <li>a) Encryption of data in transit using HTTPS/TLS</li>
          <li>b) Secure authentication through Supabase Auth</li>
          <li>c) Row-level security policies in our database</li>
          <li>d) Regular security assessments and updates</li>
          <li>e) Limited access to personal data on a need-to-know basis</li>
        </ul>
        <p className={pMtClass}>
          However, no method of transmission over the Internet or electronic storage is 100% secure. While we
          strive to use commercially acceptable means to protect your information, we cannot guarantee
          absolute security.
        </p>
      </>
    ),
  },
  {
    n: '06',
    title: 'Cookies and local storage',
    short: 'We store a login token in your browser, not tracking or advertising cookies.',
    body: (
      <>
        <p className={pClass}>
          We use browser localStorage to store your authentication session tokens. This allows you to remain
          logged in across browser sessions. The session tokens are encrypted and managed by Supabase Auth.
        </p>
        <p className={pMtClass}>
          We do not use cookies for tracking or advertising purposes. You can clear your browser's
          localStorage at any time, which will log you out of the Service.
        </p>
      </>
    ),
  },
  {
    n: '07',
    title: 'Your rights and choices',
    short: 'Ask for your data, correct it, or have it deleted. By WhatsApp is fine.',
    body: (
      <>
        <p className={pClass}>
          You do not need a formal letter. Message us and we will send everything we hold about you within a
          week, fix anything wrong, or delete it. If you want your reviews removed along with your account,
          say so and they go too.
        </p>
        <p className={pMtClass}>You have the following rights regarding your personal information:</p>
        <ul className={ulClass}>
          <li>
            <strong>Access:</strong> You can access and review your personal information through your account
            dashboard.
          </li>
          <li>
            <strong>Correction:</strong> You can update or correct your personal information at any time
            through your account settings.
          </li>
          <li>
            <strong>Deletion:</strong> You can request deletion of your account and associated data by
            contacting us at{' '}
            <a href="mailto:ngo.aquaterra@gmail.com" className={linkClass}>
              ngo.aquaterra@gmail.com
            </a>
            .
          </li>
          <li>
            <strong>Data portability:</strong> You can request a copy of your data in a machine-readable
            format.
          </li>
          <li>
            <strong>Withdraw consent:</strong> You can withdraw your consent for data processing at any time,
            though this may limit your ability to use certain features of the Service.
          </li>
          <li>
            <strong>Opt-out:</strong> You can opt out of non-essential communications from us.
          </li>
          <li>
            <strong>Right to nominate:</strong> In accordance with the Digital Personal Data Protection Act,
            2023, you have the right to nominate an individual who shall exercise your rights in the event of
            your death or incapacity. To nominate someone, please contact us with the nominee's details and
            your explicit consent for such nomination.
          </li>
        </ul>
        <p className={pMtClass}>
          To exercise any of these rights, please contact us using the information provided in the "Contact
          Us" section below.
        </p>
      </>
    ),
  },
  {
    n: '08',
    title: 'Data retention',
    short: 'While your account is open, plus a short window after you delete it.',
    body: (
      <>
        <p className={pClass}>
          Delete your account and we remove your profile and contact details within seven days. Verification
          documents are deleted as soon as a decision is made, approved or not. We keep a minimal record
          that a decision happened, for the audit log.
        </p>
        <p className={pMtClass}>
          We retain your personal information for as long as necessary to fulfill the purposes outlined in
          this Privacy Policy, unless a longer retention period is required or permitted by law.
          Specifically:
        </p>
        <ul className={ulClass}>
          <li>
            <strong>Account data:</strong> Retained until you delete your account or request deletion.
          </li>
          <li>
            <strong>Feedback:</strong> Retained for service improvement purposes, but can be anonymized upon
            request.
          </li>
          <li>
            <strong>Interaction data:</strong> (likes, upvotes, comments) Retained as long as your account is
            active.
          </li>
          <li>
            <strong>Authentication data:</strong> Session tokens are automatically deleted when you log out
            or after a period of inactivity.
          </li>
          <li>
            <strong>Records of papers and contacts opened:</strong> Deleted after 90 days, whether or not
            your account is still open. Deleting your account removes the link to you immediately.
          </li>
        </ul>
        <p className={pMtClass}>
          When you delete your account, we will delete or anonymize your personal information, except where
          we are required to retain it for legal or regulatory purposes.
        </p>
      </>
    ),
  },
  {
    n: '09',
    title: "Children's privacy",
    short: 'Students under 18 are welcome, with a guardian aware of it.',
    body: (
      <>
        <p className={pClass}>
          We do not knowingly collect a phone number from a child without a guardian involved. If you are a
          parent and want your child's data removed, tell us and it is done that day.
        </p>
        <p className={pMtClass}>
          Our Service is designed to connect students, parents, and guardians with tuition teachers. We
          recognize that students of various ages, including those in primary and secondary education, may
          use our Service.
        </p>
        <p className={pMtClass}>
          <strong>For minors under 18:</strong> In accordance with Indian law, including the Indian Contract
          Act, 1872 and the Digital Personal Data Protection Act, 2023, we do not knowingly collect personal
          information from minors (under the age of 18) without parental consent declaration. If you are
          under 18 years of age, you may only use our Service with the involvement and consent of a parent or
          guardian.
        </p>
        <p className={pMtClass}>
          <strong>Parental consent required:</strong> Before collecting any personal information from a user
          under 18, we require a declaration that parental consent has been obtained. By creating an account
          or using our Service, users under 18 (or their parents/guardians) declare that they have obtained
          appropriate parental consent. Parents and guardians are responsible for supervising their children's
          use of our Service and ensuring they understand how to use it safely.
        </p>
        <p className={pMtClass}>
          <strong>Parental rights:</strong> Parents and guardians have the right to:
        </p>
        <ul className={ulClass}>
          <li>Review the personal information collected from their child</li>
          <li>Request deletion of their child's personal information</li>
          <li>Refuse further collection of their child's personal information</li>
          <li>Withdraw consent at any time</li>
        </ul>
        <p className={pMtClass}>
          If you are a parent or guardian and believe we have collected information from your child without
          proper consent, please contact us immediately at{' '}
          <a href="mailto:ngo.aquaterra@gmail.com" className={linkClass}>
            ngo.aquaterra@gmail.com
          </a>{' '}
          or our Grievance Officer (details provided in Section 13).
        </p>
        <p className={pMtClass}>
          We do not knowingly collect personal information from minors under 18 without parental consent
          declaration. If we become aware that we have collected such information without proper consent
          declaration, we will take steps to delete it promptly.
        </p>
      </>
    ),
  },
  {
    n: '10',
    title: 'International data transfers',
    short: 'Some of our service providers process data outside India, including in the United States.',
    body: (
      <>
        <p className={pClass}>
          Our Service uses third-party services that may process your information in countries outside of
          India, including the United States and other countries where these services operate. Specifically:
        </p>
        <ul className={ulClass}>
          <li>
            <strong>Google services:</strong> When you use Google OAuth for authentication or interact with
            our AI chatbot (powered by Google Gemini), your data is processed by Google's servers, which are
            located primarily in the United States and other countries where Google operates.
          </li>
          <li>
            <strong>Supabase:</strong> Our database and authentication services are hosted by Supabase, which
            may store your data in data centers located outside of India, depending on your Supabase
            project's region configuration.
          </li>
          <li>
            <strong>Hosting services:</strong> Our website is hosted on platforms that may process your data
            in various global locations.
          </li>
        </ul>
        <p className={pMtClass}>
          These countries may have data protection laws that differ from those in India. By using our
          Service, you consent to the transfer of your information to these countries. We ensure that our
          service providers implement appropriate safeguards to protect your information in accordance with
          this Privacy Policy and applicable data protection standards.
        </p>
        <p className={pMtClass}>
          If you are located in a region with specific data protection requirements (such as the European
          Union under GDPR), please contact us to discuss how we can accommodate your data residency
          preferences.
        </p>
      </>
    ),
  },
  {
    n: '11',
    title: 'Changes to this Privacy Policy',
    short: 'If this policy changes, we will post the update here and move the "last updated" date.',
    body: 'We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last Updated" date. You are advised to review this Privacy Policy periodically for any changes. Changes to this Privacy Policy are effective when they are posted on this page.',
  },
  {
    n: '12',
    title: 'Contact us',
    short: 'Email, WhatsApp, or our website, whichever is easiest for you.',
    body: (
      <>
        <p className={pClass}>
          If you have any questions, concerns, or requests regarding this Privacy Policy or our data
          practices, please contact us:
        </p>
        <ul className={ulClass}>
          <li>
            <strong>Email:</strong>{' '}
            <a href="mailto:ngo.aquaterra@gmail.com" className={linkClass}>
              ngo.aquaterra@gmail.com
            </a>
          </li>
          <li>
            <strong>WhatsApp:</strong>{' '}
            {/* Our own WhatsApp support line, not a foreign destination like
                the Google/Supabase links elsewhere on this page — stays in
                this tab rather than forcing a new one open. */}
            <a href="https://wa.me/918240980312" className={linkClass}>
              +91 8240980312
            </a>
          </li>
          <li>
            <strong>Website:</strong>{' '}
            <a href="https://www.shikshaq.in" className={linkClass}>
              www.shikshaq.in
            </a>
          </li>
        </ul>
      </>
    ),
  },
  {
    n: '13',
    title: 'Grievance Officer',
    short: 'A named Grievance Officer, reachable directly, who must respond within 24 hours and resolve within 15 days.',
    body: (
      <>
        <p className={pClass}>
          In accordance with the Information Technology Act, 2000 and the Information Technology
          (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, we have designated a Grievance
          Officer to address your concerns and complaints regarding:
        </p>
        <ul className={ulClass}>
          <li>Violation of your privacy rights</li>
          <li>Unauthorized access or use of your personal information</li>
          <li>Any other grievances related to data protection or privacy</li>
        </ul>
        <p className={pMtClass}>
          <strong>Grievance Officer:</strong>
        </p>
        <ul className={ulClass}>
          <li>
            <strong>Name:</strong> Krish Goenka
          </li>
          <li>
            <strong>Designation:</strong> Grievance Officer
          </li>
          <li>
            <strong>Email:</strong>{' '}
            <a href="mailto:krishgoenka96749@gmail.com" className={linkClass}>
              krishgoenka96749@gmail.com
            </a>
          </li>
          <li>
            <strong>Phone/WhatsApp:</strong>{' '}
            {/* Our own WhatsApp support line, not a foreign destination like
                the Google/Supabase links elsewhere on this page — stays in
                this tab rather than forcing a new one open. */}
            <a href="https://wa.me/918240980312" className={linkClass}>
              +91 8240980312
            </a>
          </li>
          <li>
            <strong>Official correspondence address:</strong> Madhuvan, 17/1G, Alipore Road, Kolkata - 700027,
            West Bengal, India.
          </li>
        </ul>
        <p className={pMtClass}>
          <strong>Response time:</strong> We will acknowledge your grievance within 24 hours and resolve it
          within 15 days from the date of receipt, in accordance with applicable Indian laws.
        </p>
        <p className={pMtClass}>When contacting the Grievance Officer, please provide:</p>
        <ul className={ulClass}>
          <li>Your name and contact information</li>
          <li>Description of the grievance</li>
          <li>Relevant details and supporting documents (if any)</li>
        </ul>
      </>
    ),
  },
  {
    n: '14',
    title: 'Governing law',
    short: 'Indian law applies, and any dispute goes exclusively to the courts in Kolkata.',
    body: 'This Privacy Policy is governed by and construed in accordance with the laws of India. Any disputes arising from or relating to this Privacy Policy shall be subject to the exclusive jurisdiction of the courts in Kolkata, West Bengal, India.',
  },
];

export default function PrivacyPolicy() {
  usePageMeta(
    'Privacy Policy | Shikshaq',
    'How Shikshaq collects, uses, and protects your personal data when you search for or list as a tuition teacher in Kolkata.'
  );

  return (
    <LegalReader
      pill="what we hold, and why"
      pillTone="blue"
      h1="What we know about you"
      lede="Short version: your phone number is the only sensitive thing we hold, we never sell it, and it is shown to a teacher only when you choose to message them. Each section below opens with the plain-English version, followed by the exact clause it summarizes."
      updated="Last updated 8 October 2026 · written to be read, not skimmed"
      accent="blue"
      summary={[
        { head: 'We never sell data', text: 'Not to coaching centres, not to advertisers, not to anyone. There is no data business here.', tone: 'blue' },
        { head: 'Your number stays hidden', text: 'It is shown to a teacher only when you tap WhatsApp yourself.', tone: 'bone' },
        { head: 'No ad trackers', text: 'We count page views to know what is used. No advertising pixels.', tone: 'muted' },
        { head: 'Delete means delete', text: 'Ask us and it goes, including your reviews if you want them gone.', tone: 'mint' },
      ]}
      sections={SECTIONS}
      footHead="Want your data, or want it gone?"
      footBody="Ask on WhatsApp or by email. We will send you everything we hold within a week, or delete it. Your choice, and no questions asked."
      crossLink={{ label: 'Terms of use', href: '/terms-of-service' }}
    />
  );
}
