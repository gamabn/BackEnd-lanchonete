import fs from "fs";
import path from "path";
import "dotenv/config";
import { uploadToCloudinary } from "./src/lib/cloudinaryUploader"; // ajuste o caminho conforme sua estrutura



(async () => {

    console.log("Cloud Name:", process.env.CLAUDINARY_NAME);
   console.log("API Key:",process.env.CLAUDINARY_KEY);
    console.log("API Secret:", process.env.CLAUDINARY_SECRET);
  try {
    // caminho para uma imagem local qualquer
    const imagePath = path.join(__dirname, "teste.png");

    // lê o arquivo e transforma em Buffer
    const buffer = fs.readFileSync(imagePath);

    console.log("📤 Enviando imagem para Cloudinary...");
    const result = await uploadToCloudinary(buffer);

    console.log("✅ Upload concluído!");
    console.log("🌐 URL:", result.url);
  } catch (error) {
    console.error("❌ Erro no teste Cloudinary:", error);
  }
})();
