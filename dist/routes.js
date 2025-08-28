"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailRoutes = exports.router = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const SendTestEmailController_1 = require("./controller/user/SendTestEmailController");
const CreateStoreController_1 = require("./controller/user/CreateStoreController");
const GetStoreController_1 = require("./controller/user/GetStoreController");
const ChangePasswordController_1 = require("./controller/user/ChangePasswordController");
const GetIdStoreController_1 = require("./controller/user/GetIdStoreController");
const AuthStoreController_1 = require("./controller/user/AuthStoreController");
const DetailStoreController_1 = require("./controller/user/DetailStoreController");
const EditStoreController_1 = require("./controller/user/EditStoreController");
const ImageStoreController_1 = require("./controller/user/ImageStoreController");
const EditStatusController_1 = require("./controller/user/EditStatusController");
const AuthResetValidateController_1 = require("./controller/user/AuthResetValidateController");
const AuthResetController_1 = require("./controller/user/AuthResetController");
const isAuthentication_1 = require("./middlewares/isAuthentication");
const CreateProductController_1 = require("./controller/product/CreateProductController");
const EditProductController_1 = require("./controller/product/EditProductController");
const DeleteProductController_1 = require("./controller/product/DeleteProductController");
const GetProductController_1 = require("./controller/product/GetProductController");
const GetProductIdController_1 = require("./controller/product/GetProductIdController");
const CreateClientController_1 = require("./controller/clients/CreateClientController");
const GetClientController_1 = require("./controller/clients/GetClientController");
const DeleteClientController_1 = require("./controller/clients/DeleteClientController");
const UpdateClientController_1 = require("./controller/clients/UpdateClientController");
const OrderSalesController_1 = require("./controller/order/OrderSalesController");
const UpdateOrderController_1 = require("./controller/order/UpdateOrderController");
const DashboardController_1 = require("./controller/order/DashboardController");
const GraficController_1 = require("./controller/order/GraficController");
const GetChatController_1 = require("./controller/message/GetChatController");
const ListMessageController_1 = require("./controller/message/ListMessageController");
const MessaPostController_1 = require("./controller/message/MessaPostController");
const GetAllChatController_1 = require("./controller/message/GetAllChatController");
const DeleteChatController_1 = require("./controller/message/DeleteChatController");
//import { CreateOrderItemController } from "./controller/order_item/CreateOrderItemController"
// import { OrderPostController } from "./controller/order_item/CreateOrderItemController";
const CreateOrderItemController_1 = require("./controller/order_item/CreateOrderItemController");
const DeleteOrderController_1 = require("./controller/order_item/DeleteOrderController");
const GetOrdemItemController_1 = require("./controller/order_item/GetOrdemItemController");
const emailRoutes = (0, express_1.Router)();
exports.emailRoutes = emailRoutes;
const router = (0, express_1.Router)();
exports.router = router;
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
//--Rotas de User
router.post('/user', new CreateStoreController_1.CreateUserController().handle);
router.post('/auth', new AuthStoreController_1.AuthStoreController().handle);
router.get('/user/:id', new GetIdStoreController_1.GetIdStoreController().handle);
router.get('/user', new GetStoreController_1.GetStoreController().handle);
router.get('/me', isAuthentication_1.isAuthentication, new DetailStoreController_1.DetailStoreController().handle);
router.put('/user/edit', isAuthentication_1.isAuthentication, new EditStoreController_1.EditStoreController().handle);
router.put('/user/image/:id', upload.single('file'), new ImageStoreController_1.ImageStoreController().handle);
router.patch('/user/status', isAuthentication_1.isAuthentication, new EditStatusController_1.EditStatusController().handle);
router.delete('/user/delete', isAuthentication_1.isAuthentication, new DeleteClientController_1.DeleteClientController().handle);
router.post('/user/change', new ChangePasswordController_1.ChangePasswordController().handle);
//router.post('/auth/reset/validate', new AuthResetController().handle)
router.post('/auth/reset/validate', new AuthResetController_1.AuthResetController().handle);
router.get('/user/reset-password', new AuthResetValidateController_1.AuthResetValidateController().handle);
router.post('/user/reset-password', new AuthResetController_1.AuthResetController().handle);
//--Rotas de Email
emailRoutes.post('/send-test-email', new SendTestEmailController_1.SendTestEmailController().handle);
router.post('/change-password', new ChangePasswordController_1.ChangePasswordController().handle);
// Rotas deMensagem
router.get('/chat', new GetAllChatController_1.GetAllChatController().handle);
router.get('/chat/:order_id', new GetChatController_1.GetChatController().handle);
router.get('/message/:chat_id', new ListMessageController_1.MessageGetController().handle);
router.post('/message', new MessaPostController_1.MessagePostController().handle);
router.delete('/chat/:order_id', new DeleteChatController_1.DeleteChatController().handle);
//---Rotas de Produtos
router.get('/product', isAuthentication_1.isAuthentication, new GetProductController_1.GetProductController().handle);
router.post('/product', isAuthentication_1.isAuthentication, upload.single('file'), new CreateProductController_1.CreateProductController().handle);
router.put('/product/edit', isAuthentication_1.isAuthentication, upload.single('file'), new EditProductController_1.EditProductController().handle);
router.delete('/product/delete', isAuthentication_1.isAuthentication, new DeleteProductController_1.DeleteProductController().handle);
router.get('/product/client', new GetProductController_1.GetProductController().handle);
router.get('/product/:id', new GetProductIdController_1.GetProductIdController().handle);
//--Rotas de Clientes
router.post('/client/:id', new CreateClientController_1.CreateClientController().handle);
router.get('/client/:id', new GetClientController_1.GetClientController().handle);
router.delete('/client/delete', new DeleteClientController_1.DeleteClientController().handle);
router.put('/client/update', new UpdateClientController_1.UpdateClientController().handle);
//--Rotas de Pedidos(orders)
router.post('/order/:id', new OrderSalesController_1.OrderSalesController().handle);
router.patch('/order', new UpdateOrderController_1.UpdateOrderController().handle);
router.get('/order', isAuthentication_1.isAuthentication, new DashboardController_1.DashboardController().handle);
router.get('/grafic', isAuthentication_1.isAuthentication, new GraficController_1.GraficController().handle);
//--Rotas de Pedidos(order_item)
router.post('/order_item', new CreateOrderItemController_1.CreateOrderItemController().handle);
router.delete('/order_item', new DeleteOrderController_1.DeleteOrderController().handle);
router.get('/order_item', isAuthentication_1.isAuthentication, new GetOrdemItemController_1.GetOrdemItemController().handle);
