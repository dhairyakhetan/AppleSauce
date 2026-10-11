/**
 * STRUCTURED DATA GENERATORS
 *
 * Utility functions to generate schema.org structured data (JSON-LD)
 * for different page types across the Shikshaq website.
 *
 * Implements schemas for:
 * - ItemList (browse, subject, board pages)
 * - BreadcrumbList (navigation hierarchy)
 * - FAQPage (FAQ page)
 * - WebPage (generic pages)
 * - CollectionPage (teacher listings)
 */

const SITE_URL = 'https://www.shikshaq.in';
/* Anchored to #organization, which index.html emits on EVERY route as an
   EducationalOrganization. The previous comment here asserted the opposite —
   that #organization was "dangling, never-emitted" and that #localbusiness was
   the only org entity on the site. That was backwards: LocalBusiness is
   emitted by Index.tsx on the HOMEPAGE ONLY, so on all ~36 other commercial
   routes every Service.provider, Person.memberOf and
   EducationalOccupationalProgram.provider pointed at an @id absent from that
   page's graph, while a perfectly good #organization node sat in the head. */
const ORG_ID = `${SITE_URL}/#organization`;

/* One list, used by both this file and index.html. Only profiles the site
   actually links are asserted: the footer links instagram.com/shikshaq.in and
   nothing else. Previously two schemas on the same page claimed four different
   profiles between them (ngo.aquaterra + shikshaqkolkata here,
   shikshaq.in + shikshaq.in in the head), which prevents Google resolving a
   single knowledge-graph entity — exactly the signal a local directory needs.
   Both handles confirmed real by the owner: shikshaq.in is the product's
   account and ngo.aquaterra is the parent NGO's, which index.html already
   names as parentOrganization. facebook.com/shikshaqkolkata and
   facebook.com/shikshaq.in stay out — neither was confirmed, and sameAs is
   an identity claim, not a hint. */
const SAME_AS = [
  'https://www.instagram.com/shikshaq.in/',
  'https://www.instagram.com/ngo.aquaterra/',
];

/**
 * Generate ItemList schema for teacher listing pages
 */
export function generateItemListSchema(params: {
  url: string;
  name: string;
  description: string;
  items: Array<{
    name: string;
    url: string;
    image?: string;
    description?: string;
  }>;
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${params.url}#itemlist`,
    name: params.name,
    description: params.description,
    url: params.url,
    numberOfItems: params.items.length,
    itemListElement: params.items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Person',
        '@id': item.url,
        name: item.name,
        url: item.url,
        image: item.image,
        description: item.description,
        jobTitle: 'Tutor',
        memberOf: {
          '@id': ORG_ID,
        },
      },
    })),
  };
}

/**
 * Generate CollectionPage schema for subject/board pages
 */
export function generateCollectionPageSchema(params: {
  url: string;
  name: string;
  description: string;
  about: string;
  /** Omit when the real count is not known: a wrong number (the prerender
   *  used to write 0) is worse than no ItemList size. */
  numberOfItems?: number;
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${params.url}#webpage`,
    url: params.url,
    name: params.name,
    description: params.description,
    about: {
      '@type': 'Thing',
      name: params.about,
    },
    isPartOf: {
      '@id': `${SITE_URL}/#website`,
    },
    publisher: {
      '@id': ORG_ID,
    },
    ...(params.numberOfItems === undefined
      ? {}
      : { mainEntity: { '@type': 'ItemList', numberOfItems: params.numberOfItems } }),
  };
}

/**
 * Generate BreadcrumbList schema
 *
 * Every crumb (including the current page) carries a full item URL — Google
 * accepts a URL-less last item, but including it is valid and more complete,
 * and matches what page-level callers (e.g. TeacherProfile) previously hand-rolled.
 */
export function generateBreadcrumbSchema(
  breadcrumbs: Array<{
    name: string;
    url: string;
  }>,
  id?: string
): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    ...(id && { '@id': id }),
    itemListElement: breadcrumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url.startsWith('http') ? crumb.url : `${SITE_URL}${crumb.url}`,
    })),
  };
}

/**
 * Generate FAQPage schema
 */
