import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { apiError } from "../units/units.errors";
import { countChars } from "../units/text-price";
import { ConfigReader } from "../talk/shared/config-reader";
import { UnitsAccess } from "../talk/shared/units-access";
import { checkFix, type FixChange } from "./fix-diff";
import { TEXT_FIXER, type TextFixer } from "./text-fixer.port";

export interface TextFixResult {
  fixedText: string;
  changes: FixChange[];
  changed: boolean;
  charge: { costMilli: number; balanceMilli: number };
}

const AI_TIMEOUT_MS = 20_000;

/**
 * POST /text/fix (LCH-12, V-37). The AI corrects spelling, typos and grammar only. The person is charged
 * `textfix.cost_milli` once, and only when a real fix comes back: an AI failure, an answer the meaning guard refuses
 * and a text with nothing to fix cost nothing. The charge key is built from the request's Idempotency-Key, so a retry
 * or twenty parallel taps with one key are charged once.
 */
@Injectable()
export class TextFixService {
  private readonly logger = new Logger(TextFixService.name);

  constructor(
    private readonly config: ConfigReader,
    private readonly units: UnitsAccess,
    @Optional() @Inject(TEXT_FIXER) private readonly fixer?: TextFixer,
  ) {}

  async fix(
    userId: string,
    text: unknown,
    key: string,
  ): Promise<TextFixResult> {
    if (typeof text !== "string" || !text.trim())
      throw apiError(422, "VALIDATION_FAILED", "Some details need fixing.", {
        fields: [{ path: "text", message: "Write something first." }],
      });
    const max = await this.config.num("text.max_chars");
    if (countChars(text) > max)
      throw apiError(422, "VALIDATION_FAILED", "Some details need fixing.", {
        fields: [{ path: "text", message: `Keep it to ${max} characters.` }],
      });
    if (!this.fixer)
      throw apiError(
        503,
        "UNAVAILABLE",
        "Fix my text is not available right now. Try again soon.",
      );
    const cost = await this.config.num("textfix.cost_milli");
    // Do not spend the AI's time on someone who cannot pay.
    const before = await this.units.freeLeft(userId, "POST_TEXT");
    if (before.balanceMilli < cost)
      throw apiError(
        402,
        "INSUFFICIENT_UNITS",
        "You need more tokens for that.",
        {
          costMilli: cost,
          balanceMilli: before.balanceMilli,
          minPackKobo: await this.config.num("units.min_purchase_kobo"),
        },
      );

    let fixed: string;
    try {
      fixed = await Promise.race([
        this.fixer.fix(text),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), AI_TIMEOUT_MS).unref(),
        ),
      ]);
    } catch (e) {
      this.logger.warn(`text fix failed: ${String(e)}`);
      throw this.failed();
    }
    if (typeof fixed !== "string") throw this.failed();
    const checked = checkFix(text, fixed);
    if (!checked.ok) {
      this.logger.warn(
        `text fix refused by the meaning guard: ${checked.reason}`,
      );
      throw this.failed();
    }
    if (checked.changes.length === 0)
      return {
        fixedText: text,
        changes: [],
        changed: false,
        charge: { costMilli: 0, balanceMilli: before.balanceMilli },
      };
    let charge;
    try {
      charge = await this.units.charge(userId, "TEXT_FIX", `textfix:${key}`);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error(`text fix charge failed: ${String(e)}`);
      throw this.failed();
    }
    const after = await this.units.freeLeft(userId, "POST_TEXT");
    return {
      fixedText: fixed,
      changes: checked.changes,
      changed: true,
      charge: { costMilli: charge.costMilli, balanceMilli: after.balanceMilli },
    };
  }

  private failed(): HttpException {
    return apiError(
      502,
      "TEXT_FIX_FAILED",
      "We could not fix your text just now. You have not been charged.",
    );
  }
}
