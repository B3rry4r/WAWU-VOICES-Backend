// No suite may reach the AI provider, even on a machine whose shell or api/.env has a key. An empty value (not a deleted
// one) also stops ConfigModule from loading the key from api/.env. Specs that need a drafter inject a fake by provider override.
process.env.GEMINI_API_KEY = "";