export function generateFAQPageSchema(params: {
  url: string;
  faqs: Array<{
    question: string;
    answer: string;
  }>;
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${params.url}#faqpage`,
    url: params.url,
    mainEntity: params.faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

/**
 * Generate Service schema.
 *
 * Covers both the narrow per-subject/board service ("Maths Tuition in Kolkata")
 * and the site-wide homepage service — pass `id`/`name`/`offers`/`availableChannel`
 * to override the subject-page defaults with the richer homepage shape.
 */
export function generateServiceSchema(params: {
  subject?: string;
  name?: string;
  description: string;
  areaServed?: string;
  serviceType?: string;
  id?: string;
  /** Defaults to a single free "Offer". Pass an array for multiple offer types (e.g. homepage). */
  offers?: object | object[];
  availableChannel?: { serviceUrl: string; servicePhone?: string };
}): object {
  const subjectSlug = params.subject ? params.subject.toLowerCase().replace(/\s+/g, '-') : 'general';
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': params.id || `${SITE_URL}/#service-${subjectSlug}`,
    name: params.name || (params.subject ? `${params.subject} Tuition in Kolkata` : 'Tuition Service'),
    description: params.description,
    provider: {
      '@id': ORG_ID,
    },
    serviceType: params.serviceType || 'Educational Service',
    areaServed: params.areaServed || 'Kolkata, West Bengal, India',
    offers: params.offers ?? {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'INR',
      description: 'Free teacher discovery platform - no commission',
    },
    ...(params.availableChannel && {
      availableChannel: {
        '@type': 'ServiceChannel',
        serviceUrl: params.availableChannel.serviceUrl,
        ...(params.availableChannel.servicePhone && { servicePhone: params.availableChannel.servicePhone }),
      },
    }),
  };
}

/**
 * Generate LocalBusiness schema for the homepage.
 * This is the site's single Organization-type anchor — its @id is what ORG_ID
 * (and every `provider`/`memberOf` reference elsewhere in this file) points to.
 */
export function generateLocalBusinessSchema(params?: {
  name?: string;
  description?: string;
  telephone?: string;
  email?: string;
  areaServed?: string[];
  sameAs?: string[];
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': ORG_ID,
    name: params?.name || 'Shikshaq',
    description:
      params?.description ||
      'Free online tutor-student matchmaking platform serving Kolkata and surrounding areas',
    url: SITE_URL,
    telephone: params?.telephone || '+91-8240980312',
    email: params?.email || 'ngo.aquaterra@gmail.com',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Kolkata',
      addressRegion: 'West Bengal',
      addressCountry: 'IN',
    },
    priceRange: 'Free',
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      opens: '08:00',
      closes: '22:00',
      timezone: 'Asia/Kolkata',
    },
    areaServed: params?.areaServed || [
      'Kolkata',
      'Howrah',
      'Salt Lake',
      'Jadavpur',
      'Bhowanipore',
      'Ballygunge',
      'New Town',
      'Garia',
      'Tollygunge',
      'Behala',
    ],
    sameAs: params?.sameAs || [
      ...SAME_AS,
    ],
  };
}

/**
 * Generate Person schema for a teacher profile page.
 */
export function generateTeacherPersonSchema(params: {
  url: string;
  name: string;
  description?: string | null;
  phoneNumber?: string | null;
  area?: string | null;
  qualifications?: string | null;
  subjects?: string[];
  classesTaught?: string[];
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${params.url}#person`,
    name: params.name,
    ...(params.description && { description: params.description }),
    url: params.url,
    jobTitle: 'Tutor',
    ...(params.phoneNumber && { telephone: params.phoneNumber }),
    ...(params.area && {
      address: {
        '@type': 'PostalAddress',
        addressLocality: params.area,
        addressRegion: 'West Bengal',
        addressCountry: 'IN',
      },
    }),
    ...(params.qualifications && {
      hasCredential: [
        {
          '@type': 'EducationalOccupationalCredential',
          name: params.qualifications,
        },
      ],
    }),
    ...(params.subjects && params.subjects.length > 0 && { knowsAbout: params.subjects }),
    ...(params.classesTaught && params.classesTaught.length > 0 && { teaches: params.classesTaught }),
    ...(params.area && {
      workLocation: {
        '@type': 'Place',
        name: params.area,
      },
    }),
    memberOf: {
      '@id': ORG_ID,
    },
    ...(params.phoneNumber && {
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'Direct Contact',
        telephone: params.phoneNumber,
        contactOption: 'TollFree',
      },
    }),
  };
}

/**
 * Generate a Person schema carrying real user reviews (as schema.org `Review`
 * objects) for a teacher profile page.
 *
 * IMPORTANT: never add a `reviewRating` / `aggregateRating` here. No verified
 * rating field exists in the data, and Google's structured-data guidelines
 * treat invented ratings as self-serving/fake — that risks a manual action.
 * Returns null when there are no reviews so callers can skip emitting an
 * empty/pointless schema.
 */
