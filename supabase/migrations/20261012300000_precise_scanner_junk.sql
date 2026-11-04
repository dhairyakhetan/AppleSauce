-- HOD desk follow-up (owner decision 2026-10-12): scanner junk must block on every
-- hit, so the patterns have to be PRECISE. A real question that mentions a website
-- must not be blocked.
--
-- What blocks now (body and instructions are each read on their own):
--   anywhere in the text (these phrases cannot be real question text):
--     CamScanner (and cousins: TapScanner, Adobe Scan ...)
--     "Scanned by / with / using / via <a named scanner app>"
--     "Shot on <a phone brand>"
--     "Downloaded from <a website>"
--   only at the very START or very END of the text (after spaces and . , ; : ) ] at the far end):
--     "Scanned by the scanner", "Page 3 of 5", "P.T.O.", "[Please turn over]",
--     a bare web address (no path or query, and not right after Source / Adapted from / Courtesy ...),
--     an email address, a labelled phone number ("Call 98765 43210"), a +91 phone number,
--     "Join our Telegram channel", t.me links
--   unchanged: any flag_reasons entry starting noise_ still blocks.
-- Mirrors swarm/profiles/noise_patterns.json (the vetted list). Question text is never
-- changed here: this only decides whether a question is reported as junk.

create or replace function public.noise_text_hit(p_text text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  t text := coalesce(p_text, '');
  tail constant text := '[])[:space:].,;:]*$';
  excl constant text := '(?:source|adapted[[:space:]]+from|courtesy|taken[[:space:]]+from|retrieved[[:space:]]+from|available[[:space:]]+at|accessed[[:space:]]+(?:from|at|on)|reference|credit)[^[:alnum:]]{0,4}';
  r record;
begin
  if t = '' then
    return null;
  end if;
  for r in
    select * from (values
      ('camscanner', 'any',
       '\ycam[[:space:]]?scanner\y', false),
      ('scanned_by_app', 'any',
       '\yscanned[[:space:]]+(?:by|with|using|via|on)[[:space:]]+(?:the[[:space:]]+|my[[:space:]]+)?(?:(?:cam|tap|clear|tiny|easy|smart[[:space:]]?doc|doc)[[:space:]]?scanner|[a-z]{2,}scanner|adobe[[:space:]]+scan|office[[:space:]]+lens|microsoft[[:space:]]+lens|genius[[:space:]]+scan|simple[[:space:]]?scan|turbo[[:space:]]?scan|vflat|notebloc|swiftscan)\y', false),
      ('shot_on_device', 'any',
       '\yshot[[:space:]]+(?:on|with|by)[[:space:]]+(?:my[[:space:]]+)?(?:one[[:space:]]?plus|redmi|poco|vivo|oppo|realme|samsung|galaxy|iphone|xiaomi|motorola|nokia|pixel|huawei|honor|infinix|tecno|lenovo|mi)\y', false),
      ('downloaded_from_site', 'any',
       '\ydownloaded[[:space:]]+(?:from|via|by)[[:space:]]*:?[[:space:]]*(?:https?://[^[:space:]]+|www\.[^[:space:]]+|[a-z0-9-]+\.(?:com|co\.in|in|org|net|info|edu)\y)', false),
      ('scanned_by_scanner', 'edge',
       '\yscanned[[:space:]]+(?:by|with|using|via)[[:space:]]+(?:the[[:space:]]+|my[[:space:]]+)?(?:scanner|scan)(?:[[:space:]]+(?:app|pro))?\y', false),
      ('page_x_of_y', 'edge',
       '\ypage[[:space:]]+[0-9]{1,3}[[:space:]]*(?:of|/)[[:space:]]*[0-9]{1,3}\y', false),
      ('pto', 'edge',
       '\mP\.[[:space:]]?T\.[[:space:]]?O\.?', false),
      ('please_turn_over', 'edge',
       '\[?[[:space:]]*please[[:space:]]+turn[[:space:]]+over[[:space:]]*\]?', false),
      ('url', 'edge',
       '(?<![[:alnum:]/.@_-])(?:(?:https?://|www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+/?|[a-z0-9-]{3,}\.(?:com|co\.in|org|net)\y/?)(?![[:alnum:]_/#?=&%.-]*[/?#=&])', true),
      ('email', 'edge',
       '(?<![[:alnum:]/.@_-])[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\y', true),
      ('phone_labelled', 'edge',
       '\y(?:call|contact|ph(?:one)?|mob(?:ile)?|whats[[:space:]]?app|wa)\y\.?[[:space:]]*(?:no\.?|number|us(?:[[:space:]]+at)?)?[[:space:]]*[:-]?[[:space:]]*(?:\+?91[[:space:]-]?)?[6-9][0-9]{4}[[:space:]-]?[0-9]{5}(?![0-9])', false),
      ('phone_plus91', 'edge',
       '(?<![0-9.])(?:\+91[[:space:]-]?[6-9][0-9]{4}[[:space:]-]?[0-9]{5}|91[[:space:]-][6-9][0-9]{4}[[:space:]-]?[0-9]{5})(?![0-9])', false),
      ('join_channel', 'edge',
       '\y(?:join|follow|subscribe[[:space:]]+to|subscribe)[[:space:]]+(?:us|our|my)[[:space:]]+(?:on[[:space:]]+)?(?:telegram|whatsapp|youtube|instagram|facebook|channel)\y[^.]{0,60}', false),
      ('telegram_link', 'edge',
       '\yt\.me/[^[:space:]]*[^].,;:)[:space:]]|\ytelegram[[:space:]]*(?:id|channel)?[[:space:]]*[:@][[:space:]]*@?[[:alnum:]_]{3,}', false)
    ) v(id, pos, rx, use_excl)
  loop
    if r.pos = 'any' then
      if t ~* r.rx then
        return r.id;
      end if;
    else
      if t ~* ('^[[:space:]]*(?:' || r.rx || ')') then
        return r.id;
      end if;
      if r.use_excl then
        if t ~* ('(?<!' || excl || ')(?:' || r.rx || ')' || tail) then
          return r.id;
        end if;
      elsif t ~* ('(?:' || r.rx || ')' || tail) then
        return r.id;
      end if;
    end if;
  end loop;
  return null;
end;
$fn$;

revoke all on function public.noise_text_hit(text) from public, anon, authenticated;

create or replace function public.paper_noise_hits(p_audit_paper_id uuid)
returns table(question_id uuid, display_number text, reason text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select q.id,
         q.display_number,
         case when exists (select 1 from unnest(coalesce(q.flag_reasons, '{}'::text[])) r
                            where r::text like 'noise\_%')
              then 'Marked as scanner noise'
              else 'Looks like a scanner watermark' end
    from public.audit_questions q
   where q.paper_id = p_audit_paper_id
     and q.set_aside_at is null
     and (
           exists (select 1 from unnest(coalesce(q.flag_reasons, '{}'::text[])) r
                    where r::text like 'noise\_%')
        or public.noise_text_hit(q.body) is not null
        or public.noise_text_hit(q.instructions) is not null
         )
   order by q.ord, q.id;
$$;

revoke all on function public.paper_noise_hits(uuid) from public, anon, authenticated;
