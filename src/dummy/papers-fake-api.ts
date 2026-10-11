import type { PaperPayload, PaperRow, PapersApi, SubmissionRow } from '@/pages/admin/papers';

/* In-memory fake of the Student uploads page's reads and writes (D75). Every
   school, student and paper is MADE UP. Publish, hide, restore, approve and
   reject change this copy only; nothing is stored anywhere. */

function paper(i: number, over: Partial<PaperRow>): PaperRow {
  return {
    id: `b${i}0001`,
    title: 'Prelims 2025',
    school: 'Sample Hill School',
    subject: 'Mathematics',
    class: '10',
    board: 'ICSE',
    exam_type: 'Prelims',
    year: 2025,
    file_url: null,
    is_published: true,
    created_at: `2026-09-${String(10 + i).padStart(2, '0')}T08:00:00Z`,
    ...over,
  };
}

function submission(i: number, over: Partial<SubmissionRow>): SubmissionRow {
  return {
    id: `c${i}0001`,
    created_at: `2026-10-0${i}T07:30:00Z`,
    school: 'Riverside Academy',
    board: 'ICSE',
    class: '10',
    subject: 'Physics',
    year: '2025',
    exam_type: 'Prelim / Pre-board',
    submitter_name: 'Ananya Roy',
    submitter_contact: 'ananya@example.com',
    file_paths: ['made-up/page-1.jpg', 'made-up/page-2.jpg'],
    status: 'pending',
    review_note: null,
    reviewed_at: null,
    reviewed_by: null,
    ...over,
  };
}

export function createFakePapersApi(): PapersApi {
  const papers: PaperRow[] = [
    paper(1, {}),
    paper(2, { title: 'Half-Yearly 2024', school: 'Lakeview Institute', subject: 'Commerce', class: '11', board: 'CBSE', exam_type: 'Half-Yearly', year: 2024 }),
    paper(3, { title: 'Final 2023', school: 'Greenfield School', subject: 'English', class: '9', exam_type: 'Final', year: 2023, is_published: false }),
    paper(4, { title: 'Unit Test 2025', school: 'Riverside Academy', subject: 'Chemistry', class: '12', board: 'CBSE', exam_type: 'Unit Test', year: 2025 }),
  ];
  const submissions: SubmissionRow[] = [
    submission(1, {}),
    submission(2, { school: 'Lakeview Institute', subject: 'Biology', class: '9', year: '2024', exam_type: 'Annual / Final', submitter_name: 'Dev Malhotra', submitter_contact: null, file_paths: ['made-up/scan.pdf'] }),
    submission(3, { school: 'Greenfield School', subject: 'History', class: '10', board: null, year: null, exam_type: null, submitter_name: null, submitter_contact: null, file_paths: [] }),
    submission(4, { school: 'Sample Hill School', subject: 'Mathematics', status: 'approved', reviewed_at: '2026-10-05T10:00:00Z', reviewed_by: 'dummy-admin' }),
    submission(5, { school: 'Riverside Academy', subject: 'Geography', status: 'rejected', review_note: 'Pages were out of focus.', reviewed_at: '2026-10-04T10:00:00Z', reviewed_by: 'dummy-admin' }),
  ];
  let seq = 10;

  return {
    async papers() {
      return papers.map((p) => ({ ...p }));
    },
    async submissions() {
      return submissions.map((s) => ({ ...s, file_paths: [...s.file_paths] }));
    },
    async uploadPdf(file) {
      return `https://example.invalid/paper-files/papers/${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    },
    async removeUploaded() {
      /* nothing stored */
    },
    async insertPaper(payload: PaperPayload) {
      const id = `b${seq++}0001`;
      papers.unshift({ id, created_at: new Date().toISOString(), ...payload });
      return id;
    },
    async setPublished(id, published) {
      const p = papers.find((x) => x.id === id);
      if (p) p.is_published = published;
    },
    async signSubmissionFiles(paths) {
      return paths.map((path, i) => ({ path, url: i === 0 ? 'about:blank' : null }));
    },
    async approveSubmission({ target, title, board, cls, examType, year, reviewerId }) {
      const id = `b${seq++}0001`;
      const reviewedAt = new Date().toISOString();
      papers.unshift({
        id,
        title,
        school: target.school,
        subject: target.subject,
        class: cls,
        board,
        exam_type: examType,
        year: Number(year),
        file_url: null,
        is_published: true,
        created_at: reviewedAt,
      });
      const s = submissions.find((x) => x.id === target.id);
      if (s) Object.assign(s, { status: 'approved', reviewed_at: reviewedAt, reviewed_by: reviewerId });
      return { paperId: id, reviewedAt };
    },
    async rejectSubmission(id, reason, reviewerId) {
      const reviewedAt = new Date().toISOString();
      const s = submissions.find((x) => x.id === id);
      if (s) Object.assign(s, { status: 'rejected', review_note: reason, reviewed_at: reviewedAt, reviewed_by: reviewerId });
      return { reviewedAt };
    },
  };
}
