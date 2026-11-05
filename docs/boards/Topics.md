# Pick topics (Topics)

## 1. Boards
- Board files (2): project/entry/Topics-1440.dc.html, Topics-390.dc.html (folder A2)
- Pictures (1): shots/A2/Topics-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- Propose /join/topics (step 1 of 2).
## 3. Regions
- App bar: Back (to Verify), "1 of 2" (aria "Step 1 of 2").
- Heading, helper line, 14 topic chips, "Category alerts" with four toggle rows for chosen topics, note, Continue button (count in label).
- At 1440:
  - Centred with Logo header; "Step 1 of 2"; Continue not block.
## 4. Strings (verbatim)
- What do you want to talk about?
- Pick at least 3. We use them to fill your Home. Today's question shows for everyone.
- Money | Work | Power | Family | Love | Faith | Food prices | Roads | Politics | School | Health | Security | Entertainment | Sport
- Category alerts
- Get told when a new question lands in a topic you picked.
- Money | Work | Power | Family (toggle rows)
- Change or turn off alerts any time in Settings.
- Continue with 4 topics
- 1 of 2
- Step 1 of 2
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- 4 chips selected (Money, Work, Power, Family), four alert toggles. Below 3 chosen is not drawn.
## 6. Numbers, lists, actions -> contract
- Topic chips -> GET /categories -> Category.name, slug
- Chosen topics and alert toggles -> PUT /me/categories -> categories[].categoryId, alertsOn
- Minimum 3 -> GAP: contract states no minimum for setCategories; enforced in the client unless the API adds it
- Button count "4 topics" -> client count
## 7. Where each tap goes
- Back -> Verify; Continue -> ProfileSetup.
