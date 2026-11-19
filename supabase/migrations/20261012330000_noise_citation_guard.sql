-- Follow-up to 20261012300000 after running it over every audit paper: a web address or
-- email at the very end that is a printed CITATION or an address inside a question was still
-- flagged, for example "(adapted/moderated -livemint.com)", "Source -National Sleep Foundation
-- (sleepfoundation.org)" and a letter question that ends "or email to hr@anandcorp.com.".
--
-- A web address at the end is now ignored when a citation word (source, adapted, moderated,
-- edited, courtesy, credit, reference, retrieved, accessed, taken from, available at) comes
-- shortly before it in the same sentence. An email at the end is also ignored right after
-- "email", "mail", "to", "at", "on", "via", "address", "id" or "contact". A stray page-footer
-- stamp such as "... SPECIMEN QUESTION PAPER 2026 6 https://www.icseonline.com" is still caught.

create or replace function public.noise_text_hit(p_text text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  t text := coalesce(p_text, '');
  tail constant text := '[])[:space:].,;:]*$';
  excl_url constant text := '(?:source|adapted|moderated|edited|courtesy|credit|reference|retrieved|accessed|taken[[:space:]]+from|available[[:space:]]+at)[^.]{0,60}';
  excl_email constant text := '(?:source|adapted|moderated|edited|courtesy|credit|reference|retrieved|accessed|taken[[:space:]]+from|available[[:space:]]+at)[^.]{0,60}|(?:e-?mail|mail|to|at|on|via|address|id|contact)[^[:alnum:]]{0,4}';
  ex text;
  r record;
begin
  if t = '' then
    return null;
  end if;
  for r in
    select * from (values
      ('camscanner', 'any',
       '\ycam[[:space:]]?scanner\y', ''),
      ('scanned_by_app', 'any',
       '\yscanned[[:space:]]+(?:by|with|using|via|on)[[:space:]]+(?:the[[:space:]]+|my[[:space:]]+)?(?:(?:cam|tap|clear|tiny|easy|smart[[:space:]]?doc|doc)[[:space:]]?scanner|[a-z]{2,}scanner|adobe[[:space:]]+scan|office[[:space:]]+lens|microsoft[[:space:]]+lens|genius[[:space:]]+scan|simple[[:space:]]?scan|turbo[[:space:]]?scan|vflat|notebloc|swiftscan)\y', ''),
      ('shot_on_device', 'any',
       '\yshot[[:space:]]+(?:on|with|by)[[:space:]]+(?:my[[:space:]]+)?(?:one[[:space:]]?plus|redmi|poco|vivo|oppo|realme|samsung|galaxy|iphone|xiaomi|motorola|nokia|pixel|huawei|honor|infinix|tecno|lenovo|mi)\y', ''),
      ('downloaded_from_site', 'any',
       '\ydownloaded[[:space:]]+(?:from|via|by)[[:space:]]*:?[[:space:]]*(?:https?://[^[:space:]]+|www\.[^[:space:]]+|[a-z0-9-]+\.(?:com|co\.in|in|org|net|info|edu)\y)', ''),
      ('scanned_by_scanner', 'edge',
       '\yscanned[[:space:]]+(?:by|with|using|via)[[:space:]]+(?:the[[:space:]]+|my[[:space:]]+)?(?:scanner|scan)(?:[[:space:]]+(?:app|pro))?\y', ''),
      ('page_x_of_y', 'edge',
       '\ypage[[:space:]]+[0-9]{1,3}[[:space:]]*(?:of|/)[[:space:]]*[0-9]{1,3}\y', ''),
      ('pto', 'edge',
       '\mP\.[[:space:]]?T\.[[:space:]]?O\.?', ''),
      ('please_turn_over', 'edge',
       '\[?[[:space:]]*please[[:space:]]+turn[[:space:]]+over[[:space:]]*\]?', ''),
      ('url', 'edge',
       '(?<![[:alnum:]/.@_-])(?:(?:https?://|www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+/?|[a-z0-9-]{3,}\.(?:com|co\.in|org|net)\y/?)(?![[:alnum:]_/#?=&%.-]*[/?#=&])', 'url'),
      ('email', 'edge',
       '(?<![[:alnum:]/.@_-])[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\y', 'email'),
      ('phone_labelled', 'edge',
       '\y(?:call|contact|ph(?:one)?|mob(?:ile)?|whats[[:space:]]?app|wa)\y\.?[[:space:]]*(?:no\.?|number|us(?:[[:space:]]+at)?)?[[:space:]]*[:-]?[[:space:]]*(?:\+?91[[:space:]-]?)?[6-9][0-9]{4}[[:space:]-]?[0-9]{5}(?![0-9])', ''),
      ('phone_plus91', 'edge',
       '(?<![0-9.])(?:\+91[[:space:]-]?[6-9][0-9]{4}[[:space:]-]?[0-9]{5}|91[[:space:]-][6-9][0-9]{4}[[:space:]-]?[0-9]{5})(?![0-9])', ''),
      ('join_channel', 'edge',
       '\y(?:join|follow|subscribe[[:space:]]+to|subscribe)[[:space:]]+(?:us|our|my)[[:space:]]+(?:on[[:space:]]+)?(?:telegram|whatsapp|youtube|instagram|facebook|channel)\y[^.]{0,60}', ''),
      ('telegram_link', 'edge',
       '\yt\.me/[^[:space:]]*[^].,;:)[:space:]]|\ytelegram[[:space:]]*(?:id|channel)?[[:space:]]*[:@][[:space:]]*@?[[:alnum:]_]{3,}', '')
    ) v(id, pos, rx, guard)
  loop
    if r.pos = 'any' then
      if t ~* r.rx then
        return r.id;
      end if;
    else
      if t ~* ('^[[:space:]]*(?:' || r.rx || ')') then
        return r.id;
      end if;
      ex := case r.guard when 'url' then excl_url when 'email' then excl_email else null end;
      if ex is not null then
        if t ~* ('(?<!(?:' || ex || '))(?:' || r.rx || ')' || tail) then
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
