import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { HelpCircle, MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TeacherCard } from '@/components/TeacherCard';
import { getWhatsAppLink } from '@/utils/whatsapp';
import { useExitPresence } from '@/hooks/useExitPresence';
import { useIsChromelessRoute } from '@/components/layout/AppShell';
import DOMPurify from 'dompurify';

interface ChatTeacher {
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

interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Real teacher records matched against this reply — rendered as TeacherCards, not prose. */
  teachers?: ChatTeacher[];
}

// pages.md §19: shown as 34px chips above the composer only while the thread is empty.
const SUGGESTED_PROMPTS = [
  'Find a Maths teacher for Class 10',
  'Teachers near me',
  'Past papers for ICSE',
  'Is Shikshaq free?',
  'How do I contact a teacher?',
  'Verified teachers only',
];

// Quick responses for common FAQ questions (instant, no API call). Order matters: more specific first.
// Only add "contact" keywords when user is clearly asking how to reach Shikshaq support.
const QUICK_RESPONSES: { keywords: string[]; response: string }[] = [
  {
    keywords: ['pay through shikshaq', 'pay shikshaq', 'payment to shikshaq', 'where does payment go', 'commission', 'who do i pay'],
    response: 'All payments are made directly to the teacher. Shikshaq does not handle payments and takes zero commission. Fees are decided between you and the teacher.',
  },
  {
    keywords: ['free', 'cost', 'price', 'charge', 'platform fee', 'hidden fee'],
    response: 'Yes! Shikshaq is completely free for students and parents. There are no platform charges or hidden fees. You only pay tuition fees directly to the teacher.',
  },
  {
    keywords: ['which city', 'which cities', 'which localities', 'where does shikshaq', 'kolkata only', 'other cities'],
    response: 'Shikshaq currently operates only in Kolkata and covers most major localities. Expansion to other cities is planned for the future.',
  },
  {
    keywords: ['which class', 'which grade', 'which boards', 'icse', 'cbse', 'ib', 'igcse', 'state board'],
    response: 'Shikshaq supports Classes 1-12, UG, and PG. Boards supported: ICSE/ISC, CBSE, IB, IGCSE, and State Boards.',
  },
  {
    keywords: ['how do i find', 'how to find tutor', 'find right tutor', 'choose tutor'],
    response: 'Use filters for subject, class, board, and locality. Compare profiles, experience, and student reviews. You can contact multiple teachers to find the best match.',
  },
  {
    keywords: ['how do i contact a teacher', 'contact teacher', 'message teacher', 'reach teacher'],
    response: 'Each teacher profile has a direct contact option. You can message or call them directly. No account needed to browse or contact.',
  },
  {
    keywords: ['what is shikshaq', 'what is shikshaq and how', 'about shikshaq', 'tell me about shikshaq'],
    response: 'Shikshaq helps students and parents discover tuition teachers in Kolkata. You browse profiles, compare experience and reviews, and contact teachers directly to start classes.',
  },
  {
    keywords: ['verified', 'verification', 'verified badge', 'are tutors verified'],
    response: 'A Verified badge means a Shikshaq team member has personally vouched for that teacher. Shikshaq does not guarantee teaching outcomes or accept liability.',
  },
  {
    keywords: ['reviews real', 'are reviews', 'reviews genuine', 'teacher reviews'],
    response: 'Reviews are from genuine student or parent experiences. Teachers cannot remove reviews; they help keep things transparent.',
  },
  {
    keywords: ['account', 'sign up', 'create account', 'do i need account'],
    response: 'No account is needed to browse or contact tutors. You can use Shikshaq without signing up.',
  },
  {
    keywords: ['who is shikshaq for', 'shikshaq for'],
    response: 'Shikshaq is for students and parents looking for reliable tutors across subjects, grades, boards, and exams.',
  },
  {
    keywords: ['negotiate fee', 'negotiate fees', 'trial class', 'demo class'],
    response: 'Fees and arrangements are agreed between you and the teacher. Trial or demo classes depend on the teacher, ask them when you contact.',
  },
  {
    keywords: ['responsibility', 'liable', 'shikshaq responsible', 'dispute', 'payment dispute'],
    response: 'Shikshaq is a discovery platform and does not take responsibility for teaching quality, payments, or disputes. All arrangements are between you and the teacher.',
  },
  {
    keywords: ['teacher not responding', 'teacher didn\'t reply', 'no response from teacher'],
    response: 'You can contact Team Shikshaq via Contact Us. We\'ll try to reach the teacher on your behalf within 48 hours.',
  },
  {
    keywords: ['change tutor', 'switch tutor', 'another tutor'],
    response: 'Yes. You can contact another tutor anytime, there\'s no commitment to stay with one teacher.',
  },
  {
    keywords: ['phone number safe', 'data safe', 'personal data', 'privacy'],
    response: 'Yes. Shikshaq doesn\'t sell or share your personal info. Only the teacher you contact sees your details.',
  },
  {
    keywords: ['what is on profile', 'teacher profile', 'profile shows'],
    response: 'Profiles show subjects, classes, boards, experience, locations, teaching mode (online/home), fees if provided, and student reviews.',
  },
  {
    keywords: ['online class', 'online classes', 'zoom', 'google meet'],
    response: 'Teachers usually use Zoom, Google Meet, or WhatsApp video. You need a stable connection, camera/mic, and a quiet space. Confirm the platform with the teacher.',
  },
  {
    keywords: ['group class', 'one to one', 'one-on-one', 'batch'],
    response: 'It depends on the teacher: some do group batches, others one-to-one. Ask when you contact them.',
  },
  {
    keywords: ['recommend a tutor', 'assign a tutor', 'suggest a tutor', 'shikshaq recommend'],
    response: 'Shikshaq doesn\'t assign or recommend one tutor. You browse profiles and choose teachers based on your preferences and reviews. You can contact multiple teachers to compare.',
  },
  {
    keywords: ['guarantee', 'improvement in marks', 'improve marks', 'results guaranteed'],
    response: 'Shikshaq doesn\'t guarantee marks or results. Academic performance depends on student effort, teacher compatibility, and regular practice.',
  },
  {
    keywords: ['trial class', 'demo before', 'try before finalising'],
    response: 'A trial class is a good idea to evaluate teaching style and comfort. Availability depends on the teacher, ask when you contact them.',
  },
  {
    keywords: ['stop classes', 'discontinue', 'leave tutor', 'not satisfied'],
    response: 'Yes. You can stop or change anytime. Continuation depends on mutual agreement between you and the teacher.',
  },
  {
    keywords: ['refund', 'refunds', 'shikshaq handle refund'],
    response: 'Shikshaq doesn\'t handle payments or refunds. Refund discussions are between you and the teacher since you pay them directly.',
  },
  {
    keywords: ['weekend class', 'weekend only', 'schedule change'],
    response: 'Scheduling (including weekend-only or timing changes) is decided directly between you and the teacher. Confirm with them.',
  },
  {
    keywords: ['first time', 'never had tuition', 'where to start'],
    response: 'Browse tutors for your class and subject, shortlist a few, speak to them, and try an initial class before deciding. You can compare 2-4 teachers.',
  },
  {
    keywords: ['how to contact you', 'contact shikshaq', 'whatsapp number', 'support number', 'reach you', 'customer support', 'contact support', 'your email', 'your whatsapp'],
    response: 'You can reach Team Shikshaq via WhatsApp at +91 8240980312 or email at ngo.aquaterra@gmail.com. We aim to respond within 48 hours.',
  },
];

