VERDICT: FIX

# Verify V-FIX-C round 4, server side (first version, written when the first verdict-changing finding was proved; the full report replaces this file)

Code under test: `origin/v/fix-c` at 8667584 merged into `verify/v-fix-c` (clean merge). All runs below call `scrub` from `api/src/reach/scrub.ts` directly.

## M1 (MEDIUM, round 3's M2 is NOT closed): a platform word plus the last word before a full stop is deleted

`api/src/reach/scrub.ts:59-62` (`HANDLE_TOKEN`). The lookahead `(?=[\w.]{0,29}[\d_.])` accepts the sentence's own closing full stop as the "." that marks a handle, and the token `[\w.]{3,30}` then swallows it. The ruling says "ordinary sentences with those words stay whole".

Run (exact input -> output): `I use whatsapp daily.` -> `I use`; `Twitter is dead.` -> empty; `Instagram is slow.` -> empty; `It was just a snap judgement.` -> `It was just a`; `Let the police handle that.` -> `Let the police`; `The council did not handle complaints.` -> `The council did not`; `Mark the x here.` -> `Mark the`; `That is the x factor.` -> `That is the`; `They shared it on instagram widely.` -> `They shared it on`; `Dem talk am for wa group.` -> `Dem talk am for`; `Rumours spread on telegram fast.` -> `Rumours spread on`.
In a set of 31 ordinary sentences that end in "<platform word> <word>." 17 were damaged; every one loses the end of the sentence. Without the final full stop (what the builder's tests used) the same sentences stay whole.
Should: the token must not count a final "." (a dot only between word characters).

## M2 (MEDIUM): number ranges and lists of prices or years are deleted as phones

`scrub.ts:69-72` (`PHONE_DIGITS`) and `:95-99`. Any run of 10 or more digits with `, - .` between groups goes, unless the whole run is one thousands-grouped number. Run: `Between 100,000-150,000 naira.` -> `Between naira.`; `100,000 - 150,000 naira per year.` -> `naira per year.`; `I earn 100,000 - 150,000.` -> `I earn .`; `Between 2015, 2016, 2017 and 2018 nothing changed.` -> `Between and 2018 nothing changed.`; `In 1999, 2003, 2007, 2011, 2015, 2019 and 2023 we voted.` -> `In and 2023 we voted.`; `Payments of 10,000, 20,000, 30,000 and 40,000 were delayed.` -> `Payments of and 40,000 were delayed.` Each loses the figures, so the meaning.

The rest (full tables, other findings, runs 3 to 9) follows in the full report.
