import { S3Client } from "@aws-sdk/client-s3";
import { ExportStore } from "../../src/me/export.service";

/** H6: the export file is stored with a file name, and the signed download link carries one too. */
describe("export download file name", () => {
  it("stores the object as an attachment named voices-export.json and signs a link that says so", async () => {
    process.env.SPACES_ENDPOINT = "https://nyc3.digitaloceanspaces.com";
    process.env.SPACES_BUCKET = "voices-test";
    process.env.SPACES_KEY = "k";
    process.env.SPACES_SECRET = "s";
    const sent: unknown[] = [];
    const spy = jest
      .spyOn(S3Client.prototype, "send")
      .mockImplementation((cmd: unknown) => {
        sent.push(cmd);
        return Promise.resolve({}) as never;
      });
    try {
      const store = new ExportStore();
      await store.put("exports/x.json", Buffer.from("{}"));
      const input = (sent[0] as { input: Record<string, unknown> }).input;
      expect(input.ContentDisposition).toBe(
        'attachment; filename="voices-export.json"',
      );
      const url = await store.signedGet("exports/x.json");
      expect(decodeURIComponent(url)).toContain(
        'response-content-disposition=attachment; filename="voices-export.json"',
      );
    } finally {
      spy.mockRestore();
    }
  });
});
