\set ON_ERROR_STOP on
INSERT INTO "User"(id,"wawuId",handle,"referralCode",status,"displayName","updatedAt","voiceCount","replyCount","reactionsReceived")
SELECT '00000000-0000-4000-8000-'||lpad(i::text,12,'0'),'wawu-'||i,'user'||i,'ref'||i,'ACTIVE','Person '||i,now(),(i%7),(i%5),(i%11) FROM generate_series(1,2000) i;
-- 200 questions: 141 started (some open, most over), 59 not started
INSERT INTO "Question"(id,text,status,kind,"startsAt","endsAt","updatedAt")
SELECT 'q'||lpad(i::text,4,'0'),'Question number '||i||' about money and work',
  CASE WHEN i<=141 THEN (CASE WHEN i<=3 THEN 'LIVE' WHEN i%2=0 THEN 'CLOSED' ELSE 'SCHEDULED' END)::"QuestionStatus" ELSE 'SCHEDULED' END,
  'DAILY',
  CASE WHEN i<=141 THEN now()-((i-1)||' days')::interval-interval '1 hour' ELSE now()+((i-141)||' days')::interval END,
  CASE WHEN i<=141 THEN (CASE WHEN i<=3 THEN now()+interval '20 days' ELSE now()-((i-1)||' days')::interval+interval '20 hours' END) ELSE now()+((i-141)||' days')::interval+interval '1 day' END,
  now()
FROM generate_series(1,200) i;
-- 50,000 answers on the started questions only
INSERT INTO "Answer"(id,"questionId","authorId",kind,body,status,anonymous,"rankScore","createdAt","updatedAt","reactionCount","replyCount")
SELECT 'a'||lpad(i::text,6,'0'),'q'||lpad(((i%141)+1)::text,4,'0'),'00000000-0000-4000-8000-'||lpad(((i*7)%2000+1)::text,12,'0'),'TEXT','answer body number '||i||' about rice and salary','PUBLISHED',(i%9=0),(i%100)/10.0,now()-((i%5000)||' minutes')::interval,now(),2,1
FROM generate_series(1,50000) i;
INSERT INTO "Reply"(id,"answerId","authorId",stance,kind,body,status,"createdAt","updatedAt")
SELECT 'r'||lpad(i::text,6,'0'),'a'||lpad(((i*3)%50000+1)::text,6,'0'),'00000000-0000-4000-8000-'||lpad(((i*11)%2000+1)::text,12,'0'),'AGREE','TEXT','reply '||i,'PUBLISHED',now()-((i%4000)||' minutes')::interval,now()
FROM generate_series(1,10000) i;
INSERT INTO "Reaction"(id,"answerId","userId",kind,"updatedAt")
SELECT 'x'||lpad(i::text,6,'0'),'a'||lpad(((i*2)%50000+1)::text,6,'0'),'00000000-0000-4000-8000-'||lpad(((i*13)%1999+1)::text,12,'0'),'POWERFUL',now()
FROM generate_series(1,20000) i ON CONFLICT DO NOTHING;
-- 5,000 notices for u00001 (3,000 unread), a mix of every kind that points at something
INSERT INTO "Notification"(id,"userId",type,title,body,"targetType","targetId","groupKey","actorCount","readAt","createdAt")
SELECT 'n'||lpad(i::text,5,'0'),'00000000-0000-4000-8000-000000000001',
  (ARRAY['REPLY','REACTIONS','POLL_CLOSED','UNITS_ADDED','DAILY_QUESTION'])[1+(i%5)]::"NotificationType",
  'notice '||i,'body '||i,
  CASE i%5 WHEN 0 THEN 'answer' WHEN 1 THEN 'answer' WHEN 2 THEN 'question' WHEN 3 THEN NULL ELSE 'question' END,
  CASE i%5 WHEN 0 THEN 'a'||lpad((i%50000+1)::text,6,'0') WHEN 1 THEN 'a'||lpad((i%50000+1)::text,6,'0') WHEN 2 THEN 'q'||lpad((i%141+1)::text,4,'0') WHEN 3 THEN NULL ELSE 'q'||lpad((i%141+1)::text,4,'0') END,
  CASE i%5 WHEN 0 THEN 'reply:r'||lpad((i%10000+1)::text,6,'0') WHEN 1 THEN 'reactions:a'||lpad((i%50000+1)::text,6,'0') ELSE NULL END,
  1, CASE WHEN i%5 IN (0,1,2) AND i%10 < 6 THEN NULL WHEN i%5 IN (3,4) AND i%10<6 THEN NULL ELSE now() END, now()-(i||' minutes')::interval
FROM generate_series(1,5000) i;
ANALYZE;
