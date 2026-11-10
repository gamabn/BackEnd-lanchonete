"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateUserController = void 0;
const cloudinaryUploader_1 = require("../../lib/cloudinaryUploader");
const ImageStoreService_1 = require("../../service/user/ImageStoreService");
const CreateStoreService_1 = require("../../service/user/CreateStoreService");
class CreateUserController {
    async handle(req, res) {
        const { name, email, password, phone, city, neighborhood, street, number } = req.body;
        // console.log(req.body)
        const createStore = new CreateStoreService_1.CreateStoreService();
        const store = await createStore.execute({ name, email, password, phone, city, neighborhood, street, number });
        if (req.file) {
            const image = await (0, cloudinaryUploader_1.uploadToCloudinary)(req.file.buffer);
            const updated = await new ImageStoreService_1.ImageStorageService().execute(store.id, image.url);
            return res.json(updated);
        }
        return res.json(store);
    }
}
exports.CreateUserController = CreateUserController;
