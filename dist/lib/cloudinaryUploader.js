"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCloudinaryImage = exports.deleteFromCloudinary = exports.uploadToCloudinary = void 0;
const cloudinary_1 = require("cloudinary");
cloudinary_1.v2.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
});
console.log("Cloudinary vars:", {
    name: process.env.CLOUDINARY_NAME,
    key: process.env.CLOUDINARY_KEY,
    secret: process.env.CLOUDINARY_SECRET,
});
// -----------------------
// Upload de imagem
// -----------------------
const uploadToCloudinary = (buffer, options) => {
    return new Promise((resolve, reject) => {
        cloudinary_1.v2.uploader.upload_stream({
            resource_type: "auto",
            folder: "produtos", // force o folder aqui no backend
            ...options,
        }, (error, result) => {
            if (error)
                return reject(error);
            if (!result)
                return reject(new Error("Falha no upload para o Cloudinary: Nenhum resultado retornado."));
            resolve(result);
        }).end(buffer);
    });
};
exports.uploadToCloudinary = uploadToCloudinary;
// -----------------------
// Deletar imagem pelo public_id
// -----------------------
const deleteFromCloudinary = (publicId) => {
    return new Promise((resolve, reject) => {
        cloudinary_1.v2.uploader.destroy(publicId, { resource_type: "image" }, (error, result) => {
            // O tipo de 'result' pode ser { result: 'ok' } ou { result: 'not found' } ou undefined em caso de erro.
            if (error || !result)
                return reject(error || new Error(`Falha ao deletar a imagem com public_id: ${publicId}`));
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
