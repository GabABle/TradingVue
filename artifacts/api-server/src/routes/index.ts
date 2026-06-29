import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import chatRouter from "./chat";
import tradingRouter from "./trading";

// Stateless proxy only: market data, AI chat, and paper-trading relay.
// User accounts, watchlists, preferences, portfolio tags and alerts are stored
// entirely in the browser (see trading-chart/src/lib/local-store.ts), so there
// is no database and no auth/user/alerts routes here.
const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(chatRouter);
router.use(tradingRouter);

export default router;
