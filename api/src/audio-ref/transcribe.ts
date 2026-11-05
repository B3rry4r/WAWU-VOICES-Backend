import { GoogleGenAI } from "@google/genai";

// Gemini via the Google GenAI SDK. Key from env GEMINI_API_KEY, never committed. Model from GEMINI_MODEL.
export interface Transcriber {
  transcribe(audio: Buffer, mime: string): Promise<string>;
}

export const TRANSCRIBE_PROMPT =
  "Transcribe this short voice clip exactly as spoken, in the language spoken (English, Pidgin, Yoruba, Igbo or Hausa). " +
  "Return only the transcript text, no commentary. If there is no speech, return an empty string.";

export function makeGeminiTranscriber(env = process.env): Transcriber {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });
  const model = env.GEMINI_MODEL ?? "gemini-2.5-flash";
  return {
    async transcribe(audio, mime) {
      // clips are at most 60 s and about 240 KB, far under the inline limit (20 MB), so no Files API upload is needed
      const res = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: { mimeType: mime, data: audio.toString("base64") },
              },
              { text: TRANSCRIBE_PROMPT },
            ],
          },
        ],
      });
      return (res.text ?? "").trim();
    },
  };
}
