-- Restringe el registro a emails corporativos @alverlamp.es.
--
-- Se aplica sobre el trigger que ya crea el perfil en public.profiles.
-- Si el email no pertenece al dominio, la excepción aborta el INSERT en
-- auth.users y la cuenta no se crea, aunque alguien llame directamente a la
-- API de Supabase sin pasar por la web.
--
-- Aplicar con: supabase db push
--
-- Auditoría de cuentas ya existentes (ejecutar a mano si hace falta):
--   select id, email from public.profiles
--   where split_part(lower(trim(email)), '@', 2) <> 'alverlamp.es';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.email is null
     or split_part(lower(trim(new.email)), '@', 2) <> 'alverlamp.es' then
    raise exception 'Solo se permiten cuentas con email @alverlamp.es';
  end if;

  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

-- Asegura que el trigger existe y apunta a la función actualizada.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
