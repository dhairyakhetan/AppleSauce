import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { canonicalPathFor } from "@/lib/canonical";

const SITE_URL = "https://www.shikshaq.in";

/**
 * Keeps <link rel="canonical"> in sync with the current route.
 *
 * index.html ships a hardcoded canonical pointing at the homepage, and
 * vercel.json rewrites every path to that same index.html. Without this,
 * every route (teacher profiles included) tells Google it is a duplicate
 * of "/" and never gets indexed.
 *
 * Rendered before <Routes> so a page can still override the canonical in
 * its own effect if it ever needs something other than its pathname.
 */
export const CanonicalTag = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const path = canonicalPathFor(pathname);

    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = `${SITE_URL}${path}`;

    // og:url should match the canonical, otherwise shares point at the homepage.
    const ogUrl = document.querySelector('meta[property="og:url"]') as HTMLMetaElement;
    if (ogUrl) ogUrl.setAttribute("content", `${SITE_URL}${path}`);
  }, [pathname]);

  return null;
};

export default CanonicalTag;
