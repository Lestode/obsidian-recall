import { canonicalQuestionContent } from "./source-context";

export async function hashQuestionContent(prompt: string, answer: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalQuestionContent(prompt, answer));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
