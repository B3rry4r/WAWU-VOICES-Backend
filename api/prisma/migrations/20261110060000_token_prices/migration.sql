-- LCH-10 / LCH-12 (V-36, V-37, V-38): tokens, new prices, the daily message limit, the AI text fix price.
-- Data only, no table or column changes. A ConfigEntry row an admin has edited is never touched: each value moves only
-- while it still equals the old seeded default. Old packs are switched off, never deleted (payments point at them).
UPDATE "ConfigEntry" SET "valueJson" = '100'::jsonb, "placeholder" = false, "updatedAt" = now() WHERE "key" = 'units.base_rate_kobo' AND "valueJson" = '1380'::jsonb;
UPDATE "ConfigEntry" SET "valueJson" = '18300'::jsonb, "updatedAt" = now() WHERE "key" = 'units.min_purchase_kobo' AND "valueJson" = '13800'::jsonb;
UPDATE "ConfigEntry" SET "valueJson" = '5000'::jsonb, "placeholder" = false, "updatedAt" = now() WHERE "key" = 'cost.text_post_milli' AND "valueJson" = '500'::jsonb;
UPDATE "ConfigEntry" SET "valueJson" = '78000'::jsonb, "placeholder" = false, "updatedAt" = now() WHERE "key" = 'cost.voice_post_milli' AND "valueJson" = '1000'::jsonb;
UPDATE "ConfigEntry" SET "valueJson" = '7800'::jsonb, "updatedAt" = now() WHERE "key" = 'voice.extra30.price_kobo' AND "valueJson" = '15000'::jsonb;
UPDATE "ConfigEntry" SET "valueJson" = '10000'::jsonb, "updatedAt" = now() WHERE "key" = 'voice.extra60.price_kobo' AND "valueJson" = '20000'::jsonb;
UPDATE "ConfigEntry" SET "valueJson" = '5000'::jsonb, "updatedAt" = now() WHERE "key" = 'text.max_chars' AND "valueJson" = '500'::jsonb;

-- The seven packs (PRICING.md). An old pack row an admin kept is only switched off.
UPDATE "UnitTier" SET "active" = false, "updatedAt" = now() WHERE "slug" IN ('spark','chat','buzz','loud','mega','boss');
INSERT INTO "UnitTier" ("id","slug","name","priceKobo","unitsMilli","bonusMilli","sortOrder","active","updatedAt") VALUES
  (gen_random_uuid()::text,'entry','Entry',18300,183000,0,1,true,now()),
  (gen_random_uuid()::text,'starter','Starter',36600,366000,0,2,true,now()),
  (gen_random_uuid()::text,'standard','Standard',73200,732000,0,3,true,now()),
  (gen_random_uuid()::text,'plus','Plus',146400,1464000,0,4,true,now()),
  (gen_random_uuid()::text,'pro','Pro',366000,3660000,0,5,true,now()),
  (gen_random_uuid()::text,'premium','Premium',732000,7320000,0,6,true,now()),
  (gen_random_uuid()::text,'ultimate','Ultimate',1464000,14640000,0,7,true,now())
ON CONFLICT ("slug") DO NOTHING;

-- The stored pack list (config units.tiers) follows, but only while it is still the seeded one.
UPDATE "ConfigEntry" SET "valueJson" = '[
 {"slug":"entry","name":"Entry","priceKobo":18300,"unitsMilli":183000,"bonusMilli":0},
 {"slug":"starter","name":"Starter","priceKobo":36600,"unitsMilli":366000,"bonusMilli":0},
 {"slug":"standard","name":"Standard","priceKobo":73200,"unitsMilli":732000,"bonusMilli":0},
 {"slug":"plus","name":"Plus","priceKobo":146400,"unitsMilli":1464000,"bonusMilli":0},
 {"slug":"pro","name":"Pro","priceKobo":366000,"unitsMilli":3660000,"bonusMilli":0},
 {"slug":"premium","name":"Premium","priceKobo":732000,"unitsMilli":7320000,"bonusMilli":0},
 {"slug":"ultimate","name":"Ultimate","priceKobo":1464000,"unitsMilli":14640000,"bonusMilli":0}
]'::jsonb, "placeholder" = false, "updatedAt" = now()
WHERE "key" = 'units.tiers' AND "valueJson" -> 0 ->> 'slug' = 'spark' AND jsonb_array_length("valueJson") = 6;
