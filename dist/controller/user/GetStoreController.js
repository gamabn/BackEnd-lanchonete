"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetStoreController = void 0;
const GetStoreService_1 = require("../../service/user/GetStoreService");
class GetStoreController {
    async handle(req, res) {
        const getStore = new GetStoreService_1.GetStoreService();
        const store = await getStore.execute();
        return res.json(store);
    }
}
exports.GetStoreController = GetStoreController;
