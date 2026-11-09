// LCH-09 seed: the launch question and realistic data in the lchd_* database, straight SQL so thousands of rows take seconds.
//   DATABASE_URL=... node scripts/load/seed.mjs        (SEED_USERS, SEED_LAUNCH_ANSWERS, SEED_OTHER_QUESTIONS to change the size)
// Safe to run twice: it empties the tables it fills first and refuses to run unless the database name starts with lchd_.
import { createRequire } from "node:module";
import { join } from "node:path";

const apiDir = process.env.API_DIR ?? join(process.cwd(), "api");
const { Client } = createRequire(join(apiDir, "package.json"))("pg");
const url = process.env.DATABASE_URL;
if (!url || !/\/lchd_[a-z0-9_]+(\?|$)/.test(url)) { console.error("Refusing to seed: DATABASE_URL must name a database that starts with lchd_."); process.exit(2); }

const USERS = Number(process.env.SEED_USERS ?? 30000);
const LAUNCH_ANSWERS = Math.min(Number(process.env.SEED_LAUNCH_ANSWERS ?? 25000), USERS);
const OTHER_Q = Number(process.env.SEED_OTHER_QUESTIONS ?? 12);
const OTHER_ANSWERS = Number(process.env.SEED_OTHER_ANSWERS ?? 800);
const LIKES = Number(process.env.SEED_LIKES ?? 60000);
const VOTES = Math.min(Number(process.env.SEED_VOTES ?? 15000), USERS);
const INVITES = Math.min(Number(process.env.SEED_INVITES ?? 3000), USERS);

const lagosToday = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const c = new Client({ connectionString: url });
await c.connect();
const q = async (text, params) => { const t = Date.now(); const r = await c.query(text, params); return { r, ms: Date.now() - t }; };
const step = async (name, text, params) => { const { r, ms } = await q(text, params); console.log(`${name}: ${r.rowCount ?? 0} rows, ${ms} ms`); };

await q(`TRUNCATE "User", "Category", "Topic", "Question", "ConfigEntry" RESTART IDENTITY CASCADE`);

await step("categories", `INSERT INTO "Category"(id, slug, name, "sortOrder", active)
  SELECT gen_random_uuid(), 'cat-'||i, (ARRAY['Money','Work','Health','Love','Politics','Food'])[i], i, true FROM generate_series(1,6) i`);

await step("topic", `INSERT INTO "Topic"(id, "weekNumber", title, "startsOn", "endsOn", status, "questionCount", "updatedAt")
  VALUES (gen_random_uuid(), 1, 'How Nigeria feels', $1::date - 3, $1::date + 3, 'LIVE', 13, now())`, [lagosToday]);

// The launch question: a mood question, open now for a month (the ramp must not fall off midnight).
await step("launch question", `INSERT INTO "Question"(id, "topicId", "categoryId", kind, status, text, hint, "scheduledFor", "startsAt", "endsAt", "moodOptions", "seedKey", "updatedAt")
  SELECT gen_random_uuid(), (SELECT id FROM "Topic" LIMIT 1), (SELECT id FROM "Category" WHERE slug='cat-5'), 'DAILY', 'LIVE',
    'How do you feel about Nigeria right now?', 'With everything going on, say it in your voice. 10 seconds.', $1::date,
    now() - interval '6 hours', now() + interval '30 days', ARRAY['ANGRY','TIRED','PROUD','HOPEFUL']::"Mood"[], 'launch-mood-1', now()`, [lagosToday]);

await step("other questions", `INSERT INTO "Question"(id, "topicId", "categoryId", kind, status, text, "scheduledFor", "startsAt", "endsAt", "updatedAt")
  SELECT gen_random_uuid(), (SELECT id FROM "Topic" LIMIT 1), (SELECT id FROM "Category" ORDER BY random() LIMIT 1), 'DAILY', 'CLOSED',
    'Older question number '||i||': what changed for you this month?', $1::date - i, now() - interval '1 day' * i, now() - interval '1 day' * (i-1), now()
  FROM generate_series(1,$2) i`, [lagosToday, OTHER_Q]);

await step("users", `INSERT INTO "User"(id, "wawuId", "phoneHash", handle, "displayName", "countryCode", state, "referralCode", "ageConfirmedAt", "termsAcceptedAt", "rulesAcceptedAt", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), 'seed-'||i, md5('seed-phone-'||i), 'seed'||i, 'Seed Person '||i,
    CASE WHEN i % 10 < 9 THEN 'NG' WHEN i % 10 = 9 AND i % 3 = 0 THEN 'GH' WHEN i % 3 = 1 THEN 'GB' ELSE 'US' END,
    (ARRAY['Lagos','Abuja','Kano','Rivers','Oyo','Enugu','Kaduna','Delta'])[1 + i % 8], 'ref'||i, now(), now(), now(), now() - interval '20 days' * random(), now()
  FROM generate_series(1,$1) i`, [USERS]);

await step("invites", `INSERT INTO "Invite"(id, "userId", code)
  SELECT gen_random_uuid(), id, substr(md5(id),1,7) FROM "User" ORDER BY "createdAt" LIMIT $1`, [INVITES]);

