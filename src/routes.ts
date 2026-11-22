import { CustomerEmailRecoveryController } from "./controller/clients/CustomerEmailRecoveryController";
import { customerRecoveryLimit } from "./middlewares/customerRecoveryLimit";
import { Router } from "express";
import type { Request, Response } from "express";

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
import { AuthResetValidateController } from "./controller/user/AuthResetValidateController";
import { AuthResetController } from "./controller/user/AuthResetController";

import { isAuthentication } from "./middlewares/isAuthentication";
import { customerAccess } from "./security/customerAccess";
import { chatGuard, chatTicket } from "./socket/chat";
import { createOrdersTicket } from "./socket/orders";

import { CreateProductController } from "./controller/product/CreateProductController";
import { EditProductController } from "./controller/product/EditProductController";
import { DeleteProductController } from "./controller/product/DeleteProductController";
import { GetProductController } from "./controller/product/GetProductController";
import { GetProductIdController } from "./controller/product/GetProductIdController";

import { CreateClientController } from "./controller/clients/CreateClientController";
import { GetClientController } from "./controller/clients/GetClientController";
import { DeleteClientController } from "./controller/clients/DeleteClientController";
import { UpdateClientController } from "./controller/clients/UpdateClientController";
import { CustomerEmailVerificationController } from "./controller/clients/CustomerEmailVerificationController";

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

import { GetRestaurantTypesController } from "./controller/restaurantTypes/GetRestaurantTypesController";
import { GetStoreTypesController } from "./controller/restaurantTypes/GetStoreTypesController";
import { UpdateStoreTypesController } from "./controller/restaurantTypes/UpdateStoreTypesController";

import { CreateProductFromTemplateController } from "./controller/productTemplates/CreateProductFromTemplateController";
import { CreateProductOptionController } from "./controller/productOptions/CreateProductOptionController";
import { ListProductOptionsController } from "./controller/productOptions/ListProductOptionsController";
import { UpdateProductOptionController } from "./controller/productOptions/UpdateProductOptionController";
import { ValidateProductPublicationController } from "./controller/productTemplates/ValidateProductPublicationController";
import { PublishProductController } from "./controller/productTemplates/PublishProductController";
import { GetPublicProductConfigurationController } from "./controller/productTemplates/GetPublicProductConfigurationController";
import { ListProductTemplatesController } from "./controller/productTemplates/ListProductTemplatesController";
import { GetAdminProductConfigurationController } from "./controller/productTemplates/GetAdminProductConfigurationController";
import { UpdateConfiguredProductController } from "./controller/productTemplates/UpdateConfiguredProductController";
import { ConfiguredProductCreationController } from "./controller/productTemplates/ConfiguredProductCreationController";
import { PrivateTemplateController } from "./controller/privateTemplates/PrivateTemplateController";
//=============Bairro==============================================
import { BairroController } from "./controller/bairroController/bairroController";
//=============================WEB-PUSH=========================
import { WebPushController } from "./controller/webPushController/salvarWebPushController";

const emailRoutes = Router();
const router = Router();

const upload = multer({ storage: multer.memoryStorage() });
router.post("/orders/socket-ticket", isAuthentication, createOrdersTicket);

//-----------------------Tipos de estabelecimentos-------------------------------
router.get("/restaurant-types", new GetRestaurantTypesController().handle);
router.get(
  "/restaurant-types/:restaurantId",
  new GetStoreTypesController().handle,
);
router.put(
  "/restaurant-types",
  isAuthentication,
  new UpdateStoreTypesController().handle,
);
//-----------------------Web-Push------------------
router.post("/web-push", isAuthentication, new WebPushController().handler);

//--Rotas de User
router.post("/user", upload.single("file"), new CreateUserController().handle);
router.post("/auth", new AuthStoreController().handle);
router.get("/user/:id", new GetIdStoreController().handle);
router.get("/user", new GetStoreController().handle);
router.get("/me", isAuthentication, new DetailStoreController().handle);
router.put("/user/edit", isAuthentication, new EditStoreController().handle);
router.put(
  "/user/image/:id",
  isAuthentication,
  upload.single("file"),
  new ImageStoreController().handle,
);
router.patch(
  "/user/status",
  isAuthentication,
  new EditStatusController().handle,
);
router.delete(
  "/user/delete",
  isAuthentication,
  new DeleteClientController().handle,
);
router.post("/user/change", new ChangePasswordController().handle);
//router.post('/auth/reset/validate', new AuthResetController().handle)
router.post("/auth/reset/validate", new AuthResetController().handle);
router.get("/user/reset-password", new AuthResetValidateController().handle);
router.post("/user/reset-password", new AuthResetController().handle);

//--Rotas de Email
emailRoutes.post("/send-test-email", new SendTestEmailController().handle);
router.post("/change-password", new ChangePasswordController().handle);

//--------------Rotas de Bairro-------------------------------
router.post(
  "/criar_bairro",
  isAuthentication,
  new BairroController().criarBairro,
);
router.get(
  // "/bairros/:lanchonete_id",
  "/bairros",
  isAuthentication,
  new BairroController().getBairroId,
);

router.get(
  "/bairros/public/:lanchonete_id",
  new BairroController().getBairrosPublicos,
);
router.delete(
  "/delete_bairro/:id",
  isAuthentication,
  new BairroController().deletarBairro,
);
router.put(
  "/edit-bairro/:id",
  isAuthentication,
  new BairroController().editarBairro,
);

