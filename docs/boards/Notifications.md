# Notifications (Notifications)

## 1. Boards
- Board files (2): project/entry/Notifications-1440.dc.html, Notifications-390.dc.html (folder A2)
- Pictures (1): shots/A2/Notifications-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /notifications.
## 3. Regions
- App bar: Back to Home, title "Notifications", Settings gear.
- Tabs: All, Replies, Reactions, Polls.
- Group "Today" with "Mark all as read"; four rows; group "Earlier" with three rows; BottomNav (Home active).
- At 1440:
  - Left SideNav (units 12.5, free-left count), top bar with SearchField, Country button "Nigeria", Messages link, bell; Settings button; Right rail aside "This week": TopicOfWeek (rail) and TrendingList; hint "Click to see why." replaces "Tap".
## 4. Strings (verbatim)
- Notifications
- All | Replies | Reactions | Polls
- Today
- Mark all as read
- Today's question is live.
- When salary arrives, how many hours pass before it disappears? (8:00)
- @kemi.b replied to your voice: "Two hours is generous. Mine is gone before I reach the bus stop." (12 min)
- @tunde.a and 41 others reacted to your voice (1 h, 💯)
- Poll closed. Should the minimum wage rise automatically with inflation? See how 4,900 voters answered. (3 h)
- Earlier
- An editor changed the tag on your post to Gossip. Tap to see why. (Yesterday)
- 55 Voice Units added to your wallet. Your receipt is in Wallet. (Mon)
- @ifeoma.n replied to your voice: "Same here. I keep a separate account for rent." (Sun)
- Back to Home, Notification settings (aria)
- Home | Discover | Speak | Profile
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Populated with read and unread rows (unread marked). Empty and loading not drawn.
## 6. Numbers, lists, actions -> contract
- Rows and group Today/Earlier -> GET /notifications -> Notification (type, title, body, actorCount, read, createdAt); grouping by createdAt in the client
- Tabs Replies, Reactions, Polls -> GAP: listNotifications has no type filter (only unreadOnly); filter in client or add param
- Mark all as read -> POST /notifications/read -> MarkReadRequest.ids
- Row targets -> Notification.targetType, targetId
- Types shown -> NotificationType DAILY_QUESTION, REPLY, REACTIONS, POLL_CLOSED, TAG_CHANGED, UNITS_ADDED
## 7. Where each tap goes
- Back -> Home; gear -> Settings; each row -> its target (question, thread, poll, post, wallet); Mark all as read -> stays.
