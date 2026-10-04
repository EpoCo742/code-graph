const express = require('express');
const { listProducts, getProduct } = require('./repository');

const app = express();

app.get('/products', (req, res) => {
  res.json(listProducts());
});

app.get('/products/:id', (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'not found' });
  res.json(product);
});

app.listen(9000);
