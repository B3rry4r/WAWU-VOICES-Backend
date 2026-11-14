# Round 2 sweep: every GET route, result per moment (merged head)

Template | content-bearing when open | 14 Nov 05:00 | 22:59:59.999 | 23:00:00.000 | 17 Nov 00:00. Cells: status x viewers (7 viewers; LEAK lists viewers who got the seeded content or the hidden question id back). Before 17 Nov the only LEAK cells are the owners of their own clips and moderator/admin on the moderation and admin topic routes.

```
route | content-bearing when open | T1 05:00 | T2 22:59:59.999 | T3 23:00:00.000 | T4 17 Nov 00:00
/me | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/me/handle-check | no | 401x1/422x6 | 401x1/422x6 | 401x1/422x6 | 401x1/422x6
/me/allowance | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/me/settings | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/me/invite | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/me/friends | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/invites/{code} | no | 200x21 | 200x21 | 200x21 | 200x21
/me/categories | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/me/answers | yes | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 LEAK:anonAuthor,author
/me/answers?limit=50 | yes | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 LEAK:anonAuthor,author
/me/saved | yes | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 LEAK:author,follower,other
/me/saved?kind=answers | no | 401x1/422x6 | 401x1/422x6 | 401x1/422x6 | 401x1/422x6
/me/saved?kind=questions | no | 401x1/422x6 | 401x1/422x6 | 401x1/422x6 | 401x1/422x6
/me/saved?type=answers | yes | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 LEAK:author,follower,other
/me/saved?type=questions | yes | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 LEAK:author,follower,other
/me/blocks | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/people/{userId}/replies | yes | 200x35 | 200x35 | 200x35 | 200x35 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/people/by-handle/{handle} | yes | 200x21 | 200x21 | 200x21 | 200x21 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/people/{userId} | yes | 200x35 | 200x35 | 200x35 | 200x35 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/people/{userId}?limit=50 | yes | 200x35 | 200x35 | 200x35 | 200x35 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/me/export | no | 401x1/404x6 | 401x1/404x6 | 401x1/404x6 | 401x1/404x6
/me/verification | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/admin/verification | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/verification/{requestId} | no | 401x1/403x5/404x1 | 401x1/403x5/404x1 | 401x1/403x5/404x1 | 401x1/403x5/404x1
/admin/verification/{requestId}/documents/{kind} | no | 401x1/403x5/404x1 | 401x1/403x5/404x1 | 401x1/403x5/404x1 | 401x1/403x5/404x1
/topics/current | no | 200x7 | 200x7 | 200x7 | 200x7
/topics/{topicId} | no | 200x14 | 200x14 | 200x14 | 200x14
/calendar | no | 200x7 | 200x7 | 200x7 | 200x7
/calendar?status=SCHEDULED | no | 200x7 | 200x7 | 200x7 | 200x7
/calendar?status=LIVE | no | 200x7 | 200x7 | 200x7 | 200x7
/config/public | no | 200x7 | 200x7 | 200x7 | 200x7
/countries | no | 200x7 | 200x7 | 200x7 | 200x7
/categories | no | 200x7 | 200x7 | 200x7 | 200x7
/categories/{slug} | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/categories/{slug}?tab=open | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/categories/{slug}?tab=closed | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/categories/{slug}?tab=polls | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/home | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/today | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId} | yes | 200x7/404x21 | 200x7/404x21 | 200x7/404x21 | 200x21/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions?limit=100 | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions?status=LIVE | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/trending | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/trending?sort=top&limit=50 | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/trending?sort=new&limit=50 | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/trending?tag=VERIFIED_NEWS | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/trending?tag=GOSSIP | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/trending?mood=PROUD | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/trending?limit=50 | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/trending-questions | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/new | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/new?limit=50 | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/feed/new?tag=GOSSIP | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId}/answers | yes | 200x7/404x21 | 200x7/404x21 | 200x7/404x21 | 200x21/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId}/answers?sort=TOP | yes | 200x7/404x21 | 200x7/404x21 | 200x7/404x21 | 200x21/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId}/answers?sort=NEW | yes | 200x7/404x21 | 200x7/404x21 | 200x7/404x21 | 200x21/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId}/answers?sort=DEBATED | yes | 200x7/404x21 | 200x7/404x21 | 200x7/404x21 | 200x21/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId}/answers?tag=GOSSIP | yes | 200x7/404x21 | 200x7/404x21 | 200x7/404x21 | 200x21/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId}/answers?mood=PROUD | yes | 200x7/404x21 | 200x7/404x21 | 200x7/404x21 | 200x21/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId}/polls | no | 200x7/404x21 | 200x7/404x21 | 200x7/404x21 | 200x21/404x7
/voice-clips/{clipId} | yes | 200x4/404x31 LEAK:author,follower,other | 200x4/404x31 LEAK:author,follower,other | 200x4/404x31 LEAK:author,follower,other | 200x35 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/voice-clips/{clipId}/play | yes | 200x4/404x31 LEAK:author,follower,other | 200x4/404x31 LEAK:author,follower,other | 200x4/404x31 LEAK:author,follower,other | 200x35 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId}/moods | no | 404x28 | 404x28 | 200x7/404x21 | 200x7/404x21
/answers/{answerId}/where-you-sit | yes | 401x8/404x48 | 401x8/404x48 | 401x8/404x48 | 200x5/401x8/404x43 LEAK:anonAuthor,author
/answers/{answerId} | yes | 404x56 | 404x56 | 404x56 | 200x49/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/answers/{answerId}/videos | yes | 401x8/404x48 | 401x8/404x48 | 401x8/404x48 | 200x7/401x8/404x41 LEAK:author
/voice-videos/{videoId}/file | no | 401x1/404x6 | 401x1/404x6 | 401x1/404x6 | 401x1/404x6
/answers/{answerId}/replies | yes | 404x56 | 404x56 | 404x56 | 200x49/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/reactions | no | 200x7 | 200x7 | 200x7 | 200x7
/polls/current | no | 200x7 | 200x7 | 200x7 | 200x7
/polls/flash | no | 200x7 | 200x7 | 200x7 | 200x7
/polls/{pollId} | no | 200x7 | 200x7 | 200x7 | 200x7
/polls/{pollId}/results | no | 200x7 | 200x7 | 200x7 | 200x7
/questions/{questionId}/what-next | yes | 404x28 | 404x28 | 200x7/404x21 | 200x21/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/questions/{questionId}/proposals/similar | no | 404x28 | 404x28 | 404x21/422x7 | 404x7/422x21
/questions/{questionId}/proposals/similar?text=zebra | no | 404x28 | 404x28 | 200x7/404x21 | 200x21/404x7
/questions/{questionId}/proposals | yes | 404x28 | 404x28 | 200x7/404x21 | 200x21/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/result-threads | no | 200x7 | 200x7 | 200x7 | 200x7
/result-threads/{threadId} | no | 404x7 | 404x7 | 404x7 | 404x7
/result-threads/{threadId}/posts | no | 404x7 | 404x7 | 404x7 | 404x7
/news | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/news?tag=VERIFIED_NEWS | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/news?tag=GOSSIP | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/news/tags | no | 200x7 | 200x7 | 200x7 | 200x7
/news/{answerId} | yes | 404x56 | 404x56 | 404x56 | 200x14/404x42 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/weekly-reports | no | 200x7 | 200x7 | 200x7 | 200x7
/weekly-reports/latest | no | 200x7 | 200x7 | 200x7 | 200x7
/weekly-reports/{reportId} | no | 404x7 | 404x7 | 404x7 | 404x7
/search | no | 422x7 | 422x7 | 422x7 | 422x7
/search?q=zebra&type=answers | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/search?q=zebra&type=questions | no | 200x7 | 200x7 | 200x7 | 200x7
/search?q=zebra&type=people | no | 200x7 | 200x7 | 200x7 | 200x7
/search?q=zebra&type=topics | no | 200x7 | 200x7 | 200x7 | 200x7
/search?q=zebra | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/search?q=transcript&type=answers | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/search?q=quokka | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/search?q=author&type=people | no | 200x7 | 200x7 | 200x7 | 200x7
/search?q=pelican | yes | 200x7 | 200x7 | 200x7 | 200x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/notifications | yes | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 LEAK:anonAuthor,author,follower,other
/notifications?limit=50 | yes | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 LEAK:anonAuthor,author,follower,other
/notifications?unreadOnly=true | yes | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 LEAK:anonAuthor,author,follower,other
/notifications?type=REPLY | no | 401x1/422x6 | 401x1/422x6 | 401x1/422x6 | 401x1/422x6
/notifications?type=DAILY_QUESTION | no | 401x1/422x6 | 401x1/422x6 | 401x1/422x6 | 401x1/422x6
/notifications/unread-count | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/share/{code} | yes | 404x21 | 404x21 | 404x21 | 200x14/404x7 LEAK:admin,anonAuthor,author,follower,guest,mod,other
/share/{code}/card | no | 200x7/404x14 | 200x7/404x14 | 200x7/404x14 | 200x14/404x7
/share/{code}/card?size=story | no | 200x7/404x14 | 200x7/404x14 | 200x7/404x14 | 200x14/404x7
/share/{code}/card?size=square | no | 200x7/404x14 | 200x7/404x14 | 200x7/404x14 | 200x14/404x7
/share/{code}/card?size=card | no | 200x7/404x14 | 200x7/404x14 | 200x7/404x14 | 200x14/404x7
/share/{code}/story | no | 404x21 | 404x21 | 404x21 | 200x14/404x7
/share/{code}/square | no | 404x21 | 404x21 | 404x21 | 404x21
/units/tiers | no | 200x7 | 200x7 | 200x7 | 200x7
/subscription-plans | no | 200x7 | 200x7 | 200x7 | 200x7
/subscriptions/me | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/wallet | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/wallet/history/export | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/wallet/history | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/payments/{paymentId} | no | 401x1/404x6 | 401x1/404x6 | 401x1/404x6 | 401x1/404x6
/payments/{paymentId}/receipt | no | 401x1/404x6 | 401x1/404x6 | 401x1/404x6 | 401x1/404x6
/extra-voice-tokens | no | 200x6/401x1 | 200x6/401x1 | 200x6/401x1 | 200x6/401x1
/ads/placement | no | 200x7 | 200x7 | 200x7 | 200x7
/health | no | 404x7 | 404x7 | 404x7 | 404x7
/admin/roles | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/users | no | 401x1/403x5/422x1 | 401x1/403x5/422x1 | 401x1/403x5/422x1 | 401x1/403x5/422x1
/admin/today | yes | 200x2/401x1/403x4 | 200x2/401x1/403x4 | 200x2/401x1/403x4 | 200x2/401x1/403x4 LEAK:admin,mod
/admin/topics | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/topics/{topicId} | yes | 200x2/401x2/403x10 LEAK:admin | 200x2/401x2/403x10 LEAK:admin | 200x2/401x2/403x10 LEAK:admin | 200x2/401x2/403x10 LEAK:admin
/admin/questions | no | 401x1/403x5/422x1 | 401x1/403x5/422x1 | 401x1/403x5/422x1 | 401x1/403x5/422x1
/admin/overrides | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/moderation/items | yes | 200x2/401x1/403x4 LEAK:admin,mod | 200x2/401x1/403x4 LEAK:admin,mod | 200x2/401x1/403x4 LEAK:admin,mod | 200x2/401x1/403x4 LEAK:admin,mod
/admin/moderation/items/{itemId} | yes | 200x2/401x1/403x4 LEAK:admin,mod | 200x2/401x1/403x4 LEAK:admin,mod | 200x2/401x1/403x4 LEAK:admin,mod | 200x2/401x1/403x4 LEAK:admin,mod
/admin/news/items | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/results/threads | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/results/posts | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/weekly-reports | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/weekly-reports/{reportId} | no | 401x1/403x5/404x1 | 401x1/403x5/404x1 | 401x1/403x5/404x1 | 401x1/403x5/404x1
/admin/weekly-reports/{reportId}/instagram | no | 401x1/403x5/404x1 | 401x1/403x5/404x1 | 401x1/403x5/404x1 | 401x1/403x5/404x1
/admin/weekly-reports/{reportId}/instagram/{file} | no | 401x1/403x5/404x1 | 401x1/403x5/404x1 | 401x1/403x5/404x1 | 401x1/403x5/404x1
/admin/ads | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/config | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/config/changes | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/wallets/{userId} | no | 200x5/401x5/403x25 | 200x5/401x5/403x25 | 200x5/401x5/403x25 | 200x5/401x5/403x25
/admin/payments | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/money/overview | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/subscriptions | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
/admin/audit | no | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5 | 200x1/401x1/403x5
147 templates
```
