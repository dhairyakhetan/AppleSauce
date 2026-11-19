/**
 * FAQ SCHEMA COMPONENT
 *
 * Generates FAQPage structured data for the FAQ page
 * Automatically injects schema.org JSON-LD into page head
 *
 * Usage:
 * Import and render in FAQ page or any page with Q&A content
 */

import { useEffect } from 'react';
import { generateFAQPageSchema } from '@/utils/structuredDataGenerators';

const SITE_URL = 'https://www.shikshaq.in';

export interface FAQItem {
  question: string;
  answer: string;
}

export interface FAQSchemaProps {
  /** Array of FAQ items */
  faqs: FAQItem[];
  /** Page URL (default: /faq) */
  url?: string;
}

/**
 * FAQ Schema Component
 */
export function FAQSchema({ faqs, url = '/faq' }: FAQSchemaProps) {
  useEffect(() => {
    const schema = generateFAQPageSchema({
      url: `${SITE_URL}${url}`,
      faqs,
    });

    // Remove existing FAQ schema
    const existing = document.getElementById('faq-schema');
    if (existing) {
      existing.remove();
    }

    // Create new schema script tag
    const script = document.createElement('script');
    script.id = 'faq-schema';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);

    // Cleanup on unmount
    return () => {
      const el = document.getElementById('faq-schema');
      if (el) {
        el.remove();
      }
    };
  }, [faqs, url]);

  return null; // This component doesn't render anything
}

export default FAQSchema;
