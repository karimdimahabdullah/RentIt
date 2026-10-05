/**
 * Mounted at /api/cart. Every route acts on "my own cart" - there's no
 * :userId param, since a cart only ever belongs to whoever is authenticated.
 */
import { Router } from 'express';
import { auth } from '../../middlewares/auth.js';
import * as cartController from '../controllers/cartController.js';

const router = Router();
router.use(auth);

router.get('/', cartController.viewCart);
router.post('/items', cartController.addItem);
router.delete('/items/:itemId', cartController.removeItem);
router.delete('/', cartController.clearCart);
router.post('/checkout', cartController.checkout);

export default router;
