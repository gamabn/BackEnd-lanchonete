import { randomUUID } from "node:crypto";
import { pool } from "../../database";
import { deleteFromCloudinary, uploadToCloudinary } from "../../lib/cloudinaryUploader";

export async function uploadProductImage(buffer: Buffer) {
  const publicId = randomUUID();
  try {
    return await uploadToCloudinary(buffer, {
      folder: "produtos",
      public_id: publicId,
      overwrite: false,
    });
  } catch (error) {
    console.error("Falha no upload de imagem de produto:", publicId);
    throw error;
  }
}

export async function removeUnreferencedProductImage(publicId: string): Promise<void> {
  try {
    // An older catalog may share image IDs across products or restaurants.
    const reference = await pool.query(
      "SELECT 1 FROM products WHERE public_id = $1 LIMIT 1",
      [publicId],
    );
    if (!reference.rowCount) {
      await deleteFromCloudinary(publicId);
    }
  } catch (error) {
    console.error("Falha ao limpar imagem de produto:", publicId, error);
  }
}

export async function handleFailedProductImageWrite(publicId: string, error: unknown): Promise<void> {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^(22|23)[0-9A-Z]{3}$/.test(code)) {
    await removeUnreferencedProductImage(publicId);
    return;
  }
  // A lost connection can leave the result of the write unknown.
  console.error("Imagem de produto pendente de conferência:", publicId);
}