//----- Rotas deMensagem----------------------------------------------------
router.post("/chat/socket-ticket", chatGuard, chatTicket);
router.get("/chat", isAuthentication, new GetAllChatController().handle);
router.get("/chat/:order_id", chatGuard, new GetChatController().handle);
router.get("/message/:chat_id", chatGuard, new MessageGetController().handle);
router.post("/message", chatGuard, new MessagePostController().handle);
router.delete("/chat/:order_id", chatGuard, new DeleteChatController().handle);

//---Rotas de Produtos-----------------------------------------------------
const privateTemplates = new PrivateTemplateController();
router.get(
  "/products/templates/private",
  isAuthentication,
  privateTemplates.list,
);
router.post(
  "/products/templates/private",
  isAuthentication,
  privateTemplates.create,
);
router.get(
  "/products/templates/private/:templateId",
  isAuthentication,
  privateTemplates.get,
);
router.patch(
  "/products/templates/private/:templateId",
  isAuthentication,
  privateTemplates.rename,
);
router.delete(
  "/products/templates/private/:templateId",
  isAuthentication,
  privateTemplates.remove,
);
router.post(
  "/products/templates/private/:templateId/versions",
  isAuthentication,
  privateTemplates.version,
);
router.post(
  "/products/from-private-template",
  isAuthentication,
  privateTemplates.copy,
);

router.post(
  "/products/configured",
  isAuthentication,
  new ConfiguredProductCreationController().create,
);
router.post(
  "/products/:productId/structure",
  isAuthentication,
  new ConfiguredProductCreationController().structure,
);

router.get(
  "/products/templates",
  isAuthentication,
  new ListProductTemplatesController().handle,
);

router.get(
  "/products/:productId/admin-configuration",
  isAuthentication,
  new GetAdminProductConfigurationController().handle,
);

router.patch(
  "/products/:productId/admin-configuration",
  isAuthentication,
  new UpdateConfiguredProductController().handle,
);

router.get(
  "/products/:productId/configuration",
  new GetPublicProductConfigurationController().handle,
);

router.patch(
  "/products/:productId/publish",
  isAuthentication,
  new PublishProductController().handle,
);

router.get(
  "/products/:productId/validate-publication",
  isAuthentication,
  new ValidateProductPublicationController().handle,
);

router.patch(
  "/product-options/:optionId",
  isAuthentication,
  new UpdateProductOptionController().handle,
);

router.get(
  "/products/:productId/options",
  isAuthentication,
  new ListProductOptionsController().handle,
);

router.post(
  "/product-options",
  isAuthentication,
  new CreateProductOptionController().handle,
);

router.post(
  "/products/from-template",
  isAuthentication,
  new CreateProductFromTemplateController().handle,
);

router.get("/product", isAuthentication, new GetProductController().handle);
router.post(
  "/product",
  isAuthentication,
  upload.single("file"),
  new CreateProductController().handle,
);

router.put(
  "/product/edit",
  isAuthentication,
  upload.single("file"),
  new EditProductController().handle,
);

router.delete(
  "/product/delete",
  isAuthentication,
  new DeleteProductController().handle,
);

router.patch(
  "/produto/:productId/active",
  isAuthentication,
  new DeleteProductController().active,
);

router.patch(
  "/products/:productId/deactivate",
  isAuthentication,
  new DeleteProductController().deactivate,
);

router.get("/product/client", new GetProductController().handle);
router.get("/product/:id", new GetProductIdController().handle);

//--Rotas de Clientes---------------------------------------------
const customerEmailRecovery = new CustomerEmailRecoveryController();
router.post(
  "/client/:id/email/recovery/request",
  customerRecoveryLimit,
  customerEmailRecovery.request,
);
router.post(
  "/client/:id/email/recovery/confirm",
  customerRecoveryLimit,
  customerEmailRecovery.confirm,
);
const customerEmailVerification = new CustomerEmailVerificationController();
router.post(
  "/client/:id/email/verification/request",
  customerAccess,
  customerEmailVerification.request,
);
router.post(
  "/client/:id/email/verification/confirm",
  customerAccess,
  customerEmailVerification.confirm,
);
router.post("/client/:id", new CreateClientController().handle);
router.get("/client/:id", customerAccess, new GetClientController().handle);
router.delete(
  "/client/delete",
  isAuthentication,
  new DeleteClientController().handle,
);
router.put(
  "/client/update",
  customerAccess,
  new UpdateClientController().handle,
);

//--Rotas de Pedidos(orders)--------------------------------------
router.post("/order/:id", customerAccess, new OrderSalesController().handle);
router.patch("/order", isAuthentication, new UpdateOrderController().handle);
router.get("/order", isAuthentication, new DashboardController().handle);
router.get("/grafic", isAuthentication, new GraficController().handle);

//--Rotas de Pedidos(order_item)-------------------------------------------
router.post("/order_item", new CreateOrderItemController().handle);
router.delete(
  "/order_item",
  isAuthentication,
  new DeleteOrderController().handle,
);
router.get(
  "/order_item",
  isAuthentication,
  new GetOrdemItemController().handle,
);

export { router, emailRoutes };
