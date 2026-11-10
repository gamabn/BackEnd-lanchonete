import { v2 as cloudinary, type UploadApiResponse, type UploadApiOptions } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET,
});
// -----------------------
// Upload de imagem
// -----------------------
export const uploadToCloudinary = (
  buffer: Buffer,
  options?: UploadApiOptions
): Promise<UploadApiResponse> => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: "produtos", // force o folder aqui no backend
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error("Falha no upload para o Cloudinary: Nenhum resultado retornado."));
        resolve(result);
      }
    ).end(buffer);
  });
};

// -----------------------
// Deletar imagem pelo public_id
// -----------------------
export const deleteFromCloudinary = (publicId: string): Promise<{ result: string }> => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(publicId, { resource_type: "image" }, (error, result: unknown) => {
      // O tipo de 'result' pode ser { result: 'ok' } ou { result: 'not found' } ou undefined em caso de erro.
      if (error) return reject(error);
      if (!result || typeof result !== "object" || !("result" in result) || typeof result.result !== "string") {
        return reject(new Error("Resposta inválida ao excluir imagem."));
      }
      resolve({ result: result.result });
    });
  });
};

// -----------------------
// Atualizar imagem
// Deleta a antiga e envia a nova
// -----------------------
export const updateCloudinaryImage = async (
  oldPublicId: string,
  newBuffer: Buffer,
  options?: UploadApiOptions
): Promise<UploadApiResponse> => {
  if (oldPublicId) {
    await deleteFromCloudinary(oldPublicId);
  }
  const result = await uploadToCloudinary(newBuffer, options);
  return result;
};
