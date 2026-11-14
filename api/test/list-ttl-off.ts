// C2.1-COST: many specs write a question's dates straight through Prisma, which no API write sees. So the suite runs with
// the list of unreadable questions never cached; the specs that test the cache set its life themselves
// (setUnreadableListTtl in feed/question-window.ts).
process.env.QUESTION_WINDOW_LIST_TTL_MS ??= "0";
