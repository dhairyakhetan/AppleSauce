/* The one copy file for the admin area: what each group, page, button, tile
   and column means, in plain words. Every page reads its wording from here so
   the same thing is never described two ways.

   Rules (a test in admin-hints.test.ts enforces them): no em or en dashes, no
   internal codes or table names, every page has a purpose and a button list,
   every nav page has a one-line description. */

export type AdminPageKey =
  | 'now'
  | 'library'
  | 'ready'
  | 'submissions'
  | 'student-queue'
  | 'admin-queue'
  | 'checker-log'
  | 'checkers'
  | 'hod'
  | 'applications'
  | 'teachers'
  | 'reviews'
  | 'activity'
  | 'feedback'
  | 'team'
  | 'pipeline'
  | 'audit';

export type AdminGroupKey = 'now' | 'papers' | 'people' | 'teachers' | 'logs' | 'system';

export interface AdminGroupCopy {
  key: AdminGroupKey;
  label: string;
  /** One line, shown under the group's tabs. */
  blurb: string;
  pages: AdminPageKey[];
}

/* Six groups, by the job an admin is doing, not by how often a page is used.
   Needs you is one page and the landing; the other five hold their pages in
   reading order: queues first, reference last, and any link that leaves the
   admin (the HOD desk, the student screen) at the very end of its group. */
