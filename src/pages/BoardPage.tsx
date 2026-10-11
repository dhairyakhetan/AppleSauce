import { useRef } from 'react';
import { useLocation, useSearchParams, Navigate } from 'react-router-dom';
import Browse from './Browse';
import { BOARD_PATH_TO_FILTER } from '@/utils/boardMapping';
import { BOARD_CONTENT } from '@/content/subject-seo';

const BOARD_SEO: Record<string, { title: string; description: string }> = {
  '/cbse-ncert-tuition-teachers-in-kolkata': {
    title: 'CBSE Tuition Teachers in Kolkata | Shikshaq',
    description: 'Find verified CBSE/NCERT tuition teachers in Kolkata for Classes 1-12. Maths, Science, English, Social Studies, and more. Connect directly for free on Shikshaq.',
  },
  '/icse-tuition-teachers-in-kolkata': {
    title: 'ICSE Tuition Teachers in Kolkata | Shikshaq',
    description: 'Find verified ICSE and ISC tuition teachers in Kolkata for Classes 1-12. Connect directly with local tutors for free on Shikshaq, no commission.',
  },
  '/igcse-tuition-teachers-in-kolkata': {
    title: 'IGCSE Tuition Teachers in Kolkata | Shikshaq',
    description: 'Find IGCSE tuition teachers in Kolkata for Cambridge International curriculum. Connect directly with experienced educators for free on Shikshaq.',
  },
  '/international-board-tuition-teachers-in-kolkata': {
    title: 'IB Tuition Teachers in Kolkata | Shikshaq',
    description: 'Find IB (International Baccalaureate) MYP and DP tuition teachers in Kolkata. Connect directly for free on Shikshaq, no commission, no middlemen.',
  },
  '/state-board-tuition-teachers-in-kolkata': {
    title: 'State Board Tuition Teachers in Kolkata | Shikshaq',
    description: 'Find West Bengal State Board tuition teachers in Kolkata for Secondary and Higher Secondary. Connect directly for free on Shikshaq.',
  },
};

export default function BoardPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const hasSetInitialFilterRef = useRef(false);

  const pathname = location.pathname;
  const filterValue = BOARD_PATH_TO_FILTER[pathname];

  // Templated first-fold label (VISUAL_DIRECTION.md §9a): the SEO title is
  // always "{Board} Tuition Teachers in Kolkata | Shikshaq", so the board
  // name is everything before " Tuition".
  const seoEntry = BOARD_SEO[pathname];
  const boardLabel = seoEntry ? seoEntry.title.split(' Tuition')[0] : null;
  const pageContext = boardLabel ? { kind: 'board' as const, label: boardLabel } : undefined;
  // <SEOHead> (rendered inside Browse, once the real teacher count is known
  // for its schema) now owns title/description/canonical/OG/Twitter — this
  // page no longer touches document.title/meta directly.
  const seo = seoEntry ? { title: seoEntry.title, description: seoEntry.description, content: BOARD_CONTENT[pathname] } : undefined;

  if (!filterValue) {
    return <Browse manageSeo={!seoEntry} pageContext={pageContext} seo={seo} />;
  }

  const filterBoardsExists = searchParams.has('filter_boards');
  const hasAnyParams = filterBoardsExists ||
                       searchParams.has('filter_subjects') ||
                       searchParams.has('filter_classes') ||
                       searchParams.has('filter_classSize') ||
                       searchParams.has('filter_areas') ||
                       searchParams.has('filter_modeOfTeaching') ||
                       searchParams.has('q') ||
                       searchParams.has('subject') ||
                       searchParams.has('class');

  if (hasSetInitialFilterRef.current && !hasAnyParams) {
    return <Navigate to="/all-tuition-teachers-in-kolkata" replace />;
  }

  if (!filterBoardsExists) {
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set('filter_boards', filterValue);
    const newUrl = `${pathname}?${newSearchParams.toString()}`;
    hasSetInitialFilterRef.current = true;
    return <Navigate to={newUrl} replace />;
  }

  if (!hasSetInitialFilterRef.current) {
    hasSetInitialFilterRef.current = true;
  }

  return <Browse manageSeo={!seoEntry} pageContext={pageContext} seo={seo} />;
}
