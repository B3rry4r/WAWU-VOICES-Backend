/** V-25: exactly these 15 categories, named as the Topics chips; slugs come from the names. Every week of the question bank maps to one of them in docs/seed/week-categories.json. */
export const CATEGORIES = [
  {
    slug: "money",
    name: "Money",
    blurb: "Salary, prices, banks, the naira and the hustle in between.",
  },
  {
    slug: "work",
    name: "Work",
    blurb: "Jobs, bosses, pay day and the wait for both.",
  },
  {
    slug: "power",
    name: "Power",
    blurb: "Light, generators, prepaid meters and the bills that follow.",
  },
  {
    slug: "family",
    name: "Family",
    blurb: "Parents, children, in-laws and the black tax.",
  },
  {
    slug: "love",
    name: "Love",
    blurb: "Dating, marriage, heartbreak and everyone’s opinion about it.",
  },
  {
    slug: "faith",
    name: "Faith",
    blurb: "Church, mosque, tithes, belief and doubt.",
  },
  {
    slug: "food-prices",
    name: "Food prices",
    blurb: "Rice, garri, farmers and what a market trip costs now.",
  },
  {
    slug: "roads",
    name: "Roads",
    blurb: "Fares, fuel, traffic, flights and the journey home.",
  },
  {
    slug: "politics",
    name: "Politics",
    blurb: "Government, parties, corruption and who speaks for us.",
  },
  {
    slug: "elections",
    name: "Elections",
    blurb: "Votes, candidates, leaders and what they promise.",
  },
  {
    slug: "school",
    name: "School",
    blurb: "Fees, exams, strikes and the road to admission.",
  },
  {
    slug: "health",
    name: "Health",
    blurb: "Hospitals, drugs, mental health and staying well.",
  },
  {
    slug: "security",
    name: "Security",
    blurb: "Police, kidnapping, safety and fear.",
  },
  {
    slug: "entertainment",
    name: "Entertainment",
    blurb: "Music, Nollywood, creators and what we watch.",
  },
  {
    slug: "sport",
    name: "Sport",
    blurb: "Football, Super Eagles and the games we argue about.",
  },
] as const;
