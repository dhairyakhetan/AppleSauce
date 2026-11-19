import { useEffect } from 'react';
import { DEFAULT_TITLE, DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE } from '@/lib/seo-defaults';

/**
 * Sets a page-specific title and meta description, restoring the defaults on
 * unmount.
 *
 * index.html ships one title/description for the whole app, so any route that
 * doesn't set its own ends up duplicating the homepage's — which stops it
 * ranking for its own terms. Canonicals are handled separately by
 * <CanonicalTag>.
 *
 * ogImage lets a page override the default share card (e.g. a teacher's own
 * photo on their profile) — WhatsApp is this product's main distribution
 * channel, so a generic OG image on every profile share is a real conversion
 * cost. Twitter card tags mirror the OG ones since some platforms read those
 * in preference to og:*.
 */
export function usePageMeta(title: string, description: string, ogImage?: string) {
  useEffect(() => {
    document.title = title;
    const resolvedOgImage = ogImage || DEFAULT_OG_IMAGE;

    const metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (metaDesc) metaDesc.setAttribute('content', description);

    // og:title / og:description should match, otherwise shares show homepage copy.
    const ogTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null;
    if (ogTitle) ogTitle.setAttribute('content', title);
    const ogDesc = document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null;
    if (ogDesc) ogDesc.setAttribute('content', description);
    const ogImg = document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null;
    if (ogImg) ogImg.setAttribute('content', resolvedOgImage);

    const twitterTitle = document.querySelector('meta[name="twitter:title"]') as HTMLMetaElement | null;
    if (twitterTitle) twitterTitle.setAttribute('content', title);
    const twitterDesc = document.querySelector('meta[name="twitter:description"]') as HTMLMetaElement | null;
    if (twitterDesc) twitterDesc.setAttribute('content', description);
    const twitterImg = document.querySelector('meta[name="twitter:image"]') as HTMLMetaElement | null;
    if (twitterImg) twitterImg.setAttribute('content', resolvedOgImage);

    return () => {
      document.title = DEFAULT_TITLE;
      if (metaDesc) metaDesc.setAttribute('content', DEFAULT_DESCRIPTION);
      if (ogTitle) ogTitle.setAttribute('content', DEFAULT_TITLE);
      if (ogDesc) ogDesc.setAttribute('content', DEFAULT_DESCRIPTION);
      if (ogImg) ogImg.setAttribute('content', DEFAULT_OG_IMAGE);
      if (twitterTitle) twitterTitle.setAttribute('content', DEFAULT_TITLE);
      if (twitterDesc) twitterDesc.setAttribute('content', DEFAULT_DESCRIPTION);
      if (twitterImg) twitterImg.setAttribute('content', DEFAULT_OG_IMAGE);
    };
  }, [title, description, ogImage]);
}
