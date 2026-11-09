import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cp from "node:child_process";

import {
  normalise,
  probe,
  convertOnePass,
  mp4Duration,
} from "../../src/audio-ref/normalise";
import { peaks } from "../../src/audio-ref/peaks";
import { processClip } from "../../src/audio-ref/pipeline";

jest.mock("node:child_process", () => {
  const real =
    jest.requireActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return { ...real, spawn: jest.fn(real.spawn) };
});
const spawnMock = cp.spawn as unknown as jest.Mock<unknown, unknown[][]>;

const fx = (n: string) => readFileSync(join(__dirname, "..", "fixtures", n));

/**
 * LCH-09 one pass (DECISIONS V-39): processClip converts, measures and (from the stored file) makes the waveform with ONE
 * conversion run plus one small decode, where it used to run ffprobe, ffmpeg, ffprobe and ffmpeg. The stored file, the length
 * and the waveform must be what the old chain gave.
 */
describe("one-pass voice processing", () => {
  const cases: [string, "free" | "voice30"][] = [
    ["sample.webm", "free"],
    ["sample.mp4", "free"],
    ["long15.webm", "voice30"],
    ["long15-nodur.webm", "voice30"],
  ];

  it.each(cases)(
    "%s: the stored file, length and waveform equal the old chain's",
    async (name, tier) => {
      const raw = fx(name);
      // the old chain, step by step, from the pieces that are still exported
      const before = await probe(raw);
      const max = tier === "free" ? 10 : 30;
      const oldAudio = await normalise(
        raw,
        Number.isFinite(before.duration) ? max : max + 5,
      );
      const oldLen = Math.round((await probe(oldAudio)).duration * 10) / 10;
      const oldPeaks = await peaks(oldAudio);
      const now = await processClip(raw, tier);
      expect(now.audio.equals(oldAudio)).toBe(true);
      expect(now.durationSeconds).toBe(oldLen);
      expect(now.peaks).toEqual(oldPeaks);
      expect(now.bytes).toBe(oldAudio.length);
    },
    60000,
  );

  it("the length read from the file's header is the length ffprobe reports", async () => {
    for (const n of ["sample.webm", "sample.mp4", "long15.webm"]) {
      const one = await convertOnePass(fx(n), 20);
      expect(mp4Duration(one.audio)).toBeCloseTo(
        (await probe(one.audio)).duration,
        2, // within 5 ms (it differs by 1 ms for some files; the length is rounded to 0.1 s)
      );
    }
  }, 60000);

  it("uses one conversion run and no ffprobe (the old chain started four processes)", async () => {
    spawnMock.mockClear();
    const spy = spawnMock;
    try {
      await processClip(fx("sample.webm"), "free");
      const cmds = spy.mock.calls.map((c) =>
        String(c[0]) === "nice" ? String((c[1] as string[])[2]) : String(c[0]),
      );
      expect(cmds.filter((c) => c === "ffprobe")).toHaveLength(0);
      expect(cmds.filter((c) => c === "ffmpeg")).toHaveLength(2); // the conversion, and the small decode for the waveform
      expect(cmds).toHaveLength(2);
    } finally {
      /* nothing to restore */
    }
  }, 60000);

  describe("failure paths give the old answers", () => {
    it("a broken file is not_audio", async () => {
      await expect(
        processClip(Buffer.from("this is not audio at all"), "free"),
      ).rejects.toThrow("not_audio");
    });
    it("an empty file is not_audio", async () => {
      await expect(processClip(Buffer.alloc(0), "free")).rejects.toThrow(
        "not_audio",
      );
    });
    it("a 15 s file on the free tier is too_long, and fits voice30", async () => {
      await expect(processClip(fx("long15.webm"), "free")).rejects.toThrow(
        "too_long",
      );
      await expect(
        processClip(fx("long15-nodur.webm"), "free"),
      ).rejects.toThrow("too_long");
      expect(
        (await processClip(fx("long15.webm"), "voice30")).durationSeconds,
      ).toBeGreaterThan(14);
    }, 60000);
    it("a file over the raw size cap is too_large before any process starts", async () => {
      spawnMock.mockClear();
      const spy = spawnMock;
      try {
        await expect(
          processClip(Buffer.alloc(400_001), "free"),
        ).rejects.toThrow("too_large");
        expect(spy).not.toHaveBeenCalled();
      } finally {
        /* nothing to restore */
      }
    });
  });
});
