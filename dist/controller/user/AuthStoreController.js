"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthStoreController = void 0;
const AuthStoreService_1 = require("../../service/user/AuthStoreService");
class AuthStoreController {
    async handle(req, res) {
        const { email, password } = req.body;
        // console.log(req.body)
        const getStore = new AuthStoreService_1.AuthStoreService();
        const store = await getStore.execute({ email, password });
        return res.json(store);
    }
}
exports.AuthStoreController = AuthStoreController;
