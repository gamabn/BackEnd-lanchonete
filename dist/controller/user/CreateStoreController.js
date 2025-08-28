"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateUserController = void 0;
const CreateStoreService_1 = require("../../service/user/CreateStoreService");
class CreateUserController {
    async handle(req, res) {
        const { name, email, password, phone, city, neighborhood, street, number } = req.body;
        // console.log(req.body)
        const createStore = new CreateStoreService_1.CreateStoreService();
        const store = await createStore.execute({ name, email, password, phone, city, neighborhood, street, number });
        return res.json(store);
    }
}
exports.CreateUserController = CreateUserController;
