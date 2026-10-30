import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { appendSourceNotes, renderSourceNotes, writeSourceNotes, type PriorOutput } from "./prepare";

const usage = `Agent helper: npm run prepare-source -- --draft draft.json --parent /vault/collection --prior-output none
Use --prior-output confirmed-new-copy only after the user approves another copy.
Use --draft draft.json --preview to inspect Markdown without writing to the vault.
Use --draft remaining.json --append-to /vault/collection/source for an explicitly requested staged continuation.
Source reading and question generation are performed by the source-preparation skill.`;

try {
  const { values } = parseArgs({ options: {
    draft: { type: "string" }, parent: { type: "string" }, "append-to": { type: "string" },
    "prior-output": { type: "string" }, preview: { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log(usage);
  } else {
    if (!values.draft) throw new Error("--draft is required. Run with --help for usage.");
    const draft: unknown = JSON.parse(await readFile(values.draft, "utf8"));
    if (values.preview) {
      const source = renderSourceNotes(draft);
      console.log(source.notes.length === 1 ? source.notes[0]!.markdown : JSON.stringify(source, null, 2));
    } else {
      if (values["append-to"] && (values.parent || values["prior-output"])) throw new Error("--append-to cannot be combined with --parent or --prior-output.");
      if (!values["append-to"] && !values.parent) throw new Error("--parent is required; choose a folder inside an existing Recall collection.");
      const result = values["append-to"] ? await appendSourceNotes(draft, values["append-to"])
        : await writeSourceNotes(draft, values.parent!, values["prior-output"] as PriorOutput);
      console.log(JSON.stringify({ ...result, ...(result.notes.length === 1 ? { filePath: result.notes[0]!.filePath } : {}) }, null, 2));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
