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
  options?: Record<string, any> // permite folder, tags etc
): Promise<UploadApiResponse> => {
  
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: "auto", ...options },
      (error, result) => {
        if (error || !result) return reject(error || new Error("Falha no upload para o Cloudinary"));
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

// -----------------------
// Deletar imagem pelo public_id
// -----------------------
export const deleteFromCloudinary = (publicId: string): Promise<{ result: string }> => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(publicId, { resource_type: "image" }, (error, result) => {
      if (error) return reject(error);
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
