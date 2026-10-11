import { useRef } from 'react';
import { useLocation, useSearchParams, Navigate } from 'react-router-dom';
import Browse from './Browse';
import { SUBJECT_PATH_TO_FILTER } from '@/utils/subjectMapping';
import { SUBJECT_CONTENT } from '@/content/subject-seo';
import { SUBJECT_META, subjectSeoTitle } from '@/content/subject-meta';

export default function SubjectPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const hasSetInitialFilterRef = useRef(false);

  const pathname = location.pathname;
  const filterValue = SUBJECT_PATH_TO_FILTER[pathname];

  // Templated first-fold label (VISUAL_DIRECTION.md section 9a): the subject
  // name comes from SUBJECT_META, the same table scripts/prerender.ts reads, so
  // the browser title and the crawler title cannot drift apart.
  const meta = SUBJECT_META[pathname];
  const subjectLabel = meta ? meta.label : null;
  const pageContext = subjectLabel ? { kind: 'subject' as const, label: subjectLabel } : undefined;
  // <SEOHead> (rendered inside Browse, once the real teacher count is known
  // for its schema) now owns title/description/canonical/OG/Twitter: this
  // page no longer touches document.title/meta directly.
  const seoEntry = meta;
  const seo = meta
    ? { title: subjectSeoTitle(meta.label), description: meta.description, content: SUBJECT_CONTENT[pathname] }
    : undefined;

  if (!filterValue) {
    return <Browse manageSeo={!seoEntry} pageContext={pageContext} seo={seo} />;
  }

  const filterSubjectsExists = searchParams.has('filter_subjects');
  const hasAnyParams = filterSubjectsExists ||
                       searchParams.has('filter_classes') ||
                       searchParams.has('filter_boards') ||
                       searchParams.has('filter_classSize') ||
                       searchParams.has('filter_areas') ||
                       searchParams.has('filter_modeOfTeaching') ||
                       searchParams.has('q') ||
                       searchParams.has('subject') ||
                       searchParams.has('class');

  if (hasSetInitialFilterRef.current && !hasAnyParams) {
    return <Navigate to="/all-tuition-teachers-in-kolkata" replace />;
  }

  if (!filterSubjectsExists) {
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set('filter_subjects', filterValue);
    const newUrl = `${pathname}?${newSearchParams.toString()}`;
    hasSetInitialFilterRef.current = true;
    return <Navigate to={newUrl} replace />;
  }

  if (!hasSetInitialFilterRef.current) {
    hasSetInitialFilterRef.current = true;
  }

  return <Browse manageSeo={!seoEntry} pageContext={pageContext} seo={seo} />;
}
