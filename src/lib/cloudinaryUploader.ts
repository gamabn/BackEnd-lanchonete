import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLAUDINARY_NAME,
  api_key: process.env.CLAUDINARY_KEY,
  api_secret: process.env.CLAUDINARY_SECRET,
});
console.log("Cloudinary vars:", {
  name: process.env.CLAUDINARY_NAME,
  key: process.env.CLAUDINARY_KEY,
  secret: process.env.CLAUDINARY_SECRET,
});
// -----------------------
// Upload de imagem
// -----------------------
export const uploadToCloudinary = (
  buffer: Buffer,
  options?: Record<string, any>
): Promise<UploadApiResponse> => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        resource_type: "auto",
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
    cloudinary.uploader.destroy(publicId, { resource_type: "image" }, (error, result: any) => {
      // O tipo de 'result' pode ser { result: 'ok' } ou { result: 'not found' } ou undefined em caso de erro.
      if (error || !result) return reject(error || new Error(`Falha ao deletar a imagem com public_id: ${publicId}`));
      resolve(result);
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
  options?: Record<string, any>
): Promise<UploadApiResponse> => {
  if (oldPublicId) {
    await deleteFromCloudinary(oldPublicId);
  }
  const result = await uploadToCloudinary(newBuffer, options);
  return result;
};
