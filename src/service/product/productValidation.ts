export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_FIELD_MAX_BYTES = 16 * 1024;

export class ProductInputError extends Error {
  constructor(message: string, readonly status = 400, readonly details?: string[]) {
    super(message);
  }
}

// undefined means omitted on edits; callers use ?? null on creation.
export function normalizeProductCategory(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || /[\p{Cc}\p{Cs}]/u.test(value)) {
    throw new ProductInputError("Categoria inválida.");
  }
  const category = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (Array.from(category).length > 80) throw new ProductInputError("Categoria deve ter até 80 caracteres.");
  return category || null;
}

export function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new ProductInputError(label === "Descrição" ? "Informe uma descrição válida." : `${label} inválido.`);
  }

  const text = value.trim();
  if (Buffer.byteLength(text) > PRODUCT_FIELD_MAX_BYTES) {
    throw new ProductInputError(`${label} excede o limite permitido.`);
  }
  return text;
}

export function validateProductFields({ name, description, price, category }: { name?: unknown; description?: unknown; price?: unknown; category?: unknown }) {
  const amount = typeof price === "string" || typeof price === "number"
    ? String(price).trim().replace(",", ".")
    : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new ProductInputError("Informe um preço maior que zero, com até duas casas decimais.");
  }

  return {
    name: requiredText(name, "Nome"),
    description: requiredText(description, "Descrição"),
    price: amount,
    category: normalizeProductCategory(category),
  };
}

export function validateProductImage(file: Express.Multer.File): void {
  const { buffer, mimetype } = file;
  if (buffer.length > PRODUCT_IMAGE_MAX_BYTES) {
    throw new ProductInputError("A imagem deve ter até 5 MiB.", 413);
  }

  // Check the declared format against the file signature before uploading.
  const startsWith = (signature: string) => buffer.subarray(0, signature.length / 2).toString("hex") === signature;
  const ascii = (start: number, end: number) => buffer.toString("ascii", start, end);
  const matches =
    (mimetype === "image/jpeg" && startsWith("ffd8ff")) ||
    (mimetype === "image/png" && startsWith("89504e470d0a1a0a")) ||
    (mimetype === "image/gif" && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) ||
    (mimetype === "image/webp" && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") ||
    (mimetype === "image/avif" && ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) ||
    (mimetype === "image/bmp" && ascii(0, 2) === "BM") ||
    (mimetype === "image/tiff" && (startsWith("49492a00") || startsWith("4d4d002a")));

  if (!matches) {
    throw new ProductInputError("Envie uma imagem válida em JPEG, PNG, GIF, WebP, AVIF, BMP ou TIFF.");
  }
}
