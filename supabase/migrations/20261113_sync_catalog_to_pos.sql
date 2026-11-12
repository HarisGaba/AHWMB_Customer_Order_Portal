-- Sync the Customer Order Portal catalog into the POS items list.
-- ONLY ADDS: items that already exist in the POS (same name) are left exactly as they are
-- (rate, Urdu name, weight untouched). Nothing is deleted or changed.
-- New items start at rate 0: set their price in POS -> Rate Changing.
begin;

-- 1) Built-in catalog items of the order portal
insert into public.items (name, rate)
select v.name, 0 from (values
  ('Basmati Rice 1121 Special'),
  ('Basmati Rice 1121 Steam'),
  ('Basmati Rice Ponia'),
  ('Basmati Rice Toota'),
  ('Sella Rice 1121 Double Steam'),
  ('Sella Rice 1121 Steam'),
  ('Laal Chawal'),
  ('Arhar Dal'),
  ('Chana Dal'),
  ('Mong Dal'),
  ('Masoor Dal'),
  ('Mash Dal'),
  ('Masoor sabut'),
  ('Kala Chana'),
  ('Safaid Chana (Small)'),
  ('Safaid Chana (Medium)'),
  ('Safaid Chana (Large)'),
  ('Hari mash'),
  ('Mong Sabut'),
  ('Mong Chilka'),
  ('Mash Sabut'),
  ('Mash Chilki'),
  ('Safaid Lobia'),
  ('Laal Lobia'),
  ('Laal Chori'),
  ('Bajra'),
  ('Kali Mirch Sabut'),
  ('Kali Mirch Powder'),
  ('Laal Mirch Sabut'),
  ('Laal Mirch Powder'),
  ('Katar Mirch'),
  ('Talhar Mirch Sabut'),
  ('Dhaniya Sabut'),
  ('Dhaniya Powder'),
  ('Green Elaichi'),
  ('Black Elaichi'),
  ('Long'),
  ('Daar Cheeni'),
  ('Badiyan ka phool'),
  ('Haldi'),
  ('Chat Masala'),
  ('Aloo Bukhara'),
  ('Biryani Masala'),
  ('Qorma Masala'),
  ('Karhai Masala'),
  ('Nihari Masala'),
  ('Pilao Masala'),
  ('Dal Masala'),
  ('Chicken Tikka Masala'),
  ('Salan Masala'),
  ('Safaid Zeera'),
  ('Kala Zeera'),
  ('Choti Elaichi'),
  ('Bari Elaichi'),
  ('Gandum Sabut'),
  ('Gandum Dalia'),
  ('Jao Sabut'),
  ('Jao Dalia'),
  ('Jao oats'),
  ('Gandum oats'),
  ('Suji'),
  ('Maida'),
  ('Besan'),
  ('Badaam'),
  ('Kaju (salted)'),
  ('Kaju (unsalted)'),
  ('Pista (salted)'),
  ('Pista (unsalted)'),
  ('Akhrot (sabut)'),
  ('Akhrot (giri)'),
  ('Kishmish'),
  ('Chilghoza'),
  ('Phool Makhana'),
  ('Chia seeds'),
  ('Flax seeds'),
  ('Pumpkin seeds'),
  ('Sunflower seeds'),
  ('Sesame seeds'),
  ('Sugar'),
  ('Fried Onion'),
  ('American Popcorn'),
  ('Sabudana'),
  ('Meethi Soda'),
  ('Isphagol Indian'),
  ('Macaroni'),
  ('Chakki Atta'),
  ('Oil'),
  ('Honey')
) as v(name)
where not exists (select 1 from public.items i where lower(i.name) = lower(v.name));

-- 2) Products added in the portal ("Add Products")
insert into public.items (name, rate)
select p.name, 0 from public.products p
where not exists (select 1 from public.items i where lower(i.name) = lower(p.name));

-- 3) From now on, every product added in the portal appears in the POS automatically
create or replace function public.sync_product_to_pos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.items (name, rate)
  select new.name, 0
  where not exists (select 1 from public.items i where lower(i.name) = lower(new.name));
  return new;
end;
$$;
drop trigger if exists products_sync_to_pos on public.products;
create trigger products_sync_to_pos after insert on public.products
  for each row execute function public.sync_product_to_pos();

commit;
