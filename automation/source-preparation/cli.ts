import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { renderSourceNote, writeSourceNote, type PriorOutput } from "./prepare";

const usage = `Agent helper: npm run prepare-source -- --draft draft.json --parent /vault/collection --prior-output none
Use --prior-output confirmed-new-copy only after the user approves another copy.
Use --draft draft.json --preview to inspect Markdown without writing to the vault.
Source reading and question generation are performed by the source-preparation skill.`;

try {
  const { values } = parseArgs({ options: {
    draft: { type: "string" }, parent: { type: "string" },
    "prior-output": { type: "string" }, preview: { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log(usage);
  } else {
    if (!values.draft) throw new Error("--draft is required. Run with --help for usage.");
    const draft: unknown = JSON.parse(await readFile(values.draft, "utf8"));
    if (values.preview) {
      console.log(renderSourceNote(draft).markdown);
    } else {
      if (!values.parent) throw new Error("--parent is required; choose a folder inside an existing Recall collection.");
      console.log(JSON.stringify(await writeSourceNote(draft, values.parent, values["prior-output"] as PriorOutput), null, 2));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
