import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import chatRouter from "./chat";
import alertsRouter from "./alerts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(chatRouter);
router.use(alertsRouter);

export default router;