export function Chatbot() {
  // Handoff O-011: the launcher yields entirely to the teacher profile's
  // floating WhatsApp contact bar rather than repositioning around it — two
  // stacked bottom-right FABs read as clutter, and the WhatsApp bar is the
  // page's one primary CTA.
  const location = useLocation();
  const hasFloatingCta = location.pathname.startsWith('/tuition-teachers/') && !location.pathname.endsWith('/whatsapp-click');
  // Same route-aware split as the toast (O-010): bottom nav vs chromeless
  // (auth, reader, wizard, admin).
  const chromeless = useIsChromelessRoute();
  const [isOpen, setIsOpen] = useState(false);
  // The launcher is fixed to the bottom-right on every page. On Home, the
  // overhanging SearchDesk's submit button lives in that same corner near
  // the top of the first fold, so the launcher used to sit on top of it
  // (z-40) and swallow the tap at 390px. Generalized fix: keep the launcher
  // hidden until the user has scrolled a little way down any page — it can
  // never cover a first-fold control anywhere, and stays visible once open.
  const [scrolledPastFold, setScrolledPastFold] = useState(false);
  // The launcher is also fixed at the same bottom-right screen coordinates
  // on every scrolling list (e.g. Browse's teacher cards). Whenever a card's
  // WhatsApp "Chat" pill happens to scroll into that region, the launcher
  // sat on top of it and actually intercepted the tap (elementFromPoint
  // returned the launcher's icon, not the button underneath) — a real
  // click-blocker, not just visual overlap. Fading it out and disabling
  // pointer-events while the page is actively scrolling closes that window;
  // it settles back to full opacity shortly after the scroll stops.
  const [isScrolling, setIsScrolling] = useState(false);
  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      setScrolledPastFold(window.scrollY > 280);
      setIsScrolling(true);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setIsScrolling(false), 220);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(idleTimer);
    };
  }, []);
  // The verifier and HOD screens have their own action bar at the bottom; on a
  // phone the launcher sat on top of "Ask the HOD" (7 Oct check). Work tools,
  // not a place to ask about tutors: no launcher there.
  const onWorkTool = /^\/(checker|hod)(\/|$)/.test(location.pathname);
  const launcherVisible = (scrolledPastFold || isOpen) && !hasFloatingCta && !onWorkTool;
  // Keep the panel mounted briefly on close so it can play a subtle exit
  // instead of vanishing the instant the close button is tapped.
  const panelPresence = useExitPresence(isOpen, 180);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I'm your Shikshaq assistant. How can I help you today?",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Allow opening chatbot from outside (e.g. FAQ "Ask our AI assistant" link)
  useEffect(() => {
    const openChat = () => setIsOpen(true);
    window.addEventListener('shikshaq-open-chat', openChat);
    return () => window.removeEventListener('shikshaq-open-chat', openChat);
  }, []);

  useEffect(() => {
    // Save current viewport scale before opening
    const savedViewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
    const viewport = document.querySelector('meta[name="viewport"]') as HTMLMetaElement;

    if (isOpen) {
      // Prevent horizontal scroll on mobile
      document.body.style.overflowX = 'hidden';
      
      // Prevent zoom by setting maximum-scale and user-scalable=no temporarily
      if (viewport) {
        viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
      }

      // Delay focus to reduce zoom effect
      const focusTimeout = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 300);

      return () => {
        clearTimeout(focusTimeout);
      };
    } else {
      // Restore viewport settings and overflow when closed
      if (viewport && savedViewport) {
        viewport.setAttribute('content', savedViewport);
      } else if (viewport) {
        viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
      }
      document.body.style.overflowX = '';
    }
  }, [isOpen]);

  const getQuickResponse = (message: string): string | null => {
    const lowerMessage = message.toLowerCase();
    
    // Check if message matches any quick response keywords
    for (const quickResponse of QUICK_RESPONSES) {
      const matchesKeyword = quickResponse.keywords.some(keyword => 
        lowerMessage.includes(keyword.toLowerCase())
      );
      
      if (matchesKeyword) {
        return quickResponse.response;
      }
    }
    
    return null;
  };

  const handleSend = async (override?: string) => {
    const raw = override ?? input;
    if (!raw.trim() || loading) return;

    const userMessage = raw.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    // Check for quick response first (instant, no API call)
    const quickResponse = getQuickResponse(userMessage);
    if (quickResponse) {
      // Small delay to make it feel natural
      await new Promise(resolve => setTimeout(resolve, 300));
      setMessages((prev) => [...prev, { role: 'assistant', content: quickResponse }]);
      return;
    }

    // If no quick response, use API
    setLoading(true);

    try {
      // Reduced timeout to 15 seconds
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          history: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.response) {
        throw new Error('No response from server');
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.response,
          teachers: Array.isArray(data.teachers) && data.teachers.length > 0 ? data.teachers : undefined,
        },
      ]);
    } catch (error: any) {
      if (import.meta.env.DEV) {
        console.error('Chat error:', error);
      }
      
      let errorMessage = "Sorry, I'm having trouble right now. ";
      
      if (error.name === 'AbortError' || error.message?.includes('timeout')) {
        errorMessage = "The request is taking too long. For quick answers, try asking 'Is Shikshaq free?' or 'How do I contact you?'. You can also reach us directly via WhatsApp (+91 8240980312).";
      } else if (error.message?.includes('API key')) {
        errorMessage = "The chatbot is temporarily unavailable. Please contact us directly via WhatsApp (+91 8240980312) or email (ngo.aquaterra@gmail.com).";
      } else {
        errorMessage += "Please contact us directly via WhatsApp (+91 8240980312) or email (ngo.aquaterra@gmail.com) for assistance.";
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: errorMessage,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Handoff O-011: 52x52 bg-card disc (not the old solid-brand fill),
          right-4, route-aware bottom offset — desktop never has a bottom
          nav to clear, so it always gets the smaller offset there.

          It carries a focus ring like every other control: it is tabbable
          (tabIndex flips with launcherVisible) but was the one interactive
          element on the page that gave a keyboard user nothing back. Ring in
          brand-blue, because the button itself is brand orange and an orange
          ring on orange is not a ring. */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed ${chromeless ? 'bottom-[calc(24px_+_env(safe-area-inset-bottom))]' : 'bottom-[calc(88px_+_env(safe-area-inset-bottom))]'} lg:bottom-[calc(24px_+_env(safe-area-inset-bottom))] right-4 z-40 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_10px_26px_rgba(0,0,0,.22)] hover:-translate-y-0.5 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-[transform,box-shadow,opacity] duration-200 ${
          launcherVisible
            ? isScrolling && !isOpen
              ? 'opacity-30 scale-90 pointer-events-none'
              : 'opacity-100'
            : 'pointer-events-none opacity-0'
        }`}
        aria-label="Ask AI"
        aria-hidden={!launcherVisible}
        tabIndex={launcherVisible ? 0 : -1}
      >
        <MessageSquare className="h-[22px] w-[22px]" />
      </button>

      {/* Chat Window - Uses part of screen, smaller on mobile.
          Both mount and unmount animate via useExitPresence — a plain
          `{isOpen && ...}` render never has an opacity to transition from,
          so it used to pop in and vanish instantly despite the transition class. */}
      {panelPresence.mounted && (
        <div
          className={`fixed ${hasFloatingCta ? 'bottom-[240px] lg:bottom-[176px]' : 'bottom-40 lg:bottom-24'} left-3 right-3 md:left-auto md:right-6 md:w-[28rem] h-[50vh] md:h-[600px] max-h-[400px] md:max-h-[600px] z-50 overflow-hidden bg-card rounded-bento shadow-pill flex flex-col origin-bottom-right ${
            panelPresence.closing ? 'animate-accordion-up' : 'animate-fade-slide-up'
          }`}
        >
          {/* Header - Mobile: Larger, Desktop: Compact */}
          {/* Header per secondary-03-assistant.png: a dark slab with an orange
              disc, not a light bar with a tinted one.

              The sub-line is the part that actually matters. It read
              "AI-powered FAQ helper", and was `hidden md:block` so a phone got
              no sub-line at all. The mockup says "Answers from real listings
              only" — which is a promise about where answers come from, on a
              feature where people reasonably worry that a bot is inventing
              teachers. That belongs on every width, not just desktop. */}
          <div className="flex items-center justify-between gap-2 rounded-t-[inherit] bg-panel p-3 md:p-4 flex-shrink-0">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="w-9 h-9 md:w-10 md:h-10 bg-brand text-brand-foreground rounded-full flex items-center justify-center flex-shrink-0">
                <HelpCircle className="w-4 h-4 md:w-5 md:h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-background text-sm md:text-base truncate">Ask Shikshaq</h3>
                <p className="text-xs text-background/70">Answers from real listings only</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2.5 hover:bg-white/10 active:bg-white/15 rounded-full transition-colors flex-shrink-0 -mr-1 md:mr-0"
              aria-label="Close chat"
            >
              <X className="w-5 h-5 md:w-5 md:h-5 text-background" />
            </button>
          </div>

          {/* Messages - Mobile: Better padding and spacing */}
          <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4 overscroll-contain">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                {/* pages.md §19: user bubbles bg-brand right-aligned max 82%,
                    assistant bubbles bg-card shadow-border left.
                    Handoff C-009: text-brand-foreground, not text-white --
                    #FF8000 fails contrast with white at this text-sm size
                    (measured 2.52:1 against AA's 4.5:1 floor); every other
                    brand-orange surface in the app uses the dark ink. */}
                <div
                  /* bg-muted, not bg-card + shadow-border: the bubble sits ON
                     a bg-card panel, so a ring was the only thing separating
                     two identical fills. Same rule S-001 applies to the row
                     card — inside a card panel you separate by fill. */
                  className={`max-w-[82%] rounded-[18px] px-3 py-2 md:px-4 md:py-2.5 ${
                    message.role === 'user'
                      ? 'bg-brand text-brand-foreground'
                      : 'bg-muted text-foreground shadow-border'
                  }`}
                >
                  <div
                    className="text-sm whitespace-pre-wrap break-words [&_a]:text-brand-blue [&_a]:underline [&_a]:font-medium [&_a]:hover:text-brand-blue/80"
                    dangerouslySetInnerHTML={{ 
                      __html: (() => {
                        let content = message.content;
                        
                        // First, sanitize to remove any potentially malicious HTML
                        // This prevents XSS attacks and malformed HTML
                        content = DOMPurify.sanitize(content, { 
                          ALLOWED_TAGS: [],
                          KEEP_CONTENT: true 
                        });
                        
                        // Convert WhatsApp links (https://wa.me/...) to clickable links
                        content = content.replace(
                          /(https:\/\/wa\.me\/[\d]+)/g, 
                          '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-brand-blue underline font-medium">Contact us on WhatsApp →</a>'
                        );
                        
                        // If contact info is mentioned but no link present, add a WhatsApp link.
                        // Only add if there's no existing WhatsApp link, and not when real teacher
                        // cards (each with their own WhatsApp disc) are about to render below.
                        if (!message.teachers?.length && (content.includes('8240980312') || content.includes('WhatsApp') || content.toLowerCase().includes('contact')) && !content.includes('wa.me') && !content.includes('<a href')) {
                          const whatsappLink = getWhatsAppLink('8240980312');
                          content += `\n\n<a href="${whatsappLink}" target="_blank" rel="noopener noreferrer" class="text-brand-blue underline font-medium">Contact us on WhatsApp →</a>`;
                        }
                        
                        // Convert line breaks to <br> for proper rendering
                        content = content.replace(/\n/g, '<br>');
                        
                        // Final sanitization with allowed tags to prevent XSS attacks
                        // Allow only safe tags: <a> with href, target, rel attributes, and <br>
                        content = DOMPurify.sanitize(content, {
                          ALLOWED_TAGS: ['a', 'br', 'p', 'strong', 'em'],
                          ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
                          ALLOWED_URI_REGEXP: /^(https?|mailto):/i,
                        });
                        
                        return content;
                      })()
                    }} 
                  />
                </div>

                {/* Answers that name teachers end in real teacher cards (row density)
                    with a green WhatsApp disc — never a list of names in prose. */}
                {message.teachers && message.teachers.length > 0 && (
                  <div className="mt-2 w-full max-w-[92%] space-y-2">
                    {message.teachers.map((teacher) => (
                      <TeacherCard
                        key={teacher.id}
                        id={teacher.id}
                        name={teacher.name}
                        slug={teacher.slug}
                        subject={teacher.subject}
                        imageUrl={teacher.imageUrl ?? undefined}
                        sirMaam={teacher.sirMaam}
                        experienceYears={teacher.experienceYears}
                        minFees={teacher.minFees}
                        maxFees={teacher.maxFees}
                        area={teacher.area}
                        variant="row"
                        hideFavourite
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                {/* Typing indicator: three warm dots, 8px, 150ms stagger (pages.md §19).
                    A one-shot fade-slide-up per dot, not an infinite loop. */}
                <div className="bg-muted rounded-[18px] px-4 py-3 flex items-center gap-1.5">
                  <span className="chat-typing-dot animate-fade-slide-up" style={{ animationDelay: '0ms' }} />
                  <span className="chat-typing-dot animate-fade-slide-up" style={{ animationDelay: '150ms' }} />
                  <span className="chat-typing-dot animate-fade-slide-up" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggested prompts — 34px chips above the composer, only while the thread is empty.
              A single horizontally-scrollable row, not a wrapping grid: six prompts wrapped
              into 5+ rows on a 375px viewport (~200px tall), squeezing the messages list's
              flex-1 area down to near zero and clipping the second line of the greeting
              bubble underneath it. A fixed-height scroll strip keeps the chips from eating
              the space the greeting needs. */}
          {/* The row scrolls, so the last chip is always half-cut at the panel
              edge. A trailing fade in the panel's own fill turns that from
              looking clipped into looking scrollable, and the chips are sized
              down: at 44px they were as heavy as the composer itself. */}
          {messages.length <= 1 && !loading && (
            <div className="relative flex-shrink-0">
              <div className="flex flex-nowrap gap-1.5 overflow-x-auto px-3 pb-2 scrollbar-hide md:px-4">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <Chip
                    key={prompt}
                    tone="facet"
                    size={44}
                    className="!h-9 flex-none whitespace-nowrap !px-3.5 text-[13px]"
                    onClick={() => handleSend(prompt)}
                  >
                    {prompt}
                  </Chip>
                ))}
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent"
              />
            </div>
          )}

          {/* Input - Composer 56px + 44px send disc (pages.md §19).
              rounded-b-[inherit], matching the header's own rounded-t-[inherit]
              above — without it this bar's square corners sat flush against
              the panel's rounded-bento bottom edge instead of following its
              curve, so the panel read as "not fully enclosed" at the bottom. */}
          <div className="rounded-b-[inherit] p-3 md:p-4 flex-shrink-0 bg-card safe-area-pb">
            <div className="flex gap-2 items-center h-14">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask anything about tuition"
                className="flex-1 h-14 min-w-0 px-4 bg-muted rounded-full outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card text-base"
                style={{ fontSize: '16px' }}
                disabled={loading}
              />
              <Button
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                variant="primary"
                size={44}
                aria-label="Send message"
                className="flex-shrink-0 w-11 rounded-full"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center hidden md:block">
              Powered by Google Gemini AI
            </p>
          </div>
        </div>
      )}

      <style>{`
        /* Typing indicator: three warm dots, 8px, using the whitelisted shimmer
           ambient loop instead of a bespoke infinite keyframe. */
        .chat-typing-dot {
          width: 8px;
          height: 8px;
          border-radius: 9999px;
          background: hsl(var(--brand) / 0.55);
        }
        @media (prefers-reduced-motion: reduce) {
          .chat-typing-dot { animation: none; opacity: 0.7; }
        }
      `}</style>
    </>
  );
}

