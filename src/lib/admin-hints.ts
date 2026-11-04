/* The one copy file for the admin area: what each tab, section, button, tile
   and column means, in plain words. Every page reads its wording from here so
   the same thing is never described two ways.

   Rules (a test in admin-hints.test.ts enforces them): no em or en dashes, no
   internal codes or table names, every page has a purpose and a button list,
   every nav page has a one-line description. */

export type AdminPageKey =
  | 'library'
  | 'ready'
  | 'submissions'
  | 'admin-queue'
  | 'checker-log'
  | 'positions'
  | 'checkers'
  | 'hods'
  | 'reviewers'
  | 'applications'
  | 'teachers'
  | 'reviews'
  | 'activity'
  | 'feedback'
  | 'team'
  | 'pipeline'
  | 'audit';

/** The four tabs of the Admin page, the same row-of-tabs layout as the HOD desk. */
export type AdminTabKey = 'people' | 'teachers' | 'logs' | 'system';

export interface AdminSectionCopy {
  /** In the address as ?section=. */
  key: string;
  label: string;
  /** The page whose wording (one line, purpose, buttons) this section uses. */
  page: AdminPageKey;
}

export interface AdminTabCopy {
  key: AdminTabKey;
  label: string;
  /** Shown as the tab's tooltip. */
  hint: string;
  /** One sentence under the tab row: what this tab is for. */
  summary: string;
  sections: AdminSectionCopy[];
}

/* Four tabs, by the job an admin is doing. Papers are not here: everything
   about getting a paper checked and live is on the HOD desk (/hod), which
   admins can open too. A section is one of the old pages shown inside its tab,
   so a tab with one section shows no second row. */
