import { useState } from 'react';
import { FeedbackModal } from '@/components/FeedbackModal';
import { usePageMeta } from '@/hooks/usePageMeta';
import { FAQSchema, type FAQItem } from '@/components/FAQSchema';
import { HelpFaqStack, type HelpFaqQuestion } from '@/components/help/HelpFaqStack';
import { useHelpTopics, topicToGuideBody } from '@/hooks/useHelpTopics';

// FAQPage JSON-LD content for this page. `category` (display-only, used by
// the HP-002 chip filter) is layered on top of this same question/answer
// data rather than a second copy, so the JSON-LD stays byte-identical.
const HELP_FAQS: HelpFaqQuestion[] = [
  {
    question: 'Is Shikshaq completely free?',
    answer:
      'Yes, Shikshaq is completely free for both students and tutors. There are no registration fees, subscription charges, or hidden costs.',
    category: 'general',
  },
  {
    question: 'How do I find a tutor on Shikshaq?',
    answer:
      'Simply visit shikshaq.in and use our search filters to find tutors by subject, board, class, location, and teaching mode. Browse verified tutor profiles and contact them directly.',
    category: 'finding',
  },
  {
    question: 'Does Shikshaq handle payments?',
    answer:
      'No, Shikshaq does not handle any payments. All fees are negotiated directly between students and tutors. We are a connection-only platform.',
    category: 'general',
  },
  {
    question: 'How are tutors verified on Shikshaq?',
    answer:
      'All tutors undergo a verification process that includes educational qualification verification and identity verification.',
    category: 'teachers',
  },
  {
    question: 'Which areas does Shikshaq serve?',
    answer:
      'Shikshaq currently serves Kolkata and surrounding areas including Howrah, Salt Lake, Jadavpur, Bhowanipore, Ballygunge, and many other localities.',
    category: 'general',
  },
];

const HELP_FAQS_SCHEMA: FAQItem[] = HELP_FAQS.map(({ question, answer }) => ({ question, answer }));

export default function Help() {
  usePageMeta(
    'Help, Contact and Common Questions | Shikshaq',
    'Need help finding a tuition teacher in Kolkata? Contact the Shikshaq team on WhatsApp or email, and learn how our free tutor matching works.'
  );

  const topics = useHelpTopics();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <>
      <FAQSchema faqs={HELP_FAQS_SCHEMA} url="/more" />
      <HelpFaqStack
        heading={{ line1: 'Help, and the', ordinal: '01', line2: 'questions we get' }}
        questionsHeading="Common questions"
        questions={HELP_FAQS}
        guides={topics.map((t) => ({ title: t.title, body: topicToGuideBody(t.body) }))}
        contactHeading="Still stuck?"
        contactBody="Send us a note and a real person replies, usually the same day."
        footerExtra={(
          <p className="mt-3 text-[13px] text-background/60">
            Got feedback instead of a question?{' '}
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="inline-flex min-h-11 items-center rounded align-middle text-[13px] text-background underline underline-offset-2 transition-opacity duration-tap hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
            >
              Tell us here
            </button>
          </p>
        )}
      />
      <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
