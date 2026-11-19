-- Owner, 2026-10-08: "reduce the no. 200 to 100 (i.e. 200 minimum papers to vet before an admin
-- gets the option to "trust" AI is too high, 100 is fine)".
--
-- The bar lives in one function (20261007120000_ai_trust_levels.sql): the meter, the trust switch
-- check, the automatic switch-off window ("the latest N checks") and the pipeline all read it.
-- Only the minimum number of checks changes; 97% and 1-in-20 spot checks stay.

create or replace function public.ai_trust_bar()
returns table(min_rate numeric, min_checked integer, spot_check_every integer)
language sql immutable
as $$ select 0.97::numeric, 100, 20; $$;

-- create or replace keeps the existing ACL (service_role only); restate it so it can never widen.
revoke all on function public.ai_trust_bar() from public, anon, authenticated;
grant execute on function public.ai_trust_bar() to service_role;
