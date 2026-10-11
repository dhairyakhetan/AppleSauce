import { useRef } from 'react';
import { useLocation, useSearchParams, Navigate } from 'react-router-dom';
import Browse from './Browse';
import { SUBJECT_PATH_TO_FILTER } from '@/utils/subjectMapping';
import { SUBJECT_META } from '@/content/subject-meta';
import { LOCALITY_PAGES } from '@/content/locality-pages.generated';
import { localitySeoTitle } from '@/lib/locality';

/**
 * /maths-tuition-teachers-in-salt-lake: a subject page narrowed to one area.
 *
 * Only routes listed in LOCALITY_PAGES exist (App.tsx registers exactly those),
 * and that list is generated from real teacher counts, so the title's N is a
 * measured number. The description is generated with the list (it names the
 * real board mix), so the browser and the prerender read the same string.
 *
 * Filters go in the URL the same way SubjectPage does it, so the existing
 * Browse filter machinery (chips, counts, cards) does all the work.
 */
export default function LocalityPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const initialisedRef = useRef(false);

  const entry = LOCALITY_PAGES.find((p) => p.path === location.pathname);
  const meta = entry ? SUBJECT_META[entry.subjectPath] : undefined;
  const filterValue = entry ? SUBJECT_PATH_TO_FILTER[entry.subjectPath] : undefined;

  if (!entry || !meta || !filterValue) return <Navigate to="/all-tuition-teachers-in-kolkata" replace />;

  if (!searchParams.has('filter_subjects') && !initialisedRef.current) {
    const next = new URLSearchParams(searchParams);
    next.set('filter_subjects', filterValue);
    next.set('filter_areas', entry.area);
    initialisedRef.current = true;
    return <Navigate to={`${location.pathname}?${next.toString()}`} replace />;
  }
  initialisedRef.current = true;

  const seo = {
    title: localitySeoTitle(meta.label, entry.area, entry.count),
    description: entry.description,
  };

  return (
    <Browse
      manageSeo={false}
      pageContext={{ kind: 'subject', label: meta.label }}
      seo={seo}
      locality={{ area: entry.area, subjectPath: entry.subjectPath }}
    />
  );
}
