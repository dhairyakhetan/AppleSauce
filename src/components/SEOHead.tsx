/**
 * SEO HEAD COMPONENT
 *
 * Reusable component for managing all SEO-related meta tags:
 * - Title tags
 * - Meta descriptions
 * - Canonical URLs
 * - OpenGraph tags (Facebook, LinkedIn)
 * - Twitter Card tags
 * - Structured data (JSON-LD)
 *
 * Usage:
 * <SEOHead
 *   title="Math Tuition Teachers in Kolkata"
 *   description="Find experienced math tutors..."
 *   canonical="/maths-tuition-teachers-in-kolkata"
 *   ogImage="https://www.shikshaq.in/og-image-math.jpg"
 *   schema={customSchemaObject}
 * />
 */

import { useEffect } from 'react';
import { canonicalPathFor } from '@/lib/canonical';
import { SITE_URL, DEFAULT_TITLE, DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE } from '@/lib/seo-defaults';

/* Defaults now come from lib/seo-defaults. This file used to carry its own
   copy, with a different description from both index.html's and
   usePageMeta's -- which decided what the document said after an unmount
   depending on which component unmounted last. */
const SITE_NAME = 'Shikshaq';

export interface SEOHeadProps {
  /** Page title (will be appended with "| Shikshaq" if not included) */
  title?: string;

  /** Meta description (max 160 characters recommended) */
  description?: string;

  /** Canonical URL path (e.g., "/maths-tuition-teachers-in-kolkata") */
  canonical?: string;

  /** Full canonical URL (overrides canonical path) */
  canonicalURL?: string;

  /** OpenGraph image URL (1200x630px recommended) */
  ogImage?: string;

  /** OpenGraph type (default: "website") */
  ogType?: 'website' | 'article' | 'profile';

  /** Twitter card type (default: "summary_large_image") */
  twitterCard?: 'summary' | 'summary_large_image' | 'app' | 'player';

  /** Structured data (JSON-LD schema) */
  schema?: object | object[];

  /** Additional meta tags */
  additionalMetaTags?: Array<{
    name?: string;
    property?: string;
    content: string;
  }>;

  /** Whether to append "| Shikshaq" to title (default: true) */
  appendSiteName?: boolean;

  /** Locale (default: "en_IN") */
  locale?: string;

  /** Whether page should be indexed (default: true) */
  noindex?: boolean;

  /** Whether links should be followed (default: true) */
  nofollow?: boolean;
}

/**
 * SEO Head Component
 */
