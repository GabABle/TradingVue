import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import chatRouter from "./chat";
import alertsRouter from "./alerts";
import authRouter from "./auth";
import userRouter from "./user";
import tradingRouter from "./trading";

const router: IRouter = Router();

router.use(authRouter);
router.use(userRouter);
router.use(healthRouter);
router.use(marketRouter);
router.use(chatRouter);
router.use(alertsRouter);
router.use(tradingRouter);

export default router;
