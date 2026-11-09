/** The AI behind "Fix my text" (LCH-12). Real: Gemini. Tests: a local stand-in that follows the same contract. */
export const TEXT_FIXER = Symbol("TEXT_FIXER");

export interface TextFixer {
  /**
   * Returns the same text with only its spelling, typos and grammar corrected. It must not add ideas, remove ideas or
   * change what the person means. The service checks that anyway (see fix-diff.ts) and never trusts the answer.
   */
  fix(text: string): Promise<string>;
}
