// Code-defined content catalogs (versioned in source, like the matching
// presets). These power evidence-based product features:
//   - VALUES_CATALOG: selectable core values (#6 — perceived value similarity
//     predicts attraction; Montoya et al. 2008) and the dealbreaker picker (#5).
//   - PROMPT_CATALOG: curated, high-signal profile questions tagged with the
//     value they reveal (#6) — replaces low-signal free-form prompts.
//   - QUESTION_SETS: escalating, reciprocal get-to-know-you questions (#3 —
//     Aron et al. 1997, the "36 questions"; staged by vulnerability).
//   - COACHING_TIPS: short in-chat nudges toward responsiveness & question-
//     asking (#3/#12 — Huang et al. 2017; Reis responsiveness).
//
// Served read-only via /api/v1/content; iOS renders from the API so the
// catalogs stay a single source of truth.

export const CONTENT_VERSION = "2026-05-26";

export interface ValueOption {
  key: string;
  label: string;
}

// Stable keys (snake_case) are what's stored on Profile.values /
// Preferences.dealbreakers; labels are display-only and may be localized later.
export const VALUES_CATALOG: ValueOption[] = [
  { key: "family", label: "Family" },
  { key: "faith", label: "Faith & spirituality" },
  { key: "ambition", label: "Ambition" },
  { key: "adventure", label: "Adventure" },
  { key: "kindness", label: "Kindness" },
  { key: "honesty", label: "Honesty" },
  { key: "independence", label: "Independence" },
  { key: "community", label: "Community" },
  { key: "creativity", label: "Creativity" },
  { key: "health", label: "Health & fitness" },
  { key: "growth", label: "Personal growth" },
  { key: "humor", label: "Humor" },
  { key: "stability", label: "Stability" },
  { key: "sustainability", label: "Sustainability" },
  { key: "loyalty", label: "Loyalty" },
  { key: "curiosity", label: "Curiosity" },
];

export const VALUE_KEYS = new Set(VALUES_CATALOG.map((v) => v.key));

// Dealbreakers (#5): a small, high-signal set users can flag at onboarding.
export interface DealbreakerOption {
  key: string;
  label: string;
}
export const DEALBREAKERS_CATALOG: DealbreakerOption[] = [
  { key: "wants_kids", label: "Wants children" },
  { key: "no_kids", label: "Does not want children" },
  { key: "non_smoker", label: "Non-smoker only" },
  { key: "wants_long_term", label: "Looking for long-term only" },
  { key: "must_be_verified", label: "Photo-verified only" },
];
export const DEALBREAKER_KEYS = new Set(DEALBREAKERS_CATALOG.map((d) => d.key));

export interface PromptOption {
  id: string;
  question: string;
  // The value this prompt tends to reveal — used to surface "you both value …"
  // and to nudge balanced value coverage. Optional.
  valueTag?: string;
}

export const PROMPT_CATALOG: PromptOption[] = [
  { id: "perfect_sunday", question: "My perfect Sunday looks like…", valueTag: "growth" },
  {
    id: "care_deeply",
    question: "Something I care about more than most people expect…",
    valueTag: "kindness",
  },
  { id: "lights_me_up", question: "A topic I can talk about for hours…", valueTag: "curiosity" },
  { id: "family_means", question: "What family means to me…", valueTag: "family" },
  {
    id: "faith_role",
    question: "The role faith or spirituality plays in my life…",
    valueTag: "faith",
  },
  {
    id: "proud_of",
    question: "Something I built or accomplished that I'm proud of…",
    valueTag: "ambition",
  },
  {
    id: "adventure",
    question: "The most spontaneous thing I've ever done…",
    valueTag: "adventure",
  },
  {
    id: "honesty",
    question: "A truth I think more people should say out loud…",
    valueTag: "honesty",
  },
  { id: "recharge", question: "I recharge by…", valueTag: "independence" },
  { id: "community", question: "How I show up for the people around me…", valueTag: "community" },
  { id: "create", question: "Something I love making or creating…", valueTag: "creativity" },
  { id: "move", question: "How I like to move my body…", valueTag: "health" },
  { id: "growing", question: "Something I'm working on becoming better at…", valueTag: "growth" },
  { id: "laugh", question: "The kind of humor that gets me every time…", valueTag: "humor" },
  { id: "home", question: "What 'home' feels like to me…", valueTag: "stability" },
  { id: "planet", question: "A small thing I do for the planet…", valueTag: "sustainability" },
];

export interface QuestionSet {
  level: 1 | 2 | 3;
  title: string;
  // Escalating in vulnerability per Aron et al. (1997).
  questions: string[];
}

export const QUESTION_SETS: QuestionSet[] = [
  {
    level: 1,
    title: "Warm up",
    questions: [
      "Given the choice of anyone in the world, whom would you want as a dinner guest?",
      "What would constitute a perfect day for you?",
      "Before making a phone call, do you ever rehearse what you're going to say? Why?",
      "What's something you've done recently that you're a little proud of?",
    ],
  },
  {
    level: 2,
    title: "Getting real",
    questions: [
      "What's the greatest accomplishment of your life so far?",
      "What do you value most in a friendship?",
      "If you could wake up tomorrow having gained one quality or ability, what would it be?",
      "What's a belief you've changed your mind about in the last few years?",
    ],
  },
  {
    level: 3,
    title: "Going deep",
    questions: [
      "What does a meaningful relationship look like to you?",
      "When did you last cry in front of another person? By yourself?",
      "What's something you've never told someone you just met that you'd want a real partner to know?",
      "Of all the people in your family, whose death would you find most disturbing? Why?",
    ],
  },
];

export interface CoachingTip {
  id: string;
  // Where the client may surface it.
  context: "first_message" | "stalled" | "general";
  text: string;
}

export const COACHING_TIPS: CoachingTip[] = [
  {
    id: "ask_question",
    context: "first_message",
    text: "People who ask a genuine question in their opener get far more replies — reference something specific from their profile.",
  },
  {
    id: "follow_up",
    context: "general",
    text: "Follow-up questions signal you're listening. Ask one that builds on their last answer.",
  },
  {
    id: "reciprocate",
    context: "general",
    text: "Closeness grows from balanced sharing — match their openness with a little of your own.",
  },
  {
    id: "your_turn",
    context: "stalled",
    text: "It's been quiet — a short, warm message that asks something easy to answer often restarts things.",
  },
  {
    id: "meet_soon",
    context: "general",
    text: "Long texting can build expectations that a first meeting can't match. If it's going well, suggest a low-key plan.",
  },
];
