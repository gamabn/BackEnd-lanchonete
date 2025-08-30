"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCloudinaryImage = exports.deleteFromCloudinary = exports.uploadToCloudinary = void 0;
const cloudinary_1 = require("cloudinary");
cloudinary_1.v2.config({
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
const uploadToCloudinary = (buffer, options // permite folder, tags etc
) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary_1.v2.uploader.upload_stream({ resource_type: "auto", ...options }, (error, result) => {
            if (error || !result)
                return reject(error || new Error("Falha no upload para o Cloudinary"));
            resolve(result);
        });
        uploadStream.end(buffer);
    });
};
exports.uploadToCloudinary = uploadToCloudinary;
// -----------------------
// Deletar imagem pelo public_id
// -----------------------
const deleteFromCloudinary = (publicId) => {
    return new Promise((resolve, reject) => {
        cloudinary_1.v2.uploader.destroy(publicId, { resource_type: "image" }, (error, result) => {
            if (error)
                return reject(error);
            resolve(result);
        });
    });
};
exports.deleteFromCloudinary = deleteFromCloudinary;
// -----------------------
// Atualizar imagem
// Deleta a antiga e envia a nova
// -----------------------
const updateCloudinaryImage = async (oldPublicId, newBuffer, options) => {
    if (oldPublicId) {
        await (0, exports.deleteFromCloudinary)(oldPublicId);
    }
    const result = await (0, exports.uploadToCloudinary)(newBuffer, options);
    return result;
};
exports.updateCloudinaryImage = updateCloudinaryImage;