// Voice clips for 55% of the launch answers and a third of the others: ready, 4 to 10 seconds, with a waveform.
await step("voice clips", `INSERT INTO "VoiceClip"(id, "ownerId", purpose, status, "rawKey", "rawMime", "playKey", "playMime", "durationMs", "maxDurationMs", peaks, "readyAt", "createdAt")
  SELECT gen_random_uuid(), u.id, 'ANSWER', 'READY', 'raw/seed-'||u.n, 'audio/webm', 'voice/seed-'||u.n||'.m4a', 'audio/mp4', 4000 + (u.n % 6000), 10000,
    (SELECT jsonb_agg((x*7 + u.n) % 255) FROM generate_series(1,40) x), now(), now()
  FROM (SELECT id, row_number() OVER (ORDER BY "createdAt") n FROM "User") u WHERE u.n <= $1 AND u.n % 100 < 55`, [LAUNCH_ANSWERS]);

await step("launch answers", `INSERT INTO "Answer"(id, "questionId", "authorId", kind, body, "clipId", mood, "likeCount", "listenCount", "rankScore", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), (SELECT id FROM "Question" WHERE "seedKey"='launch-mood-1'), u.id,
    CASE WHEN c.id IS NULL THEN 'TEXT' ELSE 'VOICE' END::"PostKind",
    CASE WHEN c.id IS NULL THEN (ARRAY['Fuel and food prices have me tired every single day.','I still believe this country will rise, we just need patience.','Proud of how our young people keep building.','Angry about light, angry about roads, but I still stay.','Honestly hopeful, small small things are changing.'])[1 + u.n % 5] END,
    c.id,
    (ARRAY['ANGRY','TIRED','TIRED','PROUD','HOPEFUL','HOPEFUL','PROUD','TIRED'])[1 + u.n % 8]::"Mood",
    (random()*20)::int, (random()*60)::int, random(), now() - interval '20 hours' * random(), now()
  FROM (SELECT id, row_number() OVER (ORDER BY "createdAt") n FROM "User") u
  LEFT JOIN "VoiceClip" c ON c."rawKey" = 'raw/seed-'||u.n
  WHERE u.n <= $1`, [LAUNCH_ANSWERS]);

await step("other answers", `INSERT INTO "Answer"(id, "questionId", "authorId", kind, body, "likeCount", "rankScore", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), qq.id, (SELECT id FROM "User" OFFSET floor(random()*$2)::int LIMIT 1), 'TEXT',
    'My answer '||s||' to '||left(qq.text, 20)||': prices, wahala, and small joys.', (random()*10)::int, random(), now() - interval '5 days' * random(), now()
  FROM (SELECT id, text FROM "Question" WHERE "seedKey" IS NULL) qq CROSS JOIN generate_series(1,$1) s`, [OTHER_ANSWERS, USERS]);

await step("likes", `INSERT INTO "Like"(id, "answerId", "userId")
  SELECT gen_random_uuid(), a.id, u.id FROM (SELECT id FROM "Answer" CROSS JOIN generate_series(1,3) ORDER BY random() LIMIT $1) a
  JOIN LATERAL (SELECT id FROM "User" OFFSET floor(random()*$2)::int LIMIT 1) u ON true
  ON CONFLICT DO NOTHING`, [LIKES, USERS]);
await step("like counts", `UPDATE "Answer" a SET "likeCount" = l.n FROM (SELECT "answerId", count(*)::int n FROM "Like" GROUP BY 1) l WHERE l."answerId" = a.id`);

await step("poll", `WITH p AS (
  INSERT INTO "Poll"(id, "questionId", kind, title, status, "startsAt", "endsAt", "updatedAt")
  SELECT gen_random_uuid(), id, 'QUESTION', 'Will things get better this year?', 'OPEN', now() - interval '6 hours', now() + interval '30 days', now()
  FROM "Question" WHERE "seedKey"='launch-mood-1' RETURNING id)
  INSERT INTO "PollOption"(id, "pollId", label, "sortOrder") SELECT gen_random_uuid(), p.id, l, o FROM p, unnest(ARRAY['Yes','No','Not sure']) WITH ORDINALITY t(l,o)`);
await step("votes", `INSERT INTO "Vote"(id, "pollId", "userId", "phoneHash", "idempotencyKey")
  SELECT gen_random_uuid(), (SELECT id FROM "Poll" LIMIT 1), u.id, u."phoneHash", 'seed-'||u.n
  FROM (SELECT id, "phoneHash", row_number() OVER (ORDER BY "createdAt") n FROM "User") u WHERE u.n <= $1`, [VOTES]);
await step("vote choices", `INSERT INTO "VoteChoice"("voteId", "optionId")
  SELECT v.id, (SELECT id FROM "PollOption" ORDER BY "sortOrder" OFFSET (abs(hashtext(v.id)) % 3) LIMIT 1) FROM "Vote" v`);
await step("vote counts", `UPDATE "PollOption" o SET "voteCount" = x.n FROM (SELECT "optionId", count(*)::int n FROM "VoteChoice" GROUP BY 1) x WHERE x."optionId" = o.id`);
await step("poll total", `UPDATE "Poll" SET "totalVotes" = (SELECT count(*) FROM "Vote")`);

await step("question counters", `UPDATE "Question" qq SET "answerCount" = a.n, "voiceCount" = a.v
  FROM (SELECT "questionId", count(*)::int n, count("clipId")::int v FROM "Answer" GROUP BY 1) a WHERE a."questionId" = qq.id`);
await q(`ANALYZE`);
const n = (await q(`SELECT (SELECT count(*) FROM "User") users, (SELECT count(*) FROM "Answer") answers, (SELECT count(*) FROM "VoiceClip") clips, (SELECT count(*) FROM "Like") likes, (SELECT count(*) FROM "Vote") votes`)).r.rows[0];
console.log("seeded:", JSON.stringify(n));
await c.end();
