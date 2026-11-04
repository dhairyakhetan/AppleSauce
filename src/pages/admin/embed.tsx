import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { BentoStack } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';

/* The Admin page (index.tsx) shows each old admin page as one section inside
   its tab. Those pages were whole screens: they drew their own header, their
   own page-height wrapper, their own help strip and their own footer note.

   Rather than rewrite them, the Admin page wraps a section in this provider and
   the few pieces that make a page a whole screen check it:

     - AdminHeader and AdminAuditNote draw nothing (the tab page has both)
     - AdminPageIntro and AdminPageIntroPanel draw nothing (the tab page shows
       the section's sentence and Help once, above the section)
     - AdminStack drops the full-height muted wrapper, so the section's panels
       sit under the tab page's own header

   A page rendered on its own, with no provider, is exactly what it was. */

const EmbedContext = createContext(false);

/** True inside a section of the Admin page. */
export function useAdminEmbedded(): boolean {
  return useContext(EmbedContext);
}

export function AdminEmbedProvider({ children }: { children: ReactNode }) {
  return <EmbedContext.Provider value={true}>{children}</EmbedContext.Provider>;
}

/** The outer wrapper of an admin page: the full-height muted stack on its own,
 *  a plain stack of panels inside a section. */
export function AdminStack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const embedded = useAdminEmbedded();
  if (embedded) return <BentoStack className={cn('bg-transparent', className)} {...props} />;
  return <BentoStack className={cn('min-h-screen bg-muted', className)} {...props} />;
}
