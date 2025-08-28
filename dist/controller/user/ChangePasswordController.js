"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChangePasswordController = void 0;
const ChangePasswordService_1 = require("../../service/user/ChangePasswordService");
class ChangePasswordController {
    async handle(req, res) {
        const { email } = req.body;
        // console.log(req.body)
        const changePassword = new ChangePasswordService_1.ChangePasswordService();
        const passwordStore = await changePassword.execute({ email });
        return res.json(passwordStore);
    }
}
exports.ChangePasswordController = ChangePasswordController;
