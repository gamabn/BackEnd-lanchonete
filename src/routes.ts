import { Router } from "express";
import type {  Request, Response } from "express";

import multer from "multer";

import { SendTestEmailController } from "./controller/user/SendTestEmailController";
import { CreateUserController } from "./controller/user/CreateStoreController";
import { GetStoreController } from "./controller/user/GetStoreController";
import { ChangePasswordController } from "./controller/user/ChangePasswordController";
import { GetIdStoreController } from "./controller/user/GetIdStoreController";
import { AuthStoreController } from "./controller/user/AuthStoreController";
import { DetailStoreController } from "./controller/user/DetailStoreController";
import { EditStoreController } from "./controller/user/EditStoreController";
import { ImageStoreController } from "./controller/user/ImageStoreController";
import { EditStatusController } from "./controller/user/EditStatusController";
import { AuthResetController } from "./controller/user/AuthResetController";

import { isAuthentication } from "./middlewares/isAuthentication";

import { CreateProductController } from "./controller/product/CreateProductController";
import { EditProductController } from "./controller/product/EditProductController";
import { DeleteProductController } from "./controller/product/DeleteProductController";
import { GetProductController } from "./controller/product/GetProductController";
import { GetProductIdController } from "./controller/product/GetProductIdController";



import { CreateClientController } from "./controller/clients/CreateClientController";
import { GetClientController } from "./controller/clients/GetClientController";
import { DeleteClientController } from "./controller/clients/DeleteClientController";
import { UpdateClientController } from "./controller/clients/UpdateClientController";



import { OrderSalesController } from "./controller/order/OrderSalesController";
import { UpdateOrderController } from "./controller/order/UpdateOrderController";
import { DashboardController } from "./controller/order/DashboardController";
import { GraficController } from "./controller/order/GraficController";


import { GetChatController } from "./controller/message/GetChatController";
import { MessageGetController } from "./controller/message/ListMessageController";
import { MessagePostController } from "./controller/message/MessaPostController";
import { GetAllChatController } from "./controller/message/GetAllChatController";
import { DeleteChatController } from "./controller/message/DeleteChatController";

//import { CreateOrderItemController } from "./controller/order_item/CreateOrderItemController"
// import { OrderPostController } from "./controller/order_item/CreateOrderItemController";
import { CreateOrderItemController } from "./controller/order_item/CreateOrderItemController";
import { DeleteOrderController } from "./controller/order_item/DeleteOrderController";
import { GetOrdemItemController } from "./controller/order_item/GetOrdemItemController";


const emailRoutes = Router();
const router = Router();

const upload = multer({ storage: multer.memoryStorage() });

//--Rotas de User
router.post('/user', new CreateUserController().handle)
router.post('/auth', new AuthStoreController().handle)
router.get('/user/:id', new GetIdStoreController().handle)
router.get('/user', new GetStoreController().handle)
router.get('/me',isAuthentication, new DetailStoreController().handle)
router.put('/user/edit', isAuthentication, new EditStoreController().handle)
router.put('/user/image/:id',upload.single('file'), new ImageStoreController().handle)
router.patch('/user/status', isAuthentication, new EditStatusController().handle)
router.delete('/user/delete', isAuthentication, new DeleteClientController().handle)
router.post('/user/change', new ChangePasswordController().handle)
router.post('/user/reset-password', new AuthResetController().handle)



//--Rotas de Email
emailRoutes.post('/send-test-email', new SendTestEmailController().handle)
router.post('/change-password', new ChangePasswordController().handle)

// Rotas deMensagem
router.get('/chat', new GetAllChatController().handle)
router.get('/chat/:order_id', new GetChatController().handle)
router.get('/message/:chat_id', new MessageGetController().handle)
router.post('/message', new MessagePostController().handle)
router.delete('/chat/:order_id', new DeleteChatController().handle)

//---Rotas de Produtos
router.get('/product', isAuthentication, new GetProductController().handle)
router.post('/product', isAuthentication, upload.single('file'), new CreateProductController().handle)
router.put('/product/edit', isAuthentication, upload.single('file'), new EditProductController().handle)
router.delete('/product/delete', isAuthentication, new DeleteProductController().handle)
router.get('/product/client', new GetProductController().handle)
router.get('/product/:id', new GetProductIdController().handle)

//--Rotas de Clientes
router.post('/client/:id',new CreateClientController().handle)
router.get('/client/:id',new GetClientController().handle)
router.delete('/client/delete', new DeleteClientController().handle)
router.put('/client/update', new UpdateClientController().handle)



//--Rotas de Pedidos(orders)
router.post('/order/:id', new OrderSalesController().handle)
router.patch('/order', new UpdateOrderController().handle)
router.get('/order',isAuthentication, new DashboardController().handle)
router.get('/grafic',isAuthentication, new GraficController().handle)

//--Rotas de Pedidos(order_item)
router.post('/order_item', new CreateOrderItemController().handle)
router.delete('/order_item', new DeleteOrderController().handle)
router.get('/order_item',isAuthentication, new GetOrdemItemController().handle)




export {
  router,
  emailRoutes
}