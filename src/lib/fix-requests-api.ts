import { supabase } from '@/integrations/supabase/client';
import {
  groupStatuses,
  newestFirst,
  normaliseRequestCounts,
  normaliseRequests,
  type FixRequest,
  type RequestCounts,
  type RequestGroup,
  type RequestKind,
  type RequestStatus,
} from '@/lib/fix-requests';

/**
 * Client wrapper for bug and edit requests. Every call is one of the functions in
 * 20261112100000_fix_requests.sql, each of which checks who is calling inside. They are not in the
 * generated types yet, hence the `as never` casts, the same as hod-api.ts. The table itself is never
 * read or written from the website.
 */

export interface NewRequest {
  kind: RequestKind;
  title: string;
  details: string;
  /** The screen it was sent from (path and query). */
  page: string;
}

export interface FixRequestsApi {
  /** request_submit(): a checker or an HOD sends one in. Returns the new request's id. */
  submit(input: NewRequest): Promise<string>;
  /** request_my_list(): the caller's own requests, newest first. */
  mine(): Promise<FixRequest[]>;
  /** hod_request_list(): HOD and admin. One group of requests, newest first. */
  list(group: RequestGroup): Promise<FixRequest[]>;
  /** hod_request_counts(): how many are in each state. */
  counts(): Promise<RequestCounts>;
  /** hod_request_decide(): yes or no on a waiting request. Returns the new state. */
  decide(id: string, approve: boolean, note: string): Promise<RequestStatus>;
}

async function call(fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn as never, (args ?? {}) as never);
  if (error) throw error;
  return data;
}

export const realFixRequestsApi: FixRequestsApi = {
  async submit(input) {
    const id = await call('request_submit', {
      p_kind: input.kind,
      p_title: input.title,
      p_details: input.details,
      p_page: input.page,
    });
    return String(id ?? '');
  },
  async mine() {
    return normaliseRequests(await call('request_my_list'));
  },
  async list(group) {
    // A group can hold more than one state (Approved holds the ones being fixed), so ask for each and merge.
    const parts = await Promise.all(groupStatuses(group).map((s) => call('hod_request_list', { p_status: s })));
    return newestFirst(parts.flatMap((p) => normaliseRequests(p)));
  },
  async counts() {
    return normaliseRequestCounts(await call('hod_request_counts'));
  },
  async decide(id, approve, note) {
    const out = await call('hod_request_decide', { p_id: id, p_approve: approve, p_note: note.trim() === '' ? null : note.trim() });
    return out === 'rejected' ? 'rejected' : 'approved';
  },
};