export function SEOHead({
  title,
  description,
  canonical,
  canonicalURL,
  ogImage,
  ogType = 'website',
  twitterCard = 'summary_large_image',
  schema,
  additionalMetaTags = [],
  appendSiteName = true,
  locale = 'en_IN',
  noindex = false,
  nofollow = false,
}: SEOHeadProps) {
  useEffect(() => {
    // Build full title
    const fullTitle =
      title && appendSiteName && !title.includes('Shikshaq')
        ? `${title} | ${SITE_NAME}`
        : title || DEFAULT_TITLE;

    // Build canonical URL
    const fullCanonicalURL =
      /* Resolved through canonicalPathFor, so a page passing its own pathname
         still gets duplicate-route aliasing. SEOHead runs after CanonicalTag
         and overwrites it, so a rule applied only there would never survive. */
      canonicalURL ||
      `${SITE_URL}${canonicalPathFor(canonical ?? window.location.pathname)}`;

    // Build OG image
    const fullOGImage = ogImage || DEFAULT_OG_IMAGE;

    // Build description
    const fullDescription = description || DEFAULT_DESCRIPTION;

    // Update title
    document.title = fullTitle;

    // Update or create meta tags
    updateMetaTag('description', fullDescription);

    // Robots meta tag
    if (noindex || nofollow) {
      const robotsContent = [noindex ? 'noindex' : 'index', nofollow ? 'nofollow' : 'follow'].join(', ');
      updateMetaTag('robots', robotsContent);
    } else {
      removeMetaTag('robots');
    }

    // Canonical tag
    updateLinkTag('canonical', fullCanonicalURL);

    // OpenGraph tags
    updateMetaTag('og:title', fullTitle, 'property');
    updateMetaTag('og:description', fullDescription, 'property');
    updateMetaTag('og:type', ogType, 'property');
    updateMetaTag('og:url', fullCanonicalURL, 'property');
    updateMetaTag('og:image', fullOGImage, 'property');
    updateMetaTag('og:site_name', SITE_NAME, 'property');
    updateMetaTag('og:locale', locale, 'property');

    // Twitter Card tags
    updateMetaTag('twitter:card', twitterCard);
    updateMetaTag('twitter:title', fullTitle);
    updateMetaTag('twitter:description', fullDescription);
    updateMetaTag('twitter:image', fullOGImage);

    // Additional meta tags
    additionalMetaTags.forEach((tag) => {
      if (tag.name) {
        updateMetaTag(tag.name, tag.content);
      } else if (tag.property) {
        updateMetaTag(tag.property, tag.content, 'property');
      }
    });

    // Structured data (JSON-LD)
    if (schema) {
      updateStructuredData(schema);
    }

    /* Restore the defaults on unmount, which this deliberately did not do.
       The original reasoning -- "commented out to prevent flashing back to
       defaults on navigation" -- describes a flash that does not happen: React
       unmounts the old route and mounts the new one in the same commit, so a
       route that sets its own meta overwrites these values before the browser
       paints. usePageMeta has restored defaults on unmount all along and shows
       no such flash.
       What the missing cleanup DID cause is the opposite problem. Navigating
       from a SEOHead route to one that manages no meta at all (/account,
       /dashboard/teacher, the admin pages) left the previous page's title and
       description in the document -- so a reader who opened a blog article and
       then went to their account had "..." | Shikshaq sitting in the tab, and
       any share from there carried the article's card. */
    return () => {
      document.title = DEFAULT_TITLE;
      updateMetaTag('description', DEFAULT_DESCRIPTION);
      updateMetaTag('og:title', DEFAULT_TITLE, 'property');
      updateMetaTag('og:description', DEFAULT_DESCRIPTION, 'property');
      updateMetaTag('og:image', DEFAULT_OG_IMAGE, 'property');
      updateMetaTag('twitter:title', DEFAULT_TITLE);
      updateMetaTag('twitter:description', DEFAULT_DESCRIPTION);
      updateMetaTag('twitter:image', DEFAULT_OG_IMAGE);
    };
  }, [
    title,
    description,
    canonical,
    canonicalURL,
    ogImage,
    ogType,
    twitterCard,
    schema,
    additionalMetaTags,
    appendSiteName,
    locale,
    noindex,
    nofollow,
  ]);

  return null; // This component doesn't render anything
}

/**
 * Update or create a meta tag
 */
function updateMetaTag(name: string, content: string, attribute: 'name' | 'property' = 'name') {
  let element = document.querySelector(`meta[${attribute}="${name}"]`) as HTMLMetaElement;

  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, name);
    document.head.appendChild(element);
  }

  element.setAttribute('content', content);
}

/**
 * Remove a meta tag
 */
function removeMetaTag(name: string, attribute: 'name' | 'property' = 'name') {
  const element = document.querySelector(`meta[${attribute}="${name}"]`);
  if (element) {
    element.remove();
  }
}

/**
 * Update or create a link tag
 */
function updateLinkTag(rel: string, href: string) {
  let element = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement;

  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }

  element.setAttribute('href', href);
}

/**
 * Update structured data (JSON-LD)
 */
function updateStructuredData(schema: object | object[]) {
  // Remove existing schema with id="seo-schema"
  const existingSchema = document.getElementById('seo-schema');
  if (existingSchema) {
    existingSchema.remove();
  }

  // Create new schema script tag
  const script = document.createElement('script');
  script.id = 'seo-schema';
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(schema);
  document.head.appendChild(script);
}

export default SEOHead;