export const ADMIN_GROUPS: AdminGroupCopy[] = [
  {
    key: 'now',
    label: 'Needs you',
    blurb: 'Everything waiting on you, in one place.',
    pages: ['now'],
  },
  {
    key: 'papers',
    label: 'Papers',
    blurb: 'Papers waiting to go live, questions waiting for an admin, student uploads, and the whole library.',
    pages: ['ready', 'admin-queue', 'submissions', 'library'],
  },
  {
    key: 'people',
    label: 'People',
    blurb: 'The verifiers who check questions, how far they have got, and the screens they use.',
    pages: ['checkers', 'team', 'hod', 'student-queue'],
  },
  {
    key: 'teachers',
    label: 'Teachers',
    blurb: 'Teachers who want to join, what parents say about them, and teachers already on the site.',
    pages: ['applications', 'reviews', 'teachers'],
  },
  {
    key: 'logs',
    label: 'Logs',
    blurb: 'Who changed what: questions, verifier days and admin actions.',
    pages: ['activity', 'checker-log', 'audit'],
  },
  {
    key: 'system',
    label: 'System',
    blurb: 'How the machine and the visitors are doing.',
    pages: ['pipeline', 'feedback'],
  },
];

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
  now: {
    key: 'now',
    label: 'Needs you now',
    path: '/admin',
    short: 'Everything waiting on you, biggest pile first.',
    purpose: 'Everything that is waiting on you, in one place.',
    flow: 'Start with the top row. Each row opens the queue it counts.',
    buttons: [{ label: 'Start with', does: 'Opens the queue with the most waiting, so you can begin at the top.' }],
  },
  library: {
    key: 'library',
    label: 'Library',
    path: '/admin/library',
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
    path: '/admin/paper-approvals',
    short: 'Papers waiting for your yes. The count includes any that still have a question open.',
    purpose:
      'New papers are never published automatically. When every question on a paper has been checked, it waits here as To approve. You read it as visitors will, fix anything, and approve it. Papers already live that still need your yes are here too.',
    flow: 'Open a paper marked To approve, read it, then approve it. A paper with Open questions cannot be approved yet. Switch to Already decided to see what was approved or rejected, by whom and why.',
    buttons: [
      { label: 'Review', does: 'Opens the paper. From there you can fix questions, set one aside, and approve the paper.' },
    ],
  },
  submissions: {
    key: 'submissions',
    label: 'Student uploads',
    path: '/admin/papers',
    short: 'Papers students sent in through the site, waiting for you to read and decide.',
    purpose:
      'Papers that students uploaded themselves through the Submit a paper page. Open each one to read it and decide. Uploads you approved are listed too, and can be hidden or brought back. This is separate from the Library, which holds the checked papers.',
    flow: 'Open an upload marked Pending, read it, then approve or reject it.',
    buttons: [
      { label: 'Review or View', does: 'Opens the upload so you can read it and decide. View is for uploads already decided.' },
      { label: 'Open', does: 'Shows a live paper on the site in a new tab.' },
      { label: 'Hide', does: 'Takes a live upload off the site. You give a reason.' },
      { label: 'Restore', does: 'Puts a hidden upload back on the site.' },
    ],
  },
  'student-queue': {
    key: 'student-queue',
    label: 'Try the student screen',
    path: '/checker',
    short: 'The screen verifiers use to check questions. Open it to try it yourself.',
    purpose:
      'This is the checking screen your verifiers use, one question at a time with a picture of the page. It opens in the same site so you can try it exactly as they see it.',
    flow: 'Open it, check a question, and your work is logged like anyone else.',
    buttons: [],
  },
  'admin-queue': {
    key: 'admin-queue',
    label: 'Admin queue',
    path: '/admin/admin-queue',
    short: 'Questions the checking could not settle, waiting for an admin to decide.',
    purpose:
      'Questions that neither the AI nor a verifier could settle land here. Each shows the picture of the page it came from and, in words, why it was flagged. Decide each one: it is right, it needs a fix, or it should be set aside.',
    flow: 'Work down a paper at a time. Every decision is logged and can be undone from the paper history.',
    buttons: [
      { label: 'Pass', does: 'Says the question is correct as it stands. It then counts as checked.' },
      { label: 'Edit', does: 'Lets you correct the question number, marks, words or answer choices. Each save is kept as a new version.' },
      { label: 'Set aside', does: 'Keeps the question off the site. You give a reason. The paper still goes live with an empty card in its place.' },
    ],
  },
  'checker-log': {
    key: 'checker-log',
    label: 'Checker activity',
    path: '/admin/checker-log',
    short: 'What each verifier did, day by day.',
    purpose:
      'A record of every action your verifiers took: who, how many questions, and what they did with them. Use it to see who is active and to look into a single decision.',
    flow: 'One line per person or machine. Open a name to read their days.',
    buttons: [{ label: 'Open a person', does: 'Shows that person\'s actions, newest first.' }],
  },
  checkers: {
    key: 'checkers',
    label: 'Verifiers',
    path: '/admin/checkers',
    short: 'Who is allowed to verify papers. Search for a person, add them, then fill in their details.',
    purpose:
      'The list of verifiers: people allowed to open the verifying screen. To add someone, search by their name or email: they must have signed up on Shikshaq first. Right after you add them, fill in their grade, school and board; a verifier can also fill in their own details. A verifier with no details, or no grade, still gets papers with no class limit, as if they were in Class 12. Once a grade is recorded, papers are never given above it. If the details have expired, the verifier gets no new papers until you renew them. Removing someone stops their access but keeps everything they already verified. HODs, who lead the verifiers, are managed on this page too.',
    flow: 'Search, press Add next to the right person, then fill in their details. Papers are given to them automatically.',
    buttons: [
      { label: 'Add', does: 'Lets that person open the verifying screen. They need to reload the site once. You are asked for their details straight after.' },
      { label: 'Details', does: 'Opens the form for their name, grade, school, board and the date the details are valid until.' },
      { label: 'Remove', does: 'Stops them opening the verifying screen. Their earlier work stays.' },
    ],
  },
  hod: {
    key: 'hod',
    label: 'HOD desk',
    path: '/hod',
    short: 'What verifiers sent up, how each person is doing, and which paper each one holds.',
    purpose:
      'The Head of Department screen. It shows the questions verifiers asked about, how each verifier is getting on, and who holds which paper. Papers can be given to a verifier, moved or taken back from here. Admins can use it too.',
    flow: 'Start with Escalated to me, then look at the team, then give out any papers nobody has.',
    buttons: [
      { label: 'Pass', does: 'Says the question is right as it is.' },
      { label: 'Fix', does: 'Lets you change the words, number or marks, then settles the question.' },
      { label: 'Send back', does: 'Returns the question to the verifiers with a note.' },
      { label: 'Set aside', does: 'Takes the question out of the checking for good. You must say why.' },
      { label: 'Assign to', does: 'Gives a paper nobody holds to one verifier.' },
    ],
  },
  applications: {
    key: 'applications',
    label: 'Applications',
    path: '/admin/approvals',
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
    path: '/admin/teachers',
    short: 'Teachers already on the site. Edit a profile, pause or bring one back.',
    purpose:
      'Every teacher on the site. Use it to correct a profile, or pause a teacher so parents stop seeing them for a while.',
    flow: 'Find the teacher, then edit or pause. Pausing never deletes anything.',
    buttons: [
      { label: 'Edit', does: 'Changes the teacher\'s profile details.' },
      { label: 'Pause or Unpause', does: 'Pause hides the teacher from parents without deleting anything. Unpause shows them again.' },
    ],
  },
  reviews: {
    key: 'reviews',
    label: 'Reviews',
    path: '/admin/reviews',
    short: 'What parents wrote about teachers, and teachers they recommended.',
    purpose:
      'Comments about teachers wait here before they show on the site, and so do teachers that parents recommended. Publish the good comments, remove the rest, and follow up on recommendations.',
    flow: 'Work from the top. A count on the tab shows how many are waiting.',
    buttons: [
      { label: 'Publish', does: 'Shows the comment on the teacher\'s page.' },
      { label: 'Remove', does: 'Takes a published comment off the site.' },
      { label: 'Mark as contacted', does: 'Records that you reached out about a recommended teacher.' },
      { label: 'Dismiss', does: 'Closes a recommendation you will not follow up.' },
      { label: 'Convert to application', does: 'Turns a recommendation into a teacher application.' },
    ],
  },
  activity: {
    key: 'activity',
    label: 'Question changes',
    path: '/admin/activity',
    short: 'Every change a verifier, admin or AI check made to a question.',
    purpose:
      'Every change a checker, admin or AI check made to a question, newest first. Open History on a row to see its versions or undo a change.',
    flow: 'Scroll the newest changes. Open History on a row to see its versions or undo a change.',
    buttons: [{ label: 'History', does: 'Shows the versions of that question, and lets you undo a change.' }],
  },
  feedback: {
    key: 'feedback',
    label: 'Visitor feedback',
    path: '/admin/feedback',
    short: 'Ratings and comments visitors left about the site.',
    purpose: 'Star ratings and comments that visitors left about the site as a whole, newest first. This is not about one teacher.',
    flow: 'Scroll the newest entries. Delete removes one for good.',
    buttons: [{ label: 'Delete', does: 'Removes that entry for good. You are asked first.' }],
  },
  team: {
    key: 'team',
    label: 'Verifier progress',
    path: '/admin/team',
    short: 'How many questions each verifier checked, and how the papers are moving.',
    purpose: 'How many questions each verifier checked, and how the papers are moving.',
    flow: 'Read only. Nothing here changes anything.',
    buttons: [],
  },
  pipeline: {
    key: 'pipeline',
    label: 'Pipeline',
    path: '/admin/pipeline',
    short: 'How far each batch of papers has got, from scan to live.',
    purpose:
      'Follow papers as they move from a scanned file to a live page: read by the AI, checked by verifiers, waiting for you, live. Use it to see where papers are piling up. The registry lists every source PDF the desk knows about, started or not. The library figures count papers published on the website.',
    flow: 'Read only. The numbers update when you reload.',
    buttons: [],
  },
  audit: {
    key: 'audit',
    label: 'Admin actions',
    path: '/admin/audit',
    short: 'A record of every change an admin made, with who and when.',
    purpose: 'Every admin action is written here with the person, the time and what changed. Use it to find out who did something.',
    flow: 'Read only. Nothing here changes anything.',
    buttons: [],
  },
};

export const PAGE_ORDER: AdminPageKey[] = ADMIN_GROUPS.flatMap((g) => g.pages);

/** The group a page belongs to. */
export function groupOf(page: AdminPageKey): AdminGroupCopy {
  return ADMIN_GROUPS.find((g) => g.pages.includes(page)) as AdminGroupCopy;
}

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
