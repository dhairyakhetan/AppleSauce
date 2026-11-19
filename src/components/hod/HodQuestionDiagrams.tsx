import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QuestionDiagrams } from '@/components/checker/QuestionDiagrams';
import { diagramItems, diagramPaths, type DiagramItem } from '@/lib/checker-diagrams';
import type { HodApi } from '@/lib/hod-api';

/* The stored diagram(s) of a question an HOD is settling, shown beside the picture of its words, with
   no tap needed (owner, 13 Nov 2026: "diagram still missing", from the Needs you list). The checker's
   verify screen has done this since PR 98; this is the same block for the HOD card. Fail-soft: the read
   never throws, a diagram whose link is still on its way is simply not drawn yet, and a question with no
   stored diagram draws nothing. */

type DiagramApi = Pick<HodApi, 'questionDiagrams' | 'pictureUrl'>;

/** The diagrams of one question, with their signed links. `items` is empty until there is something to draw. */
export function useHodDiagrams(api: DiagramApi, questionId: string): DiagramItem[] {
  const listQuery = useQuery({
    queryKey: ['hod-question-diagrams', questionId],
    queryFn: () => api.questionDiagrams(questionId),
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const list = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const paths = useMemo(() => diagramPaths(list), [list]);
  const [urls, setUrls] = useState<Record<string, string | null | undefined>>({});

  useEffect(() => {
    let cancelled = false;
    const ids = Object.keys(paths);
    if (ids.length === 0) return;
    for (const id of ids) {
      api
        .pictureUrl(paths[id])
        .then((url) => {
          if (!cancelled) setUrls((prev) => ({ ...prev, [id]: url }));
        })
        .catch(() => {
          if (!cancelled) setUrls((prev) => ({ ...prev, [id]: null }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  return useMemo(() => diagramItems(list, urls), [list, urls]);
}

/** The block itself. Enlarging opens the picture in a new tab. */
export function HodQuestionDiagrams({ items, className }: { items: DiagramItem[]; className?: string }) {
  return <QuestionDiagrams items={items} onEnlarge={(src) => window.open(src, '_blank', 'noopener,noreferrer')} className={className} />;
}
