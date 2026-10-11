/**
 * Write JSON-LD into the document head at runtime.
 *
 * Split out of structuredDataGenerators.ts, which is now pure: it builds
 * schema objects and touches no DOM. That separation is load-bearing rather
 * than tidiness -- scripts/prerender.ts imports those generators from Node at
 * build time to emit static JSON-LD for ~1,727 routes, and scripts/ is
 * typechecked under tsconfig.node.json, which has no "dom" lib. A single
 * `document` reference anywhere in that module made the whole build fail.
 *
 * Keeping the split also states the rule plainly: a generator returns data and
 * can run anywhere; only this file assumes a browser.
 */

/** Replace the page's JSON-LD block with `schemas`. Browser only. */
export function injectSchemas(schemas: object[]) {
  // Remove existing schemas with id="page-schemas"
  const existing = document.getElementById('page-schemas');
  if (existing) {
    existing.remove();
  }

  // Create new script tag with all schemas
  const script = document.createElement('script');
  script.id = 'page-schemas';
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(schemas);
  document.head.appendChild(script);
}