export const ADMIN_TABS: AdminTabCopy[] = [
  {
    key: 'people',
    label: 'People',
    hint: 'Positions, verifiers, HODs, teacher reviewers and how far the verifiers have got.',
    summary: 'The people who work on the site: who holds each position, who checks papers, who leads them, who reviews teachers, and how much each has done.',
    sections: [
      { key: 'positions', label: 'Positions', page: 'positions' },
      { key: 'verifiers', label: 'Verifiers', page: 'checkers' },
      { key: 'hods', label: 'HODs', page: 'hods' },
      { key: 'reviewers', label: 'Teacher reviewers', page: 'reviewers' },
      { key: 'progress', label: 'Progress', page: 'team' },
    ],
  },
  {
    key: 'teachers',
    label: 'Teachers',
    hint: 'Teachers who want to join, what parents say about them, and teachers already listed.',
    summary: 'Teachers who want to join, what parents say about teachers, and teachers already on the site.',
    sections: [
      { key: 'applications', label: 'Applications', page: 'applications' },
      { key: 'reviews', label: 'Reviews', page: 'reviews' },
      { key: 'listed', label: 'Listed teachers', page: 'teachers' },
    ],
  },
  {
    key: 'logs',
    label: 'Logs',
    hint: 'Who changed what: questions, verifier work and admin actions.',
    summary: 'A read-only record of who changed what: questions, verifier work and admin actions.',
    sections: [
      { key: 'question-changes', label: 'Question changes', page: 'activity' },
      { key: 'checker-activity', label: 'Checker activity', page: 'checker-log' },
      { key: 'admin-actions', label: 'Admin actions', page: 'audit' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    hint: 'How far papers have got, and what visitors say about the site.',
    summary: 'How the papers are moving, and how visitors rate the site.',
    sections: [
      { key: 'pipeline', label: 'Pipeline', page: 'pipeline' },
      { key: 'feedback', label: 'Visitor feedback', page: 'feedback' },
    ],
  },
];

/** The address of a tab, or of one section inside it. */
export function adminHref(tab: AdminTabKey, section?: string): string {
  return section ? `/admin?tab=${tab}&section=${section}` : `/admin?tab=${tab}`;
}

/** The tab a page lives in, or null for a page that moved to the HOD desk. */
export function tabOfPage(page: AdminPageKey): AdminTabCopy | null {
  return ADMIN_TABS.find((t) => t.sections.some((s) => s.page === page)) ?? null;
}

/** Where a page is now, as a whole address. Pages that moved to the HOD desk say so. */
export function adminPageHref(page: AdminPageKey): string {
  const tab = tabOfPage(page);
  const section = tab?.sections.find((s) => s.page === page);
  if (tab && section) return adminHref(tab.key, section.key);
  return ADMIN_PAGES[page].path;
}

export interface ButtonCopy {
  label: string;
  does: string;
}

export interface AdminPageCopy {
  key: AdminPageKey;
  /** The tab label. */
  label: string;
  path: string;
  /** One line under the tab (hover, and the map of the admin). */
  short: string;
  /** "What this page is for", one or two sentences. */
  purpose: string;
  /** What is supposed to happen here, as a short sentence. */
  flow: string;
  buttons: ButtonCopy[];
}

export const ADMIN_PAGES: Record<AdminPageKey, AdminPageCopy> = {
  library: {
    key: 'library',
    label: 'Live papers',
    path: '/hod?tab=live',
    short: 'Every paper on the site. Find one, fix it, hide it or bring it back.',
    purpose:
      'Every past paper in the library, live or hidden. Use it to find a paper, see how far its checking has got, open it to fix a question, or hide it from visitors.',
    flow: 'Pick a view, find the paper, then open it. Hidden papers say why they were hidden.',
    buttons: [
      { label: 'History', does: 'Shows every change made to the paper, with who made it. You can undo most changes from there.' },
      {
        label: 'Edit',
        does: 'Opens the paper. Header details change the live paper at once. Question edits are saved as a draft until you verify them.',
      },
      { label: 'Hide', does: 'Takes the paper off the site straight away. You must give a reason, which stays on the paper.' },
      { label: 'Restore', does: 'Puts a hidden paper back on the site.' },
    ],
  },
  ready: {
    key: 'ready',
    label: 'Ready to go live',
    path: '/hod?tab=ready',
    short: 'Papers waiting for a yes before they go on the site.',
    purpose:
      'New papers are never published automatically. When every question on a paper has been checked, it waits here. You read it as visitors will, fix anything, and approve it.',
    flow: 'Open a paper, read it, then approve it. A paper with open questions cannot be approved yet.',
    buttons: [
      { label: 'Review', does: 'Opens the paper. From there you can fix questions, set one aside, and approve the paper.' },
    ],
  },
  submissions: {
    key: 'submissions',
    label: 'Student uploads',
    path: '/hod?tab=uploads',
    short: 'Papers students sent in through the site, waiting for you to read and decide.',
    purpose:
      'Papers that students uploaded themselves through the Submit a paper page. Open each one to read it and decide. Uploads you approved are listed too, and can be hidden or brought back.',
    flow: 'Open an upload marked Pending, read it, then approve or reject it.',
    buttons: [
      { label: 'Review or View', does: 'Opens the upload so you can read it and decide. View is for uploads already decided.' },
      { label: 'Open', does: 'Shows a live paper on the site in a new tab.' },
      { label: 'Hide', does: 'Takes a live upload off the site. You give a reason.' },
      { label: 'Restore', does: 'Puts a hidden upload back on the site.' },
    ],
  },
  'admin-queue': {
    key: 'admin-queue',
    label: 'Needs you',
    path: '/hod?tab=needs-you',
    short: 'Questions the checking could not settle, waiting for a person to decide.',
    purpose:
      'Questions that neither the AI nor a verifier could settle land here. Each shows the picture of the page it came from and, in words, why it was flagged. Decide each one: it is right, it needs a fix, or it should be set aside.',
    flow: 'Work down a paper at a time. Every decision is logged and can be undone from the paper history.',
    buttons: [
      { label: 'Pass', does: 'Says the question is correct as it stands. It then counts as checked.' },
      { label: 'Edit', does: 'Lets you correct the question number, marks, words or answer choices. Each save is kept as a new version.' },
      { label: 'Set aside', does: 'Keeps the question off the site. You give a reason. The paper still goes live with an empty card in its place.' },
    ],
  },
  positions: {
    key: 'positions',
    label: 'Positions',
    path: '/admin?tab=people&section=positions',
    short: 'Everyone who is an admin, HOD, verifier or teacher reviewer. Add an email, change a position or remove one.',
    purpose:
      'One list of who holds each position. Type an email and pick a position to add someone, even if they have not signed up yet: they get it the first time they sign in with Google using that email. Change moves a person from one position to another in one step. You cannot remove or change your own admin position, and the owner account cannot be removed.',
    flow: 'Type an email, pick a position, press Add. Use Change or Remove on a row to adjust it later.',
    buttons: [
      { label: 'Add', does: 'Gives that email the chosen position. With no account yet, it waits for their first Google sign-in.' },
      { label: 'Change', does: 'Moves the person to another position in one step. If the new one cannot be given, nothing changes.' },
      { label: 'Remove', does: 'Takes the position away after you confirm. On a waiting entry it cancels the grant.' },
    ],
  },
  checkers: {
    key: 'checkers',
    label: 'Verifiers',
    path: '/admin?tab=people&section=verifiers',
    short: 'People allowed to check questions. Search for a person to add them, or remove one.',
    purpose:
      'The verifiers are the people allowed to open the checking screen. To add someone, search by their name or email. They must have signed up on Shikshaq first. Removing someone stops their access but keeps everything they already checked. Their grade, school and board are filled in on the HOD desk, where you can also see how each verifier is doing and which papers they hold.',
    flow: 'Search, press Add next to the right person, then open the HOD desk to fill in their details.',
    buttons: [
      { label: 'Add', does: 'Lets that person open the checking screen. They need to reload the site once.' },
      { label: 'Details', does: 'Opens the HOD desk, where their grade, school, board and preferred subjects are saved.' },
      { label: 'Remove', does: 'Stops them opening the checking screen. Their earlier work stays.' },
    ],
  },
  hods: {
    key: 'hods',
    label: 'HODs',
    path: '/admin?tab=people&section=hods',
    short: 'People who lead the verifiers and use the HOD desk. Only admins can add or remove them.',
    purpose:
      'An HOD is a Head of Department. They settle questions the verifiers could not, give out papers and watch how the team is doing, all on the HOD desk. Admins can open the HOD desk too, so you do not need to add yourself.',
    flow: 'Search for a person, press Make HOD, and ask them to reload the site once.',
    buttons: [
      { label: 'Make HOD', does: 'Lets that person open the HOD desk.' },
      { label: 'Remove', does: 'Stops them opening the HOD desk. Decisions they already made stay.' },
    ],
  },
  reviewers: {
    key: 'reviewers',
    label: 'Teacher reviewers',
    path: '/admin?tab=people&section=reviewers',
    short: 'People who approve and edit teachers without being admins.',
    purpose:
      'Teacher reviewers approve, reject and edit teachers on the teacher review page. They cannot pause a teacher or open papers. The HOD desk shows the same list.',
    flow: 'Search for a person and press Make teacher reviewer. Remove them when they no longer need it.',
    buttons: [
      { label: 'Make teacher reviewer', does: 'Lets that person open the teacher review page.' },
      { label: 'Remove', does: 'Stops them opening the teacher review page. Decisions they already made stay.' },
    ],
  },
  applications: {
    key: 'applications',
    label: 'Applications',
    path: '/admin?tab=teachers&section=applications',
    short: 'Teachers who applied to join. Approve or turn down each one.',
    purpose:
      'New teacher applications. Open one to read the details and documents, then approve or reject it. A count on the tab shows how many are waiting.',
    flow: 'Work from the top. Open an application to decide.',
    buttons: [
      { label: 'Approve', does: 'Accepts the application.' },
      { label: 'Reject', does: 'Turns the application down. You write the reason first.' },
    ],
  },
  teachers: {
    key: 'teachers',
    label: 'Listed teachers',
    path: '/admin?tab=teachers&section=listed',
    short: 'Teachers already on the site. Edit a profile, pause or bring one back.',
    purpose:
      'Every teacher on the site. Use it to correct a profile, or pause a teacher so parents stop seeing them for a while.',
    flow: 'Find the teacher, then edit or pause. Pausing never deletes anything.',
    buttons: [
      { label: 'Edit', does: "Changes the teacher's profile details." },
      { label: 'Pause or Unpause', does: 'Pause hides the teacher from parents without deleting anything. Unpause shows them again.' },
    ],
  },
  reviews: {
    key: 'reviews',
    label: 'Reviews',
    path: '/admin?tab=teachers&section=reviews',
    short: 'What parents wrote about teachers, and teachers they recommended.',
    purpose:
      'Comments about teachers wait here before they show on the site, and so do teachers that parents recommended. Publish the good comments, remove the rest, and follow up on recommendations.',
    flow: 'Work from the top. A count on the tab shows how many are waiting.',
    buttons: [
      { label: 'Publish', does: "Shows the comment on the teacher's page." },
      { label: 'Remove', does: 'Takes a published comment off the site.' },
      { label: 'Mark as contacted', does: 'Records that you reached out about a recommended teacher.' },
      { label: 'Dismiss', does: 'Closes a recommendation you will not follow up.' },
      { label: 'Convert to application', does: 'Turns a recommendation into a teacher application.' },
    ],
  },
  activity: {
    key: 'activity',
    label: 'Question changes',
    path: '/admin?tab=logs&section=question-changes',
    short: 'Every change a verifier, admin or the AI made to a question.',
    purpose:
      'Every change a verifier, admin or the AI made to a question, newest first. Open History on a row to see its versions or undo a change.',
    flow: 'Scroll the newest changes. Open History on a row to see its versions or undo a change.',
    buttons: [{ label: 'History', does: 'Shows the versions of that question, and lets you undo a change.' }],
  },
  'checker-log': {
    key: 'checker-log',
    label: 'Checker activity',
    path: '/admin?tab=logs&section=checker-activity',
    short: 'What each verifier did, day by day.',
    purpose:
      'A record of every action your verifiers took: who, how many questions, and what they did with them. Use it to see who is active and to look into a single decision.',
    flow: 'One line per person or machine. Open a name to read their days.',
    buttons: [{ label: 'Open a person', does: "Shows that person's actions, newest first." }],
  },
  audit: {
    key: 'audit',
    label: 'Admin actions',
    path: '/admin?tab=logs&section=admin-actions',
    short: 'A record of every change an admin made, with who and when.',
    purpose: 'Every admin action is written here with the person, the time and what changed. Use it to find out who did something.',
    flow: 'Read only. Nothing here changes anything.',
    buttons: [],
  },
  team: {
    key: 'team',
    label: 'Verifier progress',
    path: '/admin?tab=people&section=progress',
    short: 'How many questions each verifier checked, and how the papers are moving.',
    purpose: 'How many questions each verifier checked, and how the papers are moving. To give out papers or change a verifier, use the HOD desk.',
    flow: 'Read only. Nothing here changes anything.',
    buttons: [],
  },
  pipeline: {
    key: 'pipeline',
    label: 'Pipeline',
    path: '/admin?tab=system&section=pipeline',
    short: 'Every paper on its way from a PDF saved on the main computer to live.',
    purpose:
      "One picture of the whole route: PDFs saved on the main computer, read by the AI, pictures waiting, checking by students, needs you, ready to go live, live. HODs see the same route from the HOD desk. Use it to see where papers are piling up. The numbers are only as new as the desk's last sync, and the page says when that was.",
    flow: 'Read only. The route checks again every 20 seconds. A stage that says ? has not been sent by the desk yet.',
    buttons: [],
  },
  feedback: {
    key: 'feedback',
    label: 'Visitor feedback',
    path: '/admin?tab=system&section=feedback',
    short: 'Ratings and comments visitors left about the site.',
    purpose: 'Star ratings and comments that visitors left about the site as a whole, newest first. This is not about one teacher.',
    flow: 'Scroll the newest entries. Delete removes one for good.',
    buttons: [{ label: 'Delete', does: 'Removes that entry for good. You are asked first.' }],
  },
};

/** The one description of where a hide reason goes, for every Hide dialog.
 *  Visitors never see it: admins read it on the row and in the history. */
export const HIDE_REASON_NOTE = '(required, only admins see it)';

/** Info tips for tiles, chips and columns. Keyed by a short name each page
 *  picks; kept here so a word means the same thing everywhere. */
export const TIPS = {
  // Library views
  'view.live': 'On the site now and every question has been checked.',
  'view.needs_review': 'On the site now, but some questions are not checked yet. Hidden papers are not counted here.',
  'view.hidden': 'Not visible to visitors. The reason it was hidden is shown on the row, for admins only.',
  'view.with_students': 'Has questions waiting in the student checking queue.',
  'view.with_admin': 'Has questions waiting for an admin in the Admin queue.',
  'view.ready': 'Every question is checked and the paper is waiting in Ready to go live for your yes.',
  'view.incomplete': 'The paper has a note saying something is missing from it, such as a page.',
  'view.all': 'Every paper, whatever its state.',
  // Library columns
  'col.school': 'The school the paper came from.',
  'col.subject': 'The subject printed on the paper.',
  'col.class': 'The class the paper is set for.',
  'col.year': 'The year the paper was sat.',
  'col.progress': 'Questions checked out of the questions on the paper.',
  'col.to_check': 'Questions on the paper nobody has checked yet.',
  'col.status': 'Live means visitors can see it. Hidden means they cannot.',
  'col.why_hidden': 'The reason the person who hid the paper gave.',
  // Admin queue
  'queue.questions': 'Questions waiting for an admin, across all papers.',
  'queue.papers': 'How many different papers the questions waiting for an admin belong to.',
  'queue.shown': 'How many are on this page of the list.',
  // Ready to go live
  'ready.waiting': 'Papers waiting for you. Some may still have a question to pass or set aside.',
  'ready.ready': 'Papers with no open questions. These can be approved now.',
  'ready.open': 'Papers that still have questions to pass or set aside. They cannot be approved yet.',
  'ready.live': 'Papers already on the site that have not had your yes yet.',
  'col.ready.paper': 'The paper\'s board, class, subject and year.',
  'col.ready.questions': 'Questions passed, still open, and set aside on this paper.',
  'col.ready.ai': 'What the AI did with the questions before any person looked.',
  'col.ready.waiting': 'How long the paper has been waiting for you.',
  'col.ready.state': 'Ready can be approved now. A number means that many questions are still open.',
  'col.decided.result': 'Approved means it went live. Rejected means it was sent back and is not on the site.',
  'col.decided.by': 'The admin who made the decision.',
  'col.decided.when': 'When the decision was made.',
  'col.decided.note': 'The note the admin left with the decision.',
  // Checkers
  'col.checker': 'The person allowed to check papers.',
  'col.added': 'When they were given access.',
  'col.today': 'Questions they checked today.',
  'col.total': 'Questions they checked since they were added.',
  'checkers.count': 'People who can open the checking screen right now.',
  'checkers.search': 'Type at least two letters of a name or email. Only people who have signed up on Shikshaq show up.',
} as const;

export type TipKey = keyof typeof TIPS;
