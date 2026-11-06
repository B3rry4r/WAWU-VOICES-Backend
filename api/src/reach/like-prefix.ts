/** A LIKE pattern matching strings that start with prefix, with the wildcards and the escape character escaped. */
export function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, "\\$&")}%`;
}
