/** Keep native import() intact: TypeScript CommonJS would otherwise emit require().
 * The specifier is a fixed literal, never supplied by configuration or messages.
 */
const nativeImport = new Function("return import('@whiskeysockets/baileys')") as
  () => Promise<typeof import("@whiskeysockets/baileys")>;

export async function loadBaileys() {
  return nativeImport();
}
