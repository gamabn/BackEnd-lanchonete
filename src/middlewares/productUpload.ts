import type { RequestHandler } from "express";
import multer from "multer";
import { PRODUCT_FIELD_MAX_BYTES, PRODUCT_IMAGE_MAX_BYTES } from "../service/product/productValidation";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PRODUCT_IMAGE_MAX_BYTES + 1,
    files: 1,
    fields: 8,
    fieldSize: PRODUCT_FIELD_MAX_BYTES,
    fieldNameSize: 100,
  },
}).single("file");

export const productUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "A imagem deve ter até 5 MiB." });
      return;
    }

    res.status(400).json({ error: "Envio de produto inválido. Envie no máximo uma imagem no campo file." });
  });
};