export function generatePersonReviewSchema(params: {
  url: string;
  name: string;
  reviews: Array<{ author: string; reviewBody: string }>;
}): object | null {
  if (!params.reviews || params.reviews.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${params.url}#reviews`,
    name: params.name,
    review: params.reviews.map((r) => ({
      '@type': 'Review',
      author: {
        '@type': 'Person',
        name: r.author,
      },
      reviewBody: r.reviewBody,
    })),
  };
}

/**
 * Generate EducationalOccupationalProgram schema
 */
export function generateEducationalProgramSchema(params: {
  name: string;
  description: string;
  provider: string;
  subjects: string[];
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'EducationalOccupationalProgram',
    name: params.name,
    description: params.description,
    provider: {
      '@id': ORG_ID,
    },
    teaches: params.subjects,
    occupationalCategory: 'Tuition Teacher',
  };
}

/**
 * Subject page schema generator
 * Combines CollectionPage, Service, and Breadcrumb schemas
 */
export function generateSubjectPageSchemas(params: {
  subject: string;
  url: string;
  description: string;
  teacherCount: number;
  breadcrumbs?: Array<{ name: string; url: string }>;
}): object[] {
  const schemas: object[] = [];

  // CollectionPage schema
  schemas.push(
    generateCollectionPageSchema({
      url: `${SITE_URL}${params.url}`,
      name: `${params.subject} Tuition Teachers in Kolkata`,
      description: params.description,
      about: `${params.subject} Tutors`,
      numberOfItems: params.teacherCount,
    })
  );

  // Service schema
  schemas.push(
    generateServiceSchema({
      subject: params.subject,
      description: params.description,
    })
  );

  // Breadcrumb schema
  if (params.breadcrumbs) {
    schemas.push(generateBreadcrumbSchema(params.breadcrumbs));
  }

  return schemas;
}

/**
 * Board page schema generator
 */
export function generateBoardPageSchemas(params: {
  board: string;
  url: string;
  description: string;
  teacherCount: number;
  breadcrumbs?: Array<{ name: string; url: string }>;
}): object[] {
  const schemas: object[] = [];

  // CollectionPage schema
  schemas.push(
    generateCollectionPageSchema({
      url: `${SITE_URL}${params.url}`,
      name: `${params.board} Tuition Teachers in Kolkata`,
      description: params.description,
      about: `${params.board} Board Tutors`,
      numberOfItems: params.teacherCount,
    })
  );

  // Service schema
  schemas.push(
    generateServiceSchema({
      subject: params.board,
      description: params.description,
    })
  );

  // Breadcrumb schema
  if (params.breadcrumbs) {
    schemas.push(generateBreadcrumbSchema(params.breadcrumbs));
  }

  return schemas;
}

/**
 * Browse page schema generator
 */
export function generateBrowsePageSchemas(params: {
  teacherCount: number;
  teachers?: Array<{
    name: string;
    slug: string;
    image?: string;
    description?: string;
  }>;
}): object[] {
  const schemas: object[] = [];

  // If specific teachers are provided, generate ItemList
  if (params.teachers && params.teachers.length > 0) {
    schemas.push(
      generateItemListSchema({
        url: `${SITE_URL}/all-tuition-teachers-in-kolkata`,
        name: 'Tuition Teachers in Kolkata',
        description: 'Browse verified tuition teachers across all subjects and boards in Kolkata',
        items: params.teachers.map((teacher) => ({
          name: teacher.name,
          url: `${SITE_URL}/tuition-teachers/${teacher.slug}`,
          image: teacher.image,
          description: teacher.description,
        })),
      })
    );
  }

  // CollectionPage schema
  schemas.push(
    generateCollectionPageSchema({
      url: `${SITE_URL}/all-tuition-teachers-in-kolkata`,
      name: 'Browse Tuition Teachers in Kolkata',
      description: 'Find and compare tuition teachers across subjects, boards, and localities in Kolkata',
      about: 'Tuition Teachers',
      numberOfItems: params.teacherCount,
    })
  );

  // Breadcrumb schema
  schemas.push(
    generateBreadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'All Teachers', url: '/all-tuition-teachers-in-kolkata' },
    ])
  );

  return schemas;
}

/* injectSchemas() moved to src/utils/injectSchemas.ts.
   This module must stay free of DOM references: scripts/prerender.ts imports
   these generators from Node to emit static JSON-LD at build time, and
   scripts/ is typechecked under tsconfig.node.json, which has no "dom" lib.
   One `document` reference here failed the whole build. */
