-- class_grade stripped lowercase letters before upper-casing, so 'Class X',
-- 'Std 9', 'Grade XII', 'ix' and 'Class-XI' all read as unknown (found in
-- the 7 Oct edge-case run). No live value is shaped like that today (every
-- class is 'X', 'XII', '10', 'GRADE X' and so on, all unchanged by this
-- fix), but an import that wrote 'Class X' would have hidden those papers
-- from every verifier below Class 12. Upper-case first, then strip.

create or replace function public.class_grade(p_class text)
returns integer
language sql immutable
as $$
  with t as (select regexp_replace(upper(coalesce(p_class, '')), '(GRADE|CLASS|STD|TH|ST|ND|RD|[^A-Z0-9])', '', 'g') as s)
  select case
    when s ~ '^[0-9]{1,2}$' and s::int between 1 and 12 then s::int
    else array_position(array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'], s) end
  from t;
$$;
