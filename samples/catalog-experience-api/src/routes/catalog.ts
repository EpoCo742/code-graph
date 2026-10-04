import { Router } from 'express';
import { fetchProduct, fetchProducts } from '../services/products';

export const catalogRouter = Router();

catalogRouter.get('/products', async (_req, res) => {
  const products = await fetchProducts();
  res.json(products.map((p) => ({ id: p.id, title: p.name, price: p.price })));
});

catalogRouter.get('/products/:id', async (req, res) => {
  const product = await fetchProduct(req.params.id);
  if (!product) return res.status(404).end();
  res.json(product);
});
