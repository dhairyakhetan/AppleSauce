import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchBankSchoolValues } from '@/lib/question-bank';
import { SUBJECTS, CLASSES, AREAS, BOARDS, type SearchMode } from '@/utils/searchFacets';
import type { SentenceSlot } from '@/components/home/SentenceBuilder';
import { recordSignal } from '@/lib/intent/signals';
import { displaySchool, rawSchoolsFor } from '@/lib/school-display';

/* Handoff H-023/S-015 — the sentence-builder state EyesPanel needs
   (mode, slot values, submit routing), extracted so every page that
   renders the eyes panel gets the exact same live data and behaviour
   Home's does, rather than each page re-deriving its own copy.

   schoolOptions is the one genuinely new query this needs (Footer used
   to fetch the same list for the same reason before H-023 moved the
   builder out of it). Result counts are the caller's own concern — pass
   whatever `count` the page already has (or none). */
export function useSentenceBuilder() {
  const navigate = useNavigate();
  const [builderMode, setBuilderMode] = useState<SearchMode>('teachers');
  const [teacherSlotValues, setTeacherSlotValues] = useState<Record<string, string>>({});
  const [paperSlotValues, setPaperSlotValues] = useState<Record<string, string>>({});

  const schoolOptionsQuery = useQuery({
    queryKey: ['sentence-builder', 'school-options'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      /* Was reading `papers` (the submit-a-paper flow, 18 rows), which meant
         the school dropdown here offered a near-empty list next to a "school"
         filter that runs against bank_papers everywhere else it is used
         (PaperResults, PastPapers). bank_papers is the real library (~2,000
         rows); has_school=true excludes board-level rows, which carry a board
         name rather than a school name in that column — see fetchBankSchoolValues. */
      const schools = await fetchBankSchoolValues(true);
      /* Display labels, not raw values -- a merged label (school-display.ts)
         appears once here rather than once per raw spelling/abbreviation it
         covers. handleSubmit below expands the picked label back to every
         raw value it needs to filter by. */
      return Array.from(new Set(schools.filter((s): s is string => !!s).map((s) => displaySchool(s)))).sort();
    },
  });
  const schoolOptions = schoolOptionsQuery.data ?? [];

  const teacherSlots: SentenceSlot[] = useMemo(() => ([
    { key: 'subject', placeholder: 'subject', value: teacherSlotValues.subject, options: SUBJECTS },
    { key: 'cls', placeholder: 'class', value: teacherSlotValues.cls, options: CLASSES.map((c) => `Class ${c}`) },
    { key: 'area', placeholder: 'area', value: teacherSlotValues.area, options: AREAS },
  ]), [teacherSlotValues]);

  const paperSlots: SentenceSlot[] = useMemo(() => ([
    { key: 'board', placeholder: 'board', value: paperSlotValues.board, options: BOARDS },
    { key: 'cls', placeholder: 'class', value: paperSlotValues.cls, options: CLASSES.map((c) => `Class ${c}`) },
    { key: 'subject', placeholder: 'subject', value: paperSlotValues.subject, options: SUBJECTS },
    { key: 'school', placeholder: 'school', value: paperSlotValues.school, options: schoolOptions },
  ]), [paperSlotValues, schoolOptions]);

  const handleSlotChange = useCallback((key: string, value: string) => {
    if (builderMode === 'teachers') {
      setTeacherSlotValues((prev) => ({ ...prev, [key]: value }));
    } else {
      setPaperSlotValues((prev) => ({ ...prev, [key]: value }));
    }
  }, [builderMode]);

  const handleSubmit = useCallback(() => {
    /* The strongest explicit signal the site has, and until now the only one it
       threw away: these slots are chosen from closed dropdowns, so there is no
       parsing and no guessing about what the reader meant. They went straight
       into a URL and nothing else ever saw them. */
    if (builderMode === 'teachers') {
      recordSignal('builder_submitted', {
        subject: teacherSlotValues.subject,
        classLevel: teacherSlotValues.cls,
        area: teacherSlotValues.area,
        mode: 'teachers',
      });
    } else {
      recordSignal('builder_submitted', {
        subject: paperSlotValues.subject,
        classLevel: paperSlotValues.cls,
        board: paperSlotValues.board,
        // The fourth dropdown. Explicitly chosen from a real list, and until
        // now the only slot on this form nothing downstream ever saw.
        school: paperSlotValues.school,
        mode: 'papers',
      });
    }

    if (builderMode === 'teachers') {
      const params = new URLSearchParams();
      if (teacherSlotValues.subject) params.set('filter_subjects', teacherSlotValues.subject);
      if (teacherSlotValues.cls) params.set('filter_classes', teacherSlotValues.cls.replace(/^Class /, ''));
      if (teacherSlotValues.area) params.set('filter_areas', teacherSlotValues.area);
      const qs = params.toString();
      navigate(`/all-tuition-teachers-in-kolkata${qs ? `?${qs}` : ''}`);
    } else {
      const params = new URLSearchParams();
      if (paperSlotValues.board) params.set('filter_boards', paperSlotValues.board);
      if (paperSlotValues.cls) params.set('filter_classes', paperSlotValues.cls.replace(/^Class /, ''));
      if (paperSlotValues.subject) params.set('filter_subjects', paperSlotValues.subject);
      if (paperSlotValues.school) params.set('filter_schools', rawSchoolsFor(paperSlotValues.school).join(','));
      const qs = params.toString();
      navigate(`/past-papers/results${qs ? `?${qs}` : ''}`);
    }
  }, [builderMode, teacherSlotValues, paperSlotValues, navigate]);

  return {
    builderMode,
    setBuilderMode,
    slots: builderMode === 'teachers' ? teacherSlots : paperSlots,
    onSlotChange: handleSlotChange,
    onSubmit: handleSubmit,
  };
}
